import utils from '../../test-utils';
import init from '../../test-init';

import puppeteer from 'puppeteer';

let page: $TSFixMe, browser: $TSFixMe;

describe('Check Enterprise Server', () => {
    beforeAll(async (done: $TSFixMe) => {
        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        done();
    });

    afterAll(async (done: $TSFixMe) => {
        await browser.close();
        done();
    });

    test('should get saas status false from server', async (done: $TSFixMe) => {
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
        expect(response).toBe('{"result":false}');
        done();
    });
});
