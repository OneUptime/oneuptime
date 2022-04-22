# oneuptime-le-store Package for Greenlock

This module implements a dead-simple, api call to OneUptime backend to store account or certificate details. This allows us to persist our [Let's Encrypt](https://letsencrypt.org/) data in mongo for automated TLS certificate issuance and use.

## Install

    npm install oneuptime-le-store

## Usage

    // make sure greenlock is already installed
    import Greenlock from 'greenlock'

    Greenlock.create({
        store: {
            module: 'oneuptime-le-store',
        },
        // ...
    });
