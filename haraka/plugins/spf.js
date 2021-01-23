// spf

const SPF = require('./spf').SPF;
const net_utils = require('haraka-net-utils');
const DSN = require('haraka-dsn');

exports.register = function() {
    const plugin = this;

    // Override logging in SPF module
    SPF.prototype.log_debug = str => plugin.logdebug(str);

    plugin.load_spf_ini();

    plugin.register_hook('helo', 'helo_spf');
    plugin.register_hook('ehlo', 'helo_spf');
};

exports.load_spf_ini = function() {
    const plugin = this;
    plugin.nu = net_utils; // so tests can set public_ip
    plugin.SPF = SPF;

    plugin.cfg = plugin.config.get(
        'spf.ini',
        {
            booleans: [
                '-defer.helo_temperror',
                '-defer.mfrom_temperror',

                '-defer_relay.helo_temperror',
                '-defer_relay.mfrom_temperror',

                '-deny.helo_none',
                '-deny.helo_softfail',
                '-deny.helo_fail',
                '-deny.helo_permerror',
                '-deny.openspf_text',

                '-deny.mfrom_none',
                '-deny.mfrom_softfail',
                '-deny.mfrom_fail',
                '-deny.mfrom_permerror',

                '-deny_relay.helo_none',
                '-deny_relay.helo_softfail',
                '-deny_relay.helo_fail',
                '-deny_relay.helo_permerror',

                '-deny_relay.mfrom_none',
                '-deny_relay.mfrom_softfail',
                '-deny_relay.mfrom_fail',
                '-deny_relay.mfrom_permerror',
                '-deny_relay.openspf_text',

                '-skip.relaying',
                '-skip.auth',
            ],
        },
        () => {
            plugin.load_spf_ini();
        }
    );

    // when set, preserve legacy config settings
    ['helo', 'mail'].forEach(phase => {
        if (plugin.cfg.main[`${phase}_softfail_reject`]) {
            plugin.cfg.deny[`${phase}_softfail`] = true;
        }
        if (plugin.cfg.main[`${phase}_fail_reject`]) {
            plugin.cfg.deny[`${phase}_fail`] = true;
        }
        if (plugin.cfg.main[`${phase}_temperror_defer`]) {
            plugin.cfg.defer[`${phase}_temperror`] = true;
        }
        if (plugin.cfg.main[`${phase}_permerror_reject`]) {
            plugin.cfg.deny[`${phase}_permerror`] = true;
        }
    });

    if (!plugin.cfg.relay) {
        plugin.cfg.relay = { context: 'sender' }; // default/legacy
    }

    plugin.cfg.lookup_timeout =
        plugin.cfg.main.lookup_timeout || plugin.timeout - 1;
};

exports.helo_spf = function(next, connection, helo) {
    const plugin = this;

    // bypass auth'ed or relay'ing hosts if told to
    const skip_reason = exports.skip_hosts(connection);
    if (skip_reason) {
        connection.results.add(plugin, { skip: `helo(${skip_reason})` });
        return next();
    }

    // Bypass private IPs
    if (connection.remote.is_private) {
        connection.results.add(plugin, { skip: 'helo(private_ip)' });
        return next();
    }

    // RFC 4408, 2.1: "SPF clients must be prepared for the "HELO"
    //           identity to be malformed or an IP address literal.
    if (net_utils.is_ip_literal(helo)) {
        connection.results.add(plugin, { skip: 'helo(ip_literal)' });
        return next();
    }

    // avoid 2nd EHLO evaluation if EHLO host is identical
    const results = connection.results.get(plugin);
    if (results && results.domain === helo) return next();

    let timeout = false;
    const spf = new SPF();
    const timer = setTimeout(() => {
        timeout = true;
        connection.loginfo(plugin, 'timeout');
        return next();
    }, plugin.cfg.lookup_timeout * 1000);

    spf.check_host(connection.remote.ip, helo, null, (err, result) => {
        if (timer) clearTimeout(timer);
        if (timeout) return;
        if (err) {
            connection.logerror(plugin, err);
            return next();
        }
        const host = connection.hello.host;
        plugin.log_result(
            connection,
            'helo',
            host,
            `postmaster@${host}`,
            spf.result(result)
        );

        connection.notes.spf_helo = result; // used between hooks
        connection.results.add(plugin, {
            scope: 'helo',
            result: spf.result(result),
            domain: host,
            emit: true,
        });
        if (spf.result(result) === 'Pass')
            connection.results.add(plugin, { pass: host });
        next();
    });
};

