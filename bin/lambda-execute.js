"use strict";

require('colors');

const fsx = require('../lib/helpers/fs-additions');
const program = require('commander');
const parseEnvironment = require('../lib/helpers/environment-parser.js');
const parsePath = require('../lib/helpers/path-parser.js');
const path = require('path');

const Execution = require('../lib/run/execution');
const cwd = process.cwd();

//
//  Program specification
//

program
    .option('-f, --file <file>', 'Path to the Lambda function entry point, defaults to \'index.js\'', parsePath, path.resolve(cwd, 'index.js'))
    .option('-e, --event <file>', 'Path to the event JSON file, defaults to \'event.json\'', parsePath, path.resolve(cwd, 'event.json'))
    .option('--env, --environment <env>', 'Environment Variables to embed as key-value pairs', parseEnvironment, {})
    .option('-t, --timeout <timeout>', 'Timeout value for the Lambda function', 6)
    .parse(process.argv);

// Determine our target directory
program.directory = cwd;

const event = fsx.readJSONFileSync(program.event);
const context = {
    functionName: path.basename(program.file),
    invokedFunctionArn: '$LATEST',
    memoryLimitInMB: '1024',
    timeout: program.timeout
};

console.log('Executing Lambda function'.bold.green);
console.log('File: ' + program.file.yellow + ', Event: ' + program.event.yellow);
console.log('\tWith event:');
console.log('\t' + JSON.stringify(event, null, '\t').split('\n').join('\n\t'), '\n');
console.log('\t--'.gray);

let promise = Execution(program.file, event, context, program.environment).next().value;

promise.then(function(result) {
    console.log('\t--'.gray);
    console.log('Lambda executed'.bold.green);
    console.log('\t--'.gray);

    console.log('Result:', result);
}).catch(function(error) {
    console.log('\t--'.gray);
    console.log('Lambda failed'.bold.red);
    console.log('\t--'.gray);

    console.error('Error: ', error);
});
