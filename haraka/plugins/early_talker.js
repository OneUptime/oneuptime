// This plugin checks for clients that talk before we sent a response

const ipaddr = require('ipaddr.js');
const isIPv6 = require('net').isIPv6;

exports.register = function() {
    const plugin = this;
    plugin.load_config();
    plugin.register_hook('connect_init', 'early_talker');
    plugin.register_hook('data', 'early_talker');
};

exports.load_config = function() {
    const plugin = this;

    plugin.cfg = plugin.config.get(
        'early_talker.ini',
        {
            booleans: ['+main.reject'],
        },
        () => {
            plugin.load_config();
        }
    );

    // Generate a white list of IP addresses
    plugin.whitelist = plugin.load_ip_list(
        Object.keys(plugin.cfg.ip_whitelist)
    );

    if (plugin.cfg.main && plugin.cfg.main.pause) {
        plugin.pause = plugin.cfg.main.pause * 1000;
        return;
    }

    // config/early_talker.pause is in milliseconds
    plugin.pause = plugin.config.get('early_talker.pause', () => {
        plugin.load_config();
    });
};

exports.early_talker = function(next, connection) {
    const plugin = this;
    if (!plugin.pause) return next();
    if (!plugin.should_check(connection)) return next();

    function check() {
        if (!connection) return next();
        if (!connection.early_talker) {
            connection.results.add(plugin, { pass: 'early' });
            return next();
        }
        connection.results.add(plugin, { fail: 'early' });
        if (!plugin.cfg.main.reject) return next();
        return next(DENYDISCONNECT, 'You talk too soon');
    }

    let pause = plugin.pause;
    if (plugin.hook === 'connect_init') {
        const elapsed = Date.now() - connection.start_time;
        if (elapsed > plugin.pause) {
            // Something else already waited
            return check();
        }
        pause = plugin.pause - elapsed;
    }

    setTimeout(() => {
        check();
    }, pause);
};

/**
 * Check if an ip is whitelisted
 *
 * @param  {String} ip       The remote IP to verify
 * @return {Boolean}         True if is whitelisted
 */
exports.ip_in_list = function(ip) {
    const plugin = this;

    if (!plugin.whitelist) return false;

    const ipobj = ipaddr.parse(ip);

    for (let i = 0; i < plugin.whitelist.length; i++) {
        try {
            if (ipobj.match(plugin.whitelist[i])) {
                return true;
            }
        } catch (ignore) {}
    }
    return false;
};

/**
 * Convert config ip to ipaddr objects
 *
 * @param  {Array} list A list of IP addresses / subnets
 * @return {Array}      The converted array
 */
exports.load_ip_list = list => {
    const whitelist = [];

    for (let i = 0; i < list.length; i++) {
        try {
            let addr = list[i];
            if (addr.match(/\/\d+$/)) {
                addr = ipaddr.parseCIDR(addr);
            } else {
                addr = ipaddr.parseCIDR(addr + (isIPv6(addr) ? '/128' : '/32'));
            }

            whitelist.push(addr);
        } catch (ignore) {}
    }
    return whitelist;
};

exports.should_check = function(connection) {
    const plugin = this;
    // Skip delays for privileged senders

    if (connection.notes.auth_user) {
        connection.results.add(plugin, { skip: 'authed' });
        return false;
    }

    if (connection.relaying) {
        connection.results.add(plugin, { skip: 'relay' });
        return false;
    }

    if (plugin.ip_in_list(connection.remote.ip)) {
        connection.results.add(plugin, { skip: 'whitelist' });
        return false;
    }

    const karma = connection.results.get('karma');
    if (karma && karma.good > 0) {
        connection.results.add(plugin, { skip: '+karma' });
        return false;
    }

    if (connection.remote.is_local) {
        connection.results.add(plugin, { skip: 'local_ip' });
        return false;
    }

    if (connection.remote.is_private) {
        connection.results.add(plugin, { skip: 'private_ip' });
        return false;
    }

    return true;
};
