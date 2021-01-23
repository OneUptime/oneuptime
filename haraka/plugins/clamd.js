// clamd

const sock = require('./line_socket');
const utils = require('haraka-utils');

exports.load_excludes = function() {
    const plugin = this;

    plugin.loginfo('Loading excludes file');
    const list = plugin.config.get('clamd.excludes', 'list', () => {
        plugin.load_excludes();
    });

    const new_skip_list_exclude = [];
    const new_skip_list = [];
    for (let i = 0; i < list.length; i++) {
        let re;
        switch (list[i][0]) {
            case '!':
                if (list[i][1] === '/') {
                    // Regexp exclude
                    try {
                        re = new RegExp(
                            list[i].substr(2, list[i].length - 2),
                            'i'
                        );
                        new_skip_list_exclude.push(re);
                    } catch (e) {
                        plugin.logerror(`${e.message} (entry: ${list[i]})`);
                    }
                } else {
                    // Wildcard exclude
                    try {
                        re = new RegExp(
                            utils.wildcard_to_regexp(list[i].substr(1)),
                            'i'
                        );
                        new_skip_list_exclude.push(re);
                    } catch (e) {
                        plugin.logerror(`${e.message} (entry: ${list[i]})`);
                    }
                }
                break;
            case '/':
                // Regexp skip
                try {
                    re = new RegExp(list[i].substr(1, list[i].length - 2), 'i');
                    new_skip_list.push(re);
                } catch (e) {
                    plugin.logerror(`${e.message} (entry: ${list[i]})`);
                }
                break;
            default:
                // Wildcard skip
                try {
                    re = new RegExp(utils.wildcard_to_regexp(list[i]), 'i');
                    new_skip_list.push(re);
                } catch (e) {
                    plugin.logerror(`${e.message} (entry: ${list[i]})`);
                }
        }
    }

    // Make the new lists visible
    plugin.skip_list_exclude = new_skip_list_exclude;
    plugin.skip_list = new_skip_list;
};

exports.load_clamd_ini = function() {
    const plugin = this;

    plugin.cfg = plugin.config.get(
        'clamd.ini',
        {
            booleans: [
                '-main.randomize_host_order',
                '-main.only_with_attachments',
                '+reject.virus',
                '+reject.error',

                // clamd options that are disabled by default. If admin enables
                // them for clamd, Haraka should reject by default.
                '+reject.Broken.Executable',
                '+reject.Structured', // DLP options
                '+reject.Encrypted',
                '+reject.PUA',
                '+reject.OLE2',
                '+reject.Safebrowsing',
                '+reject.UNOFFICIAL',

                // clamd.conf options enabled by default, but prone to false
                // positives.
                '-reject.Phishing',

                '+check.authenticated',
                '+check.private_ip',
                '+check.local_ip',
            ],
        },
        () => {
            plugin.load_clamd_ini();
        }
    );

    const defaults = {
        clamd_socket: 'localhost:3310',
        timeout: 30,
        connect_timeout: 10,
        max_size: 26214400,
    };

    for (const key in defaults) {
        if (plugin.cfg.main[key] === undefined) {
            plugin.cfg.main[key] = defaults[key];
        }
    }

    const rejectPatterns = {
        'Broken.Executable': '^Broken\\.Executable\\.?',
        Encrypted: '^Encrypted\\.',
        PUA: '^PUA\\.',
        Structured: '^Heuristics\\.Structured\\.',
        OLE2: '^Heuristics\\.OLE2\\.ContainsMacros',
        Safebrowsing: '^Heuristics\\.Safebrowsing\\.',
        Phishing: '^Heuristics\\.Phishing\\.',
        UNOFFICIAL: '\\.UNOFFICIAL$',
    };

    const all_reject_opts = [];
    const enabled_reject_opts = [];
    Object.keys(rejectPatterns).forEach(opt => {
        all_reject_opts.push(rejectPatterns[opt]);
        if (!plugin.cfg.reject[opt]) return;
        enabled_reject_opts.push(rejectPatterns[opt]);
    });

    if (enabled_reject_opts.length) {
        plugin.allRE = new RegExp(all_reject_opts.join('|'));
        plugin.rejectRE = new RegExp(enabled_reject_opts.join('|'));
    }

    // resolve mismatch between docs (...attachment) and code (...attachments)
    if (plugin.cfg.main.only_with_attachment !== undefined) {
        plugin.cfg.main.only_with_attachments = !!plugin.cfg.main
            .only_with_attachment;
    }
};

