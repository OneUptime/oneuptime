const utils = require('../../test-utils');
const puppeteer = require('puppeteer');
const init = require('../../test-init');
let page, browser;

describe('Check api-docs up', () => {
    beforeAll(async done => {
        jest.setTimeout(init.timeout);

        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(utils.agent);
        done();
    });

    afterAll(async done => {
        await browser.close();
        done();
    });

    test(
        'should get title of api docs page',
        async done => {
            await page.goto(utils.APIDOCS_URL, {
                waitUntil: 'domcontentloaded',
            });
            const response = await init.page$Eval(
                page,
                'head > title',
                e => {
                    return e.innerHTML;
                },
                { hidden: true }
            );
            expect(response).toBe('Fyipe API Documentation');
            done();
        },
        init.timeout
    );
});
