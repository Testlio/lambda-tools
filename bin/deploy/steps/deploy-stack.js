"use strict";

//
//  Main logic for updating a CF stack from a template file stored on disk
//  and zipped up Lambda functions that accompany it
//

const fsx           = require('../../helpers/fs_additions');
const path          = require('path');
const AWS           = require('aws-sdk');
const async         = require('async');
const fs            = require('fs');

module.exports = function(program, configuration, callback) {
    async.series([
        function(cb) {
            // Upload all assets to S3
            const S3 = new AWS.S3({
                params: {
                    Bucket: configuration.bucket.name
                }
            });

            const uploaders = fsx.getFiles(configuration.directories.staging).map(function(file) {
                return function(icb) {
                    const body = fs.createReadStream(file);
                    console.log(`Uploading ${path.basename(file)}`);

                    S3.upload({
                        Key: configuration.bucket.directory + '/' + path.basename(file),
                        Body: body
                    }, function(err, result) {
                        console.log(`\tDone ${path.basename(file)}`.green);
                        icb(err, result);
                    });
                };
            });

            if (!program.dryRun) {
                async.parallel(uploaders, cb);
            } else {
                cb(null, null);
            }
        },

        function(cb) {
            // Update the stack on CF
            if (!program.dryRun && !program.skipStack) {
                console.log('Beginning CloudFormation update');
                const CF = new AWS.CloudFormation({ apiVersion: '2010-05-15' });
                const stackName = configuration.cloudFormation.stackName;

                async.waterfall([
                    function(icb) {
                        console.log('\tChecking if stack exists');

                        CF.listStacks({}, function(err, result) {
                            if (err) return callback(err, null);

                            const stacks = result.StackSummaries;
                            const existingStack = stacks.find(function(stack) {
                                return stack.StackName == stackName && stack.DeletionTime == undefined;
                            });

                            icb(err, existingStack);
                        });
                    },

                    function(existingStack, icb) {
                        const stackCF = fsx.readJSONFileSync(configuration.cloudFormation.deployment);

                        const parameters = [
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
                                if (err) return icb(err);
                                icb(null, result.StackId, ['UPDATE_IN_PROGRESS', 'UPDATE_ROLLBACK_IN_PROGRESS', 'UPDATE_COMPLETE_CLEANUP_IN_PROGRESS', 'UPDATE_ROLLBACK_COMPLETE_CLEANUP_IN_PROGRESS'], 'UPDATE_COMPLETE');
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
                                if (err) return icb(err);
                                icb(null, result.StackId, ['CREATE_IN_PROGRESS'], 'CREATE_COMPLETE');
                            });
                        }
                    },

                    function(stackId, pendingStates, successState, icb) {
                        // Wait for appropriate state to occur
                        let currentState = pendingStates[0];

                        console.log('\tWaiting until CF completes');

                        async.until(
                            function() {
                                return currentState == successState || pendingStates.indexOf(currentState) == -1;
                            },

                            function(jcb) {
                                setTimeout(function () {
                                    CF.describeStacks({
                                        StackName: stackId
                                    }, function(err, result) {
                                        if (err) return callback(err, null);
                                        const stacks = result.Stacks;
                                        if (!stacks || stacks.length == 0) return callback(new Error("Stacks dissapeared"), null);

                                        currentState = stacks[0].StackStatus;
                                        jcb();
                                    });
                                }, 3000);
                            },

                            function(error) {
                                if (error) return icb(error, null);
                                if (currentState != successState) return icb(new Error('Stack ended up in an invalid state' + currentState), null);
                                icb();
                            }
                        );
                    }
                ], function(err) {
                    if (!err) console.log('\tDone\n'.green);
                    cb(err);
                });
            } else {
                // Nothing to do
                cb();
            }
        }
    ], function(err) {
        callback(err);
    });
};
