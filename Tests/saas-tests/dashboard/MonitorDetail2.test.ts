import puppeteer from 'puppeteer';
import Email from 'Common/Types/Email';
import utils from '../../test-utils';
import init from '../../test-init';

import 'should';
let browser: $TSFixMe, page: $TSFixMe;
// user credentials
const email: Email = utils.generateRandomBusinessEmail();
const password: string = '1234567890';
const monitorName: string = utils.generateRandomString();
const componentName: string = utils.generateRandomString();
const subscriberEmail: Email = utils.generateRandomBusinessEmail();
const webHookName: string = utils.generateRandomString();
const newWebHookName: string = utils.generateRandomString();
const webhookEndpoint = utils.generateRandomWebsite();
const priorityName: string = utils.generateRandomString();

describe('Monitor Detail API', () => {
    const operationTimeOut = init.timeout;

    beforeAll(async () => {
        jest.setTimeout(init.timeout);

        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(utils.agent);

        // Register user
        const user: $TSFixMe = {
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
        'Should navigate to monitor details and create a new subscriber',
        async (done: $TSFixMe) => {
            // Navigate to Monitor details
            await init.navigateToMonitorDetails(
                componentName,
                monitorName,
                page
            );

            // click on subscribers tab

            await init.pageClick(page, '.subscribers-tab');

            const addButtonSelector: string = '#addSubscriberButton';

            await init.pageWaitForSelector(page, addButtonSelector);
            await init.page$Eval(page, addButtonSelector, (e: $TSFixMe) =>
                e.click()
            );

            await init.pageWaitForSelector(page, '#alertViaId');

            await init.selectDropdownValue('#alertViaId', 'email', page);

            await init.pageType(page, 'input[name=email]', subscriberEmail);
            await init.page$Eval(page, '#createSubscriber', (e: $TSFixMe) =>
                e.click()
            );
            await init.pageWaitForSelector(page, '#createSubscriber', {
                hidden: true,
            });

            const createdSubscriberSelector: string = '#subscriber_contact';

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

            await init.pageClick(page, '.subscribers-tab');
            const addButtonSelector: string = '#addSubscriberButton';

            await init.pageWaitForSelector(page, addButtonSelector);

            for (let i = 0; i < 5; i++) {
                await init.page$Eval(page, addButtonSelector, (e: $TSFixMe) =>
                    e.click()
                );

                await init.pageWaitForSelector(page, '#alertViaId');
                await init.selectDropdownValue('#alertViaId', 'email', page);

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

            const createdSubscriberSelector: string = '#numberOfSubscribers';

            await init.pageWaitForSelector(page, createdSubscriberSelector);

            let subscriberRows: $TSFixMe = await init.page$Eval(
                page,
                createdSubscriberSelector,
                (elem: $TSFixMe) => elem.textContent
            );
            let countSubscribers = subscriberRows;
            // Total number of subscribers is rendered and not first 5.
            expect(countSubscribers).toEqual('6');

            const nextSelector = await init.page$(page, '#btnNextSubscriber');
            await nextSelector.click();

            await init.pageWaitForSelector(page, createdSubscriberSelector);

            subscriberRows = await init.page$Eval(
                page,
                createdSubscriberSelector,
                (elem: $TSFixMe) => elem.textContent
            );
            countSubscribers = subscriberRows;

            // Navigating to the next page did not affect the subscriber count.
            expect(countSubscribers).toEqual('6');

            const prevSelector = await init.page$(page, '#btnPrevSubscriber');
            await prevSelector.click();

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

            await init.pageClick(page, '.integrations-tab');

            const addButtonSelector: string = '#addMsTeamsButton';

            await init.pageWaitForSelector(page, addButtonSelector);
            await init.page$Eval(page, addButtonSelector, (e: $TSFixMe) =>
                e.click()
            );

            await init.pageWaitForSelector(page, '#endpoint');

            // Name is required to submit a msteams webhook AND only name is rendered. webHookEndPoint only shows when edit button is clicked.

            await init.pageType(page, '#webHookName', webHookName);

            await init.pageType(page, '#endpoint', webhookEndpoint);

            await page.evaluate(() => {
                document.querySelector('input[name=incidentCreated]').click();
            });

            const createdWebhookSelector: string = `#msteam_${webHookName}`;

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

            await init.pageClick(page, '.integrations-tab');

            const existingWebhookSelector: string = `#msteam_${webHookName}`;

            await init.pageWaitForSelector(page, existingWebhookSelector);

            const existingWebhookName = await init.page$Eval(
                page,
                existingWebhookSelector,
                (el: $TSFixMe) => el.textContent
            );

            expect(existingWebhookName).toEqual(webHookName);

            const editWebhookButtonSelector: string = `#edit_msteam_${webHookName}`;
            await init.page$Eval(
                page,
                editWebhookButtonSelector,
                (e: $TSFixMe) => e.click()
            );

            const newWebhookEndpoint = utils.generateRandomWebsite();
            await init.pageClick(page, '#webHookName', { clickCount: 3 });

            await init.pageType(page, '#webHookName', newWebHookName);
            await init.pageClick(page, '#endpoint', { clickCount: 3 });

            await init.pageType(page, '#endpoint', newWebhookEndpoint);
            await init.page$Eval(page, '#msteamsUpdate', (e: $TSFixMe) =>
                e.click()
            );
            await init.pageWaitForSelector(page, '#msteamsUpdate', {
                hidden: true,
            });

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

            await init.pageClick(page, '.integrations-tab');

            const createdWebhookSelector: string = '.msteam-length';

            await init.pageWaitForSelector(page, createdWebhookSelector);

            const webhookRows = await init.page$$(page, createdWebhookSelector);
            const countWebhooks = webhookRows.length;

            expect(countWebhooks).toEqual(1);

            const deleteWebhookButtonSelector: string = `#delete_msteam_${newWebHookName}`;
            await init.page$Eval(
                page,
                deleteWebhookButtonSelector,
                (e: $TSFixMe) => e.click()
            );

            await init.pageWaitForSelector(page, '#msteamsDelete');
            await init.page$Eval(page, '#msteamsDelete', (e: $TSFixMe) =>
                e.click()
            );
            await init.pageWaitForSelector(page, '#msteamsDelete', {
                hidden: true,
            });

            let newWebhookRows: $TSFixMe = await init.pageWaitForSelector(
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

            await init.pageClick(page, '.integrations-tab');

            const addButtonSelector: string = '#addMsTeamsButton';

            await init.pageWaitForSelector(page, addButtonSelector);

            for (let i = 0; i < 11; i++) {
                await init.page$Eval(page, addButtonSelector, (e: $TSFixMe) =>
                    e.click()
                );

                await init.pageWaitForSelector(page, '#endpoint');

                await init.pageType(
                    page,
                    '#webHookName',
                    utils.generateRandomString()
                );

                await init.pageType(
                    page,
                    '#endpoint',
                    utils.generateRandomWebsite()
                );
                await page.evaluate(() => {
                    document
                        .querySelector('input[name=incidentCreated]')

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

            await init.pageClick(page, '.integrations-tab');

            const createdWebhookSelector: string = '.msteam-length';

            await init.pageWaitForSelector(page, createdWebhookSelector);

            let webhookRows: $TSFixMe = await init.page$$(
                page,
                createdWebhookSelector
            );
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

            await init.pageWaitForSelector(page, createdWebhookSelector);

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
