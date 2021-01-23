// This is the aliases plugin
// One must not run this plugin with the queue/smtp_proxy plugin.
const Address = require('address-rfc2821').Address;

exports.register = function() {
    this.inherits('queue/discard');

    this.register_hook('rcpt', 'aliases');
};

exports.aliases = function(next, connection, params) {
    const plugin = this;
    const config = this.config.get('aliases', 'json') || {};
    const rcpt = params[0].address();
    const user = params[0].user;
    const host = params[0].host;
    let match = user.split(/[+-]/, 1);
    let action = '<missing>';

    if (config[rcpt]) {
        action = config[rcpt].action || action;
        match = rcpt;

        switch (action.toLowerCase()) {
            case 'drop':
                _drop(plugin, connection, rcpt);
                break;
            case 'alias':
                _alias(plugin, connection, match, config[match], host);
                break;
            default:
                connection.loginfo(plugin, `unknown action: ${action}`);
        }
    }

    if (config[`@${host}`]) {
        action = config[`@${host}`].action || action;
        match = `@${host}`;

        switch (action.toLowerCase()) {
            case 'drop':
                _drop(plugin, connection, `@${host}`);
                break;
            case 'alias':
                _alias(plugin, connection, match, config[match], host);
                break;
            default:
                connection.loginfo(plugin, `unknown action: ${action}`);
        }
    }

    if (config[user] || config[match[0]] || config[`${match[0]}@${host}`]) {
        if (config[user]) {
            action = config[user].action || action;
            match = user;
        } else if (config[match[0]]) {
            action = config[match[0]].action || action;
            match = match[0];
        } else {
            action = config[`${match[0]}@${host}`].action || action;
            match = `${match[0]}@${host}`;
        }

        switch (action.toLowerCase()) {
            case 'drop':
                _drop(plugin, connection, rcpt);
                break;
            case 'alias':
                _alias(plugin, connection, match, config[match], host);
                break;
            default:
                connection.loginfo(plugin, `unknown action: ${action}`);
        }
    }

    next();
};

function _drop(plugin, connection, rcpt) {
    connection.logdebug(plugin, `marking ${rcpt} for drop`);
    connection.transaction.notes.discard = true;
}

function _alias(plugin, connection, key, config, host) {
    let to;
    let toAddress;

    if (config.to) {
        if (Array.isArray(config.to)) {
            connection.logdebug(
                plugin,
                `aliasing ${connection.transaction.rcpt_to} to ${config.to}`
            );
            connection.transaction.rcpt_to.pop();
            for (let i = 0, len = config.to.length; i < len; i++) {
                toAddress = new Address(`<${config.to[i]}>`);
                connection.transaction.rcpt_to.push(toAddress);
            }
        } else {
            if (config.to.search('@') !== -1) {
                to = config.to;
            } else {
                to = `${config.to}@${host}`;
            }

            connection.logdebug(
                plugin,
                `aliasing ${connection.transaction.rcpt_to} to ${to}`
            );

            toAddress = new Address(`<${to}>`);
            connection.transaction.rcpt_to.pop();
            connection.transaction.rcpt_to.push(toAddress);
        }
        connection.transaction.notes.forward = true;
    } else {
        connection.loginfo(
            plugin,
            `alias failed for ${key}, no "to" field in alias config`
        );
    }
}
