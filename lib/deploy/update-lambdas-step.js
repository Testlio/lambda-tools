"use strict";

const AWS = require('aws-sdk');
const fs = require('graceful-fs');
const Promise = require('bluebird');

//
//  Step that loops over Lambdas and updates their respective functions' code
//
module.exports = function(context) {
    const Lambda = new AWS.Lambda();

    return context.logger.task('Updating Lambda code', function(resolve, reject) {
        return Promise.mapSeries(context.lambdas, function(lambda) {
            return context.logger.task(lambda.name, function(res, rej) {
                fs.readFile(lambda.zip, function(err, data) {
                    if (err) {
                        return rej(err);
                    }

                    Lambda.updateFunctionCode({
                        FunctionName: lambda.name,
                        Publish: !!lambda.publish,
                        ZipFile: data
                    }, function(innerErr, innerData) {
                        if (innerErr) {
                            return rej(innerErr);
                        }

                        res(innerData);
                    });
                });
            });
        }).then(resolve, reject);
    }).then(function() {
        return context;
    });
};
