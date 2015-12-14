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
        return btoa(obj);
    },

    base64Decode: function(string) {
        return atob(string);
    }
};
