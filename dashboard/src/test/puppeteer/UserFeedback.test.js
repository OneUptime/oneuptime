const puppeteer = require('puppeteer');
const utils = require('./test-utils');
const init = require('./test-init');

// user credentials
const email = utils.generateRandomBusinessEmail();
const password = '1234567890';

let browser, page;
describe('User Feedback', () => {
    const operationTimeOut = 50000;

    beforeAll(async done => {
        jest.setTimeout(200000);

        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/61.0.3163.100 Safari/537.36'
        );  
        // Register user        
            const user = {
                email,
                password,
            };            
            await init.registerUser(user, page);
        
        done();
    });

    afterAll(async done => {
        await browser.close();
        done();
    });

    test(
        'should send feedback in project',
        async done => {
             expect.assertions(1); // registerUser is the only assertion present
            const testFeedback = 'test feedback';            
                           
                await page.goto(utils.DASHBOARD_URL);                
                await page.waitForSelector('#feedback-div');
                await page.click('#feedback-div', { clickCount: 2 });
                await page.type('#feedback-textarea', testFeedback);
                await page.click('#feedback-button');
                await page.waitForTimeout(3000);

                const feedbackMessage = await page.$eval(
                    '#feedback-div',
                    el => el.textContent
                );

                expect(feedbackMessage).toEqual('Thank you for your feedback.');

            done();
        },
        operationTimeOut
    );
});
