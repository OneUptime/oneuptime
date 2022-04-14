import puppeteer from 'puppeteer';

import should from 'should';
import utils from '../../test-utils';
import init from '../../test-init';

let browser: $TSFixMe;
let page: $TSFixMe;

const email = utils.generateRandomBusinessEmail();
const  password: string = '1234567890';
const user = {
    email,
    password,
};

describe('Reset Password API', () => {
    beforeAll(async () => {
        jest.setTimeout(15000);
        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(utils.agent);
    });

    afterAll(async () => {
        await browser.close();
    });

    it(
        'Should reset password successfully',
        async () => {
            await init.registerUser(user, page);
            await init.saasLogout(page);
            await page.goto(utils.ACCOUNTS_URL + '/forgot-password', {
                waitUntil: 'networkidle2',
            });

            await init.pageWaitForSelector(page, '#email');

            await init.pageClick(page, 'input[name=email]');

            await init.pageType(page, 'input[name=email]', email);

            await init.pageClick(page, 'button[type=submit]');

            await init.pageWaitForSelector(page, '#reset-password-success');
            const html = await init.page$Eval(
                page,
                '#reset-password-success',
                (e: $TSFixMe) => {
                    return e.innerHTML;
                }
            );
            should.exist(html);
            html.should.containEql(
                " An email is on its way to you. Follow the instructions to reset your password. Please don't forget to check spam. "
            );
        },
        init.timeout
    );

    it(
        'User cannot reset password with non-existing email',
        async () => {
            await page.goto(utils.ACCOUNTS_URL + '/forgot-password', {
                waitUntil: 'networkidle2',
            });

            await init.pageWaitForSelector(page, '#email');

            await init.pageClick(page, 'input[name=email]');

            await init.pageType(
                page,
                'input[name=email]',
                utils.generateWrongEmail()
            );

            await init.pageClick(page, 'button[type=submit]');

            await init.pageWaitForSelector(page, '#error-msg');
            const html = await init.page$Eval(
                page,
                '#error-msg',
                (e: $TSFixMe) => {
                    return e.innerHTML;
                }
            );
            should.exist(html);
            html.should.containEql('User does not exist.');
        },
        init.timeout
    );
});
