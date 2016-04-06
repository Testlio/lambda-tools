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


logger.task(`Setting up ${chalk.underline('lambda-tools')}`, function(resolve, reject) {
    createAPIGateway(program.region).then(resolve, reject);
});
