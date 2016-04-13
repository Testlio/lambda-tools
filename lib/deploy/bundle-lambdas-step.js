"use strict";

const Promise = require('bluebird');
const archive = require('simple-archiver').archive;
const babelify = require('babelify');
const presets = require('babel-preset-es2015');
const Browserify = require('browserify');
const crypto = require('crypto');
const envify = require('envify/custom');
const fs = Promise.promisifyAll(require('fs'));
const fsx = require('../helpers/fs-additions');
const path = require('path');
const uglify = require('uglify-js');
const _ = require('lodash');

const getDependencies = require('../helpers/dependencies');

// Optimization levels, higher number gets
// everything from the levels below + adds something
const OPTIMIZATION = {
    UGLIFIED: 1,
    BUNDLED: 0
};

/**
 *  Helper for recursively adding all dependencies to an archive
 */
function archiveDependencies(cwd, pkg) {
    let result = [];

    if (pkg.path) {
        result.push({
            data: pkg.path,
            type: 'directory',
            name: path.relative(cwd, pkg.path)
        });
    }

    pkg.dependencies.forEach(function(dep) {
        if (dep.path) {
            result.push({
                data: dep.path,
                type: 'directory',
                name: path.relative(cwd, dep.path)
            });
        }

        if (dep.dependencies) {
            result = result.concat(archiveDependencies(cwd, dep));
        }
    });

    return result;
}

/**
 *  Processing pipeline, all functions should return a promise
 */

/**
 *  Bundles the lambda code and stores it to path
 *
 *  @param lambda Lambda function to bundle, should at minimum have a path property
 *                 with the entry point
 *  @param exclude Array of packages to exclude from the bundle, defaults to aws-sdk
 *
 *  @returns Promise that resolves to the bundled code
 */
function bundleLambda(lambda, exclude, environment, transpile) {
    environment = environment || {};
    exclude = exclude || [];

    return new Promise(function(resolve, reject) {
        const bundler = new Browserify(lambda.path, {
            basedir: path.dirname(lambda.path),
            standalone: lambda.name,
            browserField: false,
            builtins: false,
            commondir: false,
            ignoreMissing: true,
            detectGlobals: true,
            insertGlobalVars: {
                process: function() {}
            }
        });

        // AWS SDK should always be excluded
        bundler.exclude('aws-sdk');

        // Further things to exclude
        [].concat(exclude).forEach(function(module) {
            bundler.exclude(module);
        });

        // Envify (doesn't purge, as there are valid values
        // that can be used in Lambda functions)
        bundler.transform(envify(environment), {
            global: true
        });

        if (transpile) {
            // Babel (for ES6 support)
            bundler.transform(babelify, {
                presets: [presets],
                compact: false,
                global: true,
                ignore: /\/node_modules\/\.bin\/.*/
            });
        }

        bundler.bundle(function(err, data) {
            if (err) return reject(err);
            resolve(data);
        });
    });
}

/**
 *  Minify code using UglifyJS
 *
 *  @param code Code to minify
 *
 *  @returns Promise that resolves to the minified code
 */
function minifyCode(code) {
    return new Promise(function(resolve, reject) {
        const minified = uglify.minify(code, {
            fromString: true,
            mangle: false,
            compress: {}
        }).code;

        if (!minified) {
            reject(new Error(`Failed to uglify/minify`));
        }

        resolve(minified);
    });
}

