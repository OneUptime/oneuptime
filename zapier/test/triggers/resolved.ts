require('should');

import zapier from 'zapier-platform-core';

import App from '../../index';

const appTester = zapier.createAppTester(App);

describe('Resolve Trigger', () => {
    it('passes authentication and returns a resolved incident object', (done: $TSFixMe) => {
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
                    resolved: true,
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

        appTester(App.triggers.resolved.operation.perform, bundle)
            .then((response: $TSFixMe) => {
                response.should.be.an.instanceOf(Array);
                response[0].should.have.property('projectName');
                response[0].should.have.property('monitor');
                response[0].should.have.property('resolved');
                response[0].resolved.should.equal(true);
                done();
            })
            .catch(done);
    });
});
