const puppeteer = require('puppeteer');
const utils = require('./test-utils');
const init = require('./test-init');
const { Cluster } = require('puppeteer-cluster');

require('should');

// user credentials
const email = 'masteradmin@hackerbay.io';
const password = '1234567890';

const moveToSsoPage = async (page) => {
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
            expect.assertions(3);
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

                await moveToSsoPage(page);

                const ssoCount = await page.$eval('#sso-count', e => {
                    return e.innerHTML;
                });

                expect(ssoCount).toContain('0');

                await page.waitForSelector("#no-sso-message");

                await createSso(page, {
                    domain: 'test.hackerbay.io',
                    samlSsoUrl: 'test.hackerbay.io/login',
                    certificateFingerprint: 'AZERTYUIOP',
                    remoteLogoutUrl: 'test.hackerbay.io/logout',
                    ipRanges: '127.0.0.1',
                })

                const ssoCountAfterCreation = await page.$eval('#sso-count', e => {
                    return e.innerHTML;
                });

                expect(ssoCountAfterCreation).toContain('1');

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
            expect.assertions(2);
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

                await moveToSsoPage(page);

                const ssoCount = await page.$eval('#sso-count', e => {
                    return e.innerHTML;
                });

                expect(ssoCount).toContain('1');

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
            expect.assertions(2);
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

                const ssoCount = await page.$eval('#sso-count', e => {
                    return e.innerHTML;
                });

                expect(ssoCount).toContain('1');

                await page.waitForSelector('.delete-button');
                await page.click('.delete-button');

                await page.waitForSelector('#confirmDelete');
                await page.click('#confirmDelete');

                await page.waitFor(2000);

                const ssoCountAfterDeletion = await page.$eval('#sso-count', e => {
                    return e.innerHTML;
                });
                expect(ssoCountAfterDeletion).toContain('0');

                await page.waitForSelector("#no-sso-message");
            });

            cluster.queue({ email, password, });

            await cluster.idle();
            await cluster.close();
            done();
        },
        operationTimeOut
    );

    it('should enable Next/Previous buttons when there are more than 10 SSOs',
        async (done) => {
            expect.assertions(7);
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

                await moveToSsoPage(page);
                await page.waitForSelector("#no-sso-message");

                for (let i = 0; i <= 11; i++) {
                    await createSso(page, {
                        domain: `subdomain.${i}.test.hackerbay.io`,
                        samlSsoUrl: 'test.hackerbay.io/login',
                        certificateFingerprint: 'AZERTYUIOP',
                        remoteLogoutUrl: 'test.hackerbay.io/logout',
                        ipRanges: '127.0.0.1',
                    })
                }

                const ssoCount = await page.$eval('#sso-count', e => {
                    return e.innerHTML;
                });

                expect(ssoCount).toContain('12');
                
                const firstPageTbody = await page.$eval('tbody', e => {
                    return e.innerHTML;
                });
                expect(firstPageTbody).toContain('subdomain.11.test.hackerbay.io');
                expect(firstPageTbody).toContain('subdomain.2.test.hackerbay.io');

                await page.click('#next-button');
                await page.waitFor(2000);

                const secondPageTbody = await page.$eval('tbody', e => {
                    return e.innerHTML;
                });
                expect(secondPageTbody).toContain('subdomain.1.test.hackerbay.io');
                expect(secondPageTbody).toContain('subdomain.0.test.hackerbay.io');


                await page.click('#previous-button');
                await page.waitFor(2000);

                const initalPageTbody = await page.$eval('tbody', e => {
                    return e.innerHTML;
                });

                expect(initalPageTbody).toContain('subdomain.11.test.hackerbay.io');
                expect(initalPageTbody).toContain('subdomain.2.test.hackerbay.io');

            })

            cluster.queue({ email, password });
            await cluster.idle();
            await cluster.close();
            done();
        },
        operationTimeOut
    );
});
