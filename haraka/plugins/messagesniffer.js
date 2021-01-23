// messagesniffer

const fs = require('fs');
const net = require('net');
const plugin = exports;

// Defaults
let port = 9001;

exports.register = function() {
    const cfg = this.config.get('messagesniffer.ini');
    if (cfg.main.port) port = parseInt(cfg.main.port);
};

exports.hook_connect = function(next, connection) {
    const self = this;
    const cfg = this.config.get('messagesniffer.ini');

    // Skip any private IP ranges
    if (connection.remote.is_private) return next();

    // Retrieve GBUdb information for the connecting IP
    SNFClient(
        `<snf><xci><gbudb><test ip='${connection.remote.ip}'/></gbudb></xci></snf>`,
        (err, result) => {
            if (err) {
                connection.logerror(self, err.message);
                return next();
            }
            let match;
            if ((match = /<result ((?:(?!\/>)[^])+)\/>/.exec(result))) {
                // Log result
                connection.loginfo(self, match[1]);
                // Populate result
                const gbudb = {};
                const split = match[1].toString().split(/\s+/);
                for (let i = 0; i < split.length; i++) {
                    const split2 = split[i].split(/=/);
                    gbudb[split2[0]] = split2[1].replace(/(?:^'|'$)/g, '');
                }
                // Set notes for other plugins
                connection.notes.gbudb = gbudb;
                // Handle result
                switch (gbudb.range) {
                    case 'new':
                    case 'normal':
                        return next();
                    case 'white':
                        // Default for white if no configuration
                        if (
                            !cfg.gbudb ||
                            (cfg.gbudb && !cfg.gbudb[gbudb.range])
                        ) {
                            return next(OK);
                        }
                    // fall through
                    case 'caution':
                    case 'black':
                    case 'truncate':
                        if (cfg.gbudb && cfg.gbudb[gbudb.range]) {
                            connection.loginfo(
                                self,
                                `range=${gbudb.range} action=${
                                    cfg.gbudb[gbudb.range]
                                }`
                            );
                            switch (cfg.gbudb[gbudb.range]) {
                                case 'accept':
                                    // Whitelist
                                    connection.notes.gbudb.action = 'accept';
                                    return next(OK);
                                case 'allow':
                                case 'continue':
                                    // Continue to next plugin
                                    connection.notes.gbudb.action = 'allow';
                                    return next();
                                case 'retry':
                                case 'tempfail':
                                    return next(
                                        DENYSOFT,
                                        `Poor GBUdb reputation for [${connection.remote.ip}]`
                                    );
                                case 'reject':
                                    return next(
                                        DENY,
                                        `Poor GBUdb reputation for [${connection.remote.ip}]`
                                    );
                                case 'quarantine':
                                    connection.notes.gbudb.action =
                                        'quarantine';
                                    connection.notes.quarantine = true;
                                    connection.notes.quarantine_action = [
                                        OK,
                                        `Message quarantined (${connection.transaction.uuid})`,
                                    ];
                                    break;
                                case 'tag':
                                    connection.notes.gbudb.action = 'tag';
                                    break;
                                default:
                                    // Unknown action
                                    return next();
                            }
                        } else if (gbudb.range === 'truncate') {
                            // Default for truncate
                            return next(
                                DENY,
                                `Poor GBUdb reputation for [${connection.remote.ip}]`
                            );
                        }
                        return next();
                    default:
                        // Unknown
                        connection.logerror(
                            self,
                            `Unknown GBUdb range: ${gbudb.range}`
                        );
                        return next();
                }
            } else {
                return next();
            }
        }
    );
};

