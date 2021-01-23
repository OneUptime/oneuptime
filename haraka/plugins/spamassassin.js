'use strict';
// Call spamassassin via spamd

const sock = require('./line_socket');
const utils = require('haraka-utils');

exports.register = function() {
    const plugin = this;
    plugin.load_spamassassin_ini();
};

exports.load_spamassassin_ini = function() {
    const plugin = this;
    plugin.cfg = plugin.config.get(
        'spamassassin.ini',
        {
            booleans: [
                '+add_headers',
                '+check.authenticated',
                '+check.private_ip',
                '+check.local_ip',
                '+check.relay',
            ],
        },
        () => {
            plugin.load_spamassassin_ini();
        }
    );

    const defaults = {
        spamd_socket: 'localhost:783',
        max_size: 500000,
        old_headers_action: 'rename',
        subject_prefix: '*** SPAM ***',
        spamc_auth_header: 'X-Haraka-Relay',
    };

    for (const key in defaults) {
        if (plugin.cfg.main[key]) continue;
        plugin.cfg.main[key] = defaults[key];
    }

    [
        'reject_threshold',
        'relay_reject_threshold',
        'munge_subject_threshold',
        'max_size',
    ].forEach(item => {
        if (!plugin.cfg.main[item]) return;
        plugin.cfg.main[item] = Number(plugin.cfg.main[item]);
    });
};

exports.hook_data_post = function(next, connection) {
    const plugin = this;
    const conn = connection;
    const txn = connection.transaction;

    if (plugin.msg_too_big(conn)) return next();
    if (!plugin.should_check(conn)) return next();

    txn.remove_header(plugin.cfg.main.spamc_auth_header); // just to be safe

    const username = plugin.get_spamd_username(conn);
    const headers = plugin.get_spamd_headers(conn, username);
    const socket = plugin.get_spamd_socket(next, conn, headers);

    const spamd_response = { headers: {} };
    let state = 'line0';
    let last_header;
    const start = Date.now();

    socket.on('line', line => {
        conn.logprotocol(plugin, `Spamd C: ${line} state=${state}`);
        line = line.replace(/\r?\n/, '');
        if (state === 'line0') {
            spamd_response.line0 = line;
            state = 'response';
        } else if (state === 'response') {
            if (line.match(/\S/)) {
                const matches = line.match(
                    /Spam: (True|False) ; (-?\d+\.\d) \/ (-?\d+\.\d)/
                );
                if (matches) {
                    spamd_response.flag = matches[1];
                    spamd_response.score = matches[2];
                    spamd_response.hits = matches[2]; // backwards compat
                    spamd_response.reqd = matches[3];
                    spamd_response.flag =
                        spamd_response.flag === 'True' ? 'Yes' : 'No';
                }
            } else {
                state = 'headers';
            }
        } else if (state === 'headers') {
            const m = line.match(/^X-Spam-([\x21-\x39\x3B-\x7E]+):\s*(.*)/);
            if (m) {
                conn.logdebug(plugin, `header: ${line}`);
                last_header = m[1];
                spamd_response.headers[m[1]] = m[2];
                return;
            }
            let fold;
            if (last_header && (fold = line.match(/^(\s+.*)/))) {
                spamd_response.headers[last_header] += `\r\n${fold[1]}`;
                return;
            }
            last_header = '';
        }
    });

    socket.once('end', () => {
        if (spamd_response.headers && spamd_response.headers.Tests) {
            spamd_response.tests = spamd_response.headers.Tests.replace(
                /\s/g,
                ''
            );
        }
        if (spamd_response.tests === undefined) {
            // strip the 'tests' from the X-Spam-Status header
            if (spamd_response.headers && spamd_response.headers.Status) {
                // SpamAssassin appears to have a bug that causes a space not to
                // be added before autolearn= when the header line has been folded.
                // So we modify the regexp here not to match autolearn onwards.
                const tests = /tests=((?:(?!autolearn)[^ ])+)/.exec(
                    spamd_response.headers.Status.replace(/\r?\n\t/g, '')
                );
                if (tests) spamd_response.tests = tests[1];
            }
        }

        // do stuff with the results...
        txn.notes.spamassassin = spamd_response;
        conn.results.add(plugin, {
            time: (Date.now() - start) / 1000,
            hits: spamd_response.hits,
            flag: spamd_response.flag,
        });

        plugin.fixup_old_headers(txn);
        plugin.do_header_updates(conn, spamd_response);
        plugin.log_results(conn, spamd_response);

        const exceeds_err = plugin.score_too_high(conn, spamd_response);
        if (exceeds_err) return next(DENY, exceeds_err);

        plugin.munge_subject(conn, spamd_response.score);

        next();
    });
};

