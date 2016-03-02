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

        // Unacceptable statuses for the stack
        const deletedStatuses = [ 'DELETE_IN_PROGRESS', 'DELETE_FAILED', 'DELETE_COMPLETE'];

        // Fetch info about the stack
        CF.describeStacks({
            StackName: ctx.stack.name
        }, function(err, result) {
            if (err) {
                console.log(' ✖'.red);

                if (err.message === 'Stack with id ' + ctx.stack.name + ' does not exist') {
                    return resolve(ctx);
                }

                return reject(err);
            }

            const stacks = result.Stacks;
            const existingStack = stacks.find(function(stack) {
                return stack.StackName === ctx.stack.name && deletedStatuses.indexOf(stack.StackStatus) === -1;
            });

            ctx.stack = _.assign({}, ctx.stack, {
                stack: existingStack
            });

            console.log(' ✔'.green);
            resolve(ctx);
        });
    });
};
