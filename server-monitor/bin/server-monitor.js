#!/usr/bin/env node

const program = require('commander');
const { prompt } = require('inquirer');
const { authenticateUser, pingServer } = require('./lib/server-monitor');

program
  .version('0.0.1', '-v, --version')
  .description('Fyipe Monitoring Shell');

program
  .option('-p, --project-id [projectId]', 'Use Project ID from dashboard')
  .option('-a, --api-key [apiKey]', 'Use API key from dashboard')
  .option('-m, --monitor-id [monitorId]', 'Use monitor ID dashboard')
  .parse(process.argv);

// Questions to get projectId and API key
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

checkParams(questions)
  .then(values => {
    const [projectId, apiKey, monitorId] = values;

    authenticateUser(projectId, apiKey, monitorId)
      .then(data => {
        if (monitorId === null) {
          if (data !== null && data.data !== null && data.data.length > 0) {
            const question = questions.filter(param => param.name === 'monitorId');
            question[0].choices = data.data.map(monitor => `${monitor._id} (${monitor.name})`);

            prompt(question).then(({ monitorId }) => {
              const _id = monitorId.split(' (').shift();
              const filteredData = data.data.filter(monitor => monitor._id === _id);

              pingServer(filteredData.pop(), projectId, apiKey).start();
            });
          } else {
            // eslint-disable-next-line no-console
            console.log('You do not have any Server Monitor.');
          }
        } else {
          pingServer(data, projectId, apiKey).start();
        }
      })
      // eslint-disable-next-line no-console
      .catch(error => { console.error(error) });
  });

function checkParams(params) {
  const values = [];

  // eslint-disable-next-line no-undef
  return new Promise(resolve => {
    resolve(params.reduce((promiseChain, param) => (
      promiseChain.then(() => (
        getParamValue(params, param.name).then(value => {
          values.push(value);

          return values;
        })
      ))
      // eslint-disable-next-line no-undef
    ), Promise.resolve()));
  });
}

function getParamValue(params, name) {
  // eslint-disable-next-line no-undef
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
}

module.exports = {
  checkParams,
  getParamValue
};