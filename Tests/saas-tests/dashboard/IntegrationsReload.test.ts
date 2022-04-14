import puppeteer from 'puppeteer';
import utils from '../../test-utils';
import init from '../../test-init';

let browser: $TSFixMe, page: $TSFixMe;
const user: $TSFixMe = {
    email: utils.generateRandomBusinessEmail(),
    password: '1234567890',
};

const componentName: string = utils.generateRandomString();
const monitorName: string = utils.generateRandomString();
const webHookEndpoint = utils.generateRandomWebsite();

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
        await page.setViewport({ width: 1024, height: 1600 });
        await page.setUserAgent(utils.agent);
        await page.addStyleTag({
            content: '{scroll-behavior: auto !important;}',
        });

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
        'Should reload the integrations page and confirm there are no errors',
        async (done: $TSFixMe) => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });

            await init.pageClick(page, '#projectSettings');

            await init.pageClick(page, '#integrations');

            await init.pageClick(page, '#addWebhookButton');

            await init.pageType(page, '#endpoint', webHookEndpoint);

            await init.pageClick(page, '#monitorDropdown');

            await init.pageClick(page, `#${monitorName}`);

            await init.pageClick(page, 'label[for=monitorId]');
            await init.selectDropdownValue('#endpointType', 'GET', page);

            await init.pageClick(page, '#createWebhook');
            await init.pageWaitForSelector(page, '#createWebhook', {
                hidden: true,
            });
            //To confirm no errors and stays on the same page on reload

            await init.pageWaitForSelector(page, '#webhook_name');
            await page.reload({ waitUntil: 'networkidle2' });
            await init.pageWaitForSelector(page, '#cbIntegrations', {
                visible: true,
                timeout: init.timeout,
            });
            const spanElement = await init.pageWaitForSelector(
                page,
                '#addWebhookButton',
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
