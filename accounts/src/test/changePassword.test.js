const puppeteer = require('puppeteer');
const should = require('should');
const utils = require('./test-utils');

let browser;
let page;

const email = utils.generateRandomBusinessEmail();
const password = utils.generateRandomString();
const user = {
    email,
    password,
};

describe('Change Password API', () => {
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

    it('Should not allow change of password if password and confirm password do not math', async () => {
        await page.goto(
            utils.ACCOUNTS_URL + '/change-password/thisisaWrongRestToken',
            { waitUntil: 'networkidle2' }
        );
        await page.waitForSelector('#password');
        await page.click('input[name=password]');
        await page.type('input[name=password]', user.password);
        await page.waitForSelector('#confirmPassword');
        await page.click('input[name=confirmPassword]');
        await page.type('input[name=confirmPassword]', 'unmatchingPassword');
        await page.click('button[type=submit]');
        await page.waitForSelector(
            '#confirmPasswordField > span > span:nth-child(2)'
        );
        const html = await page.$eval(
            '#confirmPasswordField > span > span:nth-child(2)',
            e => {
                return e.innerHTML;
            }
        );
        should.exist(html);
        html.should.containEql('Password and confirm password should match.');
    }, 160000);

    it('Should submit if password is less than 8 characters', async () => {
        await page.goto(
            utils.ACCOUNTS_URL + '/change-password/thisisaWrongRestToken',
            { waitUntil: 'networkidle2' }
        );
        await page.waitForSelector('#password');
        await page.click('input[name=password]');
        await page.type('input[name=password]', '123456');
        await page.waitForSelector('#confirmPassword');
        await page.click('input[name=confirmPassword]');
        await page.type('input[name=confirmPassword]', '123456');
        await page.click('button[type=submit]');
        await page.waitForSelector('#passwordField > span > span:nth-child(1)');
        const html = await page.$eval(
            '#passwordField > span > span:nth-child(2)',
            e => {
                return e.innerHTML;
            }
        );
        should.exist(html);
        html.should.containEql('Password should be atleast 8 characters long');
    }, 160000);

    it('Should submit if password is missing', async () => {
        await page.goto(
            utils.ACCOUNTS_URL + '/change-password/thisisaWrongRestToken',
            { waitUntil: 'networkidle2' }
        );
        await page.waitForSelector('#password');
        await page.click('input[name=password]');
        await page.type('input[name=password]', '');
        await page.waitForSelector('#confirmPassword');
        await page.click('input[name=confirmPassword]');
        await page.type('input[name=confirmPassword]', '123456');
        await page.click('button[type=submit]');
        await page.waitForSelector('#passwordField > span > span:nth-child(1)');
        const html = await page.$eval(
            '#passwordField > span > span:nth-child(2)',
            e => {
                return e.innerHTML;
            }
        );
        should.exist(html);
        html.should.containEql('Password is required.');
    }, 160000);
});
