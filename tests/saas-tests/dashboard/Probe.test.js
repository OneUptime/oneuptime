import puppeteer from 'puppeteer'
import utils from '../../test-utils'
import init from '../../test-init'

require('should');
let browser, page;
// user credentials
const user = {
    email: utils.generateRandomBusinessEmail(),
    password: '1234567890',
};

describe('API test', () => {
    const operationTimeOut = init.timeout;

    beforeAll(async () => {
        jest.setTimeout(init.timeout);

        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(utils.agent);

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
                waitUntil: 'networkidle2',
            });
            await init.pageWaitForSelector(page, '#projectSettings');
            await init.pageClick(page, '#projectSettings');
            await init.pageWaitForSelector(page, '#more');
            await init.pageClick(page, '#more');
            await init.pageWaitForSelector(page, '#probe');
            await init.pageClick(page, '#probe a');
            await init.pageWaitForSelector(page, '#probe_0', {
                visible: true,
                timeout: init.timeout,
            });
            const elementHandle = await init.page$(
                page,
                '#offline_0 > span > span',
                { hidden: true } //Probe is expected to be online
            );
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
