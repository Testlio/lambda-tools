"use strict";

const Promise = require('bluebird');
const archive = require('simple-archiver').archive;
const fs = Promise.promisifyAll(require('graceful-fs'));
const _ = require('lodash');

const fsx = require('../helpers/fs-additions');
const getDependencies = require('../helpers/dependencies');

const path = require('path');
const hashFiles = Promise.promisify(require('hash-files'));

const babel = require('@babel/core');
const es2015presets = require('babel-preset-es2015');
const nodePresets = require('babel-preset-latest-node');

const Browserify = require('browserify');
const envify = require('envify/custom');
const exorcist = require('exorcist');

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
 *  Bundles the lambda code, returning the bundled code
 *
 *  @param lambda Lambda function to bundle, should at minimum have a path property
 *                 with the entry point
 *  @param exclude Array of packages to exclude from the bundle, defaults to aws-sdk
 *  @param environment Env variables to envify
 *  @param bundlePath Path to save the bundled code to
 *  @param sourceMapPath Path to save the source maps to
 *
 *  @returns Promise that bundles the code and writes it to a file
 */
function bundleLambda(lambda, exclude, environment, bundlePath, sourceMapPath) {
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
            debug: !!sourceMapPath,
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
        if (environment) {
            bundler.transform(envify(environment), {
                global: true
            });
        }

        let stream = bundler.bundle();
        if (sourceMapPath) {
            stream = stream.pipe(exorcist(sourceMapPath));
        }

        stream.pipe(fs.createWriteStream(bundlePath));

        stream.on('error', function(err) {
            reject(err);
        }).on('end', function() {
            resolve();
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
    const cwd = context.directories.cwd;

    const excluded = context.program.exclude;
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
            // Process all Lambda functions (serially, as Babel and Browserify don't
            // like parallelism for some reason)
            return Promise.mapSeries(context.lambdas, function(lambda) {
                const basePath = context.directories.staging;
                const bundledPath = path.resolve(basePath, lambda.name + '.bundled.js');
                const bundledMapPath = path.resolve(basePath, lambda.name + '.bundled.js.map');
                const transpiledPath = path.resolve(basePath, lambda.name + '.transpiled.js');
                const transpiledMapPath = path.resolve(basePath, lambda.name + '.transpiled.js.map');
                const zippedPath = path.resolve(basePath, lambda.name + '.zip');
                const manifestPath = path.resolve(basePath, lambda.name + '.manifest.json');

                const runtime = _.get(lambda, 'config.Properties.Runtime', 'nodejs16.x');

                return context.logger.task(lambda.name, function(resolve, reject) {
                    // First, bundle the code (this bundle will be used for the manifest etc)
                    logger.task('Bundling', function(res, rej) {
                        bundleLambda(lambda, excluded, env, bundledPath, bundledMapPath)
                        .then(res, rej);
                    })
                    .then(function() {
                        // Generate the manifest for this particular Lambda function (bundle)
                        return logger.task('Generating manifest', function(res, rej) {
                            fs.readFileAsync(lambda.path).then(function(originalCode) {
                                return getDependencies(originalCode, { basedir: path.dirname(lambda.path), deep: true });
                            })
                            .then(function(deps) {
                                // We have dependencies, now generate a checksum for the code itself
                                let files = [bundledPath];

                                if (lambda.assets) {
                                    const assetFiles = _.values(lambda.assets).map(function(asset) {
                                        return path.resolve(path.dirname(lambda.path), asset);
                                    });

                                    files = files.concat(assetFiles);
                                }

                                return hashFiles({
                                    files: files
                                }).then(function(hash) {
                                    const config = {
                                        runtime: runtime
                                    };

                                    return {
                                        checksum: hash,
                                        dependencies: deps,
                                        config: config,
                                        assets: lambda.assets,
                                        sourceMaps: true,
                                        zip: zippedPath
                                    };
                                });
                            })
                            .then(res, rej);
                        });
                    })
                    .then(function(manifest) {
                        // Load existing manifest
                        return fs.statAsync(manifestPath).then(function(stats) {
                            if (clean) {
                                return {
                                    manifest: manifest,
                                    rebundle: true
                                };
                            }

                            if (stats.isFile()) {
                                // Compare manifests
                                const previous = fsx.readJSONFileSync(manifestPath);
                                const comparison = previous;

                                if (JSON.stringify(comparison) === JSON.stringify(manifest)) {
                                    return {
                                        manifest: previous,
                                        rebundle: false
                                    };
                                }
                            }

                            return {
                                manifest: manifest,
                                rebundle: true
                            };
                        }, function() {
                            return {
                                manifest: manifest,
                                rebundle: true
                            };
                        })
                        .then(function(result) {
                            // If we are going to rebundle, then save the new manifest to disk
                            if (result.rebundle) {
                                return fs.writeFileAsync(manifestPath, JSON.stringify(result.manifest)).then(function() {
                                    return result;
                                });
                            } else {
                                return result;
                            }
                        });
                    })
                    .then(function(result) {
                        const rebundle = result.rebundle;
                        const manifest = result.manifest;

                        if (!rebundle) {
                            // If we don't want to rebundle, we can simply continue with existing zip
                            logger.log('Using previous ZIP');

                            return _.assign({}, lambda, {
                                zip: zippedPath,
                                sourceMap: transpiledMapPath
                            });
                        }

                        // Transpile and then compress
                        return logger.task('Transpiling', function(res, rej) {
                            // Determine appropriate transpiler presets
                            const options = {
                                compact: true,
                                comments: false,
                                sourceMaps: false,
                                inputSourceMap: JSON.parse(fs.readFileSync(bundledMapPath))
                            };

                            if (runtime === 'nodejs') {
                                options.presets = [es2015presets];
                            } else if (runtime === 'nodejs16.x') {
                                options.presets = [nodePresets];
                            }

                            babel.transformFile(bundledPath, options, function(err, transpiled) {
                                if (err) return rej(err);
                                res(transpiled);
                            });
                        })
                        .then(function(transpiled) {
                            // Write the code to disk
                            return fs.writeFileAsync(transpiledPath, transpiled.code).then(function() {
                                return fs.writeFileAsync(transpiledMapPath, JSON.stringify(transpiled.map));
                            });
                        })
                        .then(function() {
                            // Archive the resulting code
                            // We have the function code, create the zip file from it
                            let entries = [];

                            // Function is always part of the ZIP
                            entries.push({
                                data: transpiledPath,
                                type: 'file',
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

                            // Also include any assets that the Lambda may have required
                            if (lambda.assets) {
                                _.forOwn(lambda.assets, function(location, name) {
                                    entries.push({
                                        data: path.resolve(path.dirname(lambda.path), location),
                                        type: 'file',
                                        name: name
                                    });
                                });
                            }

                            return logger.task('Compressing', function(res, rej) {
                                archive(entries, {
                                    format: 'zip',
                                    output: zippedPath
                                })
                                .then(function() {
                                    return _.assign({}, lambda, {
                                        zip: zippedPath,
                                        sourceMap: transpiledMapPath
                                    });
                                }).then(res, rej);
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
