"use strict";

const _ = require('lodash');
const Promise = require('bluebird');
const reRequire = require('re-require-module').reRequire;

module.exports = function *(lambdaPath, event, context) {
    const pathComponents = lambdaPath.split('.');
    let handlerFunction = 'handler';

    if (pathComponents[pathComponents.length - 1] !== 'js') {
        handlerFunction = pathComponents[pathComponents.length - 1];
        pathComponents[pathComponents.length - 1] = 'js';
    }

    context.lambda = {
        file: pathComponents.join('.'),
        handler: handlerFunction
    };

    const environment = this.program.environment;

    return new Promise(function(resolve) {
        // Capture environment to return to later
        const oldEnvironment = process.env;

        // Watchdog (timeouts are observed, process exits not)
        const timeout = setTimeout(function() {
            // Resolve with an error message
            context.fail(new Error('Function timed out'));
        }, context.timeout * 1000);

        // Actual context completion handlers
        context.done = function(error, result) {
            clearTimeout(timeout);

            // Restore environment
            process.env = oldEnvironment;

            if (error) {
                resolve(error.message);
            } else {
                resolve(JSON.stringify(result));
            }
        }.bind(this);

        context.fail = function(error) {
            this.done(error, null);
        }.bind(context);

        context.succeed = function(result) {
            this.done(null, result);
        }.bind(context);

        // Overwrite environment
        process.env = _.assign({}, process.env, environment);

        // This is not particularly safe, but it is applicable to assume
        // the caller is intimately familar with the functions they are
        // about to execute
        const handler = reRequire(context.lambda.file)[context.lambda.handler];
        handler(event, context);
    });
};
