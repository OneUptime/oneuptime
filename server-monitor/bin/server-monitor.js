#!/usr/bin/env node

/**
 * @fileoverview Main CLI that is run via the fyipe-server-monitor command.
 * @author HackerBay, Inc.
 * @module server-monitor
 * @see module:api
 */

'use strict';

const dotenv = require('dotenv');
const program = require('commander');
const Promise = require('promise');
const { prompt } = require('inquirer');
const serverMonitor = require('../lib/api');

dotenv.config();

program
  .version(process.env.npm_package_version, '-v, --version')
  .description('Fyipe Monitoring Shell');

program
  .option('-p, --project-id [projectId]', 'Use Project ID from dashboard')
  .option('-a, --api-key [apiKey]', 'Use API key from dashboard')
  .option('-m, --monitor-id [monitorId]', 'Use monitor ID from dashboard')
  .parse(process.argv);

/** The questions to get project id, api key and monitor id. */
const questions = [
  {
    type: 'input',
    name: 'projectId',
    message: 'What is your Project ID?'
  },
  {
    type: 'input',
    name: 'apiKey',
    message: 'What is your Project\'s API key?'
  },
  {
    type: 'list',
    name: 'monitorId',
    message: 'What is your Monitor ID?'
  }
];

/**
* Check cli params.
* @param {Array} params - The params or questions of the cli.
* @return {Promise} The cli params promise.
*/
const checkParams = (params) => {
  const values = [];

  return new Promise(resolve => {
    resolve(params.reduce((promiseChain, param) => (
      promiseChain.then(() => (
        getParamValue(params, param.name).then(value => {
          values.push(value);

          return values;
        })
      ))
    ), Promise.resolve()));
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
      if (name === 'monitorId') {
        resolve(null);
      } else {
        prompt(params.filter(param => param.name === name)).then(values => {
          resolve(values[name]);
        });
      }
    } else {
      resolve(program[name]);
    }
  });
};

/** Init server monitor cli. */
checkParams(questions)
  .then(values => {
    const [projectId, apiKey, monitorId] = values;

    serverMonitor({
      projectId,
      apiKey,
      monitorId: monitorId || (data => {
        return new Promise(resolve => {
          const question = questions.filter(param => param.name === 'monitorId');
          question[0].choices = data.map(monitor => `${monitor._id} (${monitor.name})`);

          prompt(question).then(({ monitorId }) => {
            resolve(monitorId.split(' (').shift());
          });
        });
      })
    }).start();
  });

module.exports = {
  checkParams,
  getParamValue
};