require('should');

const zapier = require('zapier-platform-core');

const App = require('../../index');

const appTester = zapier.createAppTester(App);

describe('Create Incident Note Action', () => {
    it('passes authentication and create new note', done => {
        zapier.tools.env.inject();
        const bundle = {
            authData: {
                apiKey: process.env.DEV_API_KEY,
                projectId: process.env.DEV_PROJECT_ID,
            },
            cleanedRequest: {
                projectName: 'New Project',
                projectId: '1',
                incidentId: '1',
                id: '1',
                content: 'new incidentNote',
                incident_state: 'update',
                type: 'investigation',
                createdAt: new Date().toISOString(),
                createdBy: 'Nawaz',
            },
        };
        appTester(App.creates.incident_note.operation.perform, bundle)
            .then(response => {
                response.should.be.an.instanceOf(Object);
                response.should.have.property('projectName');
                done();
            })
            .catch(done);
    });
});
