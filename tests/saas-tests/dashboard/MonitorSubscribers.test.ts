// @ts-expect-error ts-migrate(2307) FIXME: Cannot find module 'puppeteer' or its correspondin... Remove this comment to see the full error message
import puppeteer from 'puppeteer';
import utils from '../../test-utils';
import init from '../../test-init';
const csvFile = `${__dirname}/MOCKS/subscribers.csv`;
const emptyFile = `${__dirname}/MOCKS/emptyTemplateFile.csv`;
const existingSubscribers = `${__dirname}/MOCKS/existing.csv`;

require('should');
let browser: $TSFixMe, page: $TSFixMe;
// user credentials
const email = utils.generateRandomBusinessEmail();
const password = '1234567890';
const monitorName = utils.generateRandomString();
const componentName = utils.generateRandomString();

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
        await init.addMonitorToComponent(componentName, monitorName, page);
    });

    // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'afterAll'.
    afterAll(async (done: $TSFixMe) => {
        await browser.close();
        done();
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test(
        'Should navigate to monitor details and create new subscriber from a csv file',
        async (done: $TSFixMe) => {
            // Navigate to Monitor details
            await init.navigateToMonitorDetails(
                componentName,
                monitorName,
                page
            );

            // click on subscribers tab
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#react-tabs-2');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#react-tabs-2');

            const importFileSelector = '#importFromCsv';
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, importFileSelector);
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, importFileSelector);

            await init.pageWaitForSelector(page, '#fileInput', {
                visible: true,
                timeout: init.timeout,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            const input = await init.page$(page, '#fileInput');
            await input.uploadFile(csvFile);
            await input.evaluate((upload: $TSFixMe) =>
                upload.dispatchEvent(new Event('change', { bubbles: true }))
            );
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#importCsvButton');
            await init.pageWaitForSelector(page, '#importCsvButton', {
                hidden: true,
            });

            const createdSubscriberSelector = '.subscriber-list-item';

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, createdSubscriberSelector);
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            const subscriberRows = await init.page$$(
                page,
                createdSubscriberSelector
            );
            const countSubscribers = subscriberRows.length;
            expect(countSubscribers).toEqual(3);
            done();
        },
        operationTimeOut
    );

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test(
        'Should not create subscribers when an empty file is submitted',
        async (done: $TSFixMe) => {
            // Navigate to Monitor details
            await init.navigateToMonitorDetails(
                componentName,
                monitorName,
                page
            );
            // click on subscribers tab
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#react-tabs-2');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#react-tabs-2');
            const importFileSelector = '#importFromCsv';
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, importFileSelector);
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, importFileSelector);

            await init.pageWaitForSelector(page, '#fileInput', {
                visible: true,
                timeout: init.timeout,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            const input = await init.page$(page, '#fileInput');
            await input.uploadFile(emptyFile);
            await input.evaluate((upload: $TSFixMe) =>
                upload.dispatchEvent(new Event('change', { bubbles: true }))
            );
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#importCsvButton');
            let elementHandle;
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            elementHandle = await init.pageWaitForSelector(
                page,
                'span#errorMsg'
            );
            elementHandle = await elementHandle.getProperty('innerText');
            elementHandle = await elementHandle.jsonValue();
            elementHandle.should.be.exactly('Empty files submitted');
            done();
        },
        operationTimeOut
    );

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test(
        'Should not subscribe if subscriber has already been subscribed to that monitor',
        async (done: $TSFixMe) => {
            // Navigate to Monitor details
            await init.navigateToMonitorDetails(
                componentName,
                monitorName,
                page
            );
            // click on subscribers tab
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#react-tabs-2');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#react-tabs-2');
            const importFileSelector = '#importFromCsv';
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, importFileSelector);
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, importFileSelector);

            await init.pageWaitForSelector(page, '#fileInput', {
                visible: true,
                timeout: init.timeout,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            const input = await init.page$(page, '#fileInput');
            await input.uploadFile(csvFile);
            await input.evaluate((upload: $TSFixMe) =>
                upload.dispatchEvent(new Event('change', { bubbles: true }))
            );
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#importCsvButton');
            await init.pageWaitForSelector(page, '#importCsvButton', {
                hidden: true,
            });
            const createdSubscriberSelector = '.subscriber-list-item';

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, createdSubscriberSelector);
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            const subscriberRows = await init.page$$(
                page,
                createdSubscriberSelector
            );
            const countSubscribers = subscriberRows.length;
            expect(countSubscribers).toEqual(3);
            done();
        },
        operationTimeOut
    );

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test(
        'Should ignore exisiting subscribers and only add new ones',
        async (done: $TSFixMe) => {
            // Navigate to Monitor details
            await init.navigateToMonitorDetails(
                componentName,
                monitorName,
                page
            );
            // click on subscribers tab
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#react-tabs-2');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#react-tabs-2');
            const importFileSelector = '#importFromCsv';
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, importFileSelector);
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, importFileSelector);

            await init.pageWaitForSelector(page, '#fileInput', {
                visible: true,
                timeout: init.timeout,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            const input = await init.page$(page, '#fileInput');
            await input.uploadFile(existingSubscribers);
            await input.evaluate((upload: $TSFixMe) =>
                upload.dispatchEvent(new Event('change', { bubbles: true }))
            );
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#importCsvButton');
            await init.pageWaitForSelector(page, '#importCsvButton', {
                hidden: true,
            });
            const createdSubscriberSelector = '.subscriber-list-item';

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, createdSubscriberSelector);
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            const subscriberRows = await init.page$$(
                page,
                createdSubscriberSelector
            );
            const countSubscribers = subscriberRows.length;
            expect(countSubscribers).toEqual(4);
            done();
        },
        operationTimeOut
    );

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test(
        'Should delete a subscriber',
        async (done: $TSFixMe) => {
            // Navigate to Monitor details
            await init.navigateToMonitorDetails(
                componentName,
                monitorName,
                page
            );
            // click on subscribers tab
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#react-tabs-2');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#react-tabs-2');

            let initialSubscribers = '.subscriber-list-item';

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, initialSubscribers);
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            initialSubscribers = await init.page$$(page, initialSubscribers);
            const initialCount = initialSubscribers.length;

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(
                page,
                'button[id=deleteSubscriber_0]'
            );
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, 'button[id=deleteSubscriber_0]');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#deleteSubscriber');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#deleteSubscriber');
            await init.pageWaitForSelector(page, '#deleteSubscriber', {
                hidden: true,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#subscribersList');

            let finalSubscribers = '.subscriber-list-item';

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, finalSubscribers);
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            finalSubscribers = await init.page$$(page, finalSubscribers);
            const finalCount = finalSubscribers.length;

            expect(finalCount).toEqual(3);
            expect(initialCount).toBeGreaterThan(finalCount);
            done();
        },
        operationTimeOut
    );

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test(
        'Should not delete a subscriber when the cancel button is clicked',
        async (done: $TSFixMe) => {
            // Navigate to Monitor details
            await init.navigateToMonitorDetails(
                componentName,
                monitorName,
                page
            );
            // click on subscribers tab
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#react-tabs-2');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#react-tabs-2');

            let initialSubscribers = '.subscriber-list-item';

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, initialSubscribers);
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            initialSubscribers = await init.page$$(page, initialSubscribers);
            const initialCount = initialSubscribers.length;

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(
                page,
                'button[id=deleteSubscriber_0]'
            );
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, 'button[id=deleteSubscriber_0]');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#cancelDeleteSubscriber');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#cancelDeleteSubscriber');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#subscribersList');

            let finalSubscribers = '.subscriber-list-item';

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, finalSubscribers);
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            finalSubscribers = await init.page$$(page, finalSubscribers);
            const finalCount = finalSubscribers.length;

            expect(finalCount).toEqual(3);
            expect(initialCount).toEqual(finalCount);
            done();
        },
        operationTimeOut
    );
});
