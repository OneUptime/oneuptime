'use strict';
// SMTP client object and class. This allows every part of the client
// protocol to be hooked for different levels of control, such as
// smtp_forward and smtp_proxy queue plugins.
// It can use HostPool to get a connection to a pool of
// possible hosts in the configuration value "forwarding_host_pool", rather
// than a bunch of connections to a single host from the configuration values
// in "host" and "port" (see host_pool.js).

// node.js builtins
const events = require('events');

// npm deps
const generic_pool = require('generic-pool');
const ipaddr = require('ipaddr.js');
const net_utils = require('haraka-net-utils');
const utils = require('haraka-utils');

// haraka libs
const line_socket = require('./line_socket');
const logger = require('./logger');
const HostPool = require('./host_pool');

const smtp_regexp = /^([0-9]{3})([ -])(.*)/;
const STATE = {
    IDLE: 1,
    ACTIVE: 2,
    RELEASED: 3,
    DESTROYED: 4,
};

class SMTPClient extends events.EventEmitter {
    constructor(port, host, connect_timeout, idle_timeout, socket) {
        super();
        this.uuid = utils.uuid();
        this.connect_timeout = parseInt(connect_timeout) || 30;
        this.socket = socket || line_socket.connect(port, host);
        this.socket.setTimeout(this.connect_timeout * 1000);
        this.socket.setKeepAlive(true);
        this.state = STATE.IDLE;
        this.command = 'greeting';
        this.response = [];
        this.connected = false;
        this.authenticating = false;
        this.authenticated = false;
        this.auth_capabilities = [];
        this.host = host;
        this.port = port;
        this.smtputf8 = false;

        const client = this;

        client.socket.on('line', line => {
            client.emit('server_protocol', line);
            const matches = smtp_regexp.exec(line);
            if (!matches) {
                client.emit(
                    'error',
                    `${client.uuid}: Unrecognized response from upstream server: ${line}`
                );
                client.destroy();
                return;
            }

            const code = matches[1];
            const cont = matches[2];
            const msg = matches[3];

            client.response.push(msg);
            if (cont !== ' ') return;

            if (client.command === 'auth' || client.authenticating) {
                logger.loginfo(
                    `SERVER RESPONSE, CLIENT ${client.command}, authenticating=${client.authenticating},code=${code},cont=${cont},msg=${msg}`
                );
                if (/^3/.test(code) && msg === 'VXNlcm5hbWU6') {
                    client.emit('auth_username');
                    return;
                }
                if (/^3/.test(code) && msg === 'UGFzc3dvcmQ6') {
                    client.emit('auth_password');
                    return;
                }
                if (/^2/.test(code) && client.authenticating) {
                    logger.loginfo('AUTHENTICATED');
                    client.authenticating = false;
                    client.authenticated = true;
                    client.emit('auth');
                    return;
                }
            }

            if (client.command === 'ehlo') {
                if (code.match(/^5/)) {
                    // Handle fallback to HELO if EHLO is rejected
                    client.emit('greeting', 'HELO');
                    return;
                }
                client.emit('capabilities');
                if (client.command !== 'ehlo') {
                    return;
                }
            }

            if (client.command === 'xclient' && /^5/.test(code)) {
                // XCLIENT command was rejected (no permission?)
                // Carry on without XCLIENT
                client.command = 'helo';
            } else if (/^[45]/.test(code)) {
                client.emit('bad_code', code, client.response.join(' '));
                if (client.state !== STATE.ACTIVE) {
                    return;
                }
            }

            if (/^441/.test(code)) {
                if (/Connection timed out/i.test(msg)) {
                    client.destroy();
                }
            }

            switch (client.command) {
                case 'xclient':
                    client.xclient = true;
                    client.emit('xclient', 'EHLO');
                    break;
                case 'starttls':
                    client.upgrade(client.tls_options);
                    break;
                case 'greeting':
                    client.connected = true;
                    client.emit('greeting', 'EHLO');
                    break;
                case 'ehlo':
                    client.emit('helo');
                    break;
                case 'helo':
                case 'mail':
                case 'rcpt':
                case 'data':
                case 'dot':
                case 'rset':
                case 'auth':
                    client.emit(client.command);
                    break;
                case 'quit':
                    client.emit('quit');
                    client.destroy();
                    break;
                default:
                    throw new Error(`Unknown command: ${client.command}`);
            }
        });

        client.socket.on('connect', () => {
            // Replace connection timeout with idle timeout
            client.socket.setTimeout((idle_timeout || 300) * 1000);
            if (!client.socket.remoteAddress) {
                // "Value may be undefined if the socket is destroyed"
                logger.logdebug('socket.remoteAddress undefined');
                return;
            }
            client.remote_ip = ipaddr
                .process(client.socket.remoteAddress)
                .toString();
        });

        function closed(msg) {
            return error => {
                if (!error) {
                    error = '';
                }
                // msg is e.g. "errored" or "timed out"
                // error is e.g. "Error: connect ECONNREFUSED"
                const errMsg = `${client.uuid}: [${client.host}:${client.port}] SMTP connection ${msg} ${error}`;
                if (client.state === STATE.ACTIVE) {
                    client.emit('error', errMsg);
                }
                switch (client.state) {
                    case STATE.ACTIVE:
                    case STATE.IDLE:
                    case STATE.RELEASED:
                        client.destroy();
                        break;
                    default:
                }
                if (
                    (msg === 'errored' || msg === 'timed out') &&
                    client.state === STATE.DESTROYED
                ) {
                    client.emit('connection-error', errMsg);
                } // don't return, continue (original behavior)

                logger.logdebug(
                    `[smtp_client_pool] ${errMsg} (state=${client.state})`
                );
            };
        }

        client.socket.on('error', closed('errored'));
        client.socket.on('timeout', closed('timed out'));
        client.socket.on('close', closed('closed'));
        client.socket.on('end', closed('ended'));
    }

