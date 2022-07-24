import puppeteer from 'puppeteer';
import Email from 'Common/Types/Email';
import utils from '../../test-utils';
import init from '../../test-init';

import 'should';

let browser: $TSFixMe;
let page: $TSFixMe;

const email: Email = utils.generateRandomBusinessEmail();
const password = '1234567890';
const user: $TSFixMe = {
    email,
    password,
};

describe('Enterprise Admin Dashboard API', () => {
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
        'Should login to admin dashboard and create a new user with correct details',
        async (done: $TSFixMe) => {
            await init.registerEnterpriseUser(user, page);

            const localStorageData: $TSFixMe = await page.evaluate(() => {
                const json: $TSFixMe = {};
                for (let i: $TSFixMe = 0; i < localStorage.length; i++) {
                    const key: $TSFixMe = localStorage.key(i);

                    json[key] = localStorage.getItem(key);
                }
                return json;
            });

            localStorageData.should.have.property('access_token');
            localStorageData.should.have.property(
                'email',
                'masteradmin@hackerbay.io'
            );
            page.url().should.containEql(utils.ADMIN_DASHBOARD_URL);
            done();
        },
        init.timeout
    );
});
