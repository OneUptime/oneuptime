const utils = require('./test-utils');
const puppeteer = require('puppeteer');

let page, browser;

describe('Check Server', () => {
    beforeAll(async () => {
        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
    });

    afterAll(async () => {
        await browser.close();
    });

    test('should get hosts mapping from server', async () => {
        await page.goto(`${utils.BACKEND_URL}/server/hosts`, {
            waitUntil: 'networkidle0',
        });
        const response = await page.$eval('body > pre', e => {
            return e.innerHTML;
        });

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
                    '{"api":"https://staging.fyipe.com/api","home":"https://staging.fyipe.com","accounts":"https://staging.fyipe.com/accounts","dashboard":"https://staging.fyipe.com/dashboard"}';
            } else {
                expectedResponse =
                    '{"api":"https://fyipe.com/api","home":"https://fyipe.com","accounts":"https://fyipe.com/accounts","dashboard":"https://fyipe.com/dashboard"}';
            }
        }
        expect(response).toBe(expectedResponse);
    });

    test('should get saas status true from server', async () => {
        await page.goto(`${utils.BACKEND_URL}/server/is-saas-service`, {
            waitUntil: 'networkidle0',
        });
        const response = await page.$eval('body > pre', e => {
            return e.innerHTML;
        });
        expect(response).toBe('{"result":true}');
    });
});
