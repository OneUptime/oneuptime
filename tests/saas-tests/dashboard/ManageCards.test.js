const puppeteer = require('puppeteer');
const utils = require('../../../test-utils');
const init = require('../../../test-init');

let browser, page;
// parent user credentials
const email = utils.generateRandomBusinessEmail();
const password = '1234567890';
const user = {
    email,
    password,
};

describe('Stripe cards API', () => {
    const operationTimeOut = 60000;

    beforeAll(async done => {
        jest.setTimeout(200000);

        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/61.0.3163.100 Safari/537.36'
        );
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
            await page.waitForSelector('#addCardButton');
            await page.click('#addCardButton');
            await page.waitForSelector(
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
            await frame.type('input[name=cardnumber]', '5555555555554444', {
                delay: 150,
            });
            frame.waitForSelector('input[name=exp-date]');
            await frame.type('input[name=exp-date]', '11/23');
            frame.waitForSelector('input[name=cvc]');
            await frame.type('input[name=cvc]', '100');
            frame.waitForSelector('input[name=postal]');
            await frame.type('input[name=postal]', '11234');
            await page.click('#addCardButtonSubmit');
            await page.waitForSelector('#addCardButtonSubmit', {
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
            await page.waitForSelector('#deleteCard1');
            await page.click('#deleteCard1');
            await page.waitForSelector('#deleteCardButton');
            await page.click('#deleteCardButton');
            await page.waitForSelector('#deleteCardButton', {
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
            await page.waitForSelector('#deleteCard0');
            await page.click('#deleteCard0');
            await page.waitForSelector('#deleteCardButton');
            await page.click('#deleteCardButton');
            const deleteError = await page.waitForSelector('#deleteCardError', {
                visible: true,
                timeout: operationTimeOut,
            });
            expect(deleteError).toBeDefined();
            await page.click('#deleteCardCancel');

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
            await page.waitForSelector('#addCardButton');
            await page.click('#addCardButton');
            await page.waitForSelector(
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
            await frame.type('input[name=cardnumber]', '4242424242424241', {
                delay: 150,
            });
            frame.waitForSelector('input[name=exp-date]');
            await frame.type('input[name=exp-date]', '11/23');
            frame.waitForSelector('input[name=cvc]');
            await frame.type('input[name=cvc]', '100');
            frame.waitForSelector('input[name=postal]');
            await frame.type('input[name=postal]', '11234');
            await page.click('#addCardButtonSubmit');
            const error = await page.waitForSelector('#cardError', {
                visible: true,
            });
            expect(error).toBeDefined();
            done();
        },
        operationTimeOut
    );
});
