'use strict';

const events = require('events');
const fs = require('fs');
const dns = require('dns');
const path = require('path');
const net = require('net');

const Address = require('address-rfc2821').Address;
const config = require('haraka-config');
const constants = require('haraka-constants');
const DSN = require('haraka-dsn');
const net_utils = require('haraka-net-utils');
const Notes = require('haraka-notes');
const utils = require('haraka-utils');

const logger = require('../logger');
const plugins = require('../plugins');
const Header = require('../mailheader').Header;

const client_pool = require('./client_pool');
const _qfile = require('./qfile');
const mx_lookup = require('./mx_lookup');
const outbound = require('./index');
const obtls = require('./tls');

const FsyncWriteStream = require('./fsync_writestream');

let queue_dir;
let temp_fail_queue;
let delivery_queue;
setImmediate(() => {
    const queuelib = require('./queue');
    queue_dir = queuelib.queue_dir;
    temp_fail_queue = queuelib.temp_fail_queue;
    delivery_queue = queuelib.delivery_queue;
});

const obc = require('./config');

/////////////////////////////////////////////////////////////////////////////
// HMailItem - encapsulates an individual outbound mail item

function dummy_func() {}

class HMailItem extends events.EventEmitter {
    constructor(filename, filePath, notes) {
        super();

        const parts = _qfile.parts(filename);
        if (!parts) {
            throw new Error(`Bad filename: ${filename}`);
        }
        this.path = filePath;
        this.filename = filename;
        this.next_process = parts.next_attempt;
        this.num_failures = parts.attempts;
        this.pid = parts.pid;
        this.notes = notes || new Notes();
        this.refcount = 1;
        this.todo = null;
        this.file_size = 0;
        this.next_cb = dummy_func;
        this.bounce_error = null;
        this.hook = null;
        this.size_file();
    }

    data_stream() {
        return fs.createReadStream(this.path, {
            start: this.data_start,
            end: this.file_size,
        });
    }

    size_file() {
        fs.stat(this.path, (err, stats) => {
            if (err) {
                // we are fucked... guess I need somewhere for this to go
                this.logerror(`Error obtaining file size: ${err}`);
                this.temp_fail('Error obtaining file size');
                return;
            }
            if (stats.size === 0) {
                this.logerror(
                    `Error reading queue file ${this.filename}: zero bytes`
                );
                this.emit(
                    'error',
                    `Error reading queue file ${this.filename}: zero bytes`
                );
                return;
            }

            this.file_size = stats.size;
            this.read_todo();
        });
    }

    read_todo() {
        this._stream_bytes_from(
            this.path,
            { start: 0, end: 3 },
            (err, bytes) => {
                if (err) {
                    const errMsg = `Error reading queue file ${this.filename}: ${err}`;
                    this.logerror(errMsg);
                    this.temp_fail(errMsg);
                    return;
                }

                const todo_len = bytes.readUInt32BE(0);
                this.logdebug(`todo header length: ${todo_len}`);
                this.data_start = todo_len + 4;

                this._stream_bytes_from(
                    this.path,
                    { start: 4, end: todo_len + 3 },
                    (err2, todo_bytes) => {
                        if (todo_bytes.length !== todo_len) {
                            const wrongLength = `Didn't find right amount of data in todo!: ${err2}`;
                            this.logcrit(wrongLength);
                            fs.rename(
                                this.path,
                                path.join(queue_dir, `error.${this.filename}`),
                                err3 => {
                                    if (err3) {
                                        this.logerror(
                                            `Error creating (error.${this.filename}): ${err3}`
                                        );
                                    }
                                }
                            );
                            this.emit('error', wrongLength); // Note nothing picks this up yet
                            return;
                        }

                        // we read everything
                        const todo_json = todo_bytes.toString().trim();
                        const last_char = todo_json.charAt(
                            todo_json.length - 1
                        );
                        if (last_char !== '}') {
                            this.emit(
                                'error',
                                `invalid todo header end char: ${last_char} at pos ${todo_len} of ${this.filename}`
                            );
                            return;
                        }
                        this.todo = JSON.parse(todo_json);
                        this.todo.mail_from = new Address(this.todo.mail_from);
                        this.todo.rcpt_to = this.todo.rcpt_to.map(
                            a => new Address(a)
                        );
                        this.todo.notes = new Notes(this.todo.notes);
                        this.emit('ready');
                    }
                );
            }
        );
    }

    _stream_bytes_from(file_path, opts, done) {
        if (opts.encoding !== undefined) {
            // passing an encoding to fs.createReadStream will change the type of data returned
            // ex: instead of returning a buffer, it may return a String, which will cause
            // Buffer.concat to barf. There's a reason this function has 'bytes' in the name
            done(
                new Error(
                    'Thar be dragons here! Encode/decode on the result of this function'
                )
            );
            return;
        }

        const stream = fs.createReadStream(file_path, opts);

        stream.on('error', done);

        let raw_bytes = Buffer.alloc(0);
        stream.on('data', data => {
            raw_bytes = Buffer.concat([raw_bytes, data]);
        });

        stream.on('end', () => {
            done(null, raw_bytes);
        });
    }

    send() {
        if (obc.cfg.disabled) {
            // try again in 1 second if delivery is disabled
            this.logdebug('delivery disabled temporarily. Retrying in 1s.');
            const hmail = this;
            setTimeout(() => {
                hmail.send();
            }, 1000);
            return;
        }

        if (!this.todo) {
            const self = this;
            this.once('ready', () => {
                self._send();
            });
        } else {
            this._send();
        }
    }

    _send() {
        plugins.run_hooks('send_email', this);
    }

    send_email_respond(retval, delay_seconds) {
        if (retval === constants.delay) {
            // Try again in 'delay' seconds.
            this.logdebug(
                `Delivery of this email delayed for ${delay_seconds} seconds`
            );
            const hmail = this;
            hmail.next_cb();
            temp_fail_queue.add(hmail.filename, delay_seconds * 1000, () => {
                delivery_queue.push(hmail);
            });
        } else {
            this.logdebug(`Sending mail: ${this.filename}`);
            this.get_mx();
        }
    }

    get_mx() {
        const domain = this.todo.domain;
        plugins.run_hooks('get_mx', this, domain);
    }

