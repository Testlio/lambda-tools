"use strict";

//
//  Processing Lambda functions, including compressing and combining
//  them into a single JS file. Results in a set of zip files in the
//  staging directory along with a preliminary CF template file
//

require('../helpers/string_additions');
const fs            = require('fs');
const fsx           = require('../helpers/fs_additions');
const colors        = require('colors');
const path          = require('path');
const browserify    = require('browserify');
const babelify      = require('babelify');
const presets       = require('babel-preset-es2015');
const uglify        = require('uglify-js');
const dot           = require('dot');
const Zip           = require('node-zip');
const async         = require('async');
const _             = require('lodash');

//
//  Processing helper, results in an object that can be used to
//  further flesh out the CF stack
//
//  { name: ..., output: ..., resource: ... }
//
function processLambda(program, configuration, baseResource, outputTemplate, lambdaPath, callback) {
    let name = path.basename(lambdaPath);
    let camelName = name.camelCase();
    camelName = camelName.charAt(0).toLowerCase() + camelName.substring(1);
    console.log(`Processing "${name}" (${camelName})`);

    // Load in the cloudformation config (if any)
    let lambdaCustomCF = path.join(lambdaPath, 'cf.json');
    let config = _.clone(baseResource, true);

    if (fsx.fileExists(lambdaCustomCF)) {
        _.merge(config, fsx.readJSONFileSync(lambdaCustomCF));
    }

    let handler = config["Properties"]["Handler"].split('.', 1) + '';

    // Build the result object for this Lambda
    config["Properties"]["Code"] = {
        "S3Bucket": configuration.bucket.name,
        "S3Key": configuration.bucket.directory + '/' + name + '.zip'
    };

    let result = {
        name: camelName,
        output: JSON.parse(outputTemplate({name: camelName})),
        resource: config
    };

    // Compress and zip the code
    if (!program.dryRun && !program.skipStack) {
        let handlerFileName = handler + '.js';
        console.log("\tEntry point", handlerFileName);
        let handlerFile = path.join(lambdaPath, handlerFileName);
        let bundledFile = path.join(configuration.directories.staging, handler + '.bundled.js');

        let bundler = new browserify(handlerFile, {
            basedir: lambdaPath,
            standalone: handler,
            browserField: false,
            builtins: false,
            commondir: false,
            ignoreMissing: true,
            detectGlobals: true,
            insertGlobalVars: {
                process: function() {}
            }
        });

        bundler.exclude('aws-sdk');
        bundler.transform(babelify, {
            presets: [presets],
            compact: false,
            global: true,
            ignore: /\/node_modules\/(lambda_deployment|\.bin)\/.*/
        });

        // Build the ZIP file we need
        let zip = new Zip();
        zip.file('.env', program.flatEnvironment);

        console.log('\tBrowserifying');
        bundler.bundle(function(err, bundled) {
            if (err) {
                console.error("\tFailed to compress code".red, error);
                return callback(err);
            }

            fs.writeFileSync(bundledFile, bundled);

            console.log('\tMinifying');
            let minified = uglify.minify(bundledFile, {
                mangle: false,
                compress: {}
            }).code;

            fs.unlinkSync(bundledFile);
            zip.file(handlerFileName, minified);

            const zippedData = zip.generate({
                type: 'nodebuffer',
                compression: 'DEFLATE'
            });

            fs.writeFileSync(path.join(configuration.directories.staging, name + '.zip'), zippedData);
            console.log('\tDone\n'.green);

            callback(null, result);
        });
    } else {
        callback(null, result);
    }
}

module.exports = function(program, configuration, callback) {
    let stackCF;
    let lambdaCF;
    let lambdaOutputTemplate;

    try {
        lambdaOutputTemplate = dot.template(fs.readFileSync(path.join(configuration.directories.working, 'templates/lambda.resource.dot'), 'utf8'));
        stackCF = fsx.readJSONFileSync(configuration.cloudFormation.deployment);
        lambdaCF = fsx.readJSONFileSync(path.join(configuration.directories.working, 'templates/lambda.cf.json'));
    } catch (error) {
        callback(error, null);
        return;
    }

    let lambdas = fsx.getDirectories(configuration.directories.lambdas).map(function(lambda) {
        return function(callback) {
            processLambda(program, configuration, lambdaCF, lambdaOutputTemplate, lambda, callback);
        };
    });

    async.series(lambdas, function(err, results) {
        if (err) return callback(err);

        for (let result of results) {
            stackCF["Resources"][result.name] = result.resource;

            let outputName = 'l' + result.name.charAt(0).toUpperCase() + result.name.substring(1);
            stackCF["Outputs"][outputName] = result.output;
        }

        // Store the final CF file along with the zip files
        fs.writeFileSync(configuration.cloudFormation.deployment, JSON.stringify(stackCF));
        callback();
    });
};
