"use strict";

const AWS = require('aws-sdk');
const Promise = require('bluebird');
const _ = require('lodash');

//
//  Step that fetches the existing stack, and stores it in the context
//
module.exports = function(context) {
    return new Promise(function(resolve, reject) {
        const CF = new AWS.CloudFormation({ apiVersion: '2010-05-15' });
        const ctx = _.clone(context);

        ctx.stack = _.assign({}, ctx.stack, {
            name: `${context.project.name}-${context.project.stage}`,
        });

        process.stdout.write(`\nChecking if CF stack '${ctx.stack.name}' exists`);

        // Fetch info about the stack
        CF.listStacks({}, function(err, result) {
            if (err) {
                console.log(' ✖'.red);
                return reject(err);
            }

            const stacks = result.StackSummaries;
            const existingStack = stacks.find(function(stack) {
                return stack.StackName === ctx.stack.name && stack.DeletionTime === undefined;
            });

            ctx.stack = _.assign({}, ctx.stack, {
                stack: existingStack
            });

            console.log(' ✔'.green);
            resolve(ctx);
        });
    });
};