    get_mx_respond(retval, mx) {
        const hmail = this;
        switch (retval) {
            case constants.ok: {
                let mx_list;
                if (Array.isArray(mx)) {
                    mx_list = mx;
                } else if (typeof mx === 'object') {
                    mx_list = [mx];
                } else {
                    // assume string
                    const matches = /^(.*?)(:(\d+))?$/.exec(mx);
                    if (!matches) {
                        throw "get_mx returned something that doesn't match hostname or hostname:port";
                    }
                    mx_list = [
                        { priority: 0, exchange: matches[1], port: matches[3] },
                    ];
                }
                hmail.logdebug(
                    `Got a MX from Plugin: ${
                        hmail.todo.domain
                    } => 0 ${JSON.stringify(mx)}`
                );
                return hmail.found_mx(null, mx_list);
            }
            case constants.deny:
                hmail.logwarn(`get_mx plugin returned DENY: ${mx}`);
                hmail.todo.rcpt_to.forEach(rcpt => {
                    hmail.extend_rcpt_with_dsn(
                        rcpt,
                        DSN.addr_bad_dest_system(
                            `No MX for ${hmail.todo.domain}`
                        )
                    );
                });
                return hmail.bounce(`No MX for ${hmail.todo.domain}`);
            case constants.denysoft:
                hmail.logwarn(`get_mx plugin returned DENYSOFT: ${mx}`);
                hmail.todo.rcpt_to.forEach(rcpt => {
                    hmail.extend_rcpt_with_dsn(
                        rcpt,
                        DSN.addr_bad_dest_system(
                            `Temporary MX lookup error for ${hmail.todo.domain}`,
                            450
                        )
                    );
                });
                return hmail.temp_fail(
                    `Temporary MX lookup error for ${hmail.todo.domain}`
                );
        }

        // if none of the above return codes, drop through to this...
        mx_lookup.lookup_mx(this.todo.domain, (err, mxs) => {
            hmail.found_mx(err, mxs);
        });
    }

    found_mx(err, mxs) {
        const hmail = this;
        if (err) {
            this.lognotice(`MX Lookup for ${this.todo.domain} failed: ${err}`);
            if (err.code === dns.NXDOMAIN || err.code === dns.NOTFOUND) {
                this.todo.rcpt_to.forEach(rcpt => {
                    hmail.extend_rcpt_with_dsn(
                        rcpt,
                        DSN.addr_bad_dest_system(
                            `No Such Domain: ${hmail.todo.domain}`
                        )
                    );
                });
                this.bounce(`No Such Domain: ${this.todo.domain}`);
            } else if (err.code === 'NOMX') {
                this.todo.rcpt_to.forEach(rcpt => {
                    hmail.extend_rcpt_with_dsn(
                        rcpt,
                        DSN.addr_bad_dest_system(
                            `Nowhere to deliver mail to for domain: ${hmail.todo.domain}`
                        )
                    );
                });
                this.bounce(
                    `Nowhere to deliver mail to for domain: ${hmail.todo.domain}`
                );
            } else {
                // every other error is transient
                this.todo.rcpt_to.forEach(rcpt => {
                    hmail.extend_rcpt_with_dsn(
                        rcpt,
                        DSN.addr_unspecified(
                            `DNS lookup failure: ${hmail.todo.domain}`
                        )
                    );
                });
                this.temp_fail(`DNS lookup failure: ${err}`);
            }
        } else {
            // got MXs
            const mxlist = sort_mx(mxs);
            // support draft-delany-nullmx-02
            if (
                mxlist.length === 1 &&
                mxlist[0].priority === 0 &&
                mxlist[0].exchange === ''
            ) {
                this.todo.rcpt_to.forEach(rcpt => {
                    hmail.extend_rcpt_with_dsn(
                        rcpt,
                        DSN.addr_bad_dest_system(
                            `Domain ${hmail.todo.domain} sends and receives no email (NULL MX)`
                        )
                    );
                });
                return this.bounce(
                    `Domain ${this.todo.domain} sends and receives no email (NULL MX)`
                );
            }
            // duplicate each MX for each ip address family
            this.mxlist = [];
            for (const mx in mxlist) {
                // Handle UNIX sockets for LMTP
                if (mxlist[mx].path) {
                    this.mxlist.push(mxlist[mx]);
                } else if (obc.cfg.ipv6_enabled) {
                    this.mxlist.push(
                        {
                            exchange: mxlist[mx].exchange,
                            priority: mxlist[mx].priority,
                            port: mxlist[mx].port,
                            using_lmtp: mxlist[mx].using_lmtp,
                            family: 'AAAA',
                        },
                        {
                            exchange: mxlist[mx].exchange,
                            priority: mxlist[mx].priority,
                            port: mxlist[mx].port,
                            using_lmtp: mxlist[mx].using_lmtp,
                            family: 'A',
                        }
                    );
                } else {
                    mxlist[mx].family = 'A';
                    this.mxlist.push(mxlist[mx]);
                }
            }
            this.try_deliver();
        }
    }

    try_deliver() {
        const self = this;

        // check if there are any MXs left
        if (this.mxlist.length === 0) {
            this.todo.rcpt_to.forEach(rcpt => {
                self.extend_rcpt_with_dsn(
                    rcpt,
                    DSN.addr_bad_dest_system(
                        `Tried all MXs ${self.todo.domain}`
                    )
                );
            });
            return this.temp_fail('Tried all MXs');
        }

        const mx = this.mxlist.shift();
        let host = mx.exchange;

        // IP or IP:port
        if (net.isIP(host)) {
            self.hostlist = [host];
            return self.try_deliver_host(mx);
        }

        host = mx.exchange;
        const family = mx.family;

        this.loginfo(`Looking up ${family} records for: ${host}`);

        // we have a host, look up the addresses for the host
        // and try each in order they appear
        // IS: IPv6 compatible
        dns.resolve(host, family, (err, addresses) => {
            if (err) {
                self.lognotice(`DNS lookup of ${host} failed: ${err}`);
                return self.try_deliver(); // try next MX
            }
            if (addresses.length === 0) {
                // NODATA or empty host list
                self.lognotice(`DNS lookup of ${host} resulted in no data`);
                return self.try_deliver(); // try next MX
            }
            self.hostlist = addresses;
            self.try_deliver_host(mx);
        });
    }

    try_deliver_host(mx) {
        const self = this;

        if (self.hostlist.length === 0) {
            return self.try_deliver(); // try next MX
        }

        // Allow transaction notes to set outbound IP
        if (!mx.bind && self.todo.notes.outbound_ip) {
            mx.bind = self.todo.notes.outbound_ip;
        }

        // Allow transaction notes to set outbound IP helo
        if (!mx.bind_helo) {
            if (self.todo.notes.outbound_helo) {
                mx.bind_helo = self.todo.notes.outbound_helo;
            } else {
                mx.bind_helo = net_utils.get_primary_host_name();
            }
        }

        let host = self.hostlist.shift();
        const port = mx.port || 25;

        if (mx.path) {
            host = mx.path;
        }

        this.loginfo(
            `Attempting to deliver to: ${host}:${port}${
                mx.using_lmtp ? ' using LMTP' : ''
            } (${delivery_queue.length()}) (${temp_fail_queue.length()})`
        );
        client_pool.get_client(
            port,
            host,
            mx.bind,
            !!mx.path,
            (err, socket) => {
                if (err) {
                    if (
                        err.match(/connection timed out|connect ECONNREFUSED/)
                    ) {
                        logger.lognotice(
                            `[outbound] Failed to get pool entry: ${err}`
                        );
                    } else {
                        logger.logerror(
                            `[outbound] Failed to get pool entry: ${err}`
                        );
                    }
                    // try next host
                    return self.try_deliver_host(mx);
                }
                self.try_deliver_host_on_socket(mx, host, port, socket);
            }
        );
    }

