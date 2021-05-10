const puppeteer = require('puppeteer');
const utils = require('../../../test-utils');
const init = require('../../../test-init');

require('should');

let browser, page;
// user credentials

const email = utils.generateRandomBusinessEmail();
const password = '1234567890';

const user = {
    email,
    password,
};

describe('Enterprise Project API', () => {
    const operationTimeOut = 100000;

    beforeAll(async done => {
        jest.setTimeout(200000);
        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/61.0.3163.100 Safari/537.36'
        );
        // Register user
        await init.registerEnterpriseUser(user, page);
        done();
    });

    afterAll(async done => {
        browser.close();
        done();
    });

    test(
        'Should create new project from dropdown after login for disabled payment',
        async done => {
            await init.adminLogout(page);
            await init.loginUser(user, page);
            await page.waitForSelector('#selector', { visble: true });
            await page.$eval('#create-project', e => e.click());
            await page.waitForSelector('#name', { visble: true });
            await page.click('input[id=name]');
            await page.type('input[id=name]', utils.generateRandomString());

            const projectPlan = await page.$('input[id=Startup_month]');
            expect(projectPlan).toBeDefined(); // Startup_month is part of the modal that gets popped out.

            await page.click('button[type=submit]');
            // eslint-disable-next-line no-undef
            localStorageData = await page.evaluate(() => {
                const json = {};
                for (let i = 0; i < localStorage.length; i++) {
                    const key = localStorage.key(i);
                    json[key] = localStorage.getItem(key);
                }
                return json;
            });
            // eslint-disable-next-line no-undef
            localStorageData.should.have.property('project');
            done();
        },
        operationTimeOut
    );
});
