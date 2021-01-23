// Bridge to an SMTP server
// Overrides the MX and sets the same AUTH user and password

exports.register = function() {
    this.load_flat_ini();
};

exports.load_flat_ini = function() {
    const plugin = this;
    plugin.cfg = plugin.config.get('smtp_bridge.ini', () => {
        plugin.load_flat_ini();
    });
};

exports.hook_data_post = (next, connection) => {
    const txn = connection.transaction;
    // Copy auth notes to transaction notes so they're available in hmail.todo.notes
    txn.notes.auth_user = connection.notes.auth_user;
    txn.notes.auth_passwd = connection.notes.auth_passwd;
    return next();
};

exports.hook_get_mx = function(next, hmail, domain) {
    let priority = 10;
    if (this.cfg.main.priority) {
        priority = this.cfg.main.priority;
    }
    let authType = null;
    if (this.cfg.main.auth_type) {
        authType = this.cfg.main.auth_type;
    }
    let port = null;
    if (this.cfg.main.port) {
        port = this.cfg.main.port;
    }
    return next(OK, {
        priority,
        exchange: this.cfg.main.host,
        port,
        auth_type: authType,
        auth_user: hmail.todo.notes.auth_user,
        auth_pass: hmail.todo.notes.auth_passwd,
    });
};
