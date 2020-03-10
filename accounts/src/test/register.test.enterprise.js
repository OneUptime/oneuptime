const puppeteer = require('puppeteer');
const should = require('should');
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

describe('Enterprise Registration API', () => {
    beforeAll(async () => {
        jest.setTimeout(15000);
        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/61.0.3163.100 Safari/537.36'
        );
    });

    afterAll(async () => {
        await browser.close();
    });

    it('Should register Initial User with valid details', async () => {
        await init.registerEnterpriseUser(user, page);

        await page.waitFor(5000);
        const html = await page.$eval('#main-body', e => {
            return e.innerHTML;
        });
        html.should.containEql('Activate your Fyipe account');
    }, 160000);

    it('Should redirect to Login Page and hide Sign Up Link for Subsequent Users', async () => {
        await page.goto(utils.ACCOUNTS_URL + '/register', {
            waitUntil: 'networkidle2',
        });
        await page.waitFor(5000);
        page.url().should.containEql(utils.ACCOUNTS_URL + '/login');

        const signUp = await page.$('#signUpLink');
        should.not.exist(signUp);
    }, 160000);

    it('Should login Initial User to Admin Dashboard', async () => {
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
        page.url().should.containEql(utils.ADMIN_DASHBOARD_URL);
    }, 160000);
});
