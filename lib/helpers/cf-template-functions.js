'use strict';

const _ = require('lodash');

/**
 *  Helper function for deriving the list of resources that are referenced
 *  by a CF function
 *
 *  @param value, CF value, may be a string, or an object
 *  @returns {array} array of strings, containing all resource names that are used
 *  by the value (that the value depends on)
 */
function cloudFormationDependencies(value) {
    if (_.isString(value)) {
        return [value];
    }

    if (!_.isObject(value)) {
        return [];
    }

    const keys = _.keys(value);
    if (keys.length !== 1) {
        // CF functions always have a single key
        return [];
    }

    const key = keys[0];

    if (key === 'Fn::GetAtt') {
        // Logical name of resource is the first value in array
        return cloudFormationDependencies(value[key][0]);
    }

    if (key === 'Ref') {
        // Value should be the logical name (but may be a further function)
        return cloudFormationDependencies(value[key]);
    }

    if (key === 'Fn::Join') {
        // Value is the combined string, meaning parts that are not
        // string can all include dependencies
        return _.flatten(value[key][1].filter(_.isObject).map(cloudFormationDependencies));
    }

    if (key === 'Fn::Select') {
        // Value is picked from an array
        const index = value[key][0];
        const list = value[key][1];
        return cloudFormationDependencies(list[index]);
    }

    // Unknown/Unhandled
    return [];
}

module.exports = cloudFormationDependencies;
