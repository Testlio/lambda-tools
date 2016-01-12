"use strict";

require('colors');

const fsx = require('../lib/helpers/fs-additions');
const program = require('commander');
const parseEnvironment = require('../lib/helpers/environment-parser.js');
const path = require('path');

const Execution = require('../lib/run/execution');

//
//  Program specification
//

program
    .option('-f, --file <file>', 'Path to the Lambda function entry point')
    .option('-e, --event <file>', 'Path to the event JSON file, defaults to \'./event.json\'')
    .option('--environment <env>', 'Environment Variables to embed as key-value pairs', parseEnvironment)
    .option('-t, --timeout <timeout>', 'Timeout value for the Lambda function')
    .parse(process.argv);

// Determine our target directory
program.directory = process.cwd();

// Default values for params
program.environment = program.environment || {};
program.timeout = program.timeout || 6;
program.file = program.file || 'index.js';
program.event = program.event || 'event.json';

program.file = path.resolve(program.directory, program.file);
program.event = path.resolve(program.directory, program.event);
this.program = program;

const event = fsx.readJSONFileSync(program.event);
const context = {
    functionName: path.basename(program.file),
    invokedFunctionArn: '$LATEST',
    memoryLimitInMB: '1024',
    timeout: program.timeout
};

console.log('Executing Lambda function'.bold.green);
console.log('\tWith event:');
console.log(JSON.stringify(event, null, '\t').split('\n').join('\n\t'), '\n');
console.log('\t--'.gray);

let promise = Execution.bind(this)(program.file, event, context).next().value;

promise.then(function(result) {
    console.log('\t--'.gray);
    console.log('Lambda executed');
    console.log('\t--'.gray);
    console.log('Result:', result);
}).catch(function(error) {
    console.log('Lambda failed'.bold.red);
    console.error(error);
});
