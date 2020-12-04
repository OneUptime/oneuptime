#!/usr/bin/env node

/**
 * @fileoverview Main CLI that is run via the fyipe-server-monitor command.
 * @author HackerBay, Inc.
 * @module server-monitor
 * @see module:api
 */

'use strict';

const dotenv = require('dotenv');
dotenv.config();

const program = require('commander');
const Promise = require('promise');
const { version } = require('../package.json');
const { prompt } = require('inquirer');
const { Monitor } = require('forever-monitor');
const logger = require('../lib/logger');
const { API_URL } = require('../lib/config');
const serverMonitor = require('../lib/api');

program.version(version, '-v, --version').description('Fyipe Monitoring Shell');

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
    .option('-A, --agentless [agentless]', 'Run shell as agentless')
    .option('-r, --remote [remote]', 'Run on remote server')
    .option('-H, --host [host]', 'Remote server host')
    .option('-P, --port [port]', 'Remote server SSH port')
    .option('-U, --username [username]', 'Remote server username')
    .option(
        '-i, --identity-file [identityFile]',
        'Remote server private key file path'
    )
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
    {
        type: 'confirm',
        name: 'agentless',
        message: 'Want to run as agentless?',
    },
    {
        type: 'confirm',
        name: 'remote',
        message: 'Want to run on remote server?',
    },
    {
        type: 'input',
        name: 'host',
        message: 'What is your remote server host?',
    },
    {
        type: 'number',
        name: 'port',
        message: 'What is your remote server SSH port?',
        default: 22,
    },
    {
        type: 'input',
        name: 'username',
        message: 'What is your remote server username?',
    },
    {
        type: 'input',
        name: 'identityFile',
        message: 'What is your remote server private key file path?',
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
    return new Promise(resolve => {
        if (program[name] === true || program[name] === undefined) {
            if (
                name === 'monitorId' ||
                (['host', 'port', 'username', 'identityFile'].includes(name) &&
                    (program['agentless'] === false ||
                        program['agentless'] === undefined ||
                        (program['agentless'] === true &&
                            (program['remote'] === false ||
                                program['remote'] === undefined))))
            ) {
                resolve(null);
            } else if (
                name === 'daemon' ||
                name === 'agentless' ||
                name === 'remote'
            ) {
                resolve(program[name] === true ? true : false);
            } else {
                prompt(params.filter(param => param.name === name)).then(
                    values => {
                        resolve(values[name]);
                    }
                );
            }
        } else {
            resolve(program[name]);
        }
    });
};

/** Init server monitor cli. */
checkParams(questions).then(values => {
    const [
        projectId,
        apiUrl,
        apiKey,
        monitorId,
        daemon,
        agentless,
        remote,
        host,
        port,
        username,
        identityFile,
    ] = values;

    if (projectId && apiUrl && apiKey && monitorId && daemon) {
        process.argv.splice(process.argv.indexOf('-d'), 1);

        const child = new Monitor(`${__dirname}/server-monitor.js`, {
            uid: 'fsm',
            silent: true,
            args: process.argv,
        });

        child.on('restart', function() {
            logger.warn('Fyipe Server Monitor restarted');
        });

        child.on('exit', function() {
            logger.error('Fyipe Server Monitor exited');
        });

        child.start();

        process.nextTick(() => {
            process.exit();
        });
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
            agentless: agentless
                ? remote
                    ? host && port && username && identityFile
                        ? {
                              host,
                              port,
                              username,
                              identityFile,
                          }
                        : null
                    : true
                : null,
        }).start();
    }
});

module.exports = {
    checkParams,
    getParamValue,
};
