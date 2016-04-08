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
                let pkgPath = path.dirname(result);

                if (pkg._where && pkg._location) {
                    pkgPath = path.resolve(pkg._where, 'node_modules', _.trimStart(pkg._location, '/'));
                }

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

function nestedDependencies(pkgName, basedir, current) {
    current = current || [];

    return pkgInfo(pkgName, basedir)
    .then(function(pkg) {
        // Avoid circular loops
        const localCurrent = current.concat(pkg);
        const names = _.keys(pkg.dependencies);

        return Promise.map(names, function(nestedPkgName) {
            return nestedDependencies(nestedPkgName, basedir, localCurrent);
        }).then(function(results) {
            return _.compact(_.flatten(results));
        }).then(function(results) {
            return _.unionBy(localCurrent, results, 'name');
        });
    });
}

function recursiveDependencies(code, options, current) {
    options = options || {};
    const basedir = options.basedir || process.cwd();
    current = current || [];

    const requires = detective(code);
    const localCurrent = _.unionBy(requires.map(function(stat) {
        return {
            name: stat
        };
    }, current), 'name');

    return Promise.map(requires, function(requireStatement) {
        // Check if local
        if (_.startsWith(requireStatement, '.') || _.startsWith(requireStatement, '/')) {
            return pkgInfo(requireStatement, basedir).then(function(pkg) {
                return fs.readFileAsync(pkg.path).then(function(data) {
                    return recursiveDependencies(data, _.assign({}, options, {
                        basedir: path.dirname(pkg.path)
                    }), localCurrent).then(function(results) {
                        return results.concat(pkg);
                    });
                });
            });
        } else if (options.deep) {
            // Resolve package and store version info
            return nestedDependencies(requireStatement, basedir);
        } else {
            // Resolve package and store version info
            return pkgInfo(requireStatement, basedir);
        }
    }).then(function(results) {
        return _.unionBy(_.flatten(results), 'name').map(function(result) {
            return _.pick(result, ['name', 'version', 'path', 'core']);
        });
    });
}

module.exports = recursiveDependencies;
