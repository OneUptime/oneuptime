import puppeteer from 'puppeteer';
import Email from 'Common/Types/Email';
import utils from '../../test-utils';
import init from '../../test-init';

import 'should';

let browser: $TSFixMe;
let page: $TSFixMe;

const email: Email = utils.generateRandomBusinessEmail();
const password: string = '1234567890';
const user: $TSFixMe = {
    email,
    password,
};

describe('Login API', () => {
    beforeAll(async () => {
        jest.setTimeout(20000);
        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(utils.agent);
    });

    afterAll(async () => {
        await browser.close();
    });

    test(
        'login form should be cleaned if the user moves to the signup form and returns back.',
        async () => {
            await page.goto(utils.ACCOUNTS_URL + '/login', {
                waitUntil: 'networkidle2',
            });

            await init.pageWaitForSelector(page, '#login-button');

            await init.pageClick(page, 'input[name=email]');

            await init.pageType(page, 'input[name=email]', user.email);

            await init.pageClick(page, 'input[name=password]');

            await init.pageType(page, 'input[name=password]', user.password);

            await init.pageClick(page, '#signUpLink a');

            await init.pageWaitForSelector(page, '#loginLink');

            await init.pageClick(page, '#loginLink a');
            await init.pageWaitForSelector(page, 'input[name=email]', {
                visible: true,
                timeout: init.timeout,
            });
            const email: $TSFixMe = await init.page$Eval(
                page,
                'input[name=email]',
                (element: $TSFixMe) => element.value
            );
            expect(email).toEqual('');
            const password: $TSFixMe = await init.page$Eval(
                page,
                'input[name=password]',
                (element: $TSFixMe) => element.value
            );
            expect(password).toEqual('');
        },
        init.timeout
    );

    it(
        'Users cannot login with incorrect credentials',
        async () => {
            await page.goto(utils.ACCOUNTS_URL + '/login', {
                waitUntil: 'networkidle2',
            });

            await init.pageWaitForSelector(page, '#login-button');

            await init.pageClick(page, 'input[name=email]');

            await init.pageType(page, 'input[name=email]', user.email);

            await init.pageClick(page, 'input[name=password]');

            await init.pageType(page, 'input[name=password]', user.password);

            await init.pageClick(page, 'button[type=submit]');

            await init.pageWaitForSelector(page, '#loginError');
            const html: $TSFixMe = await init.page$Eval(
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

            const localStorageData: $TSFixMe = await page.evaluate(() => {
                const json: $TSFixMe = {};
                for (let i: $TSFixMe = 0; i < localStorage.length; i++) {
                    const key: $TSFixMe = localStorage.key(i);

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

    it(
        'Should login valid User (even if the user uses 127.0.0.1 instead of localhost) ',
        async () => {
            const context: $TSFixMe =
                await browser.createIncognitoBrowserContext();
            page = await context.newPage();

            await init.loginUser(
                user,
                page,

                utils.ACCOUNTS_URL1 + '/accounts/login'
            );

            await init.pageWaitForSelector(page, '#components', {
                visible: true,
                timeout: init.timeout,
            });

            const localStorageData: $TSFixMe = await page.evaluate(() => {
                const json: $TSFixMe = {};
                for (let i: $TSFixMe = 0; i < localStorage.length; i++) {
                    const key: $TSFixMe = localStorage.key(i);

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
