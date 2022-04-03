import puppeteer from 'puppeteer';
import utils from '../../test-utils';
import init from '../../test-init';

import 'should';
let browser: $TSFixMe, page: $TSFixMe;
// user credentials
const email = utils.generateRandomBusinessEmail();
const password = '1234567890';
let defaultSubject: $TSFixMe;

const user = {
    email,
    password,
};

describe('Email Templates API', () => {
    const operationTimeOut = init.timeout;

    beforeAll(async (done: $TSFixMe) => {
        jest.setTimeout(init.timeout);

        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(utils.agent);

        // Register user
        await init.registerUser(user, page);

        done();
    });

    afterAll(async (done: $TSFixMe) => {
        await browser.close();
        done();
    });

    test(
        'should not show reset button when no template is saved',
        async (done: $TSFixMe) => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });

            await init.pageWaitForSelector(page, '#projectSettings');

            await init.pageClick(page, '#projectSettings');

            await init.pageWaitForSelector(page, '#more');

            await init.pageClick(page, '#more');

            await init.pageWaitForSelector(page, '#email');

            await init.pageClick(page, '#email');
            await init.selectDropdownValue(
                '#type',
                'Subscriber Incident Created', // Updated UI
                page
            );

            await init.pageWaitForSelector(page, '#name');
            defaultSubject = await init.page$Eval(
                page,
                '#name',
                (elem: $TSFixMe) => elem.value
            );
            const resetBtn = await init.pageWaitForSelector(
                page,
                '#templateReset',
                {
                    hidden: true,
                }
            );
            expect(resetBtn).toBeNull();

            done();
        },
        operationTimeOut
    );

    test(
        'Should update default email template',
        async (done: $TSFixMe) => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });

            await init.pageWaitForSelector(page, '#projectSettings');

            await init.pageClick(page, '#projectSettings');

            await init.pageWaitForSelector(page, '#more');

            await init.pageClick(page, '#more');

            await init.pageWaitForSelector(page, '#email');

            await init.pageClick(page, '#email');
            await init.selectDropdownValue(
                '#type',
                'Subscriber Incident Created',
                page
            );
            const subject = 'Updated Subject';

            await init.pageWaitForSelector(page, '#name');
            await init.pageClick(page, '#name', { clickCount: 3 });

            await init.pageType(page, '#name', subject);

            await init.pageClick(page, '#saveTemplate');
            await init.pageWaitForSelector(page, '#ball-beat', {
                hidden: true,
            });

            await page.reload();
            await init.selectDropdownValue(
                '#type',
                'Subscriber Incident Created',
                page
            );

            await init.pageWaitForSelector(page, '#name');
            const finalSubject = await init.page$Eval(
                page,
                '#name',
                (elem: $TSFixMe) => elem.value
            );

            expect(finalSubject).toEqual(subject);

            done();
        },
        operationTimeOut
    );

    test(
        'should show reset button when a template is already saved',
        async (done: $TSFixMe) => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });

            await init.pageWaitForSelector(page, '#projectSettings');

            await init.pageClick(page, '#projectSettings');

            await init.pageWaitForSelector(page, '#more');

            await init.pageClick(page, '#more');

            await init.pageWaitForSelector(page, '#email');

            await init.pageClick(page, '#email');
            await init.selectDropdownValue(
                '#type',
                'Subscriber Incident Created',
                page
            );
            const resetBtn = await init.pageWaitForSelector(
                page,
                '#templateReset',
                {
                    visible: true,
                    timeout: init.timeout,
                }
            );
            expect(resetBtn).toBeDefined();

            done();
        },
        operationTimeOut
    );

    test(
        'should reset template to default state',
        async (done: $TSFixMe) => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });

            await init.pageWaitForSelector(page, '#projectSettings');

            await init.pageClick(page, '#projectSettings');

            await init.pageWaitForSelector(page, '#more');

            await init.pageClick(page, '#more');

            await init.pageWaitForSelector(page, '#email');

            await init.pageClick(page, '#email');
            await init.selectDropdownValue(
                '#type',
                'Subscriber Incident Created',
                page
            );
            await init.pageWaitForSelector(page, '#templateReset', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#templateReset');
            await init.pageWaitForSelector(page, '#ball-beat', {
                hidden: true,
            });

            await page.reload();
            await init.selectDropdownValue(
                '#type',
                'Subscriber Incident Created',
                page
            );

            await init.pageWaitForSelector(page, '#name');
            const finalSubject = await init.page$Eval(
                page,
                '#name',
                (elem: $TSFixMe) => elem.value
            );
            expect(defaultSubject).toEqual(finalSubject);

            done();
        },
        operationTimeOut
    );
});
