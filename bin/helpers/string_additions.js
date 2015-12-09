"use strict";

if (!String.prototype.camelCase) {
    String.prototype.camelCase = function() {
        let capitalized = this.replace(/[^0-9a-zA-Z]/g, '_').split('_').map(function(item) {
            return item.charAt(0).toUpperCase() + item.substring(1);
        }).join('');

        return capitalized.charAt(0).toLowerCase() + capitalized.substring(1);
    }
}

if (!String.prototype.sanitise) {
    String.prototype.sanitise = function(delimiter) {
        delimiter = delimiter || '-';
        let re = new RegExp('[^' + delimiter + '0-9a-zA-Z]', 'g');
        return this.replace(re, delimiter);
    }
}
