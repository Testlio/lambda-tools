"use strict";

const chalk = require('chalk');
const fsx = require('../lib/helpers/fs-additions');
const program = require('commander');
const parseEnvironment = require('../lib/helpers/environment-parser.js');
const parsePath = require('../lib/helpers/path-parser.js');
const path = require('path');
const logger = require('../lib/helpers/logger.js').shared;
const config = require('../lib/helpers/config.js');
const _ = require('lodash');

const Execution = require('../lib/run/execution');
const cwd = process.cwd();

//
//  Program specification
//

program
    .usage('[options] <lambda-file>')
    .option('-e, --event <file>', 'Path to the event JSON file, defaults to \'event.json\'', parsePath, 'event.json')
    .option('--env, --environment <env>', 'Environment Variables to embed as key-value pairs', parseEnvironment, {})
    .option('--timeout <timeout>', 'Timeout value for the Lambda function', parseInt)
    .option('--ignore-timeout', 'Ignore Lambda function timeout')
    .option('--no-color', 'Turn off ANSI coloring in output');

program.on('--help', function() {
    console.log();
    console.log('  Examples:');
    console.log();
    console.log('    Execute function from file index.js with the default event');
    console.log('    $ lambda execute ./index.js');
    console.log();
    console.log('    Exceute function named \'foo\' from current service');
    console.log('    $ lambda execute foo');
    console.log();
    console.log('    Execute function \'foo\' from current service with specific event file');
    console.log('    $ lambda execute foo -e ../event.json');
    console.log();
    console.log('    Execute function from index.js with environment variables NODE_ENV and FOO set');
    console.log('    $ lambda execute index.js --env NODE_ENV=test,FOO=bar');
    console.log();
    console.log('    Execute function \'foo\' with a custom timeout of 60s');
    console.log('    $ lambda execute foo --timeout 60');
    console.log();
    console.log('    Execute function \'foo\' with no timeout');
    console.log('    $ lambda execute foo --ignore-timeout');
    console.log();
});

program.parse(process.argv);

// Enable/Disable colors
chalk.enabled = program.color;

// Carry over some stuff to environment
if (config.aws.region && !program.environment["AWS_REGION"]) {
    program.environment["AWS_REGION"] = config.aws.region;
}

if (config.aws.stage && !program.environment["AWS_STAGE"]) {
    program.environment["AWS_STAGE"] = config.aws.stage;
}

if (config.project.name && !program.environment["AWS_PROJECT_NAME"]) {
    program.environment["AWS_PROJECT_NAME"] = config.project.name;
}

// Keep track of any assets we want to expose to our Lambda function
let assets = {};

// Check if we were given a Lambda function. Steps for searching are:
// 1. If provided string is a file in current directory, it'll be used
// 2. If provided string matches a directory in CWD/lambdas/<string>, then that Lambda will be executed
// 3. If nothing was provided, default to using CWD/index.js

if (program.args.length === 0) {
    // Default to using trying index.js in CWD
    program.directory = cwd;
    program.file = path.resolve(cwd, 'index.js');
} else {
    // Check if the passed in file already exists in CWD
    const proposedFile = path.resolve(cwd, program.args[0]);
    if (fsx.fileExists(proposedFile)) {
        program.directory = path.dirname(proposedFile);
        program.file = proposedFile;
    } else {
        // Doesn't exist, look for CWD/lambdas/<string>
        const proposedDir = path.resolve(cwd, 'lambdas', program.args[0]);
        if (fsx.directoryExists(proposedDir)) {
            program.directory = proposedDir;

            // Check if cf.json exists, if so, then we can grab the handler file name from there
            const propertiesFile = path.resolve(proposedDir, 'cf.json');
            if (fsx.fileExists(propertiesFile)) {
                const handlerFile = fsx.readJSONFileSync(propertiesFile);
                const handler = _.get(handlerFile, 'Properties.Handler', 'index.handler');

                if (_.isUndefined(program.timeout)) {
                    program.timeout = parseInt(_.get(handlerFile, 'Properties.Timeout'), 10);
                }

                assets = _.get(handlerFile, 'Assets', {});

                program.file = path.resolve(proposedDir, handler.split('.')[0] + '.js');
            } else {
                // Assume it to be index.js
                program.file = path.resolve(proposedDir, 'index.js');
            }
        } else {
            // Error out
            console.error('No such Lambda function, aborting execution');
            process.exit(1);
        }
    }
}

// Determine the final timeout (if ignored, then ignore, otherwise make sure
// some meaningful default is in place if the function configuration/option didn't
// specify anything)
if (program.ignoreTimeout) {
    program.timeout = 0;
} else if (_.isUndefined(program.timeout)) {
    program.timeout = 6;
}

// Load event (if one was provided or exists at CWD/event.json)
let eventPath = path.resolve(program.directory, program.event);
let event = {};
if (fsx.fileExists(eventPath)) {
    try {
        event = fsx.readJSONFileSync(eventPath);
    } catch (err) {
        console.error(`Failed to load event file ${eventPath}`, err.message, err.stack);
    }
} else {
    // Try to load event.json from current directory
    eventPath = path.resolve(cwd, program.event);
    if (fsx.fileExists(eventPath)) {
        try {
            event = fsx.readJSONFileSync(eventPath);
        } catch (err) {
            // Ignore
        }
    }
}

// We know the requested timeout, send that along to execution
const context = {
    timeout: program.timeout
};

logger.task(`Executing: ${chalk.underline(program.file)}`, function(resolve, reject) {
    logger.log(chalk.gray('--'));
    logger.log('With event:');
    logger.log(`${JSON.stringify(event, null, '\t').split('\n').join('\n\t')}`);
    logger.log(chalk.gray('--\n'));

    const promise = Execution(program.file, event, context, program.environment, assets).next().value;
    promise.then(function(result) {
        logger.log(chalk.gray('--'));
        logger.log(`Result '${result}'\n`);
        resolve(result);
    }, function(err) {
        logger.log(chalk.gray('--'));
        logger.error(`Failed '${err.message}'\n`);
        reject(err);
    });
}).catch(function() {
    // Ignore, here so that we don't get unhandled rejection errors
});
