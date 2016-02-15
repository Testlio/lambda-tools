"use strict";

const path = require('path');
const untildify = require('untildify');

module.exports = function parsePath(filePath) {
    return path.resolve(process.cwd(), untildify(filePath));
};
