require('should');

const zapier = require('zapier-platform-core');

const App = require('../../index');

const appTester = zapier.createAppTester(App);

describe('Resolve Last Incident', () => {
    it('passes authentication and resolves last incident', done => {
        zapier.tools.env.inject();
        const bundle = {
            authData: {
                apiKey: process.env.DEV_API_KEY,
                projectId: process.env.DEV_PROJECT_ID,
            },
            cleanedRequest: {
                projectName: 'New Project',
                projectId: '1',
                incidents: [
                    {
                        id: '1',
                        resolved: true,
                    },
                    {
                        id: '1',
                        resolved: false,
                    },
                ],
            },
        };
        appTester(App.creates.resolve_last_incident.operation.perform, bundle)
            .then(response => {
                response.should.be.an.instanceOf(Object);
                response.should.have.property('projectName');
                response.should.have.property('incidents');
                response.incidents.should.be.an.instanceOf(Array);
                response.incidents[0].resolved.should.be.equal(true);
                response.incidents[1].resolved.should.be.equal(false);
                done();
            })
            .catch(done);
    });
});
