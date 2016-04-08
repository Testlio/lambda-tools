"use strict";

const AWS = require('aws-sdk');
const cp = require('child_process');
const fsx = require('../helpers/fs-additions');
const path = require('path');
const Promise = require('bluebird');
const _ = require('lodash');
const os = require('os');

function checkAvailability(command) {
    return new Promise(function(resolve, reject) {
        cp.exec(`command -v ${command}`, function(error, stdout) {
            if (error !== null) {
                return reject(error);
            }

            resolve(stdout.toString());
        });
    });
}

function prepareStagingDirectory(context) {
    // Located temp directory for staging (make sure it exists)
    const directoryName = `lambda-tools-${context.project.name}-${context.project.stage}`;
    const stagingDirectory = path.resolve(os.tmpdir(), directoryName);
    const taskName = `Creating staging directory at ${stagingDirectory}`;

    return context.logger.task(taskName, function() {
        fsx.ensureDirectory(stagingDirectory);
        return stagingDirectory;
    });
}

function createS3Bucket(context) {
    const bucket = `lambdas-${context.project.name}-${context.project.stage}`;

    return context.logger.task(`Creating S3 bucket '${bucket}'`, function(resolve, reject) {
        const S3 = new AWS.S3({apiVersion: '2006-03-01'});
        S3.createBucket({
            Bucket: bucket
        }).send(function(err) {
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
    return new Promise(function(resolve, reject) {
        // Check if Lambdas directory exists
        const lambdasDirectory = path.resolve(context.directories.cwd, 'lambdas');
        if (!fsx.directoryExists(lambdasDirectory)) {
            return reject(new Error('Lambdas directory does not exist'));
        }

        // Parse the contents into the context
        const lambdaPaths = fsx.getDirectories(lambdasDirectory);
        const lambdas = lambdaPaths.map(function(lambdaPath) {
            // Extract the name of the lambda (the name of the directory)
            const name = path.basename(lambdaPath);
            let handler = 'handler';
            let moduleName = 'index';
            let configPath;

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

        resolve(lambdas);
    });
}

//
// Setup step for populating the context and doing some preliminary checks
//
module.exports = function(context) {
    return context.logger.task('Preparing stage', function(resolve, reject) {
        Promise.all([
            checkAvailability('aws'),
            checkAvailability('java'),
            prepareStagingDirectory(context),
            listLambdas(context)
        ]).then(function (results) {
            const newContext = _.assign({}, context);

            newContext.directories.staging = results[2];
            newContext.lambdas = results[3];

            return newContext;
        }).then(createS3Bucket).then(resolve, reject);
    });
};
