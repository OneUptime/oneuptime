'use strict';
// An RFC 2822 email header parser
/* eslint no-control-regex: 0 */

const logger = require('./logger');
const utils = require('haraka-utils');
let Iconv;
try {
    Iconv = require('iconv').Iconv;
} catch (err) {
    logger.logdebug("No iconv available - install with 'npm install iconv'");
}

class Header {
    constructor(options) {
        this.headers = {};
        this.headers_decoded = {};
        this.header_list = [];
        this.options = options;
    }

    parse(lines) {
        const self = this;

        for (const line of lines) {
            if (/^[ \t]/.test(line)) {
                // continuation
                this.header_list[this.header_list.length - 1] += line;
            } else {
                this.header_list.push(line);
            }
        }

        for (const header of this.header_list) {
            const match = header.match(/^([^\s:]*):\s*([\s\S]*)$/);
            if (match) {
                const key = match[1].toLowerCase();
                const val = match[2];

                this._add_header(key, val, 'push');
            } else {
                logger.lognotice(`Header did not look right: ${header}`);
            }
        }

        // Now add decoded versions
        Object.keys(this.headers).forEach(key2 => {
            self.headers[key2].forEach(val2 => {
                self._add_header_decode(key2, val2, 'push');
            });
        });
    }

    decode_header(val) {
        // Fold continuations
        val = val.replace(/\r?\n/g, '');

        const rfc2231_params = {
            kv: {},
            keys: {},
            cur_key: '',
            cur_enc: '',
            cur_lang: '', // Secondary languages are ignored for our purposes
        };

        val = _decode_rfc2231(rfc2231_params, val);

        // console.log(rfc2231_params);

        // strip 822 comments in the most basic way - does not support nested comments
        // val = val.replace(/\([^\)]*\)/, '');

        if (Iconv && !/^[\x00-\x7f]*$/.test(val)) {
            // 8 bit values in the header
            const matches = /\bcharset\s*=\s*["']?([\w_-]*)/.exec(
                this.get('content-type')
            );
            if (matches && !/UTF-?8/i.test(matches[1])) {
                const encoding = matches[1];
                const source = Buffer.from(val, 'binary');
                val = try_convert(source, encoding).toString();
            }
        }

        if (!/=\?/.test(val)) {
            // no encoded stuff
            return val;
        }

        return (
            val
                // strip whitespace between encoded-words, rfc 2047 6.2
                .replace(/(=\?.+?\?=)\s+(?==\?.+?\?=)/g, '$1')
                // decode each encoded match
                .replace(
                    /=\?([\w_-]+)(\*[\w_-]+)?\?([bqBQ])\?([\s\S]*?)\?=/g,
                    _decode_header
                )
        );
    }

    get(key) {
        return (this.headers[key.toLowerCase()] || []).join('\n');
    }

    get_all(key) {
        return Object.freeze([...(this.headers[key.toLowerCase()] || [])]);
    }

    get_decoded(key) {
        return (this.headers_decoded[key.toLowerCase()] || []).join('\n');
    }

    remove(key) {
        key = key.toLowerCase();
        delete this.headers[key];
        delete this.headers_decoded[key];

        this._remove_more(key);
    }

    _remove_more(key) {
        const key_len = key.length;
        for (let i = 0, l = this.header_list.length; i < l; i++) {
            if (
                this.header_list[i].substring(0, key_len + 1).toLowerCase() ===
                `${key}:`
            ) {
                this.header_list.splice(i, 1);
                return this._remove_more(key);
            }
        }
    }

    add(key, value) {
        if (!key) key = 'X-Haraka-Blank';
        value = value.replace(/(\r?\n)*$/, '');
        if (/[^\x00-\x7f]/.test(value)) {
            // Need to QP encode this header value and assume UTF-8
            value = `=?UTF-8?q?${utils.encode_qp(value)}?=`;
            value = value.replace(/=\n/g, ''); // remove wraps - headers can only wrap at whitespace (with continuations)
        }
        this._add_header(key.toLowerCase(), value, 'unshift');
        this._add_header_decode(key.toLowerCase(), value, 'unshift');
        this.header_list.unshift(`${key}: ${value}\n`);
    }

    _add_header(key, value, method) {
        this.headers[key] = this.headers[key] || [];
        this.headers[key][method](value);
    }

    _add_header_decode(key, value, method) {
        const val = this.decode_header(value);
        // console.log(key + ': ' + val);
        this.headers_decoded[key] = this.headers_decoded[key] || [];
        this.headers_decoded[key][method](val);
    }

