import 'should';

import zapier from 'zapier-platform-core';

import App from '../../index';

const appTester: $TSFixMe = zapier.createAppTester(App);

describe('Resolve Last Incident', () => {
    it('passes authentication and resolves last incident', (done: $TSFixMe) => {
        zapier.tools.env.inject();
        const bundle: $TSFixMe = {
            authData: {
                apiKey: process.env['DEV_API_KEY'],
                projectId: process.env['DEV_PROJECT_ID'],
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
            .then((response: $TSFixMe) => {
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
