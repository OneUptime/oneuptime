import puppeteer from 'puppeteer';
import Email from 'Common/Types/Email';
import utils from '../../test-utils';
import init from '../../test-init';
const csvFile: string = `${__dirname}/MOCKS/subscribers.csv`;
const emptyFile: string = `${__dirname}/MOCKS/emptyTemplateFile.csv`;
const existingSubscribers: string = `${__dirname}/MOCKS/existing.csv`;

import 'should';
let browser: $TSFixMe, page: $TSFixMe;
// user credentials
const email: Email = utils.generateRandomBusinessEmail();
const password: string = '1234567890';
const monitorName: string = utils.generateRandomString();
const componentName: string = utils.generateRandomString();

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
        // user
        await init.registerUser(user, page);
        await init.addMonitorToComponent(componentName, monitorName, page);
    });

    afterAll(async (done: $TSFixMe) => {
        await browser.close();
        done();
    });

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

            await init.pageWaitForSelector(page, '#react-tabs-2');

            await init.pageClick(page, '#react-tabs-2');

            const importFileSelector: string = '#importFromCsv';

            await init.pageWaitForSelector(page, importFileSelector);

            await init.pageClick(page, importFileSelector);

            await init.pageWaitForSelector(page, '#fileInput', {
                visible: true,
                timeout: init.timeout,
            });

            const input: $TSFixMe = await init.page$(page, '#fileInput');
            await input.uploadFile(csvFile);
            await input.evaluate((upload: $TSFixMe) =>
                upload.dispatchEvent(new Event('change', { bubbles: true }))
            );

            await init.pageClick(page, '#importCsvButton');
            await init.pageWaitForSelector(page, '#importCsvButton', {
                hidden: true,
            });

            const createdSubscriberSelector: string = '.subscriber-list-item';

            await init.pageWaitForSelector(page, createdSubscriberSelector);

            const subscriberRows: $TSFixMe = await init.page$$(
                page,
                createdSubscriberSelector
            );
            const countSubscribers: $TSFixMe = subscriberRows.length;
            expect(countSubscribers).toEqual(3);
            done();
        },
        operationTimeOut
    );

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

            await init.pageWaitForSelector(page, '#react-tabs-2');

            await init.pageClick(page, '#react-tabs-2');
            const importFileSelector: string = '#importFromCsv';

            await init.pageWaitForSelector(page, importFileSelector);

            await init.pageClick(page, importFileSelector);

            await init.pageWaitForSelector(page, '#fileInput', {
                visible: true,
                timeout: init.timeout,
            });

            const input: $TSFixMe = await init.page$(page, '#fileInput');
            await input.uploadFile(emptyFile);
            await input.evaluate((upload: $TSFixMe) =>
                upload.dispatchEvent(new Event('change', { bubbles: true }))
            );

            await init.pageClick(page, '#importCsvButton');
            let elementHandle: $TSFixMe;

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

            await init.pageWaitForSelector(page, '#react-tabs-2');

            await init.pageClick(page, '#react-tabs-2');
            const importFileSelector: string = '#importFromCsv';

            await init.pageWaitForSelector(page, importFileSelector);

            await init.pageClick(page, importFileSelector);

            await init.pageWaitForSelector(page, '#fileInput', {
                visible: true,
                timeout: init.timeout,
            });

            const input: $TSFixMe = await init.page$(page, '#fileInput');
            await input.uploadFile(csvFile);
            await input.evaluate((upload: $TSFixMe) =>
                upload.dispatchEvent(new Event('change', { bubbles: true }))
            );

            await init.pageClick(page, '#importCsvButton');
            await init.pageWaitForSelector(page, '#importCsvButton', {
                hidden: true,
            });
            const createdSubscriberSelector: string = '.subscriber-list-item';

            await init.pageWaitForSelector(page, createdSubscriberSelector);

            const subscriberRows: $TSFixMe = await init.page$$(
                page,
                createdSubscriberSelector
            );
            const countSubscribers: $TSFixMe = subscriberRows.length;
            expect(countSubscribers).toEqual(3);
            done();
        },
        operationTimeOut
    );

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

            await init.pageWaitForSelector(page, '#react-tabs-2');

            await init.pageClick(page, '#react-tabs-2');
            const importFileSelector: string = '#importFromCsv';

            await init.pageWaitForSelector(page, importFileSelector);

            await init.pageClick(page, importFileSelector);

            await init.pageWaitForSelector(page, '#fileInput', {
                visible: true,
                timeout: init.timeout,
            });

            const input: $TSFixMe = await init.page$(page, '#fileInput');
            await input.uploadFile(existingSubscribers);
            await input.evaluate((upload: $TSFixMe) =>
                upload.dispatchEvent(new Event('change', { bubbles: true }))
            );

            await init.pageClick(page, '#importCsvButton');
            await init.pageWaitForSelector(page, '#importCsvButton', {
                hidden: true,
            });
            const createdSubscriberSelector: string = '.subscriber-list-item';

            await init.pageWaitForSelector(page, createdSubscriberSelector);

            const subscriberRows: $TSFixMe = await init.page$$(
                page,
                createdSubscriberSelector
            );
            const countSubscribers: $TSFixMe = subscriberRows.length;
            expect(countSubscribers).toEqual(4);
            done();
        },
        operationTimeOut
    );

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

            await init.pageWaitForSelector(page, '#react-tabs-2');

            await init.pageClick(page, '#react-tabs-2');

            let initialSubscribers: $TSFixMe = '.subscriber-list-item';

            await init.pageWaitForSelector(page, initialSubscribers);

            initialSubscribers = await init.page$$(page, initialSubscribers);
            const initialCount: $TSFixMe = initialSubscribers.length;

            await init.pageWaitForSelector(
                page,
                'button[id=deleteSubscriber_0]'
            );

            await init.pageClick(page, 'button[id=deleteSubscriber_0]');

            await init.pageWaitForSelector(page, '#deleteSubscriber');

            await init.pageClick(page, '#deleteSubscriber');
            await init.pageWaitForSelector(page, '#deleteSubscriber', {
                hidden: true,
            });

            await init.pageWaitForSelector(page, '#subscribersList');

            let finalSubscribers: $TSFixMe = '.subscriber-list-item';

            await init.pageWaitForSelector(page, finalSubscribers);

            finalSubscribers = await init.page$$(page, finalSubscribers);
            const finalCount: $TSFixMe = finalSubscribers.length;

            expect(finalCount).toEqual(3);
            expect(initialCount).toBeGreaterThan(finalCount);
            done();
        },
        operationTimeOut
    );

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

            await init.pageWaitForSelector(page, '#react-tabs-2');

            await init.pageClick(page, '#react-tabs-2');

            let initialSubscribers: $TSFixMe = '.subscriber-list-item';

            await init.pageWaitForSelector(page, initialSubscribers);

            initialSubscribers = await init.page$$(page, initialSubscribers);
            const initialCount: $TSFixMe = initialSubscribers.length;

            await init.pageWaitForSelector(
                page,
                'button[id=deleteSubscriber_0]'
            );

            await init.pageClick(page, 'button[id=deleteSubscriber_0]');

            await init.pageWaitForSelector(page, '#cancelDeleteSubscriber');

            await init.pageClick(page, '#cancelDeleteSubscriber');

            await init.pageWaitForSelector(page, '#subscribersList');

            let finalSubscribers: $TSFixMe = '.subscriber-list-item';

            await init.pageWaitForSelector(page, finalSubscribers);

            finalSubscribers = await init.page$$(page, finalSubscribers);
            const finalCount: $TSFixMe = finalSubscribers.length;

            expect(finalCount).toEqual(3);
            expect(initialCount).toEqual(finalCount);
            done();
        },
        operationTimeOut
    );
});
