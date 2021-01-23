// Plugin which registers mail received to a certain address
// and extracts a From: address from the mail and puts that address
// in the mail_from.blocklist file. You need to be running the
// mail_from.blocklist plugin for this to work fully.

const fs = require('fs');
const utils = require('haraka-utils');

exports.hook_data = (next, connection) => {
    // enable mail body parsing
    connection.transaction.parse_body = true;
    next();
};

exports.hook_data_post = function(next, connection) {
    if (!connection.relaying) {
        return next();
    }

    const recip = (this.config.get('block_me.recipient') || '').toLowerCase();
    const senders = this.config.get('block_me.senders', 'list');

    const self = this;

    // Make sure only 1 recipient
    if (connection.transaction.rcpt_to.length != 1) {
        return next();
    }

    // Check recipient is the right one
    if (connection.transaction.rcpt_to[0].address().toLowerCase() != recip) {
        return next();
    }

    // Check sender is in list
    const sender = connection.transaction.mail_from.address();
    if (!utils.in_array(sender, senders)) {
        return next(DENY, `You are not allowed to block mail, ${sender}`);
    }

    // Now extract the "From" from the body...
    const to_block = extract_from_line(connection.transaction.body);
    if (!to_block) {
        connection.logerror(this, 'No sender found in email');
        return next();
    }

    connection.loginfo(this, `Blocking new sender: ${to_block}`);

    connection.transaction.notes.block_me = 1;

    // add to mail_from.blocklist
    fs.open('./config/mail_from.blocklist', 'a', (err, fd) => {
        if (err) {
            connection.logerror(
                self,
                `Unable to append to mail_from.blocklist: ${err}`
            );
            return;
        }
        fs.write(fd, `${to_block}\n`, null, 'UTF-8', (err2, written) => {
            fs.close(fd);
        });
    });

    next();
};

exports.hook_queue = (next, connection) => {
    if (connection.transaction.notes.block_me) {
        // pretend we queued this mail
        return next(OK);
    }

    next();
};

// Example: From: 	Site Tucano Gold <contato@tucanogold.com.br>
function extract_from_line(body) {
    const matches = body.bodytext.match(/\bFrom:[^<\n]*<([^>\n]*)>/);
    if (matches) {
        return matches[1];
    }

    for (let i = 0, l = body.children.length; i < l; i++) {
        const from = extract_from_line(body.children[i]);
        if (from) {
            return from;
        }
    }

    return null;
}
