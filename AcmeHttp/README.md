# oneuptime-acme-http-01 Package for Greenlock

This module handles acme-http-01 challenge and also the api call to OneUptime backend to persist keyAuthorization and token data from acme directory in our mongodb. The stored data will be used by OneUptime to validate all our certificate order/renewal.

## Install

    npm install oneuptime-acme-http-01

## Usage

    // make sure greenlock is already installed
    import Greenlock from 'greenlock'

    Greenlock.create({
        challenges: {
            'http-01': {
                module: 'oneuptime-acme-http-01',
            },
        },
        // ...
    });
