'use strict';

const events = require('events');
const config = require('haraka-config');
const utils = require('haraka-utils');

// Mail Body Parser
const logger = require('./logger');
const Header = require('./mailheader').Header;
const Iconv = require('./mailheader').Iconv;
const attstr = require('./attachment_stream');

const buf_siz = config.get('mailparser.bufsize') || 65536;

class Body extends events.EventEmitter {
    constructor(header, options) {
        super();
        this.header = header || new Header();
        this.header_lines = [];
        this.is_html = false;
        this.options = options || {};
        this.filters = [];
        this.bodytext = '';

        // Caution: slice before using!  We build up data in this buffer, and
        // it always has extra space at the end.  Use
        // this.body_text_encoded.slice(0, this.body_text_encoded_pos).
        this.body_text_encoded = Buffer.alloc(buf_siz);
        this.body_text_encoded_pos = 0;

        this.body_encoding = null;
        this.boundary = null;
        this.ct = null;
        this.decode_function = null;
        this.children = []; // if multipart
        this.state = 'start';
        this.buf = Buffer.alloc(buf_siz);
        this.buf_fill = 0;
        this.decode_accumulator = '';
        this.decode_qp = line => utils.decode_qp(line.toString());
        this.decode_7bit = this.decode_8bit;
    }

    add_filter(filter) {
        this.filters.push(filter);
    }

    set_banner(banners) {
        this.add_filter((ct, enc, buf) => insert_banner(ct, enc, buf, banners));
    }

    parse_more(line) {
        // Ensure we're working in buffers, for the tests (transaction should
        // always pass buffers).
        if (!Buffer.isBuffer(line)) line = Buffer.from(line);

        return this[`parse_${this.state}`](line);
    }

    parse_child(line) {
        const line_string = line.toString();

        // check for MIME boundary
        if (
            line_string.substr(0, this.boundary.length + 2) ===
            `--${this.boundary}`
        ) {
            line = this.children[this.children.length - 1].parse_end(line);

            if (line_string.substr(this.boundary.length + 2, 2) === '--') {
                // end
                this.state = 'end';
            } else {
                this.emit('mime_boundary', line_string);
                const bod = new Body(new Header(), this.options);
                this.listeners('attachment_start').forEach(cb => {
                    bod.on('attachment_start', cb);
                });
                this.listeners('attachment_data').forEach(cb => {
                    bod.on('attachment_data', cb);
                });
                this.listeners('attachment_end').forEach(cb => {
                    bod.on('attachment_end', cb);
                });
                this.listeners('mime_boundary').forEach(cb =>
                    bod.on('mime_boundary', cb)
                );
                this.filters.forEach(f => {
                    bod.add_filter(f);
                });
                this.children.push(bod);
                bod.state = 'headers';
            }
            return line;
        }
        // Pass data into last child
        return this.children[this.children.length - 1].parse_more(line);
    }

    parse_headers(line) {
        const line_string = line.toString();

        if (/^\s*$/.test(line_string)) {
            // end of headers
            this.header.parse(this.header_lines);
            delete this.header_lines;
            this.state = 'start';
        } else {
            this.header_lines.push(line_string);
        }
        return line;
    }

