"use strict";

require('colors');
const path = require('path');
const program = require('commander');
const swagger = require('swagger-parser');
const _ = require('lodash');

const parseEnvironment = require('../lib/helpers/environment-parser.js');
const Route = require('../lib/run/route');

const parser = require('koa-body')();
const app = require('koa')();
const router = require('koa-router')();
const logger = require('koa-logger')();

//
//  Program specification
//

program
    .option('-p, --port <number>', 'Port to use locally', 3000)
    .option('-a, --api-file <file>', 'Path to Swagger API spec (defaults to "./api.json")', './api.json', path.resolve.bind(this, program.directory))
    .option('-e, --environment <env>', 'Environment Variables to embed as key-value pairs', parseEnvironment, {})
    .parse(process.argv);

// Determine our target directory
program.directory = process.cwd();

// Parse API definition into a set of routes
swagger.validate(program.apiFile, function(err, api) {
    if (err) {
        console.log("Failed to validate Swagger API definition".red);
        console.error(err);
        process.exit();
    }

    // For each of the paths in the API, we want to set up a route that handles it
    _.forEach(api.paths, function(methods, apiPath) {
        _.forEach(methods, function(definition, method) {
            // Convert path to be koa-router suitable (variables are listed differently)
            const parsedPath = apiPath.replace(/\{([^\}\/]*)\}/g, ':$1');

            // Set up the route for the path
            router[method](parsedPath, Route(_.get(definition, 'x-amazon-apigateway-integration'), program));
        });
    });

    app
        .use(function *(next) {
            // Generic error handler
            try {
                yield next;
            } catch (innerError) {
                this.status = innerError.status || 500;
                this.body = innerError.message;
                console.error(innerError.stack);
                console.error(innerError.message);
            }
        })
        .use(logger)
        .use(parser)
        .use(router.routes())
        .use(router.allowedMethods());

    app.listen(program.port);
    console.log(("Server listening on " + program.port).green);
});
