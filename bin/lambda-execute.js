"use strict";

const chalk = require('chalk');
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
    .option('--no-color', 'Turn off ANSI coloring in output')
    .parse(process.argv);

chalk.enabled = program.color;

// Determine our target directory
program.directory = cwd;

const event = fsx.readJSONFileSync(program.event);
const context = {
    functionName: path.basename(program.file),
    invokedFunctionArn: '$LATEST',
    memoryLimitInMB: '1024',
    timeout: program.timeout
};

console.log(chalk.bold.green('Executing Lambda function'));
console.log('File: ' + chalk.yellow(program.file) + ', Event: ' + chalk.yellow(program.event));
console.log('\tWith event:');
console.log('\t' + JSON.stringify(event, null, '\t').split('\n').join('\n\t'), '\n');
console.log(chalk.gray('\t--'));

const promise = Execution(program.file, event, context, program.environment).next().value;

promise.then(function(result) {
    console.log(chalk.gray('\t--'));
    console.log(chalk.bold.green('Lambda executed'));
    console.log(chalk.gray('\t--'));

    console.log('Result:', result);
}).catch(function(error) {
    console.log(chalk.gray('\t--'));
    console.log(chalk.bold.red('Lambda failed'));
    console.log(chalk.gray('\t--'));

    console.error('Error: ', error.message);
});
