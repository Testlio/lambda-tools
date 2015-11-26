"use strict";

const fs        = require('fs');
const fsx       = require('../helpers/fs_additions');
const colors    = require('colors');
const cp        = require('child_process');
const AWS       = require('aws-sdk');

module.exports = function(program, configuration, stackOutputs, callback) {
    // If there is no API file, then we have nothing to do
    if (!configuration.api.deployment) {
        return callback();
    }

    try {
        console.log('Completing API Definition');

        let api = fs.readFileSync(configuration.api.deployment, 'utf8');

        // Replace all outputs in the API definition with their values
        for (let output of stackOutputs) {
            let key = `\\$${output.OutputKey}`;
            let value = output.OutputValue;

            console.log('\t' + key.yellow + ' -> ' + value.yellow);
            let re = new RegExp(`"${key}"`, 'g');
            api = api.replace(re, `"${value}"`);
        }

        // Store the final API definition back in the correct spot
        fs.writeFileSync(configuration.api.deployment, api);
        console.log("\tDone\n".green);

        // Deploy the API
        if (!program.dryRun && !program.skipApi) {
            console.log('Deploying API Gateway');

            let apiJSON = JSON.parse(api);
            let gatewayName = apiJSON.info.title;

            let gateway = new AWS.APIGateway();
            gateway.getRestApis({}, function(err, data) {
                if (err) return callback(err);

                let apis = data.items;
                let matchingAPI = apis.find(function(api) {
                    return api.name == gatewayName;
                });

                if (!matchingAPI) {
                    // No existing API Gateway, create new
                    cp.execSync(`cd "${configuration.api.importer}" && ./aws-api-import.sh --deploy ${program.stage} --create "${configuration.api.deployment}"`);
                } else {
                    // Existing API Gateway, update it
                    cp.execSync(`cd "${configuration.api.importer}" && ./aws-api-import.sh --deploy ${program.stage} --update ${matchingAPI.id} "${configuration.api.deployment}"`);
                }

                console.log('\tDone'.green);

                callback();
            });
        }
    } catch (error) {
        callback(error);
    }
};
