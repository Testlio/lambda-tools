"use strict";

const _ = require('lodash');
const JSONPath = require('jsonpath');
const util = require('../helpers/api-gateway-util');

module.exports = function (apiSpec) {
    return function *(result) {
        const path = ['paths', this.apiPath, this.request.method.toLowerCase(), 'x-amazon-apigateway-integration'];
        const definition = _.get(apiSpec, path);
        const responses = definition.responses;
        const defaultResponse = responses['default'];

        // Find the appropriate response (treating the keys as regex)
        let response = defaultResponse;

        _.forEach(responses, function(r, key) {
            let regex = new RegExp(key);
            if (result.match(regex)) {
                response = r;
                return false;
            }
        });

        let accept = this.request.header['accept'] || 'application/json';
        let template = response.responseTemplates[accept];
        let body = result;

        if (!_.isUndefined(template) && !_.isEmpty(template)) {
            let resultObject;
            try {
                resultObject = JSON.parse(result);
            } catch (error) {
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
};
