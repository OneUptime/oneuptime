import puppeteer from 'puppeteer';
import Email from 'Common/Types/Email';
import utils from '../../test-utils';
import init from '../../test-init';

import 'should';
let browser: $TSFixMe, page: $TSFixMe;
// user credentials
const email: $TSFixMe: Email = utils.generateRandomBusinessEmail();
const password: string = '1234567890';

const user: $TSFixMe = {
    email,
    password,
};

describe('Alert Warning', () => {
    const operationTimeOut: $TSFixMe = init.timeout;

    beforeAll(async (done: $TSFixMe) => {
        jest.setTimeout(init.timeout);

        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(utils.agent);

        await init.registerUser(user, page);
        done();
    });

    afterAll(async (done: $TSFixMe) => {
        await browser.close();
        done();
    });

    test(
        'Should show a warning alert if call and sms alerts are disabled',
        async (done: $TSFixMe) => {
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

            const element: $TSFixMe = await init.pageWaitForSelector(
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
        async (done: $TSFixMe) => {
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

            const rowLength: $TSFixMe = await init.page$$Eval(
                page,
                '#alertOptionRow > div.bs-Fieldset-row',
                (rows: $TSFixMe) => rows.length
            );

            if (rowLength === 1) {
                // enable sms and call alerts
                // check the box
                await page.evaluate(() => {
                    document.querySelector('#alertEnable').click();

                    document.querySelector('#alertOptionSave').click();
                });
            }
            const element: $TSFixMe = await init.pageWaitForSelector(
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
