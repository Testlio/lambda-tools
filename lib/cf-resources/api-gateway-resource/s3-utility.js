'use strict';

const AWS = require('aws-sdk');
AWS.config.logger = process.stdout;

const S3 = new AWS.S3({ apiVersion: '2006-03-01' });
const Promise = require('bluebird');
const fs = Promise.promisifyAll(require('fs'));

module.exports = {
    downloadFile: function(bucket, key, version, localPath) {
        return S3.getObject({
            Bucket: bucket,
            Key: key,
            VersionId: version
        }).promise().then(function(data) {
            return fs.writeFileAsync(localPath, data.Body).then(function() {
                return localPath;
            });
        });
    },

    headFile: function(bucket, key, version) {
        return S3.headObject({
            Bucket: bucket,
            Key: key,
            VersionId: version
        }).promise();
    }
};
