#!/usr/bin/env node

"use strict";

const program = require('commander');
const packageVersion = require('../package.json').version;

program
  .version(packageVersion)
  .command('setup', 'setup lambda-tools on AWS')
  .command('deploy', 'deploy Lambda based microservice to AWS')
  .command('deploy-single', 'deploy a single Lambda function to AWS')
  .command('describe', 'describe a Lambda based service')
  .command('run', 'run Lambda based microservice locally', { isDefault: true })
  .command('execute', 'execute a single Lambda function locally')
  .parse(process.argv);
