"use strict";

require('colors');
const AWS = require('aws-sdk');
const fs = require('fs');
const path = require('path');
const Promise = require('bluebird');
const _ = require('lodash');

function uploadAssets(context) {
    const S3 = new AWS.S3({
        params: {
            Bucket: context.project.bucket
        }
    });

    return new Promise(function(resolve) {
        console.log('\nUploading stack assets');
        resolve(context);
    }).then(function(ctx) {
        return Promise.mapSeries(ctx.lambdas, function(lambda) {
            return new Promise(function(resolve, reject) {
                if (!lambda.zip) {
                    return reject(new Error('No zipped Lambda to upload'));
                }

                process.stdout.write(`\tUploading ${path.basename(lambda.zip)}`);
                S3.upload({
                    Key: [ctx.project.timestamp, path.basename(lambda.zip)].join('/'),
                    Body: fs.createReadStream(lambda.zip)
                }, function(err, result) {
                    if (err) {
                        console.log(' ✖'.red);
                        return reject(err);
                    }

                    console.log(' ✔'.green);
                    resolve(result);
                });
            });
        });
    }).then(function(results) {
        const ctx = _.clone(context);
        ctx.lambdas = context.lambdas.map(function(lambda, idx) {
            return _.assign({}, lambda, {
                s3: results[idx].Location
            });
        });

        return ctx;
    }).then(function(ctx) {
        // Upload the configuration from the context
        return new Promise(function(resolve, reject) {
            process.stdout.write(`\tUploading stack configuration`);

            S3.upload({
                Key: [ctx.project.timestamp, path.basename(ctx.stack.configuration)].join('/'),
                Body: fs.createReadStream(ctx.stack.configuration)
            }, function(err, data) {
                if (err) {
                    console.log(' ✖'.red);
                    return reject(err);
                }

                console.log(' ✔'.green);
                resolve(_.assign({}, ctx, {
                    stack: {
                        templateURL: data.Location
                    }
                }));
            });
        });
    }).then(function(ctx) {
        if (!ctx.api.skip && ctx.api.configuration) {
            return new Promise(function(resolve, reject) {
                process.stdout.write(`\tUploading API definition`);

                S3.upload({
                    Key: [ctx.project.timestamp, path.basename(ctx.api.configuration)].join('/'),
                    Body: fs.createReadStream(ctx.api.configuration)
                }, function(err, data) {
                    if (err) {
                        console.log(' ✖'.red);
                        return reject(err);
                    }

                    console.log(' ✔'.green);
                    resolve(_.assign({}, ctx, {
                        api: {
                            templateURL: data.Location
                        }
                    }));
                });
            });
        } else {
            console.log('\tSkipping API definition');
        }

        return ctx;
    });
}

function updateStack(context) {
    const CF = new AWS.CloudFormation({ apiVersion: '2010-05-15' });

    const stack = context.stack;
    const templateURL = stack.templateURL;
    const existingStack = stack.stack;
    const stackName = stack.name;

    const parameters = [
        {
            ParameterKey: "aaStage",
            ParameterValue: context.project.stage
        },
        {
            ParameterKey: "aaProjectName",
            ParameterValue: context.project.name
        },
        {
            ParameterKey: "aaRegion",
            ParameterValue: context.project.region
        }
    ];

    let promise;

    console.log('\nUpdating CF stack');

    // Depending on whether there is a stack or not, either update one or
    // create a new stack instance
    if (existingStack) {
        promise = new Promise(function(resolve, reject) {
            process.stdout.write('\tFound existing stack, updating');

            CF.updateStack({
                StackName: existingStack.StackId,
                TemplateURL: templateURL,
                Parameters: parameters,
                Capabilities: [
                    'CAPABILITY_IAM'
                ]
            }, function(err, result) {
                if (err) {
                    console.log(' ✖'.red);
                    return reject(err);
                }

                console.log(' ✔'.green);
                resolve({
                    id: result.StackId,
                    pendingStates: [
                        'UPDATE_IN_PROGRESS',
                        'UPDATE_ROLLBACK_IN_PROGRESS',
                        'UPDATE_COMPLETE_CLEANUP_IN_PROGRESS',
                        'UPDATE_ROLLBACK_COMPLETE_CLEANUP_IN_PROGRESS'
                    ],
                    acceptedStates: ['UPDATE_COMPLETE']
                });
            });
        });
    } else {
        promise = new Promise(function(resolve, reject) {
            process.stdout.write('\tCreating a new stack');

            CF.createStack({
                StackName: stackName,
                TemplateURL: templateURL,
                Parameters: parameters,
                Capabilities: [
                    'CAPABILITY_IAM'
                ],
                OnFailure: 'DO_NOTHING'
            }, function(err, result) {
                if (err) {
                    console.log(' ✖'.red);
                    return reject(err);
                }

                console.log(' ✔'.green);
                resolve({
                    id: result.StackId,
                    pendingStates: [
                        'CREATE_IN_PROGRESS'
                    ],
                    acceptedStates: ['CREATE_COMPLETE']
                });
            });
        });
    }

    // Wait until stack returns to an acceptedState (or until it is in an
    // unacceptable state)
    return promise.then(function(state) {
        return new Promise(function(resolve, reject) {
            process.stdout.write('\tWaiting for stack to transition to state: ' + state.acceptedStates);

            const interval = setInterval(function() {
                CF.describeStacks({
                    StackName: state.id
                }, function(err, result) {
                    if (err) {
                        clearInterval(interval);
                        console.log(' ✖'.red);

                        return reject(err);
                    }

                    const stacks = result.Stacks;
                    if (!stacks || stacks.length == 0) {
                        clearInterval(interval);
                        console.log(' ✖'.red);

                        return reject(new Error('Stacks dissapeared'));
                    }

                    const currentState = stacks[0].StackStatus;
                    if (state.acceptedStates.indexOf(currentState) !== -1) {
                        clearInterval(interval);
                        console.log(' ✔'.green);

                        const newCtx = _.assign({}, context);
                        newCtx.stack.id = state.id;
                        resolve(newCtx);
                    } else if (state.pendingStates.indexOf(currentState) === -1) {
                        clearInterval(interval);
                        console.log(' ✖'.red);

                        reject(new Error('Stack changed to an unacceptable state'));
                    }
                });
            }, 3000);
        });
    });
}

//
//  Step for updating the CF based stack, including uploading all
//  assets to S3 (Lambdas + configuration files)
//
//  Once completed, the stack is stable and updated
//
module.exports = function(context) {
    return uploadAssets(context).then(updateStack);
};
