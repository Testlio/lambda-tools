// Wrapper for a Lambda function executing in a different process
"use strict";

function wrapper(path, handler, evt, timeout) {
    timeout = timeout || 3000;
    handler = handler || 'handler';
    evt = evt || {};

    // Keep track whether our exit is properly handled
    let exited = false;
    const exitFunction = function(error, result) {
        clearTimeout(watchdog);
        exited = true;

        if (error) {
            sendError(process.pid, error, function() {
                process.exit(1);
            });

            return
        }

        sendResult(process.pid, result, function() {
            process.exit(0);
        });
    };

    // Create a context object to pass along to the Lambda function
    const context = {
        done: exitFunction,

        succeed: function(result) {
            exitFunction(null, result);
        },

        fail: function(error) {
            exitFunction(error, null);
        },

        getTimeRemainingTimeInMillis: function() {
            return deadline.getTime() - new Date().getTime();
        }
    };

    // Timeout monitoring
    const deadline = new Date();
    deadline.setTime(deadline.getTime() + timeout);

    const watchdog = setTimeout(function() {
        context.fail(new Error('Operation timed out'));
    }, timeout);

    // Listen to premature exits
    process.on('beforeExit', function(code) {
        context.fail(new Error('Process exited without completing request'));
    });

    try {
        require(path)[handler](evt, context);
    } catch(err) {
        sendError(process.pid, err, function() {
            process.exit(1);
        });
    }
}

function sendError(pid, err, callback) {
    console.error(err.message);
    console.error(err.stack);
    process.send({ result: err.message }, null, callback);
}

function sendResult(pid, result, callback) {
    process.send({ result: JSON.stringify(result) }, null, callback);
}

function parseArgs(args) {
    return args.reduce(function(ret, val, id) {
        if (id === 2) {
            ret.path = val;
        } else if (id === 3) { 
            ret.handler = val;
        } else if (id === 4) {
            ret.event = JSON.parse(val);
        } else if (id === 5) {
            ret.timeout = val;
        }

        return ret;
    }, { });
}

const args = parseArgs(process.argv);
wrapper(args.path, args.handler, args.event, args.timeout);
