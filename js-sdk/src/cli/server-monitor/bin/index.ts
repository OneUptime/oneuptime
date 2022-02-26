#!/usr/bin/env node

/**
 * @fileoverview Main CLI that is run via the oneuptime-server-monitor command.
 * @author HackerBay, Inc.
 * @module server-monitor
 * @see module:api
 */

'use strict';

import dotenv from 'dotenv'
dotenv.config();

import program from 'commander'
import Promise from 'promise'
// @ts-expect-error ts-migrate(2732) FIXME: Cannot find module '../../../../package.json'. Con... Remove this comment to see the full error message
import { version } from '../../../../package.json'
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'inqu... Remove this comment to see the full error message
import { prompt } from 'inquirer'
import fs from 'fs'
import logger from '../lib/logger'
// @ts-expect-error ts-migrate(2614) FIXME: Module '"../lib/config"' has no exported member 'A... Remove this comment to see the full error message
import { API_URL, LOG_PATH } from '../lib/config'
import serverMonitor from '../lib/api'

program
    // @ts-expect-error ts-migrate(2339) FIXME: Property 'version' does not exist on type 'typeof ... Remove this comment to see the full error message
    .version(version, '-v, --version')
    .description('OneUptime Monitoring Shell');
// @ts-expect-error ts-migrate(2339) FIXME: Property 'name' does not exist on type 'typeof imp... Remove this comment to see the full error message
program.name('server-monitor');

program
    // @ts-expect-error ts-migrate(2551) FIXME: Property 'option' does not exist on type 'typeof i... Remove this comment to see the full error message
    .option(
        '-p, --project-id [projectId]',
        "Use Project ID from project's API settings"
    )
    .option('-u, --api-url [apiUrl]', "Use API URL from project's API settings")
    .option('-a, --api-key [apiKey]', "Use API Key from project's API settings")
    .option(
        '-m, --monitor-id [monitorId]',
        'Use Monitor ID from monitor details'
    )
    .option('-d, --daemon [daemon]', 'Run shell as a daemon')
    .parse(process.argv);

/** The questions to get project id, api url, api key and monitor id. */
const questions = [
    {
        type: 'input',
        name: 'projectId',
        message:
            'What is your Project ID (You can find this by going to Project Settings > API)?',
    },
    {
        type: 'input',
        name: 'apiUrl',
        message:
            'What is your API URL (You can find this by going to Project Settings > API)?',
        default: API_URL,
    },
    {
        type: 'input',
        name: 'apiKey',
        message:
            'What is your API Key (You can find this by going to Project Settings > API)?',
    },
    {
        type: 'list',
        name: 'monitorId',
        message: 'What is your Monitor ID?',
    },
    {
        type: 'confirm',
        name: 'daemon',
        message: 'Want to run as a daemon?',
    },
];

/**
 * Check cli params.
 * @param {Array} params - The params or questions of the cli.
 * @return {Promise} The cli params promise.
 */
// @ts-expect-error ts-migrate(7006) FIXME: Parameter 'params' implicitly has an 'any' type.
const checkParams = params => {
    // @ts-expect-error ts-migrate(7034) FIXME: Variable 'values' implicitly has type 'any[]' in s... Remove this comment to see the full error message
    const values = [];

    return new Promise(resolve => {
        resolve(
            params.reduce(
                // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'promiseChain' implicitly has an 'any' t... Remove this comment to see the full error message
                (promiseChain, param) =>
                    promiseChain.then(() =>
                        getParamValue(params, param.name).then(value => {
                            values.push(value);

                            // @ts-expect-error ts-migrate(7005) FIXME: Variable 'values' implicitly has an 'any[]' type.
                            return values;
                        })
                    ),
                Promise.resolve()
            )
        );
    });
};

/**
 * Get cli param value.
 * @param {Array} params - The params of the cli.
 * @param {string} name - The name of the cli param.
 * @return {Promise} The cli param value promise.
 */
// @ts-expect-error ts-migrate(7006) FIXME: Parameter 'params' implicitly has an 'any' type.
const getParamValue = (params, name) => {
    // @ts-expect-error ts-migrate(2339) FIXME: Property 'opts' does not exist on type 'typeof imp... Remove this comment to see the full error message
    const options = program.opts();
    return new Promise(resolve => {
        if (options[name] === true || options[name] === undefined) {
            if (name === 'monitorId') {
                resolve(process.env[name] || null);
            } else if (name === 'daemon') {
                resolve(options[name] === true);
            } else {
                if (process.env[name]) {
                    resolve(process.env[name]);
                } else {
                    if (typeof options['daemon'] === 'string') {
                        resolve(null);
                    } else {
                        prompt(
                            // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'param' implicitly has an 'any' type.
                            params.filter(param => param.name === name)
                        // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'values' implicitly has an 'any' type.
                        ).then(values => {
                            resolve(values[name]);
                        });
                    }
                }
            }
        } else {
            resolve(options[name]);
        }
    });
};

