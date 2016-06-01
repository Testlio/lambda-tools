"use strict";

const chalk = require('chalk');
const _ = require('lodash');
const Promise = require('bluebird');
const cp = require('child_process');
const moment = require('moment');
const path = require('path');
const uuid = require('node-uuid');

module.exports = function *(lambdaPath, event, context, environment) {
    const pathComponents = lambdaPath.split('.');
    const name = path.basename(path.dirname(lambdaPath));
    let handlerFunction = 'handler';

    if (pathComponents[pathComponents.length - 1] !== 'js') {
        handlerFunction = pathComponents[pathComponents.length - 1];
        pathComponents[pathComponents.length - 1] = 'js';
    }

    // Reasonable default values for context
    context = _.assign({
        timeout: 6,
        functionName: name,
        functionVersion: '$LATEST',
        invokedFunctionArn: `arn:lt:lambda:${name}/$LATEST`,
        memoryLimitInMB: 256,
        awsRequestId: uuid.v4(),
        logGroupName: 'local',
        logStreamName: '',
        identity: null,
        clientContext: null
    }, context);

    return new Promise(function(resolve, reject) {
        const args = [pathComponents.join('.'), handlerFunction, JSON.stringify(event), JSON.stringify(context), context.timeout * 1000];

        const child = cp.fork(path.resolve(__dirname, './execution-wrapper'), args, {
            env: _.assign({ HOME: process.env.HOME, PATH: process.env.PATH, USER: process.env.USER }, environment),
            silent: true
        });

        let result = null;
        child.on('message', function(res) {
            result = res;
        });

        child.stdout.on('data', function(data) {
            const dateString = moment().format('DD-MM-YYYY HH:mm:ss.SSS');
            const logString = data.toString().split('\n').join('\n\t\t').trim();

            console.log(`\t${chalk.gray('[' + dateString + ']')} ${logString}`);
        });

        child.stderr.on('data', function(data) {
            const dateString = moment().format('DD-MM-YYYY HH:mm:ss.SSS');
            const logString = data.toString().split('\n').join('\n\t\t').trim();

            console.log(`\t${chalk.gray('[' + dateString + ']')} ERROR: ${chalk.red(logString)}`);
        });

        child.on('exit', function() {
            console.log('');
            if (result.type === 'error') {
                reject(new Error(result.result));
            } else {
                resolve(result.result);
            }
        });
    });
};
