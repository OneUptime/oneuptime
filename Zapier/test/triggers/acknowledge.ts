import 'should';

import zapier from 'zapier-platform-core';

import App from '../../index';

const appTester: $TSFixMe = zapier.createAppTester(App);

describe('Acknowledge Trigger', () => {
    zapier.tools.env.inject();

    it('passes authentication and returns an acknowledged incident object', (done: $TSFixMe) => {
        const bundle: $TSFixMe = {
            authData: {
                apiKey: process.env.DEV_API_KEY,
                projectId: process.env.DEV_PROJECT_ID,
            },
            cleanedRequest: [
                {
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
                                url: 'https://oneuptime.com',
                            },
                            projectId: '1',
                        },
                    ],
                },
            ],
        };

        appTester(App.triggers.acknowledge.operation.perform, bundle)
            .then((response: $TSFixMe) => {
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
