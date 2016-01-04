"use strict";

//
//  Initial setup phase of deployment
//

const fsx           = require('../../helpers/fs-additions');
const path          = require('path');
const cp            = require('child_process');
const fs            = require('fs');
const async         = require('async');
const AWS           = require('aws-sdk');
const _             = require('lodash');

function checkDependencies() {
    try {
        cp.execSync('command -v aws');
    } catch (error) {
        console.error("Please install AWS CLI tools".red);
        throw new Error(error);
    }

    try {
        cp.execSync('command -v java');
    } catch (error) {
        console.error("Please install Java CLI tools".red);
        throw new Error(error);
    }
}

module.exports = function(program, workingDirectory, callback) {
    const root = path.resolve(process.cwd());
    const lambdasDirectory = path.resolve(root, 'lambdas');
    const lambdasBucket = `lambdas-${program.projectName}-${program.stage}`;
    const timestamp = Math.floor(new Date() / 1000);
    const lambdasBucketDirectory = '' + timestamp;
    const stagingDirectory = path.resolve(workingDirectory, 'lambda_stage');
    const deploymentFormation = path.join(stagingDirectory, 'deployment.cf.json');
    const deploymentAPI = path.join(stagingDirectory, 'deployment.api.json');

    async.series(
        [
            function(cb) {
                // Check dependencies
                try {
                    checkDependencies();
                    cb();
                } catch (error) {
                    cb(error);
                }
            },

            function(cb) {
                // Make sure there are Lambda functions, otherwise abort
                if (!fsx.directoryExists(lambdasDirectory)) {
                    return cb(new Error('Lambdas directory does not exist'));
                }

                // Create the staging directory (wipe any old one)
                try {
                    fsx.recreateDirectory(stagingDirectory);
                } catch (error) {
                    return cb(error);
                }

                // Check if there is an API definition
                let api;
                const apiFile = path.join(root, 'api.json');
                if (fsx.fileExists(apiFile)) {
                    // Copy the API file to staging
                    fs.writeFileSync(deploymentAPI, fs.readFileSync(apiFile));
                    api = deploymentAPI;
                }

                cb(null, {
                    directories: {
                        root: root,
                        working: workingDirectory,
                        staging: stagingDirectory,
                        lambdas: lambdasDirectory
                    },
                    cloudFormation: {
                        stackName: `${program.projectName}-${program.stage}`,
                        deployment: deploymentFormation
                    },
                    api: {
                        deployment: api,
                        importer: path.join(workingDirectory, 'aws-apigateway-importer')
                    },
                    bucket: {
                        name: lambdasBucket,
                        directory: lambdasBucketDirectory
                    }
                });
            },

            function(cb) {
                // Ensure that we have an S3 bucket to upload Lambdas to (unless dry run)
                if (!program.dryRun) {
                    console.log(`Making sure S3 bucket "${lambdasBucket}" exists`);
                    const S3 = new AWS.S3({apiVersion: '2006-03-01'});
                    const request = S3.createBucket({
                        Bucket: lambdasBucket
                    });

                    request.send(function(err, result) {
                        console.log('\tDone\n'.green);
                        cb(err, result);
                    });
                } else {
                    cb();
                }
            },

            function(cb) {
                try {
                    // Prime the CF template
                    const stackCF = fsx.readJSONFileSync(path.join(workingDirectory, 'templates', 'cf.json'));

                    // Merge with the template found in the service
                    const customCF = path.join(root, 'cf.json');
                    if (fsx.fileExists(customCF)) {
                        const customStackCF = fsx.readJSONFileSync(customCF);
                        _.merge(stackCF, customStackCF);
                    }

                    // Project name parameter need to be set (as they include an allowedValues listing)
                    stackCF["Parameters"]["aaProjectName"] = {
                        "Type": "String",
                        "Default": program.projectName,
                        "AllowedValues": [
                            program.projectName
                        ]
                    };

                    // If there are additional Lamdba policies, add those
                    const policyFile = path.join(root, 'lambda_policies.json');
                    if (fsx.fileExists(policyFile)) {
                        const policies = [].concat(fsx.readJSONFileSync(policyFile));
                        const current = stackCF["Resources"]["IamPolicyLambda"]["Properties"]["PolicyDocument"]["Statement"];
                        stackCF["Resources"]["IamPolicyLambda"]["Properties"]["PolicyDocument"]["Statement"] = current.concat(policies);
                    }

                    // Store the partially completed stack formation file
                    fs.writeFileSync(deploymentFormation, JSON.stringify(stackCF));

                    cb();
                } catch (error) {
                    console.error("Failed to load default templates".red, error);
                    cb(error);
                }
            }
        ],

        function(err, results) {
            callback(err, results[1]);
        });
};
