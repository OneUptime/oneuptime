import puppeteer from 'puppeteer';
import Email from 'Common/Types/Email';
import utils from '../../test-utils';
import init from '../../test-init';

// user credentials
const email: Email = utils.generateRandomBusinessEmail();
const password: string = '1234567890';

let browser: $TSFixMe, page: $TSFixMe;

describe('User Feedback', () => {
    const operationTimeOut: $TSFixMe = init.timeout;

    beforeAll(async (done: $TSFixMe) => {
        jest.setTimeout(init.timeout);

        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(utils.agent);
        // Register user
        const user: $TSFixMe = {
            email,
            password,
        };
        await init.registerUser(user, page);

        done();
    });

    afterAll(async (done: $TSFixMe) => {
        await browser.close();
        done();
    });

    test(
        'should send feedback in project',
        async (done: $TSFixMe) => {
            const testFeedback: string = 'test feedback';

            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });

            await init.pageWaitForSelector(page, '#feedback-div');
            await init.pageClick(page, '#feedback-div', { clickCount: 2 });

            await init.pageType(page, '#feedback-textarea', testFeedback);

            await init.pageClick(page, '#feedback-button');

            await init.pageWaitForSelector(page, '#feedback-div');

            const feedbackMessage: $TSFixMe = await init.page$Eval(
                page,
                '#feedback-div',
                (el: $TSFixMe) => el.textContent
            );

            expect(feedbackMessage).toEqual('Thank you for your feedback.');

            done();
        },
        operationTimeOut
    );
});
