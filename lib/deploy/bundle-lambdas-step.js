"use strict";

require('colors');
const archive = require('simple-archiver').archive;
const Browserify = require('browserify');
const babelify = require('babelify');
const cp = require('child_process');
const detective = require('detective');
const envify = require('envify/custom');
const fs = require('fs');
const path = require('path');
const presets = require('babel-preset-es2015');
const Promise = require('bluebird');
const resolvePkg = require('resolve-pkg');
const uglify = require('uglify-js');
const _ = require('lodash');

// Optimization levels, higher number gets
// everything from the levels below + adds something
const OPTIMIZATION = {
    UGLIFIED: 1,
    BUNDLED: 0
};

/**
 *  Helper function for obtaining a full list of packages
 *  that should be compressed in order to use the provided packages
 */
let resolvedDependencies = undefined;
function getFullDependencies(packages) {
    let promise;
    if (resolvedDependencies) {
        promise = Promise.resolve(resolvedDependencies);
    } else {
        promise = new Promise(function(resolve) {
            const child = cp.spawn('npm', ['ls', '--json', '--long']);

            let data = '';
            child.stdout.on('data', function (chunk) {
                data += chunk;
            });

            child.on('close', function () {
                resolvedDependencies = JSON.parse(data).dependencies;
                resolve(resolvedDependencies);
            });
        });
    }

    // Once we have a list of packages in this app, we can expand that to include
    // their dependencies, and so on...
    const allDependencies = function(tree) {
        if (!tree.dependencies) {
            return [];
        }

        const direct = Object.keys(tree.dependencies);
        let matches = [].concat(direct);

        direct.forEach(function(subtree) {
            matches = matches.concat(allDependencies(tree.dependencies[subtree]));
        });

        return matches;
    };

    return promise.then(function(tree) {
        let results = [];

        Object.keys(tree).forEach(function(candidate) {
            if (packages.indexOf(candidate) !== -1) {
                results = results.concat(candidate);
                results = results.concat(allDependencies(tree[candidate]));
            }
        });

        return _.uniq(results);
    });
}

/**
 *  Bundle a Lambda function, creates a bundled Lambda function, which is
 *  a single file that can be uploaded to AWS Lambda
 *
 *  @param options - object that should contain the following keys:
 *            path - path to the main Lambda function entry point
 *            name - name of the Lambda function
 *     environment - environment to expose to the Lambda function
 *     bundledPath - path where the resulting bundle should be placed
 *     packagePath - path where the final zip file should be placed
 *         exclude - modules to exclude from Browserify process
 *    optimization - optimization level for the bundling
 */
function bundleLambda(options, cwd) {
    return new Promise(function(resolve, reject) {
        console.log(`\nProcessing ${options.name}`);

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

        process.stdout.write('\tBundling');
        return new Promise(function(res, rej) {
            bundler.bundle(function(err, data) {
                if (err) return rej(err);
                res(data);
            });
        }).then(function(result) {
            // Store the bundled file (for reference)
            fs.writeFileSync(options.bundledPath, result);
            console.log(` ${'✔'.green} ${('(' + options.bundledPath + ')').gray}`);

            resolve(result);
        }).catch(function(err) {
            console.log(' ✖'.red);
            reject(err);
        });
    }).then(function(bundled) {
        // Minify (if allowed) the bundled result
        if (options.optimization >= OPTIMIZATION.UGLIFIED) {
            process.stdout.write('\tMinifying');
            const minified = uglify.minify(options.bundledPath, {
                mangle: false,
                compress: {}
            }).code;

            if (!minified) {
                console.log(' ✖'.red);
                throw new Error(`Failed to uglify/minify ${options.bundledPath}`);
            }

            // Store the minified code separately for reference
            const minifiedFileName = `${path.basename(options.bundledPath, '.js')}.minfied.js`;
            const minifiedPath = path.resolve(path.dirname(options.bundledPath), minifiedFileName);

            fs.writeFileSync(minifiedPath, minified);

            console.log(` ${'✔'.green} ${('(' + minifiedPath + ')').gray}`);

            return minified;
        }

        // Continue with just the bundled code
        return bundled;
    }).then(function(lambdaCode) {
        // We have the function code, create the zip file from it
        const entries = [];

        // Function is always part of the ZIP
        entries.push({
            data: lambdaCode,
            type: 'string',
            name: path.basename(options.path)
        });

        let promise = Promise.resolve();

        // Derive any modules that were not added to the bundle (were excluded),
        // but have been required by the module
        const exclusions = [].concat(options.exclude);
        if (exclusions.length > 0) {
            const requires = detective(lambdaCode).filter(function(string) {
                return exclusions.indexOf(string) !== -1;
            });

            // Add the appropriate modules to the zip file
            if (requires.length > 0) {
                promise = getFullDependencies(requires).then(function(dependencies) {
                    console.log('Adding excluded packages and any dependencies', JSON.stringify(requires), '=>', JSON.stringify(dependencies));

                    // Convert all dependencies to paths
                    return Promise.all(dependencies.map(function(p) {
                        return resolvePkg(p);
                    }));
                }).then(function(paths) {
                    // Add paths to zip
                    paths.forEach(function(packagePath) {
                        if (packagePath) {
                            entries.push({
                                data: packagePath,
                                type: 'directory',
                                name: path.relative(cwd, packagePath)
                            });
                        }
                    });
                });
            }
        }

        return promise.then(function() {
            process.stdout.write('\tCompressing');
            return archive(entries, {
                format: 'zip',
                output: options.packagePath
            }).then(function() {
                console.log(` ${'✔'.green} ${('(' + options.packagePath + ')').gray}`);
            }).catch(function(err) {
                console.log(' ✖'.red);
                throw err;
            });
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
        // Process all lambdas (serially so that we can output nicely)
        return Promise.mapSeries(context.lambdas, function(lambda) {
            const bundledPath = path.resolve(context.directories.staging, lambda.name + '.bundled.js');
            const zippedPath = path.resolve(context.directories.staging, lambda.name + '.zip');

            return bundleLambda({
                path: lambda.path,
                name: lambda.name,
                environment: context.program.environment,
                bundledPath: bundledPath,
                packagePath: zippedPath,
                optimization: context.program.optimization,
                exclude: context.program.exclude
            }, context.directories.cwd).then(function() {
                return _.assign({}, lambda, {
                    zip: zippedPath
                });
            });
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
