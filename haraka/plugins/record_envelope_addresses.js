// record_envelope_addresses

// documentation via: haraka -h plugins/record_envelope_addresses

exports.hook_rcpt = (next, connection, params) => {
    const txn = connection.transaction;
    if (txn) {
        txn.add_header('X-Envelope-To', params[0].address());
    }
    next();
};

exports.hook_mail = (next, connection, params) => {
    const txn = connection.transaction;
    if (txn) {
        txn.add_header('X-Envelope-From', params[0].address());
    }
    next();
};
