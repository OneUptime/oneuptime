// Bridge AUTH requests to SMTP server

exports.register = function() {
    this.inherits('auth/auth_proxy');
    this.load_flat_ini();
};

exports.load_flat_ini = function() {
    const plugin = this;
    plugin.cfg = plugin.config.get('smtp_bridge.ini', () => {
        plugin.load_flat_ini();
    });
};

exports.check_plain_passwd = function(connection, user, passwd, cb) {
    let host = this.cfg.main.host;
    if (this.cfg.main.port) {
        host = `${host}:${this.cfg.main.port}`;
    }
    this.try_auth_proxy(connection, host, user, passwd, cb);
};
