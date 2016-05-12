'use strict';

/**
 *  Helper Lambda function for deploying API Gateway instances,
 *  based on a Swagger definition from S3
 */

const AWS = require('aws-sdk');
const S3 = new AWS.S3({ apiVersion: '2006-03-01', region: 'us-east-1' });
const APIG = new AWS.APIGateway({ apiVersion: '2015-07-09', region: 'us-east-1' });
const response = require('cfn-response');
const Promise = require('bluebird');
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const _ = require('lodash');

/**
 *  Helper function that downloads an S3 file to a local path
 *
 *  @returns {Promise} which resolves to the local path the file was
 *  saved at.
 */
function downloadFile(bucket, key, version, localPath) {
    return new Promise(function(resolve, reject) {
        console.log('Download file from S3');

        S3.getObject({
            Bucket: bucket,
            Key: key,
            VersionId: version
        }, function(err, data) {
            console.log('Done', err, data);

            if (err) return reject(err);
            fs.writeFile(localPath, data.Body, function(innerErr) {
                if (innerErr) return reject(innerErr);
                resolve(localPath);
            });
        });
    });
}

function headFile(bucket, key, version) {
    return new Promise(function(resolve, reject) {
        console.log('Fetching HEAD of ', bucket, key);

        S3.headObject({
            Bucket: bucket,
            Key: key,
            VersionId: version
        }, function(err, data) {
            console.log('Done', err, data);

            if (err) return reject(err);
            resolve(data);
        });
    });
}

/**
 *  Helper function for replacing variables in the API definition
 *
 *  @returns {Promise} which resolves into the same localPath the file was
 *  written back to
 */
function replaceVariables(localPath, variables) {
    return new Promise(function(resolve, reject) {
        console.log('Replace variables', localPath, variables);

        // Read the file
        let body = fs.readFileSync(localPath, 'utf8');

        // Do the replacement for all of the variables
        const keys = Object.keys(variables);
        keys.forEach(function(key) {
            const value = variables[key];

            const re = new RegExp(`"\\$${key}"`, 'g');
            body = body.replace(re, `"${value}"`);
            console.log(re + ' -> ' + '"' + value + '"');
        });

        console.log('Variables replaced');
        fs.writeFile(localPath, body, function(err) {
            console.log('Written back to disk', err);

            if (err) return reject(err);
            resolve(localPath);
        });
    });
}

/**
 *  Helper function that fetches an existing API by it's name
 *
 *  @returns {Promise} which resolves to either null or an existing API
 */
function fetchExistingAPI(apiName, position) {
    return new Promise(function(resolve, reject) {
        console.log('Fetch existing API', apiName, position);

        APIG.getRestApis({
            limit: 100,
            position: position
        }, function(err, data) {
            console.log('Done', err, data);

            if (err) return reject(err);

            // Check if we have found our match
            const match = data.items.filter(function(api) {
                return api.name === apiName;
            });

            if (match.length === 0) {
                // If we have not reached the end, recurse
                if (data.items.length === 100) {
                    resolve(fetchExistingAPI(apiName, data.position));
                } else {
                    resolve();
                }
            } else {
                resolve(match[0]);
            }
        });
    });
}

/**
 *  Helper function for deleting an API stage from API Gateway instance
 *
 *  @returns {Promise} which resolves to deleted API stage
 */
function deleteAPIStage(apiId, stageName, deploymentId) {
    return new Promise(function(resolve, reject) {
        // Validate the stage deletion first (it has to have the
        // correct deploymentId)
        APIG.getStage({
            restApiId: apiId,
            stageName:
        }, function(err, data) {
            if (err) return reject(err);
            resolve(data);
        });
    }).then(function(stage) {
        if (stage.deploymentId !== deploymentId) {
            // We are not going to delete as the stage we are looking for no-longer
            // exists like we expect it to
            return {
                deploymentId: deploymentId,
                stageName: stageName
            };
        }

        return new Promise(function(resolve, reject) {
            APIG.deleteStage({
                restApiId: apiId,
                stageName: stageName
            }, function(err, data) {
                if (err) return reject(err);
                resolve(data);
            });
        });
    });
}

