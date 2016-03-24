'use strict';

const velocity = require('velocityjs');
const jsonpath = require('jsonpath');

/**
 *  Parse API gateway mapping template (in Velocity Templating Language)
 *
 *  @param template - Velocity template string
 *  @param params - Object containing the parameter values (path, header, querystring) OPTIONAL
 *  @param context - Context object for the template OPTIONAL
 *  @param payload - Input payload (usually request body) OPTIONAL
 *  @param stageVariables - Stage variables for the template OPTIONAL
 *
 *  @returns resolved template string
 */
module.exports = function(template, params, context, payload, stageVariables) {
    params = params || {};
    context = context || {};
    payload = payload || {};
    stageVariables = stageVariables || {};

    const data = {
        context: context,
        stageVariables: stageVariables,

        util: {
            escapeJavaScript: function(value) {
                return value ? JSON.stringify(value) : null;
            },

            urlEncode: function(value) {
                return value ? decodeURIComponent(value) : null;
            },

            urlDecode: function(value) {
                return value ? encodeURIComponent(value) : null;
            },

            base64Encode: function(value) {
                return value ? new Buffer(value).toString('base64') : null;
            },

            base64Decode: function(value) {
                return value ? new Buffer(value, 'base64').toString('utf8') : null;
            }
        },

        input: {
            json: function(path) {
                return JSON.stringify(jsonpath.query(payload, path));
            },

            path: function(path) {
                return jsonpath.query(payload, path);
            },

            params: function(key) {
                if (!key) {
                    return params;
                }

                if (params.path && params.path[key]) {
                    return params.path[key];
                }

                if (params.querystring && params.querystring[key]) {
                    return params.querystring[key];
                }

                if (params.header && params.header[key]) {
                    return params.header[key];
                }

                return null;
            }
        }
    };

    // Always keep macros empty, API gateway doesn't support those
    return velocity.render(template, data, {});
};
