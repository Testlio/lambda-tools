"use strict";

require('../lib/helpers/string-additions');
const parseEnvironment = require('../lib/helpers/environment-parser');

require('colors');
const AWS = require('aws-sdk');
const path = require('path');
const program = require('commander');
const Promise = require('bluebird');
const prompt = require('readline-sync');
const _ = require('lodash');

const setup = require('../lib/deploy/setup-step');
const processing = require('../lib/deploy/bundle-lambdas-step');
const deriveStack = require('../lib/deploy/derive-stack-step');
const fetchStack = require('../lib/deploy/fetch-stack-step');
const deployStack = require('../lib/deploy/update-stack-step');
const deriveAPI = require('../lib/deploy/derive-api-step');
const deployAPI = require('../lib/deploy/deploy-api-step');

//
//  Program specification
//

program
    .option('-n, --project-name <name>', 'Project name')
    .option('-s, --stage <stage>', 'Stage name', 'dev')
    .option('-r, --region <region>', 'Region', 'us-east-1')
    .option('-e, --environment <env>', 'Environment Variables to embed as key-value pairs', parseEnvironment, {})
    .option('--dry-run', 'Simply generate files that would be used to update the stack and API')
    .option('--skip-stack', 'Skip updating the stack')
    .option('--skip-api', 'Skip updating the API')
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

    program: _.pick(program, ['environment', 'stage', 'region', 'lambda', 'optimization', 'exclude'])
};

// Setup step
let promise = new Promise(function(resolve) {
    const dryRunString = program.dryRun ? ' (dry run)' : '';
    console.log('Deploying ' + program.projectName.underline + ' ' + program.stage.underline + ' to ' + program.region.underline + dryRunString);
    resolve(context);
}).then(setup).then(function(ctx) {
    console.log('Staging directory at ' + ctx.directories.staging);
    return ctx;
});

// Process Lambdas (OPTIONAL)
if (!program.skipStack) {
    promise = promise.then(processing);
}

// Derive stack configuration and fetch existing
promise = promise.then(deriveStack).then(fetchStack);

// Deploying to stack (OPTIONAL)
if (!program.skipStack && !program.dryRun) {
    promise = promise.then(deployStack);
}

// Derive API spec
promise = promise.then(deriveAPI);

// Deploying to API (OPTIONAL)
if (!program.skipApi && !program.dryRun) {
    promise = promise.then(deployAPI);
}

promise.then(function() {
    console.log('\nDeployment complete ' + '#lambdahype'.rainbow);
}).catch(function(error) {
    console.log('Deployment failed'.bold.red, error.stack);
    process.exit(1);
});
