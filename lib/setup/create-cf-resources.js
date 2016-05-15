'use strict';

/**
 *  Creating the Lambda function that will later be used to deploy API
 *  Gateway instances via CloudFormation
 */

const AWS = require('aws-sdk');
const chalk = require('chalk');
const Promise = require('bluebird');
const path = require('path');
const dot = require('dot');
const fs = Promise.promisifyAll(require('graceful-fs'));
const fsx = require('../helpers/fs-additions');
const os = require('os');

const config = require('../helpers/config');
const logger = require('../helpers/logger').shared;
const bundler = require('../deploy/bundle-lambdas-step');

function ensureLambdaRole(roleName, policyName, region) {
    const iam = new AWS.IAM();

    return new Promise(function(resolve, reject) {
        iam.getRole({
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

            iam.createRole({
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
            const template = dot.template(fs.readFileSync(templatePath, 'utf8'));

            iam.putRolePolicy({
                RoleName: role.RoleName,
                PolicyName: policyName,
                PolicyDocument: template({
                    s3Bucket: [config.tools.resources.s3Bucket, region].join('-')
                })
            }, function(err) {
                if (err) return reject(err);
                resolve(role);
            });
        });
    });
}

function updateOrCreateFunction(name, code, role) {
    const lambda = new AWS.Lambda();

    return new Promise(function(resolve, reject) {
        lambda.getFunction({
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
                lambda.updateFunctionCode({
                    FunctionName: name,
                    ZipFile: code,
                    Publish: true
                }, function(err, data) {
                    if (err) return reject(err);
                    resolve(data);
                });
            }).then(function(result) {
                return new Promise(function(resolve, reject) {
                    lambda.updateFunctionConfiguration({
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
            lambda.createFunction({
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

function ensureS3Bucket(bucketName) {
    const s3 = new AWS.S3();

    return new Promise(function(resolve) {
        s3.headBucket({
            Bucket: bucketName
        }, function(err) {
            if (err) {
                // Create the bucket
                resolve(false);
            }

            resolve(true);
        });
    }).then(function(exists) {
        if (!exists) {
            return new Promise(function(resolve, reject) {
                s3.createBucket({
                    Bucket: bucketName
                }, function(err, data) {
                    if (err) return reject(err);
                    resolve(data);
                });
            });
        }
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
    const name = `Creating lambda execution role ${chalk.underline(config.tools.resources.iamRole)}`;
    return logger.task(name, function(resolve, reject) {
        ensureLambdaRole(config.tools.resources.iamRole, 'inline-policy', region).then(function(role) {
            resolve(role);
        }, reject);
    })
    .then(function(role) {
        // Create or update the Lambda function
        const task = `Creating lambda functions: ${chalk.underline(config.tools.resources.apiGateway)}, ${chalk.underline(config.tools.resources.lambdaVersion)}`;
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
                        name: config.tools.resources.apiGateway,
                        module: 'index',
                        handler: 'handler',
                        path: apiLambdaPath
                    },
                    {
                        name: config.tools.resources.lambdaVersion,
                        module: 'index',
                        handler: 'handler',
                        path: versionLambdaPath
                    }
                ],

                program: { optimization: 1, exclude: [], clean: true, region: region },
                logger: logger
            };

            // Make sure staging exists
            fsx.ensureDirectory(context.directories.staging);

            // Bundle, read the resulting ZIPs and update on AWS
            return bundler(context).then(function(ctx) {
                return Promise.all(ctx.lambdas.map((lambda) => {
                    const zip = fs.readFileSync(lambda.zip);
                    return updateOrCreateFunction(lambda.name, zip, role);
                }));
            }).then(resolve, reject);
        });
    })
    .then(function() {
        const bucketName = [config.tools.resources.s3Bucket, region].join('-');
        const task = `Creating S3 bucket: ${chalk.underline(bucketName)}`;
        return logger.task(task, function(resolve, reject) {
            return ensureS3Bucket(bucketName).then(resolve, reject);
        });
    });
};
