// @ts-expect-error ts-migrate(2307) FIXME: Cannot find module 'puppeteer' or its correspondin... Remove this comment to see the full error message
import puppeteer from 'puppeteer';
import utils from '../../test-utils';
import init from '../../test-init';

let browser: $TSFixMe, page: $TSFixMe;
// parent user credentials
const email = utils.generateRandomBusinessEmail();
const password = '1234567890';
const user = {
    email,
    password,
};

// @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'describe'. Do you need to instal... Remove this comment to see the full error message
describe('Stripe cards API', () => {
    const operationTimeOut = init.timeout;

    // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'beforeAll'.
    beforeAll(async (done: $TSFixMe) => {
        // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'jest'.
        jest.setTimeout(init.timeout);

        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(utils.agent);
        // user
        await init.registerUser(user, page);
        done();
    });

    // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'afterAll'.
    afterAll(async (done: $TSFixMe) => {
        await browser.close();
        done();
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test(
        'should add a valid card',
        async (done: $TSFixMe) => {
            await page.goto(utils.DASHBOARD_URL, { timeout: init.timeout });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#profile-menu');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#profileBilling');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#cardNo_0');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#addCardButton');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#addCardButton');
            await init.pageWaitForSelector(
                page,
                '.__PrivateStripeElement > iframe[title="Secure card payment input frame"]',
                {
                    visible: true,
                    timeout: operationTimeOut,
                }
            );
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            const stripeIframe = await init.page$(
                page,
                '.__PrivateStripeElement > iframe[title="Secure card payment input frame"]'
            );
            const frame = await stripeIframe.contentFrame();
            frame.waitForSelector('input[name=cardnumber]');
            await frame.type('input[name=cardnumber]', '5555555555554444', {
                // 4242... has been used during account reg. Similar cards number are rejected. The new number is from stripe documentations.
                delay: 200,
            });
            frame.waitForSelector('input[name=exp-date]');
            await frame.type('input[name=exp-date]', '11/23');
            frame.waitForSelector('input[name=cvc]');
            await frame.type('input[name=cvc]', '100');
            frame.waitForSelector('input[name=postal]');
            await frame.type('input[name=postal]', '11234');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#addCardButtonSubmit');
            await init.pageWaitForSelector(page, '#addCardButtonSubmit', {
                hidden: true,
                timeout: operationTimeOut,
            });

            const cardsCount = await init.page$Eval(
                page,
                '#cardsCount',
                (el: $TSFixMe) => el.textContent
            );

            expect(cardsCount).toEqual('2 Cards');

            done();
        },
        operationTimeOut
    );

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test(
        'should delete card',
        async (done: $TSFixMe) => {
            await page.goto(`${utils.DASHBOARD_URL}/dashboard/profile/billing`);
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#deleteCard1');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#deleteCard1');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#deleteCardButton');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#deleteCardButton');
            await init.pageWaitForSelector(page, '#deleteCardButton', {
                hidden: true,
            });

            const cardsCount = await init.page$Eval(
                page,
                '#cardsCount',
                (el: $TSFixMe) => el.textContent
            );

            expect(cardsCount).toEqual('1 Card');

            done();
        },
        operationTimeOut
    );

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test(
        'should not delete card when there is only one card left',
        async (done: $TSFixMe) => {
            await page.goto(`${utils.DASHBOARD_URL}/dashboard/profile/billing`);
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#deleteCard0');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#deleteCard0');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#deleteCardButton');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#deleteCardButton');
            const deleteError = await init.pageWaitForSelector(
                page,
                '#deleteCardError',
                {
                    visible: true,
                    timeout: operationTimeOut,
                }
            );
            expect(deleteError).toBeDefined();
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#deleteCardCancel');

            const cardsCount = await init.page$Eval(
                page,
                '#cardsCount',
                (el: $TSFixMe) => el.textContent
            );

            expect(cardsCount).toEqual('1 Card');
            done();
        },
        operationTimeOut
    );

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test(
        'should not add an invalid card',
        async (done: $TSFixMe) => {
            await page.goto(`${utils.DASHBOARD_URL}/dashboard/profile/billing`);
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#addCardButton');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#addCardButton');
            await init.pageWaitForSelector(
                page,
                '.__PrivateStripeElement > iframe[title="Secure card payment input frame"]',
                {
                    visible: true,
                    timeout: operationTimeOut,
                }
            );
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            const stripeIframe = await init.page$(
                page,
                '.__PrivateStripeElement > iframe[title="Secure card payment input frame"]'
            );

            const frame = await stripeIframe.contentFrame();
            frame.waitForSelector('input[name=cardnumber]');
            await frame.type('input[name=cardnumber]', '42444242424242424242', {
                // This is a proper invalid card
                delay: 200,
            });
            frame.waitForSelector('input[name=exp-date]');
            await frame.type('input[name=exp-date]', '11/23');
            frame.waitForSelector('input[name=cvc]');
            await frame.type('input[name=cvc]', '100');
            frame.waitForSelector('input[name=postal]');
            await frame.type('input[name=postal]', '11234');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
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
