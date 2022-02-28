
import puppeteer from 'puppeteer';
import utils from '../../test-utils';
import init from '../../test-init';

let browser: $TSFixMe, page: $TSFixMe;
const user = {
    email: utils.generateRandomBusinessEmail(),
    password: '1234567890',
};

/** This is a test to check:
 * No errors on page reload
 * It stays on the same page on reload
 */


describe('OneUptime Page Reload', () => {
    const operationTimeOut = init.timeout;

    
    beforeAll(async (done: $TSFixMe) => {
        
        jest.setTimeout(init.timeout);

        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(utils.agent);

        await init.registerUser(user, page); // This automatically routes to dashboard page
        done();
    });

    
    afterAll(async (done: $TSFixMe) => {
        await browser.close();
        done();
    });

    
    test(
        'Should reload the billing page and confirm there are no errors',
        async (done: $TSFixMe) => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });
            
            await init.pageClick(page, '#projectSettings');
            
            await init.pageClick(page, '#billing');
            await init.pageWaitForSelector(page, '#Startup_month', {
                visible: true,
                timeout: init.timeout,
            });
            
            await init.pageClick(page, '#alert');
            
            await init.pageClick(page, '#alertOptionSave');
            await init.pageWaitForSelector(page, '#message-modal-message', {
                visible: true,
                timeout: init.timeout,
            });
            
            await init.pageClick(page, '#modal-ok');
            await init.pageWaitForSelector(page, '#message-modal-message', {
                hidden: true,
            });

            //To confirm no errors and stays on the same page on reload
            await page.reload({ waitUntil: 'networkidle2' });
            await init.pageWaitForSelector(page, '#cbBilling', {
                visible: true,
                timeout: init.timeout,
            });
            const spanElement = await init.pageWaitForSelector(
                page,
                '#Startup_month',
                {
                    visible: true,
                    timeout: init.timeout,
                }
            );
            expect(spanElement).toBeDefined();
            done();
        },
        operationTimeOut
    );
});
