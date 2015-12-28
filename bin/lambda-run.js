"use strict";

const path = require('path');
const program = require('commander');
const swagger = require('swagger-parser');
const _ = require('lodash');
const colors = require('colors');

const parseEnvironment = require('./helpers/environment-parser.js');
const fsx = require('./helpers/fs-additions');
require('./helpers/string-additions');

const Integration = require('./runner/integration');
const Execution = require('./runner/execution');
const Responder = require('./runner/responder');

const parser = require('koa-body')();
const app = require('koa')();
const router = require('koa-router')();
const logger = require('koa-logger')();

//
//  Program specification
//

program
    .option('-p, --port <number>', 'Port to use locally')
    .option('-a, --api-file <file>', 'Path to Swagger API spec (defaults to "./api.json")')
    .option('-e, --environment <env>', 'Environment Variables to embed as key-value pairs', parseEnvironment)
    .parse(process.argv);

// Determine our target directory
program.directory = process.cwd();

// Default values for params
program.port = program.port || 3000;
program.environment = program.environment || {};
program.apiFile = path.resolve(program.directory, program.apiFile || './api.json');

// Parse API definition into a set of routes
swagger.validate(program.apiFile, function(err, api) {
    if (err) {
        console.log("Failed to validate Swagger API definition".red);
        console.error(err);
        process.exit();
    }

    // Our sort-of "middleware" for handling the Lambda integration
    // within the koa-router middleware
    const integrator = Integration(api);
    const responder = Responder(api);

    for (const p in api.paths) {
        const methods = api.paths[p];
        for (const method in methods) {
            // Convert path to be koa-router suitable (variables are listed differently)
            const parsedPath = p.replace(/\{([^\}\/]*)\}/g, ':$1');

            // We treat the router as a means to determine the correct Lambda
            // function and path, it doesn't actually execute the Lambda (which
            // will be left for middleware downstream)
            router[method](parsedPath, function *(next) {
                // The API path is known
                this.apiPath = p;
                this.program = program;

                // Derive the Lambda function file path (ignoring whether it exists or not)
                let lambdaPath = _.get(methods, [method, 'x-amazon-apigateway-integration', 'uri']);

                // Start building the context
                let context = { functionName: lambdaPath, invokedFunctionArn: '$LATEST', memoryLimitInMB: '1024', timeout: 6};

                if (lambdaPath.startsWith('$l')) {
                    lambdaPath = lambdaPath.slice(2);
                    lambdaPath = (lambdaPath.charAt(0).toLowerCase() + lambdaPath.substring(1)).toDashCase();
                    lambdaPath = path.resolve(program.directory, 'lambdas', lambdaPath);

                    // The path should be a directory
                    if (!fsx.directoryExists(lambdaPath)) {
                        this.throw(new Error('Incorrectly formatted Lambda at path - ' + path.relative(program.directory, lambdaPath)));
                    }

                    // There might be a custom configuration in that folder
                    const configurationFile = path.join(lambdaPath, 'cf.json');
                    let handler = 'index.handler';
                    if (fsx.fileExists(configurationFile)) {
                        const conf = fsx.readJSONFileSync(configurationFile);
                        handler = _.get(conf, ['Properties', 'Handler'], handler);
                        context.memoryLimitInMB = _.get(conf, ['Properties', 'MemorySize'], context.memoryLimitInMB);
                        context.timeout = _.get(conf, ['Properties', 'Timeout'], context.timeout);
                    }

                    lambdaPath = path.resolve(lambdaPath, handler);
                }

                console.log('\t--'.gray, 'Creating integration');
                const integration = yield integrator.bind(this);
                console.log('\t', JSON.stringify(integration, null, '\t').split('\n').join('\n\t'), '\n');

                // Extend context to give it the necessary functions
                // (done, fail, succeed, timeRemainingInMillis)
                // and include values derived by our integration step
                context = _.merge(context, integration.context);
                context.awsRequestId = context.requestId;

                console.log('\t--'.gray, 'Executing Lambda function');
                const result = yield Execution.bind(this, lambdaPath, integration.event, context);
                console.log('\t', 'Done');

                // Final step is to map the result back to a response
                const response = yield responder.bind(this, result);
                this.status = response.status;
                this.body = response.body;

                yield next;
            });
        }
    }

    app
        .use(function *(next) {
            try {
                yield next;
            } catch (err) {
                this.status = err.status || 500;
                this.body = err.message;
                console.error(err.stack);
                console.error(err.message);
            }
        })
        .use(logger)
        .use(parser)
        .use(router.routes())
        .use(router.allowedMethods());

    app.listen(program.port);
    console.log(("Server listening on " + program.port).green);
});
