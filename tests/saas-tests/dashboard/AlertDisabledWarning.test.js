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
describe('Alert Warning', () => {
    const operationTimeOut = 1000000;

    beforeAll(async done => {
        jest.setTimeout(2000000);

        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/61.0.3163.100 Safari/537.36'
        );

        await init.registerUser(user, page);
        done();
    });

    afterAll(async done => {
        await browser.close();
        done();
    });

    test(
        'Should show a warning alert if call and sms alerts are disabled',
        async done => {
            await page.goto(utils.DASHBOARD_URL);
            await page.waitForSelector('#projectSettings', { visible: true });
            await page.click('#projectSettings');
            await page.waitForSelector('#billing', { visible: true });
            await page.click('#billing');

            const element = await page.waitForSelector('#alertWarning', {
                visible: true,
            });
            expect(element).toBeDefined();
            done();
        },
        operationTimeOut
    );

    test(
        'Should not show any warning alert if call and sms alerts are enabled',
        async done => {
            await page.goto(utils.DASHBOARD_URL);
            await page.waitForSelector('#projectSettings', { visible: true });
            await page.click('#projectSettings');
            await page.waitForSelector('#billing', { visible: true });
            await page.click('#billing a');
            await page.waitForSelector('#alertEnable', { visible: true });

            const rowLength = await page.$$eval(
                '#alertOptionRow > div.bs-Fieldset-row',
                rows => rows.length
            );

            if (rowLength === 1) {
                // enable sms and call alerts
                // check the box
                await page.evaluate(() => {
                    document.querySelector('#alertEnable').click();
                    document.querySelector('#alertOptionSave').click();
                });
            }
            const element = await page.waitForSelector('#alertWarning', {
                hidden: true,
            });
            expect(element).toBeNull();
            done();
        },
        operationTimeOut
    );
});
