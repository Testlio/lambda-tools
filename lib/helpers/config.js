'use strict';

const fsx = require('./fs-additions');
const path = require('path');
const root = require('find-root');
const _ = require('lodash');

/**
 *  Helper for loading config file of a project
 */

// Load configuration file from disk (if one exists)
let result = {
    project: {},
    aws: {
        region: 'us-east-1',
        stage: 'dev'
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
