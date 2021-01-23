'use strict';
// dnswl plugin

exports.register = function() {
    const plugin = this;
    plugin.inherits('dns_list_base');

    plugin.load_dnswl_ini();

    // IMPORTANT: don't run this on hook_rcpt otherwise we're an open relay...
    ['ehlo', 'helo', 'mail'].forEach(hook => {
        plugin.register_hook(hook, 'check_dnswl');
    });
};

exports.load_dnswl_ini = function() {
    const plugin = this;
    plugin.cfg = plugin.config.get('dnswl.ini', () => {
        plugin.load_dnswl_ini();
    });

    if (plugin.cfg.main.enable_stats) {
        plugin.logdebug('stats reporting enabled');
        plugin.enable_stats = true;
    }

    if (plugin.cfg.main.stats_redis_host) {
        plugin.redis_host = plugin.cfg.main.stats_redis_host;
        plugin.logdebug(`set stats redis host to: ${plugin.redis_host}`);
    }

    plugin.zones = [];
    // Compatibility with old-plugin
    plugin.zones = plugin.zones.concat(
        plugin.config.get('dnswl.zones', 'list')
    );
    if (plugin.cfg.main.zones) {
        plugin.zones = plugin.zones.concat(
            plugin.cfg.main.zones.replace(/\s+/g, '').split(/[;,]/)
        );
    }

    if (plugin.cfg.main.periodic_checks) {
        plugin.check_zones(plugin.cfg.main.periodic_checks);
    }
};

exports.check_dnswl = (next, connection) =>
    connection.notes.dnswl ? next(OK) : next();

exports.hook_connect = function(next, connection) {
    const plugin = this;
    if (!plugin.zones || !plugin.zones.length) {
        connection.logerror(plugin, 'no zones');
        return next();
    }
    plugin.first(connection.remote.ip, plugin.zones, (err, zone, a) => {
        if (!a) return next();
        connection.loginfo(
            plugin,
            `${connection.remote.ip} is whitelisted by ${zone}: ${a}`
        );
        connection.notes.dnswl = true;
        return next(OK);
    });
};