exports.hook_data_post = function(next, connection) {
    const self = this;
    const cfg = this.config.get('messagesniffer.ini');
    const txn = connection.transaction;
    if (!txn) return next();

    function tag_subject() {
        const tag = cfg.main.tag_string || '[SPAM]';
        const subj = txn.header.get_decoded('Subject');
        // Try and prevent any double subject modifications
        const subject_re = new RegExp(`^${tag}`);
        if (!subject_re.test(subj)) {
            txn.remove_header('Subject');
            txn.add_header('Subject', `${tag} ${subj}`);
        }
        // Add spam flag
        txn.remove_header('X-Spam-Flag');
        txn.add_header('X-Spam-Flag', 'YES');
    }

    // Check GBUdb results
    if (connection.notes.gbudb && connection.notes.gbudb.action) {
        switch (connection.notes.gbudb.action) {
            case 'accept':
            case 'quarantine':
                return next(OK);
            case 'tag':
                // Tag message
                tag_subject();
                return next();
        }
    }

    const tmpdir = cfg.main.tmpdir || '/tmp';
    const tmpfile = `${tmpdir}/${txn.uuid}.tmp`;
    const ws = fs.createWriteStream(tmpfile);

    ws.once('error', err => {
        connection.logerror(
            self,
            `Error writing temporary file: ${err.message}`
        );
        return next();
    });

    ws.once('close', () => {
        const start_time = Date.now();
        SNFClient(
            `<snf><xci><scanner><scan file='${tmpfile}' xhdr='yes'/></scanner></xci></snf>`,
            (err, result) => {
                const end_time = Date.now();
                const elapsed = end_time - start_time;
                // Delete the tempfile
                fs.unlink(tmpfile, () => {});
                let match;
                // Make sure we actually got a result
                if ((match = /<result code='(\d+)'/.exec(result))) {
                    const code = parseInt(match[1]);
                    let group;
                    let rules;
                    let gbudb_ip;
                    // Make a note that we actually ran
                    connection.notes.snf_run = true;
                    // Get the returned headers
                    if (
                        (match = /<xhdr>((?:(?!<\/xhdr>)[^])+)/.exec(
                            result,
                            'm'
                        ))
                    ) {
                        // Parse the returned headers and add them to the message
                        const xhdr = match[1].split('\r\n');
                        const headers = [];
                        for (let i = 0; i < xhdr.length; i++) {
                            const line = xhdr[i];
                            // Check for continuation
                            if (/^\s/.test(line)) {
                                // Continuation; add to previous header value
                                if (headers[headers.length - 1]) {
                                    headers[
                                        headers.length - 1
                                    ].value += `${line}\r\n`;
                                }
                            } else {
                                // Must be a header
                                match = /^([^: ]+):(?:\s*(.+))?$/.exec(line);
                                if (match) {
                                    headers.push({
                                        header: match[1],
                                        value: match[2]
                                            ? `${match[2]}\r\n`
                                            : '\r\n',
                                    });
                                }
                            }
                        }
                        // Add headers to message
                        for (let h = 0; h < headers.length; h++) {
                            const header = headers[h];
                            // If present save the group for logging purposes
                            if (
                                header.header === 'X-MessageSniffer-SNF-Group'
                            ) {
                                group = header.value.replace(/\r?\n/gm, '');
                            }
                            // Log GBUdb analysis
                            if (header.header === 'X-GBUdb-Analysis') {
                                // Retrieve IP address determined by GBUdb
                                const gbudb_split = header.value.split(/,\s*/);
                                gbudb_ip = gbudb_split[1];
                                connection.logdebug(
                                    self,
                                    `GBUdb: ${header.value.replace(
                                        /\r?\n/gm,
                                        ''
                                    )}`
                                );
                            }
                            if (header.header === 'X-MessageSniffer-Rules') {
                                rules = header.value
                                    .replace(/\r?\n/gm, '')
                                    .replace(/\s+/g, ' ')
                                    .trim();
                                connection.logdebug(self, `rules: ${rules}`);
                            }
                            // Remove any existing headers
                            txn.remove_header(header.header);
                            txn.add_header(header.header, header.value);
                        }
                    }
                    // Summary log
                    connection.loginfo(
                        self,
                        `result: time=${elapsed}ms code=${code}${
                            gbudb_ip ? ` ip="${gbudb_ip}"` : ''
                        }${group ? ` group="${group}"` : ''}${
                            rules
                                ? ` rule_count=${rules.split(/\s+/).length}`
                                : ''
                        }${rules ? ` rules="${rules}"` : ''}`
                    );
                    // Result code MUST in the 0-63 range otherwise we got an error
                    // http://www.armresearch.com/support/articles/software/snfServer/errors.jsp
                    if (code === 0 || (code && code <= 63)) {
                        // Handle result
                        let action;
                        if (cfg.message) {
                            if (code === 0 && cfg.message.white) {
                                action = cfg.message.white;
                            } else if (code === 1) {
                                if (cfg.message.local_white) {
                                    action = cfg.message.local_white;
                                } else {
                                    return next(OK);
                                }
                            } else if (code === 20) {
                                if (cfg.message.truncate) {
                                    action = cfg.message.truncate;
                                } else {
                                    return next(
                                        DENY,
                                        `Poor GBUdb reputation for IP [${connection.remote.ip}]`
                                    );
                                }
                            } else if (code === 40 && cfg.message.caution) {
                                action = cfg.message.caution;
                            } else if (code === 63 && cfg.message.black) {
                                action = cfg.message.black;
                            } else {
                                if (cfg.message[`code_${code}`]) {
                                    action = cfg.message[`code_${code}`];
                                } else {
                                    if (code > 1 && code !== 40) {
                                        if (cfg.message.nonzero) {
                                            action = cfg.message.nonzero;
                                        } else {
                                            return next(
                                                DENY,
                                                `${'Spam detected by MessageSniffer (code='}${code} group=${group})`
                                            );
                                        }
                                    }
                                }
                            }
                        } else {
                            // Default with no configuration
                            if (code > 1 && code !== 40) {
                                return next(
                                    DENY,
                                    `${'Spam detected by MessageSniffer (code='}${code} group=${group})`
                                );
                            } else {
                                return next();
                            }
                        }
                        switch (action) {
                            case 'accept':
                                // Whitelist
                                return next(OK);
                            case 'allow':
                            case 'continue':
                                // Continue to next plugin
                                return next();
                            case 'retry':
                            case 'tempfail':
                                return next(
                                    DENYSOFT,
                                    `Spam detected by MessageSniffer (code=${code} group=${group})`
                                );
                            case 'reject':
                                return next(
                                    DENY,
                                    `Spam detected by MessageSniffer (code=${code} group=${group})`
                                );
                            case 'quarantine':
                                // Set flag for queue/quarantine plugin
                                txn.notes.quarantine = true;
                                txn.notes.quarantine_action = [
                                    OK,
                                    `Message quarantined (${txn.uuid})`,
                                ];
                                break;
                            case 'tag':
                                tag_subject();
                            // fall through
                            default:
                                return next();
                        }
                    } else {
                        // Out-of-band code returned
                        // Handle Bulk/Noisy special rule by re-writing the Precedence header
                        if (code === 100) {
                            let precedence = txn.header.get('precedence');
                            if (precedence) {
                                // We already have a precedence header
                                precedence = precedence.trim().toLowerCase();
                                switch (precedence) {
                                    case 'bulk':
                                    case 'list':
                                    case 'junk':
                                        // Leave these as they are
                                        break;
                                    default:
                                        // Remove anything else and replace it with 'bulk'
                                        txn.remove_header('precedence');
                                        txn.add_header('Precedence', 'bulk');
                                }
                            } else {
                                txn.add_header('Precedence', 'bulk');
                            }
                        }
                        return next();
                    }
                } else {
                    // Something must have gone wrong
                    connection.logwarn(self, `unexpected response: ${result}`);
                }
                return next();
            }
        );
    });

    // TODO: we only need the first 64Kb of the message
    txn.message_stream.pipe(ws, { line_endings: '\r\n' });
};

