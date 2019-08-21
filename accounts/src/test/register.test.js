const puppeteer = require('puppeteer');
var should = require('should');
var utils = require('./test-utils');

let browser;
let page;
var password = utils.generatePassword();
var email = utils.generateRandomBusinessEmail();

describe('Registration API', () => {

    beforeAll(async () => {
        jest.setTimeout(20000);
        browser = await puppeteer.launch({ headless: utils.headlessMode });
        page = await browser.newPage();
    });

    afterAll(async () => {
        await browser.close();
    });

    it('User cannot register with invalid email', async () => {
        await page.goto(utils.ACCOUNTS_URL + '/register', { waitUntil: 'networkidle2' });
        await page.waitForSelector('#email');
        await page.click('input[name=email]');
        await page.type('input[name=email]', utils.user.username);
        await page.click('input[name=name]');
        await page.type('input[name=name]', utils.user.name);
        await page.click('input[name=companyName]');
        await page.type('input[name=companyName]', utils.user.company.name);
        await page.click('input[name=companyPhoneNumber]');
        await page.type('input[name=companyPhoneNumber]', utils.user.phone);
        await page.click('input[name=password]');
        await page.type('input[name=password]', password);
        await page.click('input[name=confirmPassword]');
        await page.type('input[name=confirmPassword]', password);
        await page.click('button[type=submit]');
        const html = await page.$eval('#ema', (e) => {
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
        await page.type('input[name=password]', password);
        await page.click('input[name=confirmPassword]');
        await page.type('input[name=confirmPassword]', password);
        await page.click('button[type=submit]');
        await page.waitFor(1000);
        const html = await page.$eval('#ema', (e) => {
            return e.innerHTML
        });
        html.should.containEql('Please enter a business email address.')
    }, 16000);

    it('Should register User with valid details', async () => {
        await page.goto(utils.ACCOUNTS_URL + '/register', { waitUntil: 'networkidle2' });
        await page.waitForSelector('#email');
        await page.click('input[name=email]');
        await page.type('input[name=email]', email);
        await page.click('input[name=name]');
        await page.type('input[name=name]', utils.user.name);
        await page.click('input[name=companyName]');
        await page.type('input[name=companyName]', utils.user.company.name);
        await page.click('input[name=companyPhoneNumber]');
        await page.type('input[name=companyPhoneNumber]', utils.user.phone);
        await page.click('input[name=password]');
        await page.type('input[name=password]', password);
        await page.click('input[name=confirmPassword]');
        await page.type('input[name=confirmPassword]', password);
        await page.click('button[type=submit]');
        await page.waitFor(10000);
        await page.waitForSelector('#cardName');
        await page.click('input[name=cardName]');
        await page.type('input[name=cardName]', utils.user.name);
        await page.click('input[name=cardNumber]');
        await page.type('input[name=cardNumber]', utils.cardNumber);
        await page.click('input[name=cvc]');
        await page.type('input[name=cvc]', utils.cvv);
        await page.click('input[name=expiry]');
        await page.type('input[name=expiry]', utils.expiryDate);
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
        const html = await page.$eval('#main-body', (e) => {
            return e.innerHTML;
        });
        html.should.containEql('Activate your Fyipe account');
    }, 160000);

});