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

module.exports = function (apiSpec) {
    return function *() {
        const path = ['paths', this.apiPath, this.request.method.toLowerCase(), 'x-amazon-apigateway-integration'];
        const definition = _.get(apiSpec, path);
        console.log("Definition", definition);

        const parameters = definition.requestParameters;
        const templates = definition.requestTemplates;

        // Map input (which is expanded by requestParameters)
        const integration = { params: _.merge({}, this.params, this.request.query, this.request.header)};
        integration.path = _.merge({}, this.params);
        integration.querystring = _.merge({}, this.request.query);
        integration.header = _.merge({}, this.request.header);

        const body = this.request.body;

        for (let param in parameters) {
            let value = parameters[param].toLowerCase();
            param = param.toLowerCase();

            if (_.isString(param) && param.startsWith('integration.request.')) {
                param = param.slice('integration.request.'.length);
            }

            if (_.isString(value) && value.startsWith('method.request.')) {
                value = value.slice('method.request.'.length);
            }

            _.set(integration, param, _.has(this.request, value) ? _.get(this.request, value) : _.get(this.params, value));
        }

        // Build a faux context
        const context = {
            apiId: 'local-lambda',
            httpMethod: this.request.method,
            identity: {},   // We can't possibly mock a Cognito identity...
            requestId: UUID.v4(),
            resourceId: this.request.method + ' ' + this.apiPath,
            resourcePath: this.apiPath,
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
        let template = templates['application/json'];
        if (!template) {
            // We can't set an event
            return {context: context};
        } else {
            // Use a crazy-ass regex to try and capture any variables that we need to evaluate
            // Three rules:
            // 1. Within double quotes (value ends up being a string)
            // 2. Within single quotes (value ends up being a string)
            // 3. As a "word" (value ends up being an object or variable reference)
            const regex = /(?:\"(\$(input|context|util)\.((?:[\w\.\(\)\$]|\'|\\\")*))\")|(?:\'(\$(input|context|util)\.((?:[\w\.\(\)\$]|\\\'|\")*))\')|(\$(input|context|util)\.((?:[\w\.\(\)\$]|\'|\")*))/g;
            const variableSubstitution = /\$(input|context|util)/g;

            template = template.replace(regex, function(m, match) {
                // Replace $util, $input and $context
                if (!match) match = m;

                const adjustedMatch = match.replace(variableSubstitution, function(mi, variable) {
                    return variable;
                });

                // Try to evaluate the match
                let result = match;
                try {
                    const func = new Function('input', 'context', 'util', 'return ' + adjustedMatch);
                    result = func(input, context, util);
                } catch (e) {
                    // Ignore
                }

                if (m.charAt(0) == '\'' || m.charAt(0) == '\"')
                    return '\"' + result + '\"';

                return result;
            });

            return {context: context, event: JSON.parse(template)};
        }
    };
};
