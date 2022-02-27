// @ts-expect-error ts-migrate(2307) FIXME: Cannot find module 'puppeteer' or its correspondin... Remove this comment to see the full error message
import puppeteer from 'puppeteer';
// @ts-expect-error ts-migrate(2307) FIXME: Cannot find module 'should' or its corresponding t... Remove this comment to see the full error message
import should from 'should';
import utils from '../../test-utils';
import init from '../../test-init';
let browser: $TSFixMe;
let page: $TSFixMe;

// @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'describe'. Do you need to instal... Remove this comment to see the full error message
describe('Resend Verification API', () => {
    // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'beforeAll'.
    beforeAll(async () => {
        // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'jest'.
        jest.setTimeout(init.timeout);

        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(utils.agent);
    });

    // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'afterAll'.
    afterAll(async () => {
        await browser.close();
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it(
        'Should not resend verification token if a user associated with the email does not exist',
        async () => {
            await page.goto(utils.ACCOUNTS_URL + '/user-verify/resend', {
                waitUntil: 'networkidle2',
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#email');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, 'input[name=email]');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await init.pageType(page, 'input[name=email]', 'invalid@email.com');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, 'button[type=submit]');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#error-msg');
            const html = await init.page$Eval(
                page,
                '#error-msg',
                (e: $TSFixMe) => {
                    return e.innerHTML;
                }
            );
            should.exist(html);
            html.should.containEql('No user associated with this account');
        },
        init.timeout
    );
});
