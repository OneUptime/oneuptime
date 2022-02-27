// @ts-expect-error ts-migrate(2307) FIXME: Cannot find module 'puppeteer' or its correspondin... Remove this comment to see the full error message
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

// @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'describe'. Do you need to instal... Remove this comment to see the full error message
describe('Monitor Detail API', () => {
    const operationTimeOut = init.timeout;

    // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'beforeAll'.
    beforeAll(async () => {
        // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'jest'.
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

    // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'afterAll'.
    afterAll(async (done: $TSFixMe) => {
        await browser.close();
        done();
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
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
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '.integrations-tab');
            const addButtonSelector = '#addWebhookButton';
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, addButtonSelector);
            await init.page$Eval(page, addButtonSelector, (e: $TSFixMe) =>
                e.click()
            );

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#endpoint');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await init.pageType(page, '#endpoint', webhookEndpoint);
            await init.selectDropdownValue('#endpointType', 'GET', page);

            await page.evaluate(() => {
                // @ts-expect-error ts-migrate(2531) FIXME: Object is possibly 'null'.
                document.querySelector('input[name=incidentCreated]').click();
            });

            const createdWebhookSelector = '#webhook_name';

            await init.page$Eval(page, '#createWebhook', (e: $TSFixMe) =>
                e.click()
            );
            await init.pageWaitForSelector(page, '#createWebhook', {
                hidden: true,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
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

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
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
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '.integrations-tab');

            const addButtonSelector = '#addWebhookButton';
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, addButtonSelector);

            for (let i = 0; i < 10; i++) {
                await init.page$Eval(page, addButtonSelector, (e: $TSFixMe) =>
                    e.click()
                );
                // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
                await init.pageWaitForSelector(page, '#endpoint');

                // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
                await init.pageType(
                    page,
                    '#endpoint',
                    utils.generateRandomWebsite()
                );
                await init.selectDropdownValue('#endpointType', 'GET', page);
                await page.evaluate(() => {
                    // @ts-expect-error ts-migrate(2531) FIXME: Object is possibly 'null'.
                    document
                        .querySelector('input[name=incidentCreated]')
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'click' does not exist on type 'Element'.
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
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '.integrations-tab');

            const createdWebhookSelector = '.webhook-list';
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, createdWebhookSelector);

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
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

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, createdWebhookSelector);
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
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

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, createdWebhookSelector);
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            webhookRows = await init.page$$(page, createdWebhookSelector);
            countWebhooks = webhookRows.length;
            expect(countWebhooks).toEqual(10);

            done();
        },
        operationTimeOut
    );

    /**Tests Split */
});
