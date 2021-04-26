const puppeteer = require('puppeteer');
const utils = require('./test-utils');
const init = require('./test-init');

require('should');

let browser, page;
// user credentials
const email = utils.generateRandomBusinessEmail();
const password = '1234567890';

const user = {
    email,
    password,
};

describe('Enterprise Accounts API', () => {
    const operationTimeOut = 100000;

    beforeAll(async done => {
        jest.setTimeout(200000);
        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/61.0.3163.100 Safari/537.36'
        );
        await init.registerEnterpriseUser(user, page);

        done();
    });

    afterAll(async done => {
        browser.close();
        done();
    });

    it(
        'Should login valid user',
        async done => {
            await init.logout(page);
            await init.loginUser(user, page);

            const localStorageData = await page.evaluate(() => {
                const json = {};
                for (let i = 0; i < localStorage.length; i++) {
                    const key = localStorage.key(i);
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
