"use strict";

require('colors');
const _ = require('lodash');
const mappingTemplate = require('api-gateway-mapping-template');

module.exports = function *(apiDefinition, result) {
    const responses = apiDefinition.responses;
    const defaultResponse = responses['default'];

    // Find the appropriate response (treating the keys as regex)
    const response = _.find(responses, function(value, key) {
        const regex = new RegExp('^' + key);
        return result && result.match(regex);
    }) || defaultResponse;

    const accept = this.request.header['accept'] || 'application/json';
    const template = response.responseTemplates[accept];
    let body = result;

    if (!_.isEmpty(template)) {
        body = mappingTemplate({
            template: template,
            payload: result,
            context: this.context
        });
    }

    return {
        status: parseInt(response.statusCode),
        body: body
    };
};
