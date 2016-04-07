"use strict";

const Promise = require('bluebird');
const archive = require('simple-archiver').archive;
const Browserify = require('browserify');
const babelify = require('babelify');
const crypto = require('crypto');
const envify = require('envify/custom');
const fs = Promise.promisifyAll(require('fs'));
const fsx = require('../helpers/fs-additions');
const path = require('path');
const presets = require('babel-preset-es2015');
const uglify = require('uglify-js');
const _ = require('lodash');

const dependencies = require('../helpers/dependencies');

// Optimization levels, higher number gets
// everything from the levels below + adds something
const OPTIMIZATION = {
    UGLIFIED: 1,
    BUNDLED: 0
};

/**
 *  Processing pipeline, all functions should return a promise
 */

/**
 *  Generates a manifest object for a specific Lambda function
 *
 *  @returns Promise, which resolves to an object containing the following keys
 *            checksum: SHA1 of the Lambda function code
 *            dependencies: Array of dependencies the code has
 */
function generateManifest(lambda) {
    return fs.readFileAsync(lambda.path, { encoding: 'utf8' })
    .then(function(code) {
        return dependencies(code, { basedir: path.dirname(lambda.path), deep: true }).then(function(dependencies) {
            return {
                checksum: crypto.createHash('sha1').update(code).digest('hex'),
                dependencies: dependencies
            };
        });
    });
}

/**
 *  Bundle a Lambda function, creates a bundled Lambda function, which is
 *  a single file that can be uploaded to AWS Lambda
 *
 *  @param options - object that should contain the following keys:
 *            path - path to the main Lambda function entry point
 *    dependencies - known dependencies for this Lambda function
 *            name - name of the Lambda function
 *     environment - environment to expose to the Lambda function
 *     bundledPath - path where the resulting bundle should be placed
 *     packagePath - path where the final zip file should be placed
 *         exclude - modules to exclude from Browserify process
 *    optimization - optimization level for the bundling
 */
function bundleLambda(options, cwd, context) {
    const bundler = new Browserify(options.path, {
        basedir: path.dirname(options.path),
        standalone: options.name,
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
    if (options.exclude) {
        [].concat(options.exclude).forEach(function(module) {
            bundler.exclude(module);
        });
    }

    // Babel (for ES6 support)
    bundler.transform(babelify, {
        presets: [presets],
        compact: false,
        global: true,
        ignore: /\/node_modules\/\.bin\/.*/
    });

    // Envify (doesn't purge, as there are valid values
    // that can be used in Lambda functions)
    bundler.transform(envify(options.environment), {
        global: true
    });

    return context.logger.task('Bundling', function(res, rej) {
        bundler.bundle(function(err, data) {
            if (err) return rej(err);
            res(data);
        });
    })
    .then(function(result) {
        // Store the bundled file (for reference)
        fs.writeFileSync(options.bundledPath, result);
        return result;
    })
    .then(function(bundled) {
        // Minify (if allowed) the bundled result
        if (options.optimization >= OPTIMIZATION.UGLIFIED) {
            return context.logger.task('Minifying', function() {
                const minified = uglify.minify(options.bundledPath, {
                    mangle: false,
                    compress: {}
                }).code;

                if (!minified) {
                    throw new Error(`Failed to uglify/minify ${options.bundledPath}`);
                }

                // Store the minified code separately for reference
                const minifiedFileName = `${path.basename(options.bundledPath, '.js')}.minfied.js`;
                const minifiedPath = path.resolve(path.dirname(options.bundledPath), minifiedFileName);

                // Write to disk (for reference)
                fs.writeFileSync(minifiedPath, minified);
                return minified;
            });
        }

        // Continue with just the bundled code
        return bundled;
    })
    .then(function(lambdaCode) {
        // We have the function code, create the zip file from it
        const entries = [];

        // Function is always part of the ZIP
        entries.push({
            data: lambdaCode,
            type: 'string',
            name: path.basename(options.path)
        });

        // Derive any modules that were not added to the bundle (were excluded),
        // but have been required by the module
        const exclusions = [].concat(options.exclude);
        if (exclusions.length > 0) {
            // Lambda has manifest, which we can use to also get all dependencies
            // we have to pack separately
            const packedDeps = [].concat(options.dependencies).filter(function(dep) {
                return exclusions.indexOf(dep.name) !== -1;
            });

            packedDeps.forEach(function(dep) {
                if (dep.path) {
                    entries.push({
                        data: dep.path,
                        type: 'directory',
                        name: path.relative(cwd, dep.path)
                    });
                }
            });
        }

        return context.logger.task('Compressing', function(res, rej) {
            archive(entries, {
                format: 'zip',
                output: options.packagePath
            }).then(res, rej);
        });
    });
}

//
// Step that takes lambdas in the context and processes them into
// uploadable zips in the staging directory
//
module.exports = function(context) {
    // Store process env temporarily (so we could reflect the env during bundling)
    const restoreEnvironment = _.assign({}, process.env);

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
                const zippedPath = path.resolve(context.directories.staging, lambda.name + '.zip');

                return context.logger.task(lambda.name, function(res, rej) {
                    generateManifest(lambda)
                    .then(function(manifest) {
                        const manifestPath = path.resolve(context.directories.staging, `${lambda.name}.manifest.json`);

                        return fs.statAsync(manifestPath).then(function(stats) {
                                return stats.isFile();
                            }, function(err) {
                                return false;
                            })
                            .then(function(exists) {
                                if (exists) {
                                    // Compare
                                    const previous = fsx.readJSONFileSync(manifestPath);
                                    const comparison = _.omit(previous, 'zip');

                                    if (JSON.stringify(comparison) === JSON.stringify(manifest)) {
                                        context.logger.log('Using cached bundle');

                                        // Same manifest, same file, easy-peasy
                                        return _.assign({}, lambda, {
                                            zip: previous.zip
                                        });
                                    }
                                }

                                // Different or no-comparison, full-on bundling is needed
                                return bundleLambda({
                                    path: lambda.path,
                                    name: lambda.name,
                                    dependencies: manifest.dependencies,
                                    environment: context.program.environment,
                                    bundledPath: bundledPath,
                                    packagePath: zippedPath,
                                    optimization: context.program.optimization,
                                    exclude: context.program.exclude
                                }, context.directories.cwd, context).then(function() {
                                    // Write the manifest to disk (include the zip path)
                                    manifest.zip = zippedPath;

                                    return fs.writeFileAsync(manifestPath, JSON.stringify(manifest, null, 4))
                                        .then(function() {
                                            return _.assign({}, lambda, {
                                                zip: zippedPath
                                            });
                                        });
                                });
                            });
                    })
                    .then(res, rej);
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
