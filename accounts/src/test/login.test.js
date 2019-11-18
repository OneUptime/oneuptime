const puppeteer = require('puppeteer');
var should = require('should');
var utils = require('./test-utils');
var init = require('./test-init');

let browser;
let page1, userCredentials;

let email = utils.generateRandomBusinessEmail();
let password = utils.generateRandomString();
const user = {
    email,
    password
};

describe('Login API', () => {

    beforeAll(async () => {
        jest.setTimeout(15000);
        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page1 = await browser.newPage();
        page2 = await browser.newPage();
        await page1.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/61.0.3163.100 Safari/537.36');
        // intercept request and mock response for login
        await page2.setRequestInterception(true);
        await page2.on('request', async (request) => {
            if ((await request.url()).match(/user\/login/)) {
                request.respond({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify(userCredentials)
                });
            } else {
                request.continue();
            }
        });
        await page2.on('response', async (response) => {
            try {
                var res = await response.json();
                if (res && res.tokens) {
                    userCredentials = res;
                }
            } catch (error) { }
        });
    });

    afterAll(async () => {
        await browser.close();
    });

    it('Users cannot login with incorrect credentials', async () => {
        await page1.goto(utils.ACCOUNTS_URL + '/login', { waitUntil: 'networkidle2' });
        await page1.waitForSelector('#login-button');
        await page1.click('input[name=email]');
        await page1.type('input[name=email]', user.email);
        await page1.click('input[name=password]');
        await page1.type('input[name=password]', user.password);
        await page1.click('button[type=submit]');
        await page1.waitFor(10000);
        const html = await page1.$eval('#main-body', (e) => {
            return e.innerHTML;
        });
        html.should.containEql('User does not exist.');
    }, 160000);

    it('Should login valid User', async () => {
        await init.registerUser(user, page2);
        await init.loginUser(user, page2);

        var localStorageData = await page2.evaluate(() => {
            let json = {};
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                json[key] = localStorage.getItem(key);
            }
            return json;
        });
        
        await page2.waitFor(10000);
        localStorageData.should.have.property('sessionID');
        localStorageData.should.have.property('access_token');
        localStorageData.should.have.property('email', email);
        page2.url().should.containEql(utils.DASHBOARD_URL);
    }, 160000);
});