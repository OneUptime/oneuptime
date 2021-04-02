require('should');

const zapier = require('zapier-platform-core');

const App = require('../../index');

const appTester = zapier.createAppTester(App);

describe('incidentNote Trigger', () => {
    it('passes authentication and returns an incident Note', done => {
        zapier.tools.env.inject();

        const bundle = {
            authData: {
                apiKey: process.env.DEV_API_KEY,
            },
            cleanedRequest: [
                {
                    projectName: 'New Project',
                    projectId: '1',
                    incidentId: '1',
                    content: 'new incidentNote',
                    incident_state: 'update',
                    type: 'investigation',
                    createdAt: new Date().toISOString(),
                    createdBy: 'Nawaz',
                },
            ],
        };

        appTester(App.triggers.incident_note.operation.perform, bundle)
            .then(response => {
                response.should.be.an.instanceOf(Array);
                response[0].should.have.property('projectName');
                response[0].should.have.property('content');
                response[0].should.have.property('type');
                done();
            })
            .catch(done);
    });
});
