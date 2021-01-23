const crypto = require('crypto');

exports.hook_init_child = function(next) {
    const plugin = this;
    Math.seedrandom(crypto.randomBytes(256).toString('hex'));
    plugin.logdebug('reseeded rng');
    next();
};
