const puppeteer = require('puppeteer');
const utils = require('./test-utils');
const init = require('./test-init');

require('should');
let browser, page;
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
       
        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/61.0.3163.100 Safari/537.36'
        ); 

        // Register user        
            await init.registerUser(user, page);       
    });

    afterAll(async done => {        
        await browser.close();
        done();
    });

    test(
        'Should edit the user profile',
        async (done) => {
            const name = utils.generateRandomString(10);            
                await page.goto(utils.DASHBOARD_URL);

                await page.waitForSelector('#profile-menu');
                await page.click('#profile-menu');
                await page.waitForSelector('#userProfile');
                await page.click('#userProfile');
                await page.waitForSelector('#profileSettings', {
                    visible: true,
                });
                await page.click('#profileSettings');
                await page.waitForSelector('input[name=name]');
                await page.click('input[name=name]', { clickCount: 3 });
                await page.type('input[name=name]', name);
                await page.waitForSelector('button[type=submit]');
                await page.click('button[type=submit]');
                await page.waitForTimeout(2000);
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
        async (done) => {            
                await page.goto(utils.DASHBOARD_URL);

                await page.waitForSelector('#profile-menu');
                await page.click('#profile-menu');
                await page.waitForSelector('#userProfile');
                await page.click('#userProfile');
                await page.waitForSelector('#changePassword');
                await page.$eval('#changePassword', elem => elem.click());
                await page.waitForSelector('input[name=currentPassword]');
                await page.type('input[name=currentPassword]', user.password);
                await page.waitForSelector('input[name=newPassword]');
                await page.type('input[name=newPassword]', '0987654321');
                await page.waitForSelector('input[name=confirmPassword]');
                await page.type('input[name=confirmPassword]', '0987654321');
                await page.waitForSelector('button[type=submit]');
                await page.click('button[type=submit]');
                let spanElement = await page.waitForSelector(
                    '.bs-Modal-content',
                    { visible: true, timeout: operationTimeOut }
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
        async (done) => {            
                await page.goto(utils.DASHBOARD_URL);

                await page.waitForSelector('#profile-menu');
                await page.click('#profile-menu');
                await page.waitForSelector('#userProfile');
                await page.click('#userProfile');
                await page.waitForSelector('#changePassword');
                await page.$eval('#changePassword', elem => elem.click());
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
            done();
        },
        operationTimeOut
    );
    test(
        'Should not activate google authenticator if the verification code is wrong',
        async (done) => {            
                // visit the dashboard
                await page.goto(utils.DASHBOARD_URL);
                // click on the profile page
                await page.waitForSelector('#profile-menu');
                await page.click('#profile-menu');
                await page.waitForSelector('#userProfile');
                await page.click('#userProfile');

                await page.waitForSelector('#profileSettings', {
                    visible: true,
                });
                await page.click('#profileSettings');

                // toggle the google authenticator
                await page.waitForSelector('input[name=twoFactorAuthEnabled]', {
                    visible: true,
                });
                await page.reload({ waitUntil: 'networkidle0' });
                await page.$eval('input[name=twoFactorAuthEnabled]', e =>
                    e.click()
                );

                //wait for the QR code to show
                await page.waitForSelector('#qr-code', { visible: true });

                // click on the next button
                await page.waitForSelector('#nextFormButton');
                await page.click('#nextFormButton');

                // enter a random verification code
                await page.waitForSelector('#token');
                await page.type('#token', '021196');

                // click the verification button
                await page.waitForSelector('#enableTwoFactorAuthButton');
                await page.click('#enableTwoFactorAuthButton');

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
