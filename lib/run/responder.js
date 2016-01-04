"use strict";

require('colors');
const _ = require('lodash');
const JSONPath = require('jsonpath');
const util = require('../helpers/api-gateway-util');

module.exports = function *(apiDefinition, result) {
    const responses = apiDefinition.responses;
    const defaultResponse = responses['default'];

    // Find the appropriate response (treating the keys as regex)
    const response = _.find(responses, function(value, key) {
        const regex = new RegExp(key);
        return result && result.match(regex);
    }) || defaultResponse;

    const accept = this.request.header['accept'] || 'application/json';
    const template = response.responseTemplates[accept];
    let body = result;

    if (!_.isUndefined(template) && !_.isEmpty(template)) {
        let resultObject;
        try {
            resultObject = JSON.parse(result);
        } catch (error) {
            console.log('Result is not an object'.red);
        }

        const input = {
            params: function(name) {
                if (!name) return resultObject;
                if (_.has(resultObject, name)) return resultObject[name];
                if (_.has(resultObject, name.toLowerCase())) return resultObject[name.toLowerCase()];
            },

            json: function(p) {
                return JSON.stringify(JSONPath.value(resultObject, p));
            },

            path: function(p) {
                return JSONPath.value(resultObject, p);
            }
        };

        body = util.parseMappingTemplate(template, input, this.context);
    }

    return {
        status: parseInt(response.statusCode),
        body: body
    };
};
