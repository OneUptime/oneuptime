const puppeteer = require('puppeteer');
const utils = require('../../test-utils');
const init = require('../../test-init');

require('should');
let browser, page;
// user credentials
const email = utils.generateRandomBusinessEmail();
const password = '1234567890';
const user = {
    email,
    password,
};

describe('Project API', () => {
    const operationTimeOut = init.timeout;

    beforeAll(async done => {
        jest.setTimeout(init.timeout);

        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(utils.agent);
        // user
        await init.registerUser(user, page);

        done();
    });

    afterAll(async done => {
        await browser.close();
        done();
    });

    test(
        'Should create new project from dropdown after login',
        async done => {
            const projectName = utils.generateRandomString();
            //Login is no longer required as Dashboard page is loaded automatically.
            await page.waitForSelector('#selector', { visible: true, timeout: init.timeout });
            await page.$eval('#create-project', e => e.click());
            await page.waitForSelector('#name', { visible: true, timeout: init.timeout });
            await page.waitForSelector('input[id=name]', { visible: true, timeout: init.timeout });
            await init.pageClick(page, 'input[id=name]');
            await page.focus('input[id=name]');
            await init.pageType(page, 'input[id=name]', projectName);
            await init.pageClick(page, 'input[id=Startup_month]');
            await init.pageClick(page, 'button[type=submit]');
            await page.waitForSelector(`#cb${projectName}`, { visible: true, timeout: init.timeout });
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