    load_tls_config(opts) {
        const tls_options = { servername: this.host };
        if (opts) {
            Object.assign(tls_options, opts);
        }

        this.tls_options = tls_options;
    }

    send_command(command, data) {
        const line =
            command === 'dot' ? '.' : command + (data ? ` ${data}` : '');
        this.emit('client_protocol', line);
        this.command = command.toLowerCase();
        this.response = [];
        this.socket.write(`${line}\r\n`);
    }

    start_data(data) {
        this.response = [];
        this.command = 'dot';
        data.pipe(this.socket, {
            dot_stuffing: true,
            ending_dot: true,
            end: false,
        });
    }

    release() {
        if (
            !this.connected ||
            this.command === 'data' ||
            this.command === 'mailbody'
        ) {
            // Destroy here, we can't reuse a connection that was mid-data.
            this.destroy();
            return;
        }

        logger.logdebug(
            `[smtp_client_pool] ${this.uuid} resetting, state=${this.state}`
        );
        if (this.state === STATE.DESTROYED) {
            return;
        }
        this.state = STATE.RELEASED;

        [
            'auth',
            'bad_code',
            'capabilities',
            'client_protocol',
            'connection-error',
            'data',
            'dot',
            'error',
            'greeting',
            'helo',
            'mail',
            'rcpt',
            'rset',
            'server_protocol',
            'xclient',
        ].forEach(l => {
            this.removeAllListeners(l);
        });

        this.on('bad_code', (code, msg) => {
            this.destroy();
        });

        this.on('rset', () => {
            logger.logdebug(
                `[smtp_client_pool] ${this.uuid} releasing, state=${this.state}`
            );
            if (this.state === STATE.DESTROYED) return;

            this.state = STATE.IDLE;
            this.removeAllListeners('rset');
            this.removeAllListeners('bad_code');
            this.pool.release(this);
        });

        this.send_command('RSET');
    }

    destroy() {
        if (this.state !== STATE.DESTROYED) {
            this.pool.destroy(this);
        }
    }

    upgrade(tls_options) {
        const this_logger = logger;

        this.socket.upgrade(
            tls_options,
            (verified, verifyError, cert, cipher) => {
                this_logger.loginfo(
                    `secured:${
                        cipher
                            ? ` cipher=${cipher.name} version=${cipher.version}`
                            : ''
                    } verified=${verified}${
                        verifyError ? ` error="${verifyError}"` : ''
                    }${
                        cert && cert.subject
                            ? ` cn="${cert.subject.CN}" organization="${cert.subject.O}"`
                            : ''
                    }${
                        cert && cert.issuer ? ` issuer="${cert.issuer.O}"` : ''
                    }${
                        cert && cert.valid_to
                            ? ` expires="${cert.valid_to}"`
                            : ''
                    }${
                        cert && cert.fingerprint
                            ? ` fingerprint=${cert.fingerprint}`
                            : ''
                    }`
                );
            }
        );
    }

    is_dead_sender(plugin, connection) {
        if (connection.transaction) return false;

        // This likely means the sender went away on us, cleanup.
        connection.logwarn(
            plugin,
            'transaction went away, releasing smtp_client'
        );
        this.release();
        return true;
    }
}

exports.smtp_client = SMTPClient;

