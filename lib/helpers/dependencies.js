'use strict';

const Promise = require('bluebird');
const crypto = require('crypto');
const detective = require('detective');
const _ = require('lodash');
const fs = Promise.promisifyAll(require('graceful-fs'));
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

function nestedDependencies(pkgName, basedir, ignore) {
    ignore = ignore || [];

    return pkgInfo(pkgName, basedir)
    .then(function(pkg) {
        const skip = _.findIndex(ignore, {
            name: pkg.name,
            version: pkg.version
        }) !== -1;
        
        if (skip) {
            return pkg;
        }

        const deps = pkg.dependencies;

        // Add ourselves to ignore list (cuts cyclical loops)
        const newIgnore = ignore.concat({
            name: pkg.name,
            version: pkg.version
        });

        return Promise.map(_.keys(deps), function(nestedPkgName) {
            return nestedDependencies(nestedPkgName, basedir, newIgnore);
        }).then(_.compact).then(function(results) {
            pkg.dependencies = results;
            return pkg;
        });
    });
}

function recursiveDependencies(code, options) {
    options = options || {};
    const ignore = options.ignore || [];
    const basedir = options.basedir || process.cwd();

    return Promise.map(detective(code), function(requireStatement) {
        // Add to the ignore list (the seen list)
        const newIgnore = [].concat(ignore);

        // Recurse
        if (_.startsWith(requireStatement, '.') || _.startsWith(requireStatement, '/')) {
            // Local file, recursively grab all other dependencies
            return pkgInfo(requireStatement, basedir).then(function(pkg) {
                if (!pkg.path) {
                    // No path for the package, which is strange, so skip
                    return [];
                }

                // If ignored, just return the package itself and not recurse
                if (newIgnore.indexOf(pkg.path) !== -1) {
                    return [_.assign({}, pkg, {
                        duplicate: true
                    })];
                }

                // Make sure to ignore going forwards
                newIgnore.push(pkg.path);

                return fs.readFileAsync(pkg.path).then(function(data) {
                    const checksum = crypto.createHash('sha1').update(data).digest('hex');

                    return recursiveDependencies(data, _.assign({}, options, {
                        basedir: path.dirname(pkg.path),
                        ignore: newIgnore
                    })).then(function(results) {
                        return results.concat(_.assign({}, pkg, {
                            checksum: checksum
                        }));
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
        return _.unionWith(_.flatten(results), function(a, b) {
            return a.path === b.path;
        }).map(function(result) {
            return _.pick(result, ['name', 'version', 'path', 'core', 'dependencies', 'checksum', 'duplicate']);
        });
    });
}

module.exports = recursiveDependencies;
