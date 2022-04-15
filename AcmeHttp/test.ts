#!/usr/bin/env node

// See https://git.coolaj86.com/coolaj86/acme-challenge-test.js

import tester from 'acme-challenge-test';
import dotenv from 'dotenv';
dotenv.config();

// Usage: node ./test.js example.com username xxxxxxxxx
const record: $TSFixMe = process.argv[2] || process.env.RECORD;

import Challenger from './index.ts';
const challenger: $TSFixMe = Challenger.create({});

/*
 * The dry-run tests can pass on, literally, 'example.com'
 * But the integration tests require that you have control over the domain
 */

tester
    .testRecord('http-01', record, challenger)
    .then((): void => {
        //eslint-disable-next-line no-console
        console.info('PASS', record);
    })

    .catch((e: $TSFixMe): void => {
        //eslint-disable-next-line no-console
        console.error(e.message);
        //eslint-disable-next-line no-console
        console.error(e.stack);
    });
