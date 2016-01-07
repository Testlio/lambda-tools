"use strict";

if (!String.prototype.sanitise) {
    String.prototype.sanitise = function(delimiter) {
        delimiter = delimiter || '-';
        const re = new RegExp('[^' + delimiter + '0-9a-zA-Z]', 'g');
        return this.replace(re, delimiter);
    };
}

if (!String.prototype.startsWith) {
    String.prototype.startsWith = function(prefix) {
        return this.indexOf(prefix) === 0;
    };
}

if (!String.prototype.endsWith) {
    String.prototype.endsWith = function(suffix) {
        return this.indexOf(suffix) === (this.length - suffix.length);
    };
}

if (!String.prototype.toDashCase) {
    String.prototype.toDashCase = function() {
        return this.replace(/([A-Z])/g, function($1){return "-"+$1.toLowerCase();});
    };
}

if (!String.prototype.toCamelCase) {
    String.prototype.toCamelCase = function() {
        const capitalized = this.replace(/[^0-9a-zA-Z]/g, '_').split('_').map(function(item) {
            return item.charAt(0).toUpperCase() + item.substring(1);
        }).join('');

        return capitalized.charAt(0).toLowerCase() + capitalized.substring(1);
    };
}
