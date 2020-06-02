const puppeteer = require('puppeteer');
const { Cluster } = require('puppeteer-cluster');
const utils = require('./test-utils');
const init = require('./test-init');

require('should');

let browser;
let page;

const email = utils.generateRandomBusinessEmail();
const password = '1234567890';
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
        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/61.0.3163.100 Safari/537.36'
        );
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
            await init.registerEnterpriseUser(user, page);
        });
        cluster.queue();
        await cluster.idle();
        await cluster.close();
    });

    afterAll(async () => {
        await browser.close();
    });

    it('Users cannot login with incorrect credentials', async () => {
        try {
            await page.goto(utils.ACCOUNTS_URL + '/login', {
                waitUntil: 'networkidle2',
            });
        } catch (e) {
            //
        }
        await page.waitForSelector('#login-button');
        await page.click('input[name=email]');
        await page.type('input[name=email]', user.email);
        await page.click('input[name=password]');
        await page.type('input[name=password]', user.password);
        await page.click('button[type=submit]');
        await page.waitFor(10000);
        const html = await page.$eval('#main-body', e => {
            return e.innerHTML;
        });
        html.should.containEql('User does not exist.');
    }, 160000);

    it('Should login valid User', async () => {
        await init.registerUser(user, page);
        await init.loginUser(user, page);

        await page.waitFor(10000);

        const localStorageData = await page.evaluate(() => {
            const json = {};
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                json[key] = localStorage.getItem(key);
            }
            return json;
        });

        await page.waitFor(10000);
        localStorageData.should.have.property('access_token');
        localStorageData.should.have.property('email', email);
        page.url().should.containEql(utils.DASHBOARD_URL);
    }, 300000);
});

describe('SSO login', () => {
    beforeAll(async () => {
        jest.setTimeout(20000);
        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/61.0.3163.100 Safari/537.36'
        );
    });

    afterAll(async () => {
        await browser.close();
    });

    it('Should return an error message if the domain is not defined in the database.', async () => {
        await page.goto(utils.ACCOUNTS_URL + '/login', {
            waitUntil: 'networkidle2',
        });
        await page.waitForSelector('#login-button');
        await page.click('#sso-login');
        await page.click('input[name=email]');
        await page.type('input[name=email]', 'email@inexistent-domain.hackerbay.io');
        await page.click('button[type=submit]');
        await page.waitForResponse(response =>
            response.url().includes('/login')
        );
        const html = await page.$eval('#main-body', e => e.innerHTML);
        html.should.containEql('Domain not found.');
    }, 30000);

    it('Should return an error message if the SSO authentication is disabled for the email\'s domain.', async () => {
        await page.goto(utils.ACCOUNTS_URL + '/login', {
            waitUntil: 'networkidle2',
        });
        await page.waitForSelector('#login-button');
        await page.click('#sso-login');
        await page.click('input[name=email]');
        await page.type('input[name=email]', 'email@disabled-domain.hackerbay.io');
        await page.click('button[type=submit]');
        await page.waitForResponse(response =>
            response.url().includes('/login')
        );
        const html = await page.$eval('#main-body', e => e.innerHTML);
        html.should.containEql('SSO disabled for this domain.');
    }, 30000);

    it('Should redirects the user if the domain is defined in the database.', async () => {
        await page.goto(utils.ACCOUNTS_URL + '/login', {
            waitUntil: 'networkidle2',
        });
        await page.waitForSelector('#login-button');
        await page.click('#sso-login');
        await page.click('input[name=email]');
        await page.type('input[name=email]', 'email@hackerbay.io');

        const [response] = await Promise.all([
            page.waitForNavigation('networkidle2'),
            page.click('button[type=submit]'),
        ]);
        const chain = response.request().redirectChain();
        expect(chain.length).not.toBe(0);
    }, 30000);
});
