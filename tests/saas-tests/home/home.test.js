const puppeteer = require('puppeteer');
const util = require('../../test-utils');
const init = require('../../test-init');

let page, browser;

describe('Request demo', () => {
    beforeAll(async done => {
        jest.setTimeout(init.timeout);
        browser = await puppeteer.launch(util.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/61.0.3163.100 Safari/537.36'
        );
        done();
    });

    afterAll(async done => {
        await browser.close();
        done();
    });

    test('user can submit request through a demo form', async done => {
        await page.goto(`${util.HOME_URL}/enterprise/demo`);
        await page.waitForSelector('#form-section');
        await init.pageType(page, '#fullname', util.user.name);
        await init.pageType(page, '#email', util.user.email);
        await init.pageType(page, '#Phone', util.user.phone);
        await init.pageType(page, '#website', util.user.website);
        await init.pageClick(page, '#country');
        await page.keyboard.press('ArrowDown');
        await page.keyboard.down('Enter');
        await init.pageClick(page, '#volume');
        await page.keyboard.press('ArrowDown');
        await page.keyboard.down('Enter');
        await init.pageType(page, '#message', util.user.message);
        await init.pageClick(page, '#request-demo-btn');
        await page.waitForSelector('#success');
        // Check if user's email is submitted successfully
        await page.waitForSelector('.submitted-email', { visible: true });
        const emailSubmitted = await page.evaluate(
            () => document.querySelector('.submitted-email').innerText
        );
        expect(emailSubmitted).toBe(util.user.email);
        done();
    }, init.timeout);
    test('user can request for website monitoring resource', async done => {
        await page.goto(`${util.HOME_URL}/enterprise/resources`);
        await page.waitForSelector('#website-monitoring', { visible: true });
        await Promise.all([
            page.waitForNavigation(),
            init.pageClick(page, '#website-monitoring'),
        ]);
        await page.waitForSelector('#form-section', { visible: true });
        await init.pageType(page, '#fullname', util.user.name);
        await init.pageType(page, '#email', util.user.email);
        await init.pageType(page, '#phone', util.user.phone);
        await init.pageType(page, '#website', util.user.website);
        await init.pageClick(page, '#country');
        await page.keyboard.press('ArrowDown');
        await page.keyboard.down('Enter');
        await init.pageClick(page, '#volume');
        await page.keyboard.press('ArrowDown');
        await page.keyboard.down('Enter');
        await init.pageClick(page, '#request-resource-btn');
        // Check if user's email is submitted successfully
        await page.waitForSelector('.submitted-email', { visible: true });
        const emailSubmitted = await page.evaluate(
            () => document.querySelector('.submitted-email').innerText
        );
        expect(emailSubmitted).toBe(util.user.email);
        done();
    }, init.timeout);
    test('user can request for speed equals revenue resource', async done => {
        await page.goto(`${util.HOME_URL}/enterprise/resources`);
        await page.waitForSelector('#speed-revenue', { visible: true });
        await Promise.all([
            page.waitForNavigation(),
            init.pageClick(page, '#speed-revenue'),
        ]);
        await page.waitForSelector('#form-section', { visible: true });
        await init.pageType(page, '#fullname', util.user.name);
        await init.pageType(page, '#email', util.user.email);
        await init.pageType(page, '#phone', util.user.phone);
        await init.pageType(page, '#website', util.user.website);
        await init.pageClick(page, '#country');
        await page.keyboard.press('ArrowDown');
        await page.keyboard.down('Enter');
        await init.pageClick(page, '#volume');
        await page.keyboard.press('ArrowDown');
        await page.keyboard.down('Enter');
        await init.pageClick(page, '#request-resource-btn');
        // Check if user's email is submitted successfully
        await page.waitForSelector('.submitted-email', { visible: true });
        const emailSubmitted = await page.evaluate(
            () => document.querySelector('.submitted-email').innerText
        );
        expect(emailSubmitted).toBe(util.user.email);
        done();
    }, init.timeout);
    test('user can request for best practices resource', async done => {
        await page.goto(`${util.HOME_URL}/enterprise/resources`);
        await page.waitForSelector('#best-practices', { visible: true });
        await Promise.all([
            page.waitForNavigation(),
            init.pageClick(page, '#best-practices'),
        ]);
        await page.waitForSelector('#form-section', { visible: true });
        await init.pageType(page, '#fullname', util.user.name);
        await init.pageType(page, '#email', util.user.email);
        await init.pageType(page, '#phone', util.user.phone);
        await init.pageType(page, '#website', util.user.website);
        await init.pageClick(page, '#country');
        await page.keyboard.press('ArrowDown');
        await page.keyboard.down('Enter');
        await init.pageClick(page, '#volume');
        await page.keyboard.press('ArrowDown');
        await page.keyboard.down('Enter');
        await init.pageClick(page, '#request-resource-btn');
        // Check if user's email is submitted successfully
        await page.waitForSelector('.submitted-email', { visible: true });
        const emailSubmitted = await page.evaluate(
            () => document.querySelector('.submitted-email').innerText
        );
        expect(emailSubmitted).toBe(util.user.email);
        done();
    }, init.timeout);
    test('user can request for peak performance resource', async done => {
        await page.goto(`${util.HOME_URL}/enterprise/resources`);
        await page.waitForSelector('#peak-performance', { visible: true });
        await Promise.all([
            page.waitForNavigation(),
            init.pageClick(page, '#peak-performance'),
        ]);
        await page.waitForSelector('#form-section', { visible: true });
        await init.pageType(page, '#fullname', util.user.name);
        await init.pageType(page, '#email', util.user.email);
        await init.pageType(page, '#phone', util.user.phone);
        await init.pageType(page, '#website', util.user.website);
        await init.pageClick(page, '#country');
        await page.keyboard.press('ArrowDown');
        await page.keyboard.down('Enter');
        await init.pageClick(page, '#volume');
        await page.keyboard.press('ArrowDown');
        await page.keyboard.down('Enter');
        await init.pageClick(page, '#request-resource-btn');
        // Check if user's email is submitted successfully
        await page.waitForSelector('.submitted-email', { visible: true });
        const emailSubmitted = await page.evaluate(
            () => document.querySelector('.submitted-email').innerText
        );
        expect(emailSubmitted).toBe(util.user.email);
        done();
    }, init.timeout);
});
