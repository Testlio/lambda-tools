'use strict';

/**
 *  Logger helper, which allows keeping track of "tasks" and helps with nesting
 *  log statements
 */

const chalk = require('chalk');
const charm = require('charm')(process);
const _ = require('lodash');
const uuid = require('node-uuid');

const EventEmitter = require('events');
const util = require('util');

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

function Task(name, indent) {
    EventEmitter.call(this);

    this.name = name;
    this.id = uuid.v4();
    this.position = {};

    // Print out the task name
    charm.write(_.repeat('\t', indent) + name);

    // Capture the terminal position
    charm.position(function(x, y) {
        this.position.x = x;
        this.position.y = y;
    }.bind(this));

    // Move to the next line
    charm.write('\n');

    this.finish = function(err) {
        // Save position
        charm.push(true);

        // Output result
        charm.position(this.position.x + 1, this.position.y);
        process.stdout.write(err ? chalk.red('✖') : chalk.green('✔'));

        // Restore position
        charm.pop(true);

        // Emit
        this.emit('finish');
    };

    return this;
}

util.inherits(Task, EventEmitter);

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

    // Task tracking, returns a task that can be ended
    this.task = function(taskName) {
        // Push a simple task object to the queue
        const task = new Task(taskName, this.tasks.length);

        task.on('finish', function() {
            const idx = _.findIndex(this.tasks, task);
            if (idx !== -1) {
                this.tasks.splice(idx, 1);
            }
        }.bind(this));

        // Add to the tasks array
        this.tasks.push(task);
        return task;
    }

    this.end = function() {
        charm.end();
    };

    return this;
};

Logger.shared = new Logger();
module.exports = Logger;
