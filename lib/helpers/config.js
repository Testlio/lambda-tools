'use strict';

const Configstore = require('configstore');
const fsx = require('./fs-additions');
const path = require('path');
const root = require('find-root');
const _ = require('lodash');

// Information about LT itself
const pkg = require('../../package.json');
const majorVersion = pkg.version ? pkg.version.split('.')[0] : 'unknown';
const resourcePrefix = _.compact([pkg.name, majorVersion]).join('-');

const bucketPrefix = (new Configstore(pkg.name)).get('S3BucketPrefix');

/**
 *  Helper for loading config file of a project
 */

// Load configuration file from disk (if one exists)
// Default values
let result = {
    project: {},
    lambda: {
        runtime: 'nodejs'
    },
    aws: {
        region: 'us-east-1',
        stage: 'dev'
    },
    tools: {
        name: pkg.name,
        version: pkg.version,
        majorVersion: majorVersion,
        resources: {
            s3Bucket: _.compact([bucketPrefix, resourcePrefix, 'assets']).join('-'),
            iamRole: [resourcePrefix, 'resource'].join('-'),
            apiGateway: [resourcePrefix, 'api-gateway'].join('-'),
            lambdaVersion: [resourcePrefix, 'lambda-version'].join('-')
        }
    }
};

// Config file is assumed to be at "package root"
try {
    const rootPath = root(process.cwd());
    const configPath = path.resolve(rootPath, '.lambda-tools-rc.json');

    if (fsx.fileExists(configPath)) {
        result = _.merge(result, fsx.readJSONFileSync(configPath));
    }
} catch (err) {
    // Ignore
}

module.exports = result;