exports.fixup_old_headers = function(txn) {
    const plugin = this;
    const action = plugin.cfg.main.old_headers_action;
    const headers = txn.notes.spamassassin.headers;

    let key;
    switch (action) {
        case 'keep':
            break;
        case 'drop':
            for (key in headers) {
                if (!key) continue;
                txn.remove_header(`X-Spam-${key}`);
            }
            break;
        // case 'rename':
        default:
            for (key in headers) {
                if (!key) continue;
                key = `X-Spam-${key}`;
                const old_val = txn.header.get(key);
                txn.remove_header(key);
                if (old_val) {
                    // plugin.logdebug(plugin, `header: ${key}, ${old_val}`);
                    txn.add_header(key.replace(/^X-/, 'X-Old-'), old_val);
                }
            }
            break;
    }
};

exports.munge_subject = function(conn, score) {
    const plugin = this;
    const munge = plugin.cfg.main.munge_subject_threshold;
    if (!munge) return;
    if (parseFloat(score) < parseFloat(munge)) return;

    const subj = conn.transaction.header.get('Subject');
    const subject_re = new RegExp(
        `^${utils.regexp_escape(plugin.cfg.main.subject_prefix)}`
    );
    if (subject_re.test(subj)) return; // prevent double munge

    conn.transaction.remove_header('Subject');
    conn.transaction.add_header(
        'Subject',
        `${plugin.cfg.main.subject_prefix} ${subj}`
    );
};

exports.do_header_updates = function(conn, spamd_response) {
    const plugin = this;
    if (spamd_response.flag === 'Yes') {
        // X-Spam-Flag is added by SpamAssassin
        conn.transaction.remove_header('precedence');
        conn.transaction.add_header('Precedence', 'junk');
    }

    const modern = plugin.cfg.main.modern_status_syntax;
    if (!plugin.cfg.main.add_headers) return;

    for (const key in spamd_response.headers) {
        if (!key || key === '' || key === undefined) continue;
        let val = spamd_response.headers[key];
        if (val === undefined) {
            val = '';
        }

        if (key === 'Status' && !modern) {
            const legacy = spamd_response.headers[key].replace(
                / score=/,
                ' hits='
            );
            conn.transaction.add_header('X-Spam-Status', legacy);
            continue;
        }
        if (val === '') continue;
        conn.transaction.add_header(`X-Spam-${key}`, val);
    }
};

exports.score_too_high = function(conn, spamd_response) {
    const plugin = this;
    const score = spamd_response.score;
    if (conn.relaying) {
        const rmax = plugin.cfg.main.relay_reject_threshold;
        if (rmax && score >= rmax) {
            return 'spam score exceeded relay threshold';
        }
    }

    const max = plugin.cfg.main.reject_threshold;
    if (max && score >= max) {
        return 'spam score exceeded threshold';
    }

    return false;
};

exports.get_spamd_username = function(conn) {
    const plugin = this;

    let user = conn.transaction.notes.spamd_user; // 1st priority
    if (user && user !== undefined) return user;

    if (!plugin.cfg.main.spamd_user) return 'default'; // when not defined
    user = plugin.cfg.main.spamd_user;

    // Enable per-user SA prefs
    if (user === 'first-recipient') {
        // special cases
        return conn.transaction.rcpt_to[0].address();
    }
    if (user === 'all-recipients') {
        throw 'Unimplemented';
        // TODO: pass the message through SA for each recipient. Then apply
        // the least strict result to the connection. That is useful when
        // one user blacklists a sender that another user wants to get mail
        // from. If this is something you care about, this is the spot.
    }
    return user;
};

