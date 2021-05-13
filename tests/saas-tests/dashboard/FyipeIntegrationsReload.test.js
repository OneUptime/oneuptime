const puppeteer = require('puppeteer');
const utils = require('../../test-utils');
const init = require('../../test-init');

let browser, page;
const user = {
    email: utils.generateRandomBusinessEmail(),
    password: '1234567890',
};

const componentName = utils.generateRandomString();
const monitorName = utils.generateRandomString();
const webHookEndpoint = utils.generateRandomWebsite();

/** This is a test to check:
 * No errors on page reload
 * It stays on the same page on reload
 */

describe('Fyipe Page Reload', () => {
    const operationTimeOut = init.timeout;

    beforeAll(async done => {
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

    afterAll(async done => {
        await browser.close();
        done();
    });

    test(
        'Should reload the incidents page and confirm there are no errors',
        async done => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });
            await init.pageClick(page, '#projectSettings');
            await init.pageClick(page, '#integrations');
            await page.waitForSelector('#addSlackButton', { visible: true });
            await init.pageClick(page, '#addWebhookButton');
            await init.pageType(page, '#endpoint', webHookEndpoint);
            await init.selectByText(
                '#monitorId',
                `${componentName} / ${monitorName}`,
                page
            );
            await init.selectByText('#endpointType', 'GET', page);
            await init.pageClick(page, '#createWebhook');
            await page.waitForSelector('#createWebhook', { hidden: true });
            //To confirm no errors and stays on the same page on reload
            await page.waitForSelector('#webhook_name');
            await page.reload({ waitUntil: 'networkidle2' });
            await page.waitForSelector('#cbIntegrations', { visible: true });
            const spanElement = await page.waitForSelector('#addSlackButton', {
                visible: true,
            });
            expect(spanElement).toBeDefined();
            done();
        },
        operationTimeOut
    );
});
