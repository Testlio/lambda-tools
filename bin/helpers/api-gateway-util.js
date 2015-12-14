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
    }
};