exports.get_spamd_headers = function(conn, username) {
    const plugin = this;
    // http://svn.apache.org/repos/asf/spamassassin/trunk/spamd/PROTOCOL
    const headers = [
        'HEADERS SPAMC/1.4',
        `User: ${username}`,
        '',
        `X-Envelope-From: ${conn.transaction.mail_from.address()}`,
        `X-Haraka-UUID: ${conn.transaction.uuid}`,
    ];
    if (conn.relaying) {
        headers.push(`${plugin.cfg.main.spamc_auth_header}: true`);
    }

    return headers;
};

exports.get_spamd_socket = function(next, conn, headers) {
    const plugin = this;
    // TODO: support multiple spamd backends

    const socket = new sock.Socket();
    socket.is_connected = false;
    const results_timeout = parseInt(plugin.cfg.main.results_timeout) || 300;

    socket.on('connect', function() {
        // Abort if the transaction is gone
        if (!conn.transaction) {
            plugin.logwarn(
                conn,
                'Transaction gone, cancelling SPAMD connection'
            );
            socket.end();
            return;
        }

        this.is_connected = true;
        // Reset timeout
        this.setTimeout(results_timeout * 1000);
        socket.write(`${headers.join('\r\n')}\r\n`);
        conn.transaction.message_stream.pipe(socket);
    });

    socket.on('error', err => {
        conn.logerror(plugin, `connection failed: ${err}`);
        // TODO: optionally DENYSOFT
        // TODO: add a transaction note
        return next();
    });

    socket.on('timeout', function() {
        if (!this.is_connected) {
            conn.logerror(plugin, 'spamd connection timed out');
        } else {
            conn.logerror(plugin, 'timeout waiting for results');
        }
        socket.end();
        return next();
    });

    const connect_timeout = parseInt(plugin.cfg.main.connect_timeout) || 30;
    socket.setTimeout(connect_timeout * 1000);

    if (plugin.cfg.main.spamd_socket.match(/\//)) {
        // assume unix socket
        socket.connect(plugin.cfg.main.spamd_socket);
    } else {
        const hostport = plugin.cfg.main.spamd_socket.split(/:/);
        socket.connect(hostport[1] || 783, hostport[0]);
    }

    return socket;
};

exports.msg_too_big = function(conn) {
    const plugin = this;
    if (!plugin.cfg.main.max_size) return false;

    const size = conn.transaction.data_bytes;

    const max = plugin.cfg.main.max_size;
    if (size <= max) {
        return false;
    }
    conn.loginfo(
        plugin,
        `skipping, size ${utils.prettySize(
            size
        )} exceeds max: ${utils.prettySize(max)}`
    );
    return true;
};

exports.log_results = function(conn, spamd_response) {
    const plugin = this;
    const cfg = plugin.cfg.main;
    const reject_threshold = conn.relaying
        ? cfg.relay_reject_threshold || cfg.reject_threshold
        : cfg.reject_threshold;

    const human_text =
        `status=${spamd_response.flag}` +
        `, score=${spamd_response.score}` +
        `, required=${spamd_response.reqd}` +
        `, reject=${reject_threshold}` +
        `, tests="${spamd_response.tests}"`;

    conn.transaction.results.add(plugin, {
        human: human_text,
        status: spamd_response.flag,
        score: parseFloat(spamd_response.score),
        required: parseFloat(spamd_response.reqd),
        reject: reject_threshold,
        tests: spamd_response.tests,
        emit: true,
    });
};

exports.should_check = function(conn) {
    const plugin = this;

    let result = true; // default

    if (plugin.cfg.check.authenticated == false && conn.notes.auth_user) {
        conn.transaction.results.add(plugin, { skip: 'authed' });
        result = false;
    }

    if (plugin.cfg.check.relay == false && conn.relaying) {
        conn.transaction.results.add(plugin, { skip: 'relay' });
        result = false;
    }

    if (plugin.cfg.check.local_ip == false && conn.remote.is_local) {
        conn.transaction.results.add(plugin, { skip: 'local_ip' });
        result = false;
    }

    if (plugin.cfg.check.private_ip == false && conn.remote.is_private) {
        if (plugin.cfg.check.local_ip == true && conn.remote.is_local) {
            // local IPs are included in private IPs
        } else {
            conn.transaction.results.add(plugin, { skip: 'private_ip' });
            result = false;
        }
    }

    return result;
};
