import puppeteer from 'puppeteer';
import Email from 'Common/Types/Email';
import utils from '../../test-utils';
import init from '../../test-init';

import 'should';
let browser: $TSFixMe, page: $TSFixMe;
// User credentials
const email: Email = utils.generateRandomBusinessEmail();
const password: string = '1234567890';
const monitorName: string = utils.generateRandomString();
const componentName: string = utils.generateRandomString();
const webHookName: string = utils.generateRandomString();
const newWebHookName: string = utils.generateRandomString();
const webhookEndpoint: $TSFixMe = utils.generateRandomWebsite();
const priorityName: string = utils.generateRandomString();

describe('Monitor Detail API', () => {
    const operationTimeOut: $TSFixMe = init.timeout;

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

        // User
        await init.registerUser(user, page);
        // Add new monitor to component on parent project
        await init.addMonitorToComponent(componentName, monitorName, page);
        await init.addIncidentPriority(priorityName, page);
    });

    afterAll(async (done: $TSFixMe) => {
        await browser.close();
        done();
    });

    test(
        'Should navigate to monitor details and create a slack webhook',
        async (done: $TSFixMe) => {
            // Navigate to Monitor details
            await init.navigateToMonitorDetails(
                componentName,
                monitorName,
                page
            );
            // Click on integrations tab

            await init.pageClick(page, '.integrations-tab');

            const addButtonSelector: string = '#addSlackButton';

            await init.pageWaitForSelector(page, addButtonSelector);
            await init.page$Eval(page, addButtonSelector, (e: $TSFixMe) => {
                return e.click();
            });

            await init.pageWaitForSelector(page, '#endpoint');

            await init.pageType(page, '#webHookName', webHookName);

            await init.pageType(page, '#endpoint', webhookEndpoint);

            await page.evaluate(() => {
                document.querySelector('input[name=incidentCreated]').click();
            });

            //Only the NAME is rendered as well as the ACTIONS to be performed.
            const createdWebhookSelector: string = `#name_slack_${webHookName}`;

            await init.page$Eval(page, '#createSlack', (e: $TSFixMe) => {
                return e.click();
            });
            await init.pageWaitForSelector(page, '#createSlack', {
                hidden: true,
            });

            await init.pageWaitForSelector(page, createdWebhookSelector);

            const createdWebhookName: $TSFixMe = await init.page$Eval(
                page,
                createdWebhookSelector,
                (el: $TSFixMe) => {
                    return el.textContent;
                }
            );
            expect(createdWebhookName).toEqual(webHookName);
            done();
        },
        operationTimeOut
    );

    test(
        'Should navigate to monitor details and update a Slack webhook',
        async (done: $TSFixMe) => {
            // Navigate to Monitor details
            await init.navigateToMonitorDetails(
                componentName,
                monitorName,
                page
            );
            // Click on integrations tab

            await init.pageClick(page, '.integrations-tab');

            const existingWebhookSelector: string = `#name_slack_${webHookName}`;

            await init.pageWaitForSelector(page, existingWebhookSelector);

            const existingWebhookName: $TSFixMe = await init.page$Eval(
                page,
                existingWebhookSelector,
                (el: $TSFixMe) => {
                    return el.textContent;
                }
            );

            expect(existingWebhookName).toEqual(webHookName);

            const editWebhookButtonSelector: string = `#edit_slack_${webHookName}`;
            await init.page$Eval(
                page,
                editWebhookButtonSelector,
                (e: $TSFixMe) => {
                    return e.click();
                }
            );

            const newWebhookEndpoint: $TSFixMe = utils.generateRandomWebsite();
            await init.pageClick(page, '#webHookName', { clickCount: 3 });

            await init.pageType(page, '#webHookName', newWebHookName);
            await init.pageClick(page, '#endpoint', { clickCount: 3 });

            await init.pageType(page, '#endpoint', newWebhookEndpoint);
            await init.page$Eval(page, '#slackUpdate', (e: $TSFixMe) => {
                return e.click();
            });
            await init.pageWaitForSelector(page, '#slackUpdate', {
                hidden: true,
            });

            await init.pageWaitForSelector(
                page,
                `#name_slack_${newWebHookName}`
            );
            const updatedWebhookName: $TSFixMe = await init.page$Eval(
                page,
                `#name_slack_${newWebHookName}`,
                (el: $TSFixMe) => {
                    return el.textContent;
                }
            );
            expect(updatedWebhookName).toEqual(newWebHookName);
            done();
        },
        operationTimeOut
    );

    test(
        'Should navigate to monitor details and delete a slack webhook',
        async (done: $TSFixMe) => {
            // Navigate to Monitor details
            await init.navigateToMonitorDetails(
                componentName,
                monitorName,
                page
            );
            // Click on integrations tab

            await init.pageClick(page, '.integrations-tab');
            const createdWebhookSelector: string = '.slack-list';

            await init.pageWaitForSelector(page, createdWebhookSelector);

            const webhookRows: $TSFixMe = await init.page$$(
                page,
                createdWebhookSelector
            );
            const countWebhooks: $TSFixMe = webhookRows.length;

            expect(countWebhooks).toEqual(1);

            const deleteWebhookButtonSelector: string = `#delete_slack_${newWebHookName}`;
            await init.page$Eval(
                page,
                deleteWebhookButtonSelector,
                (e: $TSFixMe) => {
                    return e.click();
                }
            );

            await init.pageWaitForSelector(page, '#slackDelete');
            await init.page$Eval(page, '#slackDelete', (e: $TSFixMe) => {
                return e.click();
            });
            await init.pageWaitForSelector(page, '#slackDelete', {
                hidden: true,
            });

            let newWebhookRows: $TSFixMe = await init.pageWaitForSelector(
                page,
                '#No_SlackTeam'
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
        'Should navigate to monitor details and get list of slack webhooks and paginate them',
        async (done: $TSFixMe) => {
            // Navigate to Monitor details
            await init.navigateToMonitorDetails(
                componentName,
                monitorName,
                page
            );
            // Click on integrations tab

            await init.pageClick(page, '.integrations-tab');
            const addButtonSelector: string = '#addSlackButton';

            await init.pageWaitForSelector(page, addButtonSelector);

            for (let i: $TSFixMe = 0; i < 11; i++) {
                await init.page$Eval(page, addButtonSelector, (e: $TSFixMe) => {
                    return e.click();
                });

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
                await init.page$Eval(page, '#createSlack', (e: $TSFixMe) => {
                    return e.click();
                });
                await init.pageWaitForSelector(page, '#createSlack', {
                    hidden: true,
                });
            }

            await init.navigateToMonitorDetails(
                componentName,
                monitorName,
                page
            );

            await init.pageClick(page, '.integrations-tab');

            const createdWebhookSelector: string = '.slack-list';

            await init.pageWaitForSelector(page, createdWebhookSelector);

            let webhookRows: $TSFixMe = await init.page$$(
                page,
                createdWebhookSelector
            );
            let countWebhooks: $TSFixMe = webhookRows.length;

            expect(countWebhooks).toEqual(10);

            const nextSelector: $TSFixMe = await init.page$(
                page,
                '#btnNextSlack'
            );

            await nextSelector.click();

            await init.pageWaitForSelector(page, createdWebhookSelector);

            webhookRows = await init.page$$(page, createdWebhookSelector);
            countWebhooks = webhookRows.length;

            expect(countWebhooks).toEqual(1);

            const prevSelector: $TSFixMe = await init.page$(
                page,
                '#btnPrevSlack'
            );

            await prevSelector.click();

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