    try_deliver_host_on_socket(mx, host, port, socket) {
        const self = this;
        let processing_mail = true;
        let command = mx.using_lmtp ? 'connect_lmtp' : 'connect';

        socket.removeAllListeners('error');
        socket.removeAllListeners('timeout');
        socket.removeAllListeners('close');
        socket.removeAllListeners('end');

        socket.once('timeout', function() {
            socket.emit('error', `socket timeout waiting on ${command}`);
        });

        socket.once('error', err => {
            if (processing_mail) {
                self.logerror(
                    `Ongoing connection failed to ${host}:${port} : ${err}`
                );
                processing_mail = false;
                client_pool.release_client(socket, port, host, mx.bind, true);
                if (err.source === 'tls')
                    // exception thrown from tls_socket during tls upgrade
                    return obtls.mark_tls_nogo(host, () => {
                        return self.try_deliver_host(mx);
                    });
                // try the next MX
                return self.try_deliver_host(mx);
            }
        });

        socket.once('close', () => {
            if (processing_mail) {
                self.logerror(
                    `Remote end ${host}:${port} closed connection while we were processing mail. Trying next MX.`
                );
                processing_mail = false;
                client_pool.release_client(socket, port, host, mx.bind, true);
                return self.try_deliver_host(mx);
            }
        });

        let fin_sent = false;
        socket.once('end', () => {
            fin_sent = true;
            socket.writable = false;
            if (!processing_mail) {
                client_pool.release_client(socket, port, host, mx.bind, true);
            }
        });

        let response = [];

        let recip_index = 0;
        const recipients = this.todo.rcpt_to;
        let lmtp_rcpt_idx = 0;

        let last_recip = null;
        const ok_recips = [];
        const fail_recips = [];
        const bounce_recips = [];
        let secured = false;
        let authenticating = false;
        let authenticated = false;
        let smtp_properties = {
            tls: false,
            max_size: 0,
            eightbitmime: false,
            enh_status_codes: false,
            auth: [],
        };

        const send_command = (socket.send_command = (cmd, data) => {
            if (!socket.writable) {
                self.logerror('Socket writability went away');
                if (processing_mail) {
                    processing_mail = false;
                    client_pool.release_client(
                        socket,
                        port,
                        host,
                        mx.bind,
                        true
                    );
                    return self.try_deliver_host(mx);
                }
                return;
            }
            let line = `${cmd}${data ? ` ${data}` : ''}`;
            if (cmd === 'dot' || cmd === 'dot_lmtp') {
                line = '.';
            }
            if (authenticating) cmd = 'auth';
            self.logprotocol(`C: ${line}`);
            socket.write(`${line}\r\n`, 'utf8', err => {
                if (err) {
                    self.logcrit(`Socket write failed unexpectedly: ${err}`);
                    // We may want to release client here - but I want to get this
                    // line of code in before we do that so we might see some logging
                    // in case of errors.
                    // client_pool.release_client(socket, port, host, mx.bind, fin_sent);
                }
            });
            command = cmd.toLowerCase();
            response = [];
        });

        function set_ehlo_props() {
            for (let i = 0, l = response.length; i < l; i++) {
                const r = response[i];
                if (r.toUpperCase() === '8BITMIME') {
                    smtp_properties.eightbitmime = true;
                } else if (r.toUpperCase() === 'STARTTLS') {
                    smtp_properties.tls = true;
                } else if (r.toUpperCase() === 'ENHANCEDSTATUSCODES') {
                    smtp_properties.enh_status_codes = true;
                } else if (r.toUpperCase() === 'SMTPUTF8') {
                    smtp_properties.smtp_utf8 = true;
                } else {
                    // Check for SIZE parameter and limit
                    let matches = r.match(/^SIZE\s+(\d+)$/);
                    if (matches) {
                        smtp_properties.max_size = matches[1];
                    }
                    // Check for AUTH
                    matches = r.match(/^AUTH\s+(.+)$/);
                    if (matches) {
                        smtp_properties.auth = matches[1].split(/\s+/);
                    }
                }
            }
        }

        function auth_and_mail_phase() {
            if (!authenticated && mx.auth_user && mx.auth_pass) {
                // We have AUTH credentials to send for this domain
                if (
                    !(
                        Array.isArray(smtp_properties.auth) &&
                        smtp_properties.auth.length
                    )
                ) {
                    // AUTH not offered
                    self.logwarn(
                        `AUTH configured for domain ${self.todo.domain} but host ${host} did not advertise AUTH capability`
                    );
                    // Try and send the message without authentication
                    return send_command(
                        'MAIL',
                        `FROM:${self.todo.mail_from.format(
                            !smtp_properties.smtp_utf8
                        )}`
                    );
                }

                if (!mx.auth_type) {
                    // User hasn't specified an authentication type, so we pick one
                    // We'll prefer CRAM-MD5 as it's the most secure that we support.
                    if (smtp_properties.auth.includes('CRAM-MD5')) {
                        mx.auth_type = 'CRAM-MD5';
                    }
                    // PLAIN requires less round-trips compared to LOGIN
                    else if (smtp_properties.auth.includes('PLAIN')) {
                        // PLAIN requires less round trips compared to LOGIN
                        // So we'll make this our 2nd pick.
                        mx.auth_type = 'PLAIN';
                    } else if (smtp_properties.auth.includes('LOGIN')) {
                        mx.auth_type = 'LOGIN';
                    }
                }

                if (
                    !mx.auth_type ||
                    (mx.auth_type &&
                        !smtp_properties.auth.includes(
                            mx.auth_type.toUpperCase()
                        ))
                ) {
                    // No compatible authentication types offered by the server
                    self.logwarn(
                        `AUTH configured for domain ${
                            self.todo.domain
                        } but host ${host}did not offer any compatible types${
                            mx.auth_type ? ` (requested: ${mx.auth_type})` : ''
                        } (offered: ${smtp_properties.auth.join(',')})`
                    );
                    // Proceed without authentication
                    return send_command(
                        'MAIL',
                        `FROM:${self.todo.mail_from.format(
                            !smtp_properties.smtp_utf8
                        )}`
                    );
                }

                switch (mx.auth_type.toUpperCase()) {
                    case 'PLAIN':
                        return send_command(
                            'AUTH',
                            `PLAIN ${utils.base64(
                                `${mx.auth_user}\0${mx.auth_user}\0${mx.auth_pass}`
                            )}`
                        );
                    case 'LOGIN':
                        authenticating = true;
                        return send_command('AUTH', 'LOGIN');
                    case 'CRAM-MD5':
                        authenticating = true;
                        return send_command('AUTH', 'CRAM-MD5');
                    default:
                        // Unsupported AUTH type
                        self.logwarn(
                            `Unsupported authentication type ${mx.auth_type.toUpperCase()} requested for domain ${
                                self.todo.domain
                            }`
                        );
                        return send_command(
                            'MAIL',
                            `FROM:${self.todo.mail_from.format(
                                !smtp_properties.smtp_utf8
                            )}`
                        );
                }
            }

            return send_command(
                'MAIL',
                `FROM:${self.todo.mail_from.format(!smtp_properties.smtp_utf8)}`
            );
        } // auth_and_mail_phase()

        // IMPORTANT: do STARTTLS before AUTH for security
        function process_ehlo_data() {
            set_ehlo_props();

            if (secured) return auth_and_mail_phase(); // TLS already negotiated
            if (!obc.cfg.enable_tls) return auth_and_mail_phase(); // TLS not enabled
            if (!smtp_properties.tls) return auth_and_mail_phase(); // TLS not advertised by remote

            if (obtls.cfg === undefined) {
                self.logerror(`Oops, TLS config not loaded yet!`);
                return auth_and_mail_phase(); // no outbound TLS config
            }

            // TLS is configured and available

            // TLS exclude lists checks for MX host or remote domain
            if (net_utils.ip_in_list(obtls.cfg.no_tls_hosts, host))
                return auth_and_mail_phase();
            if (net_utils.ip_in_list(obtls.cfg.no_tls_hosts, self.todo.domain))
                return auth_and_mail_phase();

            // Check Redis and skip for hosts that failed past TLS upgrade
            return obtls.check_tls_nogo(
                host,
                () => {
                    // Clear to GO
                    self.logdebug(
                        `Trying TLS for domain: ${self.todo.domain}, host: ${host}`
                    );

                    socket.once('secure', () => {
                        // Set this flag so we don't try STARTTLS again if it
                        // is incorrectly offered at EHLO once we are secured.
                        secured = true;
                        send_command(
                            mx.using_lmtp ? 'LHLO' : 'EHLO',
                            mx.bind_helo
                        );
                    });
                    return send_command('STARTTLS');
                },
                when => {
                    // No GO
                    self.loginfo(
                        `TLS disabled for ${host} because it was marked as non-TLS on ${when}`
                    );
                    return auth_and_mail_phase();
                }
            );
        } // process_ehlo_data()

        let fp_called = false;

        function finish_processing_mail(success) {
            if (fp_called) {
                return self.logerror(
                    `finish_processing_mail called multiple times! Stack: ${
                        new Error().stack
                    }`
                );
            }
            fp_called = true;
            if (fail_recips.length) {
                self.refcount++;
                self.split_to_new_recipients(
                    fail_recips,
                    'Some recipients temporarily failed',
                    hmail => {
                        self.discard();
                        hmail.temp_fail(
                            `Some recipients temp failed: ${fail_recips.join(
                                ', '
                            )}`,
                            { fail_recips, mx }
                        );
                    }
                );
            }
            if (bounce_recips.length) {
                self.refcount++;
                self.split_to_new_recipients(
                    bounce_recips,
                    'Some recipients rejected',
                    hmail => {
                        self.discard();
                        hmail.bounce(
                            `Some recipients failed: ${bounce_recips.join(
                                ', '
                            )}`,
                            { bounce_recips, mx }
                        );
                    }
                );
            }
            processing_mail = false;
            if (success) {
                const reason = response.join(' ');
                self.delivered(
                    host,
                    port,
                    mx.using_lmtp ? 'LMTP' : 'SMTP',
                    mx.exchange,
                    reason,
                    ok_recips,
                    fail_recips,
                    bounce_recips,
                    secured,
                    authenticated
                );
            } else {
                self.discard();
            }

            if (obc.cfg.pool_concurrency_max && success) {
                client_pool.release_client(
                    socket,
                    port,
                    host,
                    mx.bind,
                    fin_sent
                );
            } else if (obc.cfg.pool_concurrency_max && !mx.using_lmtp) {
                send_command('RSET');
            } else {
                send_command('QUIT');
            }
        }

        socket.on('line', line => {
            if (!processing_mail && command !== 'rset') {
                if (command !== 'quit') {
                    self.logprotocol(
                        `Received data after stopping processing: ${line}`
                    );
                }
                return;
            }
            self.logprotocol(`S: ${line}`);
            const matches = smtp_regexp.exec(line);
            if (!matches) {
                // Unrecognized response.
                self.logerror(
                    `Unrecognized response from upstream server: ${line}`
                );
                processing_mail = false;
                // Release back to the pool and instruct it to terminate this connection
                client_pool.release_client(socket, port, host, mx.bind, true);
                self.todo.rcpt_to.forEach(rcpt => {
                    self.extend_rcpt_with_dsn(
                        rcpt,
                        DSN.proto_invalid_command(
                            `Unrecognized response from upstream server: ${line}`
                        )
                    );
                });
                self.bounce(
                    `Unrecognized response from upstream server: ${line}`,
                    { mx }
                );
                return;
            }

            let reason;
            const code = matches[1];
            const cont = matches[2];
            const extc = matches[3];
            const rest = matches[4];
            response.push(rest);
            if (cont !== ' ') return;

            if (code.match(/^2/)) {
                // Successful command, fall through
            } else if (code.match(/^3/) && command !== 'data') {
                if (authenticating) {
                    const resp = response.join(' ');
                    switch (mx.auth_type.toUpperCase()) {
                        case 'LOGIN':
                            if (resp === 'VXNlcm5hbWU6') {
                                // Username:
                                return send_command(utils.base64(mx.auth_user));
                            } else if (resp === 'UGFzc3dvcmQ6') {
                                // Password:
                                return send_command(utils.base64(mx.auth_pass));
                            }
                            break;
                        case 'CRAM-MD5':
                            // The response is our challenge
                            return send_command(
                                cram_md5_response(
                                    mx.auth_user,
                                    mx.auth_pass,
                                    resp
                                )
                            );
                        default:
                        // This shouldn't happen...
                    }
                }
                // Error
                reason = response.join(' ');
                recipients.forEach(rcpt => {
                    rcpt.dsn_action = 'delayed';
                    rcpt.dsn_smtp_code = code;
                    rcpt.dsn_smtp_extc = extc;
                    rcpt.dsn_status = extc;
                    rcpt.dsn_smtp_response = response.join(' ');
                    rcpt.dsn_remote_mta = mx.exchange;
                });
                send_command(
                    obc.cfg.pool_concurrency_max && !mx.using_lmtp
                        ? 'RSET'
                        : 'QUIT'
                );
                processing_mail = false;
                return self.temp_fail(
                    `Upstream error: ${code} ${extc ? `${extc} ` : ''}${reason}`
                );
            } else if (code.match(/^4/)) {
                authenticating = false;
                if (/^rcpt/.test(command) || command === 'dot_lmtp') {
                    if (command === 'dot_lmtp') last_recip = ok_recips.shift();
                    // this recipient was rejected
                    reason = `${code} ${extc ? `${extc} ` : ''}${response.join(
                        ' '
                    )}`;
                    self.lognotice(
                        `recipient ${last_recip} deferred: ${reason}`
                    );
                    last_recip.reason = reason;

                    last_recip.dsn_action = 'delayed';
                    last_recip.dsn_smtp_code = code;
                    last_recip.dsn_smtp_extc = extc;
                    last_recip.dsn_status = extc;
                    last_recip.dsn_smtp_response = response.join(' ');
                    last_recip.dsn_remote_mta = mx.exchange;

                    fail_recips.push(last_recip);
                    if (command === 'dot_lmtp') {
                        response = [];
                        if (ok_recips.length === 0) {
                            return finish_processing_mail(false);
                        }
                    }
                } else if (processing_mail) {
                    reason = response.join(' ');
                    recipients.forEach(rcpt => {
                        rcpt.dsn_action = 'delayed';
                        rcpt.dsn_smtp_code = code;
                        rcpt.dsn_smtp_extc = extc;
                        rcpt.dsn_status = extc;
                        rcpt.dsn_smtp_response = response.join(' ');
                        rcpt.dsn_remote_mta = mx.exchange;
                    });
                    send_command(
                        obc.cfg.pool_concurrency_max && !mx.using_lmtp
                            ? 'RSET'
                            : 'QUIT'
                    );
                    processing_mail = false;
                    return self.temp_fail(
                        `Upstream error: ${code} ${
                            extc ? `${extc} ` : ''
                        }${reason}`
                    );
                } else {
                    reason = response.join(' ');
                    self.lognotice(
                        `Error - but not processing mail: ${code} ${
                            extc ? `${extc} ` : ''
                        }${reason}`
                    );
                    // Release back to the pool and instruct it to terminate this connection
                    return client_pool.release_client(
                        socket,
                        port,
                        host,
                        mx.bind,
                        true
                    );
                }
            } else if (code.match(/^5/)) {
                authenticating = false;
                if (command === 'ehlo') {
                    // EHLO command was rejected; fall-back to HELO
                    return send_command('HELO', mx.bind_helo);
                }
                if (command === 'rset') {
                    // Broken server doesn't accept RSET, terminate the connection
                    return client_pool.release_client(
                        socket,
                        port,
                        host,
                        mx.bind,
                        true
                    );
                }
                reason = `${code} ${extc ? `${extc} ` : ''}${response.join(
                    ' '
                )}`;
                if (/^rcpt/.test(command) || command === 'dot_lmtp') {
                    if (command === 'dot_lmtp') last_recip = ok_recips.shift();
                    self.lognotice(
                        `recipient ${last_recip} rejected: ${reason}`
                    );
                    last_recip.reason = reason;

                    last_recip.dsn_action = 'failed';
                    last_recip.dsn_smtp_code = code;
                    last_recip.dsn_smtp_extc = extc;
                    last_recip.dsn_status = extc;
                    last_recip.dsn_smtp_response = response.join(' ');
                    last_recip.dsn_remote_mta = mx.exchange;

                    bounce_recips.push(last_recip);
                    if (command === 'dot_lmtp') {
                        response = [];
                        if (ok_recips.length === 0) {
                            return finish_processing_mail(false);
                        }
                    }
                } else {
                    recipients.forEach(rcpt => {
                        rcpt.dsn_action = 'failed';
                        rcpt.dsn_smtp_code = code;
                        rcpt.dsn_smtp_extc = extc;
                        rcpt.dsn_status = extc;
                        rcpt.dsn_smtp_response = response.join(' ');
                        rcpt.dsn_remote_mta = mx.exchange;
                    });
                    send_command(
                        obc.cfg.pool_concurrency_max && !mx.using_lmtp
                            ? 'RSET'
                            : 'QUIT'
                    );
                    processing_mail = false;
                    return self.bounce(reason, { mx });
                }
            }

            switch (command) {
                case 'connect':
                    send_command('EHLO', mx.bind_helo);
                    break;
                case 'connect_lmtp':
                    send_command('LHLO', mx.bind_helo);
                    break;
                case 'lhlo':
                case 'ehlo':
                    process_ehlo_data();
                    break;
                case 'starttls': {
                    const tls_options = obtls.get_tls_options(mx);

                    smtp_properties = {};
                    socket.upgrade(
                        tls_options,
                        (authorized, verifyError, cert, cipher) => {
                            const loginfo = {
                                verified: authorized,
                            };
                            if (cipher) {
                                loginfo.cipher = cipher.name;
                                loginfo.version = cipher.version;
                            }
                            if (verifyError) loginfo.error = verifyError;
                            if (cert && cert.subject) {
                                loginfo.cn = cert.subject.CN;
                                loginfo.organization = cert.subject.O;
                            }
                            if (cert && cert.issuer)
                                loginfo.issuer = cert.issuer.O;
                            if (cert && cert.valid_to)
                                loginfo.expires = cert.valid_to;
                            if (cert && cert.fingerprint)
                                loginfo.fingerprint = cert.fingerprint;
                            self.loginfo('secured', loginfo);
                        }
                    );
                    break;
                }
                case 'auth':
                    authenticating = false;
                    authenticated = true;
                    send_command(
                        'MAIL',
                        `FROM:${self.todo.mail_from.format(
                            !smtp_properties.smtp_utf8
                        )}`
                    );
                    break;
                case 'helo':
                    send_command(
                        'MAIL',
                        `FROM:${self.todo.mail_from.format(
                            !smtp_properties.smtp_utf8
                        )}`
                    );
                    break;
                case 'mail':
                    last_recip = recipients[recip_index];
                    recip_index++;
                    send_command(
                        'RCPT',
                        `TO:${last_recip.format(!smtp_properties.smtp_utf8)}`
                    );
                    break;
                case 'rcpt':
                    if (last_recip && code.match(/^250/)) {
                        ok_recips.push(last_recip);
                    }
                    if (recip_index === recipients.length) {
                        // End of RCPT TOs
                        if (ok_recips.length > 0) {
                            send_command('DATA');
                        } else {
                            finish_processing_mail(false);
                        }
                    } else {
                        last_recip = recipients[recip_index];
                        recip_index++;
                        send_command(
                            'RCPT',
                            `TO:${last_recip.format(
                                !smtp_properties.smtp_utf8
                            )}`
                        );
                    }
                    break;
                case 'data': {
                    const data_stream = self.data_stream();
                    data_stream.on('data', data => {
                        self.logdata(`C: ${data}`);
                    });
                    data_stream.on('error', err => {
                        self.logerror(
                            `Reading from the data stream failed: ${err}`
                        );
                    });
                    data_stream.on('end', () => {
                        send_command(mx.using_lmtp ? 'dot_lmtp' : 'dot');
                    });
                    data_stream.pipe(socket, { end: false });
                    break;
                }
                case 'dot':
                    finish_processing_mail(true);
                    break;
                case 'dot_lmtp':
                    if (code.match(/^2/)) lmtp_rcpt_idx++;
                    if (lmtp_rcpt_idx === ok_recips.length) {
                        finish_processing_mail(true);
                    }
                    break;
                case 'quit':
                    if (obc.cfg.pool_concurrency_max) {
                        self.logerror(
                            'We should NOT have sent QUIT from here...'
                        );
                    } else {
                        client_pool.release_client(
                            socket,
                            port,
                            host,
                            mx.bind,
                            fin_sent
                        );
                    }
                    break;
                case 'rset':
                    client_pool.release_client(
                        socket,
                        port,
                        host,
                        mx.bind,
                        fin_sent
                    );
                    break;
                default:
                    // should never get here - means we did something
                    // wrong.
                    throw new Error(`Unknown command: ${command}`);
            }
        });

        if (socket.__fromPool) {
            logger.logdebug('[outbound] got pooled socket, trying to deliver');
            send_command(
                'MAIL',
                `FROM:${self.todo.mail_from.format(!smtp_properties.smtp_utf8)}`
            );
        }
    }

