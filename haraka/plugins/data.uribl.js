'use strict';
// Look up URLs in SURBL

const url = require('url');
const dns = require('dns');
const net = require('net');
const tlds = require('haraka-tld');

const net_utils = require('haraka-net-utils');
const utils = require('haraka-utils');

// Default regexps to extract the URIs from the message
const numeric_ip = /\w{3,16}:\/+(\S+@)?(\d+|0[xX][0-9A-Fa-f]+)\.(\d+|0[xX][0-9A-Fa-f]+)\.(\d+|0[xX][0-9A-Fa-f]+)\.(\d+|0[xX][0-9A-Fa-f]+)/gi;
let schemeless = /(?:%(?:25)?(?:2F|3D|40))?((?:www\.)?[a-zA-Z0-9][a-zA-Z0-9\-.]{0,250}\.(?:aero|arpa|asia|biz|cat|com|coop|edu|gov|info|int|jobs|mil|mobi|museum|name|net|org|pro|tel|travel|xxx|[a-zA-Z]{2}))(?!\w)/gi;
let schemed = /(\w{3,16}:\/+(?:\S+@)?([a-zA-Z0-9][a-zA-Z0-9\-.]+\.(?:aero|arpa|asia|biz|cat|com|coop|edu|gov|info|int|jobs|mil|mobi|museum|name|net|org|pro|tel|travel|xxx|[a-zA-Z]{2})))(?!\w)/gi;

let lists;
let zones;
const excludes = {};

function check_excludes_list(host) {
    host = host
        .toLowerCase()
        .split('.')
        .reverse();
    for (let i = 0; i < host.length; i++) {
        let check;
        if (i === 0) {
            check = host[i];
        } else {
            check = [host[i], check].join('.');
        }
        if (excludes[check]) {
            return true;
        }
    }
    return false;
}

exports.register = function() {
    // Override regexps if top_level_tlds file is present
    if (!tlds.top_level_tlds) return;
    if (!Object.keys(tlds.top_level_tlds).length) return;

    this.logdebug('Building new regexps from TLD file');
    const re_schemeless = `(?:%(?:25)?(?:2F|3D|40))?((?:www\\.)?[a-zA-Z0-9][a-zA-Z0-9\\-.]{0,250}\\.(?:${Object.keys(
        tlds.top_level_tlds
    ).join('|')}))(?!\\w)`;
    schemeless = new RegExp(re_schemeless, 'gi');
    const re_schemed = `(\\w{3,16}:\\/+(?:\\S+@)?([a-zA-Z0-9][a-zA-Z0-9\\-.]+\\.(?:${Object.keys(
        tlds.top_level_tlds
    ).join('|')})))(?!\\w)`;
    schemed = new RegExp(re_schemed, 'gi');
};

exports.load_uri_config = function(next) {
    lists = this.config.get('data.uribl.ini');
    zones = Object.keys(lists);
    if (!zones || zones.length <= 1) {
        this.logerror('aborting: no zones configured');
        return next();
    }
    // Load excludes
    this.config.get('data.uribl.excludes', 'list').forEach(domain => {
        excludes[domain.toLowerCase()] = 1;
    });
    // Set defaults
    if (lists.main && !lists.main.max_uris_per_list) {
        lists.main.max_uris_per_list = 20;
    }
};

