import puppeteer from 'puppeteer';
import Email from 'Common/Types/Email';
import utils from '../../test-utils';
import init from '../../test-init';

import 'should';

let browser: $TSFixMe;
let page: $TSFixMe;

const email: Email = utils.generateRandomBusinessEmail();
const password = '1234567890';
const user: $TSFixMe = {
    email,
    password,
};

describe('Registration API', () => {
    beforeAll(async () => {
        jest.setTimeout(15000);
        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(utils.agent);
    });

    afterAll(async () => {
        await browser.close();
    });

    it(
        'User cannot register with invalid email',
        async () => {
            const invalidEmail = 'invalidEmail';
            await page.goto(utils.ACCOUNTS_URL + '/register', {
                waitUntil: 'networkidle2',
            });

            await init.pageWaitForSelector(page, '#email');

            await init.pageClick(page, 'input[name=email]');

            await init.pageType(page, 'input[name=email]', invalidEmail);

            await init.pageClick(page, 'input[name=name]');

            await init.pageType(page, 'input[name=name]', utils.user.name);

            await init.pageClick(page, 'input[name=companyName]');

            await init.pageType(
                page,
                'input[name=companyName]',
                utils.user.company.name
            );

            await init.pageClick(page, 'input[name=companyPhoneNumber]');

            await init.pageType(
                page,
                'input[name=companyPhoneNumber]',
                utils.user.phone
            );

            await init.pageClick(page, 'input[name=password]');

            await init.pageType(page, 'input[name=password]', user.password);

            await init.pageClick(page, 'input[name=confirmPassword]');

            await init.pageType(
                page,
                'input[name=confirmPassword]',
                user.password
            );

            await init.pageClick(page, 'button[type=submit]');

            await init.pageWaitForSelector(page, '#email_error');
            const errorMsg: $TSFixMe = await init.page$Eval(
                page,
                '#email_error',
                (elem: $TSFixMe) => {
                    return elem.textContent;
                }
            );
            expect(errorMsg).toEqual('Email is not valid.');
        },
        init.timeout
    );

    it(
        'User cannot register with personal email',
        async () => {
            const personalEmail = 'personalEmail@gmail.com';
            const user: $TSFixMe = {
                email: personalEmail,
                password: '1234567890',
            };
            await init.registerFailedUser(user, page);
            const errorMsg: $TSFixMe = await init.page$Eval(
                page,
                '#error', // The previous validation is no longer in use.
                (elem: $TSFixMe) => {
                    return elem.textContent;
                }
            );

            expect(errorMsg).toEqual('Business email address is required.');
        },
        init.timeout
    );

    test(
        'Registration form fields should be cleaned if the user moves to the login form and returns back.',
        async () => {
            await page.goto(utils.ACCOUNTS_URL + '/register', {
                waitUntil: 'networkidle2',
            });

            await init.pageWaitForSelector(page, '#email');

            await init.pageClick(page, 'input[name=email]');

            await init.pageType(page, 'input[name=email]', user.email);

            await init.pageClick(page, 'input[name=name]');

            await init.pageType(page, 'input[name=name]', utils.user.name);

            await init.pageClick(page, 'input[name=companyName]');

            await init.pageType(
                page,
                'input[name=companyName]',
                utils.user.company.name
            );

            await init.pageClick(page, 'input[name=companyPhoneNumber]');

            await init.pageType(
                page,
                'input[name=companyPhoneNumber]',
                '1234567890'
            );

            await init.pageClick(page, 'input[name=password]');

            await init.pageType(page, 'input[name=password]', '1234567890');

            await init.pageClick(page, 'input[name=confirmPassword]');

            await init.pageType(
                page,
                'input[name=confirmPassword]',
                '1234567890'
            );

            await init.pageClick(page, '#loginLink a');

            await init.pageWaitForSelector(page, '#signUpLink a');

            await init.pageClick(page, '#signUpLink a');

            await init.pageWaitForSelector(page, 'input[name=email]');
            const email: $TSFixMe = await init.page$Eval(
                page,
                'input[name=email]',
                (element: $TSFixMe) => {
                    return element.value;
                }
            );
            expect(email).toEqual('');
        },
        init.timeout
    );

    test(
        'Registration form fields should be cleaned if the user moves from card form to the login form and returns back.',
        async () => {
            await page.goto(utils.ACCOUNTS_URL + '/register', {
                waitUntil: 'networkidle2',
            });

            await init.pageWaitForSelector(page, '#email');

            await init.pageClick(page, 'input[name=email]');

            await init.pageType(page, 'input[name=email]', user.email);

            await init.pageClick(page, 'input[name=name]');

            await init.pageType(page, 'input[name=name]', utils.user.name);

            await init.pageClick(page, 'input[name=companyName]');

            await init.pageType(
                page,
                'input[name=companyName]',
                utils.user.company.name
            );

            await init.pageClick(page, 'input[name=companyPhoneNumber]');

            await init.pageType(
                page,
                'input[name=companyPhoneNumber]',
                '1234567890'
            );

            await init.pageClick(page, 'input[name=password]');

            await init.pageType(page, 'input[name=password]', '1234567890');

            await init.pageClick(page, 'input[name=confirmPassword]');

            await init.pageType(
                page,
                'input[name=confirmPassword]',
                '1234567890'
            );

            await init.pageClick(page, 'button[type=submit]');

            await init.pageWaitForSelector(page, 'input[name=cardName]');

            await init.pageClick(page, 'input[name=cardName]');

            await init.pageType(page, 'input[name=cardName]', 'Test name');

            await init.pageClick(page, '#loginLink a');

            await init.pageWaitForSelector(page, '#signUpLink a');

            await init.pageClick(page, '#signUpLink a');

            await init.pageWaitForSelector(page, 'input[name=email]');
            const email: $TSFixMe = await init.page$Eval(
                page,
                'input[name=email]',
                (element: $TSFixMe) => {
                    return element.value;
                }
            );
            expect(email).toEqual('');
        },
        init.timeout
    );

    it(
        'Should register User with valid details',
        async () => {
            await init.registerUser(user, page);

            await init.pageWaitForSelector(page, '#titleText');
            const innerText: $TSFixMe = await init.page$Eval(
                page,
                '#cbHome',
                (elem: $TSFixMe) => {
                    return elem.innerText;
                }
            );
            page.url().should.containEql(utils.DASHBOARD_URL);
            expect(innerText).toEqual('Home');
        },
        init.timeout
    );
});
