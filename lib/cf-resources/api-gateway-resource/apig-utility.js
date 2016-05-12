'use strict';

/**
 *  Helper for promisfying APIG
 */

const AWS = require('aws-sdk');
AWS.config.logger = process.stdout;

const APIG = new AWS.APIGateway({ apiVersion: '2015-07-09' });
const fs = require('fs');

function fetchExistingAPI(name, position) {
    return APIG.getRestApis({
        limit: 100,
        position: position
    }).promise().then(function(data) {
        // Check if we have found our match
        const match = data.items.filter(function(api) {
            return api.name === name;
        });

        if (match.length === 0) {
            // If we have not reached the end, recurse
            if (data.items.length === 100) {
                return fetchExistingAPI(name, data.position);
            } else {
                // Just return undefined
                return;
            }
        } else {
            return match[0];
        }
    });
}

module.exports = {
    /**
     *  Fetch existing API instance by name
     *
     *  @return {Promise} which resolves to the existing API or undefined if no
     *  such API exists
     */
    fetchExistingAPI: fetchExistingAPI,

    /**
     *  Fetch existing stages for a specific API
     *
     *  @return {Promise} which resolves to all stages for the specific API
     */
    fetchExistingStages: function(apiId) {
        return APIG.getStages({
            restApiId: apiId
        }).promise().then(function(data) {
            return data.item;
        });
    },

    fetchStage: function(apiId, stageName) {
        return APIG.getStage({
            restApiId: apiId,
            stageName: stageName
        }).promise();
    },

    /**
     *  Delete a specific stage on a specific API, but only if the deployment ID
     *  of the stage matches
     *
     *  @return {Promise} which resolves to the API ID that the stage was deleted on
     */
    deleteStage: function(apiId, stageName, deploymentId) {
        module.exports.fetchStage(apiId, stageName).then(function(stage) {
            if (stage.deploymentId !== deploymentId) {
                return apiId;
            }

            return new Promise(function(resolve, reject) {
                APIG.deleteStage({
                    restApiId: apiId,
                    stageName: stageName
                }, function(err) {
                    if (err) {
                        // If no such stage, then success
                        if (err.code === 404 || err.code === 'NotFoundException') {
                            return resolve(apiId);
                        }

                        return reject(err);
                    }

                    resolve(apiId);
                });
            });
        }, function(err) {
            // If no such stage, then success
            if (err.code === 404 || err.code === 'NotFoundException') {
                return apiId;
            }

            // Otherwise pass the error along
            throw err;
        });
    },

    /**
     *  Delete the entire API ID
     *
     *  @return {Promise} which resolves to the ID of the API that was deleted
     */
    deleteAPI: function(apiId) {
        return new Promise(function(resolve, reject) {
            APIG.deleteRestApi({
                restApiId: apiId
            }, function(err) {
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
    },

    /**
     *  Delete the API if and only if there are no more stages deployed on it
     *
     *  @return {Promise} which resolves to the ID of the API that was deleted
     */
    deleteAPIIfStageless: function(apiId) {
        return module.exports.fetchExistingStages(apiId).then(function(stages) {
            // If there are no stages, then delete the API
            if (!stages || stages.length === 0) {
                return module.exports.deleteAPI(apiId);
            }

            return apiId;
        });
    },

    /**
     *  Delete a specific stage and the API (only if the deleted stage is the last
     *  remaining stage on the API).
     *
     *  @return {Promise} which resolves to the ID of the API
     */
    deleteStageAndAPI: function(apiId, stageName, deploymentId) {
        return module.exports.deleteStage(apiId, stageName, deploymentId).then(function() {
            // Grab all stages for the API
            return module.exports.deleteAPIIfStageless(apiId);
        });
    },

    /**
     *  Deploy a new stage with a specific name on an API
     *
     *  @return {Promise} which resolves to the newly created stage
     */
    deployStage: function(apiId, stageName) {
        return APIG.createDeployment({
            restApiId: apiId,
            stageName: stageName
        }).promise();
    },

    /**
     *  Create a new API instance from a Swagger file
     *
     *  @return {Promise} which resolves to the newly created API instance
     */
    createAPI: function(apiName, swaggerPath) {
        return new Promise(function(resolve, reject) {
            fs.readFile(swaggerPath, function(err, data) {
                if (err) return reject(err);
                
                resolve(APIG.importRestApi({
                    body: data,
                    failOnWarnings: false
                }).promise());
            });
        });
    },

    /**
     *  Update an API with a specification from a Swagger file
     *  The update is done in the "overwrite" mode of API Gateway
     *
     *  @return {Promise} which resolves to the updated API
     */
    updateAPI: function(apiId, swaggerPath) {
        return new Promise(function(resolve, reject) {
           fs.readFile(swaggerPath, function(err, data) {
               if (err) return reject(err);
               
               resolve(APIG.putRestApi({
                   restApiId: apiId,
                   body: data,
                   mode: 'overwrite'
               }).promise());
           })
        });
    }
};
