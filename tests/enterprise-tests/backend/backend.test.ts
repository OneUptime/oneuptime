import utils from '../../test-utils';

import puppeteer from 'puppeteer';
import init from '../../test-init';

let page: $TSFixMe, browser: $TSFixMe;

describe('Enterprise Backend API', () => {
    beforeAll(async (done: $TSFixMe) => {
        jest.setTimeout(init.timeout);

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

    test('should get status ok from backend', async (done: $TSFixMe) => {
        await page.goto(utils.BACKEND_URL, {
            waitUntil: 'networkidle2',
        });
        const response = await init.page$Eval(
            page,
            'body > pre',
            (e: $TSFixMe) => {
                return e.innerHTML;
            }
        );
        expect(response).toBe(
            '{"status":200,"message":"Service Status - OK","serviceType":"oneuptime-api"}'
        );
        done();
    });
});
