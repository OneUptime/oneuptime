import puppeteer from 'puppeteer';
import Email from 'Common/Types/Email';
import utils from '../../test-utils';
import init from '../../test-init';

import speakeasy from 'speakeasy';
import { expect } from 'chai';

import 'should';
const projectName: string = 'project';

let browser: $TSFixMe, page: $TSFixMe;
// user credentials
const email: Email = utils.generateRandomBusinessEmail();
const password: string = '1234567890';
let token: $TSFixMe;

const generateOtp: Function = (): void => {
    const otp: $TSFixMe = speakeasy.totp({
        secret: token.trim(),
        encoding: 'base32',
    });
    return otp;
};

describe('TwoFactor Authentication API', () => {
    const operationTimeOut: $TSFixMe = init.timeout;

    beforeAll(async (done: $TSFixMe) => {
        jest.setTimeout(360000);
        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(utils.agent);

        const user: $TSFixMe = {
            email: email,
            password: password,
        };
        //user login
        await init.registerUser(user, page);

        await init.addProject(page, projectName);

        done();
    });

    afterAll(async (done: $TSFixMe) => {
        browser.close();
        done();
    });

    test(
        'Should throw an error when invalid otp token is passed',
        async (done: $TSFixMe) => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });

            await init.pageWaitForSelector(page, '#profile-menu');

            await init.pageClick(page, '#profile-menu');

            await init.pageWaitForSelector(page, '#userProfile');

            await init.pageClick(page, '#userProfile');
            await init.pageWaitForSelector(page, '#profileSettings', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageWaitForSelector(page, '#twoFactorLabel');

            await init.pageClick(page, '#twoFactorLabel');

            await init.pageWaitForSelector(page, '#nextFormButton');

            await init.pageClick(page, '#nextFormButton');

            await init.pageWaitForSelector(page, '#token');

            await init.pageType(page, '#token', '432424');

            await init.pageWaitForSelector(page, '#enableTwoFactorAuthButton');

            await init.pageClick(page, '#enableTwoFactorAuthButton');

            const message: $TSFixMe = await init.page$Eval(
                page,
                '#modal-message',
                (element: $TSFixMe) => element.innerHTML
            );
            expect(message).equal('Invalid token.');
            done();
        },
        operationTimeOut
    );

    test(
        'Should enable twoFactor authentication',
        async (done: $TSFixMe) => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });

            await init.pageWaitForSelector(page, '#profile-menu');

            await init.pageClick(page, '#profile-menu');

            await init.pageWaitForSelector(page, '#userProfile');

            await init.pageClick(page, '#userProfile');
            await init.pageWaitForSelector(page, '#profileSettings', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageWaitForSelector(page, '#twoFactorLabel');

            await init.pageClick(page, '#twoFactorLabel');

            await init.pageWaitForSelector(page, '#otpath-url');
            token = await init.page$Eval(
                page,
                '#otpath-url',
                (element: $TSFixMe) => element.innerHTML
            );

            const otp: $TSFixMe = await generateOtp(token);

            await init.pageWaitForSelector(page, '#nextFormButton');

            await init.pageClick(page, '#nextFormButton');

            await init.pageWaitForSelector(page, '#token');

            await init.pageType(page, '#token', otp.toString());

            await init.pageWaitForSelector(page, '#enableTwoFactorAuthButton');

            await init.pageClick(page, '#enableTwoFactorAuthButton');
            const isVisible: $TSFixMe = await init.isElementOnPage(
                page,
                '#modal-message'
            );
            expect(isVisible).equal(false);
            await init.saasLogout(page);
            done();
        },
        operationTimeOut
    );

    test(
        'Should ask a user with two factor enabled when they are about to login again',
        async (done: $TSFixMe) => {
            await page.goto(utils.ACCOUNTS_URL + '/login', {
                waitUntil: 'networkidle2',
            });

            await init.pageWaitForSelector(page, '#login-button');

            await init.pageClick(page, 'input[name=email]');

            await init.pageType(page, 'input[name=email]', email);

            await init.pageClick(page, 'input[name=password]');

            await init.pageType(page, 'input[name=password]', password);

            await init.pageClick(page, 'button[type=submit]');
            await init.pageWaitForSelector(page, '.message', {
                visible: true,
                timeout: init.timeout,
            });

            const message: $TSFixMe = await init.page$Eval(
                page,
                '.message',
                (element: $TSFixMe) => element.innerHTML
            );
            expect(message).equal('Enter your auth token below to login.');
            done();
        },
        operationTimeOut
    );

    test(
        'Should throw an error when invalid otp token is passed during login',
        async (done: $TSFixMe) => {
            await page.goto(utils.ACCOUNTS_URL + '/login', {
                waitUntil: 'networkidle2',
            });

            await init.pageWaitForSelector(page, '#login-button');

            await init.pageClick(page, 'input[name=email]');

            await init.pageType(page, 'input[name=email]', email);

            await init.pageClick(page, 'input[name=password]');

            await init.pageType(page, 'input[name=password]', password);

            await init.pageClick(page, 'button[type=submit]');

            await init.pageWaitForSelector(page, '#token');

            await init.pageType(page, '#token', '432224');

            await init.pageWaitForSelector(page, 'button[type=submit]');

            await init.pageClick(page, 'button[type=submit]');

            const message: $TSFixMe = await init.page$Eval(
                page,
                '.title span',
                (element: $TSFixMe) => element.innerHTML
            );
            expect(message).equal('Invalid token.');
            done();
        },
        operationTimeOut
    );

    test(
        'Should successfully login when valid otp token is passed during login',
        async (done: $TSFixMe) => {
            await page.goto(utils.ACCOUNTS_URL + '/login', {
                waitUntil: 'networkidle2',
            });

            await init.pageWaitForSelector(page, '#login-button');

            await init.pageClick(page, 'input[name=email]');

            await init.pageType(page, 'input[name=email]', email);

            await init.pageClick(page, 'input[name=password]');

            await init.pageType(page, 'input[name=password]', password);

            await init.pageClick(page, 'button[type=submit]');

            const otp: $TSFixMe = generateOtp();

            await init.pageWaitForSelector(page, '#token');

            await init.pageType(page, '#token', otp.toString());

            await init.pageWaitForSelector(page, 'button[type=submit]');

            await init.pageClick(page, 'button[type=submit]');
            await init.pageWaitForSelector(page, '#home', {
                visible: true,
                timeout: init.timeout,
            });
            done();
        },
        operationTimeOut
    );
});
