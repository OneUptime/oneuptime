'use strict';

const crypto = require('crypto');
const dns = require('dns');
const Stream = require('stream').Stream;
const utils = require('haraka-utils');
const util = require('util');

//////////////////////
// Common functions //
//////////////////////

function md5(str) {
    if (!str) str = '';
    const h = crypto.createHash('md5');
    return h.update(str).digest('hex');
}

class Buf {
    constructor() {
        this.bar = [];
        this.blen = 0;
    }

    pop(buf) {
        if (!this.bar.length) {
            if (!buf) buf = Buffer.from('');
            return buf;
        }
        if (buf && buf.length) {
            this.bar.push(buf);
            this.blen += buf.length;
        }
        const nb = Buffer.concat(this.bar, this.blen);
        this.bar = [];
        this.blen = 0;
        return nb;
    }

    push(buf) {
        if (buf.length) {
            this.bar.push(buf);
            this.blen += buf.length;
        }
    }
}

////////////////
// DKIMObject //
////////////////

// There is one DKIMObject created for each signature found

class DKIMObject {
    constructor(header, header_idx, cb, timeout) {
        this.cb = cb;
        this.sig = header;
        this.sig_md5 = md5(header);
        this.run_cb = false;
        this.header_idx = JSON.parse(JSON.stringify(header_idx));
        this.timeout = timeout;
        this.fields = {};
        this.headercanon = this.bodycanon = 'simple';
        this.signed_headers = [];
        this.identity = 'unknown';
        this.line_buffer = new Buf();
        this.dns_fields = {
            v: 'DKIM1',
            k: 'rsa',
            g: '*',
        };

        const [, , dkim_signature] = /^([^:]+):\s*((?:.|[\r\n])*)$/.exec(
            header
        );
        const sig = dkim_signature.trim().replace(/\s+/g, '');
        const keys = sig.split(';');
        for (let k = 0; k < keys.length; k++) {
            const key = keys[k].trim();
            if (!key) continue; // skip empty keys
            const [, key_name, key_value] =
                /^([^= ]+)=((?:.|[\r\n])+)$/.exec(key) || [];
            if (key_name) {
                this.fields[key_name] = key_value;
            } else {
                return this.result('header parse error', 'invalid');
            }
        }

        /////////////////////
        // Validate fields //
        /////////////////////

        if (this.fields.v) {
            if (this.fields.v !== '1') {
                return this.result('incompatible version', 'invalid');
            }
        } else {
            return this.result('missing version', 'invalid');
        }

        if (this.fields.a) {
            switch (this.fields.a) {
                case 'rsa-sha1':
                    this.bh = crypto.createHash('SHA1');
                    this.verifier = crypto.createVerify('RSA-SHA1');
                    break;
                case 'rsa-sha256':
                    this.bh = crypto.createHash('SHA256');
                    this.verifier = crypto.createVerify('RSA-SHA256');
                    break;
                default:
                    this.debug(`Invalid algorithm: ${this.fields.a}`);
                    return this.result('invalid algorithm', 'invalid');
            }
        } else {
            return this.result('missing algorithm', 'invalid');
        }

        if (!this.fields.b) return this.result('signature missing', 'invalid');
        if (!this.fields.bh) return this.result('body hash missing', 'invalid');

        if (this.fields.c) {
            const c = this.fields.c.split('/');
            if (c[0]) this.headercanon = c[0];
            if (c[1]) this.bodycanon = c[1];
        }

        if (!this.fields.d) return this.result('domain missing', 'invalid');

        if (this.fields.h) {
            const headers = this.fields.h.split(':');
            for (let h = 0; h < headers.length; h++) {
                this.signed_headers.push(headers[h].trim().toLowerCase());
            }
            if (!this.signed_headers.includes('from')) {
                return this.result('from field not signed', 'invalid');
            }
        } else {
            return this.result('signed headers missing', 'invalid');
        }

        if (this.fields.i) {
            // Make sure that this is a sub-domain of the 'd' field
            const dom = this.fields.i.substr(
                this.fields.i.length - this.fields.d.length
            );
            if (dom !== this.fields.d) {
                return this.result('domain mismatch', 'invalid');
            }
        } else {
            this.fields.i = `@${this.fields.d}`;
        }
        this.identity = this.fields.i;

        if (this.fields.q && this.fields.q !== 'dns/txt') {
            return this.result('unknown query method', 'invalid');
        }

        const now = new Date().getTime() / 1000;
        if (this.fields.t) {
            if (this.fields.t > now) {
                return this.result('bad creation date', 'invalid');
            }
        }

        if (this.fields.x) {
            if (
                this.fields.t &&
                parseInt(this.fields.x) < parseInt(this.fields.t)
            ) {
                return this.result('invalid expiration date', 'invalid');
            }
            if (now > this.fields.x) {
                return this.result('signature expired', 'invalid');
            }
        }

        this.debug(`${this.identity}: DKIM fields validated OK`);
        this.debug(
            `${this.identity}: a=${this.fields.a} c=${this.headercanon}/${this.bodycanon} h=${this.signed_headers}`
        );
    }

