const puppeteer = require('puppeteer');
const utils = require('./test-utils');
const init = require('./test-init');
const { Cluster } = require('puppeteer-cluster');

require('should');

// user credentials
const email = utils.generateRandomBusinessEmail();
const password = '1234567890';
const monitorName = utils.generateRandomString();
const componentName = utils.generateRandomString();

describe('Monitor Detail Scheduled Events API', () => {
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
            await page.setDefaultTimeout(utils.timeout);
            const user = {
                email: email,
                password: password,
            };
            // user
            await init.registerUser(user, page);
            await init.loginUser(user, page);

            // add new monitor to component on parent project
            await init.addMonitorToComponent(componentName, monitorName, page);
        });
    });

    afterAll(async () => {
        await cluster.idle();
        await cluster.close();
    });

    test(
        'Should navigate to monitor details and create a scheduled event',
        async () => {
            expect.assertions(1);
            return await cluster.execute(null, async ({ page }) => {
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

                const createScheduledEventPromise = page.waitForResponse(
                    response => response.url().includes('/scheduledEvent/')
                );

                await Promise.all([
                    createScheduledEventPromise,
                    page.click('#createScheduledEventButton'),
                ]);

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
        return await cluster.execute(null, async ({ page }) => {
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

            await page.type('input[name=name]', `${utils.scheduledEventName}1`);
            await page.type(
                'textarea[name=description]',
                utils.scheduledEventDescription
            );

            const createScheduledEventPromise = page.waitForResponse(response =>
                response.url().includes('/scheduledEvent/')
            );

            await Promise.all([
                createScheduledEventPromise,
                page.click('#createScheduledEventButton'),
            ]);

            const createdScheduledEventSelector =
                '#scheduledEventsList > div.scheduled-event-list-item';

            await page.waitForSelector(
                '#scheduledEventsList > div.scheduled-event-list-item'
            );

            const scheduledEventRows = await page.$$(
                createdScheduledEventSelector
            );
            const countScheduledEvent = scheduledEventRows.length;

            expect(countScheduledEvent).toEqual(2);
        });
    });
});
