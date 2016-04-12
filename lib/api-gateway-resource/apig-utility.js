'use strict';

/**
 *  Helper for promisfying APIG
 */

const AWS = require('aws-sdk');
const APIG = new AWS.APIGateway({ apiVersion: '2015-07-09' });
const Promise = require('bluebird');
const fs = Promise.promisifyAll(require('fs'));

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
    fetchExistingAPI: fetchExistingAPI,

    fetchExistingStages: function(apiId) {
        return APIG.getStages({
            restApiId: apiId
        }).promise().then(function(data) {
            return data.item;
        });
    },

    deleteStage: function(apiId, stageName) {
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
    },

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

    deleteAPIIfStageless: function(apiId) {
        return module.exports.fetchExistingStages(apiId).then(function(stages) {
            // If there are no stages, then delete the API
            if (!stages || stages.length === 0) {
                return module.exports.deleteAPI(apiId);
            }

            return apiId;
        });
    },

    deleteStageAndAPI: function(apiId, stageName) {
        return module.exports.deleteStage(apiId, stageName).then(function() {
            // Grab all stages for the API
            return module.exports.deleteAPIIfStageless(apiId);
        });
    },

    deployStage: function(apiId, stageName) {
        return APIG.createDeployment({
            restApiId: apiId,
            stageName: stageName
        }).promise();
    },

    createAPI: function(apiName, stageName, swaggerPath) {
        return fs.readFileAsync(swaggerPath).then(function(data) {
            return APIG.importRestApi({
                body: data,
                failOnWarnings: false
            }).promise();
        }).then(function(api) {
            return module.exports.deployStage(api.id, stageName);
        });
    },

    updateAPI: function(apiId, stageName, swaggerPath) {
        return fs.readFileAsync(swaggerPath, { encoding: 'utf8' }).then(function(data) {
            return new Promise(function(resolve, reject) {
                return APIG.putRestApi({
                    restApiId: apiId,
                    body: data
                }, function(err, result) {
                    if (err) return reject(err);
                    resolve(result);
                });
            });
        }).then(function(api) {
            return module.exports.deployStage(api.id, stageName);
        });
    }
};
