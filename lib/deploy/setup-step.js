"use strict";

const path = require('path');
const _ = require('lodash');
const os = require('os');

const configuration = require('../helpers/config');
const fsx = require('../helpers/fs-additions');

function prepareStagingDirectory(context) {
    // Located temp directory for staging (make sure it exists)
    const directoryName = `lambda-tools-${context.project.name}-${context.project.stage}`;
    const stagingDirectory = path.resolve(os.tmpdir(), directoryName);
    const taskName = `Creating staging directory at ${stagingDirectory}`;

    return context.logger.task(taskName, function() {
        fsx.ensureDirectory(stagingDirectory);

        const newCtx = _.clone(context);
        newCtx.directories.staging = stagingDirectory;

        return newCtx;
    });
}

function listLambdas(context) {
    return context.logger.task('Listing lambdas', function() {
        // Check if Lambdas directory exists
        const lambdasDirectory = path.resolve(context.directories.cwd, 'lambdas');
        if (!fsx.directoryExists(lambdasDirectory)) {
            throw new Error('Lambdas directory does not exist');
        }

        // Parse the contents into the context
        const lambdas = fsx.getDirectories(lambdasDirectory).map(function(lambdaPath) {
            // Extract the name of the lambda (the name of the directory)
            const name = path.basename(lambdaPath);
            let config = fsx.readJSONFileSync(path.join(context.directories.root, 'templates/lambda.cf.json'));
            let assets = {};

            // Log out the lambda
            context.logger.log(name);

            // Update Runtime (if we have a match from configuration)
            const runtime = _.get(configuration, 'lambda.runtime');
            if (runtime) {
                _.set(config, 'Properties.Runtime', runtime);
            }

            // Check if there is a configuration file, which may override various
            // properties of the Lambda function
            const lambdaCustomCF = path.join(lambdaPath, 'cf.json');
            if (fsx.fileExists(lambdaCustomCF)) {
                const customConfig = fsx.readJSONFileSync(lambdaCustomCF);

                // Merge into config, only picking out the Properties key
                // to avoid custom config overriding anythign other than that
                config = _.merge(config, _.pick(customConfig, 'Properties'));

                // Check if we have any assets that need to be included in the
                // Lambda function bundle
                assets = _.merge(assets, customConfig.Assets);
            }

            // Derive the module name and handler function
            const moduleName = config.Properties.Handler.split('.')[0];
            const handler = config.Properties.Handler.split('.')[1];

            // Determine the locations in S3 we will upload the files to
            config['Properties']['Code'] = {
                S3Bucket: [configuration.tools.resources.s3Bucket, context.project.region].join('-'),
                S3Key: [context.project.name, context.project.stage, context.project.timestamp, name + '.zip'].join('/')
            };

            return {
                name: name,
                config: config,
                assets: assets,
                module: moduleName,
                handler: handler,
                path: path.resolve(lambdaPath, `${moduleName}.js`)
            };
        });

        const newCtx = _.clone(context);
        newCtx.lambdas = lambdas;

        return newCtx;
    });
}

//
// Setup step for populating the context and doing some preliminary checks
//
module.exports = function(context) {
    return context.logger.task('Preparing stage', function(resolve, reject) {
        prepareStagingDirectory(context)
        .then(listLambdas)
        .then(resolve, reject);
    });
};
