import utils from '../../test-utils';
import init from '../../test-init';
// @ts-expect-error ts-migrate(2307) FIXME: Cannot find module 'puppeteer' or its correspondin... Remove this comment to see the full error message
import puppeteer from 'puppeteer';

let page: $TSFixMe, browser: $TSFixMe;

// @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'describe'. Do you need to instal... Remove this comment to see the full error message
describe('Check Server', () => {
    // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'beforeAll'.
    beforeAll(async (done: $TSFixMe) => {
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
    test('should get hosts mapping from server', async (done: $TSFixMe) => {
        await page.goto(`${utils.BACKEND_URL}/server/hosts`, {
            waitUntil: 'networkidle2',
        });
        const response = await init.page$Eval(
            page,
            'body > pre',
            (e: $TSFixMe) => {
                return e.innerHTML;
            }
        );

        let expectedResponse;
        if (utils.BACKEND_URL.includes('localhost')) {
            if (utils.BACKEND_URL.includes('localhost:')) {
                expectedResponse =
                    '{"api":"http://localhost:3002/api","home":"http://localhost:1444","accounts":"http://localhost:3003/accounts","dashboard":"http://localhost:3000/dashboard"}';
            } else {
                expectedResponse =
                    '{"api":"http://localhost/api","home":"http://localhost","accounts":"http://localhost/accounts","dashboard":"http://localhost/dashboard"}';
            }
        } else {
            if (utils.BACKEND_URL.includes('staging.')) {
                expectedResponse =
                    '{"api":"https://staging.oneuptime.com/api","home":"https://staging.oneuptime.com","accounts":"https://staging.oneuptime.com/accounts","dashboard":"https://staging.oneuptime.com/dashboard"}';
            } else {
                expectedResponse =
                    '{"api":"https://oneuptime.com/api","home":"https://oneuptime.com","accounts":"https://oneuptime.com/accounts","dashboard":"https://oneuptime.com/dashboard"}';
            }
        }
        expect(response).toBe(expectedResponse);
        done();
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test('should get saas status true from server', async (done: $TSFixMe) => {
        await page.goto(`${utils.BACKEND_URL}/server/is-saas-service`, {
            waitUntil: 'networkidle2',
        });
        const response = await init.page$Eval(
            page,
            'body > pre',
            (e: $TSFixMe) => {
                return e.innerHTML;
            }
        );
        expect(response).toBe('{"result":true}');
        done();
    });
});
