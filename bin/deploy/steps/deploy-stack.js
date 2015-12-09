"use strict";

//
//  Main logic for updating a CF stack from a template file stored on disk
//  and zipped up Lambda functions that accompany it
//

const fsx           = require('../../helpers/fs_additions');
const path          = require('path');
const AWS           = require('aws-sdk');
const async         = require('async');
const colors        = require('colors');
const fs            = require('fs');

module.exports = function(program, configuration, callback) {
    async.series([
        function(callback) {
            // Upload all assets to S3
            let S3 = new AWS.S3({
                params: {
                    Bucket: configuration.bucket.name
                }
            });

            let uploaders = fsx.getFiles(configuration.directories.staging).map(function(file) {
                return function(callback) {
                    let body = fs.createReadStream(file);
                    console.log(`Uploading ${path.basename(file)}`);

                    S3.upload({
                        Key: configuration.bucket.directory + '/' + path.basename(file),
                        Body: body
                    }, function(err, result) {
                        console.log(`\tDone ${path.basename(file)}`.green);
                        callback(err, result);
                    });
                };
            });

            if (!program.dryRun) {
                async.parallel(uploaders, callback);
            } else {
                callback(null, null);
            }
        },

        function(callback) {
            // Update the stack on CF
            if (!program.dryRun && !program.skipStack) {
                console.log('Beginning CloudFormation update');
                let CF = new AWS.CloudFormation({ apiVersion: '2010-05-15' });
                let stackName = configuration.cloudFormation.stackName;

                async.waterfall([
                    function(callback) {
                        console.log('\tChecking if stack exists');

                        CF.listStacks({}, function(err, result) {
                            if (err) return callback(err, null);

                            let stacks = result.StackSummaries;
                            let existingStack = stacks.find(function(stack) {
                                return stack.StackName == stackName && stack.DeletionTime == undefined;
                            });

                            callback(err, existingStack);
                        });
                    },

                    function(existingStack, callback) {
                        let stackCF = fsx.readJSONFileSync(configuration.cloudFormation.deployment);

                        let parameters = [
                            {
                                ParameterKey: "aaStage",
                                ParameterValue: program.stage
                            },
                            {
                                ParameterKey: "aaProjectName",
                                ParameterValue: program.projectName
                            },
                            {
                                ParameterKey: "aaRegion",
                                ParameterValue: program.region
                            }
                        ];

                        if (existingStack) {
                            // Update existing stack
                            console.log('\tFound existing stack, updating');

                            CF.updateStack({
                                StackName: existingStack.StackId,
                                TemplateBody: JSON.stringify(stackCF),
                                Parameters: parameters,
                                Capabilities: [
                                    'CAPABILITY_IAM'
                                ]
                            }, function(err, result) {
                                if (err) return callback(err);
                                callback(null, result.StackId, ['UPDATE_IN_PROGRESS', 'UPDATE_ROLLBACK_IN_PROGRESS', 'UPDATE_COMPLETE_CLEANUP_IN_PROGRESS', 'UPDATE_ROLLBACK_COMPLETE_CLEANUP_IN_PROGRESS'], 'UPDATE_COMPLETE');
                            });
                        } else {
                            // Create a brand new stack
                            console.log('\tNo existing stack, creating one');

                            CF.createStack({
                                StackName: stackName,
                                TemplateBody: JSON.stringify(stackCF),
                                Parameters: parameters,
                                Capabilities: [
                                    'CAPABILITY_IAM'
                                ],
                                OnFailure: 'ROLLBACK'
                            }, function(err, result) {
                                if (err) return callback(err);
                                callback(null, result.StackId, ['CREATE_IN_PROGRESS'], 'CREATE_COMPLETE');
                            });
                        }
                    },

                    function(stackId, pendingStates, successState, callback) {
                        // Wait for appropriate state to occur
                        var currentState = pendingStates[0];

                        console.log('\tWaiting until CF completes');

                        async.until(
                            function() {
                                return currentState == successState || pendingStates.indexOf(currentState) == -1;
                            },

                            function(callback) {
                                setTimeout(function () {
                                    CF.describeStacks({
                                        StackName: stackId
                                    }, function(err, result) {
                                        if (err) return callback(err, null);
                                        let stacks = result.Stacks;
                                        if (!stacks || stacks.length == 0) return callback(new Error("Stacks dissapeared"), null);
                                        let stack = stacks[0];

                                        currentState = stack.StackStatus;
                                        callback();
                                    });
                                }, 3000);
                            },

                            function(error, result) {
                                if (error) return callback(error, null);
                                if (currentState != successState) return callback(new Error('Stack ended up in an invalid state' + currentState), null);
                                callback();
                            }
                        );
                    }
                ], function(err) {
                    if (!err) console.log('\tDone\n'.green);
                    callback(err);
                });
            } else {
                // Nothing to do
                callback();
            }
        }
    ], function(err, results) {
        callback(err);
    });
};