//
// Step that takes lambdas in the context and processes them into
// uploadable zips in the staging directory
//
module.exports = function(context) {
    // Store process env temporarily (so we could reflect the env during bundling)
    const restoreEnvironment = _.assign({}, process.env);
    const cwd = context.directories.cwd;

    const excluded = context.program.exclude;
    const optimization = context.program.optimization;
    const clean = context.program.clean;
    const logger = context.logger;
    const env = context.program.environment;

    return new Promise(function(resolve) {
        // Reflect the env from the context on the process (this way
        // the bundling process sees the variables as well)
        process.env = _.merge(process.env, context.program.environment);
        resolve();
    }).then(function() {
        return context.logger.task('Processing Lambdas', function(finish, fail) {
            // Process all lambdas (serially so that we can output nicely)
            return Promise.mapSeries(context.lambdas, function(lambda) {
                const bundledPath = path.resolve(context.directories.staging, lambda.name + '.bundled.js');
                const minifiedPath = path.resolve(context.directories.staging, lambda.name + '.minified.js');
                const zippedPath = path.resolve(context.directories.staging, lambda.name + '.zip');
                const manifestPath = path.resolve(context.directories.staging, lambda.name + '.manifest.json');

                return context.logger.task(lambda.name, function(resolve, reject) {
                    // First, bundle the code
                    logger.task('Bundling', function(res, rej) {
                        bundleLambda(lambda, excluded, env, false)
                        .then(res, rej);
                    })
                    .then(function(bundledCode) {
                        // Generate the manifest
                        return logger.task('Generate manifest', function(res, rej) {
                            fs.readFileAsync(lambda.path).then(function(originalCode) {
                                return getDependencies(originalCode, { basedir: path.dirname(lambda.path), deep: true }).then(function(dependencies) {
                                    return {
                                        checksum: crypto.createHash('sha1').update(bundledCode).digest('hex'),
                                        dependencies: dependencies
                                    };
                                });
                            })
                            .then(res, rej);
                        });
                    })
                    .then(function(manifest) {
                        // Use the manifest to compare against existing
                        return fs.statAsync(manifestPath).then(function(stats) {
                            return stats.isFile();
                        }, function() {
                            return false;
                        })
                        .then(function(exists) {
                            if (exists && !clean) {
                                // Compare manifests
                                const previous = fsx.readJSONFileSync(manifestPath);
                                const comparison = _.omit(previous, 'zip');

                                if (JSON.stringify(comparison) === JSON.stringify(manifest)) {
                                    logger.log('Using cached bundle');

                                    // Equal manifest, same file, reuse
                                    return _.assign({}, lambda, {
                                        zip: previous.zip
                                    });
                                }
                            }

                            // Re-process the bundle
                            return logger.task('Rebundling/Transpiling', function(res, rej) {
                                bundleLambda(lambda, excluded, env, true)
                                .then(function(code) {
                                    // Write to disk (again)
                                    return fs.writeFileAsync(bundledPath, code).then(function() {
                                        return code;
                                    });
                                })
                                .then(res, rej);
                            })
                            .then(function(code) {
                                if (optimization >= OPTIMIZATION.UGLIFIED) {
                                    return logger.task('Minifying', function(res, rej) {
                                        minifyCode(code.toString('utf8')).then(function(minified) {
                                            // Store the minfied code
                                            return fs.writeFileAsync(minifiedPath, minified)
                                            .then(function() {
                                                return minified;
                                            });
                                        }).then(res, rej);
                                    });
                                }

                                return code;
                            })
                            .then(function(code) {
                                // Archive the resulting code
                                // We have the function code, create the zip file from it
                                let entries = [];

                                // Function is always part of the ZIP
                                entries.push({
                                    data: code,
                                    type: 'string',
                                    name: path.basename(lambda.path)
                                });

                                // Derive any modules that were not added to the bundle (were excluded),
                                // but have been required by the module
                                const exclusions = [].concat(excluded);
                                if (exclusions.length > 0) {
                                    // Lambda has manifest, which we can use to also get all dependencies
                                    // we have to pack separately
                                    const packedDeps = [].concat(manifest.dependencies).filter(function(dep) {
                                        return exclusions.indexOf(dep.name) !== -1;
                                    });

                                    let excludedEntries = [];

                                    packedDeps.forEach(function(dep) {
                                        excludedEntries = excludedEntries.concat(archiveDependencies(cwd, dep));
                                    });

                                    entries = entries.concat(excludedEntries);
                                }

                                return logger.task('Compressing', function(res, rej) {
                                    archive(entries, {
                                        format: 'zip',
                                        output: zippedPath
                                    })
                                    .then(function() {
                                        // Write the manifest to disk (include the zip path)
                                        manifest.zip = zippedPath;

                                        return fs.writeFileAsync(manifestPath, JSON.stringify(manifest, null, 4))
                                            .then(function() {
                                                return _.assign({}, lambda, {
                                                    zip: zippedPath
                                                });
                                            });
                                    }).then(res, rej);
                                });
                            });
                        });
                    })
                    .then(resolve, reject);
                });
            }).then(finish, fail);
        }).then(function(newLambdas) {
            return _.assign({}, context, {
                lambdas: newLambdas
            });
        }).then(function(ctx) {
            process.env = restoreEnvironment;
            return ctx;
        });
    });
};
