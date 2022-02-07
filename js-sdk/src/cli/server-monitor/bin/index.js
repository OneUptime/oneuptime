#!/usr/bin/env node

/**
 * @fileoverview Main CLI that is run via the oneuptime-server-monitor command.
 * @author HackerBay, Inc.
 * @module server-monitor
 * @see module:api
 */

'use strict';

const dotenv = require('dotenv');
dotenv.config();

const program = require('commander');
const Promise = require('promise');
const { version } = require('../../../../package.json');
const { prompt } = require('inquirer');
const fs = require('fs');
const logger = require('../lib/logger');
const { API_URL, LOG_PATH } = require('../lib/config');
const serverMonitor = require('../lib/api');

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
const checkParams = params => {
    const values = [];

    return new Promise(resolve => {
        resolve(
            params.reduce(
                (promiseChain, param) =>
                    promiseChain.then(() =>
                        getParamValue(params, param.name).then(value => {
                            values.push(value);

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
const getParamValue = (params, name) => {
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
                            params.filter(param => param.name === name)
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
    const [projectId, apiUrl, apiKey, monitorId, daemon] = values;

    if (daemon) {
        const os = require('os').platform();

        let Service;
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
                (data => {
                    return new Promise(resolve => {
                        const question = questions.filter(
                            param => param.name === 'monitorId'
                        );
                        question[0].choices = data.map(
                            monitor =>
                                `${monitor.componentId.name} / ${monitor.name} (${monitor._id})`
                        );

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

module.exports = {
    checkParams,
    getParamValue,
};
