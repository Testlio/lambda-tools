"use strict";

const fs = require('fs');
const mkdirp = require('mkdirp');
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

exports.createDirectory = function(path) {
    try {
        mkdirp.sync(path);
    } catch (error) {
        if (error.code !== 'EEXIST') {
            throw new Error(error);
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
