// discard

exports.register = function() {
    this.register_hook('queue', 'discard');
    this.register_hook('queue_outbound', 'discard');
};

exports.discard = (next, connection) => {
    const txn = connection.transaction;

    const q_wants = txn.notes.get('queue.wants');
    if (q_wants && q_wants !== 'discard') return next();

    function discard() {
        connection.loginfo('discarding message');
        // Pretend we delivered the message
        return next(OK);
    }

    if (connection.notes.discard) return discard();
    if (txn.notes.discard) return discard();
    if (q_wants === 'discard') return discard();
    if (process.env.YES_REALLY_DO_DISCARD) return discard();

    // Allow other queue plugins to deliver
    next();
};
