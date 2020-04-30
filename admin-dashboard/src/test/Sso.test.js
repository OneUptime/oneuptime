const puppeteer = require('puppeteer');
const utils = require('./test-utils');
const init = require('./test-init');
const { Cluster } = require('puppeteer-cluster');

require('should');

// user credentials
const email = 'masteradmin@hackerbay.io';
const password = '1234567890';

const moveToSsoPage= async (page)=>{
    await page.waitForSelector('#settings');
    await page.click('#settings');
    await page.waitForSelector('#sso');
    await page.click('#sso');
}

const createSso = async (page, data) => {
    await page.click('#add-sso');
    await page.waitForSelector('#save-button');

    await page.click('#domain');
    await page.type('#domain', data.domain);

    await page.click('#samlSsoUrl');
    await page.type('#samlSsoUrl', data.samlSsoUrl);

    await page.click('#certificateFingerprint');
    await page.type('#certificateFingerprint', data.certificateFingerprint);

    await page.click('#remoteLogoutUrl');
    await page.type('#remoteLogoutUrl', data.remoteLogoutUrl);

    await page.click('#ipRanges');
    await page.type('#ipRanges', data.ipRanges);

    await page.click('#save-button');
    await page.waitFor(2000);

}

describe('SSO API', () => {
    const operationTimeOut = 100000;

    beforeAll(async done => {
        jest.setTimeout(200000);

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
        cluster.task(async ({ page, data }) => {
            const user = {
                email: data.email,
                password: data.password,
            };

            await init.registerEnterpriseUser(user, page);
        });

        cluster.queue({ email, password });

        await cluster.idle();
        await cluster.close();
        done();
    });

    test('should add new SSO',
        async (done) => {
            expect.assertions(1);
            const cluster = await Cluster.launch({
                concurrency: Cluster.CONCURRENCY_PAGE,
                puppeteerOptions: utils.puppeteerLaunchConfig,
                puppeteer,
                timeout: 120000,
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
                
                await moveToSsoPage(page)

                await page.waitForSelector("#no-sso-message");

                await createSso(page, {
                    domain: 'test.hackerbay.io',
                    samlSsoUrl: 'test.hackerbay.io/login',
                    certificateFingerprint: 'AZERTYUIOP',
                    remoteLogoutUrl: 'test.hackerbay.io/logout',
                    ipRanges: '127.0.0.1',
                })

                const tbody = await page.$eval('tbody', e => {
                    return e.innerHTML;
                });
                expect(tbody).toContain('test.hackerbay.io');
            });

            cluster.queue({ email, password, });

            await cluster.idle();
            await cluster.close();
            done();
        },
        operationTimeOut
    );

    test('should update existing SSO',
        async (done) => {
            expect.assertions(1);
            const cluster = await Cluster.launch({
                concurrency: Cluster.CONCURRENCY_PAGE,
                puppeteerOptions: utils.puppeteerLaunchConfig,
                puppeteer,
                timeout: 120000,
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

                await moveToSsoPage(page)

                await page.waitForSelector('.edit-button');
                await page.click('.edit-button');

                await page.waitForSelector('#save-button');
                await page.click('#domain');
                await page.keyboard.down('Control');
                await page.keyboard.press('A');
                await page.keyboard.up('Control');
                await page.keyboard.press('Backspace');
                await page.type('#domain', 'updated.test.hackerbay.io');
                await page.click('#save-button');

                await page.waitFor(2000);

                const tbody = await page.$eval('tbody', e => {
                    return e.innerHTML;
                });
                expect(tbody).toContain('updated.test.hackerbay.io');
            });

            cluster.queue({ email, password, });

            await cluster.idle();
            await cluster.close();
            done();
        },
        operationTimeOut
    );

    test('should delete existing SSO',
        async (done) => {
            expect.assertions(0);
            const cluster = await Cluster.launch({
                concurrency: Cluster.CONCURRENCY_PAGE,
                puppeteerOptions: utils.puppeteerLaunchConfig,
                puppeteer,
                timeout: 120000,
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

                await moveToSsoPage(page)

                await page.waitForSelector('.delete-button');
                await page.click('.delete-button');

                await page.waitForSelector('#confirmDelete');
                await page.click('#confirmDelete');

                await page.waitFor(2000);

                await page.waitForSelector("#no-sso-message");
            });

            cluster.queue({ email, password, });

            await cluster.idle();
            await cluster.close();
            done();
        },
        operationTimeOut
    );
});
