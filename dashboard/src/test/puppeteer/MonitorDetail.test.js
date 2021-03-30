const puppeteer = require('puppeteer');
const utils = require('./test-utils');
const init = require('./test-init');
const { Cluster } = require('puppeteer-cluster');

require('should');

// user credentials
const email = utils.generateRandomBusinessEmail();
const password = '1234567890';
const monitorName = utils.generateRandomString();
const newMonitorName = utils.generateRandomString();
const urlMonitorName = utils.generateRandomString();
const componentName = utils.generateRandomString();
const subscriberEmail = utils.generateRandomBusinessEmail();
const webHookName = utils.generateRandomString();
const newWebHookName = utils.generateRandomString();
const webhookEndpoint = utils.generateRandomWebsite();
const priorityName = utils.generateRandomString();
const incidentTitle = utils.generateRandomString();
const newIncidentTitle = utils.generateRandomString();

describe('Monitor Detail API', () => {
    const operationTimeOut = 500000;

    let cluster;

    beforeAll(async () => {
        jest.setTimeout(500000);

        cluster = await Cluster.launch({
            concurrency: Cluster.CONCURRENCY_PAGE,
            puppeteerOptions: utils.puppeteerLaunchConfig,
            puppeteer,
            timeout: utils.timeout,
        });

        cluster.on('taskerror', err => {
            throw err;
        });

        // Register user
        return await cluster.execute(null, async ({ page }) => {
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
    });

    afterAll(async done => {
        await cluster.idle();
        await cluster.close();
        done();
    });

    test(
        'Should navigate to details of monitor created with correct details',
        async () => {
            return await cluster.execute(null, async ({ page }) => {
                // Navigate to Monitor details
                await init.navigateToMonitorDetails(
                    componentName,
                    monitorName,
                    page
                );

                let spanElement = await page.waitForSelector(
                    `#monitor-title-${monitorName}`
                );
                spanElement = await spanElement.getProperty('innerText');
                spanElement = await spanElement.jsonValue();
                spanElement.should.be.exactly(monitorName);
            });
        },
        operationTimeOut
    );

    test(
        'Should navigate to monitor details and create an incident',
        async () => {
            // expect.assertions(2);
            return await cluster.execute(null, async ({ page }) => {
                // Navigate to Monitor details
                await init.navigateToMonitorDetails(
                    componentName,
                    monitorName,
                    page
                );

                await page.waitForSelector(`#createIncident_${monitorName}`);
                await page.$eval(`#createIncident_${monitorName}`, e =>
                    e.click()
                );
                await page.waitForSelector('#createIncident');
                await init.selectByText('#incidentType', 'Offline', page);
                await init.selectByText(
                    '#incidentPriority',
                    priorityName,
                    page
                );
                await page.click('#title', { clickCount: 3 });
                // await page.keyboard.press('Backspace');
                await page.type('#title', incidentTitle);
                await page.$eval('#createIncident', e => e.click());
                await page.waitForSelector('#closeIncident_0', {
                    visible: true,
                });
                await page.$eval('#closeIncident_0', elem => elem.click());

                await page.waitForSelector('#numberOfIncidents');

                const selector = await page.$eval(
                    '#numberOfIncidents',
                    elem => elem.textContent
                );
                expect(selector).toMatch('1');

                await page.waitForSelector(`#name_${priorityName}`, {
                    visible: true,
                });
                const selector1 = `#name_${priorityName}`;
                const rowContent = await page.$eval(
                    selector1,
                    e => e.textContent
                );
                expect(rowContent).toMatch(priorityName);
            });
        },
        operationTimeOut
    );

    test(
        "Should navigate to monitor's incident details and edit details",
        async () => {
            return await cluster.execute(null, async ({ page }) => {
                // Navigate to Monitor details
                await init.navigateToMonitorDetails(
                    componentName,
                    monitorName,
                    page
                );

                const selector = `#incident_${monitorName}_0`;
                await page.waitForSelector(selector);
                await page.$eval(selector, e => e.click());
                const incidentTitleSelector = '#incidentTitle';
                await page.waitForSelector(incidentTitleSelector, {
                    visible: true,
                });
                let currentTitle = await page.$eval(
                    incidentTitleSelector,
                    e => e.textContent
                );
                expect(currentTitle).toEqual(incidentTitle);
                // The Edit Button has been removed and replaced with another functions
                await page.click('#incidentTitle');
                await page.click('#title', { clickCount: 3 });
                await page.keyboard.press('Backspace');
                await page.type('#title', newIncidentTitle);
                await page.keyboard.press('Enter');
                await page.waitForSelector(incidentTitleSelector);
                currentTitle = await page.$eval(
                    incidentTitleSelector,
                    e => e.textContent
                );
                expect(currentTitle).toEqual(newIncidentTitle);
            });
        },
        operationTimeOut
    );

    test(
        'Should navigate to monitor details and open the incident creation pop up',
        async () => {
            return await cluster.execute(null, async ({ page }) => {
                // Navigate to Monitor details
                await init.navigateToMonitorDetails(
                    componentName,
                    monitorName,
                    page
                );

                // tab the create incident button over thee monitor view header
                await page.waitForSelector(
                    `#monitorCreateIncident_${monitorName}`
                );
                await page.$eval(`#monitorCreateIncident_${monitorName}`, e =>
                    e.click()
                );
                await page.waitForSelector('#incidentTitleLabel');
                let spanElement = await page.waitForSelector(
                    `#incidentTitleLabel`
                );
                spanElement = await spanElement.getProperty('innerText');
                spanElement = await spanElement.jsonValue();
                spanElement.should.be.exactly('Create New Incident');
            });
        },
        operationTimeOut
    );

    test(
        'Should navigate to monitor details and get list of incidents and paginate incidents',
        async () => {
            // expect.assertions(2);
            return await cluster.execute(null, async ({ page }) => {
                // Navigate to Monitor details
                await init.navigateToMonitorDetails(
                    componentName,
                    monitorName,
                    page
                );

                const nextSelector = await page.waitForSelector('#btnNext');
                await nextSelector.click();

                let incidentRows = '#numberOfIncidents';

                let countIncidents = await page.$eval(
                    incidentRows,
                    elem => elem.textContent
                );
                expect(countIncidents).toEqual('1');

                const prevSelector = await page.waitForSelector('#btnPrev');
                await prevSelector.click();

                incidentRows = '#numberOfIncidents';
                countIncidents = await page.$eval(
                    incidentRows,
                    elem => elem.textContent
                );
                expect(countIncidents).toEqual('1');
            });
        },
        operationTimeOut
    );

    test(
        'Should delete an incident and redirect to the monitor page',
        async () => {
            return await cluster.execute(null, async ({ page }) => {
                // Navigate to Monitor details
                await init.navigateToMonitorDetails(
                    componentName,
                    monitorName,
                    page
                );
                const selector = `#incident_${monitorName}_0`;
                await page.waitForSelector(selector);
                await page.$eval(selector, e => e.click());

                // click on advance option tab
                await init.gotoTab(utils.incidentTabIndexes.ADVANCE, page);

                await page.waitForSelector('#deleteIncidentButton', {
                    visible: true,
                });
                await page.$eval('#deleteIncidentButton', e => e.click());
                await page.waitForSelector('#confirmDeleteIncident', {
                    visible: true,
                });
                await page.$eval('#confirmDeleteIncident', e => e.click());
                await page.waitForSelector(`#cb${monitorName}`, {
                    visible: true,
                });
                // await page.waitForNavigation();

                // click on basic tab
                await init.gotoTab(utils.incidentTabIndexes.BASIC, page);

                let incidentCountSpanElement = await page.waitForSelector(
                    `#numberOfIncidents`
                );
                incidentCountSpanElement = await incidentCountSpanElement.getProperty(
                    'innerText'
                );
                incidentCountSpanElement = await incidentCountSpanElement.jsonValue();

                expect(incidentCountSpanElement).toMatch('0 Incident');
            });
        },
        operationTimeOut
    );

    test(
        'Should navigate to monitor details and create a new subscriber',
        async () => {
            // expect.assertions(1);
            return await cluster.execute(null, async ({ page }) => {
                // Navigate to Monitor details
                await init.navigateToMonitorDetails(
                    componentName,
                    monitorName,
                    page
                );

                // click on subscribers tab
                await init.gotoTab(utils.monitorTabIndexes.SUBSCRIBERS, page);

                const addButtonSelector = '#addSubscriberButton';
                await page.waitForSelector(addButtonSelector);
                await page.$eval(addButtonSelector, e => e.click());

                await page.waitForSelector('#alertViaId');

                await init.selectByText('#alertViaId', 'email', page);
                await page.type('input[name=email]', subscriberEmail);
                await page.$eval('#createSubscriber', e => e.click());
                await page.waitForSelector('#createSubscriber', {
                    hidden: true,
                });

                const createdSubscriberSelector = '#subscriber_contact';

                await page.waitForSelector(createdSubscriberSelector);

                const createdSubscriberEmail = await page.$eval(
                    createdSubscriberSelector,
                    el => el.textContent
                );

                expect(createdSubscriberEmail).toEqual(subscriberEmail);
            });
        },
        operationTimeOut
    );

    test(
        'Should navigate to monitor details and get list of subscribers and paginate subscribers',
        async () => {
            return await cluster.execute(null, async ({ page }) => {
                // Navigate to Monitor details
                await init.navigateToMonitorDetails(
                    componentName,
                    monitorName,
                    page
                );

                // click on subscribers tab
                await init.gotoTab(utils.monitorTabIndexes.SUBSCRIBERS, page);
                const addButtonSelector = '#addSubscriberButton';
                await page.waitForSelector(addButtonSelector);

                for (let i = 0; i < 5; i++) {
                    await page.$eval(addButtonSelector, e => e.click());
                    await page.waitForSelector('#alertViaId');
                    await init.selectByText('#alertViaId', 'email', page);
                    await page.type(
                        'input[name=email]',
                        utils.generateRandomBusinessEmail()
                    );
                    await page.$eval('#createSubscriber', e => e.click());
                    await page.waitForSelector('#createSubscriber', {
                        hidden: true,
                    });
                }

                const createdSubscriberSelector = '#numberOfSubscribers';

                await page.waitForSelector(createdSubscriberSelector);

                let subscriberRows = await page.$eval(
                    createdSubscriberSelector,
                    elem => elem.textContent
                );
                let countSubscribers = subscriberRows;
                // Total number of subscribers is rendered and not first 5.
                expect(countSubscribers).toEqual('6');

                const nextSelector = await page.$('#btnNextSubscriber');
                await nextSelector.click();

                await page.waitForSelector(createdSubscriberSelector);

                subscriberRows = await page.$eval(
                    createdSubscriberSelector,
                    elem => elem.textContent
                );
                countSubscribers = subscriberRows;

                // Navigating to the next page did not affect the subscriber count.
                expect(countSubscribers).toEqual('6');

                const prevSelector = await page.$('#btnPrevSubscriber');
                await prevSelector.click();
                await page.waitForSelector(createdSubscriberSelector);

                subscriberRows = await page.$eval(
                    createdSubscriberSelector,
                    elem => elem.textContent
                );
                countSubscribers = subscriberRows;

                expect(countSubscribers).toEqual('6');
            });
        },
        operationTimeOut
    );

    //MS Teams
    test(
        'Should navigate to monitor details and create a msteams webhook',
        async () => {
            expect.assertions(1);
            return await cluster.execute(null, async ({ page }) => {
                // Navigate to Monitor details
                await init.navigateToMonitorDetails(
                    componentName,
                    monitorName,
                    page
                );

                // click on integrations tab
                await init.gotoTab(utils.monitorTabIndexes.INTEGRATION, page);

                const addButtonSelector = '#addMsTeamsButton';
                await page.waitForSelector(addButtonSelector);
                await page.$eval(addButtonSelector, e => e.click());

                await page.waitForSelector('#endpoint');

                // Name is required to submit a msteams webhook AND only name is rendered. webHookEndPoint only shows when edit button is clicked.
                await page.type('#webHookName', webHookName);
                await page.type('#endpoint', webhookEndpoint);

                await page.evaluate(() => {
                    document
                        .querySelector('input[name=incidentCreated]')
                        .click();
                });

                const createdWebhookSelector = `#msteam_${webHookName}`;

                await page.$eval('#createMsTeams', e => e.click());
                await page.waitForSelector('#createMsTeams', { hidden: true });
                await page.waitForSelector(createdWebhookSelector, {
                    visible: true,
                    timeout: 50000,
                });
                // When an MSTeams is created, only 'Name' and 'Action' are rendered
                //MSTeams Endpoint is no longer rendered
                const createdWebhookName = await page.$eval(
                    createdWebhookSelector,
                    el => el.textContent
                );
                expect(createdWebhookName).toEqual(webHookName);
            });
        },
        operationTimeOut
    );

    test(
        'Should navigate to monitor details and update a msteams webhook',
        async () => {
            // expect.assertions(2);
            return await cluster.execute(null, async ({ page }) => {
                // Navigate to Monitor details
                await init.navigateToMonitorDetails(
                    componentName,
                    monitorName,
                    page
                );
                // click on integrations tab
                await init.gotoTab(utils.monitorTabIndexes.INTEGRATION, page);

                const existingWebhookSelector = `#msteam_${webHookName}`;

                await page.waitForSelector(existingWebhookSelector);

                const existingWebhookName = await page.$eval(
                    existingWebhookSelector,
                    el => el.textContent
                );

                expect(existingWebhookName).toEqual(webHookName);

                const editWebhookButtonSelector = `#edit_msteam_${webHookName}`;
                await page.$eval(editWebhookButtonSelector, e => e.click());

                const newWebhookEndpoint = utils.generateRandomWebsite();
                await page.click('#webHookName', { clickCount: 3 });
                await page.type('#webHookName', newWebHookName);
                await page.click('#endpoint', { clickCount: 3 });
                await page.type('#endpoint', newWebhookEndpoint);
                await page.$eval('#msteamsUpdate', e => e.click());
                await page.waitForSelector('#msteamsUpdate', { hidden: true });
                await page.waitForSelector(`#msteam_${newWebHookName}`);
                const updatedWebhookName = await page.$eval(
                    `#msteam_${newWebHookName}`,
                    el => el.textContent
                );
                expect(updatedWebhookName).toEqual(newWebHookName);
            });
        },
        operationTimeOut
    );

    test(
        'Should navigate to monitor details and delete a msteams webhook',
        async () => {
            // expect.assertions(2);
            return await cluster.execute(null, async ({ page }) => {
                // Navigate to Monitor details
                await init.navigateToMonitorDetails(
                    componentName,
                    monitorName,
                    page
                );
                // click on integrations tab
                await init.gotoTab(utils.monitorTabIndexes.INTEGRATION, page);

                const createdWebhookSelector = '.msteam-length';
                await page.waitForSelector(createdWebhookSelector);

                let webhookRows = await page.$$(createdWebhookSelector);
                let countWebhooks = webhookRows.length;

                expect(countWebhooks).toEqual(1);

                const deleteWebhookButtonSelector = `#delete_msteam_${newWebHookName}`;
                await page.$eval(deleteWebhookButtonSelector, e => e.click());

                await page.waitForSelector('#msteamsDelete');
                await page.$eval('#msteamsDelete', e => e.click());
                await page.waitForSelector('#msteamsDelete', { hidden: true });

                webhookRows = await page.$$(createdWebhookSelector);
                countWebhooks = webhookRows.length;

                expect(countWebhooks).toEqual(0);
            });
        },
        operationTimeOut
    );

    test(
        'Should navigate to monitor details and get list of msteams webhooks and paginate them',
        async () => {
            return await cluster.execute(null, async ({ page }) => {
                // Navigate to Monitor details
                await init.navigateToMonitorDetails(
                    componentName,
                    monitorName,
                    page
                );

                // click on integrations tab
                await init.gotoTab(utils.monitorTabIndexes.INTEGRATION, page);

                const addButtonSelector = '#addMsTeamsButton';
                await page.waitForSelector(addButtonSelector);

                for (let i = 0; i < 11; i++) {
                    await page.$eval(addButtonSelector, e => e.click());
                    await page.waitForSelector('#endpoint');
                    await page.type(
                        '#webHookName',
                        utils.generateRandomString()
                    );
                    await page.type('#endpoint', utils.generateRandomWebsite());
                    await page.evaluate(() => {
                        document
                            .querySelector('input[name=incidentCreated]')
                            .click();
                    });
                    await page.$eval('#createMsTeams', e => e.click());
                    await page.waitForSelector('#createMsTeams', {
                        hidden: true,
                    });
                }

                await page.reload({ waitUntil: 'networkidle0' });

                // click on integrations tab
                await init.gotoTab(utils.monitorTabIndexes.INTEGRATION, page);

                const createdWebhookSelector = '.msteam-length';
                await page.waitForSelector(createdWebhookSelector);

                let webhookRows = await page.$$(createdWebhookSelector);
                let countWebhooks = webhookRows.length;

                expect(countWebhooks).toEqual(10);

                await page.waitForSelector('#btnNextMsTeams', {
                    visible: true,
                });
                await page.$eval('#btnNextMsTeams', elem => elem.click());
                await page.waitForSelector('.ball-beat', { hidden: true });
                await page.waitForSelector(createdWebhookSelector);

                webhookRows = await page.$$(createdWebhookSelector);
                countWebhooks = webhookRows.length;
                expect(countWebhooks).toEqual(1);

                await page.waitForSelector('#btnPrevMsTeams', {
                    visible: true,
                });
                await page.$eval('#btnPrevMsTeams', elem => elem.click());
                await page.waitForSelector('.ball-beat', { hidden: true });
                await page.waitForSelector(createdWebhookSelector);

                webhookRows = await page.$$(createdWebhookSelector);
                countWebhooks = webhookRows.length;

                expect(countWebhooks).toEqual(10);
            });
        },
        operationTimeOut
    );

    //Slack
    test(
        'Should navigate to monitor details and create a slack webhook',
        async () => {
            expect.assertions(1);
            return await cluster.execute(null, async ({ page }) => {
                // Navigate to Monitor details
                await init.navigateToMonitorDetails(
                    componentName,
                    monitorName,
                    page
                );
                // click on integrations tab
                await init.gotoTab(utils.monitorTabIndexes.INTEGRATION, page);

                const addButtonSelector = '#addSlackButton';
                await page.waitForSelector(addButtonSelector);
                await page.$eval(addButtonSelector, e => e.click());

                await page.waitForSelector('#endpoint');

                await page.type('#webHookName', webHookName);
                await page.type('#endpoint', webhookEndpoint);

                await page.evaluate(() => {
                    document
                        .querySelector('input[name=incidentCreated]')
                        .click();
                });

                //Only the NAME is rendered as well as the ACTIONS to be performed.
                const createdWebhookSelector = `#name_slack_${webHookName}`;

                await page.$eval('#createSlack', e => e.click());
                await page.waitForSelector('#createSlack', { hidden: true });
                await page.waitForSelector(createdWebhookSelector);

                const createdWebhookName = await page.$eval(
                    createdWebhookSelector,
                    el => el.textContent
                );
                expect(createdWebhookName).toEqual(webHookName);
            });
        },
        operationTimeOut
    );

    test(
        'Should navigate to monitor details and update a Slack webhook',
        async () => {
            expect.assertions(2);
            return await cluster.execute(null, async ({ page }) => {
                // Navigate to Monitor details
                await init.navigateToMonitorDetails(
                    componentName,
                    monitorName,
                    page
                );
                // click on integrations tab
                await init.gotoTab(utils.monitorTabIndexes.INTEGRATION, page);

                const existingWebhookSelector = `#name_slack_${webHookName}`;

                await page.waitForSelector(existingWebhookSelector);

                const existingWebhookName = await page.$eval(
                    existingWebhookSelector,
                    el => el.textContent
                );

                expect(existingWebhookName).toEqual(webHookName);

                const editWebhookButtonSelector = `#edit_slack_${webHookName}`;
                await page.$eval(editWebhookButtonSelector, e => e.click());

                const newWebhookEndpoint = utils.generateRandomWebsite();
                await page.click('#webHookName', { clickCount: 3 });
                await page.type('#webHookName', newWebHookName);
                await page.click('#endpoint', { clickCount: 3 });
                await page.type('#endpoint', newWebhookEndpoint);
                await page.$eval('#slackUpdate', e => e.click());
                await page.waitForSelector('#slackUpdate', { hidden: true });
                await page.waitForSelector(`#name_slack_${newWebHookName}`);
                const updatedWebhookName = await page.$eval(
                    `#name_slack_${newWebHookName}`,
                    el => el.textContent
                );
                expect(updatedWebhookName).toEqual(newWebHookName);
            });
        },
        operationTimeOut
    );

    test(
        'Should navigate to monitor details and delete a slack webhook',
        async () => {
            expect.assertions(2);
            return await cluster.execute(null, async ({ page }) => {
                // Navigate to Monitor details
                await init.navigateToMonitorDetails(
                    componentName,
                    monitorName,
                    page
                );
                // click on integrations tab
                await init.gotoTab(utils.monitorTabIndexes.INTEGRATION, page);
                const createdWebhookSelector = '.slack-list';
                await page.waitForSelector(createdWebhookSelector);

                let webhookRows = await page.$$(createdWebhookSelector);
                let countWebhooks = webhookRows.length;

                expect(countWebhooks).toEqual(1);

                const deleteWebhookButtonSelector = `#delete_slack_${newWebHookName}`;
                await page.$eval(deleteWebhookButtonSelector, e => e.click());

                await page.waitForSelector('#slackDelete');
                await page.$eval('#slackDelete', e => e.click());
                await page.waitForSelector('#slackDelete', { hidden: true });

                webhookRows = await page.$$(createdWebhookSelector);
                countWebhooks = webhookRows.length;

                expect(countWebhooks).toEqual(0);
            });
        },
        operationTimeOut
    );

    test(
        'Should navigate to monitor details and get list of slack webhooks and paginate them',
        async () => {
            return await cluster.execute(null, async ({ page }) => {
                // Navigate to Monitor details
                await init.navigateToMonitorDetails(
                    componentName,
                    monitorName,
                    page
                );
                // click on integrations tab
                await init.gotoTab(utils.monitorTabIndexes.INTEGRATION, page);
                const addButtonSelector = '#addSlackButton';
                await page.waitForSelector(addButtonSelector);

                for (let i = 0; i < 11; i++) {
                    await page.$eval(addButtonSelector, e => e.click());
                    await page.waitForSelector('#endpoint');

                    await page.type(
                        '#webHookName',
                        utils.generateRandomString()
                    );
                    await page.type('#endpoint', utils.generateRandomWebsite());
                    await page.evaluate(() => {
                        document
                            .querySelector('input[name=incidentCreated]')
                            .click();
                    });
                    await page.$eval('#createSlack', e => e.click());
                    await page.waitForSelector('#createSlack', {
                        hidden: true,
                    });
                }

                //await page.reload({ waitUntil: 'networkidle0' });
                await init.navigateToMonitorDetails(
                    componentName,
                    monitorName,
                    page
                );
                await init.gotoTab(utils.monitorTabIndexes.INTEGRATION, page);

                const createdWebhookSelector = '.slack-list';
                await page.waitForSelector(createdWebhookSelector);

                let webhookRows = await page.$$(createdWebhookSelector);
                let countWebhooks = webhookRows.length;

                expect(countWebhooks).toEqual(10);

                const nextSelector = await page.$('#btnNextSlack');

                await nextSelector.click();
                await page.waitForSelector('.ball-beat', { visible: true });
                await page.waitForSelector('.ball-beat', { hidden: true });

                await page.waitForSelector(createdWebhookSelector);

                webhookRows = await page.$$(createdWebhookSelector);
                countWebhooks = webhookRows.length;

                expect(countWebhooks).toEqual(1);

                const prevSelector = await page.$('#btnPrevSlack');

                await prevSelector.click();
                await page.waitForSelector('.ball-beat', { visible: true });
                await page.waitForSelector('.ball-beat', { hidden: true });

                await page.waitForSelector(createdWebhookSelector);

                webhookRows = await page.$$(createdWebhookSelector);
                countWebhooks = webhookRows.length;

                expect(countWebhooks).toEqual(10);
            });
        },
        operationTimeOut
    );

    test(
        'Should navigate to monitor details and create a webhook',
        async () => {
            // expect.assertions(1);
            return await cluster.execute(null, async ({ page }) => {
                // Navigate to Monitor details
                await init.navigateToMonitorDetails(
                    componentName,
                    monitorName,
                    page
                );
                // click on integrations tab
                await init.gotoTab(utils.monitorTabIndexes.INTEGRATION, page);
                const addButtonSelector = '#addWebhookButton';
                await page.waitForSelector(addButtonSelector);
                await page.$eval(addButtonSelector, e => e.click());

                await page.waitForSelector('#endpoint');
                await page.type('#endpoint', webhookEndpoint);
                await init.selectByText('#endpointType', 'GET', page);

                await page.evaluate(() => {
                    document
                        .querySelector('input[name=incidentCreated]')
                        .click();
                });

                const createdWebhookSelector = '#webhook_name';

                await page.$eval('#createWebhook', e => e.click());
                await page.waitForSelector('#createWebhook', { hidden: true });
                await page.waitForSelector(createdWebhookSelector);

                const createdWebhookEndpoint = await page.$eval(
                    createdWebhookSelector,
                    el => el.textContent
                );

                expect(createdWebhookEndpoint).toEqual(webhookEndpoint);
            });
        },
        operationTimeOut
    );

    test(
        'Should navigate to monitor details and get list of webhooks and paginate webhooks',
        async () => {
            // expect.assertions(2);
            return await cluster.execute(null, async ({ page }) => {
                // Navigate to Monitor details
                await init.navigateToMonitorDetails(
                    componentName,
                    monitorName,
                    page
                );
                // click on integrations tab
                await init.gotoTab(utils.monitorTabIndexes.INTEGRATION, page);

                const addButtonSelector = '#addWebhookButton';
                await page.waitForSelector(addButtonSelector);

                for (let i = 0; i < 10; i++) {
                    await page.$eval(addButtonSelector, e => e.click());
                    await page.waitForSelector('#endpoint');

                    await page.type('#endpoint', utils.generateRandomWebsite());
                    await init.selectByText('#endpointType', 'GET', page);
                    await page.evaluate(() => {
                        document
                            .querySelector('input[name=incidentCreated]')
                            .click();
                    });
                    await page.$eval('#createWebhook', e => e.click());
                    await page.waitForSelector('#createWebhook', {
                        hidden: true,
                    });
                }

                await page.reload({ waitUntil: 'networkidle0' });

                // click on integrations tab
                await init.gotoTab(utils.monitorTabIndexes.INTEGRATION, page);

                const createdWebhookSelector = '.webhook-list';
                await page.waitForSelector(createdWebhookSelector);

                let webhookRows = await page.$$(createdWebhookSelector);
                let countWebhooks = webhookRows.length;

                expect(countWebhooks).toEqual(10);

                await page.waitForSelector('#btnNextWebhook', {
                    visible: true,
                });
                await page.$eval('#btnNextWebhook', elem => elem.click());
                await page.waitForSelector('.ball-beat', { visible: true });
                await page.waitForSelector('.ball-beat', { hidden: true });

                await page.waitForSelector(createdWebhookSelector);
                webhookRows = await page.$$(createdWebhookSelector);
                countWebhooks = webhookRows.length;
                expect(countWebhooks).toEqual(1);

                await page.waitForSelector('#btnPrevWebhook', {
                    visible: true,
                });
                await page.$eval('#btnPrevWebhook', elem => elem.click());
                await page.waitForSelector('.ball-beat', { hidden: true });
                await page.waitForSelector(createdWebhookSelector);

                webhookRows = await page.$$(createdWebhookSelector);
                countWebhooks = webhookRows.length;

                expect(countWebhooks).toEqual(10);
            });
        },
        operationTimeOut
    );

    test(
        'Should navigate to monitor details and get list of website scans',
        async () => {
            return await cluster.execute(null, async ({ page }) => {
                await init.navigateToComponentDetails(componentName, page);

                await page.waitForSelector('#form-new-monitor');
                await page.$eval('input[id=name]', e => e.click());
                await page.type('input[id=name]', urlMonitorName);
                await page.click('[data-testId=type_url]');
                await page.waitForSelector('#url');
                await page.$eval('#url', e => e.click());
                await page.type('#url', 'https://google.com');
                await page.$eval('button[type=submit]', e => e.click());
                await page.waitForSelector('.ball-beat', { visible: true });
                await page.waitForSelector('.ball-beat', { hidden: true });

                // Navigate to Monitor details
                await init.navigateToMonitorDetails(
                    componentName,
                    urlMonitorName,
                    page
                );

                const createdLighthouseLogsSelector = '.lighthouseLogsListItem';
                await page.waitForSelector(createdLighthouseLogsSelector, {
                    visible: true,
                    timeout: 200000,
                });

                const lighthouseLogsRows = await page.$$(
                    createdLighthouseLogsSelector
                );
                const countLighthouseLogs = lighthouseLogsRows.length;

                expect(countLighthouseLogs).toEqual(1);
            });
        },
        operationTimeOut
    );

    test(
        'Should navigate to monitor details and add new site url',
        async () => {
            return await cluster.execute(null, async ({ page }) => {
                // Navigate to Monitor details
                await init.navigateToMonitorDetails(
                    componentName,
                    urlMonitorName,
                    page
                );

                await page.waitForSelector(`#addSiteUrl_${urlMonitorName}`);
                await page.$eval(`#addSiteUrl_${urlMonitorName}`, e =>
                    e.click()
                );

                await page.waitForSelector('input[id=siteUrl]');
                await page.type('input[id=siteUrl]', 'https://fyipe.com');
                await page.$eval('#addSiteUrlButton', e => e.click());
                // await page.waitForTimeout(5000);
                await page.waitForSelector('#addSiteUrlButton', {
                    hidden: true,
                });

                const createdLighthouseLogsSelector = '.lighthouseLogsListItem';
                await page.waitForSelector(createdLighthouseLogsSelector);

                const lighthouseLogsRows = await page.$$(
                    createdLighthouseLogsSelector
                );
                const countLighthouseLogs = lighthouseLogsRows.length;

                expect(countLighthouseLogs).toEqual(2);
            });
        },
        operationTimeOut
    );

    test(
        'Should navigate to monitor details and remove site url',
        async () => {
            return await cluster.execute(null, async ({ page }) => {
                // Navigate to Monitor details
                await init.navigateToMonitorDetails(
                    componentName,
                    urlMonitorName,
                    page
                );

                await page.waitForSelector(
                    `#removeSiteUrl_${urlMonitorName}_0`
                );
                await page.$eval(`#removeSiteUrl_${urlMonitorName}_0`, e =>
                    e.click()
                );
                await page.waitForSelector('#websiteUrlDelete');
                await page.$eval('#websiteUrlDelete', e => e.click());

                await page.waitForSelector('#websiteUrlDelete', {
                    hidden: true,
                });

                const createdLighthouseLogsSelector = '.lighthouseLogsListItem';
                await page.waitForSelector(createdLighthouseLogsSelector);

                const lighthouseLogsRows = await page.$$(
                    createdLighthouseLogsSelector
                );
                const countLighthouseLogs = lighthouseLogsRows.length;

                expect(countLighthouseLogs).toEqual(1);
            });
        },
        operationTimeOut
    );

    test(
        'Should navigate to monitor details and trigger website scan',
        async () => {
            return await cluster.execute(null, async ({ page }) => {
                // Navigate to Monitor details
                await init.navigateToMonitorDetails(
                    componentName,
                    urlMonitorName,
                    page
                );

                await page.waitForSelector(`#scanWebsites_${urlMonitorName}`);
                await page.$eval(`#scanWebsites_${urlMonitorName}`, e =>
                    e.click()
                );

                // await page.waitForTimeout(200000);

                let lighthousePerformanceElement = await page.waitForSelector(
                    `#performance_${urlMonitorName}_0`,
                    { visible: true, timeout: 200000 }
                );
                lighthousePerformanceElement = await lighthousePerformanceElement.getProperty(
                    'innerText'
                );
                lighthousePerformanceElement = await lighthousePerformanceElement.jsonValue();
                lighthousePerformanceElement.should.endWith('%');
            });
        },
        operationTimeOut
    );

    test(
        'should display multiple probes and monitor chart on refresh',
        async () => {
            return await cluster.execute(null, async ({ page }) => {
                // Navigate to Component details
                await init.navigateToMonitorDetails(
                    componentName,
                    urlMonitorName,
                    page
                );

                await page.reload({
                    waitUntil: ['networkidle0', 'domcontentloaded'],
                });

                const probe0 = await page.waitForSelector('#probes-btn0');
                const probe1 = await page.waitForSelector('#probes-btn1');

                expect(probe0).toBeDefined();
                expect(probe1).toBeDefined();

                const monitorStatus = await page.waitForSelector(
                    `#monitor-status-${urlMonitorName}`,
                    { visible: true, timeout: operationTimeOut }
                );
                const sslStatus = await page.waitForSelector(
                    `#ssl-status-${urlMonitorName}`,
                    { visible: true, timeout: operationTimeOut }
                );

                expect(monitorStatus).toBeDefined();
                expect(sslStatus).toBeDefined();
            });
        },
        operationTimeOut
    );

    test(
        'Should navigate to monitor details and get lighthouse scores and website issues',
        async () => {
            return await cluster.execute(null, async ({ page }) => {
                // Navigate to Monitor details
                await init.navigateToMonitorDetails(
                    componentName,
                    urlMonitorName,
                    page
                );

                const createdLighthouseLogsSelector = '.lighthouseLogsListItem';
                await page.waitForSelector(createdLighthouseLogsSelector);
                await page.$eval(createdLighthouseLogsSelector, e => e.click());
                await page.waitForSelector('#lighthouse-performance');

                let lighthousePerformanceElement = await page.waitForSelector(
                    `#lighthouse-performance`
                );
                lighthousePerformanceElement = await lighthousePerformanceElement.getProperty(
                    'innerText'
                );
                lighthousePerformanceElement = await lighthousePerformanceElement.jsonValue();
                lighthousePerformanceElement.should.endWith('%');

                let lighthouseAccessibilityElement = await page.waitForSelector(
                    `#lighthouse-accessibility`
                );
                lighthouseAccessibilityElement = await lighthouseAccessibilityElement.getProperty(
                    'innerText'
                );
                lighthouseAccessibilityElement = await lighthouseAccessibilityElement.jsonValue();
                lighthouseAccessibilityElement.should.endWith('%');

                let lighthouseBestPracticesElement = await page.waitForSelector(
                    `#lighthouse-bestPractices`
                );
                lighthouseBestPracticesElement = await lighthouseBestPracticesElement.getProperty(
                    'innerText'
                );
                lighthouseBestPracticesElement = await lighthouseBestPracticesElement.jsonValue();
                lighthouseBestPracticesElement.should.endWith('%');

                let lighthouseSeoElement = await page.waitForSelector(
                    `#lighthouse-seo`
                );
                lighthouseSeoElement = await lighthouseSeoElement.getProperty(
                    'innerText'
                );
                lighthouseSeoElement = await lighthouseSeoElement.jsonValue();
                lighthouseSeoElement.should.endWith('%');

                let lighthousePwaElement = await page.waitForSelector(
                    `#lighthouse-pwa`
                );
                lighthousePwaElement = await lighthousePwaElement.getProperty(
                    'innerText'
                );
                lighthousePwaElement = await lighthousePwaElement.jsonValue();
                lighthousePwaElement.should.endWith('%');

                const websiteIssuesSelector =
                    '#performance #websiteIssuesList > tbody >tr.websiteIssuesListItem';
                await page.waitForSelector(websiteIssuesSelector);

                const websiteIssuesRows = await page.$$(websiteIssuesSelector);
                const countWebsiteIssues = websiteIssuesRows.length;

                expect(countWebsiteIssues).toBeGreaterThanOrEqual(1);
            });
        },
        operationTimeOut
    );

    test(
        'Should navigate to monitor details and edit monitor',
        async () => {
            return await cluster.execute(null, async ({ page }) => {
                // Navigate to Monitor details
                await init.navigateToMonitorDetails(
                    componentName,
                    monitorName,
                    page
                );

                const editButtonSelector = `#edit_${monitorName}`;
                await page.waitForSelector(editButtonSelector, {
                    visible: true,
                });
                await page.$eval(editButtonSelector, e => e.click());

                await page.waitForSelector('#form-new-monitor');
                await page.click('input[id=name]', { clickCount: 3 });
                await page.type('input[id=name]', newMonitorName);
                await page.$eval('button[type=submit]', e => e.click());
                await page.waitForSelector('#form-new-monitor', {
                    hidden: true,
                });
                // await page.waitForTimeout(3000);

                const selector = `#monitor-title-${newMonitorName}`;

                let spanElement = await page.waitForSelector(selector);
                spanElement = await spanElement.getProperty('innerText');
                spanElement = await spanElement.jsonValue();

                spanElement.should.be.exactly(newMonitorName);
            });
        },
        operationTimeOut
    );

    test(
        'Should navigate to monitor details and delete monitor',
        async () => {
            expect.assertions(1);
            return await cluster.execute(null, async ({ page }) => {
                // Navigate to Monitor details
                await init.navigateToMonitorDetails(
                    componentName,
                    newMonitorName,
                    page
                );
                // click on advanced tab
                await init.gotoTab(utils.monitorTabIndexes.ADVANCE, page);

                const deleteButtonSelector = `#delete_${newMonitorName}`;
                await page.$eval(deleteButtonSelector, e => e.click());

                const confirmDeleteButtonSelector = '#deleteMonitor';
                await page.waitForSelector(confirmDeleteButtonSelector);
                await page.$eval(confirmDeleteButtonSelector, e => e.click());
                await page.waitForSelector(confirmDeleteButtonSelector, {
                    hidden: true,
                });
                // await page.waitForTimeout(5000);

                const selector = `span#monitor-title-${newMonitorName}`;

                const spanElement = await page.$(selector);
                expect(spanElement).toEqual(null);
            });
        },
        operationTimeOut
    );
});
