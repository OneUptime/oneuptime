const puppeteer = require('puppeteer');
var should = require('should');
var utils = require('./test-utils');

var browser, page, userCredentials;

describe('Login API', () => {

    beforeAll(async () => {
        jest.setTimeout(15000);
        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/61.0.3163.100 Safari/537.36');
        // intercept request and mock response for login
        await page.setRequestInterception(true);
        await page.on('request', async (request) => {
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
        await page.on('response', async (response) => {
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

    it('Should login valid User', async () => {
        await page.goto(utils.ACCOUNTS_URL + '/register', { waitUntil: 'networkidle2' });
        await page.waitForSelector('#email');
        await page.click('input[name=email]');
        await page.type('input[name=email]', utils.user.email);
        await page.click('input[name=name]');
        await page.type('input[name=name]', utils.user.name);
        await page.click('input[name=companyName]');
        await page.type('input[name=companyName]', utils.user.company.name);
        await page.click('input[name=companyPhoneNumber]');
        await page.type('input[name=companyPhoneNumber]', utils.user.phone);
        await page.click('input[name=password]');
        await page.type('input[name=password]', utils.user.password);
        await page.click('input[name=confirmPassword]');
        await page.type('input[name=confirmPassword]', utils.user.password);
        await page.click('button[type=submit]');
        await page.waitFor(10000);
        await page.waitForSelector('#cardName');
        await page.click('input[name=cardName]');
        await page.type('input[name=cardName]', utils.user.name);
        await page.click('input[name=cardNumber]');
        await page.type('input[name=cardNumber]', utils.user.card);
        await page.click('input[name=cvc]');
        await page.type('input[name=cvc]', utils.user.cvv);
        await page.click('input[name=expiry]');
        await page.type('input[name=expiry]', utils.user.expiryDate);
        await page.click('input[name=address1]');
        await page.type('input[name=address1]', utils.user.address.streetA);
        await page.click('input[name=address2]');
        await page.type('input[name=address2]', utils.user.address.streetB);
        await page.click('input[name=city]');
        await page.type('input[name=city]', utils.user.address.city);
        await page.click('input[name=state]');
        await page.type('input[name=state]', utils.user.address.state);
        await page.click('input[name=zipCode]');
        await page.type('input[name=zipCode]', utils.user.address.zipcode);
        await page.select('#country', 'India');
        await page.click('button[type=submit]');
        await page.waitFor(15000);
        await page.goto(utils.ACCOUNTS_URL + '/login');
        await page.waitForSelector('#login-button');
        await page.click('input[name=email]');
        await page.type('input[name=email]', utils.user.email);
        await page.click('input[name=password]');
        await page.type('input[name=password]', utils.user.password);
        await page.click('button[type=submit]');
        await page.waitFor(10000);
        var localStorageData = await page.evaluate(() => {
            var json = {};
            for (var i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                json[key] = localStorage.getItem(key);
            }
            return json;
        });
        localStorageData.should.have.property('sessionID');
        localStorageData.should.have.property('access_token');
        localStorageData.should.have.property('email', utils.user.email);
        page.url().should.containEql(utils.DASHBOARD_URL);
    }, 160000);
})