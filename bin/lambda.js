#!/usr/bin/env node

"use strict";

const program = require('commander');

program
  .version('1.0.0')
  .command('deploy', 'deploy Lambdas to AWS')
  .command('run', 'run Lambdas locally')
  .parse(process.argv);
