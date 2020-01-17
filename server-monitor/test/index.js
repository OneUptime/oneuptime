process.env.NODE_ENV = 'development';
process.env.LOG_LEVEL = 'error';
process.env.API_URL = 'http://localhost:3002';
process.env.STRIPE_PRIVATE_KEY = 'sk_test_YxwnzywggtAd8jDaHecNmHiN';

const chai = require('chai');
chai.use(require('chai-http'));

const request = chai.request.agent(process.env.API_URL);
const stripe = require('stripe')(process.env.STRIPE_PRIVATE_KEY);

const utils = require('./test-utils');
const expect = require('chai').expect;
const serverMonitor = require('../lib/api');

const user = require('./test-utils').user;
user.email = utils.generateRandomBusinessEmail();

let token, projectId, apiKey, monitorId;
let badProjectId, badApiKey;
let timeout = 5000, monitor = {
  name: 'New Monitor',
  type: 'server-monitor',
  data: {}
};

describe('Server Monitor', function () {
  this.timeout(timeout + 1000);

  before(function (done) {
    this.timeout(30000);

    request.post('/stripe/checkCard').send({
      tokenId: 'tok_visa',
      email: user.email,
      companyName: user.companyName
    }).end(function (err, res) {
      stripe.paymentIntents.confirm(res.body.id, function (err, paymentIntent) {
        user.paymentIntent = {
          id: paymentIntent.id
        };

        request.post('/user/signup').send(user).end(function (err, res) {
          let project = res.body.project;

          projectId = project._id;
          apiKey = project.apiKey;

          request.post('/user/login').send({
            email: user.email,
            password: user.password
          }).end(function(err, res) {
            token = res.body.tokens.jwtAccessToken;
            request.post(`/monitor/${projectId}`).set('Authorization', `Basic ${token}`).send(monitor).end(function (err, res) {
              expect(res).to.have.status(200);
              expect(res.body).to.be.an('array');
              expect(res.body[0]).to.have.property('_id');
              monitorId = res.body[0]._id;
              done();
            });
          });
        });
      });
    });
  });

  it('Should connect when project id, api key and monitor id are provided', (done) => {
    const monitor = serverMonitor({
      projectId,
      apiKey,
      monitorId
    });

    monitor.start().then((job) => {
      const stopJob = monitor.stop();

      expect(job).to.be.an('object');
      expect(stopJob).to.be.an('object');

      done();
    });
  });

  it('Should request for monitor id when only project id and api key are provided', (done) => {
    const monitor = serverMonitor({
      projectId,
      apiKey,
      monitorId: (data) => {
        let filteredMonitor = data.filter(monitor => monitor._id === monitorId);

        if (filteredMonitor.length > 0) {
          return monitorId;
        }
      }
    });

    monitor.start().then((job) => {
      const stopJob = monitor.stop();

      expect(job).to.be.an('object');
      expect(stopJob).to.be.an('object');

      done();
    });
  });

  it('Should disconnect when project id or api key are incorrect', (done) => {
    const monitor = serverMonitor({
      badProjectId,
      badApiKey
    });

    monitor.start().then((job) => {
      const stopJob = monitor.stop();

      expect(job).to.equal(1);
      expect(stopJob).to.equal(undefined);

      done();
    });
  });

  it('Should disconnect when timeout provided is exceeded', (done) => {
    const monitor = serverMonitor({
      projectId,
      apiKey,
      monitorId,
      timeout
    });

    monitor.start().then((job) => {
      expect(job).to.be.an('object');
      expect(job).to.have.property('running');
      expect(job.running).to.equal(true);

      setTimeout(() => {
        expect(job.running).to.equal(false);

        done();
      }, timeout);
    });
  });
});