"use strict";

const program = require('commander');
const chalk = require('chalk');
const logger = require('../lib/helpers/logger').shared;

// Setup is currently a single step process
const createResources = require('../lib/setup/create-cf-resources.js');

//
//  Program specification
//

program
    .option('-r, --region <string>', 'Region to setup in, if not set otherwise, defaults to \'us-east-1\'')
    .option('-p, --resource-prefix <string>', 'Prefix to use with all lambda-tools created AWS resources, defaults to \'\' (empty string)')
    .option('-s, --resource-suffix <string>', 'Suffix to use with all lambda-tools created AWS resources, defaults to \'\' (empty string)')
    .option('--no-color', 'Turn off ANSI coloring in output')
    .parse(process.argv);

chalk.enabled = program.color;

logger.task(`Setting up ${chalk.underline('lambda-tools')}`, function(resolve, reject) {
    createResources(program.region, program.resourcePrefix, program.resourceSuffix).then(resolve, reject);
});
