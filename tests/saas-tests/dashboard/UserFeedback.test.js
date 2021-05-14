const puppeteer = require('puppeteer');
const utils = require('../../test-utils');
const init = require('../../test-init');

// user credentials
const email = utils.generateRandomBusinessEmail();
const password = '1234567890';

let browser, page;
describe('User Feedback', () => {
    const operationTimeOut = init.timeout;

    beforeAll(async done => {
        jest.setTimeout(init.timeout);

        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(utils.agent);
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
            const testFeedback = 'test feedback';

            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });
            await page.waitForSelector('#feedback-div');
            await init.pageClick(page, '#feedback-div', { clickCount: 2 });
            await init.pageType(page, '#feedback-textarea', testFeedback);
            await init.pageClick(page, '#feedback-button');
            await page.waitForSelector('#feedback-div');

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