    parse_start(line) {
        const ct = this.header.get_decoded('content-type') || 'text/plain';
        let enc =
            this.header.get_decoded('content-transfer-encoding') || '8bit';
        const cd = this.header.get_decoded('content-disposition') || '';

        if (/text\/html/i.test(ct)) {
            this.is_html = true;
        }

        enc = enc
            .toLowerCase()
            .split('\n')
            .pop()
            .trim();
        if (!enc.match(/^base64|quoted-printable|[78]bit$/i)) {
            logger.logwarn(`Invalid CTE on email: ${enc}, using 8bit`);
            enc = '8bit';
        }
        enc = enc.replace(/^quoted-printable$/i, 'qp');

        this.decode_function = this[`decode_${enc}`];
        if (!this.decode_function) {
            logger.logerror(`No decode function found for: ${enc}`);
            this.decode_function = this.decode_8bit;
        }
        this.ct = ct;

        let match;
        if (/^(?:text|message)\//i.test(ct) && !/^attachment/i.test(cd)) {
            this.state = 'body';
        } else if (/^multipart\//i.test(ct)) {
            match = ct.match(/boundary\s*=\s*"?([^";]+)"?/i);
            this.boundary = match ? match[1] : '';
            this.state = 'multipart_preamble';
        } else {
            match = cd.match(/name\s*=\s*"?([^";]+)"?/i);
            if (!match) {
                match = ct.match(/name\s*=\s*"?([^";]+)"?/i);
            }
            const filename = match ? match[1] : '';
            this.attachment_stream = attstr.createStream(this.header);
            this.emit(
                'attachment_start',
                ct,
                filename,
                this,
                this.attachment_stream
            );
            this.buf_fill = 0;
            this.state = 'attachment';
        }

        return this[`parse_${this.state}`](line);
    }

    _empty_filter(ct, enc) {
        let new_buf = Buffer.from('');
        this.filters.forEach(filter => {
            new_buf = filter(ct, enc, new_buf) || new_buf;
        });

        return new_buf;
    }

    force_end() {
        if (this.state === 'attachment') {
            if (this.buf_fill > 0) {
                // see below for why we create a new buffer here.
                const to_emit = Buffer.alloc(this.buf_fill);
                this.buf.copy(to_emit, 0, 0, this.buf_fill);
                this.attachment_stream.emit_data(to_emit);
                this.buf_fill = 0;
            }
            this.attachment_stream.emit_end(true);
        }
    }

    parse_end(line) {
        if (!line) {
            line = Buffer.from('');
        }

        if (this.state === 'attachment') {
            if (this.buf_fill > 0) {
                // see below for why we create a new buffer here.
                const to_emit = Buffer.alloc(this.buf_fill);
                this.buf.copy(to_emit, 0, 0, this.buf_fill);
                this.attachment_stream.emit_data(to_emit);
                this.buf_fill = 0;
            }
            this.attachment_stream.emit_end();
        }

        const ct = this.header.get_decoded('content-type') || 'text/plain';
        let enc = 'UTF-8';
        let pre_enc = '';
        const matches = /\bcharset\s*=\s*(?:"|3D|')?([\w_-]*)(?:"|3D|')?/.exec(
            ct
        );
        if (matches) {
            pre_enc = matches[1].trim();
            if (pre_enc.length > 0) {
                enc = pre_enc;
            }
        }
        this.body_encoding = enc;

        if (!this.body_text_encoded_pos) {
            // nothing to decode
            return Buffer.concat([
                this._empty_filter(ct, enc) || Buffer.from(''),
                line,
            ]);
        }
        if (this.bodytext.length !== 0) return line; // already decoded?

        let buf = this.decode_function(
            this.body_text_encoded.slice(0, this.body_text_encoded_pos)
        );

        if (this.filters.length) {
            // up until this point we've returned '' for line, so now we run
            // the filters and return the whole lot as one line, re-encoded using
            // whatever encoding scheme we used to decode it.

            let new_buf = buf;
            this.filters.forEach(filter => {
                new_buf = filter(ct, enc, new_buf) || new_buf;
            });

            // convert back to base_64 or QP if required:
            if (this.decode_function === this.decode_qp) {
                line = Buffer.from(`${utils.encode_qp(new_buf)}\n${line}`);
            } else if (this.decode_function === this.decode_base64) {
                line = Buffer.from(
                    new_buf.toString('base64').replace(/(.{1,76})/g, '$1\n') +
                        line
                );
            } else {
                line = Buffer.concat([new_buf, line]);
            }

            buf = new_buf;
        }

        // convert the buffer to UTF-8, stored in this.bodytext
        this.try_iconv(buf, enc);

        // delete this.body_text_encoded;
        return line;
    }

    try_iconv(buf, enc) {
        if (!Iconv) {
            this.body_encoding = 'no_iconv';
            this.bodytext = buf.toString();
            return;
        }

        if (/UTF-?8/i.test(enc)) {
            this.bodytext = buf.toString();
            return;
        }

        try {
            const converter = new Iconv(enc, 'UTF-8');
            this.bodytext = converter.convert(buf).toString();
        } catch (err) {
            logger.logwarn(
                `initial iconv conversion from ${enc} to UTF-8 failed: ${err.message}`
            );
            this.body_encoding = `broken//${enc}`;
            // EINVAL is returned when the encoding type is not recognized/supported (e.g. ANSI_X3)
            if (err.code !== 'EINVAL') {
                // Perform the conversion again, but ignore any errors
                try {
                    const converter = new Iconv(enc, 'UTF-8//TRANSLIT//IGNORE');
                    this.bodytext = converter.convert(buf).toString();
                } catch (e) {
                    logger.logwarn(
                        `iconv conversion from ${enc} to UTF-8 failed: ${e.message}`
                    );
                    this.bodytext = buf.toString();
                }
            }
        }
    }

    parse_body(line) {
        if (!Buffer.isBuffer(line)) line = Buffer.from(line);

        // Grow the body_text_encoded buffer if we need more space.  Doing this
        // instead of constant Buffer.concat()s means we allocate/copy way less
        // often.
        if (
            this.body_text_encoded_pos + line.length >
            this.body_text_encoded.length
        ) {
            let new_size = this.body_text_encoded.length * 2;
            while (this.body_text_encoded_pos + line.length > new_size)
                new_size *= 2;

            this.body_text_encoded = Buffer.alloc(
                new_size,
                this.body_text_encoded.slice(0, this.body_text_encoded_pos)
            );
        }

        line.copy(this.body_text_encoded, this.body_text_encoded_pos);
        this.body_text_encoded_pos += line.length;

        if (this.filters.length) return '';
        return line;
    }

    parse_multipart_preamble(line) {
        if (!this.boundary) return line;
        const line_string = line.toString();

        if (
            line_string.substr(0, this.boundary.length + 2) ===
            `--${this.boundary}`
        ) {
            if (line_string.substr(this.boundary.length + 2, 2) === '--') {
                // end
            } else {
                // next section
                this.emit('mime_boundary', line_string);
                const bod = new Body(new Header(), this.options);
                this.listeners('attachment_start').forEach(cb => {
                    bod.on('attachment_start', cb);
                });
                this.listeners('mime_boundary').forEach(cb =>
                    bod.on('mime_boundary', cb)
                );
                this.filters.forEach(f => {
                    bod.add_filter(f);
                });
                this.children.push(bod);
                bod.state = 'headers';
                this.state = 'child';
            }
            return line;
        }

        return line;
    }

    parse_attachment(line) {
        const line_string = line.toString();

        if (this.boundary) {
            if (
                line_string.substr(0, this.boundary.length + 2) ===
                `--${this.boundary}`
            ) {
                if (line_string.substr(this.boundary.length + 2, 2) === '--') {
                    // end
                } else {
                    // next section
                    this.state = 'headers';
                }
                return line;
            }
        }

        const buf = this.decode_function(line);
        if (buf.length + this.buf_fill > buf_siz) {
            // now we have to create a new buffer, because if we write this out
            // using async code, it will get overwritten under us. Creating a new
            // buffer eliminates that problem (at the expense of a malloc and a
            // memcpy())
            const to_emit = Buffer.alloc(this.buf_fill);
            this.buf.copy(to_emit, 0, 0, this.buf_fill);
            this.attachment_stream.emit_data(to_emit);
            if (buf.length > buf_siz) {
                // this is an unusual case - the base64/whatever data is larger
                // than our buffer size, so we just emit it and reset the counter.
                this.attachment_stream.emit_data(buf);
                this.buf_fill = 0;
            } else {
                buf.copy(this.buf);
                this.buf_fill = buf.length;
            }
        } else {
            buf.copy(this.buf, this.buf_fill);
            this.buf_fill += buf.length;
        }
        return line;
    }

    decode_base64(line) {
        // Remove all whitespace (such as newlines and errant spaces) from base64
        // before combining it with any previously unprocessed data.
        let to_process =
            this.decode_accumulator +
            line
                .toString()
                .trim()
                .replace(/[\s]+/g, '');

        // Sometimes base64 data lines will not be aligned with
        // byte boundaries. This is because each char in base64
        // represents 6 bits. 24 is the LCM between 6 and 8 bits.
        // (i.e. 4 * 6-bit chars === 3 * bytes)

        // As a result, 24 bits is our word boundary for base64.
        // Failure to align here will result in truncated/incorrect
        // node Buffers later on.

        // Walk back from the toProcess.length to the first
        // position that aligns with a 24-bit boundary.
        const emit_length = to_process.length - (to_process.length % 4);

        if (emit_length > 0) {
            const emit_now = to_process.substring(0, emit_length);
            this.decode_accumulator = to_process.substring(emit_length);
            return Buffer.from(emit_now, 'base64');
        } else {
            this.decode_accumulator = '';
            // This is the end of the base64 data, we don't really have enough bits
            // to fill up the bytes, but that's because we're on the last line, and ==
            // might have been elided.

            // In order to prevent any weird boundary issues, we'll re-pad
            // the string if there's any data left. As above, our target
            // is a 24-bit boundary, pad to 4 characters.
            while (to_process.length > 0 && to_process.length < 4) {
                to_process += '=';
            }
            return Buffer.from(to_process, 'base64');
        }
    }

    decode_8bit(line) {
        return Buffer.from(line, 'binary');
    }
}

