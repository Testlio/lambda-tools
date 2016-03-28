'use strict';

/**
 *  Creating the Lambda function that will later be used to deploy API
 *  Gateway instances via CloudFormation
 */

require('colors');
const AWS = require('aws-sdk');
const Promise = require('bluebird');
const path = require('path');
const fs = require('fs');
const _ = require('lodash');

const FUNCTION_NAME = 'lambda-tools-api-gateway-resource';
const ROLE_NAME = 'lambda-tools-helper';

function ensureLambdaRole(roleName, policyName) {
    const IAM = new AWS.IAM();

    return new Promise(function(resolve, reject) {
        IAM.getRole({
            RoleName: roleName
        }, function(err, data) {
            if (err) {
                if (err.code === 404 || err.code === 'NoSuchEntity') {
                    return resolve();
                }

                return reject(err);
            }

            resolve(data.Role);
        });
    }).then(function(existingRole) {
        if (existingRole) {
            return existingRole;
        }

        // Create a new role
        return new Promise(function(resolve, reject) {
            IAM.createRole({
                RoleName: roleName,
                AssumeRolePolicyDocument: JSON.stringify({
                    Version: '2012-10-17',
                    Statement: [
                        {
                            Sid: '',
                            Effect: 'Allow',
                            Principal: {
                                Service: [
                                    'lambda.amazonaws.com'
                                ]
                            },
                            Action: 'sts:AssumeRole'
                        }
                    ]
                })
            }, function(err, data) {
                if (err) return reject(err);
                resolve(data.Role);
            });
        });
    }).then(function(role) {
        // Make sure the role has an appropriate inline policy
        return new Promise(function(resolve, reject) {
            IAM.putRolePolicy({
                RoleName: role.RoleName,
                PolicyName: policyName,
                PolicyDocument: JSON.stringify({
                    Version: '2012-10-17',
                    Statement: [
                        {
                            Effect: 'Allow',
                            Action: [
                                'logs:CreateLogGroup',
                                'logs:CreateLogStream',
                                'logs:PutLogEvents'
                            ],
                            Resource: 'arn:aws:logs:*:*:*'
                        },
                        // API Gateway actions must be allowed to enable
                        // The Lambda to serve it's purpose
                        {
                            Effect: 'Allow',
                            Action: [
                                'apigateway:*'
                            ],
                            Resource: '*'
                        }
                    ]
                })
            }, function(err) {
                if (err) return reject(err);
                resolve(role);
            });
        });
    });
}

/**
 *  Helper function for updating or creating a Lambda function
 */
function updateOrCreateFunction(name, code, role) {
    const Lambda = new AWS.Lambda();

    return new Promise(function(resolve, reject) {
        Lambda.getFunction({
            FunctionName: name
        }, function(err, data) {
            if (err) {
                if (err.code === 404 || err.code === 'ResourceNotFoundException') {
                    return resolve();
                }

                return reject(err);
            }

            resolve(data.Configuration);
        });
    }).then(function(existing) {
        if (existing) {
            return new Promise(function(resolve, reject) {
                Lambda.updateFunctionCode({
                    FunctionName: name,
                    ZipFile: code,
                    Publish: true
                }, function(err, data) {
                    if (err) return reject(err);
                    resolve(data);
                });
            });
        }

        return new Promise(function(resolve, reject) {
            Lambda.createFunction({
                FunctionName: name,
                Handler: 'index.handler',
                Runtime: 'nodejs',
                Role: role.Arn,
                MemorySize: 256,
                Publish: true,
                Code: {
                    ZipFile: code
                },
                Description: 'Custom CloudFormation resource, used by \'lambda deploy\' for API Gateway',
                Timeout: 300
            }, function(err, data) {
                if (err) return reject(err);
                resolve(data);
            });
        });
    });
}

/**
 *  Helper function for creating a new alias by name on an existing function
 */
function updateOrCreateAlias(functionName, functionVersion, alias) {
    const Lambda = new AWS.Lambda();

    return new Promise(function(resolve, reject) {
        // Check if the alias already exists
        Lambda.getAlias({
            FunctionName: functionName,
            Name: alias
        }, function(err, data) {
            if (err) {
                if (err.code === 404 || err.code === 'ResourceNotFoundException') {
                    return resolve();
                }

                return reject(err);
            }

            resolve(data);
        });
    }).then(function(existingAlias) {
        let fn;
        if (existingAlias) {
            fn = Lambda.updateAlias.bind(Lambda);
        } else {
            fn = Lambda.createAlias.bind(Lambda);
        }

        return new Promise(function(resolve, reject) {
            fn({
                FunctionName: functionName,
                FunctionVersion: functionVersion,
                Name: alias,
                Description: 'Created via lambda-tools'
            }, function(err, data) {
                if (err) return reject(err);
                resolve(data);
            });
        });
    });
}

module.exports = function(region) {
    // Load the ZIP file that contains the code for the Lambda function
    const zipFile = fs.readFileSync(path.resolve(__dirname, '../api-gateway-resource/index.zip'));

    // Configure AWS
    if (!region && !AWS.config.region) {
        console.log('\tDefaulting region to \'us-east-1\'');
        region = 'us-east-1';
    }

    if (region) {
        console.log('\tSetting region to ' + region);
        AWS.config.update({
            region: region
        });
    }

    // Create a basic role for the Lambda to use
    process.stdout.write('\tCreating lambda execution role \'' + ROLE_NAME + '\'');
    ensureLambdaRole(ROLE_NAME, 'inline-policy').then(function(role) {
        console.log(' ✔'.green);

        // Create or update the Lambda function
        process.stdout.write('\tCreating lambda function \'' + FUNCTION_NAME + '\'');
        return updateOrCreateFunction(FUNCTION_NAME, zipFile, role).then(function(lambda) {
            console.log(' ✔'.green);

            // Build an ALIAS for this particular version of LT
            const version = require('../../package.json').version;
            const alias = _.kebabCase('lambda-tools-' + version);

            process.stdout.write('\tCreating alias \'' + alias + '\'');
            return updateOrCreateAlias(lambda.FunctionName, lambda.Version, alias);
        }).then(function() {
            console.log(' ✔'.green);
        });
    }).catch(function(err) {
        console.log(' ✖'.red);
        console.error(err, err.stack);
    });
};