    debug(str) {
        util.debug(str);
    }

    header_canon_relaxed(header) {
        // || [] prevents errors thrown when no match
        const [, header_name, header_value] =
            /^([^:]+):\s*((?:.|[\r\n])*)$/.exec(header) || [];

        if (!header_name) return header;

        let hc = `${header_name.toLowerCase()}:${header_value}`;
        hc = hc.replace(/\r\n([\t ]+)/g, '$1');
        hc = hc.replace(/[\t ]+/g, ' ');
        hc = hc.replace(/[\t ]+(\r?\n)$/, '$1');
        return hc;
    }

    add_body_line(line) {
        if (this.run_cb) return;

        // Buffer any lines
        const isCRLF =
            line.length === 2 && line[0] === 0x0d && line[1] === 0x0a;
        const isLF = line.length === 1 && line[0] === 0x0a;
        if (isCRLF || isLF) {
            // Store any empty lines as both canonicalization alogoriths
            // ignore all empty lines at the end of the message body.
            this.line_buffer.push(line);
        } else {
            let l;
            if (this.bodycanon === 'simple') {
                l = this.line_buffer.pop(line);
                this.bh.update(l);
            } else if (this.bodycanon === 'relaxed') {
                l = this.line_buffer.pop(line).toString('utf-8');
                l = l.replace(/[\t ]+(\r?\n)$/, '$1');
                l = l.replace(/[\t ]+/g, ' ');
                l = this.line_buffer.pop(Buffer.from(l));
                this.bh.update(l);
            }
        }
    }

    result(error, result) {
        this.run_cb = true;
        return this.cb(error ? new Error(error) : null, {
            identity: this.identity,
            selector: this.fields.s,
            domain: this.fields.d,
            result,
        });
    }

