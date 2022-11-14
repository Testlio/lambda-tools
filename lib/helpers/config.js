'use strict';

const Configstore = require('configstore');
const fsx = require('./fs-additions');
const path = require('path');
const root = require('find-root');
const _ = require('lodash');

// Information about LT itself
const pkg = require('../../package.json');
const conf = new Configstore(pkg.name);
const majorVersion = pkg.version ? pkg.version.split('.')[0] : 'unknown';
const resourceNamePrefix = _.compact([conf.get('ResourcePrefix'), pkg.name, majorVersion, conf.get('ResourceSuffix')]).join('-');

/**
 *  Helper for loading config file of a project
 */

// Load configuration file from disk (if one exists)
// Default values
let result = {
    project: {},
    lambda: {
        runtime: 'nodejs16.x'
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
            s3Bucket: [resourceNamePrefix, 'assets'].join('-'),
            iamRole: [resourceNamePrefix, 'resource'].join('-'),
            apiGateway: [resourceNamePrefix, 'api-gateway'].join('-'),
            lambdaVersion: [resourceNamePrefix, 'lambda-version'].join('-')
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
