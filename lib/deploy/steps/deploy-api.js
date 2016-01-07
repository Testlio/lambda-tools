"use strict";

require('../../helpers/string-additions');
const fs        = require('fs');
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
        for (const output of stackOutputs) {
            const key = `\\$${output.OutputKey}`;
            const value = output.OutputValue;

            console.log('\t' + key.yellow + ' -> ' + value.yellow);
            const re = new RegExp(`"${key}"`, 'g');
            api = api.replace(re, `"${value}"`);
        }

        // Store the final API definition back in the correct spot
        fs.writeFileSync(configuration.api.deployment, api);
        console.log("\tDone\n".green);

        // Deploy the API
        if (!program.dryRun && !program.skipApi) {
            console.log('Deploying API Gateway');

            const apiJSON = JSON.parse(api);
            const gatewayName = apiJSON.info.title;
            const gateway = new AWS.APIGateway();

            gateway.getRestApis({}, function(err, data) {
                if (err) return callback(err);

                const stageName = program.stage.sanitise('_');
                const apis = data.items;
                const matchingAPI = apis.find(function(a) {
                    return a.name == gatewayName;
                });

                let command;
                if (!matchingAPI) {
                    // No existing API Gateway, create new
                    command = `cd "${configuration.api.importer}" &&
                    ./aws-api-import.sh --deploy "${stageName}" --create "${configuration.api.deployment}"`;
                } else {
                    // Existing API Gateway, update it
                    command = `cd "${configuration.api.importer}" &&
                    ./aws-api-import.sh --deploy "${stageName}" --update ${matchingAPI.id} "${configuration.api.deployment}"`;
                }

                cp.exec(command, function(error, stdout, stderr) {
                    if (error) {
                        console.error("Failed to deploy API", error);
                        console.error(stdout);
                        console.error(stderr);
                    } else {
                        console.log('\tDone'.green);
                    }

                    callback(error);
                });
            });
        }
    } catch (error) {
        callback(error);
    }
};