    end() {
        if (this.run_cb) return;

        const bh = this.bh.digest('base64');
        this.debug(
            `${this.identity}: bodyhash=${this.fields.bh} computed=${bh}`
        );
        if (bh !== this.fields.bh) {
            return this.result('body hash did not verify', 'fail');
        }

        // Now we canonicalize the specified headers
        for (let h = 0; h < this.signed_headers.length; h++) {
            const header = this.signed_headers[h];
            this.debug(`${this.identity}: canonicalize header: ${header}`);
            if (this.header_idx[header]) {
                // RFC 6376 section 5.4.2, read headers from bottom to top
                const this_header = this.header_idx[header].pop();
                if (this_header) {
                    // Skip this signature if dkim-signature is specified
                    if (header === 'dkim-signature') {
                        const h_md5 = md5(this_header);
                        if (h_md5 === this.sig_md5) {
                            this.debug(
                                `${this.identity}: skipped our own DKIM-Signature`
                            );
                            continue;
                        }
                    }
                    if (this.headercanon === 'simple') {
                        this.verifier.update(this_header);
                    } else if (this.headercanon === 'relaxed') {
                        const hc = this.header_canon_relaxed(this_header);
                        this.verifier.update(hc);
                    }
                }
            }
        }

        // Now add in our original DKIM-Signature header without the b= and trailing CRLF
        let our_sig = this.sig.replace(/b=([^;]+)/, 'b=');
        if (this.headercanon === 'relaxed') {
            our_sig = this.header_canon_relaxed(our_sig);
        }
        our_sig = our_sig.replace(/\r\n$/, '');
        this.verifier.update(our_sig);

        // Do the DNS lookup to retrieve the public key
        const self = this;
        let timeout = false;
        const timer = setTimeout(() => {
            timeout = true;
            return self.result('DNS timeout', 'tempfail');
        }, this.timeout * 1000);
        const lookup = `${this.fields.s}._domainkey.${this.fields.d}`;
        this.debug(
            `${this.identity}: DNS lookup ${lookup} (timeout= ${this.timeout}s)`
        );
        dns.resolveTxt(lookup, (err, res) => {
            if (timeout) return;
            clearTimeout(timer);
            if (err) {
                switch (err.code) {
                    case dns.NOTFOUND:
                    case dns.NODATA:
                    case dns.NXDOMAIN:
                        return self.result('no key for signature', 'invalid');
                    default:
                        self.debug(
                            `${self.identity}: DNS lookup error: ${err.code}`
                        );
                        return self.result('key unavailable', 'tempfail');
                }
            }
            if (!res) return self.result('no key for signature', 'invalid');
            for (let r = 0; r < res.length; r++) {
                let record = res[r];
                // Node 0.11.x compatibility
                if (Array.isArray(record)) {
                    record = record.join('');
                }
                if (!record.includes('p=')) {
                    self.debug(
                        `${self.identity}: ignoring TXT record: ${record}`
                    );
                    continue;
                }
                self.debug(`${self.identity}: got DNS record: ${record}`);
                const rec = record.replace(/\r?\n/g, '').replace(/\s+/g, '');
                const split = rec.split(';');
                for (let j = 0; j < split.length; j++) {
                    const split2 = split[j].split('=');
                    if (split2[0]) self.dns_fields[split2[0]] = split2[1];
                }

                // Validate
                if (!self.dns_fields.v || self.dns_fields.v !== 'DKIM1') {
                    return self.result('invalid version', 'invalid');
                }
                if (self.dns_fields.g) {
                    if (self.dns_fields.g !== '*') {
                        let s = self.dns_fields.g;
                        // Escape any special regexp characters
                        s = s.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
                        // Make * a non-greedy match against anything except @
                        s = s.replace('\\*', '[^@]*?');
                        const reg = new RegExp(`^${s}@`);
                        self.debug(
                            `${self.identity}: matching ${
                                self.dns_fields.g
                            } against i=${
                                self.fields.i
                            } regexp=${reg.toString()}`
                        );
                        if (!reg.test(self.fields.i)) {
                            return self.result('inapplicable key', 'invalid');
                        }
                    }
                } else {
                    return self.result('inapplicable key', 'invalid');
                }
                if (self.dns_fields.h) {
                    const hashes = self.dns_fields.h.split(':');
                    for (let k = 0; k < hashes.length; k++) {
                        const hash = hashes[k].trim();
                        if (!self.fields.a.includes(hash)) {
                            return self.result(
                                'inappropriate hash algorithm',
                                'invalid'
                            );
                        }
                    }
                }
                if (self.dns_fields.k) {
                    if (!self.fields.a.includes(self.dns_fields.k)) {
                        return self.result('inappropriate key type', 'invalid');
                    }
                }
                if (self.dns_fields.t) {
                    const flags = self.dns_fields.t.split(':');
                    for (let f = 0; f < flags.length; f++) {
                        const flag = flags[f].trim();
                        if (flag === 'y') {
                            // Test mode
                            self.test_mode = true;
                        } else if (flag === 's') {
                            // 'i' and 'd' domain much match exactly
                            let j = self.fields.i;
                            j = j.substr(j.indexOf('@') + 1, j.length);
                            if (j !== self.fields.d) {
                                return self.result(
                                    'domain mismatch',
                                    'invalid'
                                );
                            }
                        }
                    }
                }
                if (!self.dns_fields.p)
                    return self.result('key revoked', 'invalid');

                // crypto.verifier requires the key in PEM format
                self.public_key = `-----BEGIN PUBLIC KEY-----\r\n${self.dns_fields.p.replace(
                    /(.{1,76})/g,
                    '$1\r\n'
                )}-----END PUBLIC KEY-----\r\n`;

                let verified;
                try {
                    verified = self.verifier.verify(
                        self.public_key,
                        self.fields.b,
                        'base64'
                    );
                    self.debug(`${self.identity}: verified=${verified}`);
                } catch (e) {
                    self.debug(
                        `${self.identity}: verification error: ${e.message}`
                    );
                    return self.result('verification error', 'invalid');
                }
                return self.result(null, verified ? 'pass' : 'fail');
            }
            // We didn't find a valid DKIM record for this signature
            return self.result('no key for signature', 'invalid');
        });
    }
}

exports.DKIMObject = DKIMObject;

//////////////////////
// DKIMVerifyStream //
//////////////////////

class DKIMVerifyStream extends Stream {
    constructor(cb, timeout) {
        super();
        this.run_cb = false;
        this.cb = (err, result, results) => {
            if (!this.run_cb) {
                this.run_cb = true;
                return cb(err, result, results);
            }
        };
        this._in_body = false;
        this._no_signatures_found = false;
        this.buffer = new Buf();
        this.headers = [];
        this.header_idx = {};
        this.dkim_objects = [];
        this.results = [];
        this.result = 'none';
        this.pending = 0;
        this.writable = true;
        this.timeout = timeout || 30;
    }

