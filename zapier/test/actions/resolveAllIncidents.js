require('should');

const zapier = require('zapier-platform-core');

const App = require('../../index');

const appTester = zapier.createAppTester(App);

describe('Resolve All Incidents Action', () => {

    it('passes authentication and resolves all incidents', (done) => {
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
                    resolved: true,
                }],
            }
        };
        appTester(App.creates.resolve_all_incidents.operation.perform, bundle)
          .then((response) => {
            response.should.be.an.instanceOf(Object);
            response.should.have.property('projectName');
            response.should.have.property('incidents');
            response.incidents.should.be.an.instanceOf(Array);
            response.incidents[0].resolved.should.be.equal(true);
            done();
          })
          .catch(done);
      });
});