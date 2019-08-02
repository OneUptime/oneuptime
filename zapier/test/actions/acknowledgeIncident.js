require('should');

const zapier = require('zapier-platform-core');

const App = require('../../index');

const appTester = zapier.createAppTester(App);

describe('Acknowledge Incident By ID Action', () => {

    it('passes authentication and acknowledges an incident by ID', (done) => {
        zapier.tools.env.inject();
        const bundle = {
            authData: {
                apiKey: process.env.DEV_API_KEY,
                projectId: process.env.DEV_PROJECT_ID
            },
            cleanedRequest: {
                projectName: 'New Project',
                projectId: '1', 
                incidents: [{
                    id: '1',
                    acknowledged: true,
                }],
            }
        };
        appTester(App.creates.acknowledge_incident.operation.perform, bundle)
          .then((response) => {
            response.should.be.an.instanceOf(Object);
            response.should.have.property('projectName');
            response.should.have.property('incidents');
            response.incidents.should.be.an.instanceOf(Array);
            response.incidents[0].acknowledged.should.be.equal(true);
            done();
          })
          .catch(done);
      });
});