exports.hook_disconnect = function(next, connection) {
    const self = this;
    const cfg = this.config.get('messagesniffer.ini');

    // Train GBUdb on rejected messages and recipients
    if (
        cfg.main.gbudb_report_deny &&
        !connection.notes.snf_run &&
        (connection.rcpt_count.reject > 0 || connection.msg_count.reject > 0)
    ) {
        const snfreq = `<snf><xci><gbudb><bad ip='${connection.remote.ip}'/></gbudb></xci></snf>`;
        SNFClient(snfreq, (err, result) => {
            if (err) {
                connection.logerror(self, err.message);
            } else {
                connection.logdebug(
                    self,
                    `GBUdb bad encounter added for ${connection.remote.ip}`
                );
            }
            return next();
        });
    } else {
        return next();
    }
};

function SNFClient(req, cb) {
    let result;
    const sock = new net.Socket();
    sock.setTimeout(30 * 1000); // Connection timeout
    sock.once('timeout', function() {
        this.destroy();
        return cb(new Error('connection timed out'));
    });
    sock.once('error', err => cb(err));
    sock.once('connect', function() {
        // Connected, send request
        plugin.logprotocol(`> ${req}`);
        this.write(`${req}\n`);
    });
    sock.on('data', data => {
        plugin.logprotocol(`< ${data}`);
        // Buffer all the received lines
        result ? (result += data) : (result = data);
    });
    sock.once('end', () => {
        // Check for result
        let match;
        if (/<result /.exec(result)) {
            return cb(null, result);
        } else if ((match = /<error message='([^']+)'/.exec(result))) {
            return cb(new Error(match[1]));
        } else {
            return cb(new Error(`unexpected result: ${result}`));
        }
    });
    // Start the sequence
    sock.connect(port);
}
