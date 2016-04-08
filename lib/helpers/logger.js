'use strict';

/**
 *  Logger helper, which allows keeping track of "tasks" and helps with nesting
 *  log statements
 */

const cursor = require('ansi')(process.stdout);
const newlines = require('./newlines.js');
const chalk = require('chalk');
const _ = require('lodash');
const tty = require('tty');
const Promise = require('bluebird');

// Helper for obtaining cursor position
function getPosition() {
    const ttyRaw = function(mode) {
        if (process.stdin.setRawMode) {
            process.stdin.setRawMode(mode);
        } else {
            tty.setRawMode(mode);
        }
    };

    return new Promise(function(resolve, reject) {
        // listen for the queryPosition report on stdin
        process.stdin.resume();
        ttyRaw(true);

        process.stdin.once('data', function (b) {
            // cleanup and close stdin
            ttyRaw(false);
            process.stdin.pause();

            const match = /\[(\d+)\;(\d+)R$/.exec(b.toString());
            if (match) {
                const xy = match.slice(1, 3).reverse().map(Number);
                resolve({ x: xy[0], y: xy[1] });
            } else {
                reject(new Error('Failed to obtain cursor position'));
            }
        });

        // Send the query position request code to stdout
        cursor.queryPosition();
    });
}

// Internal helper for logging stuff out
function log(fn, args, indent) {
    if (args.length === 0) {
        return;
    }

    // Assumes args are something you would pass into console.log
    // Applies appropriate nesting
    const indentation = _.repeat('\t', indent);

    // Prepend tabs to first arg (if string)
    if (_.isString(args[0])) {
        args[0] = indentation + args[0];
    } else {
        args.splice(0, 0, indentation);
    }

    fn.apply(this, args);
}

/**
 *  Creating a new logger
 */
const Logger = function() {
    // A stack, latest task is the last item in the array
    this.tasks = [];
    this.currentLine = 0;

    // Keeping track of current line in the log
    // Shadow stdout.write and stderr.write
    newlines(process.stdout);
    newlines(process.stderr);
    process.stderr.on('newline', function() {
        this.currentLine++;
    }.bind(this));
    process.stdout.on('newline', function() {
        this.currentLine++;
    }.bind(this));

    // Functions to expose
    this.log = function() {
        // Similar to console.log, but nested appropriately
        const args = [].slice.call(arguments);
        log(console.log, args, this.tasks.length);
    };

    this.error = function() {
        // Similar to console.error, but nested appropriately
        const args = [].slice.call(arguments);
        log(console.error, args, this.tasks.length);
    };

    /**
     *  Task tracking, acts almost like a wrapper around Promise(func(resolve, reject))
     *  If the passed in function takes no arguments, then it is assumed to be a sync
     *  call that may throw (reject) or return a value (resolve)
     *
     *  @returns Promise that resolves/rejects as if the contents, but adds some
     *  logging logic around it
     */
    this.task = function(taskName, taskFunction) {
        const indentation = this.tasks.length;
        const lines = indentation === 0 ? 1 : 0;

        // Push a simple task object to the queue
        const task = {
            name: taskName,
            line: this.currentLine + lines,
            indentation: indentation
        };

        const introLine = `${_.repeat('\t', indentation)}${taskName}`;

        const finish = function(t, succeed, err) {
            return new Promise(function(resolve, reject) {
                const idx = _.findIndex(this.tasks, t);
                if (idx === -1) {
                    return reject(new Error('Task is not part of the logger'));
                }

                // Calculate delta in number of rows we need to move up
                const delta = this.currentLine - t.line;
                let newIntroline;

                if (succeed) {
                    newIntroline = `${introLine} ${chalk.green('✔')}`;
                } else if (err) {
                    newIntroline = `${introLine} ${chalk.red('✖')} ${err.message}`;
                } else {
                    newIntroline = `${introLine} ${chalk.red('✖')}`;
                }

                return getPosition().then(function(pos) {
                    cursor.up(delta).eraseLine().write(newIntroline).down(delta).horizontalAbsolute(pos.x);

                    // Remove from tasks
                    this.tasks.splice(idx, 1);
                }.bind(this)).then(resolve);
            }.bind(this));
        }.bind(this);

        return new Promise(function(resolve, reject) {
            // If there are currently no tasks, add an empty line
            // (top-level or first tasks are separated by empty lines)
            if (this.tasks.length === 0) {
                cursor.write('\n');
            }

            // Print out the task name
            cursor.write(`${introLine}\n`);

            // Add to the tasks array
            this.tasks.push(task);

            if (taskFunction.length === 0) {
                // Sync task
                try {
                    const result = taskFunction();
                    finish(task, true, null).then(function() {
                        resolve(result);
                    });
                } catch (err) {
                    finish(task, false, err).then(function() {
                        reject(err);
                    });
                }
            } else {
                // Async task
                const res = function(value) {
                    finish(task, true, null).then(function() {
                        resolve(value);
                    });
                };

                const rej = function(err) {
                    finish(task, false, err).then(function() {
                        reject(err);
                    });
                };

                taskFunction(res, rej);
            }
        }.bind(this));
    };

    return this;
};

Logger.shared = new Logger();
module.exports = Logger;
