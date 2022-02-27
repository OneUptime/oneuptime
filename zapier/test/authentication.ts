require('should');

// @ts-expect-error ts-migrate(2307) FIXME: Cannot find module 'zapier-platform-core' or its c... Remove this comment to see the full error message
import zapier from 'zapier-platform-core';

import App from '../index';

const appTester = zapier.createAppTester(App);

// @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'describe'. Do you need to instal... Remove this comment to see the full error message
describe('Authenticate API KEY and ProjectID', () => {
    zapier.tools.env.inject();

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('passes authentication and returns json', (done: $TSFixMe) => {
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
                            url: 'https://oneuptime.com',
                        },
                        projectId: '1',
                    },
                ],
            },
        };

        appTester(App.authentication.test, bundle)
            .then((json_response: $TSFixMe) => {
                json_response.should.have.property('projectName');
                done();
            })
            .catch(done);
    });
});
