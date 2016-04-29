"use strict";

const _ = require('lodash');
const mappingTemplate = require('../helpers/api-gateway-mapping-parser');

//
//  Function that takes a request, API definition and a
//  result from the Lambda function and turns that into
//  a response object
//
//  For example
//
//  {
//      status: 200,
//      headers: {},
//      type: 'application/json',
//      body: '{ "foo": "bar" }'
//  }
//

module.exports = function(request, apiDefinition, result) {
    const responses = apiDefinition.responses;
    const defaultResponse = responses['default'];

    // Find the appropriate response (treating the keys as regex)
    const response = _.find(responses, function(value, key) {
        const regex = new RegExp('^' + key);
        return result && result.match(regex);
    }) || defaultResponse;

    let accept = request.request.header['accept'] || 'application/json';
    let template = response.responseTemplates[accept];
    let body = result;

    if (!_.isEmpty(template)) {
        body = mappingTemplate(template, undefined, request.context, result);
    } else if (!_.isUndefined(response.responseTemplates['application/json'])) {
        accept = 'application/json';
        template = response.responseTemplates['application/json'];
        if (!_.isEmpty(template)) {
            body = mappingTemplate(template, undefined, request.context, result);
        }
    } else {
        console.log('No response template, maintaining JSON');
        accept = 'application/json';
    }

    // Map the response parameters
    const parameters = response.responseParameters;
    const headers = {};

    if (parameters) {
        // Only support setting headers
        const keyPrefix = 'method.response.header.';

        // Notice no .header as Lambda only returns a body
        const valuePrefix = 'integration.request.body.';

        _.forOwn(parameters, function(value, key) {
            if (key.indexOf(keyPrefix) === 0) {
                key = key.substring(keyPrefix.length);
            } else {
                return;
            }

            if (value.indexOf(valuePrefix) === 0) {
                // Try to grab the value from the body of the response
                value = value.substring(valuePrefix.length);

                try {
                    const parsedBody = JSON.parse(body);
                    const fetchedValue = _.get(parsedBody, value);
                    if (fetchedValue) {
                        value = fetchedValue;
                    } else {
                        value = valuePrefix + value;
                    }
                } catch (err) {
                    value = valuePrefix + value;
                }

                // Set the resulting value to the header
                headers[key] = _.trim(value, '\'');
            } else {
                // Set as a constant
                headers[key] = _.trim(value, '\'');
            }
        });
    }

    return {
        status: parseInt(response.statusCode),
        headers: headers,
        type: accept,
        body: body
    };
};
