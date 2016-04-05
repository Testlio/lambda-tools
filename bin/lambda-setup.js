"use strict";

const program = require('commander');
const chalk = require('chalk');
const logger = require('../lib/helpers/logger').shared;

// Setup is currently a single step process
const createAPIGateway = require('../lib/setup/create-api-gateway-lambda.js');

//
//  Program specification
//

program
    .option('-r, --region <string>', 'Region to setup in, if not set otherwise, defaults to \'us-east-1\'')
    .parse(process.argv);

const task = logger.task(`Setting up ${chalk.underline('lambda-tools')}`);
createAPIGateway(program.region).then(function() {
    task.finish();
    logger.end();
}, function(err) {
    logger.error(err);
    task.finish(err);
    logger.end();
});
