'use strict';

const Promise = require('bluebird');
const detective = require('detective');
const _ = require('lodash');
const fs = Promise.promisifyAll(require('fs'));
const path = require('path');
const pkgResolve = require('resolve');

// Logic for finding the entire dependency tree of a piece of code:
// 1. Derive all require statements with detective
// 2. For each of those statements, either:
//  2a. If local (starts with . or /), recurse to the same function
//  2b. Otherwise, recurse to a different function that grabs all nested dependencies

function pkgInfo(id, basedir) {
    return new Promise(function(resolve) {
        pkgResolve(id, { basedir: basedir }, function(error, result, pkg) {
            if (pkgResolve.isCore(id)) {
                resolve({
                    name: id,
                    core: true
                });
            } else if (pkg && pkgResolve.isCore(pkg.name)) {
                resolve({
                    name: pkg.name,
                    core: true
                });
            } else if (pkg && !(_.startsWith(id, '.') || _.startsWith(id, '/'))) {
                const pkgPath = path.resolve(path.dirname(result).split(pkg.name)[0] + '/', pkg.name);

                resolve({
                    name: pkg.name,
                    version: pkg.version,
                    dependencies: pkg.dependencies,
                    path: pkgPath
                });
            } else {
                resolve({
                    name: id,
                    path: result
                });
            }
        });
    });
}

function nestedDependencies(pkgName, basedir) {
    return pkgInfo(pkgName, basedir)
    .then(function(pkg) {
        const names = _.keys(pkg.dependencies);
        const localBasedir = path.dirname(pkg.path);

        return Promise.map(names, function(nestedPkgName) {
            return nestedDependencies(nestedPkgName, basedir);
        }).then(function(results) {
            return _.compact(results);
        }).then(function(results) {
            pkg.dependencies = results;
            return pkg;
        });
    });
}

function recursiveDependencies(code, options) {
    options = options || {};
    const basedir = options.basedir || process.cwd();

    return Promise.map(detective(code), function(requireStatement) {
        // Check if local
        if (_.startsWith(requireStatement, '.') || _.startsWith(requireStatement, '/')) {
            return pkgInfo(requireStatement, basedir).then(function(pkg) {
                return fs.readFileAsync(pkg.path).then(function(data) {
                    return recursiveDependencies(data, _.assign({}, options, {
                        basedir: path.dirname(pkg.path)
                    })).then(function(results) {
                        return results.concat(pkg);
                    });
                });
            });
        } else if (options.deep) {
            // Resolve package and store version info
            return nestedDependencies(requireStatement, basedir);
        } else {
            // Resolve package and store version info
            return pkgInfo(requireStatement, basedir).then(function(pkg) {
                return _.omit(pkg, 'dependencies');
            });
        }
    }).then(function(results) {
        return _.union(_.flatten(results)).map(function(result) {
            return _.pick(result, ['name', 'version', 'path', 'core', 'dependencies']);
        });
    });
}

module.exports = recursiveDependencies;
