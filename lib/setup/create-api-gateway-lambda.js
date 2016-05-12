'use strict';

/**
 *  Creating the Lambda function that will later be used to deploy API
 *  Gateway instances via CloudFormation
 */

const AWS = require('aws-sdk');
const chalk = require('chalk');
const Promise = require('bluebird');
const path = require('path');
const fs = require('graceful-fs');
const _ = require('lodash');

const logger = require('../helpers/logger').shared;
const config = require('../helpers/config');

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
            const templatePath = path.resolve(__dirname, './templates/iam_role.json');

            IAM.createRole({
                RoleName: roleName,
                AssumeRolePolicyDocument: fs.readFileSync(templatePath, 'utf8')
            }, function(err, data) {
                if (err) return reject(err);
                resolve(data.Role);
            });
        });
    }).then(function(role) {
        // Make sure the role has an appropriate inline policy
        return new Promise(function(resolve, reject) {
            const templatePath = path.resolve(__dirname, './templates/iam_policy.json');

            IAM.putRolePolicy({
                RoleName: role.RoleName,
                PolicyName: policyName,
                PolicyDocument: fs.readFileSync(templatePath, 'utf8')
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
    return new Promise(function(resolve, reject) {
        // Load the ZIP file that contains the code for the Lambda function
        const zipPath = path.resolve(__dirname, '../api-gateway-resource/index.zip');
        fs.readFile(zipPath, function(err, data) {
            if (err) return reject(err);
            resolve(data);
        });
    })
    .then(function(zipFile) {
        // Configure AWS
        if (!region && !AWS.config.region) {
            logger.log(`Defaulting region to ${chalk.underline('us-east-1')}`);
            region = 'us-east-1';
        }

        if (region) {
            logger.log(`Setting region to ${chalk.underline(region)}`);
            AWS.config.update({
                region: region
            });
        }

        // Create a basic role for the Lambda to use
        const name = `Creating lambda execution role ${chalk.underline(config.tools.resources.iamRole)}`;
        return logger.task(name, function(resolve, reject) {
            ensureLambdaRole(config.tools.resources.iamRole, 'inline-policy').then(function(role) {
                resolve({
                    role: role,
                    zipFile: zipFile
                });
            }, reject);
        });
    })
    .then(function(results) {
        // Create or update the Lambda function
        const name = `Creating lambda function ${chalk.underline(config.tools.resources.apiGateway)}`;
        return logger.task(name, function(resolve, reject) {
            updateOrCreateFunction(config.tools.resources.apiGateway, results.zipFile, results.role).then(resolve, reject);
        });
    })
    .then(function(lambda) {
        // Create an alias
        const version = require('../../package.json').version;
        const alias = _.kebabCase('lambda-tools-' + version);

        const name = `Creating alias ${chalk.underline(alias)}`;
        return logger.task(name, function(resolve, reject) {
            updateOrCreateAlias(lambda.FunctionName, lambda.Version, alias).then(resolve, reject);
        });
    });
};
