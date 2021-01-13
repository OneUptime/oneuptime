const puppeteer = require('puppeteer');
const utils = require('./test-utils');
const init = require('./test-init');
const { Cluster } = require('puppeteer-cluster');

require('should');

// user credentials
const email = 'masteradmin@hackerbay.io';
const password = '1234567890';

const randomEmail = utils.generateRandomBusinessEmail();
const wrongPassword = utils.generateRandomString();

describe('SMTP Settings API', () => {
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
            // await init.registerEnterpriseUser(user, page);
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

                await page.waitForSelector('#smtp');
                await page.click('#smtp a');
                await page.waitForSelector('#smtp-form');
                const originalValues = await page.$$eval('input', e =>
                    e.map(field => field.value)
                );
                await page.click('input[name=email]', { clickCount: 3 });
                await page.type('input[name=email]', ' ');
                await page.click('input[name=password]', { clickCount: 3 });
                await page.type('input[name=password]', ' ');
                await page.click('input[name=smtp-server]', { clickCount: 3 });
                await page.type('input[name=smtp-server]', ' ');
                await page.click('input[name=smtp-port]', { clickCount: 3 });
                await page.type('input[name=smtp-port]', ' ');
                await page.click('input[name=from]', { clickCount: 3 });
                await page.type('input[name=from]', ' ');
                await page.click('input[name=from-name]', { clickCount: 3 });
                await page.type('input[name=from-name]', ' ');
                await page.click('button[type=submit]');

                // All fields should validate false
                expect((await page.$$('span.field-error')).length).toEqual(
                    (await page.$$('input')).length - 2
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

                await page.waitForSelector('#smtp');
                await page.click('#smtp a');
                await page.waitForSelector('#smtp-form');

                await page.click('input[name=email]', { clickCount: 3 });
                await page.type('input[name=email]', utils.smtpCredential.user);
                await page.click('input[name=password]', { clickCount: 3 });
                await page.type(
                    'input[name=password]',
                    utils.smtpCredential.pass
                );
                await page.click('input[name=smtp-server]', { clickCount: 3 });
                await page.type(
                    'input[name=smtp-server]',
                    utils.smtpCredential.host
                );
                await page.click('input[name=smtp-port]', { clickCount: 3 });
                await page.type(
                    'input[name=smtp-port]',
                    utils.smtpCredential.port
                );
                await page.click('input[name=from]', { clickCount: 3 });
                await page.type('input[name=from]', randomEmail);
                await page.click('input[name=from-name]', { clickCount: 3 });
                await page.type(
                    'input[name=from-name]',
                    utils.smtpCredential.name
                );
                await page.$eval('#smtp-secure', element => element.click());
                await page.click('button[type=submit]');
                await page.waitFor(2000);
                await page.reload();

                const value = await page.$eval(
                    'input[name=email]',
                    e => e.value
                );

                expect(value).toEqual(utils.smtpCredential.user);
            });
        },
        operationTimeOut
    );

    test(
        'Should open a test success modal with valid smtp settings',
        async () => {
            await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.ADMIN_DASHBOARD_URL);
                await page.waitForSelector('#settings');
                await page.click('#settings');

                await page.waitForSelector('#smtp');
                await page.click('#smtp a');
                await page.waitForSelector('#smtp-form');

                await page.click('#testSmtpSettingsButton');
                await page.waitForSelector('input[name=test-email]');
                await page.type('input[name=test-email]', email);
                await page.click('#confirmSmtpTest');
                await page.waitFor(10000);
                await page.waitForSelector(
                    '.bs-Modal-header > div > span > span'
                );
                let elem = await page.$('.bs-Modal-header > div > span > span');
                elem = await elem.getProperty('innerText');
                elem = await elem.jsonValue();

                expect(elem).toEqual('Test Email Sent');
            });
        },
        operationTimeOut
    );

    test(
        'Should open a test failed modal with invalid smtp settings',
        async () => {
            await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.ADMIN_DASHBOARD_URL);
                await page.waitForSelector('#settings');
                await page.click('#settings');

                await page.waitForSelector('#smtp');
                await page.click('#smtp a');
                await page.waitForSelector('#smtp-form');

                await page.click('input[name=password]', { clickCount: 3 });
                await page.type('input[name=password]', wrongPassword);

                await page.click('#testSmtpSettingsButton');
                await page.waitForSelector('input[name=test-email]');
                await page.type('input[name=test-email]', email);
                await page.click('#confirmSmtpTest');
                await page.waitFor(10000);
                await page.waitForSelector(
                    '.bs-Modal-header > div > span > span'
                );
                let elem = await page.$('.bs-Modal-header > div > span > span');
                elem = await elem.getProperty('innerText');
                elem = await elem.jsonValue();

                expect(elem).toEqual('Test Failed');
            });
        },
        operationTimeOut
    );
});
