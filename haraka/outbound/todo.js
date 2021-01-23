'use strict';

// queue file header data
class TODOItem {
    constructor(domain, recipients, transaction) {
        this.queue_time = Date.now();
        this.domain = domain;
        this.rcpt_to = recipients;
        this.mail_from = transaction.mail_from;
        this.message_stream = transaction.message_stream;
        this.notes = transaction.notes;
        this.uuid = transaction.uuid;
    }
}

module.exports = TODOItem;
