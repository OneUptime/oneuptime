const puppeteer = require('puppeteer');
const utils = require('./test-utils');
const init = require('./test-init');

require('should');
let browser, browser2, page, browserPage;
const admin = {
    email: 'masteradmin@hackerbay.io',
    password: '1234567890',
};
// user credentials
const user = {
    email: `test${utils.generateRandomBusinessEmail()}`,
    password: '1234567890',
};

describe('Users', () => {
    const operationTimeOut = 500000;    
    beforeAll(async () => {
        jest.setTimeout(500000);
    
        browser = await puppeteer.launch(utils.puppeteerLaunchConfig); // User-Dashboard
        browser2 = await puppeteer.launch(utils.puppeteerLaunchConfig); // Admin-Dashboard
        page = await browser.newPage();
        browserPage = await browser2.newPage();
        await page.setUserAgent(
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/61.0.3163.100 Safari/537.36'
        );     

        // Register users        
            await init.registerEnterpriseUser(user, browserPage);            
    });

    afterAll(async done => {        
        await browser.close();
        done();
    });
    /**  This test works by running user dashboard and admin dashboard in two seperate browsers.
     as two dashboards cannot be run in the same browser */
    it(
        'should logout the user if the admin deletes the account from the dashboard.',
        async (done) => {  
                await page.bringToFront();
                await init.loginUser(user, page);
                await browserPage.bringToFront();               
                await browserPage.waitForSelector(
                    `#${user.email.split('@')[0]}`,
                    { visible: true }
                );
                await browserPage.click(`#${user.email.split('@')[0]}`);
                await browserPage.waitForSelector('#delete', { visible: true });
                await browserPage.waitForTimeout(1000);
                await browserPage.click('#delete');
                await browserPage.waitForSelector('#confirmDelete', {
                    visible: true,
                });
                await browserPage.click('#confirmDelete');
                await browserPage.waitForSelector('#confirmDelete', {
                    hidden: true,
                });

                await page.bringToFront();
                await page.waitForSelector('#statusPages');
                await page.click('#statusPages');
                await page.waitForSelector('#login-button', { visible: true });            
            done();
        },
        operationTimeOut
    );

    it(
        'should be able to restore deleted users (using admin account)',
        async (done) => {            
                await init.loginUser(admin, page);
                await page.waitForSelector(
                    `#deleted__${user.email.split('@')[0]}`,
                    { visible: true }
                );
                await page.click(`#deleted__${user.email.split('@')[0]}`);
                await page.waitForTimeout(1000);
                await page.waitForSelector('#restore', { visible: true });
                await page.click('#restore');
                const delBtn = await page.waitForSelector('#delete', {
                    visible: true,
                });
                expect(delBtn).toBeDefined();
            done();
        },
        operationTimeOut
    );
});
