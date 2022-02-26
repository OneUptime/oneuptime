import utils from '../../test-utils'
// @ts-expect-error ts-migrate(2307) FIXME: Cannot find module 'puppeteer' or its correspondin... Remove this comment to see the full error message
import puppeteer from 'puppeteer'
import init from '../../test-init'
let page: $TSFixMe, browser: $TSFixMe;

// @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'describe'. Do you need to instal... Remove this comment to see the full error message
describe('Check Backend', () => {
    // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'beforeAll'.
    beforeAll(async (done: $TSFixMe) => {
        // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'jest'.
        jest.setTimeout(init.timeout);

        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        done();
    });

    // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'afterAll'.
    afterAll(async (done: $TSFixMe) => {
        await browser.close();
        done();
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test('should get status ok from backend', async (done: $TSFixMe) => {
        await page.goto(utils.BACKEND_URL + '/api', {
            waitUntil: 'networkidle2',
        });
        const response = await init.page$Eval(page, 'body > pre', (e: $TSFixMe) => {
            return e.innerHTML;
        });
        expect(response).toBe(
            '{"backend":{"status":200,"message":"Service Status - OK","serviceType":"oneuptime-api"},"database":{"status":"Up","message":"Mongodb database connection is healthy"},"redis":{"status":"Up","message":"Redis connection is healthy"}}'
        );
        done();
    });
});