// IS: IPv6 compatible (maybe; if the BL is support IPv6 requests)
exports.do_lookups = function(connection, next, hosts, type) {
    const plugin = this;

    // Store the results in the correct place based on the lookup type
    let results = connection.results;
    if (connection.transaction) {
        results = connection.transaction.results;
    }

    if (typeof hosts === 'string') {
        hosts = [hosts];
    }
    if (!hosts || !hosts.length) {
        connection.logdebug(plugin, `(${type}) no items found for lookup`);
        results.add(plugin, { skip: type });
        return next();
    }
    connection.logdebug(
        plugin,
        `(${type}) found ${hosts.length} items for lookup`
    );
    utils.shuffle(hosts);

    let j;
    const queries = {};
    for (let i = 0; i < hosts.length; i++) {
        let host = hosts[i].toLowerCase();
        connection.logdebug(plugin, `(${type}) checking: ${host}`);
        // Make sure we have a valid TLD
        if (
            !net.isIPv4(host) &&
            !net.isIPv6(host) &&
            !tlds.top_level_tlds[host.split('.').reverse()[0]]
        ) {
            continue;
        }
        // Check the exclusion list
        if (check_excludes_list(host)) {
            results.add(plugin, { skip: `excluded domain:${host}` });
            continue;
        }
        // Loop through the zones
        for (j = 0; j < zones.length; j++) {
            const zone = zones[j];
            if (zone === 'main') continue; // skip config
            if (
                !lists[zone] ||
                (lists[zone] &&
                    !/^(?:1|true|yes|enabled|on)$/i.test(lists[zone][type]))
            ) {
                results.add(plugin, {
                    skip: `${type} unsupported for ${zone}`,
                });
                continue;
            }
            // Convert in-addr.arpa into bare IPv4/v6 lookup
            const arpa = host.split(/\./).reverse();
            if (arpa.shift() === 'arpa') {
                const ip_format = arpa.shift();
                if (ip_format === 'in-addr') {
                    if (arpa.length < 4) continue; // Only full IP addresses
                    host = arpa.join('.');
                } else if (ip_format === 'ip6') {
                    if (arpa.length < 32) continue; // Only full IP addresses
                    host = arpa.join('.');
                }
            }
            let lookup;
            // Handle zones that do not allow IP queries (e.g. Spamhaus DBL)
            if (net.isIPv4(host)) {
                if (
                    /^(?:1|true|yes|enabled|on)$/i.test(
                        lists[zone].no_ip_lookups
                    )
                ) {
                    results.add(plugin, {
                        skip: `IP (${host}) not supported for ${zone}`,
                    });
                    continue;
                }
                // Skip any private IPs
                if (net_utils.is_private_ip(host)) {
                    results.add(plugin, { skip: 'private IP' });
                    continue;
                }
                // Reverse IP for lookup
                lookup = host
                    .split(/\./)
                    .reverse()
                    .join('.');
            }
            if (net.isIPv6(host)) {
                if (
                    /^(?:1|true|yes|enabled|on)$/i.test(
                        lists[zone].not_ipv6_compatible
                    ) ||
                    /^(?:1|true|yes|enabled|on)$/i.test(
                        lists[zone].no_ip_lookups
                    )
                ) {
                    results.add(plugin, {
                        skip: `IP (${host}) not supported for ${zone}`,
                    });
                    continue;
                }
                // Skip any private IPs
                if (net_utils.is_private_ip(host)) {
                    results.add(plugin, { skip: 'private IP' });
                    continue;
                }
                // Reverse IP for lookup
                lookup = net_utils.ipv6_reverse(host);
            }
            // Handle zones that require host to be stripped to a domain boundary
            else if (
                /^(?:1|true|yes|enabled|on)$/i.test(lists[zone].strip_to_domain)
            ) {
                lookup = tlds.split_hostname(host, 3)[1];
            }
            // Anything else..
            else {
                lookup = host;
            }
            if (!lookup) continue;
            if (!queries[zone]) queries[zone] = {};
            if (
                Object.keys(queries[zone]).length > lists.main.max_uris_per_list
            ) {
                connection.logwarn(
                    plugin,
                    `discarding lookup ${lookup} for zone ${zone} maximum query limit reached`
                );
                results.add(plugin, { skip: `max query limit for ${zone}` });
                continue;
            }
            queries[zone][lookup] = 1;
        }
    }

    // Flatten object into array for easier querying
    const queries_to_run = [];
    for (j = 0; j < Object.keys(queries).length; j++) {
        for (
            let k = 0;
            k < Object.keys(queries[Object.keys(queries)[j]]).length;
            k++
        ) {
            // host/domain, zone
            queries_to_run.push([
                Object.keys(queries[Object.keys(queries)[j]])[k],
                Object.keys(queries)[j],
            ]);
        }
    }

    if (!queries_to_run.length) {
        results.add(plugin, { skip: `${type} (no queries)` });
        return next();
    }

    utils.shuffle(queries_to_run); // Randomize the order

    // Perform the lookups
    let pending_queries = 0;
    let called_next = false;
    let timer;
    function call_next(code, msg) {
        clearTimeout(timer);
        if (called_next) return;
        called_next = true;
        next(code, msg);
    }

    timer = setTimeout(() => {
        connection.logdebug(plugin, 'timeout');
        results.add(plugin, { err: `${type} timeout` });
        call_next();
    }, (lists.main && lists.main.timeout ? lists.main.timeout : 30) * 1000);

    function conclude_if_no_pending() {
        if (pending_queries !== 0) return;
        results.add(plugin, { pass: type });
        call_next();
    }

    queries_to_run.forEach(query => {
        let lookup = query.join('.');
        // Add root dot if necessary
        if (lookup[lookup.length - 1] !== '.') {
            lookup = `${lookup}.`;
        }
        pending_queries++;
        dns.resolve4(lookup, (err, addrs) => {
            pending_queries--;
            connection.logdebug(
                plugin,
                `${lookup} => (${err ? err : addrs.join(', ')})`
            );

            if (err) return conclude_if_no_pending();

            let skip = false;
            function do_reject(msg) {
                if (skip) return;
                if (called_next) return;
                if (!msg) {
                    msg = `${query[0]} blacklisted in ${query[1]}`;
                }
                // Check for custom message
                if (lists[query[1]] && lists[query[1]].custom_msg) {
                    msg = lists[query[1]].custom_msg
                        .replace(/\{uri\}/g, query[0])
                        .replace(/\{zone\}/g, query[1]);
                }
                results.add(plugin, {
                    fail: [type, query[0], query[1]].join('/'),
                });
                call_next(DENY, msg);
            }
            // Optionally validate first result against a regexp
            if (lists[query[1]] && lists[query[1]].validate) {
                const re = new RegExp(lists[query[1]].validate);
                if (!re.test(addrs[0])) {
                    connection.logdebug(
                        plugin,
                        `ignoring result (${addrs[0]}) for: ${lookup} as it did not match validation rule`
                    );
                    skip = true;
                }
            }
            // Check for optional bitmask
            if (lists[query[1]] && lists[query[1]].bitmask) {
                // A bitmask zone should only return a single result
                // We only support a bitmask of up to 128 in a single octet
                const last_octet = Number(addrs[0].split('.')[3]);
                const bitmask = Number(lists[query[1]].bitmask);
                if ((last_octet & bitmask) > 0) {
                    connection.loginfo(
                        plugin,
                        `found ${query[0]} in zone ${query[1]} (${addrs.join(
                            ','
                        )}; bitmask=${bitmask})`
                    );
                    do_reject();
                } else {
                    connection.logdebug(
                        plugin,
                        `ignoring result (${addrs[0]}) for: ${lookup} as the bitmask did not match`
                    );
                    skip = true;
                }
            } else {
                connection.loginfo(
                    plugin,
                    `found ${query[0]} in zone ${query[1]} (${addrs.join(',')})`
                );
                do_reject();
            }

            conclude_if_no_pending();
        });
    });

    conclude_if_no_pending();
};

