"use strict";

const fs = require('fs');
const fsx = require('../helpers/fs-additions');
const path = require('path');
const Promise = require('bluebird');
const _ = require('lodash');

/**
 *  Helper function for populating the context with API spec path and
 *  whether API should be skipped or not
 */
function populateAPIContext(context) {
    return new Promise(function(resolve, reject) {
        process.stdout.write('\tChecking if API spec is present');

        // Make sure the API spec exists
        const appendedContext = {
            api: {

            }
        };

        const apiPath = path.join(context.directories.cwd, 'api.json');
        if (!fsx.fileExists(apiPath)) {
            console.log(' ✖'.red);
            appendedContext.api.configuration = undefined;
            appendedContext.api.skip = true;
        } else {
            console.log(' ✔'.green);

            // Write the API to the staging directory
            const deploymentAPIPath = path.join(context.directories.staging, 'deployment.api.json');
            fs.writeFileSync(deploymentAPIPath, fs.readFileSync(apiPath, 'utf8'));

            appendedContext.api.configuration = deploymentAPIPath;
            appendedContext.api.skip = false;
        }

        resolve(_.assign({}, context, appendedContext));
    });
}

//
// Step that preps the API spec/context for deployment in the next step
//
module.exports = populateAPIContext;