/**
 *  Helper function for fetching all stages for an API
 *
 *  @returns {Promise} which resolves into a list of stages
 */
function fetchAPIStages(apiId) {
    return new Promise(function(resolve, reject) {
        console.log('Get stages', apiId);

        APIG.getStages({
            restApiId: apiId
        }, function(err, data) {
            console.log('Done', err, data);

            if (err) return reject(err);
            resolve(data.item);
        });
    });
}

/**
 *  Helper function for deleting an API
 *
 *  @returns Promise, which resolves into the apiID of the deleted API
 */
function deleteAPI(apiId) {
    return new Promise(function(resolve, reject) {
        console.log('Delete API', apiId);

        APIG.deleteRestApi({
            restApiId: apiId
        }, function(err) {
            console.log('Done', err);

            if (err) {
                if (err.code === 404 || err.code === 'NotFoundException') {
                    // API didn't exist to begin with
                    return resolve(apiId);
                }

                return reject(err);
            }

            resolve(apiId);
        });
    });
}

/**
 *  Helper function that runs a command in a child process
 *
 *  @returns Promise, which resolves to an object containing the stdout, stderr
 *  and resulting error of the process
 */
function run(cmd, options) {
    return new Promise(function(resolve) {
        console.log('Executing command', cmd, options);
        cp.exec(cmd, options, function(error, stdout, stderr) {
            console.log('Done', error);

            resolve({
                error: error,
                stdout: stdout,
                stderr: stderr
            });
        });
    });
}

function updateAPI(existingAPI, apiName, stageName, definitionPath) {
    const importer = path.resolve(process.env.LAMBDA_TASK_ROOT, './aws-apigateway-importer/target/aws-apigateway-importer.jar');
    const runCmd = 'java';
    let runArgs;

    if (!existingAPI.id) {
        console.log('Creating new API');

        // This can only be a create operation
        runArgs = [ '-jar', `"${importer}"`,
            '--deploy', `"${stageName}"`,
            '--create', `"${definitionPath}"`,
            '--region', process.env.AWS_REGION
        ];
    } else {
        console.log('Updating existing API');

        runArgs = [
            '-jar', `"${importer}"`,
            '--deploy', `"${stageName}"`,
            '--update', existingAPI.id, `"${definitionPath}"`,
            '--region', process.env.AWS_REGION
        ];
    }

    return run(runCmd + ' ' + runArgs.join(' '), {
        cwd: process.env.LAMBDA_TASK_ROOT,
        env: process.env
    }).then(function(result) {
        console.log('Swagger importer finished');
        console.log('STDOUT', result.stdout);
        console.error('STDERR', result.stderr);

        if (result.error) {
            throw result.error;
        }

        return fetchExistingAPI(apiName).then(function(api) {
            // Resolve with the deployed stage
            return new Promise(function(resolve, reject) {
                APIG.getStage({
                    restApiId: api.id,
                    stageName: stageName
                }, function(err, data) {
                    if (err) return reject(err);
                    resolve(data);
                });
            });
        });
    });
}

