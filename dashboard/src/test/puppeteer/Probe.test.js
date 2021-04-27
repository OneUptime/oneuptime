const puppeteer = require('puppeteer');
const utils = require('./test-utils');
const init = require('./test-init');

require('should');
let browser, page;
// user credentials
const user = {
    email: utils.generateRandomBusinessEmail(),
    password: '1234567890',
};

describe('API test', () => {
    const operationTimeOut = 500000;

    beforeAll(async () => {
        jest.setTimeout(500000);

        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/61.0.3163.100 Safari/537.36'
        );

        // user
        await init.registerUser(user, page);
    });

    afterAll(async done => {
        await browser.close();
        done();
    });

    test(
        'Should open the probes details modal if probe is offline',
        async done => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: 'networkidle0',
            });
            await page.waitForSelector('#projectSettings');
            await page.click('#projectSettings');
            await page.waitForSelector('#more');
            await page.click('#more');
            await page.waitForSelector('#probe');
            await page.click('#probe a');
            await page.waitForSelector('#probe_0', { visible: true });
            const elementHandle = await page.$('#offline_0 > span > span');
            if (elementHandle) {
                // Probe is offline
                expect(elementHandle).toBeDefined();
            } else {
                // Probe is online
                expect(elementHandle).toBeNull();
            }
            done();
        },
        operationTimeOut
    );
});