// Separate pools are kept for each set of server attributes.
exports.get_pool = (server, port, host, cfg) => {
    port = port || 25;
    host = host || 'localhost';
    if (cfg === undefined) cfg = {};
    const connect_timeout = cfg.connect_timeout || 30;
    const pool_timeout = cfg.pool_timeout || cfg.timeout || 300;
    const auth_user = cfg.auth_user || 'no_user';
    const name = `${port}:${host}:${pool_timeout}:${auth_user}`;
    if (!server.notes.pool) server.notes.pool = {};
    if (server.notes.pool[name]) return server.notes.pool[name];

    const pool = generic_pool.Pool({
        name,
        create: callback => {
            const smtp_client = new SMTPClient(
                port,
                host,
                connect_timeout,
                pool_timeout
            );
            logger.logdebug(
                `[smtp_client_pool] uuid=${smtp_client.uuid} host=${host}` +
                    ` port=${port} pool_timeout=${pool_timeout} created`
            );
            callback(null, smtp_client);
        },
        destroy: smtp_client => {
            logger.logdebug(
                `[smtp_client_pool] ${smtp_client.uuid} destroyed, state={smtp_client.state}`
            );
            smtp_client.state = STATE.DESTROYED;
            smtp_client.socket.destroy();
            // Remove pool object from server notes once empty
            const size = pool.getPoolSize();
            if (size === 0) {
                delete server.notes.pool[name];
            }
        },
        max: cfg.max_connections || 1000,
        idleTimeoutMillis: (pool_timeout - 1) * 1000,
        log: (str, level) => {
            level = level === 'verbose' ? 'debug' : level;
            logger[`log${level}`](`[smtp_client_pool] [${name}] ${str}`);
        },
    });

    const acquire = pool.acquire;
    pool.acquire = (callback, priority) => {
        function callback_wrapper(err, smtp_client) {
            smtp_client.pool = pool;
            smtp_client.state = STATE.ACTIVE;
            callback(err, smtp_client);
        }
        acquire.call(pool, callback_wrapper, priority);
    };
    server.notes.pool[name] = pool;
    return pool;
};

// Get a smtp_client for the given attributes.
exports.get_client = (server, callback, port, host, cfg) => {
    const pool = exports.get_pool(server, port, host, cfg);
    pool.acquire(callback);
};

exports.onCapabilitiesOutbound = (
    smtp_client,
    secured,
    connection,
    config,
    on_secured
) => {
    for (const line in smtp_client.response) {
        if (/^XCLIENT/.test(smtp_client.response[line])) {
            if (!smtp_client.xclient) {
                smtp_client.send_command(
                    'XCLIENT',
                    `ADDR=${connection.remote.ip}`
                );
                return;
            }
        }

        if (/^SMTPUTF8/.test(smtp_client.response[line])) {
            smtp_client.smtputf8 = true;
        }

        if (/^STARTTLS/.test(smtp_client.response[line]) && !secured) {
            let hostBanned = false;
            let serverBanned = false;

            // Check if there are any banned TLS hosts
            if (smtp_client.tls_options.no_tls_hosts) {
                // If there are check if these hosts are in the blacklist
                hostBanned = net_utils.ip_in_list(
                    smtp_client.tls_config.no_tls_hosts,
                    config.host
                );
                serverBanned = net_utils.ip_in_list(
                    smtp_client.tls_config.no_tls_hosts,
                    smtp_client.remote_ip
                );
            }

            if (!hostBanned && !serverBanned && config.enable_tls) {
                smtp_client.socket.on('secure', on_secured);
                smtp_client.secured = false; // have to wait in forward plugin before we can do auth, even if capabilities are there on first EHLO
                smtp_client.send_command('STARTTLS');
                return;
            }
        }

        let auth_matches = smtp_client.response[line].match(/^AUTH (.*)$/);
        if (auth_matches) {
            smtp_client.auth_capabilities = [];
            auth_matches = auth_matches[1].split(' ');
            for (let i = 0; i < auth_matches.length; i++) {
                smtp_client.auth_capabilities.push(
                    auth_matches[i].toLowerCase()
                );
            }
        }
    }
};

