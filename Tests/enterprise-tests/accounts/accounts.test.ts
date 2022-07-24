import puppeteer from 'puppeteer';
import Email from 'Common/Types/Email';
import utils from '../../test-utils';
import init from '../../test-init';

import 'should';

let browser: $TSFixMe, page: $TSFixMe;
// User credentials
const email: Email = utils.generateRandomBusinessEmail();
const password = '1234567890';

const user: $TSFixMe = {
    email,
    password,
};

describe('Enterprise Accounts API', () => {
    const operationTimeOut: $TSFixMe = init.timeout;

    beforeAll(async (done: $TSFixMe) => {
        jest.setTimeout(init.timeout);

        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(utils.agent);
        await init.registerEnterpriseUser(user, page);

        done();
    });

    afterAll(async (done: $TSFixMe) => {
        browser.close();
        done();
    });

    it(
        'Should login valid user',
        async (done: $TSFixMe) => {
            await init.logout(page);
            await init.loginUser(user, page);

            const localStorageData: $TSFixMe = await page.evaluate(() => {
                const json: $TSFixMe = {};
                for (let i: $TSFixMe = 0; i < localStorage.length; i++) {
                    const key: $TSFixMe = localStorage.key(i);

                    json[key] = localStorage.getItem(key);
                }
                return json;
            });

            localStorageData.should.have.property('access_token');
            localStorageData.should.have.property('email', email);
            page.url().should.containEql(utils.DASHBOARD_URL);
            done();
        },
        operationTimeOut
    );
});
