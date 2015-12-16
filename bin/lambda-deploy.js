"use strict";

require('./helpers/string_additions');

const setup             = require('./deploy/steps/setup');
const processLambdas    = require('./deploy/steps/process-lambdas');
const deployStack       = require('./deploy/steps/deploy-stack');
const getStackOutputs   = require('./deploy/steps/get-outputs-stack');
const deployAPI         = require('./deploy/steps/deploy-api');

const path          = require('path');
const program       = require('commander');
const prompt        = require('readline-sync');
const colors        = require('colors');
const AWS           = require('aws-sdk');
const async         = require('async');

//
//  Helpers
//

function parseEnvironment(value) {
    // Split on unescaped commas first
    const pairs = [];

    let previousIndex = 0;
    value.replace(/(\\)?,/g, function(match, slash, index) {
        if (!slash) {
            pairs.push(value.substring(previousIndex, index));
            previousIndex = index + match.length;
        }

        return match;
    });
    pairs.push(value.substring(previousIndex));

    // Then split all the pairs on unescaped = signs
    const result = {};
    pairs.forEach(function(pair) {
        const match = pair.match(/(?:[^\\])=/);

        if (match) {
            const key = pair.substring(0, match.index + 1).replace(/\\(.)/g, "$1");
            const val = pair.substring(match.index + 2).replace(/\\(.)/g, "$1");

            result[key] = val;
        }
    });

    return result;
}

//
//  Program specification
//

program
    .option('-n, --project-name <name>', 'Project name')
    .option('-s, --stage <stage>', 'Stage name')
    .option('-r, --region <region>', 'Region')
    .option('-e, --environment <env>', 'Environment Variables to embed as key-value pairs', parseEnvironment)
    .option('--dry-run', 'Simply generate files that would be used to update the stack and API')
    .option('--skip-stack', 'Skip updating the stack')
    .option('--skip-api', 'Skip updating the API')
    .parse(process.argv);

//
// Actual meat of the script
//

program.projectName = program.projectName || prompt.question('Please enter project name: ');
program.environment = program.environment || {};
program.stage = program.stage ? program.stage.sanitise() : 'dev';
program.region = program.region || 'us-east-1';

// Make region global for AWS
AWS.config.region = program.region;

// Carry over some stuff to environment
program.environment["AWS_REGION"] = program.region;
program.environment["AWS_STAGE"] = program.stage;
program.environment["AWS_PROJECT_NAME"] = program.projectName;

// Flatten to a string
program.flatEnvironment = Object.keys(program.environment).reduce(function(current, key) {
    return current + key + '=' + program.environment[key] + '\n';
}, '');

//
//  Actual content of the script
//
const workingDirectory = path.join(path.resolve(__dirname), 'deploy');

async.waterfall(
    [
        function(callback) {
            console.log(colors.underline('Deploying ' + program.projectName.yellow + ' to ' + program.stage.yellow + ' in ' + program.region.yellow + '\n'));
            setup(program, workingDirectory, function(err, result) {
                callback(err, program, result);
            });
        },

        function(prog, configuration, callback) {
            console.log('Processing Lambdas\n'.underline);
            processLambdas(prog, configuration, function(err) {
                callback(err, prog, configuration);
            });
        },

        function(prog, configuration, callback) {
            if (prog.skipStack) {
                console.log('Skipping stack update\n'.underline);
                callback(null, prog, configuration);
            } else {
                console.log('Updating stack\n'.underline);
                deployStack(prog, configuration, function(err) {
                    callback(err, prog, configuration);
                });
            }
        },

        function(prog, configuration, callback) {
            console.log('Grabbing stack details\n'.underline);
            getStackOutputs(prog, configuration, function(err, outputs) {
                callback(err, prog, configuration, outputs);
            });
        },

        function(prog, configuration, stackOutputs, callback) {
            console.log('Deploying API\n'.underline);
            deployAPI(prog, configuration, stackOutputs, function(err) {
                callback(err, prog, configuration);
            });
        }
    ],

    function(error) {
        if (!error) {
            console.log('\nDeployed - ' + '#lambdahype'.rainbow);
        } else {
            console.error("\nFailed to deploy".bold.red, error, error.stack);
        }
    }
);
