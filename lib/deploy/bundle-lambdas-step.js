"use strict";

require('colors');
const Browserify = require('browserify');
const babelify = require('babelify');
const envify = require('envify');
const fs = require('fs');
const path = require('path');
const presets = require('babel-preset-es2015');
const Promise = require('bluebird');
const uglify = require('uglify-js');
const Zip = require('node-zip');
const _ = require('lodash');

//
// Step that takes lambdas in the context and processes them into
// uploadable zips in the staging directory
//
module.exports = function(context) {
    // Process all lambdas (serially so that we can output nicely)
    return Promise.mapSeries(context.lambdas, function(lambda) {
        const bundledPath = path.resolve(context.directories.staging, lambda.name + '.bundled.js');
        const zippedPath = path.resolve(context.directories.staging, lambda.name + '.zip');

        return bundleLambda(lambda, context.program.environment, bundledPath).then(function(zippedData) {
            return writeDataToFile(zippedData, zippedPath);
        }).then(function(zipPath) {
            return _.assign({}, lambda, {
                zip: zipPath
            });
        });
    }).then(function(newLambdas) {
        return _.assign({}, context, {
            lambdas: newLambdas
        });
    });
};

function bundleLambda(lambda, environment, bundledPath) {
    const lambdaPath = lambda.path;
    const lambdaName = lambda.name;

    const bundler = new Browserify(lambdaPath, {
        basedir: path.dirname(lambdaPath),
        standalone: lambdaName,
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
        ignore: /\/node_modules\/\.bin\/.*/
    });

    const env = {
        _: 'purge'
    };
    _.merge(env, environment);
    bundler.transform(envify, env);

    return new Promise(function(resolve, reject) {

        console.log(`\nProcessing ${lambdaName}`);

        process.stdout.write('\tBundling');
        bundler.bundle(function(err, bundled) {
            if (err) {
                console.log(' ✖'.red);
                return reject(err);
            } else {
                console.log(' ✔'.green);
            }

            fs.writeFileSync(bundledPath, bundled);

            process.stdout.write('\tMinifying');
            const minified = uglify.minify(bundledPath, {
                mangle: false,
                compress: {}
            }).code;

            if (!minified) {
                console.log(' ✖'.red);
                return reject(new Error('Minification failed'));
            } else {
                console.log(' ✔'.green);
            }

            const zip = new Zip();
            fs.unlinkSync(bundledPath);
            zip.file(path.basename(lambdaPath), minified);

            process.stdout.write('\tCompressing');
            const zippedData = zip.generate({
                type: 'nodebuffer',
                compression: 'DEFLATE'
            });

            if (!zippedData) {
                console.log(' ✖'.red);
                return reject(new Error('Compression failed'));
            } else {
                console.log(' ✔'.green);
            }

            resolve(zippedData);
        });
    });
}

function writeDataToFile(data, filePath) {
    return new Promise(function(resolve, reject) {
        fs.writeFile(filePath, data, function(err) {
            if (err) return reject(err);
            resolve(filePath);
        });
    });
}
