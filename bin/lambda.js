#!/usr/bin/env node

"use strict";

const program = require('commander');
const pkg = require('../package.json');
const packageVersion = pkg.version;

const updater = require('update-notifier');

// Check for updates and notify
updater({
    pkg: pkg,
    updateCheckInterval: 21600000 // 6h
}).notify();

program
  .version(packageVersion)
  .command('setup', 'setup lambda-tools on AWS')
  .command('deploy', 'deploy Lambda based microservice to AWS')
  .command('deploy-single', 'deploy a single Lambda function to AWS')
  .command('describe', 'describe a Lambda based service')
  .command('run', 'run Lambda based microservice locally', { isDefault: true })
  .command('execute', 'execute a single Lambda function locally')
  .parse(process.argv);
