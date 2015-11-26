#!/usr/bin/env node

"use strict";

require('./helpers/string_additions');

const setup             = require('./steps/setup');
const processLambdas    = require('./steps/process-lambdas');
const deployStack       = require('./steps/deploy-stack');
const getStackOutputs   = require('./steps/get-outputs-stack');
const deployAPI         = require('./steps/deploy-api');

const path          = require('path');
const program       = require('commander');
const prompt        = require('readline-sync');
const colors        = require('colors');
const fs            = require('fs');
const AWS           = require('aws-sdk');
const sync          = require('synchronize');
const merge         = require('deepmerge');
const async         = require('async');

//
//  Helpers
//

function parseEnvironment(value) {
    // Split on unescaped commas first
    let pairs = [];

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
    let result = {};
    pairs.forEach(function(pair) {
        let match = pair.match(/(?:[^\\])=/);

        if (match) {
            let key = pair.substring(0, match.index + 1).replace(/\\(.)/g, "$1");
            let value = pair.substring(match.index + 2).replace(/\\(.)/g, "$1");

            result[key] = value;
        }
    });

    return result;
}

//
//  Program specification
//

program
    .version('0.1')
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
let workingDirectory = path.resolve(__dirname);

async.waterfall(
    [
        function(callback) {
            console.log(colors.underline('Deploying ' + program.projectName.yellow + ' to ' + program.stage.yellow + ' in ' + program.region.yellow + '\n'));
            setup(program, workingDirectory, function(err, result) {
                callback(err, program, result);
            });
        },

        function(program, configuration, callback) {
            console.log('Processing Lambdas\n'.underline);
            processLambdas(program, configuration, function(err) {
                callback(err, program, configuration);
            });
        },

        function(program, configuration, callback) {
            if (program.skipStack) {
                console.log('Skipping stack update\n'.underline);
                callback(null, program, configuration);
            } else {
                console.log('Updating stack\n'.underline);
                deployStack(program, configuration, function(err) {
                    callback(err, program, configuration);
                });
            }
        },

        function(program, configuration, callback) {
            console.log('Grabbing stack details\n'.underline);
            getStackOutputs(program, configuration, function(err, outputs) {
                callback(err, program, configuration, outputs);
            });
        },

        function(program, configuration, stackOutputs, callback) {
            console.log('Deploying API\n'.underline);
            deployAPI(program, configuration, stackOutputs, function(err) {
                callback(err, program, configuration);
            });
        }
    ],

    function(error, result) {
        if (!error) {
            console.log('\nDeployed - ' + '#lambdahype'.rainbow);
        } else {
            console.error("\nFailed to deploy".bold.red, error, error.stack);
        }
    }
);
