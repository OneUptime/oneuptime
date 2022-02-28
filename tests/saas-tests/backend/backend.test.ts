import utils from '../../test-utils';

import puppeteer from 'puppeteer';
import init from '../../test-init';
let page: $TSFixMe, browser: $TSFixMe;

describe('Check Backend', () => {
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

    test('should get status ok from backend', async (done: $TSFixMe) => {
        await page.goto(utils.BACKEND_URL + '/api', {
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
            '{"backend":{"status":200,"message":"Service Status - OK","serviceType":"oneuptime-api"},"database":{"status":"Up","message":"Mongodb database connection is healthy"},"redis":{"status":"Up","message":"Redis connection is healthy"}}'
        );
        done();
    });
});