    extend_rcpt_with_dsn(rcpt, dsn) {
        rcpt.dsn_code = dsn.code;
        rcpt.dsn_msg = dsn.msg;
        rcpt.dsn_status = `${dsn.cls}.${dsn.sub}.${dsn.det}`;
        if (dsn.cls == 4) {
            rcpt.dsn_action = 'delayed';
        } else if (dsn.cls == 5) {
            rcpt.dsn_action = 'failed';
        }
    }

    populate_bounce_message(from, to, reason, cb) {
        const self = this;

        let buf = '';
        const original_header_lines = [];
        let headers_done = false;
        const header = new Header();

        try {
            const data_stream = this.data_stream();
            data_stream.on('data', data => {
                if (headers_done === false) {
                    buf += data;
                    let results;
                    while ((results = utils.line_regexp.exec(buf))) {
                        const this_line = results[1];
                        if (this_line === '\n' || this_line == '\r\n') {
                            headers_done = true;
                            break;
                        }
                        buf = buf.slice(this_line.length);
                        original_header_lines.push(this_line);
                    }
                }
            });
            data_stream.on('end', () => {
                if (original_header_lines.length > 0) {
                    header.parse(original_header_lines);
                }
                self.populate_bounce_message_with_headers(
                    from,
                    to,
                    reason,
                    header,
                    cb
                );
            });
            data_stream.on('error', err => {
                cb(err);
            });
        } catch (err) {
            self.populate_bounce_message_with_headers(
                from,
                to,
                reason,
                header,
                cb
            );
        }
    }

