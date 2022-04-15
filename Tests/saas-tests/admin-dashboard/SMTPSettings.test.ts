import puppeteer from 'puppeteer';
import utils from '../../test-utils';
import init from '../../test-init';

import axios from 'axios';

let browser: $TSFixMe, page: $TSFixMe;
import 'should';

// user credentials
const email: string = 'masteradmin@hackerbay.io';
const password: string = '1234567890';

const smtpName: string = 'Hackerbay';
const wrongPassword: string = utils.generateRandomString();

describe('SMTP Settings API', () => {
    const operationTimeOut: $TSFixMe = init.timeout;

    beforeAll(async () => {
        jest.setTimeout(init.timeout);

        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(utils.agent);

        const user: $TSFixMe = {
            email: email,
            password: password,
        };
        // user

        await init.loginAdminUser(user, page);

        // delete existing smtp details, if there is any.
        const data: $TSFixMe = JSON.stringify({
            collection: 'globalconfigs',
            query: {},
        });

        const config: $TSFixMe = {
            method: 'post',
            url: utils.INIT_SCRIPT_URL + '/removeMany',
            headers: {
                'Content-Type': 'application/json',
            },
            data: data,
        };

        await axios(config);
    });

    afterAll(async () => {
        await browser.close();
    });

    test(
        'Should not submit empty fields',
        async (done: $TSFixMe) => {
            await page.goto(utils.ADMIN_DASHBOARD_URL);

            await init.pageWaitForSelector(page, '#settings');

            await init.pageClick(page, '#settings a');

            await init.pageWaitForSelector(page, '#smtp');

            await init.pageClick(page, '#smtp a');

            await init.pageWaitForSelector(page, '#smtp-form');

            await init.pageClick(page, '#email-enabled');

            await init.pageClick(page, '#customSmtp');

            const originalValues: $TSFixMe = await init.page$$Eval(
                page,
                'input',
                (e: $TSFixMe) => {
                    return e.map((field: $TSFixMe) => {
                        return field.value;
                    });
                }
            );

            await init.pageClick(page, 'input[name=email]');

            await init.pageType(page, 'input[name=email]', '');

            await init.pageClick(page, 'input[name=password]');

            await init.pageType(page, 'input[name=password]', '');

            await init.pageClick(page, 'input[name=smtp-server]');

            await init.pageType(page, 'input[name=smtp-server]', '');

            await init.pageClick(page, 'input[name=smtp-port]');

            await init.pageType(page, 'input[name=smtp-port]', '');

            await init.pageClick(page, 'input[name=from]');

            await init.pageType(page, 'input[name=from]', '');

            await init.pageClick(page, 'input[name=from-name]');

            await init.pageType(page, 'input[name=from-name]', '');

            await init.pageClick(page, 'button[type=submit]');

            // All fields should validate false
            expect(
                (await init.page$$(page, 'span.field-error')).length
            ).toEqual(
                (await init.page$$(page, 'input')).length -
                    4 /** There 10 input values and 6 span-errors */
            );

            //Since we did not save the settings, reloading the page automatically removes the input values

            // All fields should remain as were
            expect(
                await init.page$$Eval(page, 'input', (e: $TSFixMe) => {
                    return e.map((field: $TSFixMe) => {
                        return field.value;
                    });
                })
            ).toEqual(originalValues);
            done();
        },
        operationTimeOut
    );

    test(
        'Should save valid form data',
        async (done: $TSFixMe) => {
            await page.goto(utils.ADMIN_DASHBOARD_URL);

            await init.pageWaitForSelector(page, '#settings');

            await init.pageClick(page, '#settings');

            await init.pageWaitForSelector(page, '#smtp');

            await init.pageClick(page, '#smtp a');

            await init.pageWaitForSelector(page, '#smtp-form');

            await init.pageClick(page, '#email-enabled');

            await init.pageClick(page, '#customSmtp');

            await init.pageClick(page, 'input[name=email]');

            await init.pageType(
                page,
                'input[name=email]',
                utils.smtpCredential.user
            );

            await init.pageClick(page, 'input[name=password]');

            await init.pageType(
                page,
                'input[name=password]',
                utils.smtpCredential.pass
            );

            await init.pageClick(page, 'input[name=smtp-server]');

            await init.pageType(
                page,
                'input[name=smtp-server]',
                utils.smtpCredential.host
            );

            await init.pageClick(page, 'input[name=smtp-port]');

            await init.pageType(
                page,
                'input[name=smtp-port]',
                utils.smtpCredential.port
            );

            await init.pageClick(page, 'input[name=from]');

            await init.pageType(
                page,
                'input[name=from]',
                utils.smtpCredential.from
            );

            await init.pageClick(page, 'input[name=from-name]');

            await init.pageType(page, 'input[name=from-name]', smtpName);
            await init.page$Eval(page, '#smtp-secure', (element: $TSFixMe) => {
                return element.click();
            });

            await init.pageClick(page, 'button[type=submit]');

            await page.reload();

            const value: $TSFixMe = await init.page$Eval(
                page,
                'input[name=email]',
                (e: $TSFixMe) => {
                    return e.value;
                }
            );

            expect(value).toEqual(utils.smtpCredential.user);
            done();
        },
        operationTimeOut
    );

    test(
        'Should open a test success modal with valid smtp settings',
        async (done: $TSFixMe) => {
            await page.goto(utils.ADMIN_DASHBOARD_URL);

            await init.pageWaitForSelector(page, '#settings');

            await init.pageClick(page, '#settings');

            await init.pageWaitForSelector(page, '#smtp');

            await init.pageClick(page, '#smtp a');

            await init.pageWaitForSelector(page, '#smtp-form');

            await init.pageClick(page, '#testSmtpSettingsButton');

            await init.pageWaitForSelector(page, 'input[name=test-email]');

            await init.pageType(page, 'input[name=test-email]', email);

            await init.pageClick(page, '#customSmtpBtn');

            await init.pageClick(page, '#confirmSmtpTest');

            await init.pageWaitForSelector(page, '#test-result');

            let elem: $TSFixMe = await init.page$(page, '#test-result');
            elem = await elem.getProperty('innerText');
            elem = await elem.jsonValue();

            expect(elem).toEqual('Test Email Sent');
            done();
        },
        operationTimeOut
    );

    test(
        'Should open a test failed modal with invalid smtp settings',
        async (done: $TSFixMe) => {
            await page.goto(utils.ADMIN_DASHBOARD_URL);

            await init.pageWaitForSelector(page, '#settings');

            await init.pageClick(page, '#settings');

            await init.pageWaitForSelector(page, '#smtp');

            await init.pageClick(page, '#smtp a');

            await init.pageWaitForSelector(page, '#smtp-form');

            await init.pageClick(page, 'input[name=password]');

            await init.pageType(page, 'input[name=password]', wrongPassword);

            await init.pageClick(page, '#testSmtpSettingsButton');

            await init.pageWaitForSelector(page, 'input[name=test-email]');

            await init.pageType(page, 'input[name=test-email]', email);

            await init.pageClick(page, '#customSmtpBtn');

            await init.pageClick(page, '#confirmSmtpTest');

            await init.pageWaitForSelector(page, '#test-result');

            let elem: $TSFixMe = await init.page$(page, '#test-result');
            elem = await elem.getProperty('innerText');
            elem = await elem.jsonValue();

            expect(elem).toEqual('Test Failed');
            done();
        },
        operationTimeOut
    );
});
