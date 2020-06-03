const puppeteer = require('puppeteer');
const { Cluster } = require('puppeteer-cluster');
const utils = require('./test-utils');
const init = require('./test-init');

require('should');

const operationTimeOut = 100000;
const email = 'masteradmin@hackerbay.io';
const password = '1234567890';
const inexistentEmail = 'inexistent@hackerbay.io';
const user = {
    email,
    password,
};

const moveToSsoPage = async page => {
    await page.waitForSelector('#settings');
    await page.click('#settings');
    await page.waitForSelector('#sso');
    await page.click('#sso');
};

const createSso = async (page, data) => {
    await page.click('#add-sso');
    await page.waitForSelector('#save-button');

    if (data['saml-enabled']) await page.click('#saml-enabled-slider');

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
};

describe('Login API', () => {
    beforeAll(async () => {
        jest.setTimeout(20000);
        //create user in an isolcated session
        const cluster = await Cluster.launch({
            concurrency: Cluster.CONCURRENCY_PAGE,
            puppeteerOptions: utils.puppeteerLaunchConfig,
            puppeteer,
            timeout: 120000,
        });

        cluster.on('taskerror', err => {
            throw err;
        });
        cluster.task(async ({ page }) => {
            await init.registerUser(user, page);
        });
        cluster.queue();
        await cluster.idle();
        await cluster.close();
    });

    it(
        'Users cannot login with incorrect credentials',
        async done => {
            const cluster = await Cluster.launch({
                concurrency: Cluster.CONCURRENCY_PAGE,
                puppeteerOptions: utils.puppeteerLaunchConfig,
                puppeteer,
                timeout: 120000,
            });

            cluster.on('taskerror', err => {
                throw err;
            });

            cluster.task(async ({ page }) => {
                await page.goto(utils.ACCOUNTS_URL + '/accounts/login', {
                    waitUntil: 'networkidle2',
                });
                await page.waitForSelector('#login-button');
                await page.click('input[name=email]');
                await page.type('input[name=email]', inexistentEmail);
                await page.click('input[name=password]');
                await page.type('input[name=password]', user.password);
                await page.click('button[type=submit]'),
                    await page.waitForResponse(response =>
                        response.url().includes('/login')
                    );
                await page.waitFor(2000);
                const html = await page.$eval('#main-body', e => {
                    return e.innerHTML;
                });
                html.should.containEql('User does not exist.');
            });

            cluster.queue();
            await cluster.idle();
            await cluster.close();
            done();
        },
        operationTimeOut
    );

    it(
        'Should login valid User',
        async done => {
            const cluster = await Cluster.launch({
                concurrency: Cluster.CONCURRENCY_PAGE,
                puppeteerOptions: utils.puppeteerLaunchConfig,
                puppeteer,
                timeout: 120000,
            });

            cluster.on('taskerror', err => {
                throw err;
            });

            cluster.task(async ({ page }) => {
                await init.loginUser(user, page);
                await page.waitFor(2000);

                const localStorageData = await page.evaluate(() => {
                    const json = {};
                    for (let i = 0; i < localStorage.length; i++) {
                        const key = localStorage.key(i);
                        json[key] = localStorage.getItem(key);
                    }
                    return json;
                });

                await page.waitFor(2000);
                localStorageData.should.have.property('access_token');
                localStorageData.should.have.property('email', email);
                page.url().should.containEql(utils.ADMIN_DASHBOARD_URL);
            });

            cluster.queue();
            await cluster.idle();
            await cluster.close();
            done();
        },
        operationTimeOut
    );
});