    add_end(key, value) {
        if (!key) key = 'X-Haraka-Blank';
        value = value.replace(/(\r?\n)*$/, '');
        if (/[^\x00-\x7f]/.test(value)) {
            // Need to QP encode this header value and assume UTF-8
            value = `=?UTF-8?q?${utils.encode_qp(value)}?=`;
            // remove wraps - headers can only wrap at whitespace (with continuations)
            value = value.replace(/=\n/g, '');
        }
        this._add_header(key.toLowerCase(), value, 'push');
        this._add_header_decode(key.toLowerCase(), value, 'push');
        this.header_list.push(`${key}: ${value}\n`);
    }

    lines() {
        return Object.freeze([...this.header_list]);
    }

    toString() {
        return this.header_list.join('\n');
    }
}

exports.Header = Header;
exports.Iconv = Iconv;

function try_convert(data, encoding) {
    try {
        const converter = new Iconv(encoding, 'UTF-8');
        data = converter.convert(data);
    } catch (err) {
        // TODO: raise a flag for this for possible scoring
        logger.logwarn(
            `initial iconv conversion from ${encoding} to UTF-8 failed: ${err.message}`
        );
        if (err.code !== 'EINVAL') {
            try {
                const converter = new Iconv(
                    encoding,
                    'UTF-8//TRANSLIT//IGNORE'
                );
                data = converter.convert(data);
            } catch (e) {
                logger.logerror(
                    `iconv from ${encoding} to UTF-8 failed: ${e.message}`
                );
            }
        }
    }

    return data;
}

function _decode_header(matched, encoding, lang, cte, data) {
    cte = cte.toUpperCase();

    switch (cte) {
        case 'Q':
            data = utils.decode_qp(data.replace(/_/g, ' '));
            break;
        case 'B':
            data = Buffer.from(data, 'base64');
            break;
        default:
            logger.logerror(`Invalid header encoding type: ${cte}`);
    }

    // convert with iconv if encoding != UTF-8
    if (Iconv && !/UTF-?8/i.test(encoding)) {
        data = try_convert(data, encoding);
    }

    return data.toString();
}

function _decode_rfc2231(params, str) {
    _parse_rfc2231(params, str);

    for (const key in params.keys) {
        str += ` ${key}="`;
        /* eslint no-constant-condition: 0 */
        let merged = '';
        for (let i = 0; true; i++) {
            const _key = `${key}*${i}`;
            const _val = params.kv[_key];
            if (_val === undefined) break;
            merged += _val;
        }

        try {
            merged = decodeURIComponent(merged);
        } catch (e) {
            logger.logerror(`Decode header failed: ${key}: ${merged}`);
        }
        merged = params.cur_enc ? try_convert(merged, params.cur_enc) : merged;

        str += `${merged}";`;
    }

    return str;
}

function _parse_rfc2231(params, str) {
    /*
    To explain the regexp below, the params are:

    parameter := attribute "=" value

    attribute := token
                 ; Matching of attributes
                 ; is ALWAYS case-insensitive.

    token := 1*<any (US-ASCII) CHAR except SPACE, CTLs,
                or tspecials>

    tspecials :=  "(" / ")" / "<" / ">" / "@" /
                  "," / ";" / ":" / "\" / <">
                  "/" / "[" / "]" / "?" / "="
                  ; Must be in quoted-string,
                  ; to use within parameter values
    */
    const sub_matches = /(([!#$%&'*+.0-9A-Zdiff^_`a-z{|}~-]*)\*)(\d*)=(\s*".*?[^\\]";?|\S*)/.exec(
        str
    );
    if (!sub_matches) {
        return;
    }
    const key = sub_matches[1];
    let key_actual = sub_matches[2];
    let key_id = sub_matches[3] || '0';
    let value = sub_matches[4].replace(/;$/, '');

    str = str.replace(sub_matches[0], ''); // strip it out, so we move to next

    const key_extract = /^(.*?)(\*(\d+)\*)$/.exec(key);
    if (key_extract) {
        key_actual = key_extract[1];
        key_id = key_extract[3];
    }

    const quote = /^\s*"(.*)"$/.exec(value);
    if (quote) {
        value = quote[1];
    }

    const lang_match = /^(.*?)'(.*?)'(.*)/.exec(value);
    if (lang_match) {
        if (key_actual == params.cur_key && lang_match[2] != params.cur_lang) {
            return _parse_rfc2231(params, str); // same key, different lang, throw it away
        }
        params.cur_enc = lang_match[1];
        params.cur_lang = lang_match[2];
        value = lang_match[3];
    } else if (key_actual != params.cur_key) {
        params.cur_lang = '';
        params.cur_enc = '';
    }

    params.cur_key = key_actual;
    params.keys[key_actual] = '';
    params.kv[`${key_actual}*${key_id}`] = value;
    return _parse_rfc2231(params, str); // Get next one
}
