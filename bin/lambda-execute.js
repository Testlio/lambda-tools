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
    .option('-t, --timeout <timeout>', 'Timeout value for the Lambda function', 6)
    .option('--no-color', 'Turn off ANSI coloring in output')
    .parse(process.argv);

// Enable/Disable colors
chalk.enabled = program.color;

// Carry over some stuff to environment
if (config.aws.region && !program.environment["AWS_REGION"]) {
    program.environment["AWS_REGION"] = config.aws.region;
}

if (config.aws.stage && !program.environment["AWS_REGION"]) {
    program.environment["AWS_STAGE"] = config.aws.stage;
}

if (config.project.name && !program.environment["AWS_PROJECT_NAME"]) {
    program.environment["AWS_PROJECT_NAME"] = config.project.name;
}

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

const context = {
    functionName: path.basename(program.file),
    invokedFunctionArn: '$LATEST',
    memoryLimitInMB: '1024',
    timeout: program.timeout
};

logger.task(`Executing: ${chalk.underline(program.file)}`, function(resolve, reject) {
    logger.log(chalk.gray('--'));
    logger.log('With event:');
    logger.log(`${JSON.stringify(event, null, '\t').split('\n').join('\n\t')}`);
    logger.log(chalk.gray('--\n'));

    const promise = Execution(program.file, event, context, program.environment).next().value;
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
