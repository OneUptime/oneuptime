require('should');

const zapier = require('zapier-platform-core');

const App = require('../../index');

const appTester = zapier.createAppTester(App);

describe('Acknowledge Trigger', ()=>{
    zapier.tools.env.inject();

    it('passes authentication and returns an acknowledged incident object', done => {

        const bundle = {
            authData: {
                apiKey: process.env.DEV_API_KEY,
                projectId: process.env.DEV_PROJECT_ID
            },
            cleanedRequest: [{
                projectName: 'New Project',
                projectId: '1', 
                incidentId: '1',
                acknowledged: true,
                monitor: [
                    {
                        createdAt: new Date().toTimeString(),
                        pollTime: new Date().toTimeString(),
                        _id: '1',
                        createdBy: 'You',
                        name: 'New Sample',
                        type: 'url',
                        data: {
                            url: 'https://fyipe.com'
                        },
                        projectId: '1',
                    }
                ],
            }]
        };

        appTester(App.triggers.incident_acknowledge.operation.perform, bundle)
            .then((response) => {
                response.should.be.an.instanceOf(Array);
                response[0].should.have.property('projectName');
                response[0].should.have.property('monitor');
                response[0].should.have.property('acknowledged');
                response[0].acknowledged.should.equal(true);
                done();
            })
            .catch(done);
    });

});