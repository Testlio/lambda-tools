'use strict';

const AWS = require('aws-sdk');
AWS.config.logger = process.stdout;

const S3 = new AWS.S3({ apiVersion: '2006-03-01' });
const fs = require('fs');

module.exports = {

    /**
     *  Download a file from remote bucket to a local path
     *
     *  @return {Promise} which resolves to the local path the file was saved to
     */
    downloadFile: function(bucket, key, version, localPath) {
        return S3.getObject({
            Bucket: bucket,
            Key: key,
            VersionId: version
        }).promise().then(function(data) {
            return new Promise(function(resolve, reject) {
                fs.writeFile(localPath, data.Body, function(err) {
                    if (err) return reject(err);
                    resolve(localPath);
                });
            });
        });
    },

    /**
     *  Execute a HEAD operation on a specific key in a bucket. The request
     *  can also contain an optional version for the file
     *
     *  @returns {Promise} which resolves to the response data for the request
     */
    headFile: function(bucket, key, version) {
        return S3.headObject({
            Bucket: bucket,
            Key: key,
            VersionId: version
        }).promise();
    }
};