exports.hook_lookup_rdns = function(next, connection) {
    this.load_uri_config(next);
    const plugin = this;
    dns.reverse(connection.remote.ip, (err, rdns) => {
        if (err) {
            if (err.code) {
                if (err.code === dns.NXDOMAIN) return next();
                if (err.code === dns.NOTFOUND) return next();
            }
            connection.results.add(plugin, { err });
            return next();
        }
        plugin.do_lookups(connection, next, rdns, 'rdns');
    });
};

exports.hook_ehlo = function(next, connection, helo) {
    this.load_uri_config(next);
    // Handle IP literals
    let literal;
    if (
        (literal = net_utils
            .get_ipany_re('^\\[(?:IPv6:)?', '\\]$', '')
            .exec(helo))
    ) {
        this.do_lookups(connection, next, literal[1], 'helo');
    } else {
        this.do_lookups(connection, next, helo, 'helo');
    }
};
exports.hook_helo = exports.hook_ehlo;

exports.hook_mail = function(next, connection, params) {
    this.load_uri_config(next);
    this.do_lookups(connection, next, params[0].host, 'envfrom');
};

exports.hook_data = (next, connection) => {
    // enable mail body parsing
    connection.transaction.parse_body = true;
    return next();
};

exports.hook_data_post = function(next, connection) {
    this.load_uri_config(next);
    const email_re = /<?[^@]+@([^> ]+)>?/;
    const plugin = this;
    const trans = connection.transaction;

    // From header
    function do_from_header(cb) {
        const from = trans.header.get_decoded('from');
        const fmatch = email_re.exec(from);
        if (fmatch) {
            return plugin.do_lookups(connection, cb, fmatch[1], 'from');
        }
        cb();
    }

    // Reply-To header
    function do_replyto_header(cb) {
        const replyto = trans.header.get('reply-to');
        const rmatch = email_re.exec(replyto);
        if (rmatch) {
            return plugin.do_lookups(connection, cb, rmatch[1], 'replyto');
        }
        cb();
    }

    // Message-Id header
    function do_msgid_header(cb) {
        const msgid = trans.header.get('message-id');
        const mmatch = /@([^>]+)>/.exec(msgid);
        if (mmatch) {
            return plugin.do_lookups(connection, cb, mmatch[1], 'msgid');
        }
        cb();
    }

    // Body
    function do_body(cb) {
        const urls = {};
        extract_urls(urls, trans.body, connection, plugin);
        return plugin.do_lookups(connection, cb, Object.keys(urls), 'body');
    }

    const chain = [do_from_header, do_replyto_header, do_msgid_header, do_body];
    function chain_caller(code, msg) {
        if (code) {
            return next(code, msg);
        }
        if (!chain.length) {
            return next();
        }
        const next_in_chain = chain.shift();
        next_in_chain(chain_caller);
    }
    chain_caller();
};

