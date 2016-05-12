'use strict';

/**
 *  Creating the Lambda function that will later be used to deploy API
 *  Gateway instances via CloudFormation
 */

const AWS = require('aws-sdk');
const chalk = require('chalk');
const Promise = require('bluebird');
const path = require('path');
const fs = Promise.promisifyAll(require('graceful-fs'));
const fsx = require('../helpers/fs-additions');
const os = require('os');

const logger = require('../helpers/logger').shared;
const bundler = require('../deploy/bundle-lambdas-step');

const API_FUNCTION_NAME = 'lambda-tools-api-gateway-resource-beta';
const LAMBDA_FUNCTION_NAME = 'lambda-tools-lambda-version-resource-beta';
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
            }).then(function(result) {
                return new Promise(function(resolve, reject) {
                    Lambda.updateFunctionConfiguration({
                        FunctionName: name,
                        Runtime: 'nodejs4.3'
                    }, function(err) {
                        if (err) return reject(err);
                        resolve(result);
                    });
                });
            });
        }

        return new Promise(function(resolve, reject) {
            Lambda.createFunction({
                FunctionName: name,
                Handler: 'index.handler',
                Runtime: 'nodejs4.3',
                Role: role.Arn,
                MemorySize: 256,
                Publish: true,
                Code: {
                    ZipFile: code
                },
                Description: 'Custom CloudFormation resource, used by \'lambda deploy\'',
                Timeout: 300
            }, function(err, data) {
                if (err) return reject(err);
                resolve(data);
            });
        });
    });
}

module.exports = function(region) {
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
    const name = `Creating lambda execution role ${chalk.underline(ROLE_NAME)}`;
    return logger.task(name, function(resolve, reject) {
        ensureLambdaRole(ROLE_NAME, 'inline-policy').then(function(role) {
            resolve(role);
        }, reject);
    })
    .then(function(role) {
        // Create or update the Lambda function
        const task = `Creating lambda functions: ${chalk.underline(API_FUNCTION_NAME)}, ${chalk.underline(LAMBDA_FUNCTION_NAME)}`;
        return logger.task(task, function(resolve, reject) {
            // Bundle the Lambda function code
            const apiLambdaPath = path.resolve(__dirname, '../cf-resources/api-gateway-resource/index.js');
            const versionLambdaPath = path.resolve(__dirname, '../cf-resources/lambda-version-resource/index.js');

            const context = {
                directories: {
                    cwd: process.cwd(),
                    root: path.join(path.resolve(__dirname), '../deploy'),
                    staging: path.resolve(os.tmpdir(), 'lambda-tools-single-tools-setup')
                },

                lambdas: [
                    {
                        name: API_FUNCTION_NAME,
                        module: 'index',
                        handler: 'handler',
                        path: apiLambdaPath
                    },
                    {
                        name: LAMBDA_FUNCTION_NAME,
                        module: 'index',
                        handler: 'handler',
                        path: versionLambdaPath
                    }
                ],

                program: { optimization: 1, exclude: ['aws-sdk'], clean: true, region: region },
                logger: logger
            };

            // Make sure staging exists
            fsx.ensureDirectory(context.directories.staging);

            // Bundle, read the resulting ZIPs and update on AWS
            bundler(context).then(function(ctx) {
                return ctx.lambdas.map((lambda) => {
                    const zip = fs.readFileSync(lambda.zip);
                    return updateOrCreateFunction(lambda.name, zip, role);
                });
            }).then(resolve, reject);
        });
    });
};
