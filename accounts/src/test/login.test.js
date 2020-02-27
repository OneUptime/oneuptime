const puppeteer = require('puppeteer');
const utils = require('./test-utils');
const init = require('./test-init');

let browser;
let page;

const email = utils.generateRandomBusinessEmail();
const password = '1234567890';
const user = {
    email,
    password,
};

describe('Login API', () => {
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

    it('Users cannot login with incorrect credentials', async () => {
        await page.goto(utils.ACCOUNTS_URL + '/login', {
            waitUntil: 'networkidle2',
        });
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
    }, 160000);
});
