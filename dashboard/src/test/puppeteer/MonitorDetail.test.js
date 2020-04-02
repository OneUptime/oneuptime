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
const projectName = utils.generateRandomString();
const subscriberEmail = utils.generateRandomBusinessEmail();
const webhookEndpoint = utils.generateRandomWebsite();

describe('Monitor Detail API', () => {
    const operationTimeOut = 300000;

    let cluster;

    beforeAll(async () => {
        jest.setTimeout(200000);

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
        await cluster.execute(null, async ({ page }) => {
            await page.setDefaultTimeout(utils.timeout);
            const user = {
                email: email,
                password: password,
            };
            // user
            await init.registerUser(user, page);
            await init.loginUser(user, page);

            // rename default project
            await init.renameProject(projectName, page);
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
            await cluster.execute(null, async ({ page }) => {
                await page.setDefaultTimeout(utils.timeout);
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

    // test(
    //     'Should navigate to monitor details and create an incident',
    //     async () => {
    //         expect.assertions(1);
    //         await cluster.execute(null, async ({ page }) => {
    //             await page.setDefaultTimeout(utils.timeout);
    //             // Navigate to Monitor details
    //             await init.navigateToMonitorDetails(
    //                 componentName,
    //                 monitorName,
    //                 page
    //             );

    //             await page.waitForSelector(`#createIncident_${monitorName}`);
    //             await page.click(`#createIncident_${monitorName}`);
    //             await page.waitForSelector('#createIncident');
    //             await init.selectByText('#incidentType', 'Offline', page);
    //             await page.click('#createIncident');

    //             const selector = 'tr.incidentListItem';
    //             await page.waitForSelector(selector);

    //             expect((await page.$$(selector)).length).toEqual(1);
    //         });
    //     },
    //     operationTimeOut
    // );

    // test(
    //     'Should navigate to monitor details and get list of incidents and paginate incidents',
    //     async () => {
    //         expect.assertions(2);
    //         await cluster.execute(null, async ({ page }) => {
    //             await page.setDefaultTimeout(utils.timeout);
    //             // Navigate to Monitor details
    //             await init.navigateToMonitorDetails(
    //                 componentName,
    //                 monitorName,
    //                 page
    //             );

    //             const nextSelector = await page.waitForSelector('#btnNext');
    //             await nextSelector.click();

    //             let incidentRows = await page.$$('tr.incidentListItem');
    //             let countIncidents = incidentRows.length;

    //             expect(countIncidents).toEqual(1);

    //             const prevSelector = await page.waitForSelector('#btnPrev');
    //             await prevSelector.click();

    //             incidentRows = await page.$$('tr.incidentListItem');
    //             countIncidents = incidentRows.length;

    //             expect(countIncidents).toEqual(1);
    //         });
    //     },
    //     operationTimeOut
    // );

    test(
        'Should navigate to monitor details and create a scheduled event',
        async () => {
            expect.assertions(1);
            await cluster.execute(null, async ({ page }) => {
                await page.setDefaultTimeout(utils.timeout);
                // Navigate to Monitor details
                await init.navigateToMonitorDetails(
                    componentName,
                    monitorName,
                    page
                );

                const addButtonSelector = '#addScheduledEventButton';
                await page.waitForSelector(addButtonSelector);
                await page.click(addButtonSelector);

                await page.click('input[name=startDate]');
                await page.click(
                    'div > div:nth-child(3) > div > div:nth-child(2) button:nth-child(2)'
                );
                await page.waitFor(1000);
                await page.click('input[name=endDate]');
                await page.click(
                    'div > div:nth-child(3) > div > div:nth-child(2) button:nth-child(2)'
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

                await page.click('#createScheduledEventButton');

                const createdScheduledEventSelector =
                    '#scheduledEventsList > div.scheduled-event-list-item .scheduled-event-name';

                await page.waitForSelector(createdScheduledEventSelector);
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

    test('Should navigate to monitor details and get list of scheduled events and paginate scheduled events', async () => {
        expect.assertions(1);
        await cluster.execute(null, async ({ page }) => {
            await page.setDefaultTimeout(utils.timeout);
            // Navigate to Monitor details
            await init.navigateToMonitorDetails(
                componentName,
                monitorName,
                page
            );

            Promise.all([
                async () => {
                    const addButtonSelector = '#addScheduledEventButton';
                    await page.waitForSelector(addButtonSelector);
                    await page.click(addButtonSelector);

                    await page.click('input[name=startDate]');
                    await page.click(
                        'div > div:nth-child(3) > div > div:nth-child(2) button:nth-child(2)'
                    );
                    await page.waitFor(1000);
                    await page.click('input[name=endDate]');
                    await page.click(
                        'div > div:nth-child(3) > div > div:nth-child(2) button:nth-child(2)'
                    );

                    await page.type(
                        'input[name=name]',
                        `${utils.scheduledEventName}1`
                    );
                    await page.type(
                        'textarea[name=description]',
                        utils.scheduledEventDescription
                    );

                    await page.click('#createScheduledEventButton');
                    await page.waitFor(20000);
                },
            ]).then(async () => {
                const createdScheduledEventSelector =
                    '#scheduledEventsList > div.scheduled-event-list-item';

                const scheduledEventRows = await page.$$(
                    createdScheduledEventSelector
                );
                const countScheduledEvent = scheduledEventRows.length;

                expect(countScheduledEvent).toEqual(2);
            });
        });
    });

    // test(
    //     'Should navigate to monitor details and create a new subscriber',
    //     async () => {
    //         expect.assertions(1);
    //         await cluster.execute(null, async ({ page }) => {
    //             await page.setDefaultTimeout(utils.timeout);
    //             // Navigate to Monitor details
    //             await init.navigateToMonitorDetails(
    //                 componentName,
    //                 monitorName,
    //                 page
    //             );

    //             const addButtonSelector = '#addSubscriberButton';
    //             await page.waitForSelector(addButtonSelector);
    //             await page.click(addButtonSelector);

    //             await page.waitForSelector('#alertViaId');

    //             await init.selectByText('#alertViaId', 'email', page);
    //             await page.type('input[name=email]', subscriberEmail);
    //             await page.click('#createSubscriber');
    //             await page.waitFor(2000);

    //             const createdSubscriberSelector =
    //                 '#subscribersList > tbody > tr.subscriber-list-item .contact';
    //             const createdSubscriberEmail = await page.$eval(
    //                 createdSubscriberSelector,
    //                 el => el.textContent
    //             );

    //             expect(createdSubscriberEmail).toEqual(subscriberEmail);
    //         });
    //     },
    //     operationTimeOut
    // );

    // test('Should navigate to monitor details and get list of subscribers and paginate subscribers', async () => {
    //     expect.assertions(2);
    //     await cluster.execute(null, async ({ page }) => {
    //         await page.setDefaultTimeout(utils.timeout);
    //         // Navigate to Monitor details
    //         await init.navigateToMonitorDetails(
    //             componentName,
    //             monitorName,
    //             page
    //         );

    //         const addButtonSelector = '#addSubscriberButton';
    //         await page.waitForSelector(addButtonSelector);

    //         for (let i = 0; i < 5; i++) {
    //             await page.click(addButtonSelector);
    //             await page.waitForSelector('#alertViaId');
    //             await init.selectByText('#alertViaId', 'email', page);
    //             await page.type(
    //                 'input[name=email]',
    //                 utils.generateRandomBusinessEmail()
    //             );
    //             await page.click('#createSubscriber');
    //             await page.waitFor(1000);
    //         }

    //         await page.waitFor(2000);

    //         const nextSelector = await page.$('#btnNextSubscriber');
    //         await nextSelector.click();
    //         await page.waitFor(2000);

    //         const createdSubscriberSelector =
    //             '#subscribersList > tbody > tr.subscriber-list-item';

    //         let subscriberRows = await page.$$(createdSubscriberSelector);
    //         let countSubscribers = subscriberRows.length;

    //         expect(countSubscribers).toEqual(1);

    //         const prevSelector = await page.$('#btnPrevSubscriber');
    //         await prevSelector.click();
    //         await page.waitFor(2000);

    //         subscriberRows = await page.$$(createdSubscriberSelector);
    //         countSubscribers = subscriberRows.length;

    //         expect(countSubscribers).toEqual(5);
    //     });
    // });

    // test(
    //     'Should navigate to monitor details and create a webhook',
    //     async () => {
    //         expect.assertions(1);
    //         await cluster.execute(null, async ({ page }) => {
    //             await page.setDefaultTimeout(utils.timeout);
    //             // Navigate to Monitor details
    //             await init.navigateToMonitorDetails(
    //                 componentName,
    //                 monitorName,
    //                 page
    //             );

    //             const addButtonSelector = '#addWebhookButton';
    //             await page.waitForSelector(addButtonSelector);
    //             await page.click(addButtonSelector);

    //             await page.waitForSelector('#endpoint');

    //             await page.type('#endpoint', webhookEndpoint);
    //             await init.selectByText('#endpointType', 'GET', page);

    //             await page.evaluate(() => {
    //                 document
    //                     .querySelector('input[name=incidentCreated]')
    //                     .click();
    //             });

    //             const createdWebhookSelector =
    //                 '#webhookList > tbody > tr.webhook-list-item > td:nth-child(1) > div > span > div > span';

    //             await page.click('#createWebhook');
    //             await page.waitForSelector(createdWebhookSelector);

    //             const createdWebhookEndpoint = await page.$eval(
    //                 createdWebhookSelector,
    //                 el => el.textContent
    //             );

    //             expect(createdWebhookEndpoint).toEqual(webhookEndpoint);
    //         });
    //     },
    //     operationTimeOut
    // );

    // test('Should navigate to monitor details and get list of webhooks and paginate webhooks', async () => {
    //     // expect.assertions(2);
    //     await cluster.execute(null, async ({ page }) => {
    //         await page.setDefaultTimeout(utils.timeout);
    //         // Navigate to Monitor details
    //         await init.navigateToMonitorDetails(
    //             componentName,
    //             monitorName,
    //             page
    //         );

    //         const addButtonSelector = '#addWebhookButton';
    //         await page.waitForSelector(addButtonSelector);

    //         for (let i = 0; i < 10; i++) {
    //             await page.click(addButtonSelector);
    //             await page.waitForSelector('#endpoint');

    //             await page.type('#endpoint', utils.generateRandomWebsite());
    //             await init.selectByText('#endpointType', 'GET', page);
    //             await page.evaluate(() => {
    //                 document
    //                     .querySelector('input[name=incidentCreated]')
    //                     .click();
    //             });
    //             await page.click('#createWebhook');
    //             await page.waitFor(1000);
    //         }

    //         await page.waitFor(2000);

    //         const nextSelector = await page.$('#btnNextWebhook');

    //         const createdWebhookSelector =
    //             '#webhookList > tbody > tr.webhook-list-item > td:nth-child(1) > div > span > div > span';

    //         await nextSelector.click();
    //         await page.waitFor(1000);

    //         let webhookRows = await page.$$(createdWebhookSelector);
    //         let countWebhooks = webhookRows.length;

    //         expect(countWebhooks).toEqual(1);

    //         const prevSelector = await page.$('#btnPrevWebhook');

    //         await prevSelector.click();
    //         await page.waitFor(1000);

    //         webhookRows = await page.$$(createdWebhookSelector);
    //         countWebhooks = webhookRows.length;

    //         expect(countWebhooks).toEqual(10);
    //     });
    // });

    // test(
    //     'Should navigate to monitor details and edit monitor',
    //     async () => {
    //         await cluster.execute(null, async ({ page }) => {
    //             await page.setDefaultTimeout(utils.timeout);
    //             // Navigate to Monitor details
    //             await init.navigateToMonitorDetails(
    //                 componentName,
    //                 monitorName,
    //                 page
    //             );

    //             const editButtonSelector = `#edit_${monitorName}`;
    //             await page.click(editButtonSelector);

    //             await page.waitForSelector('#form-new-monitor');
    //             await page.click('input[id=name]', { clickCount: 3 });
    //             await page.keyboard.press('Backspace');
    //             await page.type('input[id=name]', newMonitorName);
    //             await page.click('button[type=submit]');

    //             const selector = `span#monitor-title-${newMonitorName}`;

    //             let spanElement = await page.waitForSelector(selector);
    //             spanElement = await spanElement.getProperty('innerText');
    //             spanElement = await spanElement.jsonValue();

    //             spanElement.should.be.exactly(newMonitorName);
    //         });
    //     },
    //     operationTimeOut
    // );

    // test(
    //     'Should navigate to monitor details and delete monitor',
    //     async () => {
    //         expect.assertions(1);
    //         await cluster.execute(null, async ({ page }) => {
    //             await page.setDefaultTimeout(utils.timeout);
    //             // Navigate to Monitor details
    //             await init.navigateToMonitorDetails(
    //                 componentName,
    //                 newMonitorName,
    //                 page
    //             );

    //             const deleteButtonSelector = `#delete_${newMonitorName}`;
    //             await page.click(deleteButtonSelector);

    //             const confirmDeleteButtonSelector = '#deleteMonitor';
    //             await page.waitForSelector(confirmDeleteButtonSelector);
    //             await page.click(confirmDeleteButtonSelector);

    //             const selector = `span#monitor-title-${newMonitorName}`;

    //             const spanElement = await page.$(selector);
    //             expect(spanElement).toEqual(null);
    //         });
    //     },
    //     operationTimeOut
    // );
});
