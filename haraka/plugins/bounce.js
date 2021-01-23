// bounce tests
const tlds = require('haraka-tld');

const net_utils = require('haraka-net-utils');
const SPF = require('./spf').SPF;

// Override logging in SPF module
SPF.prototype.log_debug = str => exports.logdebug(str);

exports.register = function() {
    const plugin = this;
    plugin.load_bounce_ini();
    plugin.load_bounce_bad_rcpt();

    plugin.register_hook('mail', 'reject_all');
    plugin.register_hook('data', 'single_recipient');
    plugin.register_hook('data', 'bad_rcpt');
    plugin.register_hook('data_post', 'empty_return_path');
    plugin.register_hook('data', 'bounce_spf_enable');
    plugin.register_hook('data_post', 'bounce_spf');
    plugin.register_hook('data_post', 'non_local_msgid');
};

exports.load_bounce_bad_rcpt = function() {
    const plugin = this;

    const new_list = plugin.config.get('bounce_bad_rcpt', 'list', () => {
        plugin.load_bounce_bad_rcpt();
    });

    const invalids = {};
    for (let i = 0; i < new_list.length; i++) {
        invalids[new_list[i]] = true;
    }

    plugin.cfg.invalid_addrs = invalids;
};

exports.load_bounce_ini = function() {
    const plugin = this;
    plugin.cfg = plugin.config.get(
        'bounce.ini',
        {
            booleans: [
                '-check.reject_all',
                '+check.single_recipient',
                '-check.empty_return_path',
                '+check.bad_rcpt',
                '+check.bounce_spf',
                '+check.non_local_msgid',

                '+reject.single_recipient',
                '-reject.empty_return_path',
                '-reject.bounce_spf',
                '-reject.non_local_msgid',
            ],
        },
        () => {
            plugin.load_bounce_ini();
        }
    );

    // Legacy config handling
    if (plugin.cfg.main.reject_invalid) {
        plugin.logerror('bounce.ini is out of date, please update!');
        plugin.cfg.check.single_recipient = true;
        plugin.cfg.reject.single_recipient = true;
    }

    if (plugin.cfg.main.reject_all) {
        plugin.logerror('bounce.ini is out of date, please update!');
        plugin.cfg.check.reject_all = true;
    }
};

exports.reject_all = function(next, connection, params) {
    const plugin = this;
    if (!plugin.cfg.check.reject_all) {
        return next();
    }

    const mail_from = params[0];

    if (!plugin.has_null_sender(connection, mail_from)) {
        return next(); // bounce messages are from null senders
    }

    connection.transaction.results.add(plugin, {
        fail: 'bounces_accepted',
        emit: true,
    });
    return next(DENY, 'No bounces accepted here');
};

exports.single_recipient = function(next, connection) {
    const plugin = this;
    if (!plugin.cfg.check.single_recipient) return next();
    if (!plugin.has_null_sender(connection)) return next();

    const transaction = connection.transaction;

    // Valid bounces have a single recipient
    if (connection.transaction.rcpt_to.length === 1) {
        transaction.results.add(plugin, {
            pass: 'single_recipient',
            emit: true,
        });
        return next();
    }

    // Skip this check for relays or private_ips
    // This is because Microsoft Exchange will send mail
    // to distribution groups using the null-sender if
    // the option 'Do not send delivery reports' is
    // checked (not sure if this is default or not)
    if (connection.relaying) {
        transaction.results.add(plugin, {
            skip: 'single_recipient(relay)',
            emit: true,
        });
        return next();
    }
    if (connection.remote.is_private) {
        transaction.results.add(plugin, {
            skip: 'single_recipient(private_ip)',
            emit: true,
        });
        return next();
    }

    connection.loginfo(
        plugin,
        `bounce with too many recipients to: ${connection.transaction.rcpt_to.join(
            ','
        )}`
    );

    transaction.results.add(plugin, { fail: 'single_recipient', emit: true });

    if (!plugin.cfg.reject.single_recipient) return next();

    return next(DENY, 'this bounce message does not have 1 recipient');
};

exports.empty_return_path = function(next, connection) {
    const plugin = this;
    if (!plugin.cfg.check.empty_return_path) return next();
    if (!plugin.has_null_sender(connection)) return next();

    const transaction = connection.transaction;

    // Bounce messages generally do not have a Return-Path set. This checks
    // for that. But whether it should is worth questioning...

    // On Jan 20, 2014, Matt Simerson examined the most recent 50,000 mail
    // connections for the presence of Return-Path in bounce messages. I
    // found 14 hits, 12 of which were from Google, in response to
    // undeliverable DMARC reports (IE, automated messages that Google
    // shouldn't have replied to). Another appears to be a valid bounce from
    // a poorly configured mailer, and the 14th was a confirmed spam kill.
    // Unless new data demonstrate otherwise, this should remain disabled.

    // Return-Path, aka Reverse-PATH, Envelope FROM, RFC5321.MailFrom
    // validate that the Return-Path header is empty, RFC 3834

    const rp = connection.transaction.header.get('Return-Path');
    if (!rp) {
        transaction.results.add(plugin, { pass: 'empty_return_path' });
        return next();
    }

    if (rp === '<>') {
        transaction.results.add(plugin, { pass: 'empty_return_path' });
        return next();
    }

    transaction.results.add(plugin, { fail: 'empty_return_path', emit: true });
    return next(DENY, 'bounce with non-empty Return-Path (RFC 3834)');
};

