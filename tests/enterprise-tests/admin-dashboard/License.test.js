const puppeteer = require('puppeteer');
const utils = require('../../test-utils');
const init = require('../../test-init');


require('should');

// user credentials
const userEmail = utils.generateRandomBusinessEmail();
const email = 'masteradmin@hackerbay.io';
const password = '1234567890';

describe('Enterprise License API', () => {
    const operationTimeOut = init.timeout;

    beforeAll(async done => {
        jest.setTimeout(init.timeout);

        const cluster = await Cluster.launch({
            concurrency: Cluster.CONCURRENCY_PAGE,
            puppeteerOptions: utils.puppeteerLaunchConfig,
            puppeteer,
            timeout: 120000,
        });

        cluster.on('taskerror', err => {
            throw err;
        });

        // Register user
        await cluster.task(async ({ page, data }) => {
            const user = {
                email: data.userEmail,
                password: data.password,
            };
            // user
            await init.registerEnterpriseUser(user, page, false);
        });

        await cluster.queue({ email, password, userEmail });

        await cluster.idle();
        await cluster.close();
        done();
    });

    afterAll(async done => {
        done();
    });

    test(
        'Should not confirm expired license',
        async done => {
            expect.assertions(1);

            const cluster = await Cluster.launch({
                concurrency: Cluster.CONCURRENCY_PAGE,
                puppeteerOptions: utils.puppeteerLaunchConfig,
                puppeteer,
                timeout: 100000,
            });

            cluster.on('taskerror', err => {
                throw err;
            });

            await cluster.task(async ({ page, data }) => {
                const user = {
                    email: data.email,
                    password: data.password,
                };

                await init.loginUser(user, page);

                await page.waitForSelector('#settings');
                await init.pageClick(page, '#settings');

                await page.waitForSelector('#license');
                await init.pageClick(page, 'input[name=license]');
                await init.pageType(page, 'input[name=license]', 'expired-license');
                await init.pageClick(page, 'input[name=email]');
                await init.pageType(page, 
                    'input[name=email]',
                    utils.generateRandomBusinessEmail()
                );
                await init.pageClick(page, 'button[type=submit]');
                

                const expiredError = await page.$eval('#licenseError', e => {
                    return e.innerHTML;
                });

                expect(expiredError).toEqual('License Expired');
            });

            cluster.queue({ email, password });
            await cluster.idle();
            await cluster.close();
            done();
        },
        operationTimeOut
    );
});
