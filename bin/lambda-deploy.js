"use strict";

require('../lib/helpers/string-additions');
const parseEnvironment = require('../lib/helpers/environment-parser');

const AWS = require('aws-sdk');
const chalk = require('chalk');
const path = require('path');
const program = require('commander');
const Promise = require('bluebird');
const prompt = require('readline-sync');
const rw = require('rainbow-word');
const _ = require('lodash');

const logger = require('../lib/helpers/logger').shared;

const setup = require('../lib/deploy/setup-step');
const processing = require('../lib/deploy/bundle-lambdas-step');
const deriveAPI = require('../lib/deploy/derive-api-step');
const deriveStack = require('../lib/deploy/derive-stack-step');
const fetchStack = require('../lib/deploy/fetch-stack-step');
const deployStack = require('../lib/deploy/update-stack-step');

//
//  Program specification
//

program
    .option('-n, --project-name <name>', 'Project name')
    .option('-s, --stage <stage>', 'Stage name', 'dev')
    .option('-r, --region <region>', 'Region', 'us-east-1')
    .option('-e, --environment <env>', 'Environment Variables to embed as key-value pairs', parseEnvironment, {})
    .option('--dry-run', 'Simply generate files that would be used to update the stack and API')
    .option('--exclude <list>', 'Packages to exclude from bundling', function(val) { return val.split(','); })
    .option('-o, --optimization <level>', 'Optimization level to use, valid values are 0-1', parseInt, 1)
    .parse(process.argv);

//
// Configure program
//

program.projectName = program.projectName || prompt.question('Please enter project name: ');

// Make region global for AWS
AWS.config.region = program.region;

// Carry over some stuff to environment
program.environment["AWS_REGION"] = program.region;
program.environment["AWS_STAGE"] = program.stage;
program.environment["AWS_PROJECT_NAME"] = program.projectName;

//
// Main logic
//
const context = {
    directories: {
        cwd: process.cwd(),
        root: path.join(path.resolve(__dirname), '../lib/deploy')
    },

    project: {
        name: program.projectName,
        stage: program.stage,
        region: program.region,
        timestamp: Math.floor(Date.now() / 1000)
    },

    program: _.pick(program, ['environment', 'stage', 'region', 'lambda', 'optimization', 'exclude']),
    logger: logger
};

// Setup step
let promise = new Promise(function(resolve) {
    const dryRunString = program.dryRun ? ' (dry run)' : '';

    logger.log(`Deploying ${chalk.underline(program.projectName)} ${chalk.underline(program.stage)} to ${chalk.underline(program.region)}${dryRunString}`);

    resolve(context);
}).then(setup);

// Process Lambdas
promise = promise.then(processing);

// // Derive API configuration and then stack one
// promise = promise.then(deriveAPI).then(deriveStack);
//
// // Deploying the stack (OPTIONAL)
// if (!program.dryRun) {
//     promise = promise.then(fetchStack).then(deployStack);
// }

promise.then(function() {
    const rainbow = rw.pattern();
    const hype = rainbow.convert('#lambdahype'.split(''));

    logger.log(`${chalk.bold('Deployment complete')} ${hype}`);
}).catch(function(error) {
    logger.error(chalk.bold.red('Deployment failed'), error.message, error.stack);
    process.exit(1);
});