exports.hook_mail = function(next, connection, params) {
    const plugin = this;

    const txn = connection.transaction;
    if (!txn) return next();

    // bypass auth'ed or relay'ing hosts if told to
    const skip_reason = exports.skip_hosts(connection);
    if (skip_reason) {
        txn.results.add(plugin, { skip: `host(${skip_reason})` });
        return next(CONT, `skipped because host(${skip_reason})`);
    }

    // For messages from private IP space...
    if (connection.remote.is_private) {
        if (!connection.relaying) return next();
        if (connection.relaying && plugin.cfg.relay.context !== 'myself') {
            txn.results.add(plugin, { skip: 'host(private_ip)' });
            return next(CONT, 'envelope from private IP space');
        }
    }

    const mfrom = params[0].address();
    const host = params[0].host;
    let spf = new SPF();
    let auth_result;

    if (connection.notes.spf_helo) {
        const h_result = connection.notes.spf_helo;
        const h_host = connection.hello.host;
        plugin.save_to_header(connection, spf, h_result, mfrom, h_host, 'helo');
        if (!host) {
            // Use results from HELO if the return-path is null
            auth_result = spf.result(h_result).toLowerCase();
            connection.auth_results(`spf=${auth_result} smtp.helo=${h_host}`);

            const sender = `<> via ${h_host}`;
            return plugin.return_results(
                next,
                connection,
                spf,
                'helo',
                h_result,
                sender
            );
        }
    }

    if (!host) return next(); // null-sender

    let timeout = false;
    const timer = setTimeout(() => {
        timeout = true;
        connection.loginfo(plugin, 'timeout');
        next();
    }, plugin.cfg.lookup_timeout * 1000);

    spf.helo = connection.hello.host;

    function ch_cb(err, result, ip) {
        if (timer) clearTimeout(timer);
        if (timeout) return;
        if (err) {
            connection.logerror(plugin, err);
            return next();
        }
        plugin.log_result(
            connection,
            'mfrom',
            host,
            mfrom,
            spf.result(result),
            ip ? ip : connection.remote.ip
        );
        plugin.save_to_header(
            connection,
            spf,
            result,
            mfrom,
            host,
            'mailfrom',
            ip ? ip : connection.remote.ip
        );

        auth_result = spf.result(result).toLowerCase();
        connection.auth_results(`spf=${auth_result} smtp.mailfrom=${host}`);

        txn.notes.spf_mail_result = spf.result(result);
        txn.notes.spf_mail_record = spf.spf_record;
        txn.results.add(plugin, {
            scope: 'mfrom',
            result: spf.result(result),
            domain: host,
            emit: true,
        });
        if (spf.result(result) === 'Pass')
            connection.results.add(plugin, { pass: host });
        plugin.return_results(next, connection, spf, 'mfrom', result, mfrom);
    }

    // typical inbound (!relay)
    if (!connection.relaying) {
        return spf.check_host(connection.remote.ip, host, mfrom, ch_cb);
    }

    // outbound (relaying), context=sender
    if (plugin.cfg.relay.context === 'sender') {
        return spf.check_host(connection.remote.ip, host, mfrom, ch_cb);
    }

    // outbound (relaying), context=myself
    net_utils.get_public_ip((e, my_public_ip) => {
        // We always check the client IP first, because a relay
        // could be sending inbound mail from a non-local domain
        // which could case an incorrect SPF Fail result if we
        // check the public IP first, so we only check the public
        // IP if the client IP returns a result other than 'Pass'.
        spf.check_host(connection.remote.ip, host, mfrom, (err, result) => {
            let spf_result;
            if (result) {
                spf_result = spf.result(result).toLowerCase();
            }
            if (err || (spf_result && spf_result !== 'pass')) {
                if (e) return ch_cb(e); // Error looking up public IP

                if (!my_public_ip) {
                    return ch_cb(new Error(`failed to discover public IP`));
                }
                spf = new SPF();
                spf.check_host(my_public_ip, host, mfrom, (er, r) => {
                    ch_cb(er, r, my_public_ip);
                });
                return;
            }
            ch_cb(err, result, connection.remote.ip);
        });
    });
};

