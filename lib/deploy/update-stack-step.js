"use strict";

const AWS = require('aws-sdk');
const fs = require('graceful-fs');
const path = require('path');
const Promise = require('bluebird');
const _ = require('lodash');

function uploadAssets(context) {
    const S3 = new AWS.S3({
        params: {
            Bucket: context.project.bucket
        }
    });

    return context.logger.task('Uploading stack assets', function(resolve, reject) {
        return Promise.mapSeries(context.lambdas, function(lambda) {
            return context.logger.task(`Uploading ${path.basename(lambda.zip)}`, function(res, rej) {
                if (!lambda.zip) {
                    return rej(new Error('No zipped Lambda to upload'));
                }

                S3.upload({
                    Key: [context.project.timestamp, path.basename(lambda.zip)].join('/'),
                    Body: fs.createReadStream(lambda.zip)
                }, function(err, result) {
                    if (err) {
                        return rej(err);
                    }

                    res(result);
                });
            });
        })
        .then(function(results) {
            const ctx = _.clone(context);
            ctx.lambdas = context.lambdas.map(function(lambda, idx) {
                return _.assign({}, lambda, {
                    s3: results[idx].Location
                });
            });

            return ctx;
        })
        .then(function(ctx) {
            // Upload the configuration from the context
            return ctx.logger.task('Uploading stack configuration', function(res, rej) {
                S3.upload({
                    Key: [ctx.project.timestamp, path.basename(ctx.stack.configuration)].join('/'),
                    Body: fs.createReadStream(ctx.stack.configuration)
                }, function(err, data) {
                    if (err) {
                        return rej(err);
                    }

                    res(_.merge({}, ctx, {
                        stack: {
                            templateURL: data.Location
                        }
                    }));
                });
            });
        })
        .then(function(ctx) {
            if (!ctx.api.skip && ctx.api.configuration) {
                return ctx.logger.task('Uploading API definition', function(res, rej) {
                    S3.upload({
                        Key: [ctx.project.timestamp, path.basename(ctx.api.configuration)].join('/'),
                        Body: fs.createReadStream(ctx.api.configuration)
                    }, function(err, data) {
                        if (err) {
                            return rej(err);
                        }

                        res(_.merge({}, ctx, {
                            api: {
                                templateURL: data.Location
                            }
                        }));
                    });
                });
            } else {
                ctx.logger.log('Skipping API definition');
            }

            return ctx;
        })
        .then(resolve, reject);
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

    // Depending on whether there is a stack or not, either update one or
    // create a new stack instance
    if (existingStack) {
        promise = context.logger.task('Updating existing stack', function(resolve, reject) {
            CF.updateStack({
                StackName: existingStack.StackId,
                TemplateURL: templateURL,
                Parameters: parameters,
                Capabilities: [
                    'CAPABILITY_IAM'
                ]
            }, function(err, result) {
                if (err) {
                    return reject(err);
                }

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
        promise = context.logger.task('Creating a new stack', function(resolve, reject) {
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
                    return reject(err);
                }

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
        const name = `Waiting for stack to transition to state: ${state.acceptedStates}`;
        return context.logger.task(name, function(resolve, reject) {
            const interval = setInterval(function() {
                CF.describeStacks({
                    StackName: state.id
                }, function(err, result) {
                    if (err) {
                        clearInterval(interval);

                        return reject(err);
                    }

                    const stacks = result.Stacks;
                    if (!stacks || stacks.length == 0) {
                        clearInterval(interval);

                        return reject(new Error('Stacks dissapeared'));
                    }

                    const currentState = stacks[0].StackStatus;
                    if (state.acceptedStates.indexOf(currentState) !== -1) {
                        clearInterval(interval);

                        const newCtx = _.assign({}, context);
                        newCtx.stack.id = state.id;
                        resolve(newCtx);
                    } else if (state.pendingStates.indexOf(currentState) === -1) {
                        clearInterval(interval);

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
