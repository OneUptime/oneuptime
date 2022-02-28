
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
const webHookName = utils.generateRandomString();
const newWebHookName = utils.generateRandomString();
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
        'Should navigate to monitor details and create a slack webhook',
        async (done: $TSFixMe) => {
            // Navigate to Monitor details
            await init.navigateToMonitorDetails(
                componentName,
                monitorName,
                page
            );
            // click on integrations tab
            
            await init.pageClick(page, '.integrations-tab');

            const addButtonSelector = '#addSlackButton';
            
            await init.pageWaitForSelector(page, addButtonSelector);
            await init.page$Eval(page, addButtonSelector, (e: $TSFixMe) =>
                e.click()
            );

            
            await init.pageWaitForSelector(page, '#endpoint');

            
            await init.pageType(page, '#webHookName', webHookName);
            
            await init.pageType(page, '#endpoint', webhookEndpoint);

            await page.evaluate(() => {
                
                document.querySelector('input[name=incidentCreated]').click();
            });

            //Only the NAME is rendered as well as the ACTIONS to be performed.
            const createdWebhookSelector = `#name_slack_${webHookName}`;

            await init.page$Eval(page, '#createSlack', (e: $TSFixMe) =>
                e.click()
            );
            await init.pageWaitForSelector(page, '#createSlack', {
                hidden: true,
            });
            
            await init.pageWaitForSelector(page, createdWebhookSelector);

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
        'Should navigate to monitor details and update a Slack webhook',
        async (done: $TSFixMe) => {
            // Navigate to Monitor details
            await init.navigateToMonitorDetails(
                componentName,
                monitorName,
                page
            );
            // click on integrations tab
            
            await init.pageClick(page, '.integrations-tab');

            const existingWebhookSelector = `#name_slack_${webHookName}`;

            
            await init.pageWaitForSelector(page, existingWebhookSelector);

            const existingWebhookName = await init.page$Eval(
                page,
                existingWebhookSelector,
                (el: $TSFixMe) => el.textContent
            );

            expect(existingWebhookName).toEqual(webHookName);

            const editWebhookButtonSelector = `#edit_slack_${webHookName}`;
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
            await init.page$Eval(page, '#slackUpdate', (e: $TSFixMe) =>
                e.click()
            );
            await init.pageWaitForSelector(page, '#slackUpdate', {
                hidden: true,
            });
            
            await init.pageWaitForSelector(
                page,
                `#name_slack_${newWebHookName}`
            );
            const updatedWebhookName = await init.page$Eval(
                page,
                `#name_slack_${newWebHookName}`,
                (el: $TSFixMe) => el.textContent
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
            // click on integrations tab
            
            await init.pageClick(page, '.integrations-tab');
            const createdWebhookSelector = '.slack-list';
            
            await init.pageWaitForSelector(page, createdWebhookSelector);

            
            const webhookRows = await init.page$$(page, createdWebhookSelector);
            const countWebhooks = webhookRows.length;

            expect(countWebhooks).toEqual(1);

            const deleteWebhookButtonSelector = `#delete_slack_${newWebHookName}`;
            await init.page$Eval(
                page,
                deleteWebhookButtonSelector,
                (e: $TSFixMe) => e.click()
            );

            
            await init.pageWaitForSelector(page, '#slackDelete');
            await init.page$Eval(page, '#slackDelete', (e: $TSFixMe) =>
                e.click()
            );
            await init.pageWaitForSelector(page, '#slackDelete', {
                hidden: true,
            });

            
            let newWebhookRows = await init.pageWaitForSelector(
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
            // click on integrations tab
            
            await init.pageClick(page, '.integrations-tab');
            const addButtonSelector = '#addSlackButton';
            
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
                await init.page$Eval(page, '#createSlack', (e: $TSFixMe) =>
                    e.click()
                );
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

            const createdWebhookSelector = '.slack-list';
            
            await init.pageWaitForSelector(page, createdWebhookSelector);

            
            let webhookRows = await init.page$$(page, createdWebhookSelector);
            let countWebhooks = webhookRows.length;

            expect(countWebhooks).toEqual(10);

            
            const nextSelector = await init.page$(page, '#btnNextSlack');

            await nextSelector.click();

            
            await init.pageWaitForSelector(page, createdWebhookSelector);

            
            webhookRows = await init.page$$(page, createdWebhookSelector);
            countWebhooks = webhookRows.length;

            expect(countWebhooks).toEqual(1);

            
            const prevSelector = await init.page$(page, '#btnPrevSlack');

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
