"use strict";

const AWS           = require('aws-sdk');

module.exports = function(program, configuration, callback) {
    const stackName = configuration.cloudFormation.stackName;
    const CF = new AWS.CloudFormation({ apiVersion: '2010-05-15' });

    CF.describeStacks({
        StackName: stackName
    }, function(err, result) {
        if (err) return callback(err, null);
        const stacks = result.Stacks;
        if (!stacks || stacks.length == 0) return callback(new Error("No stacks"), null);

        const matchingStack = stacks.find(function(stack) {
            return stack.StackName == stackName && stack.DeletionTime == undefined;
        });

        callback(null, matchingStack ? matchingStack.Outputs : []);
    });
};
