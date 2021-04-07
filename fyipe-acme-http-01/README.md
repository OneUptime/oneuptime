# fyipe-acme-http-01 Package for Greenlock

This module handles acme-http-01 challenge and also the api call to Fyipe backend to persist keyAuthorization and token data from acme directory in our mongodb. The stored data will be used by Fyipe to validate all our certificate order/renewal.

## Install

    npm install fyipe-acme-http-01

## Usage

    // make sure greenlock is already installed
    const Greenlock = require('greenlock');

    Greenlock.create({
        challenges: {
            'http-01': {
                module: 'fyipe-acme-http-01',
            },
        },
        // ...
    });
