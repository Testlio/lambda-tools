"use strict";

require('colors');
require('../helpers/string-additions');

const AWS = require('aws-sdk');
const cp = require('child_process');
const fs = require('fs');
const fsx = require('../helpers/fs-additions');
const path = require('path');

function uploadSpec(context) {
    // Upload the configuration from the context
    return new Promise(function(resolve, reject) {
        process.stdout.write(`\tUploading API definition`);

        const S3 = new AWS.S3({
            params: {
                Bucket: context.project.bucket
            }
        });

        S3.upload({
            Key: [context.project.timestamp, path.basename(context.api.configuration)].join('/'),
            Body: fs.createReadStream(context.api.configuration)
        }, function(err) {
            if (err) {
                console.log(' ✖'.red);
                return reject(err);
            }

            console.log(' ✔'.green);
            resolve(context);
        });
    });
}

function deploy(context) {
    return new Promise(function(resolve, reject) {
        process.stdout.write('\tUpdating API Gateway');

        // Make sure there is an API spec
        if (!context.api.configuration) {
            console.log(' ✖'.red);
            return reject(new Error('No API spec to deploy'));
        }

        const importer = path.join(context.directories.root, 'aws-apigateway-importer');
        const api = fsx.readJSONFileSync(context.api.configuration);
        const gatewayName = api.info.title;
        const gateway = new AWS.APIGateway();

        gateway.getRestApis({}, function(err, data) {
            if (err) {
                console.log(' ✖'.red);
                return reject(err);
            }

            const stageName = context.project.stage.sanitise('_');
            const apis = data.items;
            const matchingAPI = apis.find(function(a) {
                return a.name == gatewayName;
            });

            let command;

            if (!matchingAPI) {
                // No existing API Gateway, create new
                command = `cd "${importer}" &&
                ./aws-api-import.sh --deploy "${stageName}" --create "${context.api.configuration}"`;
            } else {
                // Existing API Gateway, update it
                command = `cd "${importer}" &&
                ./aws-api-import.sh --deploy "${stageName}" --update ${matchingAPI.id} "${context.api.configuration}"`;
            }

            cp.exec(command, function(error, stdout, stderr) {
                if (error) {
                    console.log(' ✖'.red);

                    console.error(stdout);
                    console.error(stderr);
                    return reject(error);
                }

                console.log(' ✔'.green);
                resolve(context);
            });
        });
    });
}

//
//  Step for deploying the API using the Java based API Gateway importer
//
module.exports = function(context) {
    return new Promise(function(resolve) {
        console.log('\nDeploying API');
        resolve(context);
    }).then(uploadSpec).then(deploy);
};
