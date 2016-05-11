'use strict';

/**
 *  Helper Lambda function for deploying API Gateway instances,
 *  based on a Swagger definition from S3
 */

const S3 = require('./s3-utility');
const APIG = require('./apig-utility');
const response = require('cfn-response');
const swagger = require('swagger-parser');

const Promise = require('bluebird');
const fs = Promise.promisifyAll(require('fs'));
const _ = require('lodash');

/**
 *  Helper function for replacing variables in the API definition
 *
 *  @returns Promise, which resolves into the same localPath the file was
 *  written back to
 */
function replaceVariables(localPath, variables) {
    return new Promise(function(resolve, reject) {
        // Read the file
        let body = fs.readFileSync(localPath, 'utf8');

        // Do the replacement for all of the variables
        const keys = Object.keys(variables);
        keys.forEach(function(key) {
            const value = variables[key];

            const re = new RegExp(`"\\$${key}"`, 'g');
            body = body.replace(re, `"${value}"`);
        });

        console.log('Variables replaced', body);
        fs.writeFile(localPath, body, function(err) {
            if (err) return reject(err);
            resolve(localPath);
        });
    });
}

exports.handler = function(event, context) {
    // Determine the nature of this request
    const command = event.RequestType;

    // Log the event (this will help debugging)
    console.log('Handle ' + command + ' request');  // eslint-disable-line no-console
    console.log('Event', JSON.stringify(event, null, 4));  // eslint-disable-line no-console

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
    let promise = S3.downloadFile(definition.S3Bucket, definition.S3Key, definition.S3ObjectVersion, localPath)
    .then(function(filePath) {
        console.log('Validating Swagger file');
        return swagger.validate(filePath).then(function() {
            return filePath;
        });
    })
    .then(function(filePath) {
        console.log('Fetched API from S3');

        // Replace variables in file
        return replaceVariables(filePath, properties.Variables || {});
    })
    .then(function(filePath) {
        console.log('Replaced variables', filePath);

        // Parse the specification
        return JSON.parse(fs.readFileSync(filePath));
    })
    .then(function(api) {
        console.log('Derived API name', api.info.title);

        // Resolve to the API name (which next steps want to use)
        return api.info.title;
    }).then(function(apiName) {
        return APIG.fetchExistingAPI(apiName).then(function(api) {
            console.log('Fetched existing API', api);
            return _.merge({ name: apiName }, api);
        });
    });

    // What comes next depends on the operation
    if (command === 'Delete') {
        // Deleting is slightly more complex
        // We need to either simply delete a stage, or delete both the stage
        // as well as the API Gateway instance itself
        const stage = properties.StageName;

        if (stage) {
            promise = promise.then(function(existing) {
                if (!existing.id) {
                    // Nothing to delete
                    console.log('Nothing to delete');
                    return existing;
                }

                console.log('Deleting stage and optionally API', existing.id, stage);
                return APIG.deleteStageAndAPI(existing.id, stage).then(function() {
                    return existing;
                });
            });
        } else {
            // Delete the API, only if there are no stages on it
            promise = promise.then(function(existing) {
                if (!existing.id) {
                    // Nothing to delete
                    console.log('Nothing to delete');
                    return existing;
                }

                console.log('Deleting API (if no stages remains)', existing.id);
                return APIG.deleteAPIIfStageless(existing.id).then(function() {
                    return existing;
                });
            });
        }
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
                    S3.headFile(definition.S3Bucket, definition.S3Key, definition.S3ObjectVersion),
                    S3.headFile(oldDefinition.S3Bucket, oldDefinition.S3Key, oldDefinition.S3ObjectVersion)
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
                        console.log('Updating existing API, properties have changed');
                        return APIG.updateAPI(existing.id, properties.StageName, localPath);
                    } else {
                        console.log('Skipping, not enough has changed');
                        return existing;
                    }
                });
            } else if (existing.id) {
                console.log('Updating API');
                return APIG.updateAPI(existing.id, localPath);
            } else {
                console.log('Creating API');
                return APIG.createAPI(existing.name, localPath);
            }
        }).then(function(api) {
            console.log('Deploying stage', properties.StageName);
            return APIG.deployStage(api.id, properties.StageName);
        });
    }

    // Trigger the promise, handle completion/errors
    promise.then(function(existing) {
        console.log('Done', existing);
        if (existing) {
            return response.send(event, context, response.SUCCESS, existing, existing.id ? existing.id : event.PhysicalResourceId);
        } else {
            return response.send(event, context, response.SUCCESS, {}, event.PhysicalResourceId);
        }
    }).catch(function(err) {
        console.error('Error', err);
        return response.send(event, context, response.FAILED, {}, event.PhysicalResourceId);
    });
};
