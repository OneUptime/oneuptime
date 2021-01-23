//queue/lmtp

'use strict';

let outbound;

exports.register = function() {
    this.load_lmtp_ini();
    outbound = this.haraka_require('outbound');
};

exports.load_lmtp_ini = function() {
    const plugin = this;
    plugin.cfg = plugin.config.get('lmtp.ini', () => {
        plugin.load_lmtp_ini();
    });
};

exports.hook_get_mx = function(next, hmail, domain) {
    const plugin = this;

    if (!hmail.todo.notes.using_lmtp) return next();

    const mx = { using_lmtp: true, priority: 0, exchange: '127.0.0.1' };

    const section = plugin.cfg[domain] || plugin.cfg.main;
    if (section.path) {
        Object.assign(mx, { path: section.path });
        return next(OK, mx);
    }

    Object.assign(mx, {
        exchange: section.host || '127.0.0.1',
        port: section.port || 24,
    });

    return next(OK, mx);
};

exports.hook_queue = (next, connection) => {
    const txn = connection.transaction;

    const q_wants = txn.notes.get('queue.wants');
    if (q_wants && q_wants !== 'lmtp') return next();

    txn.notes.using_lmtp = true;
    outbound.send_email(txn, next);
};