/** Init server monitor cli. */
checkParams(questions).then(values => {
    // @ts-expect-error ts-migrate(2488) FIXME: Type 'unknown' must have a '[Symbol.iterator]()' m... Remove this comment to see the full error message
    const [projectId, apiUrl, apiKey, monitorId, daemon] = values;

    if (daemon) {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'platform' does not exist on type 'ThenPr... Remove this comment to see the full error message
        import os from 'os').platform(

        // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'let'.
        let Service;
        // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'os'.
        switch (os) {
            case 'linux':
                // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'Service'.
                Service = require('node-linux').Service;
                break;
            case 'darwin':
                // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'Service'.
                Service = require('node-mac').Service;
                break;
            case 'win32':
                // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'Service'.
                Service = require('node-windows').Service;
                break;
        }

        // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'Service'.
        const svc = new Service({
            name: 'OneUptime Server Monitor',
            description: 'OneUptime Monitoring Shell',
            script: require('path').join(__dirname, 'server-monitor.js'),
            env: [
                {
                    name: 'projectId',
                    value: projectId,
                },
                {
                    name: 'apiUrl',
                    // @ts-expect-error ts-migrate(2552) FIXME: Cannot find name 'apiUrl'. Did you mean 'API_URL'?
                    value: apiUrl,
                },
                {
                    name: 'apiKey',
                    value: apiKey,
                },
                {
                    name: 'monitorId',
                    // @ts-expect-error ts-migrate(2552) FIXME: Cannot find name 'monitorId'. Did you mean '_monit... Remove this comment to see the full error message
                    value: monitorId,
                },
            ],
            wait: 2,
            grow: 0.5,
        });

        svc.on('install', function() {
            logger.info('OneUptime Server Monitor daemon installed');
            svc.start();
        });

        svc.on('alreadyinstalled', function() {
            logger.warn('OneUptime Server Monitor daemon already installed');
        });

        svc.on('start', function() {
            logger.info('OneUptime Server Monitor daemon started');
        });

        svc.on('stop', function() {
            logger.info('OneUptime Server Monitor daemon stopped');
        });

        svc.on('uninstall', function() {
            logger.info('OneUptime Server Monitor uninstalled');
        });

        // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'daemon'.
        if (daemon === 'errors') {
            logger.error(
                // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'os'.
                fs.readFileSync(LOG_PATH[os].error, {
                    encoding: 'utf8',
                    flag: 'r',
                })
            );
        // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'daemon'.
        } else if (daemon === 'logs') {
            logger.info(
                // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'os'.
                fs.readFileSync(LOG_PATH[os].log, {
                    encoding: 'utf8',
                    flag: 'r',
                })
            );
        // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'daemon'.
        } else if (daemon === 'uninstall') {
            svc.uninstall();
        // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'daemon'.
        } else if (daemon === 'stop') {
            svc.stop();
        // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'daemon'.
        } else if (daemon === 'restart') {
            svc.restart();
        // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'daemon'.
        } else if (daemon === 'start') {
            svc.start();
        } else if (
            projectId &&
            // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'apiUrl'.
            apiUrl &&
            apiKey &&
            // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'monitorId'.
            monitorId &&
            // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'daemon'.
            (typeof daemon === 'boolean' || daemon === 'install')
        ) {
            svc.install();
        // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'monitorId'.
        } else if (!monitorId) {
            logger.error('Server Monitor ID is required');

            process.exitCode = 1;
        } else {
            logger.error(
                'Please enter a valid command (start, restart, stop, uninstall)'
            );

            process.exitCode = 1;
        }
    } else {
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 1.
        serverMonitor({
            projectId,
            // @ts-expect-error ts-migrate(18004) FIXME: No value exists in scope for the shorthand propert... Remove this comment to see the full error message
            apiUrl,
            apiKey,
            monitorId:
                // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'monitorId'.
                monitorId ||
                // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'data' implicitly has an 'any' type.
                (data => {
                    return new Promise(resolve => {
                        const question = questions.filter(
                            param => param.name === 'monitorId'
                        );
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'choices' does not exist on type '{ type:... Remove this comment to see the full error message
                        question[0].choices = data.map(
                            // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'monitor' implicitly has an 'any' type.
                            monitor =>
                                `${monitor.componentId.name} / ${monitor.name} (${monitor._id})`
                        );

                        // @ts-expect-error ts-migrate(7031) FIXME: Binding element 'monitorId' implicitly has an 'any... Remove this comment to see the full error message
                        prompt(question).then(({ monitorId }) => {
                            resolve(
                                monitorId
                                    .replace(/\/|\(|\)$/gi, '')
                                    .split(' ')
                                    .pop()
                            );
                        });
                    });
                }),
        }).start();
    }
});

export default {
    checkParams,
    getParamValue,
};
