const puppeteer = require('puppeteer');
const util = require('./test-utils');

let page, browser;

describe('Request demo', () => {
    beforeAll(async () => {
        jest.setTimeout(15000);
        browser = await puppeteer.launch(util.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/61.0.3163.100 Safari/537.36'
        );
    });

    afterAll(async () => {
        await browser.close();
    });

    test('user can submit request a demo form', async () => {
        await page.goto(`${util.HOME_URL}/enterprise/demo`);
        await page.waitForSelector('#form-section');
        await page.type('#fullname', util.user.name);
        await page.type('#email', util.user.email);
        await page.type('#Phone', util.user.phone);
        await page.type('#website', util.user.website);
        await page.click('#country');
        await page.keyboard.press('ArrowDown');
        await page.keyboard.down('Enter');
        await page.click('#volume');
        await page.keyboard.press('ArrowDown');
        await page.keyboard.down('Enter');
        await page.type('#message', util.user.message);
        await page.click('#request-demo-btn');
        await page.waitForSelector('#success');
        // Check if user's email is submitted successfully
        const emailSubmitted = await page.evaluate(
            () => document.querySelector('.submitted-email').innerText
        );
        expect(emailSubmitted).toBe(util.user.email);
    }, 30000);
    test('user can request for website monitoring resource', async () => {
        await page.goto(`${util.HOME_URL}/enterprise/resources`);
        await page.waitForSelector('#website-monitoring');
        await Promise.all([
            page.waitForNavigation(),
            page.click('#website-monitoring'),
        ]);
        await page.waitForSelector('#form-section');
        await page.type('#fullname', util.user.name);
        await page.type('#email', util.user.email);
        await page.type('#Phone', util.user.phone);
        await page.type('#website', util.user.website);
        await page.click('#country');
        await page.keyboard.press('ArrowDown');
        await page.keyboard.down('Enter');
        await page.click('#volume');
        await page.keyboard.press('ArrowDown');
        await page.keyboard.down('Enter');
        await page.click('#request-resource-btn');
        // Check if user's email is submitted successfully
        const emailSubmitted = await page.evaluate(
            () => document.querySelector('.submitted-email').innerText
        );
        expect(emailSubmitted).toBe(util.user.email);
    }, 30000);
    test('user can request for speed equals revenue resource', async () => {
        await page.goto(`${util.HOME_URL}/enterprise/resources`);
        await page.waitForSelector('#speed-revenue');
        await Promise.all([
            page.waitForNavigation(),
            page.click('#speed-revenue'),
        ]);
        await page.waitForSelector('#form-section');
        await page.type('#fullname', util.user.name);
        await page.type('#email', util.user.email);
        await page.type('#Phone', util.user.phone);
        await page.type('#website', util.user.website);
        await page.click('#country');
        await page.keyboard.press('ArrowDown');
        await page.keyboard.down('Enter');
        await page.click('#volume');
        await page.keyboard.press('ArrowDown');
        await page.keyboard.down('Enter');
        await page.click('#request-resource-btn');
        // Check if user's email is submitted successfully
        const emailSubmitted = await page.evaluate(
            () => document.querySelector('.submitted-email').innerText
        );
        expect(emailSubmitted).toBe(util.user.email);
    }, 30000);
    test('user can request for best practices resource', async () => {
        await page.goto(`${util.HOME_URL}/enterprise/resources`);
        await page.waitForSelector('#best-practices');
        await Promise.all([
            page.waitForNavigation(),
            page.click('#best-practices'),
        ]);
        await page.waitForSelector('#form-section');
        await page.type('#fullname', util.user.name);
        await page.type('#email', util.user.email);
        await page.type('#Phone', util.user.phone);
        await page.type('#website', util.user.website);
        await page.click('#country');
        await page.keyboard.press('ArrowDown');
        await page.keyboard.down('Enter');
        await page.click('#volume');
        await page.keyboard.press('ArrowDown');
        await page.keyboard.down('Enter');
        await page.click('#request-resource-btn');
        // Check if user's email is submitted successfully
        const emailSubmitted = await page.evaluate(
            () => document.querySelector('.submitted-email').innerText
        );
        expect(emailSubmitted).toBe(util.user.email);
    }, 30000);
    test('user can request for peak performance resource', async () => {
        await page.goto(`${util.HOME_URL}/enterprise/resources`);
        await page.waitForSelector('#peak-performance');
        await Promise.all([
            page.waitForNavigation(),
            page.click('#peak-performance'),
        ]);
        await page.waitForSelector('#form-section');
        await page.type('#fullname', util.user.name);
        await page.type('#email', util.user.email);
        await page.type('#Phone', util.user.phone);
        await page.type('#website', util.user.website);
        await page.click('#country');
        await page.keyboard.press('ArrowDown');
        await page.keyboard.down('Enter');
        await page.click('#volume');
        await page.keyboard.press('ArrowDown');
        await page.keyboard.down('Enter');
        await page.click('#request-resource-btn');
        // Check if user's email is submitted successfully
        const emailSubmitted = await page.evaluate(
            () => document.querySelector('.submitted-email').innerText
        );
        expect(emailSubmitted).toBe(util.user.email);
    }, 30000);
});
