"use strict";

require('colors');
const AWS = require('aws-sdk');
const fs = require('fs');
const Promise = require('bluebird');

//
//  Step that loops over Lambdas and updates their respective functions' code
//
module.exports = function(context) {
    const Lambda = new AWS.Lambda();

    return new Promise(function(resolve) {
        console.log('\nUpdating Lambda code');
        resolve(context);
    }).then(function(context) {
        return Promise.mapSeries(context.lambdas, function(lambda) {
            return new Promise(function(resolve, reject) {
                process.stdout.write(`\tUploading code for ${lambda.name}`);

                fs.readFile(lambda.zip, function(err, data) {
                    if (err) {
                        console.log(' ✖'.red);
                        return reject(err);
                    }

                    Lambda.updateFunctionCode({
                        FunctionName: lambda.name,
                        Publish: !!lambda.publish,
                        ZipFile: data
                    }, function(err, data) {
                        if (err) {
                            console.log(' ✖'.red);
                            return reject(err);
                        }

                        console.log(' ✔'.green);
                        resolve(data);
                    });
                });
            });
        });
    }).then(function(results) {
        return context;
    });
};
