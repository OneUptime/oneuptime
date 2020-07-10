const puppeteer = require('puppeteer');
const utils = require('./test-utils');
const init = require('./test-init');
const { Cluster } = require('puppeteer-cluster');

require('should');

// user credentials
const user = {
    email: utils.generateRandomBusinessEmail(),
    password: '1234567890',
};

describe('Profile -> Delete Account Component test', () => {
    const operationTimeOut = 500000;

    let cluster;

    beforeAll(async () => {
        jest.setTimeout(500000);

        cluster = await Cluster.launch({
            concurrency: Cluster.CONCURRENCY_PAGE,
            puppeteerOptions: utils.puppeteerLaunchConfig,
            puppeteer,
            timeout: utils.timeout,
        });

        cluster.on('taskerror', err => {
            throw err;
        });

        // Register user
        return await cluster.execute(null, async ({ page }) => {
            await init.registerUser(user, page);
            await init.loginUser(user, page);
        });
    });

    afterAll(async () => {
        await cluster.idle();
        await cluster.close();
    });

    test(
        'Should edit the user profile',
        async () => {
            const name = utils.generateRandomString(10);

            return await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.DASHBOARD_URL);

                await page.waitForSelector('#profile-menu');
                await page.click('#profile-menu');
                await page.waitForSelector('#userProfile');
                await page.click('#userProfile');
                await page.waitForSelector('input[name=name]');
                await page.click('input[name=name]', { clickCount: 3 });
                await page.type('input[name=name]', name);
                await page.waitForSelector('button[type=submit]');
                await page.click('button[type=submit]');
                let spanElement = await page.waitForSelector(
                    'span#userProfileName'
                );
                spanElement = await spanElement.getProperty('innerText');
                spanElement = await spanElement.jsonValue();
                spanElement.should.be.exactly(name);
            });
        },
        operationTimeOut
    );

    test(
        'Should change the user password',
        async () => {
            return await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.DASHBOARD_URL);

                await page.waitForSelector('#profile-menu');
                await page.click('#profile-menu');
                await page.waitForSelector('#userProfile');
                await page.click('#userProfile');
                await page.waitForSelector('#changePassword');
                await page.click('#changePassword');
                await page.waitForSelector('input[name=currentPassword]');
                await page.type('input[name=currentPassword]', user.password);
                await page.waitForSelector('input[name=newPassword]');
                await page.type('input[name=newPassword]', '0987654321');
                await page.waitForSelector('input[name=confirmPassword]');
                await page.type('input[name=confirmPassword]', '0987654321');
                await page.waitForSelector('button[type=submit]');
                await page.click('button[type=submit]');
                let spanElement = await page.waitForSelector(
                    '.bs-Modal-content'
                );
                spanElement = await spanElement.getProperty('innerText');
                spanElement = await spanElement.jsonValue();
                spanElement.should.be.exactly(
                    'You’ve changed the password successfully.'
                );
            });
        },
        operationTimeOut
    );

    test(
        'Should not change password if new password and password are the same',
        async () => {
            return await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.DASHBOARD_URL);

                await page.waitForSelector('#profile-menu');
                await page.click('#profile-menu');
                await page.waitForSelector('#userProfile');
                await page.click('#userProfile');
                await page.waitForSelector('#changePassword');
                await page.click('#changePassword');
                await page.waitForSelector('input[name=currentPassword]');
                await page.type('input[name=currentPassword]', user.password);
                await page.waitForSelector('input[name=newPassword]');
                await page.type('input[name=newPassword]', user.password);
                await page.waitForSelector('input[name=confirmPassword]');
                await page.type('input[name=confirmPassword]', user.password);
                await page.waitForSelector('button[type=submit]');
                await page.click('button[type=submit]');
                let spanElement = await page.waitForSelector('#errorMessage');
                spanElement = await spanElement.getProperty('innerText');
                spanElement = await spanElement.jsonValue();
                spanElement.should.be.exactly(
                    'New password should not be the same as current password.'
                );
            });
        },
        operationTimeOut
    );
});
