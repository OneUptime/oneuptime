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
const webhookEndpoint = utils.generateRandomWebsite();

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
            await init.loginUser(user, page);
            await page.waitFor(1000);
            await page.goto(utils.DASHBOARD_URL);
            // add new monitor to component on parent project
            await init.addMonitorToComponent(componentName, monitorName, page);
        });
    });

    afterAll(async () => {
        await cluster.idle();
        await cluster.close();
    });

    test(
        'Should navigate to monitor details of monitor created with correct details',
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
            expect.assertions(1);
            return await cluster.execute(null, async ({ page }) => {
                // Navigate to Monitor details
                await init.navigateToMonitorDetails(
                    componentName,
                    monitorName,
                    page
                );

                await page.waitForSelector(`#createIncident_${monitorName}`);
                await page.$eval(`#createIncident_${monitorName}`,e=>e.click());
                await page.waitForSelector('#createIncident');
                await init.selectByText('#incidentType', 'Offline', page);
                await page.$eval('#createIncident',e=>e.click());

                const selector = 'tr.incidentListItem';
                await page.waitForSelector(selector);

                expect((await page.$$(selector)).length).toEqual(1);
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
                await page.$eval(`#monitorCreateIncident_${monitorName}`,e=>e.click());
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
            expect.assertions(2);
            return await cluster.execute(null, async ({ page }) => {
                // Navigate to Monitor details
                await init.navigateToMonitorDetails(
                    componentName,
                    monitorName,
                    page
                );

                const nextSelector = await page.waitForSelector('#btnNext');
                await nextSelector.click();

                let incidentRows = await page.$$('tr.incidentListItem');
                let countIncidents = incidentRows.length;

                expect(countIncidents).toEqual(1);

                const prevSelector = await page.waitForSelector('#btnPrev');
                await prevSelector.click();

                incidentRows = await page.$$('tr.incidentListItem');
                countIncidents = incidentRows.length;

                expect(countIncidents).toEqual(1);
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
                await page.waitFor(5000);
                const selector = 'tr.incidentListItem';
                await page.waitForSelector(selector);
                await page.$eval(selector,e=>e.click());
                await page.waitFor(5000);
                await page.waitForSelector('button[id=deleteIncidentButton]');
                await page.$eval('#deleteIncidentButton',e=>e.click());
                await page.waitFor(5000);
                await page.waitForSelector('button[id=confirmDeleteIncident]', {
                    visible: true,
                });
                await page.$eval('#confirmDeleteIncident',e=>e.click());
                await page.waitForNavigation();

                const incidentList = 'tr.incidentListItem';
                await page.waitForSelector(incidentList);
                await page.waitFor(35000);

                expect((await page.$$(incidentList)).length).toEqual(0);
            });
        },
        operationTimeOut
    );

    test(
        'Should navigate to monitor details and create a scheduled event',
        async () => {
            expect.assertions(1);
            return await cluster.execute(null, async ({ page }) => {
                // Navigate to Monitor details
                await init.navigateToMonitorDetails(
                    componentName,
                    monitorName,
                    page
                );

                const addButtonSelector = '#addScheduledEventButton';
                await page.waitForSelector(addButtonSelector);
                await page.$eval(addButtonSelector,e=>e.click());

                await page.waitForSelector('form input[name=startDate]');

                await page.$eval('input[name=startDate]',e=>e.click());
                await page.$eval(
                    'div.MuiDialogActions-root button:nth-child(2)',
                    e=>e.click()
                );
                await page.$eval('input[name=endDate]',e=>e.click());
                await page.$eval(
                    'div.MuiDialogActions-root button:nth-child(2)',
                    e=>e.click()
                );

                await page.type('input[name=name]', utils.scheduledEventName);
                await page.type(
                    'textarea[name=description]',
                    utils.scheduledEventDescription
                );

                await page.evaluate(() => {
                    document
                        .querySelector('input[name=showEventOnStatusPage]')
                        .click();
                });

                const createScheduledEventPromise = page.waitForResponse(
                    response => response.url().includes('/scheduledEvent/')
                );

                await Promise.all([
                    createScheduledEventPromise,
                    page.$eval('#createScheduledEventButton',e=>e.click()),
                ]);

                const createdScheduledEventSelector = '.scheduled-event-name';
                await page.waitFor(5000);

                const createdScheduledEventName = await page.$eval(
                    createdScheduledEventSelector,
                    el => el.textContent
                );

                expect(createdScheduledEventName).toEqual(
                    utils.scheduledEventName
                );
            });
        },
        operationTimeOut
    );

    test(
        'Should navigate to monitor details and get list of scheduled events and paginate scheduled events',
        async () => {
            expect.assertions(1);
            return await cluster.execute(null, async ({ page }) => {
                // Navigate to Monitor details
                await init.navigateToMonitorDetails(
                    componentName,
                    monitorName,
                    page
                );

                const addButtonSelector = '#addScheduledEventButton';
                await page.waitForSelector(addButtonSelector);
                await page.$eval(addButtonSelector,e=>e.click());

                await page.waitForSelector('form input[name=startDate]');

                await page.$eval('input[name=startDate]',e=>e.click());
                await page.$eval(
                    'div.MuiDialogActions-root button:nth-child(2)',
                    e=>e.click()
                );
                await page.$eval('input[name=endDate]',e=>e.click());
                await page.$eval(
                    'div.MuiDialogActions-root button:nth-child(2)',
                    e=>e.click()
                );

                await page.type(
                    'input[name=name]',
                    `${utils.scheduledEventName}1`
                );
                await page.type(
                    'textarea[name=description]',
                    utils.scheduledEventDescription
                );

                await page.evaluate(() => {
                    document
                        .querySelector('input[name=showEventOnStatusPage]')
                        .click();
                });

                const createScheduledEventPromise = page.waitForResponse(
                    response => response.url().includes('/scheduledEvent/')
                );

                await Promise.all([
                    createScheduledEventPromise,
                    page.$eval('#createScheduledEventButton',e=>e.click()),
                ]);

                const createdScheduledEventSelector =
                    '#scheduledEventsList .scheduled-event-name';
                await page.waitFor(5000);

                const scheduledEventRows = await page.$$(
                    createdScheduledEventSelector
                );
                const countScheduledEvent = scheduledEventRows.length;

                expect(countScheduledEvent).toEqual(2);
            });
        },
        operationTimeOut
    );

    test(
        'Should navigate to monitor details and create a new subscriber',
        async () => {
            expect.assertions(1);
            return await cluster.execute(null, async ({ page }) => {
                // Navigate to Monitor details
                await init.navigateToMonitorDetails(
                    componentName,
                    monitorName,
                    page
                );

                const addButtonSelector = '#addSubscriberButton';
                await page.waitForSelector(addButtonSelector);
                await page.$eval(addButtonSelector,e=>e.click());

                await page.waitForSelector('#alertViaId');

                await init.selectByText('#alertViaId', 'email', page);
                await page.type('input[name=email]', subscriberEmail);
                await page.$eval('#createSubscriber',e=>e.click());

                const createdSubscriberSelector =
                    '#subscribersList > tbody > tr.subscriber-list-item .contact';

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
            expect.assertions(3);
            return await cluster.execute(null, async ({ page }) => {
                // Navigate to Monitor details
                await init.navigateToMonitorDetails(
                    componentName,
                    monitorName,
                    page
                );

                const addButtonSelector = '#addSubscriberButton';
                await page.waitForSelector(addButtonSelector);

                for (let i = 0; i < 5; i++) {
                    await page.$eval(addButtonSelector,e=>e.click());
                    await page.waitForSelector('#alertViaId');
                    await init.selectByText('#alertViaId', 'email', page);
                    await page.type(
                        'input[name=email]',
                        utils.generateRandomBusinessEmail()
                    );
                    await page.$eval('#createSubscriber',e=>e.click());
                    await page.waitFor(1000);
                }

                const createdSubscriberSelector =
                    '#subscribersList > tbody > tr.subscriber-list-item';

                await page.waitForSelector(createdSubscriberSelector);

                let subscriberRows = await page.$$(createdSubscriberSelector);
                let countSubscribers = subscriberRows.length;

                expect(countSubscribers).toEqual(5);

                const nextSelector = await page.$('#btnNextSubscriber');
                await nextSelector.click();

                await page.waitForSelector(createdSubscriberSelector);

                subscriberRows = await page.$$(createdSubscriberSelector);
                countSubscribers = subscriberRows.length;

                expect(countSubscribers).toEqual(1);

                const prevSelector = await page.$('#btnPrevSubscriber');
                await prevSelector.click();
                await page.waitForSelector(createdSubscriberSelector);

                subscriberRows = await page.$$(createdSubscriberSelector);
                countSubscribers = subscriberRows.length;

                expect(countSubscribers).toEqual(5);
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

                const addButtonSelector = '#addMsTeamsButton';
                await page.waitForSelector(addButtonSelector);
                await page.$eval(addButtonSelector,e=>e.click());

                await page.waitForSelector('#endpoint');

                await page.type('#endpoint', webhookEndpoint);

                await page.evaluate(() => {
                    document
                        .querySelector('input[name=incidentCreated]')
                        .click();
                });

                const createdWebhookSelector =
                    '#msteamsWebhookList > tbody > tr.webhook-list-item > td:nth-child(1) > div > span > div > span';

                await page.$eval('#createMsTeams',e=>e.click());
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
        'Should navigate to monitor details and update a msteams webhook',
        async () => {
            expect.assertions(2);
            return await cluster.execute(null, async ({ page }) => {
                // Navigate to Monitor details
                await init.navigateToMonitorDetails(
                    componentName,
                    monitorName,
                    page
                );

                const existingWebhookSelector =
                    '#msteamsWebhookList > tbody > tr.webhook-list-item > td:nth-child(1) > div > span > div > span';

                await page.waitForSelector(existingWebhookSelector);

                const existingWebhookEndpoint = await page.$eval(
                    existingWebhookSelector,
                    el => el.textContent
                );

                expect(existingWebhookEndpoint).toEqual(webhookEndpoint);

                const editWebhookButtonSelector =
                    '#msteamsWebhookList > tbody > tr.webhook-list-item > td:nth-child(2) > div > span > div > button:nth-child(1)';
                await page.$eval(editWebhookButtonSelector,e=>e.click());

                const newWebhookEndpoint = utils.generateRandomWebsite();
                await page.$eval('#endpoint',e=>e.value='');
                await page.type('#endpoint', newWebhookEndpoint);
                await page.$eval('#msteamsUpdate',e=>e.click());
                await page.waitFor(1000);
                const updatedWebhookEndpoint = await page.$eval(
                    existingWebhookSelector,
                    el => el.textContent
                );
                expect(updatedWebhookEndpoint).toEqual(newWebhookEndpoint);
            });
        },
        operationTimeOut
    );

    test(
        'Should navigate to monitor details and delete a msteams webhook',
        async () => {
            expect.assertions(2);
            return await cluster.execute(null, async ({ page }) => {
                // Navigate to Monitor details
                await init.navigateToMonitorDetails(
                    componentName,
                    monitorName,
                    page
                );
                const createdWebhookSelector =
                    '#msteamsWebhookList > tbody > tr.webhook-list-item > td:nth-child(1) > div > span > div > span';
                await page.waitForSelector(createdWebhookSelector);

                let webhookRows = await page.$$(createdWebhookSelector);
                let countWebhooks = webhookRows.length;

                expect(countWebhooks).toEqual(1);

                const deleteWebhookButtonSelector =
                    '#msteamsWebhookList > tbody > tr.webhook-list-item > td:nth-child(2) > div > span > div > button:nth-child(2)';
                await page.$eval(deleteWebhookButtonSelector,e=>e.click());

                await page.waitForSelector('#msteamsDelete');
                await page.$eval('#msteamsDelete',e=>e.click());

                await page.waitFor(1000);
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

                const addButtonSelector = '#addMsTeamsButton';
                await page.waitForSelector(addButtonSelector);

                for (let i = 0; i < 11; i++) {
                    await page.$eval(addButtonSelector,e=>e.click());
                    await page.waitForSelector('#endpoint');

                    await page.type('#endpoint', utils.generateRandomWebsite());
                    await page.evaluate(() => {
                        document
                            .querySelector('input[name=incidentCreated]')
                            .click();
                    });
                    await page.$eval('#createMsTeams',e=>e.click());
                    await page.waitFor(1000);
                }

                const createdWebhookSelector =
                    '#msteamsWebhookList > tbody > tr.webhook-list-item > td:nth-child(1) > div > span > div > span';
                await page.waitForSelector(createdWebhookSelector);

                let webhookRows = await page.$$(createdWebhookSelector);
                let countWebhooks = webhookRows.length;

                expect(countWebhooks).toEqual(11);

                const nextSelector = await page.$('#btnNextMsTeams');

                await nextSelector.click();
                await page.waitFor(1000);
                await page.waitForSelector(createdWebhookSelector);

                webhookRows = await page.$$(createdWebhookSelector);
                countWebhooks = webhookRows.length;

                expect(countWebhooks).toEqual(1);

                const prevSelector = await page.$('#btnPrevMsTeams');

                await prevSelector.click();
                await page.waitFor(1000);
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

                const addButtonSelector = '#addSlackButton';
                await page.waitForSelector(addButtonSelector);
                await page.$eval(addButtonSelector,e=>e.click());

                await page.waitForSelector('#endpoint');

                await page.type('#endpoint', webhookEndpoint);

                await page.evaluate(() => {
                    document
                        .querySelector('input[name=incidentCreated]')
                        .click();
                });

                const createdWebhookSelector =
                    '#slackWebhookList > tbody > tr.webhook-list-item > td:nth-child(1) > div > span > div > span';

                await page.$eval('#createSlack',e=>e.click());
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

                const existingWebhookSelector =
                    '#slackWebhookList > tbody > tr.webhook-list-item > td:nth-child(1) > div > span > div > span';

                await page.waitForSelector(existingWebhookSelector);

                const existingWebhookEndpoint = await page.$eval(
                    existingWebhookSelector,
                    el => el.textContent
                );

                expect(existingWebhookEndpoint).toEqual(webhookEndpoint);

                const editWebhookButtonSelector =
                    '#slackWebhookList > tbody > tr.webhook-list-item > td:nth-child(2) > div > span > div > button:nth-child(1)';
                await page.$eval(editWebhookButtonSelector,e=>e.click());

                const newWebhookEndpoint = utils.generateRandomWebsite();
                await page.$eval('#endpoint',e=>e.value='');
                await page.type('#endpoint', newWebhookEndpoint);
                await page.$eval('#slackUpdate',e=>e.click());
                await page.waitFor(1000);
                const updatedWebhookEndpoint = await page.$eval(
                    existingWebhookSelector,
                    el => el.textContent
                );
                expect(updatedWebhookEndpoint).toEqual(newWebhookEndpoint);
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
                const createdWebhookSelector =
                    '#slackWebhookList > tbody > tr.webhook-list-item > td:nth-child(1) > div > span > div > span';
                await page.waitForSelector(createdWebhookSelector);

                let webhookRows = await page.$$(createdWebhookSelector);
                let countWebhooks = webhookRows.length;

                expect(countWebhooks).toEqual(1);

                const deleteWebhookButtonSelector =
                    '#slackWebhookList > tbody > tr.webhook-list-item > td:nth-child(2) > div > span > div > button:nth-child(2)';
                await page.$eval(deleteWebhookButtonSelector,e=>e.click());

                await page.waitForSelector('#slackDelete');
                await page.$eval('#slackDelete',e=>e.click());

                await page.waitFor(1000);
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

                const addButtonSelector = '#addSlackButton';
                await page.waitForSelector(addButtonSelector);

                for (let i = 0; i < 11; i++) {
                    await page.$eval(addButtonSelector,e=>e.click());
                    await page.waitForSelector('#endpoint');

                    await page.type('#endpoint', utils.generateRandomWebsite());
                    await page.evaluate(() => {
                        document
                            .querySelector('input[name=incidentCreated]')
                            .click();
                    });
                    await page.$eval('#createSlack',e=>e.click());
                    await page.waitFor(1000);
                }

                const createdWebhookSelector =
                    '#slackWebhookList > tbody > tr.webhook-list-item > td:nth-child(1) > div > span > div > span';
                await page.waitForSelector(createdWebhookSelector);

                let webhookRows = await page.$$(createdWebhookSelector);
                let countWebhooks = webhookRows.length;

                expect(countWebhooks).toEqual(11);

                const nextSelector = await page.$('#btnNextSlack');

                await nextSelector.click();
                await page.waitFor(1000);
                await page.waitForSelector(createdWebhookSelector);

                webhookRows = await page.$$(createdWebhookSelector);
                countWebhooks = webhookRows.length;

                expect(countWebhooks).toEqual(1);

                const prevSelector = await page.$('#btnPrevSlack');

                await prevSelector.click();
                await page.waitFor(1000);
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
            expect.assertions(1);
            return await cluster.execute(null, async ({ page }) => {
                // Navigate to Monitor details
                await init.navigateToMonitorDetails(
                    componentName,
                    monitorName,
                    page
                );

                const addButtonSelector = '#addWebhookButton';
                await page.waitForSelector(addButtonSelector);
                await page.$eval(addButtonSelector,e=>e.click());

                await page.waitForSelector('#endpoint');

                await page.type('#endpoint', webhookEndpoint);
                await init.selectByText('#endpointType', 'GET', page);

                await page.evaluate(() => {
                    document
                        .querySelector('input[name=incidentCreated]')
                        .click();
                });

                const createdWebhookSelector =
                    '#webhookList > tbody > tr.webhook-list-item > td:nth-child(1) > div > span > div > span';

                await page.$eval('#createWebhook',e=>e.click());
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

                const addButtonSelector = '#addWebhookButton';
                await page.waitForSelector(addButtonSelector);

                for (let i = 0; i < 10; i++) {
                    await page.$eval(addButtonSelector,e=>e.click());
                    await page.waitForSelector('#endpoint');

                    await page.type('#endpoint', utils.generateRandomWebsite());
                    await init.selectByText('#endpointType', 'GET', page);
                    await page.waitFor(2000);
                    await page.evaluate(() => {
                        document
                            .querySelector('input[name=incidentCreated]')
                            .click();
                    });
                    await page.$eval('#createWebhook',e=>e.click());
                    await page.waitFor(1000);
                }

                const createdWebhookSelector =
                    '#webhookList > tbody > tr.webhook-list-item > td:nth-child(1) > div > span > div > span';
                await page.waitForSelector(createdWebhookSelector);

                let webhookRows = await page.$$(createdWebhookSelector);
                let countWebhooks = webhookRows.length;

                expect(countWebhooks).toEqual(11);

                const nextSelector = await page.$('#btnNextWebhook');

                await nextSelector.click();
                await page.waitFor(1000);
                await page.waitForSelector(createdWebhookSelector);

                webhookRows = await page.$$(createdWebhookSelector);
                countWebhooks = webhookRows.length;

                expect(countWebhooks).toEqual(1);

                const prevSelector = await page.$('#btnPrevWebhook');

                await prevSelector.click();
                await page.waitFor(1000);
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
                await page.$eval('input[id=name]',e=>e.click());
                await page.type('input[id=name]', urlMonitorName);
                await init.selectByText('#type', 'url', page);
                await page.waitForSelector('#url');
                await page.$eval('#url',e=>e.click());
                await page.type('#url', 'https://google.com');
                await page.$eval('button[type=submit]',e=>e.click());

                // Navigate to Monitor details
                await init.navigateToMonitorDetails(
                    componentName,
                    urlMonitorName,
                    page
                );

                await page.waitFor(200000);

                const createdLighthouseLogsSelector =
                    '#lighthouseLogsList > tbody > tr.lighthouseLogsListItem > td:nth-child(1) > div > span > div > span';
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
                await page.$eval(`#addSiteUrl_${urlMonitorName}`,e=>e.click());

                await page.waitForSelector('input[id=siteUrl]');
                await page.$eval('input[id=siteUrl]',e=>e.click());
                await page.type('input[id=siteUrl]', 'http://localhost:3010');
                await page.$eval('#addSiteUrlButton',e=>e.click());
                await page.waitFor(5000);

                const createdLighthouseLogsSelector =
                    '#lighthouseLogsList > tbody > tr.lighthouseLogsListItem';
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
                await page.$eval(`#removeSiteUrl_${urlMonitorName}_0`,e=>e.click());
                await page.waitForSelector('#websiteUrlDelete');
                await page.$eval('#websiteUrlDelete',e=>e.click());
                await page.waitFor(5000);

                const createdLighthouseLogsSelector =
                    '#lighthouseLogsList > tbody > tr.lighthouseLogsListItem';
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
                await page.$eval(`#scanWebsites_${urlMonitorName}`,e=>e.click());

                await page.waitFor(200000);

                let lighthousePerformanceElement = await page.waitForSelector(
                    `#performance_${urlMonitorName}_0`
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
                await page.waitFor(10000);

                const monitorStatus = await page.waitForSelector(
                    `#monitor-status-${urlMonitorName}`
                );
                const sslStatus = await page.waitForSelector(
                    `#ssl-status-${urlMonitorName}`
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

                const createdLighthouseLogsSelector =
                    '#lighthouseLogsList > tbody > tr.lighthouseLogsListItem > td:nth-child(1) > div > span > div > span';
                await page.waitForSelector(createdLighthouseLogsSelector);
                await page.$eval(createdLighthouseLogsSelector,e=>e.click());
                await page.waitFor(5000);

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
                    '#performance #websiteIssuesList > tbody > tr.websiteIssuesListItem';
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
                await page.$eval(editButtonSelector,e=>e.click());

                await page.waitForSelector('#form-new-monitor');
                await page.$eval('input[id=name]',e=>e.value='');
                await page.type('input[id=name]', newMonitorName);
                await page.$eval('button[type=submit]',e=>e.click());

                const selector = `span#monitor-title-${newMonitorName}`;

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

                const deleteButtonSelector = `#delete_${newMonitorName}`;
                await page.$eval(deleteButtonSelector,e=>e.click());

                const confirmDeleteButtonSelector = '#deleteMonitor';
                await page.waitForSelector(confirmDeleteButtonSelector);
                await page.$eval(confirmDeleteButtonSelector,e=>e.click());
                await page.waitFor(5000);

                const selector = `span#monitor-title-${newMonitorName}`;

                const spanElement = await page.$(selector);
                expect(spanElement).toEqual(null);
            });
        },
        operationTimeOut
    );
});
