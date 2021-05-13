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
    const operationTimeOut = 50000;

    beforeAll(async done => {
        jest.setTimeout(init.timeout);

        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/61.0.3163.100 Safari/537.36'
        );

        // Register user
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
            await page.goto(utils.DASHBOARD_URL, {
            waitUntil: ['networkidle2'],
        });
            await page.waitForSelector('#selector', { visible: true });
            await page.$eval('#create-project', e => e.click());
            await page.waitForSelector('#name', { visible: true });
            await page.waitForSelector('input[id=name]', { visible: true });
            await init.pageClick(page, 'input[id=name]');
            await page.focus('input[id=name]');
            await init.pageType(
                page,
                'input[id=name]',
                utils.generateRandomString()
            );
            await init.pageClick(page, 'input[id=Startup_month]');
            await Promise.all([
                init.pageClick(page, 'button[type=submit]'),
                page.waitForNavigation(),
            ]);
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

    test(
        'Should switch project using project switcher',
        async done => {
            await page.goto(utils.DASHBOARD_URL, {
            waitUntil: ['networkidle2'],
        });
            await page.waitForSelector('#AccountSwitcherId', { visible: true });
            await init.pageClick(page, '#AccountSwitcherId');
            await page.waitForSelector('#accountSwitcher', { visible: true });

            const element = await page.$(
                '#accountSwitcher > div[title="Unnamed Project"]'
            );

            await element.click();
            await page.waitForNavigation();
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
