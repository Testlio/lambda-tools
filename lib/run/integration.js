"use strict";

const _ = require('lodash');
const JSONPath = require('jsonpath');
const UUID = require('node-uuid');
const util = require('../helpers/api-gateway-util');

//
//  Middleware that creates populates the event property
//  which can then be sent to the Lambda function
//
//  Returns a generator function based on the passed in API spec
//  This generator is able to turn a Koa request into a Lambda compatible
//  context/event combination, which it returns as an object
//

module.exports = function *(integrationDefinition) {
    const parameters = integrationDefinition.requestParameters;
    const templates = integrationDefinition.requestTemplates;

    // Map input (which is expanded by requestParameters)
    const integration = { params: _.merge({}, this.params, this.request.query, this.request.header)};
    integration.path = _.merge({}, this.params);
    integration.query = _.merge({}, this.request.query);
    integration.header = _.merge({}, this.request.header);

    const body = this.request.body;

    _.forEach(parameters, function(value, param) {
        param = param.toLowerCase();
        value = value.toLowerCase();

        if (param.startsWith('integration.request.')) {
            param = param.slice('integration.request.'.length);
        }

        if (value.startsWith('method.request.')) {
            value = value.slice('method.request.'.length);
        }

        value = _.has(this.request, value) ? _.get(this.request, value) : _.get(this.params, value);
        _.set(integration, param, value);
    }, this);

    // Build a faux context
    const context = {
        apiId: 'local-lambda',
        httpMethod: this.request.method,
        identity: {},   // We can't possibly mock a Cognito identity...
        requestId: UUID.v4(),
        resourceId: this.request.method + ' ' + this.request.path,
        resourcePath: this.request.path,
        stage: 'dev'
    };

    const input = {
        params: function(name) {
            if (!name) return integration;
            if (_.has(integration.path, name)) return integration.path[name];
            if (_.has(integration.query, name)) return integration.query[name];
            if (_.has(integration.header, name.toLowerCase())) return integration.header[name.toLowerCase()];
        },

        json: function(p) {
            if (body) return JSON.stringify(JSONPath.value(body, p));
            return JSON.stringify(JSONPath.value(integration, p));
        },

        path: function(p) {
            if (body) return JSONPath.value(body, p);
            return JSONPath.value(integration, p);
        }
    };

    // Use combination of input, context and util to populate the request template
    // For now, we only support json templates
    const contentType = this.request.header['content-type'] || 'application/json';
    let template = templates[contentType];

    if (!template && _.keys(templates).length >= 1) {
        // Fall back to just using the first template we can find
        template = templates[keys[0]];
    }

    if (!template) {
        // Still no template, likely there is no template, so an empty event will
        // have to do
        return {
            context: context,
            event: {}
        };
    } else {
        template = util.parseMappingTemplate(template, input, context);
        return {
            context: context,
            event: JSON.parse(template)
        };
    }
};
