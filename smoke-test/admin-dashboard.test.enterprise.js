const puppeteer = require('puppeteer');
const utils = require('./test-utils');
const init = require('./test-init');

require('should');

let browser;
let page;

const email = utils.generateRandomBusinessEmail();
const password = '1234567890';
const user = {
    email,
    password,
};

describe('Enterprise Admin Dashboard API', () => {
    beforeAll(async () => {
        jest.setTimeout(100000);
        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/61.0.3163.100 Safari/537.36'
        );
    });

    afterAll(async () => {
        await browser.close();
    });

    it('Should login to admin dashboard and create a new user with correct details', async () => {
        await init.registerEnterpriseUser(user, page);

        const localStorageData = await page.evaluate(() => {
            const json = {};
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                json[key] = localStorage.getItem(key);
            }
            return json;
        });

        await page.waitFor(10000);
        localStorageData.should.have.property('access_token');
        localStorageData.should.have.property(
            'email',
            'masteradmin@hackerbay.io'
        );
        page.url().should.containEql(utils.ADMIN_DASHBOARD_URL);
    }, 200000);
});
