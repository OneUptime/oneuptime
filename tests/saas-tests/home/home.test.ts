// @ts-expect-error ts-migrate(2307) FIXME: Cannot find module 'puppeteer' or its correspondin... Remove this comment to see the full error message
import puppeteer from 'puppeteer';
import utils from '../../test-utils';
import init from '../../test-init';

let page: $TSFixMe, browser: $TSFixMe;

// @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'describe'. Do you need to instal... Remove this comment to see the full error message
describe('Request demo', () => {
    // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'beforeAll'.
    beforeAll(async (done: $TSFixMe) => {
        // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'jest'.
        jest.setTimeout(init.timeout);

        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(utils.agent);
        done();
    });

    // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'afterAll'.
    afterAll(async (done: $TSFixMe) => {
        await browser.close();
        done();
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test(
        'user can submit request through a demo form',
        async (done: $TSFixMe) => {
            await page.goto(`${utils.HOME_URL}/enterprise/demo`);
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#form-section');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await init.pageType(page, '#fullname', utils.user.name);
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await init.pageType(page, '#email', utils.user.email);
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await init.pageType(page, '#Phone', utils.user.phone);
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await init.pageType(page, '#website', utils.user.website);
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#country');
            await page.keyboard.press('ArrowDown');
            await page.keyboard.down('Enter');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#volume');
            await page.keyboard.press('ArrowDown');
            await page.keyboard.down('Enter');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await init.pageType(page, '#message', utils.user.message);
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#request-demo-btn');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#success');
            // Check if user's email is submitted successfully
            await init.pageWaitForSelector(page, '.submitted-email', {
                visible: true,
                timeout: init.timeout,
            });
            const emailSubmitted = await page.evaluate(
                // @ts-expect-error ts-migrate(2531) FIXME: Object is possibly 'null'.
                () => document.querySelector('.submitted-email').innerText
            );
            expect(emailSubmitted).toBe(utils.user.email);
            done();
        },
        init.timeout
    );
    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
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
                // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
                init.pageClick(page, '#website-monitoring'),
            ]);
            await init.pageWaitForSelector(page, '#form-section', {
                visible: true,
                timeout: init.timeout,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await init.pageType(page, '#fullname', utils.user.name);
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await init.pageType(page, '#email', utils.user.email);
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await init.pageType(page, '#phone', utils.user.phone);
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await init.pageType(page, '#website', utils.user.website);
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#country');
            await page.keyboard.press('ArrowDown');
            await page.keyboard.down('Enter');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#volume');
            await page.keyboard.press('ArrowDown');
            await page.keyboard.down('Enter');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#request-resource-btn');
            // Check if user's email is submitted successfully
            await init.pageWaitForSelector(page, '.submitted-email', {
                visible: true,
                timeout: init.timeout,
            });
            const emailSubmitted = await page.evaluate(
                // @ts-expect-error ts-migrate(2531) FIXME: Object is possibly 'null'.
                () => document.querySelector('.submitted-email').innerText
            );
            expect(emailSubmitted).toBe(utils.user.email);
            done();
        },
        init.timeout
    );
    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
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
                // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
                init.pageClick(page, '#speed-revenue'),
            ]);
            await init.pageWaitForSelector(page, '#form-section', {
                visible: true,
                timeout: init.timeout,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await init.pageType(page, '#fullname', utils.user.name);
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await init.pageType(page, '#email', utils.user.email);
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await init.pageType(page, '#phone', utils.user.phone);
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await init.pageType(page, '#website', utils.user.website);
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#country');
            await page.keyboard.press('ArrowDown');
            await page.keyboard.down('Enter');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#volume');
            await page.keyboard.press('ArrowDown');
            await page.keyboard.down('Enter');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#request-resource-btn');
            // Check if user's email is submitted successfully
            await init.pageWaitForSelector(page, '.submitted-email', {
                visible: true,
                timeout: init.timeout,
            });
            const emailSubmitted = await page.evaluate(
                // @ts-expect-error ts-migrate(2531) FIXME: Object is possibly 'null'.
                () => document.querySelector('.submitted-email').innerText
            );
            expect(emailSubmitted).toBe(utils.user.email);
            done();
        },
        init.timeout
    );
    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
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
                // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
                init.pageClick(page, '#best-practices'),
            ]);
            await init.pageWaitForSelector(page, '#form-section', {
                visible: true,
                timeout: init.timeout,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await init.pageType(page, '#fullname', utils.user.name);
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await init.pageType(page, '#email', utils.user.email);
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await init.pageType(page, '#phone', utils.user.phone);
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await init.pageType(page, '#website', utils.user.website);
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#country');
            await page.keyboard.press('ArrowDown');
            await page.keyboard.down('Enter');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#volume');
            await page.keyboard.press('ArrowDown');
            await page.keyboard.down('Enter');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#request-resource-btn');
            // Check if user's email is submitted successfully
            await init.pageWaitForSelector(page, '.submitted-email', {
                visible: true,
                timeout: init.timeout,
            });
            const emailSubmitted = await page.evaluate(
                // @ts-expect-error ts-migrate(2531) FIXME: Object is possibly 'null'.
                () => document.querySelector('.submitted-email').innerText
            );
            expect(emailSubmitted).toBe(utils.user.email);
            done();
        },
        init.timeout
    );
    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
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
                // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
                init.pageClick(page, '#peak-performance'),
            ]);
            await init.pageWaitForSelector(page, '#form-section', {
                visible: true,
                timeout: init.timeout,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await init.pageType(page, '#fullname', utils.user.name);
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await init.pageType(page, '#email', utils.user.email);
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await init.pageType(page, '#phone', utils.user.phone);
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await init.pageType(page, '#website', utils.user.website);
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#country');
            await page.keyboard.press('ArrowDown');
            await page.keyboard.down('Enter');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#volume');
            await page.keyboard.press('ArrowDown');
            await page.keyboard.down('Enter');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#request-resource-btn');
            // Check if user's email is submitted successfully
            await init.pageWaitForSelector(page, '.submitted-email', {
                visible: true,
                timeout: init.timeout,
            });
            const emailSubmitted = await page.evaluate(
                // @ts-expect-error ts-migrate(2531) FIXME: Object is possibly 'null'.
                () => document.querySelector('.submitted-email').innerText
            );
            expect(emailSubmitted).toBe(utils.user.email);
            done();
        },
        init.timeout
    );
});
