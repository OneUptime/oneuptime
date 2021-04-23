const puppeteer = require('puppeteer');
const utils = require('./test-utils');
const init = require('./test-init');

require('should');

let browser, page;
// user credentials
const email = utils.generateRandomBusinessEmail();
const password = '1234567890';
const user = {
    email,
    password,
};

describe('Enterprise Disabled Billing API', () => {
    const operationTimeOut = 100000;

    beforeAll(async done => {
        jest.setTimeout(200000);

        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/61.0.3163.100 Safari/537.36'
        );
            await init.registerEnterpriseUser(user, page);
       
        done();
    });

    afterAll(async done => {
        await browser.close();
        done();
    });

    test(
        'Should not display project billing page after login',
        async done => {          
                await init.adminLogout(page);               
                await init.loginUser(user, page);
                await page.waitForSelector('#projectSettings');
                await page.click('#projectSettings');

                const projectBilling = await page.$('#billingSetting');
                expect(projectBilling).toBeNull();
            done();
        },
        operationTimeOut
    );

    // test(
    //     'Should not display profile billing on profile menu',
    //     async done => {
    //         const cluster = await Cluster.launch({
    //             concurrency: Cluster.CONCURRENCY_PAGE,
    //             puppeteerOptions: utils.puppeteerLaunchConfig,
    //             puppeteer,
    //             timeout: 100000,
    //         });

    //         cluster.on('taskerror', err => {
    //             throw err;
    //         });

    //         await cluster.task(async ({ page, data }) => {
    //             const user = {
    //                 email: data.email,
    //                 password: data.password,
    //             };

    //             await init.loginUser(user, page);
    //             await page.waitForSelector('#profile-menu');
    //             await page.click('#profile-menu');

    //             const profileBilling = await page.$('#profileBilling');
    //             expect(profileBilling).toBeNull();
    //         });

    //         cluster.queue({ email, password });
    //         await cluster.idle();
    //         await cluster.close();
    //         done();
    //     },
    //     operationTimeOut
    // );
});
