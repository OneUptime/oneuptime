// This plugin is now entirely redundant. The core will queue outbound mails
// automatically just like this. It is kept here for backwards compatibility
// purposes only.

const outbound = require('./outbound');

exports.hook_queue_outbound = (next, connection) => {
    if (!connection.relaying) {
        return next(); // we're not relaying so don't deliver outbound
    }

    outbound.send_email(connection.transaction, next);
};
