'use strict';

module.exports = require('haraka-config');

// use emit is the same way util.deprecate does it, so follow that style
process.emit(
    'warning',
    'Loading config via require("./config") is deprecated, please use: require("haraka-config") instead.'
);
