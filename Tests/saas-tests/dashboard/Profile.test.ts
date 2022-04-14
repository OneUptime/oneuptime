import puppeteer from 'puppeteer';
import utils from '../../test-utils';
import init from '../../test-init';

import 'should';
let browser: $TSFixMe, page: $TSFixMe;
// user credentials
const user: $TSFixMe = {
    email: utils.generateRandomBusinessEmail(),
    password: '1234567890',
};

describe('Profile -> Delete Account Component test', () => {
    const operationTimeOut = init.timeout;

    beforeAll(async () => {
        jest.setTimeout(init.timeout);

        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(utils.agent);

        // Register user
        await init.registerUser(user, page);
    });

    afterAll(async (done: $TSFixMe) => {
        await browser.close();
        done();
    });

    test(
        'Should edit the user profile',
        async (done: $TSFixMe) => {
            const name: string = utils.generateRandomString(10);
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

            await init.pageClick(page, '#profileSettings');

            await init.pageWaitForSelector(page, 'input[name=name]');
            await init.pageClick(page, 'input[name=name]', { clickCount: 3 });

            await init.pageType(page, 'input[name=name]', name);

            await init.pageWaitForSelector(page, 'button[type=submit]');

            await init.pageClick(page, 'button[type=submit]');

            await init.pageWaitForSelector(page, '.ball-beat', {
                hidden: true,
            });

            let spanElement: $TSFixMe = await init.pageWaitForSelector(
                page,
                'span#userProfileName'
            );
            spanElement = await spanElement.getProperty('innerText');
            spanElement = await spanElement.jsonValue();
            spanElement.should.be.exactly(name);

            done();
        },
        operationTimeOut
    );

    test(
        'Should change the user password',
        async (done: $TSFixMe) => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });

            await init.pageWaitForSelector(page, '#profile-menu');

            await init.pageClick(page, '#profile-menu');

            await init.pageWaitForSelector(page, '#userProfile');

            await init.pageClick(page, '#userProfile');

            await init.pageWaitForSelector(page, '#changePassword');
            await init.page$Eval(page, '#changePassword', (elem: $TSFixMe) =>
                elem.click()
            );

            await init.pageWaitForSelector(page, 'input[name=currentPassword]');

            await init.pageType(
                page,
                'input[name=currentPassword]',
                user.password
            );

            await init.pageWaitForSelector(page, 'input[name=newPassword]');

            await init.pageType(page, 'input[name=newPassword]', '0987654321');

            await init.pageWaitForSelector(page, 'input[name=confirmPassword]');

            await init.pageType(
                page,
                'input[name=confirmPassword]',
                '0987654321'
            );

            await init.pageWaitForSelector(page, 'button[type=submit]');

            await init.pageClick(page, 'button[type=submit]');
            let spanElement: $TSFixMe = await init.pageWaitForSelector(
                page,
                '.bs-Modal-content',
                {
                    visible: true,
                    timeout: operationTimeOut,
                }
            );
            spanElement = await spanElement.getProperty('innerText');
            spanElement = await spanElement.jsonValue();
            spanElement.should.be.exactly(
                'You’ve changed the password successfully.'
            );
            done();
        },
        operationTimeOut
    );

    test(
        'Should not change password if new password and password are the same',
        async (done: $TSFixMe) => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });

            await init.pageWaitForSelector(page, '#profile-menu');

            await init.pageClick(page, '#profile-menu');

            await init.pageWaitForSelector(page, '#userProfile');

            await init.pageClick(page, '#userProfile');

            await init.pageWaitForSelector(page, '#changePassword');
            await init.page$Eval(page, '#changePassword', (elem: $TSFixMe) =>
                elem.click()
            );

            await init.pageWaitForSelector(page, 'input[name=currentPassword]');

            await init.pageType(
                page,
                'input[name=currentPassword]',
                user.password
            );

            await init.pageWaitForSelector(page, 'input[name=newPassword]');

            await init.pageType(page, 'input[name=newPassword]', user.password);

            await init.pageWaitForSelector(page, 'input[name=confirmPassword]');

            await init.pageType(
                page,
                'input[name=confirmPassword]',
                user.password
            );

            await init.pageWaitForSelector(page, 'button[type=submit]');

            await init.pageClick(page, 'button[type=submit]');

            let spanElement: $TSFixMe = await init.pageWaitForSelector(
                page,
                '#errorMessage'
            );
            spanElement = await spanElement.getProperty('innerText');
            spanElement = await spanElement.jsonValue();
            spanElement.should.be.exactly(
                'New password should not be the same as current password.'
            );
            done();
        },
        operationTimeOut
    );

    test(
        'Should not activate google authenticator if the verification code is wrong',
        async (done: $TSFixMe) => {
            // visit the dashboard
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });
            // click on the profile page

            await init.pageWaitForSelector(page, '#profile-menu');

            await init.pageClick(page, '#profile-menu');

            await init.pageWaitForSelector(page, '#userProfile');

            await init.pageClick(page, '#userProfile');

            await init.pageWaitForSelector(page, '#profileSettings', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#profileSettings');

            // toggle the google authenticator
            await init.pageWaitForSelector(
                page,
                'input[name=twoFactorAuthEnabled]',
                {
                    visible: true,
                    timeout: init.timeout,
                }
            );
            await page.reload({ waitUntil: 'networkidle2' });
            await init.page$Eval(
                page,
                'input[name=twoFactorAuthEnabled]',
                (e: $TSFixMe) => e.click()
            );

            //wait for the QR code to show
            await init.pageWaitForSelector(page, '#qr-code', {
                visible: true,
                timeout: init.timeout,
            });

            // click on the next button

            await init.pageWaitForSelector(page, '#nextFormButton');

            await init.pageClick(page, '#nextFormButton');

            // enter a random verification code

            await init.pageWaitForSelector(page, '#token');

            await init.pageType(page, '#token', '021196');

            // click the verification button

            await init.pageWaitForSelector(page, '#enableTwoFactorAuthButton');

            await init.pageClick(page, '#enableTwoFactorAuthButton');

            // verify there is an error message
            let spanElement: $TSFixMe = await init.pageWaitForSelector(
                page,
                '#modal-message',
                {
                    visible: true,
                    timeout: init.timeout,
                }
            );
            spanElement = await spanElement.getProperty('innerText');
            spanElement = await spanElement.jsonValue();
            spanElement.should.be.exactly('Invalid token.');
            done();
        },
        operationTimeOut
    );
});
