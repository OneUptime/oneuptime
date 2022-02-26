import utils from '../../test-utils'
// @ts-expect-error ts-migrate(2307) FIXME: Cannot find module 'puppeteer' or its correspondin... Remove this comment to see the full error message
import puppeteer from 'puppeteer'
import init from '../../test-init'
let page: $TSFixMe, browser: $TSFixMe;

// @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'describe'. Do you need to instal... Remove this comment to see the full error message
describe('Check api-docs up', () => {
    // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'beforeAll'.
    beforeAll(async (done: $TSFixMe) => {
        // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'jest'.
        jest.setTimeout(init.timeout);

        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(utils.agent);
        done();
    });

    // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'afterAll'.
    afterAll(async (done: $TSFixMe) => {
        await browser.close();
        done();
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test(
        'should get title of api docs page',
        async (done: $TSFixMe) => {
            await page.goto(utils.APIDOCS_URL, {
                waitUntil: 'domcontentloaded',
            });
            const response = await init.page$Eval(
                page,
                'head > title',
                (e: $TSFixMe) => {
                    return e.innerHTML;
                },
                // @ts-expect-error ts-migrate(2345) FIXME: Argument of type '{ hidden: boolean; }' is not ass... Remove this comment to see the full error message
                { hidden: true }
            );
            expect(response).toBe('OneUptime API Documentation');
            done();
        },
        init.timeout
    );
});
