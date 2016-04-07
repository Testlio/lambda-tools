/**
 * Taken from https://github.com/TooTallNate/ansi.js/blob/master/lib/newlines.js,
 * modified for linter
 *
 * Accepts any node Stream instance and hijacks its "write()" function,
 * so that it can count any newlines that get written to the output.
 *
 * When a '\n' byte is encountered, then a "newline" event will be emitted
 * on the stream, with no arguments. It is up to the listeners to determine
 * any necessary deltas required for their use-case.
 *
 * Ex:
 *
 *   var cursor = ansi(process.stdout)
 *     , ln = 0
 *   process.stdout.on('newline', function () {
 *    ln++
 *   })
 */

/**
 * Module dependencies.
 */

const assert = require('assert');
const NEWLINE = '\n'.charCodeAt(0);

/**
 * Processes an individual byte being written to a stream
 */

function processByte (stream, b) {
    assert.equal(typeof b, 'number');
    if (b === NEWLINE) {
        stream.emit('newline');
    }
}

function emitNewlineEvents (stream) {
    if (stream._emittingNewlines) {
        // already emitting newline events
        return;
    }

    const write = stream.write;

    stream.write = function (data) {
        // first write the data
        const rtn = write.apply(stream, arguments);

        if (stream.listeners('newline').length > 0) {
            const len = data.length;
            let i = 0;
            // now try to calculate any deltas
            if (typeof data == 'string') {
                for (; i<len; i++) {
                    processByte(stream, data.charCodeAt(i));
                }
            } else {
                // buffer
                for (; i<len; i++) {
                    processByte(stream, data[i]);
                }
            }
        }

        return rtn;
    };

    stream._emittingNewlines = true;
}

module.exports = emitNewlineEvents;
