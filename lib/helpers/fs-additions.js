"use strict";

const fs = require('fs-extra');
const Path = require('path');

exports.getDirectories = function(srcpath) {
    return fs.readdirSync(srcpath).filter(function(file) {
        return fs.statSync(Path.join(srcpath, file)).isDirectory();
    }).map(function(dir) {
        return Path.join(srcpath, dir);
    });
};

exports.getFiles = function(srcpath) {
    return fs.readdirSync(srcpath).filter(function(file) {
        return !fs.statSync(Path.join(srcpath, file)).isDirectory();
    }).map(function(dir) {
        return Path.join(srcpath, dir);
    });
};

exports.ensureDirectory = function(path) {
    try {
        fs.mkdirsSync(path);
    } catch (err) {
        if (err.code !== 'EEXIST') {
            throw err;
        }
    }
};

exports.directoryExists = function(path) {
    try {
        const stats = fs.lstatSync(path);
        return stats.isDirectory();
    } catch (error) {
        return false;
    }
};

exports.fileExists = function(path) {
    try {
        const stats = fs.lstatSync(path);
        return !stats.isDirectory();
    } catch (error) {
        return false;
    }
};

exports.readJSONFileSync = function(path) {
    const data = fs.readFileSync(path);
    return JSON.parse(data);
};