    debug(str) {
        util.debug(str);
    }

    handle_buf(buf) {
        const self = this;
        // Abort any further processing if the headers
        // did not contain any DKIM-Signature fields.
        if (this._in_body && this._no_signatures_found) {
            return true;
        }
        let once = false;
        if (buf === null) {
            once = true;
            buf = this.buffer.pop();
            if (
                !!buf &&
                buf[buf.length - 2] === 0x0d &&
                buf[buf.length - 1] === 0x0a
            ) {
                return true;
            }
            buf = Buffer.concat([buf, new Buffer('\r\n\r\n')]);
        } else {
            buf = this.buffer.pop(buf);
        }

        function callback(err, result) {
            self.pending--;
            if (result) {
                self.results.push({
                    identity: result.identity,
                    domain: result.domain,
                    selector: result.selector,
                    result: result.result,
                    error: err ? err.message : null,
                });

                // Set the overall result based on this precedence order
                const rr = ['pass', 'tempfail', 'fail', 'invalid', 'none'];
                for (let r = 0; r < rr.length; r++) {
                    if (
                        !self.result ||
                        (self.result &&
                            self.result !== rr[r] &&
                            result.result === rr[r])
                    ) {
                        self.result = rr[r];
                    }
                }
            }

            self.debug(JSON.stringify(result));

            if (self.pending === 0 && self.cb) {
                return process.nextTick(() => {
                    self.cb(null, self.result, self.results);
                });
            }
        }

        // Process input buffer into lines
        let offset = 0;
        while ((offset = utils.indexOfLF(buf)) !== -1) {
            let line = buf.slice(0, offset + 1);
            if (buf.length > offset) {
                buf = buf.slice(offset + 1);
            }

            // Check for LF line endings and convert to CRLF if necessary
            if (line[line.length - 2] !== 0x0d) {
                line = Buffer.concat(
                    [line.slice(0, line.length - 1), Buffer.from('\r\n')],
                    line.length + 1
                );
            }

            // Look for CRLF
            if (line.length === 2 && line[0] === 0x0d && line[1] === 0x0a) {
                // Look for end of headers marker
                if (!this._in_body) {
                    this._in_body = true;
                    // Parse the headers
                    for (let h = 0; h < this.headers.length; h++) {
                        const match = /^([^: ]+):\s*((:?.|[\r\n])*)/.exec(
                            this.headers[h]
                        );
                        if (!match) continue;
                        const header_name = match[1];
                        if (!header_name) continue;
                        const hn = header_name.toLowerCase();
                        if (!this.header_idx[hn]) this.header_idx[hn] = [];
                        this.header_idx[hn].push(this.headers[h]);
                    }
                    if (!this.header_idx['dkim-signature']) {
                        this._no_signatures_found = true;
                        return process.nextTick(() => {
                            self.cb(null, self.result, self.results);
                        });
                    } else {
                        // Create new DKIM objects for each header
                        const dkim_headers = this.header_idx['dkim-signature'];
                        this.debug(
                            `Found ${dkim_headers.length} DKIM signatures`
                        );
                        this.pending = dkim_headers.length;
                        for (let d = 0; d < dkim_headers.length; d++) {
                            this.dkim_objects.push(
                                new DKIMObject(
                                    dkim_headers[d],
                                    this.header_idx,
                                    callback,
                                    this.timeout
                                )
                            );
                        }
                        if (this.pending === 0) {
                            process.nextTick(() => {
                                if (self.cb)
                                    self.cb(new Error('no signatures found'));
                            });
                        }
                    }
                    continue; // while()
                }
            }

            if (!this._in_body) {
                // Parse headers
                if (line[0] === 0x20 || line[0] === 0x09) {
                    // Header continuation
                    this.headers[this.headers.length - 1] += line.toString(
                        'utf-8'
                    );
                } else {
                    this.headers.push(line.toString('utf-8'));
                }
            } else {
                for (let e = 0; e < this.dkim_objects.length; e++) {
                    this.dkim_objects[e].add_body_line(line);
                }
            }
            if (once) {
                break;
            }
        }

        this.buffer.push(buf);
        return true;
    }

    write(buf) {
        return this.handle_buf(buf);
    }

    end(buf) {
        this.handle_buf(buf ? buf : null);
        for (let d = 0; d < this.dkim_objects.length; d++) {
            this.dkim_objects[d].end();
        }
        if (this.pending === 0 && this._no_signatures_found === false) {
            const self = this;
            process.nextTick(() => {
                self.cb(null, self.result, self.results);
            });
        }
    }
}

exports.DKIMVerifyStream = DKIMVerifyStream;