exports.register = function() {
    const plugin = this;
    plugin.load_excludes();
    plugin.load_clamd_ini();
};

exports.hook_data = function(next, connection) {
    const plugin = this;

    if (!plugin.cfg.main.only_with_attachments) return next();

    if (!plugin.should_check(connection)) return next();

    const txn = connection.transaction;
    txn.parse_body = true;
    txn.attachment_hooks((ctype, filename, body) => {
        connection.logdebug(
            plugin,
            `found ctype=${ctype}, filename=${filename}`
        );
        txn.notes.clamd_found_attachment = true;
    });

    return next();
};

exports.hook_data_post = function(next, connection) {
    const plugin = this;
    const txn = connection.transaction;
    const cfg = plugin.cfg;

    if (!plugin.should_check(connection)) return next();

    // Do we need to run?
    if (cfg.main.only_with_attachments && !txn.notes.clamd_found_attachment) {
        connection.logdebug(plugin, 'skipping: no attachments found');
        txn.results.add(plugin, { skip: 'no attachments' });
        return next();
    }

    // Limit message size
    if (txn.data_bytes > cfg.main.max_size) {
        txn.results.add(plugin, { skip: 'exceeds max size', emit: true });
        return next();
    }

    const hosts = cfg.main.clamd_socket.split(/[,; ]+/);

    if (cfg.main.randomize_host_order) {
        hosts.sort(() => 0.5 - Math.random());
    }

    function try_next_host() {
        let connected = false;
        if (!hosts.length) {
            if (txn) txn.results.add(plugin, { err: 'connecting' });
            if (!plugin.cfg.reject.error) return next();
            return next(DENYSOFT, 'Error connecting to virus scanner');
        }
        const host = hosts.shift();
        connection.logdebug(plugin, `trying host: ${host}`);
        const socket = new sock.Socket();

        socket.on('timeout', () => {
            socket.destroy();
            if (!connected) {
                connection.logerror(plugin, `Timeout connecting to ${host}`);
                return try_next_host();
            }
            if (txn) txn.results.add(plugin, { err: 'clamd timed out' });
            if (!plugin.cfg.reject.error) return next();
            return next(DENYSOFT, 'Virus scanner timed out');
        });

        socket.on('error', err => {
            socket.destroy();
            if (!connected) {
                connection.logerror(
                    plugin,
                    `Connection to ${host} failed: ${err.message}`
                );
                return try_next_host();
            }

            // If an error occurred after connection and there are other hosts left to try,
            // then try those before returning DENYSOFT.
            if (hosts.length) {
                connection.logwarn(
                    plugin,
                    `error on host ${host}: ${err.message}`
                );
                return try_next_host();
            }
            if (txn)
                txn.results.add(plugin, {
                    err: `error on host ${host}: ${err.message}`,
                });
            if (!plugin.cfg.reject.error) return next();
            return next(DENYSOFT, 'Virus scanner error');
        });

        socket.on('connect', () => {
            connected = true;
            socket.setTimeout((cfg.main.timeout || 30) * 1000);
            const hp = socket.address();
            const addressInfo = hp === null ? '' : ` ${hp.address}:${hp.port}`;
            connection.logdebug(plugin, `connected to host${addressInfo}`);
            plugin.send_clamd_predata(socket, () => {
                txn.message_stream.pipe(socket, { clamd_style: true });
            });
        });

        let result = '';
        socket.on('line', line => {
            connection.logprotocol(
                plugin,
                `C:${line
                    .split('')
                    .filter(x => {
                        return 31 < x.charCodeAt(0) && 127 > x.charCodeAt(0);
                    })
                    .join('')}`
            );
            result = line.replace(/\r?\n/, '');
        });

        socket.setTimeout((cfg.main.connect_timeout || 10) * 1000);

        socket.on('end', () => {
            if (!txn) return next();
            if (/^stream: OK/.test(result)) {
                // OK
                txn.results.add(plugin, { pass: 'clean', emit: true });
                return next();
            }

            const m = /^stream: (\S+) FOUND/.exec(result);
            if (m) {
                let virus; // Virus found
                if (m[1]) {
                    virus = m[1];
                }
                txn.results.add(plugin, {
                    fail: virus ? virus : 'virus',
                    emit: true,
                });

                if (
                    virus &&
                    plugin.rejectRE && // enabled
                    plugin.allRE.test(virus) && // has a reject option
                    !plugin.rejectRE.test(virus)
                ) {
                    // reject=false set
                    return next();
                }
                if (!plugin.cfg.reject.virus) {
                    return next();
                }

                // Check skip list exclusions
                for (let i = 0; i < plugin.skip_list_exclude.length; i++) {
                    if (!plugin.skip_list_exclude[i].test(virus)) continue;
                    return next(
                        DENY,
                        `Message is infected with ${virus || 'UNKNOWN'}`
                    );
                }

                // Check skip list
                for (let j = 0; j < plugin.skip_list.length; j++) {
                    if (!plugin.skip_list[j].test(virus)) continue;
                    connection.logwarn(plugin, `${virus} matches exclusion`);
                    txn.add_header('X-Haraka-Virus', virus);
                    return next();
                }
                return next(
                    DENY,
                    `Message is infected with ${virus || 'UNKNOWN'}`
                );
            }

            if (/size limit exceeded/.test(result)) {
                txn.results.add(plugin, {
                    err:
                        'INSTREAM size limit exceeded. Check ' +
                        'StreamMaxLength in clamd.conf',
                });
                // Continue as StreamMaxLength default is 25Mb
                return next();
            }

            // The current host returned an unknown result.  If other hosts are available,
            // then try those before returning a DENYSOFT.
            if (hosts.length) {
                connection.logwarn(
                    plugin,
                    `unknown result: '${result}' from host ${host}`
                );
                socket.destroy();
                return try_next_host();
            }
            txn.results.add(plugin, {
                err: `unknown result: '${result}' from host ${host}`,
            });
            if (!plugin.cfg.reject.error) return next();
            return next(DENYSOFT, 'Error running virus scanner');
        });

        clamd_connect(socket, host);
    }

    // Start the process
    try_next_host();
};

