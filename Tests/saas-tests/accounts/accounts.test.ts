import puppeteer from 'puppeteer';
import utils from '../../test-utils';
import init from '../../test-init';

import 'should';

let browser: $TSFixMe;
let page: $TSFixMe;

const email = utils.generateRandomBusinessEmail();
const password = '1234567890';
const user = {
    email,
    password,
};

describe('Login API', () => {
    beforeAll(async (done: $TSFixMe) => {
        jest.setTimeout(init.timeout);

        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(utils.agent);
        done();
    });

    afterAll(async (done: $TSFixMe) => {
        await browser.close();
        done();
    });

    it(
        'Should login valid User',
        async (done: $TSFixMe) => {
            await init.registerUser(user, page); // This automatically routes to dashboard.
            await init.saasLogout(page);
            await init.loginUser(user, page); // Items required are only available when 'loginUser' is initiated.

            const localStorageData = await page.evaluate(() => {
                const json = {};
                for (let i = 0; i < localStorage.length; i++) {
                    const key = localStorage.key(i);

                    json[key] = localStorage.getItem(key);
                }
                return json;
            });

            localStorageData.should.have.property('access_token');
            localStorageData.should.have.property(
                'email',
                utils.BACKEND_URL.includes('localhost') ||
                    utils.BACKEND_URL.includes('staging')
                    ? email
                    : 'user@oneuptime.com'
            );
            page.url().should.containEql(utils.DASHBOARD_URL);
            done();
        },
        init.timeout
    );
});