    /**
     * Generates a bounce message
     *
     * hmail.todo.rcpt_to objects should be extended as follows:
     * - dsn_action
     * - dsn_status
     * - dsn_code
     * - dsn_msg
     *
     * - dsn_remote_mta
     *
     * Upstream code/message goes here:
     * - dsn_smtp_code
     * - dsn_smtp_extc
     * - dsn_smtp_response
     *
     * @param from
     * @param to
     * @param reason
     * @param header
     * @param cb - a callback for fn(err, message_body_lines)
     */
    populate_bounce_message_with_headers(from, to, reason, header, cb) {
        const self = this;
        const CRLF = '\r\n';

        const originalMessageId = header.get('Message-Id');

        const bounce_msg_ = config.get('outbound.bounce_message', 'data');
        const bounce_msg_html_ = config.get(
            'outbound.bounce_message_html',
            'data'
        );
        const bounce_msg_image_ = config.get(
            'outbound.bounce_message_image',
            'data'
        );

        const bounce_header_lines = [];
        const bounce_body_lines = [];
        const bounce_html_lines = [];
        const bounce_image_lines = [];
        let bounce_headers_done = false;

        const values = {
            date: utils.date_to_str(new Date()),
            me: net_utils.get_primary_host_name(),
            from,
            to,
            subject: header.get_decoded('Subject').trim(),
            recipients: this.todo.rcpt_to.join(', '),
            reason,
            extended_reason: this.todo.rcpt_to
                .map(recip => {
                    if (recip.reason) {
                        return `${recip.original}: ${recip.reason}`;
                    }
                })
                .join('\n'),
            pid: process.pid,
            msgid: `<${utils.uuid()}@${net_utils.get_primary_host_name()}>`,
        };

        bounce_msg_.forEach(line => {
            line = line.replace(/\{(\w+)\}/g, (i, word) => values[word] || '?');

            if (bounce_headers_done == false && line == '') {
                bounce_headers_done = true;
            } else if (bounce_headers_done == false) {
                bounce_header_lines.push(line);
            } else if (bounce_headers_done == true) {
                bounce_body_lines.push(line);
            }
        });

        const escaped_chars = {
            '&': 'amp',
            '<': 'lt',
            '>': 'gt',
            '"': 'quot',
            "'": 'apos',
            '\r': '#10',
            '\n': '#13',
        };
        const escape_pattern = new RegExp(
            `[${Object.keys(escaped_chars).join()}]`,
            'g'
        );

        bounce_msg_html_.forEach(line => {
            line = line.replace(/\{(\w+)\}/g, (i, word) => {
                if (word in values) {
                    return String(values[word]).replace(
                        escape_pattern,
                        m => `&${escaped_chars[m]};`
                    );
                } else {
                    return '?';
                }
            });

            bounce_html_lines.push(line);
        });

        bounce_msg_image_.forEach(line => {
            bounce_image_lines.push(line);
        });

        const boundary = `boundary_${utils.uuid()}`;
        const bounce_body = [];

        bounce_header_lines.forEach(line => {
            bounce_body.push(`${line}${CRLF}`);
        });
        bounce_body.push(
            `Content-Type: multipart/report; report-type=delivery-status;${CRLF}    boundary="${boundary}"${CRLF}`
        );
        // Adding references to original msg id
        if (originalMessageId != '') {
            bounce_body.push(
                `References: ${originalMessageId.replace(
                    /(\r?\n)*$/,
                    ''
                )}${CRLF}`
            );
        }

        bounce_body.push(CRLF);
        bounce_body.push(`This is a MIME-encapsulated message.${CRLF}`);
        bounce_body.push(CRLF);

        let boundary_incr = '';
        if (bounce_html_lines.length > 1) {
            boundary_incr = 'a';
            bounce_body.push(`--${boundary}${CRLF}`);
            bounce_body.push(
                `Content-Type: multipart/related; boundary="${boundary}${boundary_incr}"${CRLF}`
            );
            bounce_body.push(CRLF);
            bounce_body.push(`--${boundary}${boundary_incr}${CRLF}`);
            boundary_incr = 'b';
            bounce_body.push(
                `Content-Type: multipart/alternative; boundary="${boundary}${boundary_incr}"${CRLF}`
            );
            bounce_body.push(CRLF);
        }

        bounce_body.push(`--${boundary}${boundary_incr}${CRLF}`);
        bounce_body.push(`Content-Type: text/plain; charset=us-ascii${CRLF}`);
        bounce_body.push(CRLF);
        bounce_body_lines.forEach(line => {
            bounce_body.push(`${line}${CRLF}`);
        });
        bounce_body.push(CRLF);

        if (bounce_html_lines.length > 1) {
            bounce_body.push(`--${boundary}${boundary_incr}${CRLF}`);
            bounce_body.push(
                `Content-Type: text/html; charset=us-ascii${CRLF}`
            );
            bounce_body.push(CRLF);
            bounce_html_lines.forEach(line => {
                bounce_body.push(`${line}${CRLF}`);
            });
            bounce_body.push(CRLF);
            bounce_body.push(`--${boundary}${boundary_incr}--${CRLF}`);

            if (bounce_image_lines.length > 1) {
                boundary_incr = 'a';
                bounce_body.push(`--${boundary}${boundary_incr}${CRLF}`);
                //bounce_body.push(`Content-Type: text/html; charset=us-ascii${CRLF}`);
                //bounce_body.push(CRLF);
                bounce_image_lines.forEach(line => {
                    bounce_body.push(`${line}${CRLF}`);
                });
                bounce_body.push(CRLF);
                bounce_body.push(`--${boundary}${boundary_incr}--${CRLF}`);
            }
        }

        bounce_body.push(`--${boundary}${CRLF}`);
        bounce_body.push(`Content-type: message/delivery-status${CRLF}`);
        bounce_body.push(CRLF);
        if (originalMessageId != '') {
            bounce_body.push(
                `Original-Envelope-Id: ${originalMessageId.replace(
                    /(\r?\n)*$/,
                    ''
                )}${CRLF}`
            );
        }
        bounce_body.push(
            `Reporting-MTA: dns;${net_utils.get_primary_host_name()}${CRLF}`
        );
        if (self.todo.queue_time) {
            bounce_body.push(
                `Arrival-Date: ${utils.date_to_str(
                    new Date(self.todo.queue_time)
                )}${CRLF}`
            );
        }
        self.todo.rcpt_to.forEach(rcpt_to => {
            bounce_body.push(CRLF);
            bounce_body.push(
                `Final-Recipient: rfc822;${rcpt_to.address()}${CRLF}`
            );
            let dsn_action = null;
            if (rcpt_to.dsn_action) {
                dsn_action = rcpt_to.dsn_action;
            } else if (rcpt_to.dsn_code) {
                if (/^5/.exec(rcpt_to.dsn_code)) {
                    dsn_action = 'failed';
                } else if (/^4/.exec(rcpt_to.dsn_code)) {
                    dsn_action = 'delayed';
                } else if (/^2/.exec(rcpt_to.dsn_code)) {
                    dsn_action = 'delivered';
                }
            } else if (rcpt_to.dsn_smtp_code) {
                if (/^5/.exec(rcpt_to.dsn_smtp_code)) {
                    dsn_action = 'failed';
                } else if (/^4/.exec(rcpt_to.dsn_smtp_code)) {
                    dsn_action = 'delayed';
                } else if (/^2/.exec(rcpt_to.dsn_smtp_code)) {
                    dsn_action = 'delivered';
                }
            }
            if (dsn_action != null) {
                bounce_body.push(`Action: ${dsn_action}${CRLF}`);
            }
            if (rcpt_to.dsn_status) {
                let dsn_status = rcpt_to.dsn_status;
                if (rcpt_to.dsn_code || rcpt_to.dsn_msg) {
                    dsn_status += ' (';
                    if (rcpt_to.dsn_code) {
                        dsn_status += rcpt_to.dsn_code;
                    }
                    if (rcpt_to.dsn_code || rcpt_to.dsn_msg) {
                        dsn_status += ' ';
                    }
                    if (rcpt_to.dsn_msg) {
                        dsn_status += rcpt_to.dsn_msg;
                    }
                    dsn_status += ')';
                }
                bounce_body.push(`Status: ${dsn_status}${CRLF}`);
            }
            if (rcpt_to.dsn_remote_mta) {
                bounce_body.push(
                    `Remote-MTA: ${rcpt_to.dsn_remote_mta}${CRLF}`
                );
            }
            let diag_code = null;
            if (
                rcpt_to.dsn_smtp_code ||
                rcpt_to.dsn_smtp_extc ||
                rcpt_to.dsn_smtp_response
            ) {
                diag_code = 'smtp;';
                if (rcpt_to.dsn_smtp_code) {
                    diag_code += `${rcpt_to.dsn_smtp_code} `;
                }
                if (rcpt_to.dsn_smtp_extc) {
                    diag_code += `${rcpt_to.dsn_smtp_extc} `;
                }
                if (rcpt_to.dsn_smtp_response) {
                    diag_code += `${rcpt_to.dsn_smtp_response} `;
                }
            }
            if (diag_code != null) {
                bounce_body.push(`Diagnostic-Code: ${diag_code}${CRLF}`);
            }
        });
        bounce_body.push(CRLF);

        bounce_body.push(`--${boundary}${CRLF}`);
        bounce_body.push(
            `Content-Description: Undelivered Message Headers${CRLF}`
        );
        bounce_body.push(`Content-Type: text/rfc822-headers${CRLF}`);
        bounce_body.push(CRLF);
        header.header_list.forEach(line => {
            bounce_body.push(line);
        });
        bounce_body.push(CRLF);

        bounce_body.push(`--${boundary}--${CRLF}`);

        cb(null, bounce_body);
    }

