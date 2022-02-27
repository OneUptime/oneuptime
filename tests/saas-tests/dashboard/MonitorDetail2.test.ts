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
const subscriberEmail = utils.generateRandomBusinessEmail();
const webHookName = utils.generateRandomString();
const newWebHookName = utils.generateRandomString();
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
        'Should navigate to monitor details and create a new subscriber',
        async (done: $TSFixMe) => {
            // Navigate to Monitor details
            await init.navigateToMonitorDetails(
                componentName,
                monitorName,
                page
            );

            // click on subscribers tab
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '.subscribers-tab');

            const addButtonSelector = '#addSubscriberButton';
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, addButtonSelector);
            await init.page$Eval(page, addButtonSelector, (e: $TSFixMe) =>
                e.click()
            );

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#alertViaId');

            await init.selectDropdownValue('#alertViaId', 'email', page);
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await init.pageType(page, 'input[name=email]', subscriberEmail);
            await init.page$Eval(page, '#createSubscriber', (e: $TSFixMe) =>
                e.click()
            );
            await init.pageWaitForSelector(page, '#createSubscriber', {
                hidden: true,
            });

            const createdSubscriberSelector = '#subscriber_contact';

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, createdSubscriberSelector);

            const createdSubscriberEmail = await init.page$Eval(
                page,
                createdSubscriberSelector,
                (el: $TSFixMe) => el.textContent
            );

            expect(createdSubscriberEmail).toEqual(subscriberEmail);
            done();
        },
        operationTimeOut
    );

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test(
        'Should navigate to monitor details and get list of subscribers and paginate subscribers',
        async (done: $TSFixMe) => {
            // Navigate to Monitor details
            await init.navigateToMonitorDetails(
                componentName,
                monitorName,
                page
            );

            // click on subscribers tab
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '.subscribers-tab');
            const addButtonSelector = '#addSubscriberButton';
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, addButtonSelector);

            for (let i = 0; i < 5; i++) {
                await init.page$Eval(page, addButtonSelector, (e: $TSFixMe) =>
                    e.click()
                );
                // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
                await init.pageWaitForSelector(page, '#alertViaId');
                await init.selectDropdownValue('#alertViaId', 'email', page);
                // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
                await init.pageType(
                    page,
                    'input[name=email]',
                    utils.generateRandomBusinessEmail()
                );
                await init.page$Eval(page, '#createSubscriber', (e: $TSFixMe) =>
                    e.click()
                );
                await init.pageWaitForSelector(page, '#createSubscriber', {
                    hidden: true,
                });
            }

            const createdSubscriberSelector = '#numberOfSubscribers';

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, createdSubscriberSelector);

            let subscriberRows = await init.page$Eval(
                page,
                createdSubscriberSelector,
                (elem: $TSFixMe) => elem.textContent
            );
            let countSubscribers = subscriberRows;
            // Total number of subscribers is rendered and not first 5.
            expect(countSubscribers).toEqual('6');

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            const nextSelector = await init.page$(page, '#btnNextSubscriber');
            await nextSelector.click();

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, createdSubscriberSelector);

            subscriberRows = await init.page$Eval(
                page,
                createdSubscriberSelector,
                (elem: $TSFixMe) => elem.textContent
            );
            countSubscribers = subscriberRows;

            // Navigating to the next page did not affect the subscriber count.
            expect(countSubscribers).toEqual('6');

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            const prevSelector = await init.page$(page, '#btnPrevSubscriber');
            await prevSelector.click();
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, createdSubscriberSelector);

            subscriberRows = await init.page$Eval(
                page,
                createdSubscriberSelector,
                (elem: $TSFixMe) => elem.textContent
            );
            countSubscribers = subscriberRows;

            expect(countSubscribers).toEqual('6');
            done();
        },
        operationTimeOut
    );

    //MS Teams
    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test(
        'Should navigate to monitor details and create a msteams webhook',
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

            const addButtonSelector = '#addMsTeamsButton';
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, addButtonSelector);
            await init.page$Eval(page, addButtonSelector, (e: $TSFixMe) =>
                e.click()
            );

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#endpoint');

            // Name is required to submit a msteams webhook AND only name is rendered. webHookEndPoint only shows when edit button is clicked.
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await init.pageType(page, '#webHookName', webHookName);
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await init.pageType(page, '#endpoint', webhookEndpoint);

            await page.evaluate(() => {
                // @ts-expect-error ts-migrate(2531) FIXME: Object is possibly 'null'.
                document.querySelector('input[name=incidentCreated]').click();
            });

            const createdWebhookSelector = `#msteam_${webHookName}`;

            await init.page$Eval(page, '#createMsTeams', (e: $TSFixMe) =>
                e.click()
            );
            await init.pageWaitForSelector(page, '#createMsTeams', {
                hidden: true,
            });
            await init.pageWaitForSelector(page, createdWebhookSelector, {
                visible: true,
                timeout: 50000,
            });
            // When an MSTeams is created, only 'Name' and 'Action' are rendered
            //MSTeams Endpoint is no longer rendered
            const createdWebhookName = await init.page$Eval(
                page,
                createdWebhookSelector,
                (el: $TSFixMe) => el.textContent
            );
            expect(createdWebhookName).toEqual(webHookName);
            done();
        },
        operationTimeOut
    );

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test(
        'Should navigate to monitor details and update a msteams webhook',
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

            const existingWebhookSelector = `#msteam_${webHookName}`;

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, existingWebhookSelector);

            const existingWebhookName = await init.page$Eval(
                page,
                existingWebhookSelector,
                (el: $TSFixMe) => el.textContent
            );

            expect(existingWebhookName).toEqual(webHookName);

            const editWebhookButtonSelector = `#edit_msteam_${webHookName}`;
            await init.page$Eval(
                page,
                editWebhookButtonSelector,
                (e: $TSFixMe) => e.click()
            );

            const newWebhookEndpoint = utils.generateRandomWebsite();
            await init.pageClick(page, '#webHookName', { clickCount: 3 });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await init.pageType(page, '#webHookName', newWebHookName);
            await init.pageClick(page, '#endpoint', { clickCount: 3 });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await init.pageType(page, '#endpoint', newWebhookEndpoint);
            await init.page$Eval(page, '#msteamsUpdate', (e: $TSFixMe) =>
                e.click()
            );
            await init.pageWaitForSelector(page, '#msteamsUpdate', {
                hidden: true,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, `#msteam_${newWebHookName}`);
            const updatedWebhookName = await init.page$Eval(
                page,
                `#msteam_${newWebHookName}`,
                (el: $TSFixMe) => el.textContent
            );
            expect(updatedWebhookName).toEqual(newWebHookName);
            done();
        },
        operationTimeOut
    );

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test(
        'Should navigate to monitor details and delete a msteams webhook',
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

            const createdWebhookSelector = '.msteam-length';
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, createdWebhookSelector);

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            const webhookRows = await init.page$$(page, createdWebhookSelector);
            const countWebhooks = webhookRows.length;

            expect(countWebhooks).toEqual(1);

            const deleteWebhookButtonSelector = `#delete_msteam_${newWebHookName}`;
            await init.page$Eval(
                page,
                deleteWebhookButtonSelector,
                (e: $TSFixMe) => e.click()
            );

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#msteamsDelete');
            await init.page$Eval(page, '#msteamsDelete', (e: $TSFixMe) =>
                e.click()
            );
            await init.pageWaitForSelector(page, '#msteamsDelete', {
                hidden: true,
            });

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            let newWebhookRows = await init.pageWaitForSelector(
                page,
                '#No_MsTeam'
            );
            newWebhookRows = await newWebhookRows.getProperty('innerText');
            newWebhookRows = await newWebhookRows.jsonValue();
            expect(newWebhookRows).toMatch(
                "You don't have any webhook added. Do you want to add one?"
            );
            done();
        },
        operationTimeOut
    );

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test(
        'Should navigate to monitor details and get list of msteams webhooks and paginate them',
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

            const addButtonSelector = '#addMsTeamsButton';
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, addButtonSelector);

            for (let i = 0; i < 11; i++) {
                await init.page$Eval(page, addButtonSelector, (e: $TSFixMe) =>
                    e.click()
                );
                // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
                await init.pageWaitForSelector(page, '#endpoint');
                // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
                await init.pageType(
                    page,
                    '#webHookName',
                    utils.generateRandomString()
                );
                // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
                await init.pageType(
                    page,
                    '#endpoint',
                    utils.generateRandomWebsite()
                );
                await page.evaluate(() => {
                    // @ts-expect-error ts-migrate(2531) FIXME: Object is possibly 'null'.
                    document
                        .querySelector('input[name=incidentCreated]')
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'click' does not exist on type 'Element'.
                        .click();
                });
                await init.page$Eval(page, '#createMsTeams', (e: $TSFixMe) =>
                    e.click()
                );
                await init.pageWaitForSelector(page, '#createMsTeams', {
                    hidden: true,
                });
            }

            await page.reload({ waitUntil: 'networkidle0' });

            // click on integrations tab
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '.integrations-tab');

            const createdWebhookSelector = '.msteam-length';
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, createdWebhookSelector);

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            let webhookRows = await init.page$$(page, createdWebhookSelector);
            let countWebhooks = webhookRows.length;

            expect(countWebhooks).toEqual(10);

            await init.pageWaitForSelector(page, '#btnNextMsTeams', {
                visible: true,
                timeout: init.timeout,
            });
            await init.page$Eval(page, '#btnNextMsTeams', (elem: $TSFixMe) =>
                elem.click()
            );
            await init.pageWaitForSelector(page, '.ball-beat', {
                hidden: true,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, createdWebhookSelector);

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            webhookRows = await init.page$$(page, createdWebhookSelector);
            countWebhooks = webhookRows.length;
            expect(countWebhooks).toEqual(1);

            await init.pageWaitForSelector(page, '#btnPrevMsTeams', {
                visible: true,
                timeout: init.timeout,
            });
            await init.page$Eval(page, '#btnPrevMsTeams', (elem: $TSFixMe) =>
                elem.click()
            );
            await init.pageWaitForSelector(page, '.ball-beat', {
                hidden: true,
            });
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
