"use strict";

const program = require('commander');

// Setup is currently a single step process
const createAPIGateway = require('../lib/setup/create-api-gateway-lambda.js');

//
//  Program specification
//

program
    .option('-r, --region <string>', 'Region to setup in, if not set otherwise, defaults to \'us-east-1\'')
    .parse(process.argv);

console.log('Setting up lambda-tools');
console.log('Please make sure you have configured your AWS credentials');
console.log('Use \'aws configure\' if you haven\'t done so');

createAPIGateway(program.region);
