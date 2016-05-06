"use strict";

const _ = require('lodash');
const UUID = require('node-uuid');
const mappingTemplate = require('../helpers/api-gateway-mapping-parser');

//
//  Middleware that creates populates the event property
//  which can then be sent to the Lambda function
//
//  Returns context and event objects, for example:
//
//  {
//      event: {
//          foo: 'bar'
//      },
//      context: {
//          ...
//      }
//  }
//

module.exports = function(request, integrationDefinition) {
    const parameters = integrationDefinition.requestParameters;
    const templates = integrationDefinition.requestTemplates;

    // Map parameters to integration
    const methodRequest = {
        path: _.merge({}, request.params),
        querystring: _.merge({}, request.request.query),
        header: _.merge({}, request.request.header)
    };

    const integration = _.assign({}, methodRequest);

    _.forEach(parameters, function(requestKey, integrationKey) {
        if (_.startsWith(integrationKey, 'integration.request.')) {
            integrationKey = integrationKey.slice('integration.request.'.length);
        }

        if (_.startsWith(requestKey, 'method.request.')) {
            requestKey = requestKey.slice('method.request.'.length);
        }

        // Look for the value
        const value = _.get(methodRequest, requestKey, _.get(methodRequest, requestKey.toLowerCase()));

        _.set(integration, requestKey, value);
        _.set(integration, integrationKey, value);
    });

    // Build a faux context
    const context = {
        apiId: 'local-lambda',
        httpMethod: request.request.method,
        identity: {},   // We can't possibly mock a Cognito identity...
        requestId: UUID.v4(),
        resourceId: request.request.method + ' ' + request.request.path,
        resourcePath: request.request.path,
        stage: 'dev'
    };

    // Use combination of input, context and util to populate the request template
    // For now, we only support json templates
    const contentType = request.request.header['content-type'] || 'application/json';
    let template = templates[contentType];

    if (!template && _.keys(templates).length >= 1) {
        // Fall back to just using the first template we can find
        template = templates[_.keys(templates)[0]];
    }

    if (!template) {
        // Still no template, likely there is no template, so an empty event will
        // have to do
        return {
            context: context,
            event: {}
        };
    } else {
        template = mappingTemplate(template, integration, context, request.request.body);

        return {
            context: context,
            event: JSON.parse(template)
        };
    }
};
