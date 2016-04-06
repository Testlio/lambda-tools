'use strict';

const chalk = require('chalk');

/**
 *  Returns rainbow colored ASCII art title
 *  of #lambdahype that can be used in the CLI
 */
module.exports =
    chalk.red('\n\n     __ __   __                   __         __        __                      ') +
    chalk.yellow('\n  __/ // /_ / /____ _ ____ ___   / /_   ____/ /____ _ / /_   __  __ ____   ___ ') +
    chalk.green('\n /_  _  __// // __ `// __ `__ \\ / __ \\ / __  // __ `// __ \\ / / / // __ \\ / _ \\') +
    chalk.cyan('\n/_  _  __// // /_/ // / / / / // /_/ // /_/ // /_/ // / / // /_/ // /_/ //  __/') +
    chalk.magenta('\n /_//_/  /_/ \\__,_//_/ /_/ /_//_.___/ \\__,_/ \\__,_//_/ /_/ \\__, // .___/ \\___/ ') +
    chalk.magenta('\n                                                          /____//_/            \n');
