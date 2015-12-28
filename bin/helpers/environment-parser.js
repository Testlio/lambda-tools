"use strict";

module.exports = function parseEnvironment(value) {
    // Split on unescaped commas first
    const pairs = [];

    let previousIndex = 0;
    value.replace(/(\\)?,/g, function(match, slash, index) {
        if (!slash) {
            pairs.push(value.substring(previousIndex, index));
            previousIndex = index + match.length;
        }

        return match;
    });
    pairs.push(value.substring(previousIndex));

    // Then split all the pairs on unescaped = signs
    const result = {};
    pairs.forEach(function(pair) {
        const match = pair.match(/(?:[^\\])=/);

        if (match) {
            const key = pair.substring(0, match.index + 1).replace(/\\(.)/g, "$1");
            const val = pair.substring(match.index + 2).replace(/\\(.)/g, "$1");

            result[key] = val;
        }
    });

    return result;
};