exports.Body = Body;

function _get_html_insert_position(buf) {
    // otherwise, if we return -1 then the buf.copy will die with
    // RangeError: out of range index
    if (buf.length === 0) return 0;

    // TODO: consider re-writing this to go backwards from the end
    for (let i = 0, l = buf.length; i < l; i++) {
        if (buf[i] === 60 && buf[i + 1] === 47) {
            // found: "</"
            if (
                (buf[i + 2] === 98 || buf[i + 2] === 66) && // "b" or "B"
                (buf[i + 3] === 111 || buf[i + 3] === 79) && // "o" or "O"
                (buf[i + 4] === 100 || buf[i + 4] === 68) && // "d" or "D"
                (buf[i + 5] === 121 || buf[i + 5] === 89) && // "y" or "Y"
                buf[i + 6] === 62
            ) {
                // matched </body>
                return i;
            }
            if (
                (buf[i + 2] === 104 || buf[i + 2] === 72) && // "h" or "H"
                (buf[i + 3] === 116 || buf[i + 3] === 84) && // "t" or "T"
                (buf[i + 4] === 109 || buf[i + 4] === 77) && // "m" or "M"
                (buf[i + 5] === 108 || buf[i + 5] === 76) && // "l" or "L"
                buf[i + 6] === 62
            ) {
                // matched </html>
                return i;
            }
        }
    }
    return buf.length - 1; // default is at the end
}

