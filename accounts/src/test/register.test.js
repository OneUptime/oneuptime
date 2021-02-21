const puppeteer = require('puppeteer');
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

describe('Registration API', () => {
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

    it('User cannot register with invalid email', async () => {
        const invalidEmail = 'invalidEmail';
        await page.goto(utils.ACCOUNTS_URL + '/register', {
            waitUntil: 'networkidle2',
        });
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

        await page.waitForSelector('#email_error');
        const errorMsg = await page.$eval(
            '#email_error',
            elem => elem.textContent
        );
        expect(errorMsg).toEqual('Email is not valid.');
    }, 160000);

    it('User cannot register with personal email', async () => {
        const personalEmail = 'personalEmail@gmail.com';
        await page.goto(utils.ACCOUNTS_URL + '/register', {
            waitUntil: 'networkidle2',
        });
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

        await page.waitForSelector('#email_error');
        const errorMsg = await page.$eval(
            '#email_error',
            elem => elem.textContent
        );
        expect(errorMsg).toEqual('Please enter a business email address.');
    }, 160000);

    test('Registration form fields should be cleaned if the user moves to the login form and returns back.', async () => {
        await page.goto(utils.ACCOUNTS_URL + '/register', {
            waitUntil: 'networkidle2',
        });
        await page.waitForSelector('#email');
        await page.click('input[name=email]');
        await page.type('input[name=email]', user.email);
        await page.click('input[name=name]');
        await page.type('input[name=name]', utils.user.name);
        await page.click('input[name=companyName]');
        await page.type('input[name=companyName]', utils.user.company.name);
        await page.click('input[name=companyPhoneNumber]');
        await page.type('input[name=companyPhoneNumber]', '1234567890');
        await page.click('input[name=password]');
        await page.type('input[name=password]', '1234567890');
        await page.click('input[name=confirmPassword]');
        await page.type('input[name=confirmPassword]', '1234567890');

        await page.click('#loginLink a');
        await page.waitForSelector('#signUpLink a');
        await page.click('#signUpLink a');

        await page.waitForSelector('input[name=email]');
        const email = await page.$eval(
            'input[name=email]',
            element => element.value
        );
        expect(email).toEqual('');
    }, 160000);

    test('Registration form fields should be cleaned if the user moves from card form to the login form and returns back.', async () => {
        await page.goto(utils.ACCOUNTS_URL + '/register', {
            waitUntil: 'networkidle2',
        });
        await page.waitForSelector('#email');
        await page.click('input[name=email]');
        await page.type('input[name=email]', user.email);
        await page.click('input[name=name]');
        await page.type('input[name=name]', utils.user.name);
        await page.click('input[name=companyName]');
        await page.type('input[name=companyName]', utils.user.company.name);
        await page.click('input[name=companyPhoneNumber]');
        await page.type('input[name=companyPhoneNumber]', '1234567890');
        await page.click('input[name=password]');
        await page.type('input[name=password]', '1234567890');
        await page.click('input[name=confirmPassword]');
        await page.type('input[name=confirmPassword]', '1234567890');
        await page.click('button[type=submit]');

        await page.waitForSelector('input[name=cardName]');
        await page.click('input[name=cardName]');
        await page.type('input[name=cardName]', 'Test name');

        await page.click('#loginLink a');
        await page.waitForSelector('#signUpLink a');
        await page.click('#signUpLink a');

        await page.waitForSelector('input[name=email]');
        const email = await page.$eval(
            'input[name=email]',
            element => element.value
        );
        expect(email).toEqual('');
    }, 160000);

    it('Should register User with valid details', async () => {
        await init.registerUser(user, page);
        await page.waitForSelector('form#login-form');
        await page.waitForSelector('#login-button');
        const innerText = await page.$eval(
            '#login-button',
            elem => elem.innerText
        );
        expect(innerText).toEqual('Sign in');
    }, 160000);
});
