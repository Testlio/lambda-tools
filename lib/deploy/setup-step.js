"use strict";

const AWS = require('aws-sdk');
const fsx = require('../helpers/fs-additions');
const path = require('path');
const _ = require('lodash');
const os = require('os');

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

function createS3Bucket(context) {
    const bucket = `lambdas-${context.project.name}-${context.project.stage}`;

    return context.logger.task(`Creating S3 bucket '${bucket}'`, function(resolve, reject) {
        const S3 = new AWS.S3({apiVersion: '2006-03-01'});
        S3.createBucket({
            Bucket: bucket
        }, function(err) {
            if (err) {
                return reject(err);
            }

            const ctx = _.clone(context);
            ctx.project.bucket = bucket;

            resolve(ctx);
        });
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
            let handler = 'handler';
            let moduleName = 'index';
            let configPath;

            // Log out the lambda
            context.logger.log(name);

            // Check if there is a configuration file, which may contain customised
            // handler/module name
            const lambdaCustomCF = path.join(lambdaPath, 'cf.json');
            if (fsx.fileExists(lambdaCustomCF)) {
                configPath = lambdaCustomCF;

                const config = fsx.readJSONFileSync(lambdaCustomCF);
                const moduleHandler = _.get(config, 'Properties.Handler', `${moduleName}.${handler}`);

                moduleName = moduleHandler.split('.', 1)[0];
                handler = moduleHandler.split('.', 2)[1];
            }

            return {
                name: name,
                config: configPath,
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
        .then(createS3Bucket)
        .then(resolve, reject);
    });
};