exports.should_check = function(connection) {
    const plugin = this;

    let result = true; // default

    if (plugin.cfg.check.authenticated == false && connection.notes.auth_user) {
        connection.transaction.results.add(plugin, { skip: 'authed' });
        result = false;
    }

    if (plugin.cfg.check.relay == false && connection.relaying) {
        connection.transaction.results.add(plugin, { skip: 'relay' });
        result = false;
    }

    if (plugin.cfg.check.local_ip == false && connection.remote.is_local) {
        connection.transaction.results.add(plugin, { skip: 'local_ip' });
        result = false;
    }

    if (plugin.cfg.check.private_ip == false && connection.remote.is_private) {
        if (plugin.cfg.check.local_ip == true && connection.remote.is_local) {
            // local IPs are included in private IPs
        } else {
            connection.transaction.results.add(plugin, { skip: 'private_ip' });
            result = false;
        }
    }

    return result;
};

exports.send_clamd_predata = (socket, cb) => {
    socket.write('zINSTREAM\0', () => {
        const received = 'Received: from Haraka clamd plugin\r\n';
        const buf = Buffer.alloc(received.length + 4);
        buf.writeUInt32BE(received.length, 0);
        buf.write(received, 4);
        socket.write(buf, cb);
    });
};

function clamd_connect(socket, host) {
    let match;
    if (host.match(/^\//)) {
        // assume unix socket
        socket.connect(host);
    } else if ((match = /^\[([^\] ]+)\](?::(\d+))?/.exec(host))) {
        // IPv6 literal
        socket.connect(match[2] || 3310, match[1]);
    } else {
        // IP:port, hostname:port or hostname
        const hostport = host.split(/:/);
        socket.connect(hostport[1] || 3310, hostport[0]);
    }
}
