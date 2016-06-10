"use strict";

const archy = require('archy');
const program = require('commander');
const swagger = require('swagger-parser');
const Promise = require('bluebird');
const _ = require('lodash');

const fs = require('fs');
const path = require('path');

const config = require('../lib/helpers/config.js');
const cfLambdas = require('../lib/helpers/cf-lambda-triggers');
const cfResources = require('../lib/helpers/cf-template-functions');

//
//  Program specification
//

program
    .option('-t, --tree-only', 'Only draw the Lambda usage tree, skipping metadata about the service');

program.on('--help', function() {
    console.log();
    console.log('  Examples:');
    console.log();
    console.log('    Describe service located in working directory');
    console.log('    $ lambda describe');
    console.log();
    console.log('    Only list the Lambda functions and who triggers them');
    console.log('    $ lambda describe -t');
    console.log();
});

program.parse(process.argv);

// General parameters
const cwd = process.cwd();
const lambdasPath = path.resolve(cwd, 'lambdas');
const apiPath = path.resolve(cwd, 'api.json');
const templatePath = path.resolve(cwd, 'cf.json');

// Context that will be populated by various steps
const context = {
    project: config.project,
    directories: {
        cwd: cwd,
        lambdas: lambdasPath,
        api: apiPath
    },
    lambdas: [],
    template: undefined,
    api: undefined
};

// Use a series of promises to populate the context
Promise.resolve(context)
.then(function(ctx) {
    // Next up, determine if there are Lambdas, and if so, read them into the ctx
    return new Promise(function(resolve) {
        fs.stat(lambdasPath, function(err, stats) {
            if (err || !stats.isDirectory()) return resolve(ctx);

            // Grab information about all of the Lambdas (including their
            // CamelCased names)
            fs.readdir(lambdasPath, function(error, results) {
                if (error) return resolve(ctx);

                const lambdas = _.compact(results.map(function(lambdaPath) {
                    const fullPath = path.join(lambdasPath, lambdaPath);

                    // Make sure it is a directory
                    if (!fs.statSync(fullPath).isDirectory()) {
                        return;
                    }

                    let name = _.camelCase(lambdaPath);
                    name = name.charAt(0).toUpperCase() + name.substring(1);

                    const lambda = {
                        name: name,
                        path: fullPath
                    };

                    return lambda;
                }));

                ctx.lambdas = lambdas;
                resolve(ctx);
            });
        });
    });
})
.then(function(ctx) {
    // Determine if there is an API, if so, validate the Swagger
    return new Promise(function(resolve) {
        fs.stat(apiPath, function(err, stats) {
            if (err || !stats.isFile()) return resolve(ctx);

            swagger.validate(apiPath, function(error, api) {
                if (error) return resolve(ctx);

                ctx.api = api;
                resolve(ctx);
            });
        });
    });
})
.then(function(ctx) {
    if (program.treeOnly) {
        return ctx;
    }

    // Report the results
    console.log('Name:', ctx.project.name);
    console.log('Location:', ctx.directories.cwd);

    console.log('Lambdas:', ctx.lambdas.length);
    console.log('API:', !_.isUndefined(ctx.api));

    if (ctx.api !== undefined) {
        console.log('API Paths:', _.keys(ctx.api.paths).length);
    }

    console.log();

    return ctx;
})
.then(function(ctx) {
    // Look for a CF template, resolve it if there is one
    return new Promise(function(resolve) {
        fs.stat(templatePath, function(err, stats) {
            if (err || !stats.isFile()) return resolve(ctx);

            fs.readFile(templatePath, function(error, data) {
                if (error) return resolve(ctx);

                ctx.template = JSON.parse(data);
                resolve(ctx);
            });
        });
    });
})
.then(function(ctx) {
    // Determine the triggers for the Lambdas, draw a graph based on those
    const results = {
        label: 'Lambdas',
        nodes: []
    };

    const foundLambdas = [];

    //
    // First up, the public API on API Gateway
    //
    const api = _.map(ctx.api.paths, function(value, key) {
        return {
            label: key,
            nodes: _.compact(_.map(value, function(params, method) {
                // Determine the Lambda this method triggers
                const uri = _.get(params, 'x-amazon-apigateway-integration.uri');
                if (_.isUndefined(uri) || !_.startsWith(uri, '$l')) {
                    return;
                }

                const lambdaName = _.trimStart(uri, '$l');
                const lambda = _.find(ctx.lambdas, { name: lambdaName });

                if (_.isUndefined(lambda)) {
                    return;
                }

                foundLambdas.push(lambda);

                return {
                    label: method.toUpperCase(),
                    nodes: [path.basename(lambda.path)]
                };
            }))
        };
    });

    // The API may also include authorizers
    const securityDefinitions = _.get(ctx.api, 'securityDefinitions');
    if (securityDefinitions) {
        api.push({
            label: 'Authorizers',
            nodes: _.compact(_.map(securityDefinitions, function(value, key) {
                const definition = value['x-amazon-apigateway-authorizer'];
                if (_.isUndefined(definition)) {
                    return;
                }

                return {
                    label: key,
                    nodes: cfResources(definition.authorizerUri).map(function(dep) {
                        if (_.startsWith(dep, 'arn:aws:lambda')) {
                            return dep;
                        }

                        const lambdaName = _.trimStart(dep, '$l');
                        const lambda = _.find(ctx.lambdas, { name: lambdaName });
                        if (!lambda) {
                            return dep;
                        }

                        foundLambdas.push(lambda);
                        return path.basename(lambda.path);
                    })
                };
            }))
        });
    }

    results.nodes.push({
        label: 'API',
        nodes: api
    });

    //
    // Second, look for triggers in CF.json
    //
    const triggeredLambdas = _.compact(_.map(cfLambdas(ctx.template), function(value, key) {
        const lambdas = _.compact(_.map(value, function(dep) {
            if (_.startsWith(dep, 'arn:aws:lambda')) {
                return dep;
            }

            const lambda = _.find(ctx.lambdas, { name: dep });
            if (!lambda) {
                return;
            }

            foundLambdas.push(lambda);

            return path.basename(lambda.path);
        }));

        if (lambdas.length === 0) {
            return;
        }

        return {
            label: key,
            nodes: lambdas
        };
    }));

    results.nodes.push({
        label: 'CloudFormation',
        nodes: triggeredLambdas
    });

    //
    // Finally, lambdas that are seemingly not connected to anything
    //
    const unknown = _.map(_.difference(ctx.lambdas, foundLambdas), function(value) {
        return path.basename(value.path);
    });

    if (unknown.length > 0) {
        results.nodes.push({
            label: 'Unknown',
            nodes: unknown
        });
    }

    ctx.tree = results;
    return ctx;
})
.then(function(ctx) {
    console.log(archy(ctx.tree));
})
.catch(function(err) {
    console.error('Error', err, err.stack);
});