    bounce(err, opts) {
        this.loginfo(`bouncing mail: ${err}`);
        if (!this.todo) {
            // haven't finished reading the todo, delay here...
            const self = this;
            self.once('ready', () => {
                self._bounce(err, opts);
            });
            return;
        }
        this._bounce(err, opts);
    }

    _bounce(err, opts) {
        err = new Error(err);
        if (opts) {
            err.mx = opts.mx;
            err.deferred_rcpt = opts.fail_recips;
            err.bounced_rcpt = opts.bounce_recips;
        }
        this.bounce_error = err;
        plugins.run_hooks('bounce', this, err);
    }

    bounce_respond(retval, msg) {
        if (retval !== constants.cont) {
            this.loginfo(
                `Plugin responded with: ${retval}. Not sending bounce.`
            );
            return this.discard(); // calls next_cb
        }

        const self = this;
        const err = this.bounce_error;

        if (!this.todo.mail_from.user) {
            // double bounce - mail was already a bounce
            return this.double_bounce('Mail was already a bounce');
        }

        const from = new Address('<>');
        const recip = new Address(
            this.todo.mail_from.user,
            this.todo.mail_from.host
        );
        this.populate_bounce_message(from, recip, err, function(
            err2,
            data_lines
        ) {
            if (err2) {
                return self.double_bounce(
                    `Error populating bounce message: ${err2}`
                );
            }

            outbound.send_email(
                from,
                recip,
                data_lines.join(''),
                (code, msg2) => {
                    if (code === constants.deny) {
                        // failed to even queue the mail
                        return self.double_bounce(
                            'Unable to queue the bounce message. Not sending bounce!'
                        );
                    }
                    self.discard();
                },
                { origin: this }
            );
        });
    }