// Get a smtp_client for the given attributes and set up the common
// config and listeners for plugins. This is what smtp_proxy and
// smtp_forward have in common.
exports.get_client_plugin = (plugin, connection, c, callback) => {
    // c = config
    // Merge in authentication settings from smtp_forward/proxy.ini if present
    // FIXME: config.auth could be changed when API isn't frozen
    if (c.auth_type || c.auth_user || c.auth_pass) {
        c.auth = {
            type: c.auth_type,
            user: c.auth_user,
            pass: c.auth_pass,
        };
    }

    const hostport = get_hostport(connection, connection.server, c);

    const pool = exports.get_pool(
        connection.server,
        hostport.port,
        hostport.host,
        c
    );

    pool.acquire((err, smtp_client) => {
        connection.logdebug(plugin, `Got smtp_client: ${smtp_client.uuid}`);

        let secured = false;

        smtp_client.load_tls_config(plugin.tls_options);

        smtp_client.call_next = function(retval, msg) {
            if (this.next) {
                const next = this.next;
                delete this.next;
                next(retval, msg);
            }
        };

        smtp_client.on('client_protocol', line => {
            connection.logprotocol(plugin, `C: ${line}`);
        });

        smtp_client.on('server_protocol', line => {
            connection.logprotocol(plugin, `S: ${line}`);
        });

        function helo(command) {
            if (smtp_client.xclient) {
                smtp_client.send_command(command, connection.hello.host);
            } else {
                smtp_client.send_command(command, connection.local.host);
            }
        }
        smtp_client.on('greeting', helo);
        smtp_client.on('xclient', helo);

        function on_secured() {
            secured = true;
            smtp_client.secured = true;
            smtp_client.emit('greeting', 'EHLO');
        }

        smtp_client.on('capabilities', () => {
            exports.onCapabilitiesOutbound(
                smtp_client,
                secured,
                connection,
                c,
                on_secured
            );
        });

        smtp_client.on('helo', () => {
            if (!c.auth || smtp_client.authenticated) {
                if (smtp_client.is_dead_sender(plugin, connection)) {
                    return;
                }
                smtp_client.send_command(
                    'MAIL',
                    `FROM:${connection.transaction.mail_from.format(
                        !smtp_client.smtp_utf8
                    )}`
                );
                return;
            }

            if (c.auth.type === null || typeof c.auth.type === 'undefined')
                return; // Ignore blank
            const auth_type = c.auth.type.toLowerCase();
            if (!smtp_client.auth_capabilities.includes(auth_type)) {
                throw new Error(
                    `Auth type "${auth_type}" not supported by server (supports: ${smtp_client.auth_capabilities.join(
                        ','
                    )})`
                );
            }
            switch (auth_type) {
                case 'plain':
                    if (!c.auth.user || !c.auth.pass) {
                        throw new Error(
                            'Must include auth.user and auth.pass for PLAIN auth.'
                        );
                    }
                    logger.logdebug(
                        `[smtp_client_pool] uuid=${smtp_client.uuid} authenticating as "${c.auth.user}"`
                    );
                    smtp_client.send_command(
                        'AUTH',
                        `PLAIN ${utils.base64(
                            `${c.auth.user}\0${c.auth.user}\0${c.auth.pass}`
                        )}`
                    );
                    break;
                case 'cram-md5':
                    throw new Error('Not implemented');
                default:
                    throw new Error(`Unknown AUTH type: ${auth_type}`);
            }
        });

        smtp_client.on('auth', () => {
            // if authentication has been handled by plugin(s)
            if (smtp_client.authenticating) return;

            if (smtp_client.is_dead_sender(plugin, connection)) return;

            smtp_client.authenticated = true;
            smtp_client.send_command(
                'MAIL',
                `FROM:${connection.transaction.mail_from.format(
                    !smtp_client.smtp_utf8
                )}`
            );
        });

        // these errors only get thrown when the connection is still active
        smtp_client.on('error', msg => {
            connection.logwarn(plugin, msg);
            smtp_client.call_next();
        });

        // these are the errors thrown when the connection is dead
        smtp_client.on('connection-error', error => {
            // error contains e.g. "Error: connect ECONNREFUSE"
            logger.logerror(
                `backend failure: ${smtp_client.host}:${smtp_client.port} - ${error}`
            );
            const host_pool = connection.server.notes.host_pool;
            // only exists for if forwarding_host_pool is set in the config
            if (host_pool) {
                host_pool.failed(smtp_client.host, smtp_client.port);
            }
            smtp_client.call_next();
        });

        if (smtp_client.connected) {
            if (smtp_client.xclient) {
                smtp_client.send_command(
                    'XCLIENT',
                    `ADDR=${connection.remote.ip}`
                );
            } else {
                smtp_client.emit('helo');
            }
        }

        callback(err, smtp_client);
    });
};

function get_hostport(connection, server, cfg) {
    if (cfg.forwarding_host_pool) {
        if (!server.notes.host_pool) {
            connection.logwarn(
                `creating host_pool from ${cfg.forwarding_host_pool}`
            );
            server.notes.host_pool = new HostPool(
                cfg.forwarding_host_pool, // 1.2.3.4:420, 5.6.7.8:420
                cfg.dead_forwarding_host_retry_secs
            );
        }

        const host = server.notes.host_pool.get_host();
        if (host) return host; // { host: 1.2.3.4, port: 567 }

        logger.logerror('[smtp_client_pool] no backend hosts in pool!');
        throw new Error('no backend hosts found in pool!');
    }

    if (cfg.host && cfg.port) {
        return { host: cfg.host, port: cfg.port };
    }

    logger.logwarn(
        '[smtp_client_pool] forwarding_host_pool or host and port ' +
            'were not found in config file'
    );
    throw new Error(
        'You must specify either forwarding_host_pool or host and port'
    );
}