exports.handler = function(event, context) {
    // Determine the nature of this request
    const command = event.RequestType;

    // Log the event (this will help debugging)
    console.log('Handle ' + command + ' request');  // eslint-disable-line no-console
    console.log('Event', JSON.stringify(event));  // eslint-disable-line no-console

    // Validate context
    if (!event) {
        console.error(new Error('Context MUST have an event'));
        return response.send(event, context, response.FAILED, {});
    }

    const properties = event.ResourceProperties;
    const oldProperties = event.OldResourceProperties ? event.OldResourceProperties : {};

    if (!properties) {
        console.error(new Error('Context event must have a \'ResourceProperties\' key'));
        return response.send(event, context, response.FAILED, {});
    }

    const definition = properties.Definition;
    const oldDefinition = oldProperties.Definition ? oldProperties.Definition : {};

    if (!definition.S3Bucket || !definition.S3Key) {
        console.error(new Error('Resource properties must include \'Definition\''));
        return response.send(event, context, response.FAILED, {});
    }

    // We always want to download the S3 file (as it contains the API name)
    const localPath = '/tmp/api.json';
    let promise = downloadFile(definition.S3Bucket, definition.S3Key, definition.S3ObjectVersion, localPath)
    .then(function(filePath) {
        // Replace variables in file
        return replaceVariables(filePath, properties.Variables || {});
    })
    .then(function(filePath) {
        // Parse the specification
        return JSON.parse(fs.readFileSync(filePath));
    })
    .then(function(api) {
        // Resolve to the API name (which next steps want to use)
        return api.info.title;
    })
    .then(function(apiName) {
        // Fetch any existing API
        return fetchExistingAPI(apiName).then(function(api) {
            return _.merge({ name: apiName }, api);
        });
    });

    // Check what operating we are dealing with
    if (command === 'Delete') {
        // Deleting is slightly more complex
        // We need to either simply delete a stage, or delete both the stage
        // as well as the API Gateway instance itself
        const stageName = properties.StageName;
        const deploymentId = event.PhysicalResourceId;

        if (stage) {
            // Remove the stage from the API
            promise = promise.then(function(existing) {
                if (!existing.id) {
                    // Nothing to delete
                    return {
                        stage: undefined,
                        api: existing
                    };
                }

                return deleteAPIStage(existing.id, stageName, deploymentId).then(function(stage) {
                    return {
                        stage: stage,
                        api: existing
                    };
                });
            });
        }

        // Fetch all stages and if there are none, delete the API entirely
        promise = promise.then(function(results) {
            const api = results.api;
            const stage = results.stage;

            if (!api.id) {
                // Nothing to delete
                return stage;
            }

            return fetchAPIStages(api.id).then(function(stages) {
                if (stages && stages.length === 0) {
                    return deleteAPI(api.id).then(function() {
                        return stage;
                    });
                }

                return stage;
            });
        });
    } else if (command === 'Update' || command === 'Create') {
        promise = promise.then(function(existing) {
            // If there is an existing API, check for differences in API definition
            const sameDefinitions = _.isEqual(definition, oldDefinition);
            const sameStage = properties.StageName === oldProperties.StageName;
            const sameVariables = _.isEqual(properties.Variables, oldProperties.Variables);

            // Simple check, if everything else is the same and only the file definition
            // has changed, then we can compare the ETags of the files to see whether
            // their contents has changed, if not, we can skip the update
            if (existing.id && sameStage && sameVariables && !sameDefinitions) {
                return Promise.all([
                    headFile(definition.S3Bucket, definition.S3Key, definition.S3ObjectVersion),
                    headFile(oldDefinition.S3Bucket, oldDefinition.S3Key, oldDefinition.S3ObjectVersion)
                ]).then(function(results) {
                    // Compare the ETags
                    const etags = results.map(function(result) {
                        return result.ETag;
                    }).reduce(function(prev, next) {
                        if (prev.indexOf(next) === -1) {
                            return prev.concat(next);
                        }

                        return prev;
                    }, []);

                    if (etags.length > 1) {
                        // We need to update, more than one ETag
                        return updateAPI(existing, existing.name, properties.StageName, localPath);
                    } else {
                        return existing;
                    }
                });
            } else {
                return updateAPI(existing, existing.name, properties.StageName, localPath);
            }
        });
    }

    // Trigger the promise, handle completion/errors
    promise.then(function(stage) {
        console.log('Done', stage);
        if (stage) {
            return response.send(event, context, response.SUCCESS, stage, stage.deploymentId ? stage.deploymentId : event.PhysicalResourceId);
        } else {
            return response.send(event, context, response.SUCCESS, {}, event.PhysicalResourceId);
        }
    }).catch(function(err) {
        console.error('Error', err);
        return response.send(event, context, response.FAILED, {}, event.PhysicalResourceId);
    });
};
