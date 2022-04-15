import puppeteer from 'puppeteer';
import Email from 'Common/Types/Email';

import utils from '../../test-utils';
import init from '../../test-init';
let browser: $TSFixMe, page: $TSFixMe;
import 'should';

const email: Email = utils.generateRandomBusinessEmail();
const password: string = '1234567890';

describe('Users Component (IS_SAAS_SERVICE=false)', () => {
    const operationTimeOut: $TSFixMe = init.timeout;

    beforeAll(async (done: $TSFixMe) => {
        jest.setTimeout(init.timeout);

        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(utils.agent);

        const user: $TSFixMe = {
            email: email,
            password: password,
        };

        await init.registerEnterpriseUser(user, page, false);

        done();
    });

    afterAll(async (done: $TSFixMe) => {
        await browser.close();
        done();
    });

    test(
        'should show a button to add more users to oneuptime from admin dashboard',
        async (done: $TSFixMe) => {
            /*
             * Navigating to dashboard url
             * Automatically redirects to users route
             */
            await page.goto(utils.ADMIN_DASHBOARD_URL, {
                waitUntil: 'networkidle0',
            });

            // If element does not exist it will timeout and throw
            const elem: $TSFixMe = await init.pageWaitForSelector(
                page,
                '#add_user',
                {
                    visible: true,
                    timeout: init.timeout,
                }
            );
            expect(elem).toBeTruthy();

            done();
        },
        operationTimeOut
    );
});
