"use strict";

const path = require('path');
const colors = require('colors');
const _ = require('lodash');

const Integration = require('./integration');
const Execution = require('./execution');
const Responder = require('./responder');

const fsx = require('../helpers/fs-additions');
require('../helpers/string-additions');

//
//  Route handler middleware
//

module.exports = function(apiDefinition, program) {
    return function *(next) {
        // Bind the arguments we received
        this.program = program;

        // Derive the Lambda function file path (ignoring whether it exists or not)
        let lambdaPath = _.get(apiDefinition, 'uri');

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
        const integration = yield Integration.bind(this, apiDefinition);
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
        const response = yield Responder.bind(this, apiDefinition, result);
        this.status = response.status;
        this.body = response.body;

        yield next;
    }
};
