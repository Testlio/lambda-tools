"use strict";

const AWS           = require('aws-sdk');
const async         = require('async');

module.exports = function(program, configuration, callback) {
    let stackName = configuration.cloudFormation.stackName;
    let CF = new AWS.CloudFormation({ apiVersion: '2010-05-15' });

    CF.describeStacks({
        StackName: stackName
    }, function(err, result) {
        if (err) return callback(err, null);
        let stacks = result.Stacks;
        if (!stacks || stacks.length == 0) return callback(new Error("No stacks"), null);

        let matchingStack = stacks.find(function(stack) {
            return stack.StackName == stackName && stack.DeletionTime == undefined;
        });

        callback(null, matchingStack ? matchingStack.Outputs : []);
    });
};
