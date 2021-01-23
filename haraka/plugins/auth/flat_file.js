// Auth against a flat file

exports.register = function() {
    const plugin = this;
    plugin.inherits('auth/auth_base');
    plugin.load_flat_ini();
};

exports.load_flat_ini = function() {
    const plugin = this;
    plugin.cfg = plugin.config.get('auth_flat_file.ini', () => {
        plugin.load_flat_ini();
    });
};

exports.hook_capabilities = function(next, connection) {
    const plugin = this;
    // don't allow AUTH unless private IP or encrypted
    if (!connection.remote.is_private && !connection.tls.enabled) {
        connection.logdebug(
            plugin,
            'Auth disabled for insecure public connection'
        );
        return next();
    }

    let methods = null;
    if (plugin.cfg.core && plugin.cfg.core.methods) {
        methods = plugin.cfg.core.methods.split(',');
    }
    if (methods && methods.length > 0) {
        connection.capabilities.push(`AUTH ${methods.join(' ')}`);
        connection.notes.allowed_auth_methods = methods;
    }
    next();
};

exports.get_plain_passwd = function(user, connection, cb) {
    const plugin = this;
    if (plugin.cfg.users[user]) {
        return cb(plugin.cfg.users[user].toString());
    }
    return cb();
};
