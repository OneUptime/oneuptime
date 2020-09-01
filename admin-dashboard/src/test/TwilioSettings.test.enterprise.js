const puppeteer = require('puppeteer');
const utils = require('./test-utils');
const init = require('./test-init');
const { Cluster } = require('puppeteer-cluster');

require('should');

// user credentials
const email = 'masteradmin@hackerbay.io';
const password = '1234567890';
const phoneNumber = '+19173976235';

describe('Twilio Settings API', () => {
    const operationTimeOut = 100000;

    let cluster;

    beforeAll(async () => {
        jest.setTimeout(200000);

        cluster = await Cluster.launch({
            concurrency: Cluster.CONCURRENCY_PAGE,
            puppeteerOptions: utils.puppeteerLaunchConfig,
            puppeteer,
            timeout: 120000,
        });

        cluster.on('taskerror', err => {
            throw err;
        });

        // Register user
        await cluster.execute({ email, password }, async ({ page, data }) => {
            const user = {
                email: data.email,
                password: data.password,
            };
            // user
            await init.registerEnterpriseUser(user, page, false);
        });
    });

    afterAll(async () => {
        await cluster.idle();
        await cluster.close();
    });

    test(
        'Should not submit empty fields',
        async () => {
            expect.assertions(2);
            await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.ADMIN_DASHBOARD_URL);
                await page.waitForSelector('#settings');
                await page.click('#settings a');

                await page.waitForSelector('#twilio');
                await page.click('#twilio a');
                await page.waitForSelector('#twilio-form');

                const originalValues = await page.$$eval('input', e =>
                    e.map(field => field.value)
                );

                await page.click('button[type=submit]');

                // All fields should validate false
                expect((await page.$$('span.field-error')).length).toEqual(
                    (await page.$$('input[type=text],input[type=number]'))
                        .length
                );

                await page.reload();

                // All fields should remain as were
                expect(
                    await page.$$eval('input', e => e.map(field => field.value))
                ).toEqual(originalValues);
            });
        },
        operationTimeOut
    );

    test(
        'Should show error message if an invalide account-sid is used.',
        async () => {
            expect.assertions(2);
            await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.ADMIN_DASHBOARD_URL);
                await page.waitForSelector('#settings');
                await page.click('#settings');

                await page.waitForSelector('#twilio');
                await page.click('#twilio a');
                await page.waitForSelector('#twilio-form');

                await page.click('input[name=account-sid]');
                await page.type(
                    'input[name=account-sid]',
                    '3ee3290aia22s1i9290qw9'
                );
                await page.click('input[name=authentication-token]');
                await page.type(
                    'input[name=authentication-token]',
                    '1233|do22'
                );
                await page.click('input[name=phone');
                await page.type('input[name=phone', '+12992019922');

                await page.click('input[name=alert-limit]');
                await page.type('input[name=alert-limit]', '5');

                await page.click('button[type=submit]');
                await page.waitFor(2000);
                await page.waitForSelector('#errors');
                const errorMessage = await page.$eval(
                    '#errors',
                    element => element.textContent
                );
                expect(errorMessage).toEqual('accountSid must start with AC');
                await page.reload();

                const value = await page.$eval(
                    'input[name=account-sid]',
                    e => e.value
                );
                expect(value).toEqual('');
            });
        },
        operationTimeOut
    );

    test(
        'Should show error if an invalide phone number is used.',
        async () => {
            expect.assertions(2);
            await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.ADMIN_DASHBOARD_URL);
                await page.waitForSelector('#settings');
                await page.click('#settings');

                await page.waitForSelector('#twilio');
                await page.click('#twilio a');
                await page.waitForSelector('#twilio-form');

                await page.click('input[name=account-sid]');
                await page.type(
                    'input[name=account-sid]',
                    process.env.TEST_TWILIO_ACCOUNT_SID
                );
                await page.click('input[name=authentication-token]');
                await page.type(
                    'input[name=authentication-token]',
                    process.env.TEST_TWILIO_ACCOUNT_AUTH_TOKEN
                );
                await page.click('input[name=phone');
                await page.type('input[name=phone', '+123');

                await page.click('input[name=alert-limit]');
                await page.type('input[name=alert-limit]', '5');

                await page.click('button[type=submit]');
                await page.waitFor(2000);
                await page.waitForSelector('#errors');
                const errorMessage = await page.$eval(
                    '#errors',
                    element => element.textContent
                );
                expect(errorMessage).toEqual(
                    'The From phone number +123 is not a valid, SMS-capable inbound phone number or short code for your account.'
                );
                await page.reload();

                const value = await page.$eval(
                    'input[name=account-sid]',
                    e => e.value
                );
                expect(value).toEqual('');
            });
        },
        operationTimeOut
    );

    test(
        'Should save valid form data',
        async () => {
            expect.assertions(1);
            await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.ADMIN_DASHBOARD_URL);
                await page.waitForSelector('#settings');
                await page.click('#settings');

                await page.waitForSelector('#twilio');
                await page.click('#twilio a');
                await page.waitForSelector('#twilio-form');

                await page.$eval('#sms-enabled', e => e.click());

                await page.click('input[name=account-sid]');
                await page.type(
                    'input[name=account-sid]',
                    process.env.TEST_TWILIO_ACCOUNT_SID
                );
                await page.click('input[name=authentication-token]');
                await page.type(
                    'input[name=authentication-token]',
                    process.env.TEST_TWILIO_ACCOUNT_AUTH_TOKEN
                );
                await page.click('input[name=phone]');
                await page.type(
                    'input[name=phone]',
                    process.env.TEST_TWILIO_PHONE
                );

                await page.click('input[name=alert-limit]');
                await page.type('input[name=alert-limit]', '5');

                await page.click('button[type=submit]');
                await page.waitFor(2000);
                await page.reload();

                const value = await page.$eval(
                    'input[name=account-sid]',
                    e => e.value
                );

                expect(value).toEqual(process.env.TEST_TWILIO_ACCOUNT_SID);
            });
        },
        operationTimeOut
    );

    test(
        'should render an error message if the user try to update his alert phone number without typing the right verification code.',
        async () => {
            expect.assertions(1);
            await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.ADMIN_DASHBOARD_URL);
                await page.waitForSelector('#goToUserDashboard');
                await page.click('#goToUserDashboard');
                await page.waitForSelector('#profile-menu');
                await page.click('#profile-menu');
                await page.waitForSelector('#userProfile');
                await page.click('#userProfile');
                await page.waitForSelector('input[type=tel]');
                await page.type('input[type=tel]', phoneNumber);
                await page.click('#sendVerificationSMS');
                await page.waitForSelector('#otp');
                await page.type(
                    '#otp',
                    process.env.TWILIO_SMS_VERIFICATION_CODE + '123'
                );
                await page.click('#verify');
                await page.waitFor('#smsVerificationErrors');
                const message = await page.$eval(
                    '#smsVerificationErrors',
                    e => e.textContent
                );
                expect(message).toEqual('Invalid code !');
            });
        },
        operationTimeOut
    );

    test(
        'should set the alert phone number if the user types the right verification code.',
        async () => {
            expect.assertions(1);
            await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.ADMIN_DASHBOARD_URL);
                await page.waitForSelector('#goToUserDashboard');
                await page.click('#goToUserDashboard');
                await page.waitForSelector('#profile-menu');
                await page.click('#profile-menu');
                await page.waitForSelector('#userProfile');
                await page.click('#userProfile');
                await page.waitForSelector('input[type=tel]');
                await page.click('input[type=tel]');
                await page.keyboard.down('Control');
                await page.keyboard.press('A');
                await page.keyboard.up('Control');
                await page.keyboard.press('Backspace');
                await page.type('input[type=tel]', phoneNumber);
                await page.click('#sendVerificationSMS');
                await page.waitForSelector('#otp');
                await page.type(
                    '#otp',
                    process.env.TWILIO_SMS_VERIFICATION_CODE
                );
                await page.click('#verify');
                await page.waitFor(5000);
                await page.waitFor('#successMessage');
                const message = await page.$eval(
                    '#successMessage',
                    e => e.textContent
                );
                expect(message).toEqual(
                    'Verification successful, this number has been updated.'
                );
            });
        },
        operationTimeOut
    );

    test(
        'should update alert phone number if user types the right verification code.',
        async () => {
            expect.assertions(1);
            await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.ADMIN_DASHBOARD_URL);
                await page.waitForSelector('#goToUserDashboard');
                await page.click('#goToUserDashboard');
                await page.waitForSelector('#profile-menu');
                await page.click('#profile-menu');
                await page.waitForSelector('#userProfile');
                await page.click('#userProfile');
                await page.waitForSelector('input[type=tel]');
                await page.click('input[type=tel]');
                await page.keyboard.down('Control');
                await page.keyboard.press('A');
                await page.keyboard.up('Control');
                await page.keyboard.press('Backspace');
                await page.type('input[type=tel]', phoneNumber);
                await page.click('#sendVerificationSMS');
                await page.waitForSelector('#otp');
                await page.type(
                    '#otp',
                    process.env.TWILIO_SMS_VERIFICATION_CODE
                );
                await page.click('#verify');
                await page.waitFor(5000);
                await page.waitFor('#successMessage');
                const message = await page.$eval(
                    '#successMessage',
                    e => e.textContent
                );
                expect(message).toEqual(
                    'Verification successful, this number has been updated.'
                );
            });
        },
        operationTimeOut
    );
});
