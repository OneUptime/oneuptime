// backscatterer plugin

exports.register = function() {
    this.inherits('dns_list_base');
};

exports.hook_mail = function(next, connection, params) {
    const user =
        params[0] && params[0].user ? params[0].user.toLowerCase() : null;
    if (!(!user || user === 'postmaster')) return next();
    // Check remote IP on ips.backscatterer.org
    const plugin = this;

    function resultCb(err, zone, a) {
        if (err) {
            connection.logerror(plugin, err);
            return next();
        }
        if (!a) return next();
        const msg = `Host ${connection.remote.host} [${connection.remote.ip}] is blacklisted by ${zone}`;
        return next(DENY, msg);
    }

    this.first(connection.remote.ip, ['ips.backscatterer.org'], resultCb);
};
