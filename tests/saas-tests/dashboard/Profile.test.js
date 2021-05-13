const puppeteer = require('puppeteer');
const utils = require('../../test-utils');
const init = require('../../test-init');

require('should');
let browser, page;
// user credentials
const user = {
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

    afterAll(async done => {
        await browser.close();
        done();
    });

    test(
        'Should edit the user profile',
        async done => {
            const name = utils.generateRandomString(10);
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });

            await page.waitForSelector('#profile-menu');
            await init.pageClick(page, '#profile-menu');
            await page.waitForSelector('#userProfile');
            await init.pageClick(page, '#userProfile');
            await page.waitForSelector('#profileSettings', {
                visible: true,
            });
            await init.pageClick(page, '#profileSettings');
            await page.waitForSelector('input[name=name]');
            await init.pageClick(page, 'input[name=name]', { clickCount: 3 });
            await init.pageType(page, 'input[name=name]', name);
            await page.waitForSelector('button[type=submit]');
            await init.pageClick(page, 'button[type=submit]');

            await page.waitForSelector('.ball-beat', { hidden: true });
            let spanElement = await page.waitForSelector(
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
        async done => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });

            await page.waitForSelector('#profile-menu');
            await init.pageClick(page, '#profile-menu');
            await page.waitForSelector('#userProfile');
            await init.pageClick(page, '#userProfile');
            await page.waitForSelector('#changePassword');
            await page.$eval('#changePassword', elem => elem.click());
            await page.waitForSelector('input[name=currentPassword]');
            await init.pageType(
                page,
                'input[name=currentPassword]',
                user.password
            );
            await page.waitForSelector('input[name=newPassword]');
            await init.pageType(page, 'input[name=newPassword]', '0987654321');
            await page.waitForSelector('input[name=confirmPassword]');
            await init.pageType(
                page,
                'input[name=confirmPassword]',
                '0987654321'
            );
            await page.waitForSelector('button[type=submit]');
            await init.pageClick(page, 'button[type=submit]');
            let spanElement = await page.waitForSelector('.bs-Modal-content', {
                visible: true,
                timeout: operationTimeOut,
            });
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
        async done => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });

            await page.waitForSelector('#profile-menu');
            await init.pageClick(page, '#profile-menu');
            await page.waitForSelector('#userProfile');
            await init.pageClick(page, '#userProfile');
            await page.waitForSelector('#changePassword');
            await page.$eval('#changePassword', elem => elem.click());
            await page.waitForSelector('input[name=currentPassword]');
            await init.pageType(
                page,
                'input[name=currentPassword]',
                user.password
            );
            await page.waitForSelector('input[name=newPassword]');
            await init.pageType(page, 'input[name=newPassword]', user.password);
            await page.waitForSelector('input[name=confirmPassword]');
            await init.pageType(
                page,
                'input[name=confirmPassword]',
                user.password
            );
            await page.waitForSelector('button[type=submit]');
            await init.pageClick(page, 'button[type=submit]');
            let spanElement = await page.waitForSelector('#errorMessage');
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
        async done => {
            // visit the dashboard
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });
            // click on the profile page
            await page.waitForSelector('#profile-menu');
            await init.pageClick(page, '#profile-menu');
            await page.waitForSelector('#userProfile');
            await init.pageClick(page, '#userProfile');

            await page.waitForSelector('#profileSettings', {
                visible: true,
            });
            await init.pageClick(page, '#profileSettings');

            // toggle the google authenticator
            await page.waitForSelector('input[name=twoFactorAuthEnabled]', {
                visible: true,
            });
            await page.reload({ waitUntil: 'networkidle2' });
            await page.$eval('input[name=twoFactorAuthEnabled]', e =>
                e.click()
            );

            //wait for the QR code to show
            await page.waitForSelector('#qr-code', { visible: true });

            // click on the next button
            await page.waitForSelector('#nextFormButton');
            await init.pageClick(page, '#nextFormButton');

            // enter a random verification code
            await page.waitForSelector('#token');
            await init.pageType(page, '#token', '021196');

            // click the verification button
            await page.waitForSelector('#enableTwoFactorAuthButton');
            await init.pageClick(page, '#enableTwoFactorAuthButton');

            // verify there is an error message
            let spanElement = await page.waitForSelector('#modal-message', {
                visible: true,
            });
            spanElement = await spanElement.getProperty('innerText');
            spanElement = await spanElement.jsonValue();
            spanElement.should.be.exactly('Invalid token.');
            done();
        },
        operationTimeOut
    );
});
