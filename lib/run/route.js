"use strict";

const chalk = require('chalk');
const path = require('path');
const _ = require('lodash');
const perfy = require('perfy');
const UUID = require('uuid');

const Integration = require('./integration');
const Execution = require('./execution');
const Responder = require('./responder');

const fsx = require('../helpers/fs-additions');

function startTime(key, name) {
    perfy.start(key);
    console.log(chalk.gray('\t<--'), name);
}

function endTime(key, name) {
    console.log(chalk.gray('\t-->'), name, chalk.gray(`${_.round(perfy.end(key).milliseconds)}ms\n`));
}

const lambdaRoute = (apiDefinition, program) => {
    return async function(self) {
        // Derive the Lambda function file path (ignoring whether it exists or not)
        let lambdaPath = _.get(apiDefinition, 'uri');

        // We can feed in some context data to execution. This will
        // be combined with some reasonable defaults
        const context = {};

        // For tracking purposes, create a request ID
        const key = UUID.v4();

        // Any assets that will get exposed to the Lambda function
        let assets = {};

        if (_.startsWith(lambdaPath, '$l')) {
            startTime(key, 'Configuring Lambda function');
            lambdaPath = lambdaPath.slice(2);
            lambdaPath = _.kebabCase(lambdaPath.charAt(0).toLowerCase() + lambdaPath.substring(1));
            lambdaPath = path.resolve(program.directory, 'lambdas', lambdaPath);

            // The path should be a directory
            if (!fsx.directoryExists(lambdaPath)) {
                self.throw(new Error('Incorrectly formatted Lambda at path - ' + path.relative(program.directory, lambdaPath)));
            }

            // There might be a custom configuration in that folder
            const configurationFile = path.join(lambdaPath, 'cf.json');
            let handler = 'index.handler';
            if (fsx.fileExists(configurationFile)) {
                const conf = fsx.readJSONFileSync(configurationFile);
                handler = _.get(conf, ['Properties', 'Handler'], handler);
                const memoryLimit = _.get(conf, ['Properties', 'MemorySize']);
                const timeout = _.get(conf, ['Properties', 'Timeout']);

                assets = _.assign(assets, _.get(conf, 'Assets', {}));

                if (memoryLimit) {
                    context.memoryLimitInMB = memoryLimit;
                }

                if (timeout) {
                    context.timeout = timeout;
                }
            }

            // If we need to tweak the timeout
            // (overrides any potential configuration)
            if (program.ignoreTimeout) {
                // Ignored timeouts
                context.timeout = 0;
            } else if (program.timeout) {
                // Fixed timeouts
                context.timeout = program.timeout;
            }

            lambdaPath = path.resolve(lambdaPath, handler);
            endTime(key, 'Configuring Lambda function');
        }

        startTime(key, 'Creating integration');
        const integration = Integration(self, apiDefinition);
        console.log(`\t${JSON.stringify(integration, null, '\t').split('\n').join('\n\t')}`);
        endTime(key, 'Creating integration');

        startTime(key, `Executing Lambda (${path.relative(path.resolve(program.directory, 'lambdas'), lambdaPath)})\n`);

        let result;
        try {
            result = await Execution(lambdaPath, integration.event, context, program.environment, assets);
        } catch (error) {
            result = error.message;
        }

        endTime(key, 'Executing Lambda function');

        // Final step is to map the result back to a response
        startTime(key, 'Creating response');
        const response = Responder(self, apiDefinition, result);
        console.log(`\t${JSON.stringify(response, null, '\t').split('\n').join('\n\t')}`);
        endTime(key, 'Creating response');

        self.response.status = response.status;
        self.response.type = response.type;
        self.response.body = response.body;
        self.set(response.headers);
    };
};

function mockRoute(apiDefinition) {
    return async function(self) {
        // Final step is to map the result back to a response
        console.log(chalk.gray('\t--'), 'Creating mock response');
        const response = Responder(self, apiDefinition, '{}');
        self.response.status = response.status;
        self.response.type = response.type;
        self.response.body = response.body;
        self.set(response.headers);
    };
}

//
//  Route handler middleware
//

module.exports = (apiDefinition, program) => {
    // Handle the route based on the configuration
    if (apiDefinition.type === 'mock') {
        return mockRoute(apiDefinition);
    } else if (apiDefinition.type === 'aws') {
        // Lambda function
        return lambdaRoute(apiDefinition, program);
    } else {
        return async function() {
            // Ignore, but log out
            console.log('Unhandled API Gateway integration type', apiDefinition.type);
        };
    }
};
