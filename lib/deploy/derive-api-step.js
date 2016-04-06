"use strict";

const fs = require('fs');
const fsx = require('../helpers/fs-additions');
const path = require('path');
const _ = require('lodash');

/**
 *  Helper function for populating the context with API spec path and
 *  whether API should be skipped or not
 */
function populateAPIContext(context) {
    return context.logger.task('Deriving API', function() {
        // Make sure the API spec exists
        const appendedContext = {
            api: {

            }
        };

        const apiPath = path.join(context.directories.cwd, 'api.json');
        if (!fsx.fileExists(apiPath)) {
            context.logger.log('API spec missing, skipping');
            appendedContext.api.configuration = undefined;
            appendedContext.api.skip = true;
        } else {
            // Write the API to the staging directory
            const deploymentAPIPath = path.join(context.directories.staging, 'deployment.api.json');
            fs.writeFileSync(deploymentAPIPath, fs.readFileSync(apiPath, 'utf8'));

            appendedContext.api.configuration = deploymentAPIPath;
            appendedContext.api.skip = false;
        }

        return _.assign({}, context, appendedContext);
    });
}

//
// Step that preps the API spec/context for deployment in the next step
//
module.exports = populateAPIContext;
