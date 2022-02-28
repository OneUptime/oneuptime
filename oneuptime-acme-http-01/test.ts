#!/usr/bin/env node


// See https://git.coolaj86.com/coolaj86/acme-challenge-test.js
// @ts-expect-error ts-migrate(2307) FIXME: Cannot find module 'acme-challenge-test' or its co... Remove this comment to see the full error message
import tester from 'acme-challenge-test'
require('dotenv').config();

// Usage: node ./test.js example.com username xxxxxxxxx
const record = process.argv[2] || process.env.RECORD;
// @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'create'.
import challenger from './index.js').create({}

// The dry-run tests can pass on, literally, 'example.com'
// but the integration tests require that you have control over the domain

tester
    .testRecord('http-01', record, challenger)
    .then(function() {
        // eslint-disable-next-line no-console
        console.info('PASS', record);
    })
    // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'e' implicitly has an 'any' type.
    .catch(function(e) {
        // eslint-disable-next-line no-console
        console.error(e.message);
        // eslint-disable-next-line no-console
        console.error(e.stack);
    });
