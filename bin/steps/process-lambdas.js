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
const merge         = require('deepmerge');
const browserify    = require('browserify');
const babelify      = require('babelify');
const presets       = require('babel-preset-es2015');
const uglify        = require('uglify-js');
const sync          = require('synchronize');
const dot           = require('dot');
const Zip           = require('node-zip');

module.exports = function(program, configuration, callback) {
    let stackCF;
    let lambdaCF;
    let lambdaOutputTemplate;

    try {
        stackCF = fsx.readJSONFileSync(configuration.cloudFormation.deployment);
        lambdaCF = fsx.readJSONFileSync(path.join(configuration.directories.working, 'templates/lambda.cf.json'));
        lambdaOutputTemplate = dot.template(fs.readFileSync(path.join(configuration.directories.working, 'templates/lambda.resource.dot'), 'utf8'));
    } catch (error) {
        callback(error, null);
        return;
    }

    let lambdas = fsx.getDirectories(configuration.directories.lambdas);
    for (let lambda of lambdas) {
        let name = path.basename(lambda);
        let camelName = name.camelCase();
        camelName = camelName.charAt(0).toLowerCase() + camelName.substring(1);
        console.log(`Processing "${name}" (${camelName})`);

        // Load in the cloudformation config (if any)
        let lambdaCustomCF = path.join(lambda, 'cf.json');
        let config = lambdaCF;

        if (fsx.fileExists(lambdaCustomCF)) {
            config = merge(lambdaCF, fsx.readJSONFileSync(lambdaCustomCF));
        }

        let handler = config["Properties"]["Handler"].split('.', 1) + '';

        // Add entry to the CF configuration
        config["Properties"]["Code"] = {
            "S3Bucket": configuration.bucket.name,
            "S3Key": configuration.bucket.directory + '/' + name + '.zip'
        };

        stackCF["Resources"][camelName] = config;
        let outputname = 'l' + camelName.charAt(0).toUpperCase() + camelName.substring(1);
        stackCF["Outputs"][outputname] = JSON.parse(lambdaOutputTemplate({name: camelName}));

        // Compress and zip the code
        if (!program.dryRun && !program.skipStack) {
            let handlerFileName = handler + '.js';
            console.log("\tEntry point", handlerFileName);
            let handlerFile = path.join(lambda, handlerFileName);
            let bundledFile = path.join(configuration.directories.staging, handler + '.bundled.js');

            let bundler = new browserify(handlerFile, {
                basedir: lambda,
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

            try {
                console.log('\tBrowserifying');
                let bundled = sync.await(bundler.bundle(sync.defer()));
                fs.writeFileSync(bundledFile, bundled);

                console.log('\tMinifying');
                let minified = uglify.minify(bundledFile, {
                    mangle: false,
                    compress: {}
                }).code;

                fs.unlinkSync(bundledFile);
                zip.file(handlerFileName, minified);
            } catch (error) {
                console.error("\tFailed to compress code".red, error);
                process.exit(5);
            }

            const zippedData = zip.generate({
                type: 'nodebuffer',
                compression: 'DEFLATE'
            });

            fs.writeFileSync(path.join(configuration.directories.staging, name + '.zip'), zippedData);
        }

        console.log('\tDone\n'.green);
    }

    // Store the final CF file along with the zip files
    fs.writeFileSync(configuration.cloudFormation.deployment, JSON.stringify(stackCF));
    callback(null, null);
};
