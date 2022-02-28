import utils from '../../test-utils';

import puppeteer from 'puppeteer';
import init from '../../test-init';
let page: $TSFixMe, browser: $TSFixMe;

describe('Check api-docs up', () => {
    beforeAll(async (done: $TSFixMe) => {
        jest.setTimeout(init.timeout);

        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(utils.agent);
        done();
    });

    afterAll(async (done: $TSFixMe) => {
        await browser.close();
        done();
    });

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

                { hidden: true }
            );
            expect(response).toBe('OneUptime API Documentation');
            done();
        },
        init.timeout
    );
});
