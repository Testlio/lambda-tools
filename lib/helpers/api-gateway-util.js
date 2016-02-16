"use strict";

module.exports = {
    escapeJavaScript: function(string) {
        return JSON.stringify(string);
    },

    urlEncode: function(obj) {
        return obj ? encodeURIComponent(obj) : undefined;
    },

    urlDecode: function(string) {
        return string ? decodeURIComponent(string) : undefined;
    },

    base64Encode: function(obj) {
        return objc ? new Buffer(obj).toString('base64') : undefined;
    },

    base64Decode: function(string) {
        return string ? new Buffer(string, 'base64').toString('utf8') : undefined;
    },

    // Mapping template
    parseMappingTemplate: function(template, input, context) {
        // Use a crazy-ass regex to try and capture any variables that we need to evaluate
        // Three rules:
        // 1. Within double quotes (value ends up being a string)
        // 2. Within single quotes (value ends up being a string)
        // 3. As a "word" (value ends up being an object or variable reference)
        const regexParts = [
            '(?:"(\\$(input|context|util)\\.((?:[\\w_\\- \\.\\(\\)\\$]|\'|")*))")', // 1
            '(?:\'(\\$(input|context|util)\\.((?:[\\w_\\- \\.\\(\\)\\$]|\'|")*))\')', // 2
            '(\\$(input|context|util)\\.((?:[\\w_\\- \\.\\(\\)\\$]|\'|")*))'            // 3
        ];
        const regex = new RegExp(regexParts.join('|'), 'g');
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

            if (!result) {
                return 'null';
            }

            if ((m.charAt(0) == '\'' || m.charAt(0) == '\"')) {
                return '\"' + result + '\"';
            }

            return String(result);
        }.bind(this));
    }
};