exports.log_result = function(connection, scope, host, mfrom, result, ip) {
    const show_ip = ip ? ip : connection.remote.ip;
    connection.loginfo(
        this,
        `identity=${scope} ip=${show_ip} domain="${host}" mfrom=<${mfrom}> result=${result}`
    );
};

exports.return_results = function(
    next,
    connection,
    spf,
    scope,
    result,
    sender
) {
    const plugin = this;
    const msgpre = scope === 'helo' ? `sender ${sender}` : `sender <${sender}>`;
    const deny = connection.relaying ? 'deny_relay' : 'deny';
    const defer = connection.relaying ? 'defer_relay' : 'defer';
    const sender_id = scope === 'helo' ? connection.hello_host : sender;
    let text = DSN.sec_unauthorized(
        `http://www.openspf.org/Why?s=${scope}&id=${sender_id}&ip=${connection.remote.ip}`
    );

    switch (result) {
        case spf.SPF_NONE:
            if (plugin.cfg[deny][`${scope}_none`]) {
                text = plugin.cfg[deny].openspf_text
                    ? text
                    : `${msgpre} SPF record not found`;
                return next(DENY, text);
            }
            return next();
        case spf.SPF_NEUTRAL:
        case spf.SPF_PASS:
            return next();
        case spf.SPF_SOFTFAIL:
            if (plugin.cfg[deny][`${scope}_softfail`]) {
                text = plugin.cfg[deny].openspf_text
                    ? text
                    : `${msgpre} SPF SoftFail`;
                return next(DENY, text);
            }
            return next();
        case spf.SPF_FAIL:
            if (plugin.cfg[deny][`${scope}_fail`]) {
                text = plugin.cfg[deny].openspf_text
                    ? text
                    : `${msgpre} SPF Fail`;
                return next(DENY, text);
            }
            return next();
        case spf.SPF_TEMPERROR:
            if (plugin.cfg[defer][`${scope}_temperror`]) {
                return next(DENYSOFT, `${msgpre} SPF Temporary Error`);
            }
            return next();
        case spf.SPF_PERMERROR:
            if (plugin.cfg[deny][`${scope}_permerror`]) {
                return next(DENY, `${msgpre} SPF Permanent Error`);
            }
            return next();
        default:
            // Unknown result
            connection.logerror(plugin, `unknown result code=${result}`);
            return next();
    }
};

exports.save_to_header = (connection, spf, result, mfrom, host, id, ip) => {
    // Add a trace header
    if (!connection) return;
    if (!connection.transaction) return;
    const des = result === spf.SPF_PASS ? 'designates' : 'does not designate';
    const identity = `identity=${id}; client-ip=${
        ip ? ip : connection.remote.ip
    }`;
    connection.transaction.add_leading_header(
        'Received-SPF',
        `${spf.result(result)} (${
            connection.local.host
        }: domain of ${host} ${des} ${
            connection.remote.ip
        } as permitted sender) receiver=${
            connection.local.host
        }; ${identity} helo=${connection.hello.host}; envelope-from=<${mfrom}>`
    );
};

exports.skip_hosts = function(connection) {
    const plugin = this;

    const skip = plugin.cfg.skip;
    if (skip) {
        if (skip.relaying && connection.relaying) return 'relay';
        if (skip.auth && connection.notes.auth_user) return 'auth';
    }
};
