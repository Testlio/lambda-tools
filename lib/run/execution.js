"use strict";

const chalk = require('chalk');
const _ = require('lodash');
const Promise = require('bluebird');
const cp = require('child_process');
const moment = require('moment');
const path = require('path');
const uuid = require('uuid');

const fs = require('fs-extra');

// Helper function for capturing the state of a directory
function getDirectoryTree(dir) {
    const items = [];
    return new Promise(function(resolve) {
        fs.walk(dir)
        .on('data', function (item) {
            items.push(item.path);
        })
        .on('end', function () {
            resolve(items);
        });
    });
}

module.exports = async(lambdaPath, event, context, environment, assets) => {
    const pathComponents = lambdaPath.split('.');
    const name = path.basename(path.dirname(lambdaPath));
    let handlerFunction = 'handler';

    assets = assets || {};

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

    // Capture the state of the Lambda function directory before running
    // This allows us to clean up all files etc that were generated during execution
    // The idea behind this is simple, Lambda should not carry state between
    // executions.
    const directory = path.dirname(lambdaPath);

    return getDirectoryTree(directory).then(function(tree) {
        // If there are any assets, make sure to create them
        _.forOwn(assets, function(src, dst) {
            src = path.resolve(directory, src);
            dst = path.resolve(directory, dst);

            try {
                fs.ensureSymlinkSync(src, dst);
            } catch (e) {
                // Ignore
            }
        });

        // Grab the difference (i.e all the paths that were created
        // as part of the symlinking process)
        return getDirectoryTree(directory).then(function(newTree) {
            return _.difference(newTree, tree);
        });
    })
    .then(function(filesToCleanup) {
        return new Promise(function(resolve, reject) {
            const args = [pathComponents.join('.'), handlerFunction, JSON.stringify(event), JSON.stringify(context), context.timeout * 1000];

            const child = cp.fork(path.resolve(__dirname, './execution-wrapper'), args, {
                cwd: directory,
                env: _.assign({ HOME: process.env.HOME, PATH: process.env.PATH, USER: process.env.USER }, environment),
                silent: true
            });

            // We want to keep track of the "result" of the Lambda function
            let result = null;

            // Enforce timeout of the child process (if needed)
            let watchdog = undefined;

            if (context.timeout) {
                watchdog = setTimeout(function() {
                    // If this was fired, the process did not exit on time
                    // Result should be an error and the process should be killed
                    result = {
                        type: 'error',
                        result: new Error('Execution timed out after ' + context.timeout + ' seconds')
                    };

                    // SIGTERM (should suffice)
                    child.kill();
                }, context.timeout * 1000);
            }

            // If we receive any messages from the child, then those are
            // interpreted as results (incl. errors)
            child.on('message', function(res) {
                result = res;
            });

            // Piping through logging from the child process
            child.stdout.on('data', function(data) {
                const dateString = moment().format('DD-MM-YYYY HH:mm:ss.SSS');
                const logString = data.toString().split('\n').join('\n\t\t').trim();

                console.log(`\t${chalk.gray('[' + dateString + ' ' + context.awsRequestId + ']')} ${logString}`);
            });

            child.stderr.on('data', function(data) {
                const dateString = moment().format('DD-MM-YYYY HH:mm:ss.SSS');
                const logString = data.toString().split('\n').join('\n\t\t').trim();

                console.log(`\t${chalk.gray('[' + dateString + ' ' + context.awsRequestId + ']')} ERROR: ${chalk.red(logString)}`);
            });

            // Handling the termination of the child process
            child.on('exit', function() {
                console.log('');
                clearTimeout(watchdog);

                if (!result) {
                    return reject(new Error('Execution did not produce a result'));
                }

                if (result.type === 'error') {
                    reject(new Error(result.result));
                } else {
                    resolve(result.result);
                }
            });
        }).then(function(result) {
            // Clean up after ourselves
            filesToCleanup.forEach(function(location) {
                fs.removeSync(location);
            });

            return result;
        }, function(error) {
            // Clean up after ourselves
            filesToCleanup.forEach(function(location) {
                fs.removeSync(location);
            });

            throw error;
        });
    });
};
