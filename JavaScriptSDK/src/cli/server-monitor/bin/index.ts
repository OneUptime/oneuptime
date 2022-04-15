#!/usr/bin/env node

/**
 * @fileoverview Main CLI that is run via the oneuptime-server-monitor command.
 * @author HackerBay, Inc.
 * @module server-monitor
 * @see module:api
 */

import dotenv from 'dotenv';
dotenv.config();

import program from 'commander';
import Promise from 'promise';
import os from 'os';
import { version } from '../../../../package.json';

import { prompt } from 'inquirer';
import fs from 'fs';
import logger from '../lib/logger';

import { API_URL, LOG_PATH } from '../lib/config';
import serverMonitor from '../lib/api';

program

    .version(version, '-v, --version')
    .description('OneUptime Monitoring Shell');

program.name('server-monitor');

program

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
const questions: $TSFixMe = [
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

const checkParams: Function = (params: $TSFixMe): void => {
    const values: $TSFixMe = [];

    return new Promise((resolve: $TSFixMe) => {
        resolve(
            params.reduce((promiseChain: $TSFixMe, param: $TSFixMe) => {
                return promiseChain.then(() => {
                    return getParamValue(params, param.name).then(
                        (value: $TSFixMe) => {
                            values.push(value);

                            return values;
                        }
                    );
                });
            }, Promise.resolve())
        );
    });
};

/**
 * Get cli param value.
 * @param {Array} params - The params of the cli.
 * @param {string} name - The name of the cli param.
 * @return {Promise} The cli param value promise.
 */

const getParamValue: Function = (params: $TSFixMe, name: $TSFixMe): void => {
    const options: $TSFixMe = program.opts();
    return new Promise((resolve: $TSFixMe) => {
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
                            params.filter((param: $TSFixMe) => {
                                return param.name === name;
                            })
                        ).then((values: $TSFixMe) => {
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
checkParams(questions).then((values: $TSFixMe) => {
    const [projectId, apiUrl, apiKey, monitorId, daemon] = values;

    if (daemon) {
        os.platform();

        let Service: $TSFixMe;

        switch (os) {
            case 'linux':
                Service = require('node-linux').Service;
                break;
            case 'darwin':
                Service = require('node-mac').Service;
                break;
            case 'win32':
                Service = require('node-windows').Service;
                break;
        }

        const svc: $TSFixMe = new Service({
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

                    value: apiUrl,
                },
                {
                    name: 'apiKey',
                    value: apiKey,
                },
                {
                    name: 'monitorId',

                    value: monitorId,
                },
            ],
            wait: 2,
            grow: 0.5,
        });

        svc.on('install', (): void => {
            logger.info('OneUptime Server Monitor daemon installed');
            svc.start();
        });

        svc.on('alreadyinstalled', (): void => {
            logger.warn('OneUptime Server Monitor daemon already installed');
        });

        svc.on('start', (): void => {
            logger.info('OneUptime Server Monitor daemon started');
        });

        svc.on('stop', (): void => {
            logger.info('OneUptime Server Monitor daemon stopped');
        });

        svc.on('uninstall', (): void => {
            logger.info('OneUptime Server Monitor uninstalled');
        });

        if (daemon === 'errors') {
            logger.error(
                fs.readFileSync(LOG_PATH[os].error, {
                    encoding: 'utf8',
                    flag: 'r',
                })
            );
        } else if (daemon === 'logs') {
            logger.info(
                fs.readFileSync(LOG_PATH[os].log, {
                    encoding: 'utf8',
                    flag: 'r',
                })
            );
        } else if (daemon === 'uninstall') {
            svc.uninstall();
        } else if (daemon === 'stop') {
            svc.stop();
        } else if (daemon === 'restart') {
            svc.restart();
        } else if (daemon === 'start') {
            svc.start();
        } else if (
            projectId &&
            apiUrl &&
            apiKey &&
            monitorId &&
            (typeof daemon === 'boolean' || daemon === 'install')
        ) {
            svc.install();
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
        serverMonitor({
            projectId,

            apiUrl,
            apiKey,
            monitorId:
                monitorId ||
                ((data: $TSFixMe) => {
                    return new Promise((resolve: $TSFixMe) => {
                        const question: $TSFixMe = questions.filter(
                            (param: $TSFixMe) => {
                                return param.name === 'monitorId';
                            }
                        );

                        question[0].choices = data.map((monitor: $TSFixMe) => {
                            return `${monitor.componentId.name} / ${monitor.name} (${monitor._id})`;
                        });

                        prompt(question).then(({ monitorId }: $TSFixMe) => {
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
