const puppeteer = require('puppeteer');
const utils = require('./test-utils');
const init = require('./test-init');
const { Cluster } = require('puppeteer-cluster');

require('should');

// user credentials
const email = 'masteradmin@hackerbay.io';
const password = '1234567890';

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
            await init.registerEnterpriseUser(user, page);
            await init.loginUser(user, page);
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
                    (await page.$$('input')).length
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
                await page.click('input[name=verification-sid]');
                await page.type(
                    'input[name=verification-sid]',
                    '3ee3290aia22s1i9290qw9'
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

                expect(value).toEqual('3ee3290aia22s1i9290qw9');
            });
        },
        operationTimeOut
    );
});
