import utils from '../../test-utils';
import init from '../../test-init';

import puppeteer from 'puppeteer';

let page: $TSFixMe, browser: $TSFixMe;

describe('Check Server', () => {
    beforeAll(async (done: $TSFixMe) => {
        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        done();
    });

    afterAll(async (done: $TSFixMe) => {
        await browser.close();
        done();
    });

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