describe('SSO login', () => {
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

        cluster.task(async ({ page }) => {
            const user = { email, password };
            await init.loginUser(user, page);
            await page.waitFor(2000);
            await moveToSsoPage(page);
            await page.waitFor(2000);
            await createSso(page, {
                'saml-enabled': false,
                domain: `disabled-domain.hackerbay.io`,
                samlSsoUrl:
                    'http://localhost:8080/simplesaml/saml2/idp/SSOService.php',
                certificateFingerprint: 'AZERTYUIOP',
                remoteLogoutUrl: 'http://localhost:8080/logout',
                ipRanges: '127.0.0.1',
            });
            await createSso(page, {
                'saml-enabled': true,
                domain: `tests.hackerbay.io`,
                samlSsoUrl:
                    'http://localhost:8080/simplesaml/saml2/idp/SSOService.php',
                certificateFingerprint: 'AZERTYUIOP',
                remoteLogoutUrl: 'http://localhost:8080/logout',
                ipRanges: '127.0.0.1',
            });
        });
        cluster.queue();
        await cluster.idle();
        await cluster.close();
        done();
    });

    it(
        'Should return an error message if the domain is not defined in the database.',
        async done => {
            const cluster = await Cluster.launch({
                concurrency: Cluster.CONCURRENCY_PAGE,
                puppeteerOptions: utils.puppeteerLaunchConfig,
                puppeteer,
                timeout: 120000,
            });

            cluster.on('taskerror', err => {
                throw err;
            });

            cluster.task(async ({ page }) => {
                await page.goto(utils.ACCOUNTS_URL + '/login', {
                    waitUntil: 'networkidle2',
                });
                await page.waitForSelector('#login-button');
                await page.click('#sso-login');
                await page.click('input[name=email]');
                await page.type(
                    'input[name=email]',
                    'email@inexistent-domain.hackerbay.io'
                );
                await page.click('button[type=submit]');
                await page.waitForResponse(response =>
                    response.url().includes('/login')
                );
                const html = await page.$eval('#main-body', e => e.innerHTML);
                html.should.containEql('Domain not found.');
            });
            cluster.queue();
            await cluster.idle();
            await cluster.close();
            done();
        },
        operationTimeOut
    );

    it(
        "Should return an error message if the SSO authentication is disabled for the email's domain.",
        async done => {
            const cluster = await Cluster.launch({
                concurrency: Cluster.CONCURRENCY_PAGE,
                puppeteerOptions: utils.puppeteerLaunchConfig,
                puppeteer,
                timeout: 120000,
            });
            cluster.on('taskerror', err => {
                throw err;
            });
            cluster.task(async ({ page }) => {
                await page.goto(utils.ACCOUNTS_URL + '/login', {
                    waitUntil: 'networkidle2',
                });
                await page.waitForSelector('#login-button');
                await page.click('#sso-login');
                await page.click('input[name=email]');
                await page.type(
                    'input[name=email]',
                    'email@disabled-domain.hackerbay.io'
                );
                await page.click('button[type=submit]');
                await page.waitForResponse(response =>
                    response.url().includes('/login')
                );
                const html = await page.$eval('#main-body', e => e.innerHTML);
                html.should.containEql('SSO disabled for this domain.');
            });
            cluster.queue();
            await cluster.idle();
            await cluster.close();
            done();
        },
        operationTimeOut
    );

    it(
        'Should redirects the user if the domain is defined in the database.',
        async done => {
            const cluster = await Cluster.launch({
                concurrency: Cluster.CONCURRENCY_PAGE,
                puppeteerOptions: utils.puppeteerLaunchConfig,
                puppeteer,
                timeout: 120000,
            });
            cluster.on('taskerror', err => {
                throw err;
            });
            cluster.task(async ({ page, data }) => {
                const { username, password } = data;
                await page.goto(utils.ACCOUNTS_URL + '/login', {
                    waitUntil: 'networkidle2',
                });
                await page.waitForSelector('#login-button');
                await page.click('#sso-login');
                await page.click('input[name=email]');
                await page.type(
                    'input[name=email]',
                    'email@tests.hackerbay.io'
                );
                const [response] = await Promise.all([
                    page.waitForNavigation('networkidle2'),
                    page.click('button[type=submit]'),
                ]);
                const chain = response.request().redirectChain();
                expect(chain.length).not.toBe(0);

                await page.click('#username');
                await page.type('#username', username);

                await page.click('#password');
                await page.type('#password', password);
                await page.click('button');

                await page.waitForNavigation('networkidle2');

                await page.waitForSelector('#createButton');
            });
            cluster.queue({
                username: 'user1',
                password: 'user1pass',
            });
            await cluster.idle();
            await cluster.close();
            done();
        },
        operationTimeOut
    );
});
