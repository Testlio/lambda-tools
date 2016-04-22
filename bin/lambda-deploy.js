"use strict";

const parseEnvironment = require('../lib/helpers/environment-parser');

const AWS = require('aws-sdk');
const chalk = require('chalk');
const path = require('path');
const program = require('commander');
const Promise = require('bluebird');
const prompt = require('readline-sync');
const _ = require('lodash');

const config = require('../lib/helpers/config');
const hype = require('../lib/helpers/lambdahype');
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
    .option('-s, --stage <stage>', 'Stage name')
    .option('-r, --region <region>', 'Region')
    .option('-e, --environment <env>', 'Environment Variables to embed as key-value pairs', parseEnvironment, {})
    .option('--dry-run', 'Simply generate files that would be used to update the stack and API')
    .option('--exclude [list]', 'Packages to exclude from bundling', function(val) { return val.split(','); })
    .option('-o, --optimization <level>', 'Optimization level to use, valid values are 0-1', parseInt, 1)
    .option('--clean', 'Force a clean build where cached bundles are not used')
    .option('--no-color', 'Turn off ANSI coloring in output');

program.on('--help', function() {
    console.log();
    console.log('  Examples:');
    console.log();
    console.log('    Generate deployment files (in staging directory), but don\'t actually deploy');
    console.log('    $ lambda deploy --dry-run');
    console.log();
    console.log('    Deploy to \'prod\' stage with NODE_ENV set to \'production\' and FOO set to \'bar\'');
    console.log('    $ lambda deploy -s prod -e NODE_ENV=production,FOO=bar');
    console.log();
    console.log('    Deploy to default (dev) stage excluding \'example\' package from the bundle (included in the ZIP separately)');
    console.log('    $ lambda deploy --exclude example');
    console.log();
    console.log('    Deploy to default stage, ignoring cached bundles and disabling minification');
    console.log('    $ lambda deploy --clean --optimization 0');
    console.log();
});

program.parse(process.argv);

//
// Configure program
//

// Enable/Disable colors
chalk.enabled = program.color;

// Finalise configuration
program.region = program.region || config.aws.region;
program.stage = program.stage || config.aws.stage;
program.projectName = program.projectName || config.project.name || prompt.question('Please enter project name: ');

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

    program: _.pick(program, ['environment', 'stage', 'region', 'lambda', 'optimization', 'exclude', 'clean']),
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

// Derive API configuration and then stack one
promise = promise.then(deriveAPI).then(deriveStack);

// Deploying the stack (OPTIONAL)
if (!program.dryRun) {
    promise = promise.then(fetchStack).then(deployStack);
}

promise.then(function() {
    logger.log(chalk.bold('Deployment complete'));
    logger.log(hype);
}).catch(function(error) {
    logger.error(chalk.bold.red('Deployment failed'), error.message, error.stack);
    process.exit(1);
});