function insert_banner(ct, enc, buf, banners) {
    if (!banners || !/^text\//i.test(ct)) {
        return;
    }
    const is_html = /text\/html/i.test(ct);

    // First we convert the banner to the same encoding as the buf
    const banner_str = banners[is_html ? 1 : 0];
    let banner_buf = null;
    if (Iconv) {
        try {
            const converter = new Iconv('UTF-8', `${enc}//IGNORE`);
            banner_buf = converter.convert(banner_str);
        } catch (err) {
            logger.logerror(
                `iconv conversion of banner to ${enc} failed: ${err}`
            );
        }
    }

    if (!banner_buf) {
        banner_buf = Buffer.from(banner_str);
    }

    // Allocate a new buffer: (7 or 2 is <P>...</P> vs \n...\n - correct that if you change those!)
    const new_buf = Buffer.alloc(
        buf.length + banner_buf.length + (is_html ? 7 : 2)
    );

    // Now we find where to insert it and combine it with the original buf:
    if (is_html) {
        let insert_pos = _get_html_insert_position(buf);

        // copy start of buf into new_buf
        buf.copy(new_buf, 0, 0, insert_pos);

        // add in <P>
        new_buf[insert_pos++] = 60;
        new_buf[insert_pos++] = 80;
        new_buf[insert_pos++] = 62;

        // copy all of banner into new_buf
        banner_buf.copy(new_buf, insert_pos);

        // add in </P>
        new_buf[banner_buf.length + insert_pos++] = 60;
        new_buf[banner_buf.length + insert_pos++] = 47;
        new_buf[banner_buf.length + insert_pos++] = 80;
        new_buf[banner_buf.length + insert_pos++] = 62;

        // copy remainder of buf into new_buf, if there is buf remaining
        if (buf.length > insert_pos - 7) {
            buf.copy(new_buf, insert_pos + banner_buf.length, insert_pos - 7);
        }
    } else {
        buf.copy(new_buf);
        new_buf[buf.length] = 10; // \n
        banner_buf.copy(new_buf, buf.length + 1);
        new_buf[buf.length + banner_buf.length + 1] = 10; // \n
    }

    return new_buf;
}
