import puppeteer from 'puppeteer';
import utils from '../../test-utils';
import init from '../../test-init';

require('should');
let browser: $TSFixMe, page: $TSFixMe;
// user credentials
const email = utils.generateRandomBusinessEmail();
const password = '1234567890';
const monitorName = utils.generateRandomString();
const componentName = utils.generateRandomString();
const webhookEndpoint = utils.generateRandomWebsite();
const priorityName = utils.generateRandomString();

describe('Monitor Detail API', () => {
    const operationTimeOut = init.timeout;

    beforeAll(async () => {
        jest.setTimeout(init.timeout);

        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(utils.agent);

        // Register user
        const user = {
            email,
            password,
        };

        // user
        await init.registerUser(user, page);
        // add new monitor to component on parent project
        await init.addMonitorToComponent(componentName, monitorName, page);
        await init.addIncidentPriority(priorityName, page);
    });

    afterAll(async (done: $TSFixMe) => {
        await browser.close();
        done();
    });

    test(
        'Should navigate to monitor details and create a webhook',
        async (done: $TSFixMe) => {
            // Navigate to Monitor details
            await init.navigateToMonitorDetails(
                componentName,
                monitorName,
                page
            );
            // click on integrations tab

            await init.pageClick(page, '.integrations-tab');
            const addButtonSelector = '#addWebhookButton';

            await init.pageWaitForSelector(page, addButtonSelector);
            await init.page$Eval(page, addButtonSelector, (e: $TSFixMe) =>
                e.click()
            );

            await init.pageWaitForSelector(page, '#endpoint');

            await init.pageType(page, '#endpoint', webhookEndpoint);
            await init.selectDropdownValue('#endpointType', 'GET', page);

            await page.evaluate(() => {
                document.querySelector('input[name=incidentCreated]').click();
            });

            const createdWebhookSelector = '#webhook_name';

            await init.page$Eval(page, '#createWebhook', (e: $TSFixMe) =>
                e.click()
            );
            await init.pageWaitForSelector(page, '#createWebhook', {
                hidden: true,
            });

            await init.pageWaitForSelector(page, createdWebhookSelector);

            const createdWebhookEndpoint = await init.page$Eval(
                page,
                createdWebhookSelector,
                (el: $TSFixMe) => el.textContent
            );

            expect(createdWebhookEndpoint).toEqual(webhookEndpoint);
            done();
        },
        operationTimeOut
    );

    test(
        'Should navigate to monitor details and get list of webhooks and paginate webhooks',
        async (done: $TSFixMe) => {
            // Navigate to Monitor details
            await init.navigateToMonitorDetails(
                componentName,
                monitorName,
                page
            );
            // click on integrations tab

            await init.pageClick(page, '.integrations-tab');

            const addButtonSelector = '#addWebhookButton';

            await init.pageWaitForSelector(page, addButtonSelector);

            for (let i = 0; i < 10; i++) {
                await init.page$Eval(page, addButtonSelector, (e: $TSFixMe) =>
                    e.click()
                );

                await init.pageWaitForSelector(page, '#endpoint');

                await init.pageType(
                    page,
                    '#endpoint',
                    utils.generateRandomWebsite()
                );
                await init.selectDropdownValue('#endpointType', 'GET', page);
                await page.evaluate(() => {
                    document
                        .querySelector('input[name=incidentCreated]')

                        .click();
                });
                await init.page$Eval(page, '#createWebhook', (e: $TSFixMe) =>
                    e.click()
                );
                await init.pageWaitForSelector(page, '#createWebhook', {
                    hidden: true,
                });
            }

            await init.navigateToMonitorDetails(
                componentName,
                monitorName,
                page
            );

            // click on integrations tab

            await init.pageClick(page, '.integrations-tab');

            const createdWebhookSelector = '.webhook-list';

            await init.pageWaitForSelector(page, createdWebhookSelector);

            let webhookRows = await init.page$$(page, createdWebhookSelector);
            let countWebhooks = webhookRows.length;

            expect(countWebhooks).toEqual(10);

            await init.pageWaitForSelector(page, '#btnNextWebhook', {
                visible: true,
                timeout: init.timeout,
            });
            await init.page$Eval(page, '#btnNextWebhook', (elem: $TSFixMe) =>
                elem.click()
            );

            await init.pageWaitForSelector(page, createdWebhookSelector);

            webhookRows = await init.page$$(page, createdWebhookSelector);
            countWebhooks = webhookRows.length;
            expect(countWebhooks).toEqual(1);

            // This Clicks the Previous Button
            await init.pageWaitForSelector(page, '#btnPrevWebhook', {
                visible: true,
                timeout: init.timeout,
            });
            await init.page$Eval(page, '#btnPrevWebhook', (elem: $TSFixMe) =>
                elem.click()
            );

            await init.pageWaitForSelector(page, createdWebhookSelector);

            webhookRows = await init.page$$(page, createdWebhookSelector);
            countWebhooks = webhookRows.length;
            expect(countWebhooks).toEqual(10);

            done();
        },
        operationTimeOut
    );

    /**Tests Split */
});
