// @ts-expect-error ts-migrate(2307) FIXME: Cannot find module 'puppeteer' or its correspondin... Remove this comment to see the full error message
import puppeteer from 'puppeteer';
import utils from '../../test-utils';
import init from '../../test-init';

require('should');

let browser: $TSFixMe, page: $TSFixMe;
// user credentials
const email = utils.generateRandomBusinessEmail();
const password = '1234567890';
const componentName = utils.generateRandomString();
const monitorName = utils.generateRandomString();
const countryCode = '+1';
const phoneNumber = '9173976235';
const subscriberEmail = utils.generateRandomBusinessEmail();

// @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'describe'. Do you need to instal... Remove this comment to see the full error message
describe('Subscribers Alert logs API', () => {
    const operationTimeOut = init.timeout;

    // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'beforeAll'.
    beforeAll(async () => {
        // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'jest'.
        jest.setTimeout(init.timeout);

        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(utils.agent);

        const user = {
            email,
            password,
        };
        await init.registerUser(user, page);

        await init.addSmtpSettings(
            true,
            utils.smtpCredential.user,
            utils.smtpCredential.pass,
            utils.smtpCredential.host,
            utils.smtpCredential.port,
            utils.smtpCredential.from,
            utils.smtpCredential.secure,
            page
        );
        await init.addTwilioSettings(
            true,
            utils.twilioCredentials.accountSid,
            utils.twilioCredentials.authToken,
            utils.twilioCredentials.phoneNumber,
            page
        );
        await init.addMonitorToComponent(componentName, monitorName, page);
    });

    // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'afterAll'.
    afterAll(async (done: $TSFixMe) => {
        await browser.close();
        done();
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test(
        'Should add SMS subscribers.',
        async (done: $TSFixMe) => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: 'networkidle0',
            });
            await init.navigateToMonitorDetails(
                componentName,
                monitorName,
                page
            );
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '.subscribers-tab');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#addSubscriberButton');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#addSubscriberButton');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#alertViaId');
            await init.selectDropdownValue('#alertViaId', 'sms', page);
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
            const subscriberPhoneNumberSelector =
                '#subscribersList tbody tr:first-of-type td:nth-of-type(4)';
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, subscriberPhoneNumberSelector);
            const subscriberPhoneNumber = await init.page$Eval(
                page,
                subscriberPhoneNumberSelector,
                (e: $TSFixMe) => e.textContent
            );
            expect(subscriberPhoneNumber).toEqual(
                `${countryCode}${phoneNumber}`
            );
            done();
        },
        operationTimeOut
    );

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test(
        'Should add Email subscribers.',
        async (done: $TSFixMe) => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: 'networkidle0',
            });
            await init.navigateToMonitorDetails(
                componentName,
                monitorName,
                page
            );
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '.subscribers-tab');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#addSubscriberButton');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#addSubscriberButton');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#alertViaId');
            await init.selectDropdownValue('#alertViaId', 'email', page);
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#emailId');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await init.pageType(page, '#emailId', subscriberEmail);
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#createSubscriber');
            await init.pageWaitForSelector(page, '#createSubscriber', {
                hidden: true,
            });
            await page.reload({ waitUntil: 'networkidle0' });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '.subscribers-tab');
            const subscriberEmailSelector =
                '#subscribersList tbody tr:first-of-type td:nth-of-type(4)';
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, subscriberEmailSelector);
            const renderedSubscriberEmail = await init.page$Eval(
                page,
                subscriberEmailSelector,
                (e: $TSFixMe) => e.textContent
            );
            expect(renderedSubscriberEmail).toEqual(subscriberEmail);
            done();
        },
        operationTimeOut
    );

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test(
        'Should send SMS and Email when an incident is created.',
        async (done: $TSFixMe) => {
            await init.navigateToMonitorDetails(
                componentName,
                monitorName,
                page
            );

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(
                page,
                `#monitorCreateIncident_${monitorName}`
            );
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, `#monitorCreateIncident_${monitorName}`);
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#incidentType');
            await init.selectDropdownValue('#incidentType', 'offline', page);
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#createIncident');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, `#incident_0`);
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#notificationscroll');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#viewIncident-0');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#incident_0');

            await page.reload({ waitUntil: 'networkidle0' });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '.alert-tab');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(
                page,
                '#subscriberAlertTable tbody tr'
            );
            const rowsCount = (
                await init.page$$(page, '#subscriberAlertTable tbody tr', {})
            ).length;
            expect(rowsCount).toEqual(2);

            const firstRowIdentifier =
                '#subscriberAlertTable tbody tr:nth-of-type(1)';
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, firstRowIdentifier);
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(
                page,
                '#backboneModals .bs-Modal-content'
            );

            const subscriber = await init.page$Eval(
                page,
                '#backboneModals #subscriber',
                (e: $TSFixMe) => e.textContent
            );
            const via = await init.page$Eval(
                page,
                '#backboneModals #alertVia',
                (e: $TSFixMe) => e.textContent
            );
            const type = await init.page$Eval(
                page,
                '#backboneModals #eventType',
                (e: $TSFixMe) => e.textContent
            );
            const alertStatus = await init.page$Eval(
                page,
                '#backboneModals #alertStatus',
                (e: $TSFixMe) => e.textContent
            );

            expect([subscriberEmail, `${countryCode}${phoneNumber}`]).toContain(
                subscriber
            );

            expect(['sms', 'email']).toContain(via);
            expect(type).toEqual('identified');
            expect(alertStatus).toEqual('Sent');

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#backboneModals #closeBtn');
            await init.pageWaitForSelector(
                page,
                '#backboneModals .bs-Modal-content',
                {
                    hidden: true,
                }
            );

            const secondRowIdentifier =
                '#subscriberAlertTable tbody tr:nth-of-type(2)';
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, secondRowIdentifier);
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(
                page,
                '#backboneModals .bs-Modal-content'
            );

            const subscriber1 = await init.page$Eval(
                page,
                '#backboneModals #subscriber',
                (e: $TSFixMe) => e.textContent
            );
            const via1 = await init.page$Eval(
                page,
                '#backboneModals #alertVia',
                (e: $TSFixMe) => e.textContent
            );
            const type1 = await init.page$Eval(
                page,
                '#backboneModals #eventType',
                (e: $TSFixMe) => e.textContent
            );
            const alertStatus1 = await init.page$Eval(
                page,
                '#backboneModals #alertStatus',
                (e: $TSFixMe) => e.textContent
            );

            expect([subscriberEmail, `${countryCode}${phoneNumber}`]).toContain(
                subscriber1
            );
            expect(['sms', 'email']).toContain(via1);
            expect(type1).toEqual('identified');
            expect(alertStatus1).toEqual('Sent');
            done();
        },
        operationTimeOut
    );
});
