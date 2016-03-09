"use strict";

const AWS = require('aws-sdk');
const fs = require('fs');
const fsx = require('../helpers/fs-additions');
const path = require('path');
const Promise = require('bluebird');
const _ = require('lodash');

function fetchStackOutputs(context) {
    return new Promise(function(resolve, reject) {
        const stackName = context.stack.name;
        const CF = new AWS.CloudFormation({ apiVersion: '2010-05-15' });

        process.stdout.write('\tFetching stack outputs');
        CF.describeStacks({
            StackName: stackName
        }, function(err, result) {
            if (err) {
                console.log(' ✖'.red);
                return reject(err);
            }

            const stacks = result.Stacks;
            if (!stacks || stacks.length == 0) {
                console.log(' ✖'.red);
                return reject(new Error("No stacks"));
            }

            const matchingStack = stacks.find(function(stack) {
                return stack.StackName === stackName && stack.DeletionTime === undefined;
            });

            const newCtx = _.clone(context, true);
            newCtx.stack = _.assign({}, newCtx.stack, {
                outputs: matchingStack ? matchingStack.Outputs : []
            });

            console.log(' ✔'.green);
            resolve(newCtx);
        });
    });
}

function deriveAPISpec(context) {
    return new Promise(function(resolve, reject) {
        process.stdout.write('\tBuilding API spec');

        // Make sure the API spec exists
        const apiPath = path.join(context.directories.cwd, 'api.json');
        if (!fsx.fileExists(apiPath)) {
            console.log(' ✖'.red);
            return reject(new Error('Missing API spec in project root'));
        }

        console.log(' ✔'.green);

        // Load in the spec
        let api = fs.readFileSync(apiPath, 'utf8');

        // Replace all outputs in the API definition with their values
        context.stack.outputs.forEach(function(output) {
            const key = `\\$${output.OutputKey}`;
            const value = output.OutputValue;

            console.log('\t\t' + key.yellow + ' -> ' + value.yellow);
            const re = new RegExp(`"${key}"`, 'g');
            api = api.replace(re, `"${value}"`);
        });

        // Write the API to the staging directory
        const deploymentAPIPath = path.join(context.directories.staging, 'deployment.api.json');
        fs.writeFileSync(deploymentAPIPath, api);

        const newCtx = _.assign({}, context, {
            api: {
                configuration: deploymentAPIPath
            }
        });

        resolve(newCtx);
    });
}

//
// Step that fetches the outputs from the stack and completes
// the API spec in the context
//
module.exports = function(context) {
    return fetchStackOutputs(context).then(deriveAPISpec);
};
