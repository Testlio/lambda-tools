'use strict';

const _ = require('lodash');
const AWS = require('aws-sdk');
const response = require('cfn-response');
const lambda = new AWS.Lambda();

// Helpers

/**
 * Get function configuration by its name
 *
 * @return {Promise} which resolves into the function configuration
 */
function getFunction(name) {
    return new Promise((resolve, reject) => {
        lambda.getFunctionConfiguration({
            FunctionName: name
        }, function(err, data) {
            if (err) return reject(err);
            resolve(data);
        });
    });
}

/**
 * Get all function versions
 *
 * @return {Promise} which resolves into an array of version configurations
 */
function getFunctionVersions(name, marker) {
    // Grab functions
    return new Promise((resolve, reject) => {
        lambda.listVersionsByFunction({
            FunctionName: name,
            Marker: marker
        }, function(err, data) {
            if (err) return reject(err);

            // Check if we can grab even more
            if (data.NextMarker) {
                return getFunctionVersions(name, data.NextMarker).then((versions) => {
                    return data.Versions.concat(versions);
                });
            }

            resolve(data.Versions);
        });
    });
}

/**
 * Publish a new Lambda function version
 *
 * @return {Promise} which resolves into the newly published version
 */
function functionPublishVersion(name, description, hash) {
    return new Promise((resolve, reject) => {
        lambda.publishVersion({
            FunctionName: name,
            Description: description,
            CodeSha256: hash
        }, function(err, data) {
            if (err) return reject(err);
            resolve(data);
        });
    });
}

exports.handler = function(event, context) {
    // Determine the nature of this request
    const command = event.RequestType;

    // Log the event (this will help debugging)
    console.log('Handle ' + command + ' request');  // eslint-disable-line no-console
    console.log('Event', JSON.stringify(event, null, 4));  // eslint-disable-line no-console

    // Validate context
    if (!event) {
        console.error(new Error('Context MUST have an event'));
        return response.send(event, context, response.FAILED, {});
    }

    const properties = event.ResourceProperties;

    if (!properties) {
        console.error(new Error('Context event must have a \'ResourceProperties\' key'));
        return response.send(event, context, response.FAILED, {});
    }

    // Ignore delete event
    if (command === 'Delete') {
        console.log('Ignore delete event');
        return response.send(event, context, response.SUCCESS, {});
    }

    // Grab the function first
    getFunction(properties.FunctionName).then(function(fn) {
        // Then grab all versions
        return getFunctionVersions(fn.FunctionName).then((versions) => {
            // Try to find one that matches the function configuration
            versions = versions.filter((version) => {
                // Ignore the latest pseudo-version
                return version.Version !== '$LATEST';
            });

            const trimmedFn = _.pick(fn, 'LastModified');
            return {
                fn: fn,
                version: _.find(versions, trimmedFn)
            };
        });
    }).then((results) => {
        const fn = results.fn;
        const version = results.version;

        if (!version) {
            console.log('Publish a new version');
            return functionPublishVersion(fn.FunctionName, properties.Description, properties.CodeSha256);
        }

        return version;
    }).then((version) => {
        // Make sure the Arn property is populated
        version.Arn = version.FunctionArn;
        response.send(event, context, response.SUCCESS, version, version.FunctionArn);
    }).catch((err) => {
        console.error('Error', err);
        response.send(event, context, response.FAILED, {});
    });
};