function extract_urls(urls, body, connection, self) {
    // extract from body.bodytext
    let match;
    if (!body || !body.bodytext) {
        return;
    }

    let uri;
    // extract numeric URIs
    while ((match = numeric_ip.exec(body.bodytext))) {
        try {
            uri = url.parse(match[0]);
            // Don't reverse the IPs here; we do it in the lookup
            urls[uri.hostname] = uri;
        } catch (error) {
            connection.logerror(
                self,
                `parse error: ${match[0]} ${error.message}`
            );
        }
    }

    // match plain hostname.tld
    while ((match = schemeless.exec(body.bodytext))) {
        try {
            uri = url.parse(`http://${match[1]}`);
            urls[uri.hostname] = uri;
        } catch (error) {
            connection.logerror(
                self,
                `parse error: ${match[1]} ${error.message}`
            );
        }
    }

    // match scheme:// URI
    while ((match = schemed.exec(body.bodytext))) {
        try {
            uri = url.parse(match[1]);
            urls[uri.hostname] = uri;
        } catch (error) {
            connection.logerror(
                self,
                `parse error: ${match[1]} ${error.message}`
            );
        }
    }

    // TODO: URIHASH
    // TODO: MAILHASH

    for (let i = 0, l = body.children.length; i < l; i++) {
        extract_urls(urls, body.children[i], connection, self);
    }
}
