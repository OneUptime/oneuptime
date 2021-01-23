'use strict';
// An SMTP Transaction

// node.js built-in modules
const util = require('util');

// haraka npm modules
const Notes = require('haraka-notes');
const utils = require('haraka-utils');

// Haraka modules
const Header = require('./mailheader').Header;
const body = require('./mailbody');
const MessageStream = require('./messagestream');

class Transaction {
    constructor(uuid, cfg) {
        this.uuid = uuid || utils.uuid();
        this.cfg = cfg || load_smtp_ini();
        this.mail_from = null;
        this.rcpt_to = [];
        this.header_lines = [];
        this.data_lines = [];
        this.attachment_start_hooks = [];
        this.banner = null;
        this.body_filters = [];
        this.data_bytes = 0;
        this.header_pos = 0;
        this.found_hb_sep = false;
        this.body = null;
        this.parse_body = false;
        this.notes = new Notes();
        this.header = new Header();
        this.message_stream = new MessageStream(
            this.cfg,
            this.uuid,
            this.header.header_list
        );
        this.discard_data = false;
        this.resetting = false;
        this.rcpt_count = {
            accept: 0,
            tempfail: 0,
            reject: 0,
        };
        this.msg_status = undefined;
        this.data_post_start = null;
        this.data_post_delay = 0;
        this.encoding = 'utf8';
        this.mime_part_count = 0;
    }

    ensure_body() {
        if (this.body) return;

        this.body = new body.Body(this.header);
        this.body.on('mime_boundary', m => this.incr_mime_count());
        this.attachment_start_hooks.forEach(h => {
            this.body.on('attachment_start', h);
        });

        if (this.banner) {
            this.body.set_banner(this.banner);
        }

        for (const o of this.body_filters) {
            this.body.add_filter((ct, enc, buf) => {
                const re_match =
                    util.isRegExp(o.ct_match) &&
                    o.ct_match.test(ct.toLowerCase());
                const ct_begins =
                    ct
                        .toLowerCase()
                        .indexOf(String(o.ct_match).toLowerCase()) === 0;
                if (re_match || ct_begins) return o.filter(ct, enc, buf);
            });
        }
    }

    // Removes the CR of a CRLF newline at the end of the buffer.
    remove_final_cr(data) {
        if (data.length < 2) return data;
        if (!Buffer.isBuffer(data)) data = Buffer.from(data);

        if (data[data.length - 2] === 0x0d && data[data.length - 1] === 0x0a) {
            data[data.length - 2] = 0x0a;
            return data.slice(0, data.length - 1);
        }
        return data;
    }

    // Duplicates any '.' chars at the beginning of a line (dot-stuffing) and
    // ensures all newlines are CRLF.
    add_dot_stuffing_and_ensure_crlf_newlines(data) {
        if (!data.length) return data;
        if (!Buffer.isBuffer(data)) data = Buffer.from(data);

        // Make a new buffer big enough to hold two bytes for every one input
        // byte.  At most, we add one extra character per input byte, so this
        // is always big enough.  We allocate it "unsafe" (i.e. no memset) for
        // speed because we're about to fill it with data, and the remainder of
        // the space we don't fill will be sliced away before we return this.
        const output = Buffer.allocUnsafe(data.length * 2);
        let output_pos = 0;

        let input_pos = 0;
        let next_dot = data.indexOf(0x2e);
        let next_lf = data.indexOf(0x0a);
        while (next_dot !== -1 || next_lf !== -1) {
            const run_end =
                next_dot !== -1 && (next_lf === -1 || next_dot < next_lf)
                    ? next_dot
                    : next_lf;

            // Copy up till whichever comes first, '.' or '\n' (but don't
            // copy the '.' or '\n' itself).
            data.copy(output, output_pos, input_pos, run_end);
            output_pos += run_end - input_pos;

            if (
                data[run_end] === 0x2e &&
                (run_end === 0 || data[run_end - 1] === 0x0a)
            ) {
                // Replace /^\./ with '..'
                output[output_pos++] = 0x2e;
            } else if (
                data[run_end] === 0x0a &&
                (run_end === 0 || data[run_end - 1] !== 0x0d)
            ) {
                // Replace /\r?\n/ with '\r\n'
                output[output_pos++] = 0x0d;
            }
            output[output_pos++] = data[run_end];

            input_pos = run_end + 1;

            if (run_end === next_dot) {
                next_dot = data.indexOf(0x2e, input_pos);
            } else {
                next_lf = data.indexOf(0x0a, input_pos);
            }
        }

        if (input_pos < data.length) {
            data.copy(output, output_pos, input_pos);
            output_pos += data.length - input_pos;
        }

        return output.slice(0, output_pos);
    }

