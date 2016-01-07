"use strict";

require('colors');
const _ = require('lodash');
const Promise = require('bluebird');
const cp = require('child_process');
const moment = require('moment');
const path = require('path');

module.exports = function *(lambdaPath, event, context) {
    const pathComponents = lambdaPath.split('.');
    let handlerFunction = 'handler';

    if (pathComponents[pathComponents.length - 1] !== 'js') {
        handlerFunction = pathComponents[pathComponents.length - 1];
        pathComponents[pathComponents.length - 1] = 'js';
    }

    const environment = this.program.environment;

    return new Promise(function(resolve) {
        const args = [pathComponents.join('.'), handlerFunction, JSON.stringify(event), context.timeout * 1000];

        const child = cp.fork(path.resolve(__dirname, './execution-wrapper'), args, {
            env: _.assign({ HOME: process.env.HOME, PATH: process.env.PATH, USER: process.env.USER }, environment),
            silent: true
        });

        let result = null;
        child.on('message', function(res) {
            result = res.result;
        });

        child.stdout.on('data', function(data) {
            const dateString = moment().format('DD-MM-YYYY HH:mm:ss.SSS');
            const logString = data.toString().split('\n').join('\n\t\t').trim();

            console.log(`\t\t[${dateString}]`.gray + ` - LOG: ${logString}`);
        });

        child.stderr.on('data', function(data) {
            const dateString = moment().format('DD-MM-YYYY HH:mm:ss.SSS');
            const logString = data.toString().split('\n').join('\n\t\t').trim();

            console.log(`\t\t[${dateString}]`.gray + ` - ERROR: ${logString}`);
        });

        child.on('exit', function() {
            resolve(result);
        });
    });
};
