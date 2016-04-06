"use strict";

const chalk = require('chalk');
const http = require('http');
const fs = require('fs');
const path = require('path');
const program = require('commander');
const swagger = require('swagger-parser');
const _ = require('lodash');

const parseEnvironment = require('../lib/helpers/environment-parser.js');
const parsePath = require('../lib/helpers/path-parser.js');
const Route = require('../lib/run/route');

const koaApp = require('koa');
const koaParser = require('koa-body');
const koaRouter = require('koa-router');
const koaLogger = require('koa-logger');

const cwd = process.cwd();

//
//  Program specification
//

program
    .option('-p, --port <number>', 'Port to use locally', 3000)
    .option('-a, --api-file <file>', 'Path to Swagger API spec (defaults to "./api.json")', parsePath, path.resolve(cwd, 'api.json'))
    .option('-e, --environment <env>', 'Environment Variables to embed as key-value pairs', parseEnvironment, {})
    .option('--mirror-environment', 'Mirror the environment visible to lambda-tools in the lambda functions')
    .parse(process.argv);

// Determine our target directory
program.directory = process.cwd();

if (program.mirrorEnvironment) {
    program.environment = _.merge({}, process.env, program.environment);
}

// Extend the environment to include info about runtime
if (!program.environment['BASE_URL']) {
    program.environment['BASE_URL'] = 'http://localhost:' + program.port;
}

function * genericErrorHandler(next) {
    // Generic error handler
    try {
        yield next;
    } catch (innerError) {
        this.status = innerError.status || 500;
        this.body = innerError.message;
        console.error(innerError.stack);
        console.error(innerError.message);
    }
}

let server;
function restartServer(apiFile, port) {
    if (server) {
        server.close();
        server = undefined;
        console.log(chalk.red(`Stopped server on ${port}`));
    }

    // Parse API definition into a set of routes and kick start the Koa app
    swagger.validate(apiFile, function(err, api) {
        if (err) {
            console.error(chalk.red('Failed to start server'), err.message);
            console.error(err.stack);
            return;
        }

        const router = koaRouter();

        // For each of the paths in the API, we want to set up a route that handles it
        _.forEach(api.paths, function(methods, apiPath) {
            _.forEach(methods, function(definition, method) {
                // Convert path to be koa-router suitable (variables are listed differently)
                const parsedPath = apiPath.replace(/\{([^\}\/]*)\}/g, ':$1');

                // Set up the route for the path
                router[method](parsedPath, Route(_.get(definition, 'x-amazon-apigateway-integration'), program));
            });
        });

        const app = koaApp();
        const logger = koaLogger();
        const parser = koaParser();

        app
            .use(genericErrorHandler)
            .use(logger)
            .use(parser)
            .use(router.routes())
            .use(router.allowedMethods());

        server = http.createServer(app.callback());
        server.listen(port);
        console.log(chalk.green(`Server listening on ${program.port}`));
    });
}

restartServer(program.apiFile, program.port);

// Watch API definition
fs.watch(program.apiFile, {
    persistent: true
}, function(event, filename) {
    if (event === 'change') {
        // Definition has changed, restart our server
        console.log('\nAPI definition changed, restarting server');
        restartServer(filename, program.port);
    }
});
