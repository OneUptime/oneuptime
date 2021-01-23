// Implementation of XCLIENT protocol
// See http://www.postfix.org/XCLIENT_README.html

const utils = require('haraka-utils');
const DSN = require('haraka-dsn');
const net = require('net');
let allowed_hosts = {};

exports.register = function() {
    this.load_xclient_hosts();
};

exports.load_xclient_hosts = function() {
    const self = this;
    const cfg = this.config.get('xclient.hosts', 'list', () => {
        self.load_xclient_hosts();
    });
    const ah = {};
    for (const i in cfg) {
        ah[cfg[i]] = true;
    }
    allowed_hosts = ah;
};

function xclient_allowed(ip) {
    if (ip === '127.0.0.1' || ip === '::1' || allowed_hosts[ip]) {
        return true;
    }
    return false;
}

exports.hook_capabilities = (next, connection) => {
    if (xclient_allowed(connection.remote.ip)) {
        connection.capabilities.push('XCLIENT NAME ADDR PROTO HELO LOGIN');
    }
    next();
};

exports.hook_unrecognized_command = function(next, connection, params) {
    if (params[0] !== 'XCLIENT') {
        return next();
    }

    // XCLIENT is not allowed after transaction start
    if (connection.transaction) {
        return next(
            DENY,
            DSN.proto_unspecified('Mail transaction in progress', 503)
        );
    }

    if (!xclient_allowed(connection.remote.ip)) {
        return next(DENY, DSN.proto_unspecified('Not authorized', 550));
    }

    // If we get here - the client is allowed to use XCLIENT
    // Process arguments
    const args = new String(params[1]).toLowerCase().split(/ /);
    const xclient = {};
    for (let a = 0; a < args.length; a++) {
        const match = /^([^=]+)=([^ ]+)/.exec(args[a]);
        if (match) {
            connection.logdebug(
                this,
                `found key=${match[1]} value=${match[2]}`
            );
            switch (match[1]) {
                case 'destaddr':
                case 'addr': {
                    // IPv6 is prefixed in the XCLIENT protocol
                    let ipv6;
                    if ((ipv6 = /^IPV6:(.+)$/i.exec(match[2]))) {
                        // Validate
                        if (net.isIPv6(ipv6[1])) {
                            xclient[match[1]] = ipv6[1];
                        }
                    } else if (!/\[UNAVAILABLE\]/i.test(match[2])) {
                        // IPv4
                        if (net.isIPv4(match[2])) {
                            xclient[match[1]] = match[2];
                        }
                    }
                    break;
                }
                case 'proto':
                    // SMTP or ESMTP
                    if (/^e?smtp/i.test(match[2])) {
                        xclient[match[1]] = match[2];
                    }
                    break;
                case 'name':
                case 'port':
                case 'helo':
                case 'login':
                case 'destport':
                    if (!/\[(UNAVAILABLE|TEMPUNAVAIL)\]/i.test(match[2])) {
                        xclient[match[1]] = match[2];
                    }
                    break;
                default:
                    connection.logwarn(this, `unknown argument: ${args[a]}`);
            }
        } else {
            connection.logwarn(this, `unknown argument: ${args[a]}`);
        }
    }

    // Abort if we don't have a valid IP address
    if (!xclient.addr) {
        return next(
            DENY,
            DSN.proto_invalid_cmd_args('No valid IP address found', 501)
        );
    }

    // Apply changes
    const new_uuid = utils.uuid();
    connection.loginfo(this, `new uuid=${new_uuid}`);
    connection.uuid = new_uuid;
    connection.reset_transaction();
    connection.relaying = false;
    connection.set('remote.ip', xclient.addr);
    connection.set('remote.host', xclient.name ? xclient.name : undefined);
    connection.set('remote.login', xclient.login ? xclient.login : undefined);
    connection.set('hello.host', xclient.helo ? xclient.helo : undefined);
    connection.set('local.ip', xclient.destaddr ? xclient.destaddr : undefined);
    connection.set(
        'local.port',
        xclient.destport ? xclient.destport : undefined
    );
    if (xclient.proto) {
        connection.set(
            'hello',
            'verb',
            xclient.proto === 'esmtp' ? 'EHLO' : 'HELO'
        );
    }
    connection.esmtp = xclient.proto === 'esmtp';
    connection.xclient = true;
    if (!xclient.name) {
        return next(NEXT_HOOK, 'lookup_rdns');
    } else {
        return next(NEXT_HOOK, 'connect');
    }
};
