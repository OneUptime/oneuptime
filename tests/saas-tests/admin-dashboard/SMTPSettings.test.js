const puppeteer = require('puppeteer');
const utils = require('../../test-utils');
const init = require('../../test-init');


require('should');

// user credentials
const email = 'masteradmin@hackerbay.io';
const password = '1234567890';

const randomEmail = utils.generateRandomBusinessEmail();
const wrongPassword = utils.generateRandomString();

describe('SMTP Settings API', () => {
    const operationTimeOut = init.timeout;

    

    beforeAll(async () => {
        jest.setTimeout(init.timeout);

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
                await init.pageClick(page, '#settings a');

                await page.waitForSelector('#smtp');
                await init.pageClick(page, '#smtp a');
                await page.waitForSelector('#smtp-form');
                const originalValues = await page.$$eval('input', e =>
                    e.map(field => field.value)
                );
                await init.pageClick(page, 'input[name=email]', { clickCount: 3 });
                await init.pageType(page, 'input[name=email]', ' ');
                await init.pageClick(page, 'input[name=password]', { clickCount: 3 });
                await init.pageType(page, 'input[name=password]', ' ');
                await init.pageClick(page, 'input[name=smtp-server]', { clickCount: 3 });
                await init.pageType(page, 'input[name=smtp-server]', ' ');
                await init.pageClick(page, 'input[name=smtp-port]', { clickCount: 3 });
                await init.pageType(page, 'input[name=smtp-port]', ' ');
                await init.pageClick(page, 'input[name=from]', { clickCount: 3 });
                await init.pageType(page, 'input[name=from]', ' ');
                await init.pageClick(page, 'input[name=from-name]', { clickCount: 3 });
                await init.pageType(page, 'input[name=from-name]', ' ');
                await init.pageClick(page, 'button[type=submit]');

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
                await init.pageClick(page, '#settings');

                await page.waitForSelector('#smtp');
                await init.pageClick(page, '#smtp a');
                await page.waitForSelector('#smtp-form');

                await init.pageClick(page, 'input[name=email]', { clickCount: 3 });
                await init.pageType(page, 'input[name=email]', utils.smtpCredential.user);
                await init.pageClick(page, 'input[name=password]', { clickCount: 3 });
                await init.pageType(page, 
                    'input[name=password]',
                    utils.smtpCredential.pass
                );
                await init.pageClick(page, 'input[name=smtp-server]', { clickCount: 3 });
                await init.pageType(page, 
                    'input[name=smtp-server]',
                    utils.smtpCredential.host
                );
                await init.pageClick(page, 'input[name=smtp-port]', { clickCount: 3 });
                await init.pageType(page, 
                    'input[name=smtp-port]',
                    utils.smtpCredential.port
                );
                await init.pageClick(page, 'input[name=from]', { clickCount: 3 });
                await init.pageType(page, 'input[name=from]', randomEmail);
                await init.pageClick(page, 'input[name=from-name]', { clickCount: 3 });
                await init.pageType(page, 
                    'input[name=from-name]',
                    utils.smtpCredential.name
                );
                await page.$eval('#smtp-secure', element => element.click());
                await init.pageClick(page, 'button[type=submit]');
               
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
                await init.pageClick(page, '#settings');

                await page.waitForSelector('#smtp');
                await init.pageClick(page, '#smtp a');
                await page.waitForSelector('#smtp-form');

                await init.pageClick(page, '#testSmtpSettingsButton');
                await page.waitForSelector('input[name=test-email]');
                await init.pageType(page, 'input[name=test-email]', email);
                await init.pageClick(page, '#confirmSmtpTest');
                
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
                await init.pageClick(page, '#settings');

                await page.waitForSelector('#smtp');
                await init.pageClick(page, '#smtp a');
                await page.waitForSelector('#smtp-form');

                await init.pageClick(page, 'input[name=password]', { clickCount: 3 });
                await init.pageType(page, 'input[name=password]', wrongPassword);

                await init.pageClick(page, '#testSmtpSettingsButton');
                await page.waitForSelector('input[name=test-email]');
                await init.pageType(page, 'input[name=test-email]', email);
                await init.pageClick(page, '#confirmSmtpTest');
                
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
