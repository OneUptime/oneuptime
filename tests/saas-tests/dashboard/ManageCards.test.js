const puppeteer = require('puppeteer');
const utils = require('../../test-utils');
const init = require('../../test-init');

let browser, page;
// parent user credentials
const email = utils.generateRandomBusinessEmail();
const password = '1234567890';
const user = {
    email,
    password,
};

describe('Stripe cards API', () => {
    const operationTimeOut = init.timeout;

    beforeAll(async done => {
        jest.setTimeout(init.timeout);

        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(utils.agent);
        // user
        await init.registerUser(user, page);
        done();
    });

    afterAll(async done => {
        await browser.close();
        done();
    });

    test(
        'should add a valid card',
        async done => {
            await page.goto(`${utils.DASHBOARD_URL}/dashboard/profile/billing`);
            await init.pageWaitForSelector(page, '#addCardButton');
            await init.pageClick(page, '#addCardButton');
            await init.pageWaitForSelector(page, 
                '.__PrivateStripeElement > iframe[title="Secure card payment input frame"]',
                {
                    visible: true,
                    timeout: operationTimeOut,
                }
            );
            const stripeIframe = await page.$(
                '.__PrivateStripeElement > iframe[title="Secure card payment input frame"]'
            );
            const frame = await stripeIframe.contentFrame();
            frame.waitForSelector('input[name=cardnumber]');
            await frame.type('input[name=cardnumber]', '42424242424242424242', {
                delay: 200,
            });
            frame.waitForSelector('input[name=exp-date]');
            await frame.type('input[name=exp-date]', '11/23');
            frame.waitForSelector('input[name=cvc]');
            await frame.type('input[name=cvc]', '100');
            frame.waitForSelector('input[name=postal]');
            await frame.type('input[name=postal]', '11234');
            await init.pageClick(page, '#addCardButtonSubmit');
            await init.pageWaitForSelector(page, '#addCardButtonSubmit', {
                hidden: true,
                timeout: operationTimeOut,
            });

            const cardsCount = await page.$eval(
                '#cardsCount',
                el => el.textContent
            );

            expect(cardsCount).toEqual('2 Cards');

            done();
        },
        operationTimeOut
    );

    test(
        'should delete card',
        async done => {
            await page.goto(`${utils.DASHBOARD_URL}/dashboard/profile/billing`);
            await init.pageWaitForSelector(page, '#deleteCard1');
            await init.pageClick(page, '#deleteCard1');
            await init.pageWaitForSelector(page, '#deleteCardButton');
            await init.pageClick(page, '#deleteCardButton');
            await init.pageWaitForSelector(page, '#deleteCardButton', {
                hidden: true,
            });

            const cardsCount = await page.$eval(
                '#cardsCount',
                el => el.textContent
            );

            expect(cardsCount).toEqual('1 Card');

            done();
        },
        operationTimeOut
    );

    test(
        'should not delete card when there is only one card left',
        async done => {
            await page.goto(`${utils.DASHBOARD_URL}/dashboard/profile/billing`);
            await init.pageWaitForSelector(page, '#deleteCard0');
            await init.pageClick(page, '#deleteCard0');
            await init.pageWaitForSelector(page, '#deleteCardButton');
            await init.pageClick(page, '#deleteCardButton');
            const deleteError = await init.pageWaitForSelector(page, '#deleteCardError', {
                visible: true,
                timeout: operationTimeOut,
            });
            expect(deleteError).toBeDefined();
            await init.pageClick(page, '#deleteCardCancel');

            const cardsCount = await page.$eval(
                '#cardsCount',
                el => el.textContent
            );

            expect(cardsCount).toEqual('1 Card');
            done();
        },
        operationTimeOut
    );

    test(
        'should not add an invalid card',
        async done => {
            await page.goto(`${utils.DASHBOARD_URL}/dashboard/profile/billing`);
            await init.pageWaitForSelector(page, '#addCardButton');
            await init.pageClick(page, '#addCardButton');
            await init.pageWaitForSelector(page, 
                '.__PrivateStripeElement > iframe[title="Secure card payment input frame"]',
                {
                    visible: true,
                    timeout: operationTimeOut,
                }
            );
            const stripeIframe = await page.$(
                '.__PrivateStripeElement > iframe[title="Secure card payment input frame"]'
            );

            const frame = await stripeIframe.contentFrame();
            frame.waitForSelector('input[name=cardnumber]');
            await frame.type('input[name=cardnumber]', '42424242424242424242', {
                delay: 200,
            });
            frame.waitForSelector('input[name=exp-date]');
            await frame.type('input[name=exp-date]', '11/23');
            frame.waitForSelector('input[name=cvc]');
            await frame.type('input[name=cvc]', '100');
            frame.waitForSelector('input[name=postal]');
            await frame.type('input[name=postal]', '11234');
            await init.pageClick(page, '#addCardButtonSubmit');
            const error = await init.pageWaitForSelector(page, '#cardError', {
                visible: true,
                timeout: init.timeout,
            });
            expect(error).toBeDefined();
            done();
        },
        operationTimeOut
    );
});
