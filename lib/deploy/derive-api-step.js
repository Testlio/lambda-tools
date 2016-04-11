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

            // Read in the Swagger file
            const apiDefinition = fsx.readJSONFileSync(apiPath);

            // Update the title to match the service name from context
            // (We do similar step with cf.json, so it makes sense to also do it with api.json)
            apiDefinition.info.title = context.project.name;

            // Write the spec back
            fs.writeFileSync(deploymentAPIPath, JSON.stringify(apiDefinition, null, 4));

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
