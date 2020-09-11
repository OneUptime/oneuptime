const puppeteer = require('puppeteer');
const { Cluster } = require('puppeteer-cluster');
const utils = require('./test-utils');
const init = require('./test-init');

require('should');

const email = utils.generateRandomBusinessEmail();
const password = '1234567890';

describe('Users Component (IS_SAAS_SERVICE=false)', () => {
    const operationTimeOut = 1000000;

    let cluster;

    beforeAll(async done => {
        jest.setTimeout(2000000);

        cluster = await Cluster.launch({
            concurrency: Cluster.CONCURRENCY_PAGE,
            puppeteerOptions: utils.puppeteerLaunchConfig,
            puppeteer,
            timeout: 1200000,
        });

        cluster.on('taskerror', err => {
            throw err;
        });

        await cluster.execute({ email, password }, async ({ page, data }) => {
            const user = {
                email: data.email,
                password: data.password,
            };
            await init.registerEnterpriseUser(user, page, false);
        });

        done();
    });

    afterAll(async done => {
        await cluster.idle();
        await cluster.close();
        done();
    });

    test(
        'should show a button to add more users to fyipe from admin dashboard',
        async () => {
            await cluster.execute(null, async ({ page }) => {
                // navigating to dashboard url
                // automatically redirects to users route
                await page.goto(utils.ADMIN_DASHBOARD_URL, {
                    waitUntil: 'networkidle0',
                });

                // if element does not exist it will timeout and throw
                const elem = await page.waitForSelector('#add_user', {
                    visible: true,
                });
                expect(elem).toBeTruthy();
            });
        },
        operationTimeOut
    );

    test(
        'should logout and get redirected to the login page if the user deletes his account',
        async () => {
            await cluster.execute(null, async ({ page }) => {
                // navigating to dashboard url
                // automatically redirects to users route
                await page.goto(utils.ADMIN_DASHBOARD_URL, {
                    waitUntil: 'networkidle0',
                });

                await page.waitForSelector(
                    '.bs-ObjectList-rows>a:last-of-type'
                );
                await page.click('.bs-ObjectList-rows>a:last-of-type');
                await page.waitFor(3000);
                await page.waitForSelector('#delete');
                await page.click('#delete');
                await page.waitForSelector('#confirmDelete');
                await page.click('#confirmDelete');
                await page.waitFor(3000);
                await page.waitForSelector('#users');
                await page.click('#users');
                await page.waitForSelector('#login-button');
            });
        },
        operationTimeOut
    );

    test(
        'Should not activate google authenticator if the verification code field is empty',
        async () => {
            return await cluster.execute(null, async ({ page }) => {
                // visit the dashboard
                await page.goto(utils.ADMIN_DASHBOARD_URL, {
                    waitUntil: 'networkidle0',
                });
                await page.waitForSelector(
                    '.bs-ObjectList-rows > a:nth-child(2)'
                );
                await page.click('.bs-ObjectList-rows > a:nth-child(2)');
                await page.waitFor(5000);

                // toggle the google authenticator
                await page.$eval('input[name=twoFactorAuthEnabled]', e =>
                    e.click()
                );

                // click on the next button
                await page.waitForSelector('#nextFormButton');
                await page.click('#nextFormButton');

                // click the verification button
                await page.waitForSelector('#enableTwoFactorAuthButton');
                await page.click('#enableTwoFactorAuthButton');

                // verify there is an error message
                let spanElement = await page.waitForSelector('.field-error');
                spanElement = await spanElement.getProperty('innerText');
                spanElement = await spanElement.jsonValue();
                spanElement.should.be.exactly('Auth token is required.');
            });
        },
        operationTimeOut
    );

    test(
        'Should not activate google authenticator if the verification code is invalid',
        async () => {
            return await cluster.execute(null, async ({ page }) => {
                // visit the dashboard
                await page.goto(utils.ADMIN_DASHBOARD_URL, {
                    waitUntil: 'networkidle0',
                });
                await page.waitForSelector(
                    '.bs-ObjectList-rows > a:nth-child(2)'
                );
                await page.click('.bs-ObjectList-rows > a:nth-child(2)');
                await page.waitFor(5000);

                // toggle the google authenticator
                await page.$eval('input[name=twoFactorAuthEnabled]', e =>
                    e.click()
                );

                // click on the next button
                await page.waitForSelector('#nextFormButton');
                await page.click('#nextFormButton');

                // enter a random verification code
                await page.waitForSelector('input[name=token]');
                await page.type('input[name=token]', '021196');

                // click the verification button
                await page.waitForSelector('#enableTwoFactorAuthButton');
                await page.click('#enableTwoFactorAuthButton');

                // verify there is an error message
                let spanElement = await page.waitForSelector('#modal-message');
                spanElement = await spanElement.getProperty('innerText');
                spanElement = await spanElement.jsonValue();
                spanElement.should.be.exactly('Invalid token.');
            });
        },
        operationTimeOut
    );
});
