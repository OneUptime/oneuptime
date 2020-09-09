const puppeteer = require('puppeteer');
const utils = require('./test-utils');
const init = require('./test-init');
const { Cluster } = require('puppeteer-cluster');

require('should');

// user credentials
const email = utils.generateRandomBusinessEmail();
const password = '1234567890';
const componentName = utils.generateRandomString();
const monitorName = utils.generateRandomString();
const countryCode = '+1';
const phoneNumber = '9173976235';
const subscriberEmail = utils.generateRandomBusinessEmail();

describe('Subscribers Alert logs API', () => {
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

        return await cluster.execute(null, async ({ page }) => {
            const user = {
                email,
                password,
            };
            await init.registerUser(user, page);
            await init.loginUser(user, page);
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
    });

    afterAll(async () => {
        await cluster.idle();
        await cluster.close();
    });

    test(
        'Should add SMS subscribers.',
        async () => {
            return await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.DASHBOARD_URL, {
                    waitUntil: 'networkidle0',
                });
                await init.navigateToMonitorDetails(
                    componentName,
                    monitorName,
                    page
                );
                await page.waitForSelector('#addSubscriberButton');
                await page.click('#addSubscriberButton');
                await page.waitForSelector('#alertViaId');
                await init.selectByText('#alertViaId', 'sms', page);
                await page.waitForSelector('#countryCodeId');
                await init.selectByText('#countryCodeId', countryCode, page);
                await page.type('#contactPhoneId', phoneNumber);
                await page.click('#createSubscriber');
                const subscriberPhoneNumberSelector =
                    '#subscribersList tbody tr:first-of-type td:nth-of-type(4)';
                await page.waitForSelector(subscriberPhoneNumberSelector);
                const subscriberPhoneNumber = await page.$eval(
                    subscriberPhoneNumberSelector,
                    e => e.textContent
                );
                expect(subscriberPhoneNumber).toEqual(
                    `${countryCode}${phoneNumber}`
                );
            });
        },
        operationTimeOut
    );

    test(
        'Should add Email subscribers.',
        async () => {
            return await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.DASHBOARD_URL, {
                    waitUntil: 'networkidle0',
                });
                await init.navigateToMonitorDetails(
                    componentName,
                    monitorName,
                    page
                );
                await page.waitForSelector('#addSubscriberButton');
                await page.click('#addSubscriberButton');
                await page.waitForSelector('#alertViaId');
                await init.selectByText('#alertViaId', 'email', page);
                await page.waitForSelector('#emailId');
                await page.type('#emailId', subscriberEmail);
                await page.click('#createSubscriber');
                const subscriberEmailSelector =
                    '#subscribersList tbody tr:first-of-type td:nth-of-type(4)';
                await page.waitForSelector(subscriberEmailSelector);
                const renderedSubscriberEmail = await page.$eval(
                    subscriberEmailSelector,
                    e => e.textContent
                );
                expect(renderedSubscriberEmail).toEqual(subscriberEmail);
            });
        },
        operationTimeOut
    );

    test(
        'Should send SMS and Email when an incident is created.',
        async () => {
            return await cluster.execute(null, async ({ page }) => {
                await init.navigateToMonitorDetails(
                    componentName,
                    monitorName,
                    page
                );
                await page.waitForSelector(`#createIncident_${monitorName}`);
                await page.click(`#createIncident_${monitorName}`);
                await page.waitForSelector('#incidentType');
                await init.selectByText('#incidentType', 'offline', page);
                await page.click('#createIncident');
                await page.waitForSelector(`#incident_${monitorName}_0`);
                await page.click(`#incident_${monitorName}_0`);
                await page.waitFor(3000);
                await page.reload({
                    waitUntil: 'networkidle0',
                });
                await page.waitForSelector('#subscriberAlertTable tbody tr');
                const rowsCount = (
                    await page.$$('#subscriberAlertTable tbody tr')
                ).length;
                expect(rowsCount).toEqual(2);
                const tableContent = await page.$eval(
                    '#subscriberAlertTable tbody',
                    e => e.textContent
                );

                expect(tableContent).toContain(monitorName);
                expect(tableContent).toContain(`${countryCode}${phoneNumber}`);

                const firstRowIdentifier =
                    '#subscriberAlertTable tbody tr:nth-of-type(1)';
                await page.click(firstRowIdentifier);
                await page.waitForSelector('#backboneModals .bs-Modal-content');
                await page.waitFor(3000);

                const subscriber = await page.$eval(
                    '#backboneModals .bs-Modal-content .bs-Fieldset-rows .bs-Fieldset-row:nth-of-type(2) .bs-Fieldset-fields',
                    e => e.textContent
                );
                const via = await page.$eval(
                    '#backboneModals .bs-Modal-content .bs-Fieldset-rows .bs-Fieldset-row:nth-of-type(3) .bs-Fieldset-fields',
                    e => e.textContent
                );
                const type = await page.$eval(
                    '#backboneModals .bs-Modal-content .bs-Fieldset-rows .bs-Fieldset-row:nth-of-type(4) .bs-Fieldset-fields',
                    e => e.textContent
                );

                expect([
                    subscriberEmail,
                    `${countryCode}${phoneNumber}`,
                ]).toContain(subscriber);
                expect(['sms', 'email']).toContain(via);
                expect(type).toEqual('identified');

                await page.click('#backboneModals .bs-Modal-footer button');
                await page.waitFor(3000);

                const secondRowIdentifier =
                    '#subscriberAlertTable tbody tr:nth-of-type(2)';
                await page.click(secondRowIdentifier);
                await page.waitForSelector('#backboneModals .bs-Modal-content');
                await page.waitFor(3000);

                const subscriber1 = await page.$eval(
                    '#backboneModals .bs-Modal-content .bs-Fieldset-rows .bs-Fieldset-row:nth-of-type(2) .bs-Fieldset-fields',
                    e => e.textContent
                );
                const via1 = await page.$eval(
                    '#backboneModals .bs-Modal-content .bs-Fieldset-rows .bs-Fieldset-row:nth-of-type(3) .bs-Fieldset-fields',
                    e => e.textContent
                );
                const type1 = await page.$eval(
                    '#backboneModals .bs-Modal-content .bs-Fieldset-rows .bs-Fieldset-row:nth-of-type(4) .bs-Fieldset-fields',
                    e => e.textContent
                );

                expect([
                    subscriberEmail,
                    `${countryCode}${phoneNumber}`,
                ]).toContain(subscriber1);
                expect(['sms', 'email']).toContain(via1);
                expect(type1).toEqual('identified');
            });
        },
        operationTimeOut
    );
});
