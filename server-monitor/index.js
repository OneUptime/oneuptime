#!/usr/bin/env node

const program = require('commander');
const { prompt } = require('inquirer');
// eslint-disable-next-line no-unused-vars
const { authenticateUser, pingServer } = require('./src/logic');

// Questions to get projectId and API key
const questions = [
  {
    type: 'input',
    name: 'projectId',
    message: 'What is your project Id?'
  },
  {
    type: 'input',
    name: 'apiKey',
    message: 'What is your project\'s API key?'
  }
];

program.version('0.0.1').description('Fyipe Monitoring Shell');

program
  .command('start')
  .alias('s')
  .description(
    'Authenticates a user by accepting and confirming projectId and apiKey.' +
    'Begin server monitoring'
  )
  .action(() => {
    prompt(questions).then(input => {
      const { projectId, apiKey } = input;
      authenticateUser(projectId, apiKey);
      // pingServer.start();
    });
  });

program.parse(process.argv);
