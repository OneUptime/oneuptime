import puppeteer from 'puppeteer';
import Email from 'Common/Types/Email';
import utils from '../../test-utils';
import init from '../../test-init';

import 'should';
let browser: $TSFixMe, page: $TSFixMe;
// User credentials
const email: Email = utils.generateRandomBusinessEmail();
const password: string = '1234567890';
const user: $TSFixMe = {
    email,
    password,
};

describe('New Monitor API', () => {
    const operationTimeOut: $TSFixMe = 1000000;

    beforeAll(async (done: $TSFixMe) => {
        jest.setTimeout(init.timeout);

        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(utils.agent);
        // User
        await init.registerUser(user, page);
        done();
    });

    afterAll(async (done: $TSFixMe) => {
        await browser.close();
        done();
    });

    test(
        "should show upgrade modal if the current monitor count of a project equals it's monitor limit (Growth plan => 10 Monitors/User)",
        async (done: $TSFixMe) => {
            const projectName: string = utils.generateRandomString();
            const componentName: string = utils.generateRandomString();
            await init.addGrowthProject(projectName, page);
            /*
             * Create a component
             * Redirects automatically component to details page
             */
            await init.addComponent(componentName, page);
            // This the first monitor
            const firstMonitorName: string = utils.generateRandomString();
            await init.addNewMonitorToComponent(
                page,
                componentName,
                firstMonitorName
            );

            for (let i: $TSFixMe = 0; i < 9; i++) {
                /*
                 * This adds 9 more monitors
                 * The Interface for adding additional monitor has been updated
                 */
                const monitorName: string = utils.generateRandomString();

                await init.addAdditionalMonitorToComponent(
                    page,
                    componentName,
                    monitorName
                );
                await init.pageWaitForSelector(page, '.ball-beat', {
                    hidden: true,
                });
            }
            // Try to add more monitor
            const monitorName: string = utils.generateRandomString();
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });
            await init.pageWaitForSelector(page, '#components', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#components');
            await init.pageWaitForSelector(page, '#component0', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, `#more-details-${componentName}`);

            await init.pageWaitForSelector(page, '#cbMonitors');

            await init.pageClick(page, '#newFormId');
            await init.pageWaitForSelector(page, '#form-new-monitor', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageWaitForSelector(page, 'input[id=name]', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageWaitForSelector(page, 'input[id=name]', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, 'input[id=name]');
            await page.focus('input[id=name]');

            await init.pageType(page, 'input[id=name]', monitorName);
            // Added new URL-Montior

            await init.pageClick(page, '[data-testId=type_url]');
            await init.pageWaitForSelector(page, '#url', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#url');

            await init.pageType(page, '#url', 'https://google.com');

            await init.pageClick(page, 'button[type=submit]');

            const pricingPlanModal: $TSFixMe = await init.pageWaitForSelector(
                page,
                '#pricingPlanModal',
                { visible: true, timeout: init.timeout }
            );
            expect(pricingPlanModal).toBeTruthy();
            done();
        },
        operationTimeOut
    );
    /** Test Split*/
});
