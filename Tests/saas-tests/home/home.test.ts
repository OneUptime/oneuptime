import puppeteer from 'puppeteer';
import utils from '../../test-utils';
import init from '../../test-init';

let page: $TSFixMe, browser: $TSFixMe;

describe('Request demo', () => {
    beforeAll(async (done: $TSFixMe) => {
        jest.setTimeout(init.timeout);

        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(utils.agent);
        done();
    });

    afterAll(async (done: $TSFixMe) => {
        await browser.close();
        done();
    });

    test(
        'user can submit request through a demo form',
        async (done: $TSFixMe) => {
            await page.goto(`${utils.HOME_URL}/enterprise/demo`);

            await init.pageWaitForSelector(page, '#form-section');

            await init.pageType(page, '#fullname', utils.user.name);

            await init.pageType(page, '#email', utils.user.email);

            await init.pageType(page, '#Phone', utils.user.phone);

            await init.pageType(page, '#website', utils.user.website);

            await init.pageClick(page, '#country');
            await page.keyboard.press('ArrowDown');
            await page.keyboard.down('Enter');

            await init.pageClick(page, '#volume');
            await page.keyboard.press('ArrowDown');
            await page.keyboard.down('Enter');

            await init.pageType(page, '#message', utils.user.message);

            await init.pageClick(page, '#request-demo-btn');

            await init.pageWaitForSelector(page, '#success');
            // Check if user's email is submitted successfully
            await init.pageWaitForSelector(page, '.submitted-email', {
                visible: true,
                timeout: init.timeout,
            });
            const emailSubmitted: $TSFixMe = await page.evaluate(() => {
                return document.querySelector('.submitted-email').innerText;
            });
            expect(emailSubmitted).toBe(utils.user.email);
            done();
        },
        init.timeout
    );

    test(
        'user can request for website monitoring resource',
        async (done: $TSFixMe) => {
            await page.goto(`${utils.HOME_URL}/enterprise/resources`);
            await init.pageWaitForSelector(page, '#website-monitoring', {
                visible: true,
                timeout: init.timeout,
            });
            await Promise.all([
                page.waitForNavigation(),

                init.pageClick(page, '#website-monitoring'),
            ]);
            await init.pageWaitForSelector(page, '#form-section', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageType(page, '#fullname', utils.user.name);

            await init.pageType(page, '#email', utils.user.email);

            await init.pageType(page, '#phone', utils.user.phone);

            await init.pageType(page, '#website', utils.user.website);

            await init.pageClick(page, '#country');
            await page.keyboard.press('ArrowDown');
            await page.keyboard.down('Enter');

            await init.pageClick(page, '#volume');
            await page.keyboard.press('ArrowDown');
            await page.keyboard.down('Enter');

            await init.pageClick(page, '#request-resource-btn');
            // Check if user's email is submitted successfully
            await init.pageWaitForSelector(page, '.submitted-email', {
                visible: true,
                timeout: init.timeout,
            });
            const emailSubmitted: $TSFixMe = await page.evaluate(() => {
                return document.querySelector('.submitted-email').innerText;
            });
            expect(emailSubmitted).toBe(utils.user.email);
            done();
        },
        init.timeout
    );

    test(
        'user can request for speed equals revenue resource',
        async (done: $TSFixMe) => {
            await page.goto(`${utils.HOME_URL}/enterprise/resources`);
            await init.pageWaitForSelector(page, '#speed-revenue', {
                visible: true,
                timeout: init.timeout,
            });
            await Promise.all([
                page.waitForNavigation(),

                init.pageClick(page, '#speed-revenue'),
            ]);
            await init.pageWaitForSelector(page, '#form-section', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageType(page, '#fullname', utils.user.name);

            await init.pageType(page, '#email', utils.user.email);

            await init.pageType(page, '#phone', utils.user.phone);

            await init.pageType(page, '#website', utils.user.website);

            await init.pageClick(page, '#country');
            await page.keyboard.press('ArrowDown');
            await page.keyboard.down('Enter');

            await init.pageClick(page, '#volume');
            await page.keyboard.press('ArrowDown');
            await page.keyboard.down('Enter');

            await init.pageClick(page, '#request-resource-btn');
            // Check if user's email is submitted successfully
            await init.pageWaitForSelector(page, '.submitted-email', {
                visible: true,
                timeout: init.timeout,
            });
            const emailSubmitted: $TSFixMe = await page.evaluate(() => {
                return document.querySelector('.submitted-email').innerText;
            });
            expect(emailSubmitted).toBe(utils.user.email);
            done();
        },
        init.timeout
    );

    test(
        'user can request for best practices resource',
        async (done: $TSFixMe) => {
            await page.goto(`${utils.HOME_URL}/enterprise/resources`);
            await init.pageWaitForSelector(page, '#best-practices', {
                visible: true,
                timeout: init.timeout,
            });
            await Promise.all([
                page.waitForNavigation(),

                init.pageClick(page, '#best-practices'),
            ]);
            await init.pageWaitForSelector(page, '#form-section', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageType(page, '#fullname', utils.user.name);

            await init.pageType(page, '#email', utils.user.email);

            await init.pageType(page, '#phone', utils.user.phone);

            await init.pageType(page, '#website', utils.user.website);

            await init.pageClick(page, '#country');
            await page.keyboard.press('ArrowDown');
            await page.keyboard.down('Enter');

            await init.pageClick(page, '#volume');
            await page.keyboard.press('ArrowDown');
            await page.keyboard.down('Enter');

            await init.pageClick(page, '#request-resource-btn');
            // Check if user's email is submitted successfully
            await init.pageWaitForSelector(page, '.submitted-email', {
                visible: true,
                timeout: init.timeout,
            });
            const emailSubmitted: $TSFixMe = await page.evaluate(() => {
                return document.querySelector('.submitted-email').innerText;
            });
            expect(emailSubmitted).toBe(utils.user.email);
            done();
        },
        init.timeout
    );

    test(
        'user can request for peak performance resource',
        async (done: $TSFixMe) => {
            await page.goto(`${utils.HOME_URL}/enterprise/resources`);
            await init.pageWaitForSelector(page, '#peak-performance', {
                visible: true,
                timeout: init.timeout,
            });
            await Promise.all([
                page.waitForNavigation(),

                init.pageClick(page, '#peak-performance'),
            ]);
            await init.pageWaitForSelector(page, '#form-section', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageType(page, '#fullname', utils.user.name);

            await init.pageType(page, '#email', utils.user.email);

            await init.pageType(page, '#phone', utils.user.phone);

            await init.pageType(page, '#website', utils.user.website);

            await init.pageClick(page, '#country');
            await page.keyboard.press('ArrowDown');
            await page.keyboard.down('Enter');

            await init.pageClick(page, '#volume');
            await page.keyboard.press('ArrowDown');
            await page.keyboard.down('Enter');

            await init.pageClick(page, '#request-resource-btn');
            // Check if user's email is submitted successfully
            await init.pageWaitForSelector(page, '.submitted-email', {
                visible: true,
                timeout: init.timeout,
            });
            const emailSubmitted: $TSFixMe = await page.evaluate(() => {
                return document.querySelector('.submitted-email').innerText;
            });
            expect(emailSubmitted).toBe(utils.user.email);
            done();
        },
        init.timeout
    );
});
