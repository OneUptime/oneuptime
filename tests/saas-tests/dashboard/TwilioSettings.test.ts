// @ts-expect-error ts-migrate(2307) FIXME: Cannot find module 'puppeteer' or its correspondin... Remove this comment to see the full error message
import puppeteer from 'puppeteer'
import utils from '../../test-utils'
import init from '../../test-init'
let browser: $TSFixMe, page: $TSFixMe;
require('should');

// user credentials
const email = utils.generateRandomBusinessEmail();
const password = '1234567890';
const { twilioCredentials } = { ...utils };

const projectName = 'project';
const componentName = 'component1';
const monitorName = 'monitor1';
const countryCode = '+1';
const phoneNumber = '9173976235';
const alertPhone = '+19173976123';
const incidentTitle = utils.generateRandomString();

// @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'describe'. Do you need to instal... Remove this comment to see the full error message
describe('Custom Twilio Settings', () => {
    const operationTimeOut = init.timeout;

    // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'beforeAll'.
    beforeAll(async (done: $TSFixMe) => {
        // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'jest'.
        jest.setTimeout(360000);
        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(utils.agent);

        const user = {
            email: email,
            password: password,
        };
        // user
        await init.registerUser(user, page);
        // @ts-expect-error ts-migrate(2345) FIXME: Argument of type '"project"' is not assignable to ... Remove this comment to see the full error message
        await init.addProject(page, projectName);

        done();
    });

    // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'afterAll'.
    afterAll(async (done: $TSFixMe) => {
        await browser.close();
        done();
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test(
        'should create a custom twilio settings',
        async (done: $TSFixMe) => {
            await page.goto(utils.DASHBOARD_URL);
            await init.pageWaitForSelector(page, '#projectSettings', {
                visible: true,
                timeout: init.timeout,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#projectSettings');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#more');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#more');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#smsCalls');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#smsCalls');
            await init.pageWaitForSelector(page, '#enableTwilio', {
                visible: true,
                timeout: init.timeout,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#enableTwilio');
            await init.pageWaitForSelector(page, '#accountSid', {
                visible: true,
                timeout: init.timeout,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await init.pageType(
                page,
                '#accountSid',
                twilioCredentials.accountSid
            );
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await init.pageType(
                page,
                '#authToken',
                twilioCredentials.authToken
            );
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await init.pageType(
                page,
                '#phoneNumber',
                twilioCredentials.phoneNumber
            );
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#submitTwilioSettings');

            await init.navigateToTwilio(page);
            await init.pageWaitForSelector(page, '#accountSid', {
                visible: true,
                timeout: init.timeout,
            });
            const savedAccountSid = await init.page$Eval(
                page,
                '#accountSid',
                (elem: $TSFixMe) => elem.value
            );
            expect(savedAccountSid).toBe(twilioCredentials.accountSid);

            done();
        },
        operationTimeOut
    );

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test(
        'should send SMS to external subscribers if an incident is created.',
        async (done: $TSFixMe) => {
            await init.addMonitorToComponent(componentName, monitorName, page);
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '.subscribers-tab');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#addSubscriberButton');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#addSubscriberButton');
            await init.selectDropdownValue('#alertViaId', 'SMS', page);
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#countryCodeId');
            await init.selectDropdownValue('#countryCodeId', countryCode, page);
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await init.pageType(page, '#contactPhoneId', phoneNumber);
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#createSubscriber');
            await init.pageWaitForSelector(page, '#createSubscriber', {
                hidden: true,
            });

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '.basic-tab');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(
                page,
                `#monitorCreateIncident_${monitorName}`
            );
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, `#monitorCreateIncident_${monitorName}`);
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#createIncident');
            await init.selectDropdownValue('#incidentType', 'Offline', page);
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await init.pageType(page, 'input[name=title]', incidentTitle);
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#createIncident');
            await init.pageWaitForSelector(page, '#createIncident', {
                hidden: true,
            });

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#closeIncident_0');
            await init.page$Eval(page, '#closeIncident_0', (elem: $TSFixMe) => elem.click()
            );
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, `#incident_0`);
            await init.page$Eval(page, `#incident_0`, (elem: $TSFixMe) => elem.click());
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#incident_0');

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '.alert-tab');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(
                page,
                '#subscriberAlertTable > tbody > tr'
            );
            await init.page$Eval(
                page,
                '#subscriberAlertTable > tbody > tr',
                (elem: $TSFixMe) => elem.click()
            );
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#subscriber');
            const subscriber = await init.page$Eval(
                page,
                '#subscriber',
                (elem: $TSFixMe) => elem.textContent
            );
            expect(subscriber).toEqual(`${countryCode}${phoneNumber}`);

            done();
        },
        operationTimeOut
    );

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test(
        'should send SMS to external subscribers if an incident is acknowledged.',
        async (done: $TSFixMe) => {
            await page.goto(utils.DASHBOARD_URL);
            await init.navigateToMonitorDetails(
                componentName,
                monitorName,
                page
            );

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, `#incident_0`);
            await init.page$Eval(page, `#incident_0`, (elem: $TSFixMe) => elem.click());
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#btnAcknowledge_0');
            await init.page$Eval(page, '#btnAcknowledge_0', (e: $TSFixMe) => e.click());
            await init.pageWaitForSelector(page, '#AcknowledgeText_0', {
                visible: true,
                timeout: init.timeout,
            });

            await init.navigateToMonitorDetails(
                componentName,
                monitorName,
                page
            );
            await init.page$Eval(page, `#incident_0`, (elem: $TSFixMe) => elem.click());

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '.alert-tab');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(
                page,
                '#subscriberAlertTable > tbody > tr'
            );
            // grab the last log
            await init.page$Eval(
                page,
                '#subscriberAlertTable > tbody > tr',
                (elem: $TSFixMe) => elem.click()
            );
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#eventType');
            const eventType = await init.page$Eval(
                page,
                '#eventType',
                (elem: $TSFixMe) => elem.textContent
            );
            expect(eventType).toEqual('acknowledged');

            done();
        },
        operationTimeOut
    );

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test(
        'should send SMS to external subscribers if an incident is resolved.',
        async (done: $TSFixMe) => {
            await page.goto(utils.DASHBOARD_URL);
            await init.navigateToMonitorDetails(
                componentName,
                monitorName,
                page
            );

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, `#incident_0`);
            await init.page$Eval(page, `#incident_0`, (elem: $TSFixMe) => elem.click());
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#btnResolve_0');
            await init.page$Eval(page, '#btnResolve_0', (e: $TSFixMe) => e.click());
            await init.pageWaitForSelector(page, '#ResolveText_0', {
                visible: true,
                timeout: init.timeout,
            });
            await init.navigateToMonitorDetails(
                componentName,
                monitorName,
                page
            );
            await init.page$Eval(page, `#incident_0`, (elem: $TSFixMe) => elem.click());

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '.alert-tab');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(
                page,
                '#subscriberAlertTable > tbody > tr'
            );
            // grab the last log
            await init.page$Eval(
                page,
                '#subscriberAlertTable > tbody > tr',
                (elem: $TSFixMe) => elem.click()
            );
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#eventType');
            const eventType = await init.page$Eval(
                page,
                '#eventType',
                (elem: $TSFixMe) => elem.textContent
            );
            expect(eventType).toEqual('resolved');

            done();
        },
        operationTimeOut
    );

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test(
        'should render an error message if the user try to update his alert phone number without typing the right verification code.',
        async (done: $TSFixMe) => {
            await page.goto(utils.DASHBOARD_URL);
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#profile-menu');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#profile-menu');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#userProfile');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#userProfile');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, 'input[type=tel]');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await init.pageType(page, 'input[type=tel]', phoneNumber);
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#sendVerificationSMS');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#otp');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await init.pageType(page, '#otp', '654321');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#verify');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#smsVerificationErrors');
            const message = await init.page$Eval(
                page,
                '#smsVerificationErrors',
                (e: $TSFixMe) => e.textContent
            );
            expect(message).toEqual('Invalid code !');

            done();
        },
        operationTimeOut
    );

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test(
        'should set the alert phone number if the user types the right verification code.',
        async (done: $TSFixMe) => {
            await page.goto(utils.DASHBOARD_URL);
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#profile-menu');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#profile-menu');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#userProfile');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#userProfile');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, 'input[type=tel]');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, 'input[type=tel]');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await init.pageType(page, 'input[type=tel]', alertPhone);
            await init.pageWaitForSelector(page, '#sendVerificationSMS', {
                visible: true,
                timeout: init.timeout,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#sendVerificationSMS');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#otp');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await init.pageType(page, '#otp', '123456');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#verify');
            await init.pageWaitForSelector(page, '#successMessage', {
                visible: true,
                timeout: init.timeout,
            });
            const message = await init.page$Eval(
                page,
                '#successMessage',
                (e: $TSFixMe) => e.textContent
            );
            expect(message).toEqual(
                'Verification successful, this number has been updated.'
            );

            done();
        },
        operationTimeOut
    );

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test(
        'should update alert phone number if user types the right verification code.',
        async (done: $TSFixMe) => {
            await page.goto(utils.DASHBOARD_URL);
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#profile-menu');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#profile-menu');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#userProfile');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#userProfile');

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, 'input[type=tel]');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, 'input[type=tel]');
            await page.keyboard.press('Backspace');
            await init.pageType(page, 'input[type=tel]', '1', {
                delay: 150,
            });
            await init.pageWaitForSelector(page, '#sendVerificationSMS', {
                visible: true,
                timeout: init.timeout,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#sendVerificationSMS');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#otp');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await init.pageType(page, '#otp', '123456');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#verify');
            await init.pageWaitForSelector(page, '#successMessage', {
                visible: true,
                timeout: init.timeout,
            });
            const message = await init.page$Eval(
                page,
                '#successMessage',
                (e: $TSFixMe) => e.textContent
            );
            expect(message).toEqual(
                'Verification successful, this number has been updated.'
            );

            done();
        },
        operationTimeOut
    );
});
