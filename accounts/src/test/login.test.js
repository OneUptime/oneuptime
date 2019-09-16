const puppeteer = require('puppeteer');
var should = require('should');
var utils = require('./test-utils');

let browser;
let page, userCredentials;

var email = utils.generateRandomBusinessEmail();
var password = utils.generatePassword();

describe('Login API', () => {

    beforeAll(async () => {
        jest.setTimeout(15000);
        browser = await puppeteer.launch({ headless: utils.headlessMode });
        page1 = await browser.newPage();
        page2 = await browser.newPage();
        await page1.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/61.0.3163.100 Safari/537.36');
        // intercept request and mock response for login
        await page1.setRequestInterception(true);
        await page1.on('request', async (request) => {
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
        await page1.on('response', async (response) => {
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
        await page1.goto(utils.ACCOUNTS_URL + '/register', { waitUntil: 'networkidle2' });
        await page1.waitForSelector('#email');
        await page1.click('input[name=email]');
        await page1.type('input[name=email]', email);
        await page1.click('input[name=name]');
        await page1.type('input[name=name]', utils.user.name);
        await page1.click('input[name=companyName]');
        await page1.type('input[name=companyName]', utils.user.company.name);
        await page1.click('input[name=companyPhoneNumber]');
        await page1.type('input[name=companyPhoneNumber]', utils.user.phone);
        await page1.click('input[name=password]');
        await page1.type('input[name=password]', password);
        await page1.click('input[name=confirmPassword]');
        await page1.type('input[name=confirmPassword]', password);
        await page1.click('button[type=submit]');
        await page1.waitFor(10000);
        await page1.waitForSelector('#cardName');
        await page1.click('input[name=cardName]');
        await page1.type('input[name=cardName]', utils.user.name);
        await page1.click('input[name=cardNumber]');
        await page1.type('input[name=cardNumber]', utils.cardNumber);
        await page1.click('input[name=cvc]');
        await page1.type('input[name=cvc]', utils.cvv);
        await page1.click('input[name=expiry]');
        await page1.type('input[name=expiry]', utils.expiryDate);
        await page1.click('input[name=address1]');
        await page1.type('input[name=address1]', utils.user.address.streetA);
        await page1.click('input[name=address2]');
        await page1.type('input[name=address2]', utils.user.address.streetB);
        await page1.click('input[name=city]');
        await page1.type('input[name=city]', utils.user.address.city);
        await page1.click('input[name=state]');
        await page1.type('input[name=state]', utils.user.address.state);
        await page1.click('input[name=zipCode]');
        await page1.type('input[name=zipCode]', utils.user.address.zipcode);
        await page1.select('#country', 'India');
        await page1.click('button[type=submit]');
        await page1.waitFor(15000);
        await page1.goto(utils.ACCOUNTS_URL + '/login');
        await page1.waitForSelector('#login-button');
        await page1.click('input[name=email]');
        await page1.type('input[name=email]', email);
        await page1.click('input[name=password]');
        await page1.type('input[name=password]', password);
        await page1.click('button[type=submit]');
        await page1.waitFor(10000);
        var localStorageData = await page1.evaluate(() => {
            let json = {};
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                json[key] = localStorage.getItem(key);
            }
            return json;
        });
        localStorageData.should.have.property('sessionID');
        localStorageData.should.have.property('access_token');
        localStorageData.should.have.property('email', email);
        page1.url().should.containEql(utils.DASHBOARD_URL);
    }, 160000);

    it('Users cannot login with incorrect credentials', async () => {
        await page2.goto(utils.ACCOUNTS_URL + '/login');
        await page2.waitForSelector('#login-button');
        await page2.click('input[name=email]');
        await page2.type('input[name=email]', utils.generateWrongEmail());
        await page2.click('input[name=password]');
        await page2.type('input[name=password]', utils.generatePassword());
        await page2.click('button[type=submit]');
        await page2.waitFor(10000);
        const html = await page2.$eval('#main-body', (e) => {
            return e.innerHTML;
        });
        html.should.containEql('User does not exist.');
    }, 160000);

});