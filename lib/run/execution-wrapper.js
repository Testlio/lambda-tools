// Wrapper for a Lambda function executing in a different process
"use strict";

function sendError(pid, err, callback) {
    const message = err.message || err;
    console.error(message);

    if (err.stack) {
        console.error(err.stack);
    }

    process.send({ result: message, type: 'error' }, null, callback);
}

function sendResult(pid, result, callback) {
    process.send({ result: JSON.stringify(result), type: 'result' }, null, callback);
}

function exit(error, result) {
    if (error) {
        sendError(process.pid, error, function() {
            process.exit(1);
        });

        return;
    }

    sendResult(process.pid, result, function() {
        process.exit(0);
    });
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

function wrapper(path, handler, evt, timeout) {
    timeout = parseInt(timeout || 6000, 10);
    handler = handler || 'handler';
    evt = evt || {};

    // Timeout monitoring
    const now = new Date().getTime();
    const deadline = now + timeout;

    let context = {};
    const watchdog = setTimeout(function() {
        context.fail(new Error('Operation timed out'));
    }, timeout);

    // Listen to premature exits
    process.on('beforeExit', function() {
        context.fail(new Error('Process exited without completing request'));
    });

    // Create a context object to pass along to the Lambda function
    context = {
        done: function(error, result) {
            clearTimeout(watchdog);
            exit(error, result);
        },

        succeed: function(result) {
            clearTimeout(watchdog);
            exit(null, result);
        },

        fail: function(error) {
            clearTimeout(watchdog);
            exit(error, null);
        },

        getRemainingTimeInMillis: function() {
            return deadline - (new Date()).getTime();
        }
    };

    try {
        require(path)[handler](evt, context);
    } catch(err) {
        sendError(process.pid, err, function() {
            process.exit(1);
        });
    }
}

const args = parseArgs(process.argv);
wrapper(args.path, args.handler, args.event, args.timeout);
