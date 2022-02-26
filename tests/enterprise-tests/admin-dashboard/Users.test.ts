// @ts-expect-error ts-migrate(2307) FIXME: Cannot find module 'puppeteer' or its correspondin... Remove this comment to see the full error message
import puppeteer from 'puppeteer'

import utils from '../../test-utils'
import init from '../../test-init'
let browser: $TSFixMe, page: $TSFixMe;
require('should');

const email = utils.generateRandomBusinessEmail();
const password = '1234567890';

// @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'describe'. Do you need to instal... Remove this comment to see the full error message
describe('Users Component (IS_SAAS_SERVICE=false)', () => {
    const operationTimeOut = init.timeout;

    // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'beforeAll'.
    beforeAll(async (done: $TSFixMe) => {
        // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'jest'.
        jest.setTimeout(init.timeout);

        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(utils.agent);

        const user = {
            email: email,
            password: password,
        };
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 2 arguments, but got 3.
        await init.registerEnterpriseUser(user, page, false);

        done();
    });

    // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'afterAll'.
    afterAll(async (done: $TSFixMe) => {
        await browser.close();
        done();
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test(
        'should show a button to add more users to oneuptime from admin dashboard',
        async (done: $TSFixMe) => {
            // navigating to dashboard url
            // automatically redirects to users route
            await page.goto(utils.ADMIN_DASHBOARD_URL, {
                waitUntil: 'networkidle0',
            });

            // if element does not exist it will timeout and throw
            const elem = await init.pageWaitForSelector(page, '#add_user', {
                visible: true,
                timeout: init.timeout,
            });
            expect(elem).toBeTruthy();

            done();
        },
        operationTimeOut
    );
});
