require('should');

const zapier = require('zapier-platform-core');

const App = require('../index');

const appTester = zapier.createAppTester(App);

describe('Authenticate API KEY and ProjectID', () => {
    zapier.tools.env.inject();

    it('passes authentication and returns json', done => {
        const bundle = {
            authData: {
                apiKey: process.env.DEV_API_KEY,
                projectId: process.env.DEV_PROJECT_ID,
            },
            cleanedRequest: {
                projectId: '1',
                projectName: 'New Project',
                monitor: [
                    {
                        createdAt: new Date().toTimeString(),
                        pollTime: new Date().toTimeString(),
                        _id: '1',
                        createdBy: 'You',
                        name: 'New Sample',
                        type: 'url',
                        data: {
                            url: 'https://fyipe.com',
                        },
                        projectId: '1',
                    },
                ],
            },
        };

        appTester(App.authentication.test, bundle)
            .then(json_response => {
                json_response.should.have.property('projectName');
                done();
            })
            .catch(done);
    });
});
