
import puppeteer from 'puppeteer';
import utils from '../../test-utils';
import init from '../../test-init';

let browser: $TSFixMe, page: $TSFixMe;
const user = {
    email: utils.generateRandomBusinessEmail(),
    password: '1234567890',
};
const componentName = utils.generateRandomString();
const monitorName = utils.generateRandomString();
const scheduleMaintenanceName = utils.generateRandomString();

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
        await init.addComponent(componentName, page);
        await init.addNewMonitorToComponent(page, componentName, monitorName);
        done();
    });

    
    afterAll(async (done: $TSFixMe) => {
        await browser.close();
        done();
    });

    
    test(
        'Should reload the scheduled maintenance page and confirm there are no errors',
        async (done: $TSFixMe) => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });
            
            await init.pageClick(page, '#scheduledMaintenance');
            
            await init.pageClick(page, '#addScheduledEventButton');
            await init.pageWaitForSelector(page, '#scheduledEventForm', {
                visible: true,
                timeout: init.timeout,
            });
            
            await init.pageClick(page, '#name');
            
            await init.pageType(page, '#name', scheduleMaintenanceName);
            
            await init.pageClick(page, '#createScheduledEventButton');
            await init.pageWaitForSelector(page, '#scheduledEventForm', {
                hidden: true,
            });
            
            await init.pageClick(page, '#viewScheduledEvent_0');
            await init.pageWaitForSelector(
                page,
                `#editScheduledEvent-${scheduleMaintenanceName}`,
                { visible: true, timeout: init.timeout }
            );

            // To confirm no errors and stays on the same page on reload
            await page.reload({ waitUntil: 'networkidle2' });
            await init.pageWaitForSelector(
                page,
                '#cbScheduledMaintenanceEvent',
                {
                    visible: true,
                    timeout: init.timeout,
                }
            );
            await init.pageWaitForSelector(
                page,
                `#cb${scheduleMaintenanceName}`,
                {
                    visible: true,
                    timeout: init.timeout,
                }
            );
            const spanElement = await init.pageWaitForSelector(
                page,
                `#editScheduledEvent-${scheduleMaintenanceName}`,
                { visible: true, timeout: init.timeout }
            );
            expect(spanElement).toBeDefined();
            done();
        },
        operationTimeOut
    );
});
