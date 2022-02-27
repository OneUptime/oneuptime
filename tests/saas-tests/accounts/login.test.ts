// @ts-expect-error ts-migrate(2307) FIXME: Cannot find module 'puppeteer' or its correspondin... Remove this comment to see the full error message
import puppeteer from 'puppeteer';
import utils from '../../test-utils';
import init from '../../test-init';

require('should');

let browser: $TSFixMe;
let page: $TSFixMe;

const email = utils.generateRandomBusinessEmail();
const password = '1234567890';
const user = {
    email,
    password,
};

// @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'describe'. Do you need to instal... Remove this comment to see the full error message
describe('Login API', () => {
    // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'beforeAll'.
    beforeAll(async () => {
        // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'jest'.
        jest.setTimeout(20000);
        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(utils.agent);
    });

    // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'afterAll'.
    afterAll(async () => {
        await browser.close();
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test(
        'login form should be cleaned if the user moves to the signup form and returns back.',
        async () => {
            await page.goto(utils.ACCOUNTS_URL + '/login', {
                waitUntil: 'networkidle2',
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#login-button');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, 'input[name=email]');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await init.pageType(page, 'input[name=email]', user.email);
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, 'input[name=password]');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await init.pageType(page, 'input[name=password]', user.password);
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#signUpLink a');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#loginLink');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#loginLink a');
            await init.pageWaitForSelector(page, 'input[name=email]', {
                visible: true,
                timeout: init.timeout,
            });
            const email = await init.page$Eval(
                page,
                'input[name=email]',
                (element: $TSFixMe) => element.value
            );
            expect(email).toEqual('');
            const password = await init.page$Eval(
                page,
                'input[name=password]',
                (element: $TSFixMe) => element.value
            );
            expect(password).toEqual('');
        },
        init.timeout
    );

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it(
        'Users cannot login with incorrect credentials',
        async () => {
            await page.goto(utils.ACCOUNTS_URL + '/login', {
                waitUntil: 'networkidle2',
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#login-button');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, 'input[name=email]');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await init.pageType(page, 'input[name=email]', user.email);
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, 'input[name=password]');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await init.pageType(page, 'input[name=password]', user.password);
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, 'button[type=submit]');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#loginError');
            const html = await init.page$Eval(
                page,
                '#main-body',
                (e: $TSFixMe) => {
                    return e.innerHTML;
                }
            );

            html.should.containEql('User does not exist.');
        },
        init.timeout
    );

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it(
        'Should login valid User',
        async () => {
            await init.registerUser(user, page);
            await init.saasLogout(page);
            await init.loginUser(user, page);

            await init.pageWaitForSelector(page, '#components', {
                visible: true,
                timeout: init.timeout,
            });

            const localStorageData = await page.evaluate(() => {
                const json = {};
                for (let i = 0; i < localStorage.length; i++) {
                    const key = localStorage.key(i);
                    // @ts-expect-error ts-migrate(2538) FIXME: Type 'null' cannot be used as an index type.
                    json[key] = localStorage.getItem(key);
                }
                return json;
            });

            localStorageData.should.have.property('access_token');
            localStorageData.should.have.property('email', email);
            page.url().should.containEql(utils.DASHBOARD_URL);
        },
        init.timeout
    );

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it(
        'Should login valid User (even if the user uses 127.0.0.1 instead of localhost) ',
        async () => {
            const context = await browser.createIncognitoBrowserContext();
            page = await context.newPage();

            await init.loginUser(
                user,
                page,
                // @ts-expect-error ts-migrate(2554) FIXME: Expected 2 arguments, but got 3.
                utils.ACCOUNTS_URL1 + '/accounts/login'
            );

            await init.pageWaitForSelector(page, '#components', {
                visible: true,
                timeout: init.timeout,
            });

            const localStorageData = await page.evaluate(() => {
                const json = {};
                for (let i = 0; i < localStorage.length; i++) {
                    const key = localStorage.key(i);
                    // @ts-expect-error ts-migrate(2538) FIXME: Type 'null' cannot be used as an index type.
                    json[key] = localStorage.getItem(key);
                }
                return json;
            });

            localStorageData.should.have.property('access_token');
            localStorageData.should.have.property('email', email);
            page.url().should.containEql(utils.DASHBOARD_URL);
        },
        init.timeout
    );
});
