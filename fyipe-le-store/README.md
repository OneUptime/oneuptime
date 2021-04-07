# fyipe-le-store Package for Greenlock

This module implements a dead-simple, api call to Fyipe backend to store account or certificate details. This allows us to persist our [Let's Encrypt](https://letsencrypt.org/) data in mongo for automated TLS certificate issuance and use.

## Install

    npm install fyipe-le-store

## Usage

    // make sure greenlock is already installed
    const Greenlock = require('greenlock');

    Greenlock.create({
        store: {
            module: 'fyipe-le-store',
        },
        // ...
    });
