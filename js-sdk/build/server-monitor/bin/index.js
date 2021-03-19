#!/usr/bin/env node

/**
 * @fileoverview Main CLI that is run via the fyipe-server-monitor command.
 * @author HackerBay, Inc.
 * @module server-monitor
 * @see module:api
 */
'use strict';

var _interopRequireDefault = require("@babel/runtime/helpers/interopRequireDefault");

var _slicedToArray2 = _interopRequireDefault(require("@babel/runtime/helpers/slicedToArray"));

var dotenv = require('dotenv');

dotenv.config();

var program = require('commander');

var Promise = require('promise');

var _require = require('../../../../package.json'),
    version = _require.version;

var _require2 = require('inquirer'),
    prompt = _require2.prompt;

var fs = require('fs');

var logger = require('../lib/logger');

var _require3 = require('../lib/config'),
    API_URL = _require3.API_URL,
    LOG_PATH = _require3.LOG_PATH;

var serverMonitor = require('../lib/api');

program.version(version, '-v, --version').description('Fyipe Monitoring Shell');
program.name('server-monitor');
program.option('-p, --project-id [projectId]', "Use Project ID from project's API settings").option('-u, --api-url [apiUrl]', "Use API URL from project's API settings").option('-a, --api-key [apiKey]', "Use API Key from project's API settings").option('-m, --monitor-id [monitorId]', 'Use Monitor ID from monitor details').option('-d, --daemon [daemon]', 'Run shell as a daemon').parse(process.argv);
/** The questions to get project id, api url, api key and monitor id. */

var questions = [{
  type: 'input',
  name: 'projectId',
  message: 'What is your Project ID (You can find this by going to Project Settings > API)?'
}, {
  type: 'input',
  name: 'apiUrl',
  message: 'What is your API URL (You can find this by going to Project Settings > API)?',
  "default": API_URL
}, {
  type: 'input',
  name: 'apiKey',
  message: 'What is your API Key (You can find this by going to Project Settings > API)?'
}, {
  type: 'list',
  name: 'monitorId',
  message: 'What is your Monitor ID?'
}, {
  type: 'confirm',
  name: 'daemon',
  message: 'Want to run as a daemon?'
}];
/**
 * Check cli params.
 * @param {Array} params - The params or questions of the cli.
 * @return {Promise} The cli params promise.
 */

var checkParams = function checkParams(params) {
  var values = [];
  return new Promise(function (resolve) {
    resolve(params.reduce(function (promiseChain, param) {
      return promiseChain.then(function () {
        return getParamValue(params, param.name).then(function (value) {
          values.push(value);
          return values;
        });
      });
    }, Promise.resolve()));
  });
};
/**
 * Get cli param value.
 * @param {Array} params - The params of the cli.
 * @param {string} name - The name of the cli param.
 * @return {Promise} The cli param value promise.
 */


var getParamValue = function getParamValue(params, name) {
  var options = program.opts();
  return new Promise(function (resolve) {
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
            prompt(params.filter(function (param) {
              return param.name === name;
            })).then(function (values) {
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


checkParams(questions).then(function (values) {
  var _values = (0, _slicedToArray2["default"])(values, 5),
      projectId = _values[0],
      apiUrl = _values[1],
      apiKey = _values[2],
      monitorId = _values[3],
      daemon = _values[4];

  if (daemon) {
    var os = require('os').platform();

    var Service;

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

    var svc = new Service({
      name: 'Fyipe Server Monitor',
      description: 'Fyipe Monitoring Shell',
      script: require('path').join(__dirname, 'server-monitor.js'),
      env: [{
        name: 'projectId',
        value: projectId
      }, {
        name: 'apiUrl',
        value: apiUrl
      }, {
        name: 'apiKey',
        value: apiKey
      }, {
        name: 'monitorId',
        value: monitorId
      }],
      wait: 2,
      grow: 0.5
    });
    svc.on('install', function () {
      logger.info('Fyipe Server Monitor daemon installed');
      svc.start();
    });
    svc.on('alreadyinstalled', function () {
      logger.warn('Fyipe Server Monitor daemon already installed');
    });
    svc.on('start', function () {
      logger.info('Fyipe Server Monitor daemon started');
    });
    svc.on('stop', function () {
      logger.info('Fyipe Server Monitor daemon stopped');
    });
    svc.on('uninstall', function () {
      logger.info('Fyipe Server Monitor uninstalled');
    });

    if (daemon === 'errors') {
      logger.error(fs.readFileSync(LOG_PATH[os].error, {
        encoding: 'utf8',
        flag: 'r'
      }));
    } else if (daemon === 'logs') {
      logger.info(fs.readFileSync(LOG_PATH[os].log, {
        encoding: 'utf8',
        flag: 'r'
      }));
    } else if (daemon === 'uninstall') {
      svc.uninstall();
    } else if (daemon === 'stop') {
      svc.stop();
    } else if (daemon === 'restart') {
      svc.restart();
    } else if (daemon === 'start') {
      svc.start();
    } else if (projectId && apiUrl && apiKey && monitorId && (typeof daemon === 'boolean' || daemon === 'install')) {
      svc.install();
    } else if (!monitorId) {
      logger.error('Server Monitor ID is required');
      process.exitCode = 1;
    } else {
      logger.error('Please enter a valid command (start, restart, stop, uninstall)');
      process.exitCode = 1;
    }
  } else {
    serverMonitor({
      projectId: projectId,
      apiUrl: apiUrl,
      apiKey: apiKey,
      monitorId: monitorId || function (data) {
        return new Promise(function (resolve) {
          var question = questions.filter(function (param) {
            return param.name === 'monitorId';
          });
          question[0].choices = data.map(function (monitor) {
            return "".concat(monitor.componentId.name, " / ").concat(monitor.name, " (").concat(monitor._id, ")");
          });
          prompt(question).then(function (_ref) {
            var monitorId = _ref.monitorId;
            resolve(monitorId.replace(/\/|\(|\)$/gi, '').split(' ').pop());
          });
        });
      }
    }).start();
  }
});
module.exports = {
  checkParams: checkParams,
  getParamValue: getParamValue
};