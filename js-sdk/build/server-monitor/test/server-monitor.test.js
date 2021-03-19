"use strict";

/* eslint-disable no-undef */
process.env.NODE_ENV = 'development';
process.env.LOG_LEVEL = 'error';
process.env.API_URL = 'http://localhost:3002';

var chai = require('chai');

chai.use(require('chai-http'));
var request = chai.request.agent(process.env.API_URL);

var utils = require('./test-utils');

var expect = require('chai').expect;

var serverMonitor = require('../lib/api');

var user = require('./test-utils').user;

user.email = utils.generateRandomBusinessEmail();

var token, projectId, apiKey, _monitorId;

var badProjectId = 'badProjectId',
    badApiKey = 'badApiKey';
var invalidProjectId = utils.generateRandomString();
var timeout = 5000,
    monitor = {
  name: 'New Monitor',
  type: 'server-monitor',
  data: {}
};
describe('Server Monitor', function () {
  this.timeout(timeout + 1000);
  before(function (done) {
    this.timeout(30000);
    request.post('/user/signup').send(user).end(function (err, res) {
      var project = res.body.project;
      projectId = project._id;
      apiKey = project.apiKey;
      request.post('/user/login').send({
        email: user.email,
        password: user.password
      }).end(function (err, res) {
        token = res.body.tokens.jwtAccessToken;
        request.post("/monitor/".concat(projectId)).set('Authorization', "Basic ".concat(token)).send(monitor).end(function (err, res) {
          expect(res).to.have.status(200);
          expect(res.body).to.be.an('object');
          expect(res.body).to.have.property('_id');
          _monitorId = res.body._id;
          done();
        });
      });
    });
  });
  it('Should connect when project id, api key and monitor id are provided', function (done) {
    var monitor = serverMonitor({
      projectId: projectId,
      apiKey: apiKey,
      monitorId: _monitorId
    });
    monitor.start().then(function (job) {
      var stopJob = monitor.stop();
      expect(job).to.be.an('object');
      expect(stopJob).to.be.an('object');
      done();
    });
  });
  it('Should connect when project id, custom api url, api key and monitor id are provided', function (done) {
    var monitor = serverMonitor({
      projectId: projectId,
      apiUrl: 'http://localhost:3002',
      apiKey: apiKey,
      monitorId: _monitorId
    });
    monitor.start().then(function (job) {
      var stopJob = monitor.stop();
      expect(job).to.be.an('object');
      expect(stopJob).to.be.an('object');
      done();
    });
  });
  it('Should request for monitor id when only project id and api key are provided', function (done) {
    var monitor = serverMonitor({
      projectId: projectId,
      apiKey: apiKey,
      monitorId: function monitorId(data) {
        var filteredMonitor = data.filter(function (monitor) {
          return monitor._id === _monitorId;
        });

        if (filteredMonitor.length > 0) {
          return _monitorId;
        }
      }
    });
    monitor.start().then(function (job) {
      var stopJob = monitor.stop();
      expect(job).to.be.an('object');
      expect(stopJob).to.be.an('object');
      done();
    });
  });
  it('Should disconnect when project id is invalid', function (done) {
    var monitor = serverMonitor({
      projectId: invalidProjectId,
      apiKey: badApiKey
    });
    monitor.start().then(function (job) {
      var stopJob = monitor.stop();
      expect(job).to.be.an('object');
      expect(job).to.haveOwnProperty('message');
      expect(job.message).to.equal('Project Id is not valid');
      expect(stopJob).to.equal(undefined);
      done();
    });
  });
  it('Should disconnect when project id or api key are incorrect', function (done) {
    var monitor = serverMonitor({
      projectId: badProjectId,
      apiKey: badApiKey
    });
    monitor.start().then(function (job) {
      var stopJob = monitor.stop();
      expect(job).to.be.an('object');
      expect(job).to.haveOwnProperty('message');
      expect(job.message).to.equal('No Project found with this API Key and Project ID.');
      expect(stopJob).to.equal(undefined);
      done();
    });
  });
  it('Should disconnect when project id is correct and api key is incorrect', function (done) {
    var monitor = serverMonitor({
      projectId: projectId,
      apiKey: badApiKey
    });
    monitor.start().then(function (job) {
      var stopJob = monitor.stop();
      expect(job).to.be.an('object');
      expect(job).to.haveOwnProperty('message');
      expect(job.message).to.equal('No Project found with this API Key and Project ID.');
      expect(stopJob).to.equal(undefined);
      done();
    });
  });
  it('Should disconnect when project id is incorrect and api key is correct', function (done) {
    var monitor = serverMonitor({
      projectId: badProjectId,
      apiKey: apiKey
    });
    monitor.start().then(function (job) {
      var stopJob = monitor.stop();
      expect(job).to.be.an('object');
      expect(job).to.haveOwnProperty('message');
      expect(job.message).to.equal('No Project found with this API Key and Project ID.');
      expect(stopJob).to.equal(undefined);
      done();
    });
  });
  it('Should disconnect when timeout provided is exceeded', function (done) {
    var monitor = serverMonitor({
      projectId: projectId,
      apiKey: apiKey,
      monitorId: _monitorId,
      timeout: timeout
    });
    monitor.start().then(function (job) {
      expect(job).to.be.an('object');
      expect(job).to.have.property('running');
      expect(job.running).to.equal(true);
      setTimeout(function () {
        expect(job.running).to.equal(false);
        done();
      }, timeout);
    });
  });
});