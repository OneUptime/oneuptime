/* eslint-disable quotes */

const puppeteer = require('puppeteer');
const should = require('should');
const utils = require('./test-utils');
const init = require('./test-init');

let browser;
let page;

const email = utils.generateRandomBusinessEmail();
const password = utils.generateRandomString();
const user = { email, password };

describe('Resend Verification API', () => {
    beforeAll(async () => {
        jest.setTimeout(30000);
        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/61.0.3163.100 Safari/537.36'
        );
    });

    afterAll(async () => {
        await browser.close();
    });

    it('Should not resend verification token if a user associated with the email does not exist', async () => {
        try {
            await page.goto(utils.ACCOUNTS_URL + '/user-verify/resend', {
                waitUntil: 'networkidle2',
            });
        } catch (e) {
            //
        }
        await page.waitForSelector('#email');
        await page.click('input[name=email]');
        await page.type('input[name=email]', 'invalid@email.com');
        await page.click('button[type=submit]');
        await page.waitForSelector('#error-msg');
        const html = await page.$eval('#error-msg', e => {
            return e.innerHTML;
        });
        should.exist(html);
        html.should.containEql('No user associated with this account');
    }, 160000);

    it('Should resend verification token successfully', async () => {
        await init.registerUser(user, page);
        try {
            await page.goto(utils.ACCOUNTS_URL + '/user-verify/resend', {
                waitUntil: 'networkidle2',
            });
        } catch (e) {
            //
        }
        await page.waitForSelector('#email');
        await page.click('input[name=email]');
        await page.type('input[name=email]', email);
        await page.click('button[type=submit]');
        await page.waitForSelector('#resend-verification-success');
        const html = await page.$eval('#resend-verification-success', e => {
            return e.innerHTML;
        });
        should.exist(html);
        html.should.containEql(
            " An email is on its way to you with new verification link. Please don't forget to check spam."
        );
    }, 160000);
});