    double_bounce(err) {
        this.lognotice(`Double bounce: ${err}`);
        fs.unlink(this.path, () => {});
        this.next_cb();
        // TODO: fill this in... ?
        // One strategy is perhaps log to an mbox file. What do other servers do?
        // Another strategy might be delivery "plugins" to cope with this.
    }

    delivered(
        ip,
        port,
        mode,
        host,
        response,
        ok_recips,
        fail_recips,
        bounce_recips,
        secured,
        authenticated
    ) {
        const delay = (Date.now() - this.todo.queue_time) / 1000;
        this.lognotice({
            'delivered file': this.filename,
            domain: this.todo.domain,
            host,
            ip,
            port,
            mode,
            tls: secured ? 'Y' : 'N',
            auth: authenticated ? 'Y' : 'N',
            response,
            delay,
            fails: this.num_failures,
            rcpts: `${ok_recips.length}/${fail_recips.length}/${bounce_recips.length}`,
        });
        plugins.run_hooks('delivered', this, [
            host,
            ip,
            response,
            delay,
            port,
            mode,
            ok_recips,
            secured,
            authenticated,
        ]);
    }

    discard() {
        this.refcount--;
        if (this.refcount === 0) {
            // Remove the file.
            fs.unlink(this.path, () => {});
            this.next_cb();
        }
    }

