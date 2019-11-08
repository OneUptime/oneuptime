const puppeteer = require('puppeteer');
var should = require('should');
var utils = require('./test-utils');
var init = require('./test-init');

let browser;
let page, userCredentials;

let email = utils.generateRandomBusinessEmail();
let password = utils.generateRandomString();
const user = {
    email,
    password
};

describe('Registration API', () => {
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

    it('User cannot register with invalid email', async () => {
        const invalidEmail = 'invalidEmail';
        await page.goto(utils.ACCOUNTS_URL + '/register', { waitUntil: 'networkidle2' });
        await page.waitForSelector('#email');
        await page.click('input[name=email]');
        await page.type('input[name=email]', invalidEmail);
        await page.click('input[name=name]');
        await page.type('input[name=name]', utils.user.name);
        await page.click('input[name=companyName]');
        await page.type('input[name=companyName]', utils.user.company.name);
        await page.click('input[name=companyPhoneNumber]');
        await page.type('input[name=companyPhoneNumber]', utils.user.phone);
        await page.click('input[name=password]');
        await page.type('input[name=password]', user.password);
        await page.click('input[name=confirmPassword]');
        await page.type('input[name=confirmPassword]', user.password);
        await page.click('button[type=submit]');
        await page.waitFor(1000);

        const html = await page.$eval('#email', (e) => {
            return e.innerHTML
        });
        html.should.containEql('Email is not valid.')
    }, 160000);

    it('User cannot register with personal email', async () => {
        const personalEmail = 'personalEmail@gmail.com'
        await page.goto(utils.ACCOUNTS_URL + '/register', { waitUntil: 'networkidle2' });
        await page.waitForSelector('#email');
        await page.click('input[name=email]');
        await page.type('input[name=email]', personalEmail);
        await page.click('input[name=name]');
        await page.type('input[name=name]', utils.user.name);
        await page.click('input[name=companyName]');
        await page.type('input[name=companyName]', utils.user.company.name);
        await page.click('input[name=companyPhoneNumber]');
        await page.type('input[name=companyPhoneNumber]', utils.user.phone);
        await page.click('input[name=password]');
        await page.type('input[name=password]', user.password);
        await page.click('input[name=confirmPassword]');
        await page.type('input[name=confirmPassword]', user.password);
        await page.click('button[type=submit]');
        await page.waitFor(1000);
        const html = await page.$eval('#email', (e) => {
            return e.innerHTML
        });
        html.should.containEql('Please enter a business email address.')
    }, 16000);

    it('Should register User with valid details', async () => {
        await init.registerUser(user, page);
        await page.waitFor(15000);
        const html = await page.$eval('#main-body', (e) => {
            return e.innerHTML;
        });
        html.should.containEql('Activate your Fyipe account');
    }, 160000);
});