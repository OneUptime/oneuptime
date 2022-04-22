import puppeteer from 'puppeteer';
import Email from 'Common/Types/Email';
import utils from '../../test-utils';
import init from '../../test-init';

import 'should';
let browser: $TSFixMe, page: $TSFixMe;
// User credentials
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
        // User
        await init.registerUser(user, page);
        await init.addMonitorToComponent(componentName, monitorName, page);
    });

    afterAll(async (done: $TSFixMe) => {
        await browser.close();
        done();
    });

    test(
        'When the Contact Number is all Numeric characters',
        async (done: $TSFixMe) => {
            // Navigate to Monitor details
            await init.navigateToMonitorDetails(
                componentName,
                monitorName,
                page
            );

            // Click on subscribers tab

            await init.pageWaitForSelector(page, '.subscribers-tab');

            await init.pageClick(page, '.subscribers-tab');

            const addNewSubscriber: string = '#addSubscriberButton';

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
        'Check for when an sms subscriber is created',
        async (done: $TSFixMe) => {
            // Navigate to Monitor details
            await init.navigateToMonitorDetails(
                componentName,
                monitorName,
                page
            );

            // Click on subscribers tab

            await init.pageWaitForSelector(page, '.subscribers-tab');

            await init.pageClick(page, '.subscribers-tab');

            const textContent: $TSFixMe = await init.page$Eval(
                page,
                '#subscriber_contact',
                (e: $TSFixMe) => {
                    return e.textContent;
                }
            );
            expect(textContent.includes('+19173976123')).toEqual(true);
            done();
        },
        operationTimeOut
    );

    test(
        'When the Contact Number is not a Numeric characters',
        async (done: $TSFixMe) => {
            // Navigate to Monitor details
            await init.navigateToMonitorDetails(
                componentName,
                monitorName,
                page
            );

            // Click on subscribers tab

            await init.pageWaitForSelector(page, '.subscribers-tab');

            await init.pageClick(page, '.subscribers-tab');

            const addNewSubscriber: string = '#addSubscriberButton';

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

            // Click on create subscribers

            await init.pageWaitForSelector(page, '#createSubscriber');

            await init.pageClick(page, '#createSubscriber');

            const textContent: $TSFixMe = await init.page$Eval(
                page,
                '#field-error',
                (e: $TSFixMe) => {
                    return e.textContent;
                }
            );
            expect(
                textContent.includes('Please enter a contact number.')
            ).toEqual(true);
            done();
        },
        operationTimeOut
    );
});
