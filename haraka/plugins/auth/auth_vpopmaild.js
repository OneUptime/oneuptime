// Auth against vpopmaild

const net = require('net');

exports.register = function() {
    const plugin = this;
    plugin.inherits('auth/auth_base');
    plugin.load_vpop_ini();
};

exports.load_vpop_ini = function() {
    const plugin = this;
    plugin.cfg = plugin.config.get('auth_vpopmaild.ini', () => {
        plugin.load_vpop_ini();
    });
};

exports.hook_capabilities = function(next, connection) {
    if (!connection.tls.enabled) {
        return next();
    }
    const plugin = this;

    const methods = ['PLAIN', 'LOGIN'];
    if (plugin.cfg.main.sysadmin) {
        methods.push('CRAM-MD5');
    }

    connection.capabilities.push(`AUTH ${methods.join(' ')}`);
    connection.notes.allowed_auth_methods = methods;

    return next();
};

exports.check_plain_passwd = function(connection, user, passwd, cb) {
    const plugin = this;

    let chunk_count = 0;
    let auth_success = false;

    const socket = plugin.get_vpopmaild_socket(user);
    socket.setEncoding('utf8');

    socket.on('data', chunk => {
        chunk_count++;
        if (chunk_count === 1) {
            if (/^\+OK/.test(chunk)) {
                socket.write(`slogin ${user} ${passwd}\n\r`);
                return;
            }
            socket.end();
        }
        if (chunk_count === 2) {
            if (/^\+OK/.test(chunk)) {
                // slogin reply
                auth_success = true;
                socket.write('quit\n\r');
            }
            socket.end(); // disconnect
        }
    });
    socket.on('end', () => {
        connection.loginfo(
            plugin,
            `AUTH user="${user}" success=${auth_success}`
        );
        return cb(auth_success);
    });
};

exports.get_sock_opts = function(user) {
    const plugin = this;

    plugin.sock_opts = {
        port: 89,
        host: '127.0.0.1',
        sysadmin: undefined,
    };

    const domain = user.split('@')[1];
    let sect = plugin.cfg.main;
    if (domain && plugin.cfg[domain]) {
        sect = plugin.cfg[domain];
    }

    if (sect.port) {
        plugin.sock_opts.port = sect.port;
    }
    if (sect.host) {
        plugin.sock_opts.host = sect.host;
    }
    if (sect.sysadmin) {
        plugin.sock_opts.sysadmin = sect.sysadmin;
    }

    plugin.logdebug(`sock: ${plugin.sock_opts.host}:${plugin.sock_opts.port}`);
    return plugin.sock_opts;
};

exports.get_vpopmaild_socket = function(user) {
    const plugin = this;
    plugin.get_sock_opts(user);

    const socket = new net.Socket();
    socket.connect(plugin.sock_opts.port, plugin.sock_opts.host);
    socket.setTimeout(300 * 1000);
    socket.setEncoding('utf8');

    socket.on('timeout', () => {
        plugin.logerror('vpopmaild connection timed out');
        socket.end();
    });
    socket.on('error', err => {
        plugin.logerror(`vpopmaild connection failed: ${err}`);
        socket.end();
    });
    socket.on('connect', () => {
        plugin.logdebug('vpopmail connected');
    });
    return socket;
};

exports.get_plain_passwd = function(user, connection, cb) {
    const plugin = this;

    const socket = plugin.get_vpopmaild_socket(user);
    if (!plugin.sock_opts.sysadmin) {
        plugin.logerror('missing sysadmin credentials');
        return cb(null);
    }

    const sys = plugin.sock_opts.sysadmin.split(':');
    let plain_pass = null;
    let chunk_count = 0;

    socket.on('data', chunk => {
        chunk_count++;
        plugin.logdebug(`${chunk_count}\t${chunk}`);
        if (chunk_count === 1) {
            if (/^\+OK/.test(chunk)) {
                socket.write(`slogin ${sys[0]} ${sys[1]}\n\r`);
                return;
            }
            plugin.logerror('no ok to start');
            socket.end(); // disconnect
        }
        // slogin reply
        if (chunk_count === 2) {
            if (/^\+OK/.test(chunk)) {
                plugin.logdebug('login success, getting user info');
                socket.write(`user_info ${user}\n\r`);
                return;
            }
            plugin.logerror('syadmin login failed');
            socket.end(); // disconnect
        }
        if (chunk_count > 2) {
            if (/^-ERR/.test(chunk)) {
                plugin.lognotice(`get_plain failed: ${chunk}`);
                socket.end(); // disconnect
                return;
            }
            if (!/clear_text_password/.test(chunk)) {
                return; // pass might be in the next chunk
            }
            const pass = chunk.match(/clear_text_password\s(\S+)\s/);
            plain_pass = pass[1];
            socket.write('quit\n\r');
        }
    });
    socket.on('end', () => {
        cb(plain_pass ? plain_pass.toString() : plain_pass);
    });
};
