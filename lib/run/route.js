"use strict";

const chalk = require('chalk');
const path = require('path');
const _ = require('lodash');

const Integration = require('./integration');
const Execution = require('./execution');
const Responder = require('./responder');

const fsx = require('../helpers/fs-additions');

function lambdaRoute(apiDefinition, program) {
    return function *() {
        // Derive the Lambda function file path (ignoring whether it exists or not)
        let lambdaPath = _.get(apiDefinition, 'uri');

        // Start building the context
        let context = { functionName: lambdaPath, invokedFunctionArn: '$LATEST', memoryLimitInMB: '1024', timeout: 6};

        if (_.startsWith(lambdaPath, '$l')) {
            lambdaPath = lambdaPath.slice(2);
            lambdaPath = _.kebabCase(lambdaPath.charAt(0).toLowerCase() + lambdaPath.substring(1));
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

        console.log(chalk.gray('\t--'), 'Creating integration');
        const integration = Integration(this, apiDefinition);
        console.log('Integration', integration);
        console.log(`\t${JSON.stringify(integration, null, '\t').split('\n').join('\n\t')}\n`);

        // Extend context to give it the necessary functions
        // (done, fail, succeed, timeRemainingInMillis)
        // and include values derived by our integration step
        context = _.merge(context, integration.context);
        context.awsRequestId = context.requestId;

        console.log(chalk.gray('\t--'), 'Executing Lambda function (' + path.relative(path.resolve(program.directory, 'lambdas'), lambdaPath) + ')');
        console.log(`\t${JSON.stringify(integration.event, null, '\t').split('\n').join('\n\t')}\n`);

        let result;
        try {
            result = yield Execution(lambdaPath, integration.event, context, program.environment);
        } catch (error) {
            result = error.message;
        }

        // Final step is to map the result back to a response
        console.log(chalk.gray('\t--'), 'Creating response');
        const response = Responder(this, apiDefinition, result);
        this.response.status = response.status;
        this.response.type = response.type;
        this.response.body = response.body;
        this.set(response.headers);
    };
}

function mockRoute(apiDefinition) {
    return function *() {
        // Final step is to map the result back to a response
        console.log(chalk.gray('\t--'), 'Creating mock response');
        const response = yield Responder.bind(this, apiDefinition, '{}');
        this.response.status = response.status;
        this.response.type = response.type;
        this.response.body = response.body;
        this.set(response.headers);
    };
}

//
//  Route handler middleware
//

module.exports = function(apiDefinition, program) {
    // Handle the route based on the configuration
    if (apiDefinition.type === 'mock') {
        return mockRoute(apiDefinition);
    } else if (apiDefinition.type === 'aws') {
        // Lambda function
        return lambdaRoute(apiDefinition, program);
    } else {
        return function *() {
            // Ignore, but log out
            console.log('Unhandled API Gateway integration type', apiDefinition.type);
        };
    }
};
