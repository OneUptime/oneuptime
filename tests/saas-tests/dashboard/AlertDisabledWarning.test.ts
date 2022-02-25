import puppeteer from 'puppeteer'
import utils from '../../test-utils'
import init from '../../test-init'

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
    const operationTimeOut = init.timeout;

    beforeAll(async done => {
        jest.setTimeout(init.timeout);

        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(utils.agent);

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
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });
            await init.pageWaitForSelector(page, '#projectSettings', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageClick(page, '#projectSettings');
            await init.pageWaitForSelector(page, '#billing', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageClick(page, '#billing');

            const element = await init.pageWaitForSelector(
                page,
                '#alertWarning',
                {
                    visible: true,
                    timeout: init.timeout,
                }
            );
            expect(element).toBeDefined();
            done();
        },
        operationTimeOut
    );

    test(
        'Should not show any warning alert if call and sms alerts are enabled',
        async done => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });
            await init.pageWaitForSelector(page, '#projectSettings', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageClick(page, '#projectSettings');
            await init.pageWaitForSelector(page, '#billing', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageClick(page, '#billing a');
            await init.pageWaitForSelector(page, '#alertEnable', {
                visible: true,
                timeout: init.timeout,
            });

            const rowLength = await init.page$$Eval(
                page,
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
            const element = await init.pageWaitForSelector(
                page,
                '#alertWarning',
                {
                    hidden: true,
                }
            );
            expect(element).toBeNull();
            done();
        },
        operationTimeOut
    );
});
