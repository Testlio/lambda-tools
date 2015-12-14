"use strict";

module.exports = function *(lambdaPath, event, context) {
    console.log("Execute lambda", lambdaPath, event, context);
};
