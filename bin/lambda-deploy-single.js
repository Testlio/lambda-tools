"use strict";

const AWS = require('aws-sdk');
const fsx = require('../lib/helpers/fs-additions');
const path = require('path');
const parseEnvironment = require('../lib/helpers/environment-parser');
const program = require('commander');
const prompt = require('readline-sync');
const Promise = require('bluebird');
const _ = require('lodash');

require('colors');

const bundleLambdas = require('../lib/deploy/bundle-lambdas-step');
const updateLambdas = require('../lib/deploy/update-lambdas-step');

//
//  Program specification
//

program
    .description('Deploy code to a single Lambda function')
    .option('-n, --function-name <name>', 'Function name')
    .option('-f, --file <file>', 'Lambda file location')
    .option('-r, --region <region>', 'AWS region to work in')
    .option('-p, --publish', 'If set publishes a new version of the Lambda function')
    .option('-e, --environment <env>', 'Environment variables to make available in the Lambda function', parseEnvironment)
    .option('--dry-run', 'Simply packs the Lambda function into a minified zip')
    .parse(process.argv);

//
// Configure program
//

program.functionName = program.functionName || prompt.question('Please enter the file containing the Lambda function: ');
program.environment = program.environment || {};
program.region = program.region || 'us-east-1';

// Make region global for AWS
AWS.config.region = program.region;
program.environment['AWS_REGION'] = program.region;

// Create context
const lambdaPath = path.resolve(process.cwd(), program.file);
const context = {
    directories: {
        cwd: process.cwd(),
        root: path.join(path.resolve(__dirname), '../lib/deploy'),
        staging: path.join(path.resolve(__dirname), '../lib/deploy', 'lambda_stage')
    },

    lambdas: [{
        publish: program.publish,
        name: program.functionName,
        module: path.basename(lambdaPath, '.js'),
        handler: 'handler',
        path: lambdaPath
    }],

    program: _.pick(program, ['environment', 'stage', 'region', 'lambda'])
};

// Prepare staging directory
try {
    fsx.recreateDirectory(context.directories.staging);
} catch (error) {
    console.error(error);
    process.exit(1);
}

// Bundle Lambda
let promise = bundleLambdas(context);

// Optionally update the code of the Lambdas on AWS
if (!program.dryRun) {
    promise = promise.then(updateLambdas);
}

promise.then(function() {
    console.log('\nDeployment complete ' + '#lambdahype'.rainbow);
}).catch(function(err) {
    console.log('Deployment failed'.bold.red, err.stack);
    process.exit(1);
});
