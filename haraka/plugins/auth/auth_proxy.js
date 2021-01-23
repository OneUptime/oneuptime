// Proxy AUTH requests selectively by domain
const sock = require('./line_socket');
const utils = require('haraka-utils');
const smtp_regexp = /^([0-9]{3})([ -])(.*)/;

exports.register = function() {
    const plugin = this;
    plugin.inherits('auth/auth_base');
    plugin.load_tls_ini();
};

exports.load_tls_ini = function() {
    const plugin = this;
    plugin.tls_cfg = plugin.config.get('tls.ini', () => {
        plugin.load_tls_ini();
    });
};

exports.hook_capabilities = (next, connection) => {
    if (connection.tls.enabled) {
        const methods = ['PLAIN', 'LOGIN'];
        connection.capabilities.push(`AUTH ${methods.join(' ')}`);
        connection.notes.allowed_auth_methods = methods;
    }
    next();
};

exports.check_plain_passwd = function(connection, user, passwd, cb) {
    let domain;
    if ((domain = /@([^@]+)$/.exec(user))) {
        domain = domain[1].toLowerCase();
    } else {
        // AUTH user not in user@domain.com format
        connection.logerror(
            this,
            `AUTH user="${user}" error="not in required format"`
        );
        return cb(false);
    }

    // Check if domain exists in configuration file
    const config = this.config.get('auth_proxy.ini');
    if (!config.domains[domain]) {
        connection.logerror(
            this,
            `AUTH user="${user}" error="domain '${domain}' is not defined"`
        );
        return cb(false);
    }

    this.try_auth_proxy(
        connection,
        config.domains[domain].split(/[,; ]/),
        user,
        passwd,
        cb
    );
};

exports.try_auth_proxy = function(connection, hosts, user, passwd, cb) {
    if (!hosts || (hosts && !hosts.length)) return cb(false);
    if (typeof hosts !== 'object') {
        hosts = [hosts];
    }

    const self = this;
    const host = hosts.shift();
    let methods = [];
    let auth_complete = false;
    let auth_success = false;
    let command = 'connect';
    let response = [];
    let secure = false;

    const hostport = host.split(/:/);
    const socket = sock.connect(hostport[1] ? hostport[1] : 25, hostport[0]);
    connection.logdebug(
        self,
        `attempting connection to host=${hostport[0]} port=${
            hostport[1] ? hostport[1] : 25
        }`
    );
    socket.setTimeout(30 * 1000);
    socket.on('connect', () => {});
    socket.on('close', () => {
        if (!auth_complete) {
            // Try next host
            return self.try_auth_proxy(connection, hosts, user, passwd, cb);
        }
        connection.loginfo(
            self,
            `AUTH user="${user}" host="${host}" success=${auth_success}`
        );
        return cb(auth_success);
    });
    socket.on('timeout', () => {
        connection.logerror(self, 'connection timed out');
        socket.end();
        // Try next host
        return self.try_auth_proxy(connection, hosts, user, passwd, cb);
    });
    socket.on('error', err => {
        connection.logerror(self, `connection failed to host ${host}: ${err}`);
        socket.end();
        return;
    });
    socket.send_command = function(cmd, data) {
        let line = cmd + (data ? ` ${data}` : '');
        if (cmd === 'dot') {
            line = '.';
        }
        connection.logprotocol(self, `C: ${line}`);
        command = cmd.toLowerCase();
        this.write(`${line}\r\n`);
        // Clear response buffer from previous command
        response = [];
    };
    socket.on('line', function(line) {
        connection.logprotocol(self, `S: ${line}`);
        const matches = smtp_regexp.exec(line);
        if (!matches) {
            connection.logerror(self, `unrecognised response: ${line}`);
            socket.end();
            return;
        }

        const code = matches[1];
        const cont = matches[2];
        const rest = matches[3];
        response.push(rest);
        if (cont !== ' ') return;

        let key;
        let cert;

        connection.logdebug(self, `command state: ${command}`);
        if (command === 'ehlo') {
            if (code[0] === '5') {
                // EHLO command rejected; abort
                socket.send_command('QUIT');
                return;
            }
            // Parse CAPABILITIES
            for (const i in response) {
                if (/^STARTTLS/.test(response[i])) {
                    if (secure) continue; // silly remote, we've already upgraded
                    // Use TLS opportunistically if we found the key and certificate
                    key = self.config.get(
                        self.tls_cfg.main.key || 'tls_key.pem',
                        'binary'
                    );
                    cert = self.config.get(
                        self.tls_cfg.main.cert || 'tls_cert.pem',
                        'binary'
                    );
                    if (key && cert) {
                        this.on('secure', () => {
                            secure = true;
                            socket.send_command('EHLO', connection.local.host);
                        });
                        socket.send_command('STARTTLS');
                        return;
                    }
                } else if (/^AUTH /.test(response[i])) {
                    // Parse supported AUTH methods
                    const parse = /^AUTH (.+)$/.exec(response[i]);
                    methods = parse[1].split(/\s+/);
                    connection.logdebug(
                        self,
                        `found supported AUTH methods: ${methods}`
                    );
                    // Prefer PLAIN as it's easiest
                    if (methods.includes('PLAIN')) {
                        socket.send_command(
                            'AUTH',
                            `PLAIN ${utils.base64(`\0${user}\0${passwd}`)}`
                        );
                        return;
                    } else if (methods.includes('LOGIN')) {
                        socket.send_command('AUTH', 'LOGIN');
                        return;
                    } else {
                        // No compatible methods; abort...
                        connection.logdebug(self, 'no compatible AUTH methods');
                        socket.send_command('QUIT');
                        return;
                    }
                }
            }
        }
        if (command === 'auth') {
            // Handle LOGIN
            if (code[0] === '3' && response[0] === 'VXNlcm5hbWU6') {
                // Write to the socket directly to keep the state at 'auth'
                this.write(`${utils.base64(user)}\r\n`);
                response = [];
                return;
            } else if (code[0] === '3' && response[0] === 'UGFzc3dvcmQ6') {
                this.write(`${utils.base64(passwd)}\r\n`);
                response = [];
                return;
            }
            if (code[0] === '5') {
                // Initial attempt failed; strip domain and retry.
                let u;
                if ((u = /^([^@]+)@.+$/.exec(user))) {
                    user = u[1];
                    if (methods.includes('PLAIN')) {
                        socket.send_command(
                            'AUTH',
                            `PLAIN ${utils.base64(`\0${user}\0${passwd}`)}`
                        );
                    } else if (methods.includes('LOGIN')) {
                        socket.send_command('AUTH', 'LOGIN');
                    }
                    return;
                } else {
                    // Don't attempt any other hosts
                    auth_complete = true;
                }
            }
        }
        if (/^[345]/.test(code)) {
            // Got an unhandled error
            connection.logdebug(self, `error: ${line}`);
            socket.send_command('QUIT');
            return;
        }
        switch (command) {
            case 'starttls':
                this.upgrade({ key, cert });
                break;
            case 'connect':
                socket.send_command('EHLO', connection.local.host);
                break;
            case 'auth':
                // AUTH was successful
                auth_complete = true;
                auth_success = true;
                socket.send_command('QUIT');
                break;
            case 'ehlo':
            case 'helo':
            case 'quit':
                socket.end();
                break;
            default:
                throw new Error(
                    `[auth/auth_proxy] unknown command: ${command}`
                );
        }
    });
};
