"use strict";

const AWS = require('aws-sdk');
const chalk = require('chalk');
const fsx = require('../lib/helpers/fs-additions');
const path = require('path');
const parseEnvironment = require('../lib/helpers/environment-parser');
const program = require('commander');
const prompt = require('readline-sync');
const Promise = require('bluebird');
const os = require('os');
const _ = require('lodash');

const config = require('../lib/helpers/config');
const hype = require('../lib/helpers/lambdahype');
const logger = require('../lib/helpers/logger').shared;

const bundleLambdas = require('../lib/deploy/bundle-lambdas-step');
const updateLambdas = require('../lib/deploy/update-lambdas-step');

//
//  Program specification
//

program
    .description('Deploy code to a single Lambda function')
    .usage('[options] <function-name>')
    .option('-f, --file <file>', 'Lambda file location', './index.js')
    .option('-r, --region <region>', 'AWS region to work in')
    .option('-p, --publish', 'If set publishes a new version of the Lambda function')
    .option('-e, --environment <env>', 'Environment variables to make available in the Lambda function', parseEnvironment, {})
    .option('--dry-run', 'Simply packs the Lambda function into a minified zip')
    .option('--exclude [list]', 'Packages to exclude from bundling', function(value) { return value.split(','); })
    .option('--clean', 'Force a clean build where cached bundles are not used')
    .option('--no-color', 'Turn off ANSI coloring in output');

program.on('--help', function() {
    console.log();
    console.log('  Examples:');
    console.log();
    console.log('    Deploy function \'hello-world\' from default file (index.js)');
    console.log('    $ lambda deploy-single hello-world');
    console.log();
    console.log('    Deploy function \'foo\' with a handler from file \'./diverted.js\'');
    console.log('    $ lambda deploy-single foo -f ./diverted.js');
    console.log();
    console.log('    Deploy function \'foo\', also publishing a version');
    console.log('    $ lambda deploy-single foo --publish');
    console.log();
    console.log('    Deploy function \'foo\', excluding \'example\' package from bundle (included in ZIP separately)');
    console.log('    $ lambda deploy-single foo --exclude example');
    console.log();
    console.log('    Deploy function \'foo\', with NODE_ENV and FOO set');
    console.log('    $ lambda deploy-single foo -e NODE_ENV=production,FOO=bar');
    console.log();
});

program.parse(process.argv);

//
// Configure program
//

// Enable/Disable colors
chalk.enabled = program.color;

// Determine function name
program.functionName = program.args[0];
program.functionName = program.functionName || prompt.question('Please enter the name of the function you are deploying: ');

// Make region global for AWS
AWS.config.region = program.region || config.aws.region;
program.environment['AWS_REGION'] = program.region;

// Create context
const lambdaPath = path.resolve(process.cwd(), program.file);
const context = {
    directories: {
        cwd: process.cwd(),
        root: path.join(path.resolve(__dirname), '../lib/deploy'),
        staging: path.resolve(os.tmpdir(), `lambda-tools-single-${program.functionName}`)
    },

    lambdas: [{
        publish: program.publish,
        name: program.functionName,
        module: path.basename(lambdaPath, '.js'),
        handler: 'handler',
        path: lambdaPath
    }],

    program: _.pick(program, ['environment', 'stage', 'region', 'lambda', 'exclude', 'clean']),
    logger: logger
};

// Prepare staging directory
try {
    fsx.ensureDirectory(context.directories.staging);
} catch (error) {
    logger.error(error);
    process.exit(1);
}

// Bundle Lambda
let promise = new Promise(function(resolve) {
    logger.log('Deploying Lambda function "' + context.lambdas[0].name + '"' + (program.dryRun ? ' (dry run)' : ''));
    logger.log('Staging directory at ' + context.directories.staging);
    resolve(context);
}).then(bundleLambdas);

// Optionally update the code of the Lambdas on AWS
if (!program.dryRun) {
    promise = promise.then(updateLambdas);
}

promise.then(function() {
    logger.log(chalk.bold('Deployment complete'));
    logger.log(hype);
}).catch(function(err) {
    logger.error('Deployment failed'.bold.red, err.message, err.stack);
    process.exit(1);
});
