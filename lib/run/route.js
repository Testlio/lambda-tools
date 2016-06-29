"use strict";

const chalk = require('chalk');
const path = require('path');
const _ = require('lodash');
const perfy = require('perfy');

const Integration = require('./integration');
const Execution = require('./execution');
const Responder = require('./responder');

const fsx = require('../helpers/fs-additions');

function lambdaRoute(apiDefinition, program) {
    return function *() {
        // Derive the Lambda function file path (ignoring whether it exists or not)
        let lambdaPath = _.get(apiDefinition, 'uri');

        // We can feed in some context data to execution. This will
        // be combined with some reasonable defaults
        const context = {};

        // Any assets that will get exposed to the Lambda function
        let assets = {};

        if (_.startsWith(lambdaPath, '$l')) {
            perfy.start('configuration');
            console.log(chalk.gray('\t<--'), 'Configuring Lambda function');
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

            lambdaPath = path.resolve(lambdaPath, handler);
            console.log(chalk.gray('\t-->'), 'Configuring Lambda function', chalk.gray(`${_.round(perfy.end('configuration').milliseconds)}ms\n`));
        }

        perfy.start('integration');
        console.log(chalk.gray('\t<--'), 'Creating integration');
        const integration = Integration(this, apiDefinition);
        console.log(`\t${JSON.stringify(integration, null, '\t').split('\n').join('\n\t')}`);
        console.log(chalk.gray('\t-->'), 'Creating integration', chalk.gray(`${_.round(perfy.end('integration').milliseconds, 0)}ms\n`));

        perfy.start('execution');
        console.log(chalk.gray('\t<--'), 'Executing Lambda function (' + path.relative(path.resolve(program.directory, 'lambdas'), lambdaPath) + ')\n');

        let result;
        try {
            result = yield Execution(lambdaPath, integration.event, context, program.environment, assets);
        } catch (error) {
            result = error.message;
        }

        console.log(chalk.gray('\t-->'), 'Executing Lambda function', chalk.gray(`${_.round(perfy.end('execution').milliseconds, 0)}ms\n`))

        // Final step is to map the result back to a response
        perfy.start('response');
        console.log(chalk.gray('\t<--'), 'Creating response');
        const response = Responder(this, apiDefinition, result);
        console.log(`\t${JSON.stringify(response, null, '\t').split('\n').join('\n\t')}`);
        console.log(chalk.gray('\t-->'), 'Creating response', chalk.gray(`${_.round(perfy.end('response').milliseconds, 0)}ms\n`));

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
        const response = Responder(this, apiDefinition, '{}');
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
