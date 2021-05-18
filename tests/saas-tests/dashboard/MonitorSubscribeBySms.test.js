const puppeteer = require('puppeteer');
const utils = require('../../test-utils');
const init = require('../../test-init');

require('should');
let browser, page;
// user credentials
const email = utils.generateRandomBusinessEmail();
const password = '1234567890';
const monitorName = utils.generateRandomString();
const componentName = utils.generateRandomString();

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
        await init.addMonitorToComponent(componentName, monitorName, page);
    });

    afterAll(async done => {
        await browser.close();
        done();
    });

    test(
        'When the Contact Number is all Numeric characters',
        async done => {
            // Navigate to Monitor details
            await init.navigateToMonitorDetails(
                componentName,
                monitorName,
                page
            );

            // click on subscribers tab
            await init.pageWaitForSelector(page, '#react-tabs-2');
            await init.pageClick(page, '#react-tabs-2');

            const addNewSubscriber = '#addSubscriberButton';
            await init.pageWaitForSelector(page, addNewSubscriber);
            await init.pageClick(page, addNewSubscriber);

            await init.addAnExternalSubscriber(
                componentName,
                monitorName,
                'SMS',
                page,
                {
                    countryCode: '+1',
                    phoneNumber: '9173976123',
                }
            );
            done();
        },
        operationTimeOut
    );

    test(
        'When the Contact Number is not a Numeric characters',
        async done => {
            // Navigate to Monitor details
            await init.navigateToMonitorDetails(
                componentName,
                monitorName,
                page
            );

            // click on subscribers tab
            await init.pageWaitForSelector(page, '#react-tabs-2');
            await init.pageClick(page, '#react-tabs-2');

            const addNewSubscriber = '#addSubscriberButton';
            await init.pageWaitForSelector(page, addNewSubscriber);
            await init.pageClick(page, addNewSubscriber);

            await init.addAnExternalSubscriber(
                componentName,
                monitorName,
                'SMS',
                page,
                {
                    countryCode: '+1',
                    phoneNumber: 'sndvjdnsfvnskdfjn',
                }
            );
            done();
        },
        operationTimeOut
    );
});
