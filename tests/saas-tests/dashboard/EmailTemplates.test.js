const puppeteer = require('puppeteer');
const utils = require('../../test-utils');
const init = require('../../test-init');

require('should');
let browser, page;
// user credentials
const email = utils.generateRandomBusinessEmail();
const password = '1234567890';
let defaultSubject;

const user = {
    email,
    password,
};

describe('Email Templates API', () => {
    const operationTimeOut = init.timeout;

    beforeAll(async done => {
        jest.setTimeout(init.timeout);

        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/61.0.3163.100 Safari/537.36'
        );

        // Register user
        await init.registerUser(user, page);

        done();
    });

    afterAll(async done => {
        await browser.close();
        done();
    });

    test(
        'should not show reset button when no template is saved',
        async done => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });
            await page.waitForSelector('#projectSettings');
            await init.pageClick(page, '#projectSettings');
            await page.waitForSelector('#more');
            await init.pageClick(page, '#more');
            await page.waitForSelector('#email');
            await init.pageClick(page, '#email');
            await init.selectByText(
                '#type',
                'External Subscriber Incident Created',
                page
            );
            await page.waitForSelector('#name');
            defaultSubject = await page.$eval('#name', elem => elem.value);
            const resetBtn = await page.waitForSelector('#templateReset', {
                hidden: true,
            });
            expect(resetBtn).toBeNull();

            done();
        },
        operationTimeOut
    );

    test(
        'Should update default email template',
        async done => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });
            await page.waitForSelector('#projectSettings');
            await init.pageClick(page, '#projectSettings');
            await page.waitForSelector('#more');
            await init.pageClick(page, '#more');
            await page.waitForSelector('#email');
            await init.pageClick(page, '#email');
            await init.selectByText(
                '#type',
                'External Subscriber Incident Created',
                page
            );
            const subject = 'Updated Subject';
            await page.waitForSelector('#name');
            await init.pageClick(page, '#name', { clickCount: 3 });
            await init.pageType(page, '#name', subject);
            await init.pageClick(page, '#saveTemplate');
            await page.waitForSelector('#ball-beat', { hidden: true });

            await page.reload();
            await init.selectByText(
                '#type',
                'External Subscriber Incident Created',
                page
            );
            await page.waitForSelector('#name');
            const finalSubject = await page.$eval('#name', elem => elem.value);

            expect(finalSubject).toEqual(subject);

            done();
        },
        operationTimeOut
    );

    test(
        'should show reset button when a template is already saved',
        async done => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });
            await page.waitForSelector('#projectSettings');
            await init.pageClick(page, '#projectSettings');
            await page.waitForSelector('#more');
            await init.pageClick(page, '#more');
            await page.waitForSelector('#email');
            await init.pageClick(page, '#email');
            await init.selectByText(
                '#type',
                'External Subscriber Incident Created',
                page
            );
            const resetBtn = await page.waitForSelector('#templateReset', {
                visible: true,
            });
            expect(resetBtn).toBeDefined();

            done();
        },
        operationTimeOut
    );

    test(
        'should reset template to default state',
        async done => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });
            await page.waitForSelector('#projectSettings');
            await init.pageClick(page, '#projectSettings');
            await page.waitForSelector('#more');
            await init.pageClick(page, '#more');
            await page.waitForSelector('#email');
            await init.pageClick(page, '#email');
            await init.selectByText(
                '#type',
                'External Subscriber Incident Created',
                page
            );
            await page.waitForSelector('#templateReset', {
                visible: true,
            });
            await init.pageClick(page, '#templateReset');
            await page.waitForSelector('#ball-beat', { hidden: true });

            await page.reload();
            await init.selectByText(
                '#type',
                'External Subscriber Incident Created',
                page
            );
            await page.waitForSelector('#name');
            const finalSubject = await page.$eval('#name', elem => elem.value);
            expect(defaultSubject).toEqual(finalSubject);

            done();
        },
        operationTimeOut
    );
});
