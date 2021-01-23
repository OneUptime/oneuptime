// dnsbl plugin

exports.register = function() {
    const plugin = this;
    plugin.inherits('dns_list_base');

    plugin.load_config();

    if (plugin.cfg.main.periodic_checks) {
        plugin.check_zones(plugin.cfg.main.periodic_checks);
    }

    if (plugin.cfg.main.search === 'all') {
        plugin.register_hook('connect', 'connect_multi');
    } else {
        plugin.register_hook('connect', 'connect_first');
    }
};

exports.load_config = function() {
    const plugin = this;

    plugin.cfg = plugin.config.get(
        'dnsbl.ini',
        {
            booleans: ['+main.reject', '-main.enable_stats'],
        },
        () => {
            plugin.load_config();
        }
    );

    if (plugin.cfg.main.enable_stats && !plugin.enable_stats) {
        plugin.loginfo('stats reporting enabled');
        plugin.enable_stats = true;
    }
    if (!plugin.cfg.main.enable_stats && plugin.enable_stats) {
        plugin.loginfo('stats reporting disabled');
        plugin.enable_stats = false;
    }

    if (
        plugin.cfg.main.stats_redis_host &&
        plugin.cfg.main.stats_redis_host !== plugin.redis_host
    ) {
        plugin.redis_host = plugin.cfg.main.stats_redis_host;
        plugin.loginfo(`set stats redis host to: ${plugin.redis_host}`);
    }

    plugin.get_uniq_zones();
};

exports.get_uniq_zones = function() {
    const plugin = this;
    plugin.zones = [];

    const unique_zones = {};

    // Compatibility with old plugin
    const legacy_zones = plugin.config.get('dnsbl.zones', 'list');
    for (let i = 0; i < legacy_zones.length; i++) {
        unique_zones[legacy_zones[i]] = true;
    }

    if (plugin.cfg.main.zones) {
        const new_zones = plugin.cfg.main.zones.split(/[\s,;]+/);
        for (let h = 0; h < new_zones.length; h++) {
            unique_zones[new_zones[h]] = true;
        }
    }

    for (const key in unique_zones) {
        plugin.zones.push(key);
    }
    return plugin.zones;
};

exports.should_skip = function(connection) {
    const plugin = this;

    if (!connection) {
        return true;
    }

    if (connection.remote.is_private) {
        connection.logdebug(plugin, `skip private: ${connection.remote.ip}`);
        return true;
    }

    if (!plugin.zones || !plugin.zones.length) {
        connection.logerror(plugin, 'no zones');
        return true;
    }

    return false;
};

exports.connect_first = function(next, connection) {
    const plugin = this;
    const remote_ip = connection.remote.ip;

    if (plugin.should_skip(connection)) {
        return next();
    }

    plugin.first(
        remote_ip,
        plugin.zones,
        (err, zone, a) => {
            if (err) {
                connection.results.add(plugin, { err: err.message });
                return next();
            }
            if (!a) return next();

            const msg = `host [${remote_ip}] is blacklisted by ${zone}`;
            if (plugin.cfg.main.reject) return next(DENY, msg);

            connection.loginfo(plugin, msg);
            return next();
        },
        function each_result(err, zone, a) {
            if (err) return;
            const result = a ? { fail: zone } : { pass: zone };
            connection.results.add(plugin, result);
        }
    );
};

exports.connect_multi = function(next, connection) {
    const plugin = this;
    const remote_ip = connection.remote.ip;

    if (plugin.should_skip(connection)) {
        return next();
    }

    const hits = [];
    function get_deny_msg() {
        return `host [${remote_ip}] is blacklisted by ${hits.join(', ')}`;
    }

    plugin.multi(remote_ip, plugin.zones, (err, zone, a, pending) => {
        if (err) {
            connection.results.add(plugin, { err: err.message });
            if (pending) return;
            if (plugin.cfg.main.reject && hits.length) {
                return next(DENY, get_deny_msg());
            }
            return next();
        }

        if (a) {
            hits.push(zone);
            connection.results.add(plugin, { fail: zone });
        } else {
            if (zone) connection.results.add(plugin, { pass: zone });
        }

        if (pending) return;
        connection.results.add(plugin, { emit: true });

        if (plugin.cfg.main.reject && hits.length) {
            return next(DENY, get_deny_msg());
        }
        return next();
    });
};
