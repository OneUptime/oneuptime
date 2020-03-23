const puppeteer = require('puppeteer');
const utils = require('./test-utils');
const init = require('./test-init');
const { Cluster } = require('puppeteer-cluster');

// user credentials
const email = utils.generateRandomBusinessEmail();
const password = '1234567890';

const componentName = utils.generateRandomString();
const monitorName = utils.generateRandomString();

describe('Scheduled event', () => {
    const operationTimeOut = 50000;

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
            const user = {
                email,
                password,
            };

            // user
            await init.registerUser(user, page);
            await init.loginUser(user, page);
            // Create component
            await init.addComponent(componentName, page);
        });
    });

    afterAll(async () => {
        await cluster.idle();
        await cluster.close();
    });

    test(
        'should create a new scheduled event for a monitor',
        async () => {
            expect.assertions(1);

            await cluster.execute(null, async ({ page }) => {
                // Navigate to details page of component created
                await init.navigateToComponentDetails(componentName, page);

                await page.waitForSelector('#form-new-monitor');
                await page.click('input[id=name]');
                await page.type('input[id=name]', monitorName);

                await init.selectByText('#type', 'device', page);
                await page.waitForSelector('#deviceId');
                await page.click('#deviceId');
                await page.type('#deviceId', utils.generateRandomString());

                await page.click('button[type=submit]');

                const moreButtonSelector = `#more-details-${monitorName}`;
                await page.waitForSelector(moreButtonSelector);
                await page.click(moreButtonSelector);

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

                await page.click('#createScheduledEventButton');

                const createdScheduledEventSelector =
                    '#scheduledEventsList .scheduled-event-name';
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
        'should update the created scheduled event for a monitor',
        async () => {
            expect.assertions(1);
            await cluster.execute(null, async ({ page }) => {
                // Navigate to details page of component created
                await init.navigateToComponentDetails(componentName, page);

                await page.waitForSelector(`#more-details-${monitorName}`);
                await page.click(`#more-details-${monitorName}`);
                const createdScheduledEventSelector =
                    '#scheduledEventsList .scheduled-event-name';
                await page.waitForSelector(createdScheduledEventSelector);
                await page.click(createdScheduledEventSelector);

                await page.waitFor(5000);

                await page.click('input[name=name]', { clickCount: 3 });
                await page.keyboard.press('Backspace');
                await page.type(
                    'input[name=name]',
                    utils.updatedScheduledEventName
                );

                await page.click('textarea[name=description]', {
                    clickCount: 3,
                });
                await page.keyboard.press('Backspace');
                await page.type(
                    'textarea[name=description]',
                    utils.updatedScheduledEventDescription
                );

                await page.evaluate(() => {
                    document
                        .querySelector('input[name=showEventOnStatusPage]')
                        .click();
                });
                await page.evaluate(() => {
                    document
                        .querySelector('input[name=alertSubscriber]')
                        .click();
                });

                await page.click('#updateScheduledEventButton');

                await page.waitFor(5000);

                const createdScheduledEventName = await page.$eval(
                    createdScheduledEventSelector,
                    el => el.textContent
                );

                expect(createdScheduledEventName).toEqual(
                    utils.updatedScheduledEventName
                );
            });
        },
        operationTimeOut
    );

    test(
        'should delete the created scheduled event for a monitor',
        async () => {
            expect.assertions(1);
            await cluster.execute(null, async ({ page }) => {
                // Navigate to details page of component created
                await init.navigateToComponentDetails(componentName, page);

                await page.waitForSelector(`#more-details-${monitorName}`);
                await page.click(`#more-details-${monitorName}`);

                const deleteButtonSelector =
                    '#scheduledEventsList button.delete-schedule';

                await page.waitForSelector(deleteButtonSelector);
                await page.click(deleteButtonSelector);

                await page.waitFor(5000);

                const scheduledEventCounterSelector = '#scheduledEventCount';
                const scheduledEventCount = await page.$eval(
                    scheduledEventCounterSelector,
                    el => el.textContent
                );

                expect(scheduledEventCount).toEqual('0 Scheduled Event');
            });
        },
        operationTimeOut
    );
});
