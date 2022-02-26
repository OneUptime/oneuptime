// @ts-expect-error ts-migrate(2307) FIXME: Cannot find module 'puppeteer' or its correspondin... Remove this comment to see the full error message
import puppeteer from 'puppeteer'
import utils from '../../test-utils'
import init from '../../test-init'

require('should');
let browser: $TSFixMe, page: $TSFixMe;
// user credentials
const email = utils.generateRandomBusinessEmail();
const password = '1234567890';

const user = {
    email,
    password,
};
// @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'describe'. Do you need to instal... Remove this comment to see the full error message
describe('Alert Warning', () => {
    const operationTimeOut = init.timeout;

    // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'beforeAll'.
    beforeAll(async (done: $TSFixMe) => {
        // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'jest'.
        jest.setTimeout(init.timeout);

        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(utils.agent);

        await init.registerUser(user, page);
        done();
    });

    // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'afterAll'.
    afterAll(async (done: $TSFixMe) => {
        await browser.close();
        done();
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
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
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#projectSettings');
            await init.pageWaitForSelector(page, '#billing', {
                visible: true,
                timeout: init.timeout,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
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

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
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
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#projectSettings');
            await init.pageWaitForSelector(page, '#billing', {
                visible: true,
                timeout: init.timeout,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#billing a');
            await init.pageWaitForSelector(page, '#alertEnable', {
                visible: true,
                timeout: init.timeout,
            });

            const rowLength = await init.page$$Eval(
                page,
                '#alertOptionRow > div.bs-Fieldset-row',
                (rows: $TSFixMe) => rows.length
            );

            if (rowLength === 1) {
                // enable sms and call alerts
                // check the box
                await page.evaluate(() => {
                    // @ts-expect-error ts-migrate(2531) FIXME: Object is possibly 'null'.
                    document.querySelector('#alertEnable').click();
                    // @ts-expect-error ts-migrate(2531) FIXME: Object is possibly 'null'.
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
