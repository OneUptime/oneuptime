'use strict';
// RFC 1869 command parser

// 6.  MAIL FROM and RCPT TO Parameters
// [...]
//
//   esmtp-cmd        ::= inner-esmtp-cmd [SP esmtp-parameters] CR LF
//   esmtp-parameters ::= esmtp-parameter *(SP esmtp-parameter)
//   esmtp-parameter  ::= esmtp-keyword ["=" esmtp-value]
//   esmtp-keyword    ::= (ALPHA / DIGIT) *(ALPHA / DIGIT / "-")
//
//                        ; syntax and values depend on esmtp-keyword
//   esmtp-value      ::= 1*<any CHAR excluding "=", SP, and all
//                           control characters (US ASCII 0-31
//                           inclusive)>
//
//                        ; The following commands are extended to
//                        ; accept extended parameters.
//   inner-esmtp-cmd  ::= ("MAIL FROM:" reverse-path)   /
//                        ("RCPT TO:" forward-path)

/* eslint no-control-regex: 0 */
const chew_regexp = /\s+([A-Za-z0-9][A-Za-z0-9-]*(?:=[^= \x00-\x1f]+)?)$/;

exports.parse = (type, line, strict) => {
    let params = [];
    line = new String(line).replace(/\s*$/, '');
    if (type === 'mail') {
        line = line.replace(strict ? /from:/i : /from:\s*/i, '');
    } else {
        line = line.replace(strict ? /to:/i : /to:\s*/i, '');
    }

    // eslint-disable-next-line no-constant-condition
    while (1) {
        const old_length = line.length;
        // eslint-disable-next-line no-loop-func
        line = line.replace(chew_regexp, function repl(str, p1) {
            params.push(p1);
            return '';
        });
        if (old_length === line.length) break;
    }

    params = params.reverse();

    // the above will "fail" (i.e. all of the line in params) on
    // some addresses without <> like
    //    MAIL FROM: user=name@example.net
    // or RCPT TO: postmaster

    // let's see if $line contains nothing and use the first value as address:
    if (line.length) {
        // parameter syntax error, i.e. not all of the arguments were
        // stripped by the while() loop:
        if (line.match(/@.*\s/)) {
            throw new Error(`Syntax error in parameters ("${line}")`);
        }

        params.unshift(line);
    }

    line = params.shift() || '';
    if (strict) {
        if (!line.match(/^<.*>$/)) {
            throw new Error(`Invalid format of ${type} command: ${line}`);
        }
    }

    if (type === 'mail') {
        if (!line.length) {
            return ['<>']; // 'MAIL FROM:' --> 'MAIL FROM:<>'
        }
        if (line.match(/@.*\s/)) {
            throw new Error('Syntax error in parameters');
        }
    } else {
        // console.log(`Looking at ${line}``);
        if (line.match(/@.*\s/)) {
            throw new Error('Syntax error in parameters');
        } else {
            if (line.match(/\s/)) {
                throw new Error('Syntax error in parameters');
            } else if (line.match(/@/)) {
                if (!line.match(/^<.*>$/)) line = `<${line}>`;
            } else if (!line.match(/^(postmaster|abuse)$/i)) {
                throw new Error('Syntax error in address');
            }
        }
    }

    params.unshift(line);

    return params;
};