    convert_temp_failed_to_bounce(err, extra) {
        this.todo.rcpt_to.forEach(rcpt_to => {
            rcpt_to.dsn_action = 'failed';
            if (rcpt_to.dsn_status) {
                rcpt_to.dsn_status = `${rcpt_to.dsn_status}`.replace(/^4/, '5');
            }
        });
        return this.bounce(err, extra);
    }

    temp_fail(err, extra) {
        logger.logdebug(`Temp fail for: ${err}`);
        this.num_failures++;

        // Test for max failures which is configurable.
        if (this.num_failures >= obc.cfg.maxTempFailures) {
            return this.convert_temp_failed_to_bounce(
                `Too many failures (${err})`,
                extra
            );
        }

        // basic strategy is we exponentially grow the delay to the power
        // two each time, starting at 2 ** 6 seconds

        // Note: More advanced options should be explored in the future as the
        // last delay is 2**17 secs (1.5 days), which is a bit long... Exim has a max delay of
        // 6 hours (configurable) and the expire time is also configurable... But
        // this is good enough for now.

        const delay = Math.pow(2, this.num_failures + 5);

        plugins.run_hooks('deferred', this, { delay, err });
    }

    deferred_respond(retval, msg, params) {
        if (retval !== constants.cont && retval !== constants.denysoft) {
            this.loginfo(
                `plugin responded with: ${retval}. Not deferring. Deleting mail.`
            );
            return this.discard(); // calls next_cb
        }

        let delay = params.delay * 1000;

        if (retval === constants.denysoft) {
            delay = parseInt(msg, 10) * 1000;
        }

        this.loginfo(
            `Temp failing ${this.filename} for ${delay / 1000} seconds: ${
                params.err
            }`
        );
        const parts = _qfile.parts(this.filename);
        parts.next_attempt = Date.now() + delay;
        parts.attempts = this.num_failures;
        const new_filename = _qfile.name(parts);
        // const new_filename = this`.filename.replace(/^(\d+)_(\d+)_/, until + '_' + this.num_failures + '_');

        const hmail = this;
        fs.rename(this.path, path.join(queue_dir, new_filename), err => {
            if (err) {
                return hmail.bounce(`Error re-queueing email: ${err}`);
            }

            hmail.path = path.join(queue_dir, new_filename);
            hmail.filename = new_filename;

            hmail.next_cb();

            temp_fail_queue.add(hmail.filename, delay, () => {
                delivery_queue.push(hmail);
            });
        });
    }

    // The following handler has an impact on outgoing mail. It does remove the queue file.
    delivered_respond(retval, msg) {
        if (retval !== constants.cont && retval !== constants.ok) {
            this.logwarn('delivered plugin responded', { retval, msg });
        }
        this.discard();
    }

    split_to_new_recipients(recipients, response, cb) {
        const hmail = this;
        if (recipients.length === hmail.todo.rcpt_to.length) {
            // Split to new for no reason - increase refcount and return self
            hmail.refcount++;
            return cb(hmail);
        }
        const fname = _qfile.name();
        const tmp_path = path.join(queue_dir, `${_qfile.platformDOT}${fname}`);
        const ws = new FsyncWriteStream(tmp_path, {
            flags: constants.WRITE_EXCL,
        });
        function err_handler(err, location) {
            logger.logerror(
                `[outbound] Error while splitting to new recipients (${location}): ${err}`
            );
            hmail.todo.rcpt_to.forEach(rcpt => {
                hmail.extend_rcpt_with_dsn(
                    rcpt,
                    DSN.sys_unspecified(
                        `Error splitting to new recipients: ${err}`
                    )
                );
            });
            hmail.bounce(`Error splitting to new recipients: ${err}`);
        }

        ws.on('error', err => {
            err_handler(err, 'tmp file writer');
        });

        let writing = false;

        function write_more() {
            if (writing) return;
            writing = true;
            const rs = hmail.data_stream();
            rs.pipe(ws, { end: false });
            rs.on('error', err => {
                err_handler(err, 'hmail.data_stream reader');
            });
            rs.on('end', () => {
                ws.on('close', () => {
                    const dest_path = path.join(queue_dir, fname);
                    fs.rename(tmp_path, dest_path, err => {
                        if (err) {
                            err_handler(err, 'tmp file rename');
                        } else {
                            const split_mail = new HMailItem(
                                fname,
                                dest_path,
                                hmail.notes
                            );
                            split_mail.once('ready', () => {
                                cb(split_mail);
                            });
                        }
                    });
                });
                ws.destroySoon();
                return;
            });
        }

        ws.on('error', err => {
            logger.logerror(
                `[outbound] Unable to write queue file (${fname}): ${err}`
            );
            ws.destroy();
            hmail.todo.rcpt_to.forEach(rcpt => {
                hmail.extend_rcpt_with_dsn(
                    rcpt,
                    DSN.sys_unspecified(
                        `Error re-queueing some recipients: ${err}`
                    )
                );
            });
            hmail.bounce(`Error re-queueing some recipients: ${err}`);
        });

        const new_todo = JSON.parse(JSON.stringify(hmail.todo));
        new_todo.rcpt_to = recipients;
        outbound.build_todo(new_todo, ws, write_more);
    }
}

module.exports = HMailItem;
module.exports.obtls = obtls;

// copy logger methods into HMailItem:
for (const key in logger) {
    if (!/^log\w/.test(key)) continue;
    HMailItem.prototype[key] = (function(level) {
        return function() {
            // pass the HMailItem instance to logger
            const args = [this];
            for (let i = 0, l = arguments.length; i < l; i++) {
                args.push(arguments[i]);
            }
            logger[level].apply(logger, args);
        };
    })(key);
}

// MXs must be sorted by priority order, but matched priorities must be
// randomly shuffled in that list, so this is a bit complex.
function sort_mx(mx_list) {
    const sorted = mx_list.sort((a, b) => a.priority - b.priority);

    // This isn't a very good shuffle but it'll do for now.
    for (let i = 0, l = sorted.length - 1; i < l; i++) {
        if (sorted[i].priority === sorted[i + 1].priority) {
            if (Math.round(Math.random())) {
                // 0 or 1
                const j = sorted[i];
                sorted[i] = sorted[i + 1];
                sorted[i + 1] = j;
            }
        }
    }
    return sorted;
}

const smtp_regexp = /^(\d{3})([ -])#?(?:(\d\.\d\.\d)\s)?(.*)/;

function cram_md5_response(username, password, challenge) {
    const crypto = require('crypto');
    const c = utils.unbase64(challenge);
    const hmac = crypto.createHmac('md5', password);
    hmac.update(c);
    const digest = hmac.digest('hex');
    return utils.base64(`${username} ${digest}`);
}
