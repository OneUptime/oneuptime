import puppeteer from 'puppeteer';
import utils from '../../test-utils';
import init from '../../test-init';

import 'should';
let browser: $TSFixMe, page: $TSFixMe;
// user credentials
const email = utils.generateRandomBusinessEmail();
const password = '1234567890';
const phoneNumber = '+19173976235';

describe('Twilio Settings API', () => {
    const operationTimeOut = init.timeout;

    beforeAll(async () => {
        jest.setTimeout(init.timeout);

        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(utils.agent);

        const user = {
            email: email,
            password: password,
        };
        // user

        await init.registerEnterpriseUser(user, page, false);
    });

    afterAll(async (done: $TSFixMe) => {
        await browser.close();
        done();
    });

    test(
        'Should not submit empty fields',
        async (done: $TSFixMe) => {
            await page.goto(utils.ADMIN_DASHBOARD_URL);

            await init.pageWaitForSelector(page, '#settings');

            await init.pageClick(page, '#settings a');

            await init.pageWaitForSelector(page, '#twilio');

            await init.pageClick(page, '#twilio a');

            await init.pageWaitForSelector(page, '#twilio-form');

            await init.pageClick(page, 'button[type=submit]');
            const error = await init.pageWaitForSelector(page, '.field-error', {
                visible: true,
                timeout: init.timeout,
            });
            expect(error).toBeDefined();

            done();
        },
        operationTimeOut
    );

    test(
        'Should show error message if an invalid account-sid is used.',
        async (done: $TSFixMe) => {
            await page.goto(utils.ADMIN_DASHBOARD_URL);

            await init.pageWaitForSelector(page, '#settings');

            await init.pageClick(page, '#settings a');

            await init.pageWaitForSelector(page, '#twilio');

            await init.pageClick(page, '#twilio a');

            await init.pageWaitForSelector(page, '#twilio-form');

            await init.pageClick(page, 'input[name=account-sid]');

            await init.pageType(
                page,
                'input[name=account-sid]',
                '3ee3290aia22s1i9290qw9'
            );

            await init.pageClick(page, 'input[name=authentication-token]');

            await init.pageType(
                page,
                'input[name=authentication-token]',
                utils.twilioCredentials.authToken
            );

            await init.pageClick(page, 'input[name=phone]');

            await init.pageType(
                page,
                'input[name=phone]',
                utils.twilioCredentials.phoneNumber
            );

            await init.pageClick(page, 'input[name=alert-limit]');

            await init.pageType(page, 'input[name=alert-limit]', '5');

            await init.pageClick(page, 'button[type=submit]');
            await init.pageWaitForSelector(page, '#errors', {
                visible: true,
                timeout: init.timeout,
            });
            const errorMessage = await init.page$Eval(
                page,
                '#errors',
                (element: $TSFixMe) => element.textContent
            );
            expect(errorMessage).toEqual('accountSid must start with AC');
            await page.reload();

            await init.pageWaitForSelector(page, 'input[name=account-sid]', {
                visible: true,
                timeout: init.timeout,
            });
            const value = await init.page$Eval(
                page,
                'input[name=account-sid]',
                (e: $TSFixMe) => e.value
            );
            expect(value).toEqual('');

            done();
        },
        operationTimeOut
    );

    test(
        'Should show error if an invalid phone number is used.',
        async (done: $TSFixMe) => {
            await page.goto(utils.ADMIN_DASHBOARD_URL);

            await init.pageWaitForSelector(page, '#settings');

            await init.pageClick(page, '#settings a');

            await init.pageWaitForSelector(page, '#twilio');

            await init.pageClick(page, '#twilio a');

            await init.pageWaitForSelector(page, '#twilio-form');

            await init.pageClick(page, 'input[name=account-sid]');

            await init.pageType(
                page,
                'input[name=account-sid]',
                utils.twilioCredentials.accountSid
            );

            await init.pageClick(page, 'input[name=authentication-token]');

            await init.pageType(
                page,
                'input[name=authentication-token]',
                utils.twilioCredentials.authToken
            );

            await init.pageClick(page, 'input[name=phone]');

            await init.pageType(page, 'input[name=phone]', '+123');

            await init.pageClick(page, 'input[name=alert-limit]');

            await init.pageType(page, 'input[name=alert-limit]', '5');

            await init.pageClick(page, 'button[type=submit]');

            await init.pageWaitForSelector(page, '#errors', {
                visible: true,
                timeout: init.timeout,
            });
            const errorMessage = await init.page$Eval(
                page,
                '#errors',
                (element: $TSFixMe) => element.textContent
            );
            expect(errorMessage).toEqual(
                'The From phone number +123 is not a valid, SMS-capable inbound phone number or short code for your account.'
            );
            await page.reload();

            await init.pageWaitForSelector(page, 'input[name=account-sid]', {
                visible: true,
                timeout: init.timeout,
            });
            const value = await init.page$Eval(
                page,
                'input[name=account-sid]',
                (e: $TSFixMe) => e.value
            );
            expect(value).toEqual('');

            done();
        },
        operationTimeOut
    );

    test(
        'Should save valid form data',
        async (done: $TSFixMe) => {
            await page.goto(utils.ADMIN_DASHBOARD_URL);

            await init.pageWaitForSelector(page, '#settings');

            await init.pageClick(page, '#settings a');

            await init.pageWaitForSelector(page, '#twilio');

            await init.pageClick(page, '#twilio a');

            await init.pageWaitForSelector(page, '#twilio-form');

            await init.page$Eval(page, '#sms-enabled', (e: $TSFixMe) =>
                e.click()
            );

            await init.pageClick(page, 'input[name=account-sid]');

            await init.pageType(
                page,
                'input[name=account-sid]',
                utils.twilioCredentials.accountSid
            );

            await init.pageClick(page, 'input[name=authentication-token]');

            await init.pageType(
                page,
                'input[name=authentication-token]',
                utils.twilioCredentials.authToken
            );

            await init.pageClick(page, 'input[name=phone]');

            await init.pageType(
                page,
                'input[name=phone]',
                utils.twilioCredentials.phoneNumber
            );

            await init.pageClick(page, 'input[name=alert-limit]');

            await init.pageType(page, 'input[name=alert-limit]', '5');

            await init.pageClick(page, 'button[type=submit]');
            await init.pageWaitForSelector(page, '.ball-beat', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageWaitForSelector(page, '.ball-beat', {
                hidden: true,
            });
            await page.reload();

            await init.pageWaitForSelector(page, 'input[name=account-sid]', {
                visible: true,
                timeout: init.timeout,
            });
            const value = await init.page$Eval(
                page,
                'input[name=account-sid]',
                (e: $TSFixMe) => e.value
            );

            expect(value).toEqual(utils.twilioCredentials.accountSid);

            done();
        },
        operationTimeOut
    );

    test(
        'should render an error message if the user try to update his alert phone number without typing the right verification code.',
        async (done: $TSFixMe) => {
            await page.goto(utils.ADMIN_DASHBOARD_URL);

            await init.pageWaitForSelector(page, '#goToUserDashboard');

            await init.pageClick(page, '#goToUserDashboard');

            await init.pageWaitForSelector(page, '#profile-menu');

            await init.pageClick(page, '#profile-menu');

            await init.pageWaitForSelector(page, '#userProfile');

            await init.pageClick(page, '#userProfile');

            await init.pageWaitForSelector(page, 'input[type=tel]');

            await init.pageType(page, 'input[type=tel]', phoneNumber);

            await init.pageClick(page, '#sendVerificationSMS');

            await init.pageWaitForSelector(page, '#otp');

            await init.pageType(page, '#otp', '654321');

            await init.pageClick(page, '#verify');
            await init.pageWaitForSelector(page, '#smsVerificationErrors', {
                visible: true,
                timeout: init.timeout,
            });
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

    test(
        'should set the alert phone number if the user types the right verification code.',
        async (done: $TSFixMe) => {
            await page.goto(utils.ADMIN_DASHBOARD_URL);

            await init.pageWaitForSelector(page, '#goToUserDashboard');

            await init.pageClick(page, '#goToUserDashboard');

            await init.pageWaitForSelector(page, '#profile-menu');

            await init.pageClick(page, '#profile-menu');

            await init.pageWaitForSelector(page, '#userProfile');

            await init.pageClick(page, '#userProfile');

            await init.pageWaitForSelector(page, 'input[type=tel]');

            await init.pageClick(page, 'input[type=tel]');

            await init.pageType(page, 'input[type=tel]', phoneNumber);
            await init.pageWaitForSelector(page, '#sendVerificationSMS', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#sendVerificationSMS');

            await init.pageWaitForSelector(page, '#otp');

            await init.pageType(page, '#otp', '123456');

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

    test(
        'should update alert phone number if user types the right verification code.',
        async (done: $TSFixMe) => {
            await page.goto(utils.ADMIN_DASHBOARD_URL);

            await init.pageWaitForSelector(page, '#goToUserDashboard');

            await init.pageClick(page, '#goToUserDashboard');

            await init.pageWaitForSelector(page, '#profile-menu');

            await init.pageClick(page, '#profile-menu');

            await init.pageWaitForSelector(page, '#userProfile');

            await init.pageClick(page, '#userProfile');

            await page.reload({ waitUntil: 'networkidle0' });

            await init.pageWaitForSelector(page, 'input[type=tel]');

            await init.pageClick(page, 'input[type=tel]');
            await page.keyboard.press('Backspace');
            await init.pageType(page, 'input[type=tel]', '1', {
                delay: 150,
            });
            await init.pageWaitForSelector(page, '#sendVerificationSMS', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#sendVerificationSMS');

            await init.pageWaitForSelector(page, '#otp');

            await init.pageType(page, '#otp', '123456');

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
