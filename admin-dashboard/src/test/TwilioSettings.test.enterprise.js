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

    afterAll(async done => {
        await cluster.idle();
        await cluster.close();
        done();
    });

    test(
        'Should not submit empty fields',
        async done => {
            await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.ADMIN_DASHBOARD_URL);
                await page.waitForSelector('#settings');
                await page.click('#settings a');

                await page.waitForSelector('#twilio');
                await page.click('#twilio a');
                await page.waitForSelector('#twilio-form');

                await page.click('button[type=submit]');
                const error = await page.waitForSelector('.field-error', {
                    visible: true,
                });
                expect(error).toBeDefined();
            });
            done();
        },
        operationTimeOut
    );

    test(
        'Should show error message if an invalid account-sid is used.',
        async done => {
            await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.ADMIN_DASHBOARD_URL);
                await page.waitForSelector('#settings');
                await page.click('#settings a');

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
                    '79a35156d9967f0f6d8cc0761ef7d48d'
                );
                await page.click('input[name=phone]');
                await page.type(
                    'input[name=phone]',
                    '+15005550006'
                );

                await page.click('input[name=alert-limit]');
                await page.type('input[name=alert-limit]', '5');

                await page.click('button[type=submit]');
                await page.waitForSelector('#errors', { visible: true });
                const errorMessage = await page.$eval(
                    '#errors',
                    element => element.textContent
                );
                expect(errorMessage).toEqual('accountSid must start with AC');
                await page.reload();

                await page.waitForSelector('input[name=account-sid]', {
                    visible: true,
                });
                const value = await page.$eval(
                    'input[name=account-sid]',
                    e => e.value
                );
                expect(value).toEqual('');
            });
            done();
        },
        operationTimeOut
    );

    test(
        'Should show error if an invalid phone number is used.',
        async done => {
            await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.ADMIN_DASHBOARD_URL);
                await page.waitForSelector('#settings');
                await page.click('#settings a');

                await page.waitForSelector('#twilio');
                await page.click('#twilio a');
                await page.waitForSelector('#twilio-form');

                await page.click('input[name=account-sid]');
                await page.type(
                    'input[name=account-sid]',
                    'AC4b957669470069d68cd5a09d7f91d7c6'
                );
                await page.click('input[name=authentication-token]');
                await page.type(
                    'input[name=authentication-token]',
                    '79a35156d9967f0f6d8cc0761ef7d48d'
                );
                await page.click('input[name=phone]');
                await page.type('input[name=phone]', '+123');

                await page.click('input[name=alert-limit]');
                await page.type('input[name=alert-limit]', '5');

                await page.click('button[type=submit]');

                await page.waitForSelector('#errors', { visible: true });
                const errorMessage = await page.$eval(
                    '#errors',
                    element => element.textContent
                );
                expect(errorMessage).toEqual(
                    'The From phone number +123 is not a valid, SMS-capable inbound phone number or short code for your account.'
                );
                await page.reload();

                await page.waitForSelector('input[name=account-sid]', {
                    visible: true,
                });
                const value = await page.$eval(
                    'input[name=account-sid]',
                    e => e.value
                );
                expect(value).toEqual('');
            });
            done();
        },
        operationTimeOut
    );

    test(
        'Should save valid form data',
        async done => {
            await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.ADMIN_DASHBOARD_URL);
                await page.waitForSelector('#settings');
                await page.click('#settings a');

                await page.waitForSelector('#twilio');
                await page.click('#twilio a');
                await page.waitForSelector('#twilio-form');

                await page.$eval('#sms-enabled', e => e.click());

                await page.click('input[name=account-sid]');
                await page.type(
                    'input[name=account-sid]',
                    'AC4b957669470069d68cd5a09d7f91d7c6'
                );
                await page.click('input[name=authentication-token]');
                await page.type(
                    'input[name=authentication-token]',
                    '79a35156d9967f0f6d8cc0761ef7d48d'
                );
                await page.click('input[name=phone]');
                await page.type(
                    'input[name=phone]',
                    '+15005550006'
                );

                await page.click('input[name=alert-limit]');
                await page.type('input[name=alert-limit]', '5');

                await page.click('button[type=submit]');
                await page.waitForSelector('.ball-beat', { visible: true });
                await page.waitForSelector('.ball-beat', { hidden: true });
                await page.reload();

                await page.waitForSelector('input[name=account-sid]', {
                    visible: true,
                });
                const value = await page.$eval(
                    'input[name=account-sid]',
                    e => e.value
                );

                expect(value).toEqual('AC4b957669470069d68cd5a09d7f91d7c6');
            });
            done();
        },
        operationTimeOut
    );

    test(
        'should render an error message if the user try to update his alert phone number without typing the right verification code.',
        async done => {
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
                await page.type('#otp', '654321');
                await page.click('#verify');
                await page.waitForSelector('#smsVerificationErrors', {
                    visible: true,
                });
                const message = await page.$eval(
                    '#smsVerificationErrors',
                    e => e.textContent
                );
                expect(message).toEqual('Invalid code !');
            });
            done();
        },
        operationTimeOut
    );

    test(
        'should set the alert phone number if the user types the right verification code.',
        async done => {
            await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.ADMIN_DASHBOARD_URL);
                await page.waitForSelector('#goToUserDashboard');
                await page.click('#goToUserDashboard');
                await page.waitForSelector('#profile-menu');
                await page.click('#profile-menu');
                await page.waitForSelector('#userProfile');
                await page.click('#userProfile');
                await page.waitForSelector('input[type=tel]');
                await page.click('input[type=tel]', { clickCount: 3 });
                await page.type('input[type=tel]', phoneNumber);
                await page.waitForSelector('#sendVerificationSMS', {
                    visible: true,
                });
                await page.click('#sendVerificationSMS');
                await page.waitForSelector('#otp');
                await page.type('#otp', '123456');
                await page.click('#verify');
                await page.waitForSelector('#successMessage', {
                    visible: true,
                });
                const message = await page.$eval(
                    '#successMessage',
                    e => e.textContent
                );
                expect(message).toEqual(
                    'Verification successful, this number has been updated.'
                );
            });
            done();
        },
        operationTimeOut
    );

    test(
        'should update alert phone number if user types the right verification code.',
        async done => {
            await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.ADMIN_DASHBOARD_URL);
                await page.waitForSelector('#goToUserDashboard');
                await page.click('#goToUserDashboard');
                await page.waitForSelector('#profile-menu');
                await page.click('#profile-menu');
                await page.waitForSelector('#userProfile');
                await page.click('#userProfile');

                await page.reload({ waitUntil: 'networkidle0' });
                await page.waitForSelector('input[type=tel]');
                await page.click('input[type=tel]');
                await page.keyboard.press('Backspace');
                await page.type('input[type=tel]', '1', {
                    delay: 150,
                });
                await page.waitForSelector('#sendVerificationSMS', {
                    visible: true,
                });
                await page.click('#sendVerificationSMS');
                await page.waitForSelector('#otp');
                await page.type('#otp', '123456');
                await page.click('#verify');
                await page.waitForSelector('#successMessage', {
                    visible: true,
                });
                const message = await page.$eval(
                    '#successMessage',
                    e => e.textContent
                );
                expect(message).toEqual(
                    'Verification successful, this number has been updated.'
                );
            });
            done();
        },
        operationTimeOut
    );
});
