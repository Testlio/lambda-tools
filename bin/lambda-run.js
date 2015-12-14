"use strict";

const path = require('path');
const program = require('commander');
const swagger = require('swagger-parser');
const _ = require('lodash');

const fsx = require('./helpers/fs_additions');
require('./helpers/string_additions');

const Integration = require('./runner/integration');
const Execution = require('./runner/execution');

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
    .parse(process.argv);

// Determine our target directory
program.directory = process.cwd();

// Default values for params
program.port = program.port || 3000;
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

                const integration = yield integrator.bind(this);

                // Extend context to give it the necessary functions
                // (done, fail, succeed, timeRemainingInMillis)
                // and include values derived by our integration step
                context = _.merge(context, integration.context);
                context.awsRequestId = context.requestId;

                const result = yield Execution.bind(this, lambdaPath, integration.event, context);
                console.log('Result', result);

                this.status = 200;
                this.body = {
                    request: this.request,
                    response: this.response
                };

                yield next;
            });
        }
    }

    app
        .use(logger)
        .use(parser)
        .use(router.routes())
        .use(router.allowedMethods());

    app.listen(program.port);
    console.log(("Server listening on " + program.port).green);
});
