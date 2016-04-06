'use strict';

/**
 *  Logger helper, which allows keeping track of "tasks" and helps with nesting
 *  log statements
 */

const cursor = require('ansi')(process.stdout);
const chalk = require('chalk');
const _ = require('lodash');
const uuid = require('node-uuid');
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
        // Push a simple task object to the queue
        const task = {
            name: taskName,
            id: uuid.v4()
        };

        const identation = this.tasks.length;

        const finish = function(t, succeed, err) {
            return getPosition().then(function(restorePosition) {
                const idx = _.findIndex(this.tasks, t);
                if (idx === -1) {
                    return;
                }

                // Jump back to the correct position
                cursor.goto(t.position.x + 1, t.position.y);

                // Write result
                if (succeed) {
                    cursor.write(`${chalk.green('✔')}\n`);
                } else if (err) {
                    cursor.write(`${chalk.red('✖')} ${err.message}\n`);
                } else {
                    cursor.write(`${chalk.red('✖')}\n`);
                }

                // Restore position and tasks array
                this.tasks.splice(idx, 1);
                cursor.goto(restorePosition.x, restorePosition.y);

                // If this was the last task, print an additional empty line
                if (this.tasks.length === 0) {
                    cursor.write('\n');
                }
            }.bind(this));
        }.bind(this);

        return new Promise(function(resolve, reject) {
            // If there are currently no tasks, add an empty line
            // (top-level or first tasks are separated by empty lines)
            if (this.tasks.length === 0) {
                cursor.write('\n');
            }

            // Print out the task name
            cursor.write(`${_.repeat('\t', identation)}${taskName}`);

            // Add to the tasks array
            this.tasks.push(task);

            getPosition().then(function(position) {
                // Move logging to the next line (we didn't want this in our
                // cursor query)
                cursor.write('\n');
                task.position = position;

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
            });
        }.bind(this));
    };

    return this;
};

Logger.shared = new Logger();
module.exports = Logger;
