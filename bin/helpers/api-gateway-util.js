"use strict";

module.exports = {
    escapeJavaScript: function(string) {
        return JSON.stringify(string);
    },

    urlEncode: function(obj) {
        return encodeURIComponent(obj);
    },

    urlDecode: function(string) {
        return decodeURIComponent(string);
    },

    base64Encode: function(obj) {
        return new Buffer(obj).toString('base64');
    },

    base64Decode: function(string) {
        return new Buffer(string, 'base64').toString('utf8');
    },

    // Mapping template
    parseMappingTemplate: function(template, input, context) {
        // Use a crazy-ass regex to try and capture any variables that we need to evaluate
        // Three rules:
        // 1. Within double quotes (value ends up being a string)
        // 2. Within single quotes (value ends up being a string)
        // 3. As a "word" (value ends up being an object or variable reference)
        const regex = /(?:\"(\$(input|context|util)\.((?:[\w\.\(\)\$]|\'|\\\")*))\")|(?:\'(\$(input|context|util)\.((?:[\w\.\(\)\$]|\\\'|\")*))\')|(\$(input|context|util)\.((?:[\w\.\(\)\$]|\'|\")*))/g;
        const variableSubstitution = /\$(input|context|util)/g;

        return template.replace(regex, function(m, match) {
            // Replace $util, $input and $context
            if (!match) match = m;

            const adjustedMatch = match.replace(variableSubstitution, function(mi, variable) {
                return variable;
            });

            // Try to evaluate the match
            let result = match;
            try {
                const func = new Function('input', 'context', 'util', 'return ' + adjustedMatch);
                result = func(input, context, this);
            } catch (e) {
                // Ignore
            }

            if (m.charAt(0) == '\'' || m.charAt(0) == '\"')
                return '\"' + result + '\"';

            return result;
        });
    }
};