exports.bad_rcpt = function(next, connection) {
    const plugin = this;
    const transaction = connection.transaction;

    if (!plugin.cfg.check.bad_rcpt) return next();
    if (!plugin.has_null_sender(connection)) return next();
    if (!plugin.cfg.invalid_addrs) return next();

    for (let i = 0; i < connection.transaction.rcpt_to.length; i++) {
        const rcpt = connection.transaction.rcpt_to[i].address();
        if (!plugin.cfg.invalid_addrs[rcpt]) continue;
        transaction.results.add(plugin, { fail: 'bad_rcpt', emit: true });
        return next(DENY, 'That recipient does not accept bounces');
    }

    transaction.results.add(plugin, { pass: 'bad_rcpt' });
    return next();
};

exports.has_null_sender = function(connection, mail_from) {
    const plugin = this;
    const transaction = connection.transaction;

    if (!mail_from) mail_from = connection.transaction.mail_from;

    // bounces have a null sender.
    // null sender could also be tested with mail_from.user
    // Why would isNull() exist if it wasn't the right way to test this?

    if (mail_from.isNull()) {
        transaction.results.add(plugin, { isa: 'yes' });
        return true;
    }

    transaction.results.add(plugin, { isa: 'no' });
    return false;
};

const message_id_re = /^Message-ID:\s*(<?[^>]+>?)/gim;

function find_message_id_headers(headers, body, connection, self) {
    if (!body) return;
    let match;
    while ((match = message_id_re.exec(body.bodytext))) {
        const mid = match[1];
        headers[mid] = true;
    }
    for (let i = 0, l = body.children.length; i < l; i++) {
        // Recure to any MIME children
        find_message_id_headers(headers, body.children[i], connection, self);
    }
}

exports.non_local_msgid = function(next, connection) {
    const plugin = this;
    if (!plugin.cfg.check.non_local_msgid) return next();
    if (!plugin.has_null_sender(connection)) return next();

    const transaction = connection.transaction;

    // Bounce messages usually contain the headers of the original message
    // in the body. This parses the body, searching for the Message-ID header.
    // It then inspects the contents of that header, extracting the domain part,
    // and then checks to see if that domain is local to this server.

    // NOTE: this only works reliably if *every* message sent has a local
    // domain in the Message-ID. In practice, that means outbound MXes MUST
    // check Message-ID on outbound and modify non-conforming Message-IDs.
    //
    // NOTE 2: Searching the bodytext of a bounce is too simple. The bounce
    // message should exist as a MIME Encoded part. See here for ideas
    //     http://lamsonproject.org/blog/2009-07-09.html
    //     http://lamsonproject.org/docs/bounce_detection.html

    let matches = {};
    find_message_id_headers(matches, transaction.body, connection, plugin);
    matches = Object.keys(matches);
    connection.logdebug(plugin, `found Message-IDs: ${matches.join(', ')}`);

    if (!matches.length) {
        connection.loginfo(plugin, 'no Message-ID matches');
        transaction.results.add(plugin, { fail: 'Message-ID' });
        if (!plugin.cfg.reject.non_local_msgid) return next();
        return next(
            DENY,
            `bounce without Message-ID in headers, unable to verify that I sent it`
        );
    }

    const domains = [];
    for (let i = 0; i < matches.length; i++) {
        const res = matches[i].match(/@([^>]*)>?/i);
        if (!res) continue;
        domains.push(res[1]);
    }

    if (domains.length === 0) {
        connection.loginfo(
            plugin,
            'no domain(s) parsed from Message-ID headers'
        );
        transaction.results.add(plugin, { fail: 'Message-ID parseable' });
        if (!plugin.cfg.reject.non_local_msgid) return next();
        return next(DENY, `bounce with invalid Message-ID, I didn't send it.`);
    }

    connection.logdebug(plugin, domains);

    const valid_domains = [];
    for (let j = 0; j < domains.length; j++) {
        const org_dom = tlds.get_organizational_domain(domains[j]);
        if (!org_dom) {
            continue;
        }
        valid_domains.push(org_dom);
    }

    if (valid_domains.length === 0) {
        transaction.results.add(plugin, { fail: 'Message-ID valid domain' });
        if (!plugin.cfg.reject.non_local_msgid) return next();
        return next(
            DENY,
            `bounce Message-ID without valid domain, I didn't send it.`
        );
    }

    return next();

    /* The code below needs some kind of test to say the domain isn't local.
        this would be hard to do without knowing how you have Haraka configured.
        e.g. it could be config/host_list, or it could be some other way.
        - hence I added the return next() above or this test can never be correct.
    */
    // we wouldn't have accepted the bounce if the recipient wasn't local
    // transaction.results.add(plugin,
    //         {fail: 'Message-ID not local', emit: true });
    // if (!plugin.cfg.reject.non_local_msgid) return next();
    // return next(DENY, "bounce with non-local Message-ID (RFC 3834)");
};

