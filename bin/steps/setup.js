"use strict";

//
//  Initial setup phase of deployment
//

const fsx           = require('../helpers/fs_additions');
const path          = require('path');
const cp            = require('child_process');
const fs            = require('fs');
const sync          = require('synchronize');
const AWS           = require('aws-sdk');

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
    sync.fiber(function() {
        // Check dependencies
        try {
            checkDependencies();
        } catch (error) {
            console.error(error);
            process.exit(1);
        }

        // Gather our bearings
        let root = path.resolve(process.cwd());
        let lambdasDirectory = path.resolve(root, 'lambdas');
        let lambdasBucket = `lambdas-${program.projectName}-${program.stage}`;
        let timestamp = Math.floor(new Date() / 1000);
        let lambdasBucketDirectory = '' + timestamp;
        let stagingDirectory = path.resolve(workingDirectory, 'lambda_stage');
        let deploymentFormation = path.join(stagingDirectory, 'deployment.cf.json');
        let deploymentAPI = path.join(stagingDirectory, 'deployment.api.json');

        // Make sure there are Lambda functions, otherwise abort
        if (!fsx.directoryExists(lambdasDirectory)) {
            console.error("Lambdas directory does not exist".red);
            process.exit(2);
        }

        // Create the staging directory (wipe any old one)
        try {
            fsx.recreateDirectory(stagingDirectory);
        } catch (error) {
            console.error(error);
            process.exit(3);
        }

        // Ensure that we have an S3 bucket to upload Lambdas to (unless dry run)
        if (!program.dryRun) {
            console.log(`Making sure S3 bucket "${lambdasBucket}" exists`);
            const S3 = new AWS.S3({apiVersion: '2006-03-01'});
            const request = S3.createBucket({
                Bucket: lambdasBucket,
            });

            try {
                sync.await(request.send(sync.defer()));
            } catch (error) {
                console.error(error);
                process.exit(4);
            }

            console.log('\tDone\n'.green);
        }

        try {
            let stackCF = fsx.readJSONFileSync(path.join(workingDirectory, 'templates', 'cf.json'));

            // Project name parameter can be set (along with stage)
            stackCF["Parameters"]["aaProjectName"] = {
                "Type": "String",
                "Default": program.projectName,
                "AllowedValues": [
                    program.projectName
                ]
            };

            // If there are additional Lamdba policies, add those
            let policyFile = path.join(root, 'lambda_policies.json');
            if (fsx.fileExists(policyFile)) {
                let policies = [].concat(fsx.readJSONFileSync(policyFile));
                let current = stackCF["Resources"]["IamPolicyLambda"]["Properties"]["PolicyDocument"]["Statement"];
                stackCF["Resources"]["IamPolicyLambda"]["Properties"]["PolicyDocument"]["Statement"] = current.concat(policies);
            }

            // Store the partially completed stack formation file
            fs.writeFileSync(deploymentFormation, JSON.stringify(stackCF));

            // Check if there is an API definition
            let api;
            let apiFile = path.join(root, 'api.json');
            if (fsx.fileExists(apiFile)) {
                // Copy the API file to staging
                fs.writeFileSync(deploymentAPI, fs.readFileSync(apiFile));
                api = deploymentAPI;
            }

            callback(null, {
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
        } catch (error) {
            console.error("Failed to load default templates".red, error);
            callback(error, null);
        }
    });
};
