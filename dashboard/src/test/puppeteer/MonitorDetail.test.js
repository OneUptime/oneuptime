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
                await page.click(`#createIncident_${monitorName}`);
                await page.waitForSelector('#createIncident');
                await init.selectByText('#incidentType', 'Offline', page);
                await page.click('#createIncident');

                const selector = 'tr.incidentListItem';
                await page.waitForSelector(selector);

                expect((await page.$$(selector)).length).toEqual(1);
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
                await page.click(selector);
                await page.waitFor(5000);
                await page.waitForSelector('button[id=deleteIncidentButton]');
                await page.click('#deleteIncidentButton');
                await page.waitFor(5000);
                await page.waitForSelector('button[id=confirmDeleteIncident]', {
                    visible: true,
                });
                await page.click('#confirmDeleteIncident');
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
                await page.click(addButtonSelector);

                await page.waitForSelector('form input[name=startDate]');

                await page.click('input[name=startDate]');
                await page.click(
                    'div.MuiDialogActions-root button:nth-child(2)'
                );
                await page.click('input[name=endDate]');
                await page.click(
                    'div.MuiDialogActions-root button:nth-child(2)'
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
                    page.click('#createScheduledEventButton'),
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
                await page.click(addButtonSelector);

                await page.waitForSelector('form input[name=startDate]');

                await page.click('input[name=startDate]');
                await page.click(
                    'div.MuiDialogActions-root button:nth-child(2)'
                );
                await page.click('input[name=endDate]');
                await page.click(
                    'div.MuiDialogActions-root button:nth-child(2)'
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
                    page.click('#createScheduledEventButton'),
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
                await page.click(addButtonSelector);

                await page.waitForSelector('#alertViaId');

                await init.selectByText('#alertViaId', 'email', page);
                await page.type('input[name=email]', subscriberEmail);
                await page.click('#createSubscriber');

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
                    await page.click(addButtonSelector);
                    await page.waitForSelector('#alertViaId');
                    await init.selectByText('#alertViaId', 'email', page);
                    await page.type(
                        'input[name=email]',
                        utils.generateRandomBusinessEmail()
                    );
                    await page.click('#createSubscriber');
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
                await page.click(addButtonSelector);

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

                await page.click('#createWebhook');
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
                    await page.click(addButtonSelector);
                    await page.waitForSelector('#endpoint');

                    await page.type('#endpoint', utils.generateRandomWebsite());
                    await init.selectByText('#endpointType', 'GET', page);
                    await page.evaluate(() => {
                        document
                            .querySelector('input[name=incidentCreated]')
                            .click();
                    });
                    await page.click('#createWebhook');
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
                await page.click(editButtonSelector);

                await page.waitForSelector('#form-new-monitor');
                await page.click('input[id=name]', { clickCount: 3 });
                await page.keyboard.press('Backspace');
                await page.type('input[id=name]', newMonitorName);
                await page.click('button[type=submit]');

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
                await page.click(deleteButtonSelector);

                const confirmDeleteButtonSelector = '#deleteMonitor';
                await page.waitForSelector(confirmDeleteButtonSelector);
                await page.click(confirmDeleteButtonSelector);
                await page.waitFor(5000);

                const selector = `span#monitor-title-${newMonitorName}`;

                const spanElement = await page.$(selector);
                expect(spanElement).toEqual(null);
            });
        },
        operationTimeOut
    );
});
