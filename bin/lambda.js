#!/usr/bin/env node

"use strict";

const program = require('commander');

program
  .version('1.0.0')
  .command('deploy', 'deploy Lambda based microservice to AWS')
  .command('deploy-single', 'deploy a single Lambda function to AWS')
  .command('run', 'run Lambda based microservice locally', { isDefault: true })
  .parse(process.argv);
