const puppeteer = require('puppeteer');
const utils = require('../../test-utils');
const init = require('../../test-init');

let browser, page;
const user = {
    email: utils.generateRandomBusinessEmail(),
    password: '1234567890',
};

const monitorSlaName = utils.generateRandomString()


/** This is a test to check:
 * No errors on page reload
 * It stays on the same page on reload
 */

describe('Fyipe Page Reload', () => {
    const operationTimeOut = 100000;

    beforeAll(async done => {
        jest.setTimeout(100000);

        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/61.0.3163.100 Safari/537.36'
        );
        await init.registerUser(user, page); // This automatically routes to dashboard page        
        done();
    });

    afterAll(async done => {
        await browser.close();
        done();
    });

    test(
        'Should reload the incidents page and confirm there are no errors',
        async done => {
            await page.goto(utils.DASHBOARD_URL);
            await init.pageClick(page, '#projectSettings');
            await init.pageClick(page, '#more');
            await init.pageClick(page, '#monitor');
            await init.pageClick(page, '#addMonitorSlaBtn');
            await init.pageType(page, '#name', monitorSlaName);
            await init.selectByText('#frequncyOption', 'Every 3 months', page);
            await init.selectByText('#monitorUptimeOption', '99.90%', page);
            await init.pageClick(page, '#createSlaBtn');
            await page.waitForSelector('#createSlaBtn', { hidden: true });
            await page.waitForSelector(`#monitorSla_${monitorSlaName}`, { visible: true });
            //To confirm no errors and stays on the same page on reload            
            await page.reload({ waitUntil: 'networkidle0' });
            await page.waitForSelector('#cbMonitors', { visible: true });
            const spanElement = await page.waitForSelector(`#monitorSla_${monitorSlaName}`, { visible: true });
            expect(spanElement).toBeDefined();
            done();
        },
        operationTimeOut
    );
});
