"use strict";

const fs    = require('fs');
const path  = require('path');
const rmrf  = require('rimraf').sync;

exports.getDirectories = function(srcpath) {
    return fs.readdirSync(srcpath).filter(function(file) {
        return fs.statSync(path.join(srcpath, file)).isDirectory();
    }).map(function(dir) {
        return path.join(srcpath, dir);
    });
};

exports.getFiles = function(srcpath) {
    return fs.readdirSync(srcpath).filter(function(file) {
        return !fs.statSync(path.join(srcpath, file)).isDirectory();
    }).map(function(dir) {
        return path.join(srcpath, dir);
    });
};

exports.recreateDirectory = function(path) {
    try {
        rmrf(path);
    } catch (error) {
        // Ignore
    }

    try {
        fs.mkdirSync(path);
    } catch (error) {
        if (error.code !== 'EEXIST') {
            throw new Error(error);
        }
    }
};

exports.directoryExists = function(path) {
    try {
        let stats = fs.lstatSync(path);
        return stats.isDirectory();
    } catch (error) {
        return false;
    }
};

exports.fileExists = function(path) {
    try {
        let stats = fs.lstatSync(path);
        return !stats.isDirectory();
    } catch (error) {
        return false;
    }
};

exports.readJSONFileSync = function(path) {
    let data = fs.readFileSync(path);
    return JSON.parse(data);
};