// Lazy regexp to get IPs from Received: headers in bounces
const received_re = net_utils.get_ipany_re(
    '^Received:[\\s\\S]*?[\\[\\(](?:IPv6:)?',
    '[\\]\\)]'
);

function find_received_headers(ips, body, connection, self) {
    if (!body) return;
    let match;
    while ((match = received_re.exec(body.bodytext))) {
        const ip = match[1];
        if (net_utils.is_private_ip(ip)) continue;
        ips[ip] = true;
    }
    for (let i = 0, l = body.children.length; i < l; i++) {
        // Recurse in any MIME children
        find_received_headers(ips, body.children[i], connection, self);
    }
}

exports.bounce_spf_enable = function(next, connection) {
    const plugin = this;
    if (plugin.cfg.check.bounce_spf) {
        connection.transaction.parse_body = true;
    }
    return next();
};

exports.bounce_spf = function(next, connection) {
    const plugin = this;
    if (!plugin.cfg.check.bounce_spf) return next();
    if (!plugin.has_null_sender(connection)) return next();
    const txn = connection.transaction;

    // Recurse through all textual parts and store all parsed IPs
    // in an object to remove any duplicates which might appear.
    let ips = {};
    find_received_headers(ips, txn.body, connection, plugin);
    ips = Object.keys(ips);
    if (!ips.length) {
        connection.loginfo(plugin, 'No received headers found in message');
        return next();
    }

    connection.logdebug(plugin, `found IPs to check: ${ips.join(', ')}`);

    let pending = 0;
    let aborted = false;
    let called_cb = false;
    let timer;

    function run_cb(abort, retval, msg) {
        if (aborted) return;
        if (abort) aborted = true;
        if (!aborted && pending > 0) return;
        if (called_cb) return;
        clearTimeout(timer);
        called_cb = true;
        return next(retval, msg);
    }

    timer = setTimeout(() => {
        connection.logerror(plugin, 'Timed out');
        txn.results.add(plugin, { skip: 'bounce_spf(timeout)' });
        return run_cb(true);
    }, (plugin.timeout - 1) * 1000);

    ips.forEach(ip => {
        if (aborted) return;
        const spf = new SPF();
        pending++;
        spf.check_host(
            ip,
            txn.rcpt_to[0].host,
            txn.rcpt_to[0].address(),
            (err, result) => {
                if (aborted) return;
                pending--;
                if (err) {
                    connection.logerror(plugin, err.message);
                    return run_cb();
                }
                connection.logdebug(
                    plugin,
                    `ip=${ip} spf_result=${spf.result(result)}`
                );
                switch (result) {
                    case spf.SPF_NONE:
                    // falls through, domain doesn't publish an SPF record
                    case spf.SPF_TEMPERROR:
                    case spf.SPF_PERMERROR:
                        // Abort as all subsequent lookups will return this
                        connection.logdebug(
                            plugin,
                            `Aborted: SPF returned ${spf.result(result)}`
                        );
                        txn.results.add(plugin, { skip: 'bounce_spf' });
                        return run_cb(true);
                    case spf.SPF_PASS:
                        // Presume this is a valid bounce
                        // TODO: this could be spoofed; could weight each IP to combat
                        connection.loginfo(
                            plugin,
                            `Valid bounce originated from ${ip}`
                        );
                        txn.results.add(plugin, { pass: 'bounce_spf' });
                        return run_cb(true);
                }
                if (pending === 0 && !aborted) {
                    // We've checked all the IPs and none of them returned Pass
                    txn.results.add(plugin, { fail: 'bounce_spf', emit: true });
                    if (!plugin.cfg.reject.bounce_spf) return run_cb();
                    return run_cb(
                        false,
                        DENY,
                        'Invalid bounce (spoofed sender)'
                    );
                }
            }
        );
        if (pending === 0 && !aborted) {
            // No lookups run for some reason
            return run_cb();
        }
    });
};