    add_data(line) {
        if (typeof line === 'string') {
            // This shouldn't ever happen.
            line = Buffer.from(line, this.encoding);
        }
        // is this the end of headers line?
        if (
            this.header_pos === 0 &&
            (line[0] === 0x0a || (line[0] === 0x0d && line[1] === 0x0a))
        ) {
            this.header.parse(this.header_lines);
            this.header_pos = this.header_lines.length;
            this.found_hb_sep = true;
            if (this.parse_body) this.ensure_body();
        } else if (this.header_pos === 0) {
            // Build up headers
            if (this.header_lines.length < this.cfg.headers.max_lines) {
                if (line[0] === 0x2e) line = line.slice(1); // Strip leading '.'
                this.header_lines.push(
                    line.toString(this.encoding).replace(/\r\n$/, '\n')
                );
            }
        } else if (this.header_pos && this.parse_body) {
            let new_line = line;
            if (new_line[0] === 0x2e) new_line = new_line.slice(1); // Strip leading "."

            line = this.add_dot_stuffing_and_ensure_crlf_newlines(
                this.body.parse_more(this.remove_final_cr(new_line))
            );

            if (!line.length) return; // buffering for banners
        }

        if (!this.discard_data) this.message_stream.add_line(line);
    }

    end_data(cb) {
        if (!this.found_hb_sep && this.header_lines.length) {
            // Headers not parsed yet - must be a busted email
            // Strategy: Find the first line that doesn't look like a header.
            // Treat anything before that as headers, anything after as body.
            let header_pos = 0;
            for (let i = 0; i < this.header_lines.length; i++) {
                // Anything that doesn't match a header or continuation
                if (
                    !/^(?:([^\s:]*):\s*([\s\S]*)$|[ \t])/.test(
                        this.header_lines[i]
                    )
                ) {
                    break;
                }
                header_pos = i;
            }
            const body_lines = this.header_lines.splice(header_pos + 1);
            this.header.parse(this.header_lines);
            this.header_pos = header_pos;
            if (this.parse_body) {
                this.ensure_body();
                for (let j = 0; j < body_lines.length; j++) {
                    this.body.parse_more(body_lines[j]);
                }
            }
        }
        if (this.header_pos && this.parse_body) {
            const line = this.add_dot_stuffing_and_ensure_crlf_newlines(
                this.body.parse_end()
            );
            if (line.length) {
                this.body.force_end();

                if (!this.discard_data) this.message_stream.add_line(line);
            }
        }

        if (this.discard_data) {
            cb();
        } else {
            this.message_stream.add_line_end(cb);
        }
    }

    add_header(key, value) {
        this.header.add_end(key, value);
        if (this.header_pos > 0) this.reset_headers();
    }

    add_leading_header(key, value) {
        this.header.add(key, value);
        if (this.header_pos > 0) this.reset_headers();
    }

    reset_headers() {
        const header_lines = this.header.lines();
        this.header_pos = header_lines.length;
    }

    remove_header(key) {
        this.header.remove(key);
        if (this.header_pos > 0) this.reset_headers();
    }

    attachment_hooks(start, data, end) {
        this.parse_body = true;
        this.attachment_start_hooks.push(start);
    }

    set_banner(text, html) {
        // throw "transaction.set_banner is currently non-functional";
        this.parse_body = true;
        if (!html) {
            html = text.replace(/\n/g, '<br/>\n');
        }
        this.banner = [text, html];
    }

    add_body_filter(ct_match, filter) {
        this.parse_body = true;
        this.body_filters.push({ ct_match, filter });
    }

    incr_mime_count(line) {
        this.mime_part_count++;
    }
}

exports.Transaction = Transaction;

exports.createTransaction = (uuid, cfg) => {
    return new Transaction(uuid, cfg);
};

// sunset after test-fixtures createTransaction() is updated to pass in cfg
function load_smtp_ini() {
    const config = require('haraka-config');
    const cfg = config.get('smtp.ini', { booleans: ['+headers.add_received'] });
    if (!cfg.headers.max_lines) {
        cfg.headers.max_lines =
            parseInt(config.get('max_header_lines')) || 1000;
    }
    return cfg;
}
