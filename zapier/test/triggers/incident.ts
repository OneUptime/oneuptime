require('should');

// @ts-expect-error ts-migrate(2307) FIXME: Cannot find module 'zapier-platform-core' or its c... Remove this comment to see the full error message
import zapier from 'zapier-platform-core';

import App from '../../index';

const appTester = zapier.createAppTester(App);

// @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'describe'. Do you need to instal... Remove this comment to see the full error message
describe('Incident Trigger', () => {
    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('passes authentication and returns an incident object', (done: $TSFixMe) => {
        zapier.tools.env.inject();

        const bundle = {
            authData: {
                apiKey: process.env.DEV_API_KEY,
            },
            cleanedRequest: [
                {
                    projectName: 'New Project',
                    id: '1',
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
        appTester(App.triggers.incident.operation.perform, bundle)
            .then((response: $TSFixMe) => {
                response.should.be.an.instanceOf(Array);
                response[0].should.have.property('projectName');
                response[0].should.have.property('monitor');
                done();
            })
            .catch(done);
    });
});
