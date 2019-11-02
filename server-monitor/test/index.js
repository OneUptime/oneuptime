process.env.LOG_LEVEL = 'debug';

const expect = require('chai').expect;
const serverMonitor = require('../lib/api');

let projectId, apiKey, monitorId;
let badProjectId, badApiKey;
// let timeout = 5000;

describe('Server Monitor', () => {
  before(() => {
    projectId = '5d64d59cae46131619708309';
    apiKey = 'b02798c0-c898-11e9-9f14-4963dc67e2ab';
    monitorId = '5d99debd2931c15988746c05';

    badProjectId = '5d64d59cae46131619708301';
    badApiKey = 'b02798c0-c898-11e9-9f14-4963dc67e2ad';
  });

  // after(() => {

  // });

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

  it('Should disconnect when timeout provided is exceeded', () => {

  });
});