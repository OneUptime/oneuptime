// @ts-expect-error ts-migrate(2307) FIXME: Cannot find module 'puppeteer' or its correspondin... Remove this comment to see the full error message
import puppeteer from 'puppeteer'
// @ts-expect-error ts-migrate(2307) FIXME: Cannot find module 'should' or its corresponding t... Remove this comment to see the full error message
import should from 'should'
import utils from '../../test-utils'
import init from '../../test-init'

let browser: $TSFixMe, otherBrowser: $TSFixMe;
let page: $TSFixMe, otherPage: $TSFixMe;

const email = 'masteradmin@hackerbay.io';
const password = '1234567890';
const user = {
    email,
    password,
};

// @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'describe'. Do you need to instal... Remove this comment to see the full error message
describe('Enterprise Registration API', () => {
    // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'beforeAll'.
    beforeAll(async () => {
        // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'jest'.
        jest.setTimeout(15000);
        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        otherBrowser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        otherPage = await otherBrowser.newPage();
        await page.setUserAgent(utils.agent);
        await otherPage.setUserAgent(utils.agent);
    });

    // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'afterAll'.
    afterAll(async () => {
        await browser.close();
        await otherBrowser.close();
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it(
        'Should register Initial User with valid details',
        async () => {
            await init.registerEnterpriseUser(user, page);

            const localStorageData = await page.evaluate(() => {
                const json = {};
                for (let i = 0; i < localStorage.length; i++) {
                    const key = localStorage.key(i);
                    // @ts-expect-error ts-migrate(2538) FIXME: Type 'null' cannot be used as an index type.
                    json[key] = localStorage.getItem(key);
                }
                return json;
            });

            localStorageData.should.have.property('access_token');
            localStorageData.should.have.property('email', email);
            page.url().should.containEql(utils.ADMIN_DASHBOARD_URL);
        },
        init.timeout
    );

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it(
        'Should redirect to Login Page and hide Sign Up Link for Subsequent Users',
        async () => {
            try {
                await otherPage.goto(utils.ACCOUNTS_URL + '/register', {
                    waitUntil: 'networkidle2',
                });
            } catch (e) {
                //
            }
            await otherPage.waitForTimeout(5000);
            otherPage
                .url()
                .should.containEql(utils.ACCOUNTS_URL + '/accounts/login');

            const signUp = await otherPage.$('#signUpLink');
            should.not.exist(signUp);
        },
        init.timeout
    );

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it(
        'Should login Initial User to Admin Dashboard',
        async () => {
            await init.loginAdminUser(user, otherPage);

            const localStorageData = await otherPage.evaluate(() => {
                const json = {};
                for (let i = 0; i < localStorage.length; i++) {
                    const key = localStorage.key(i);
                    // @ts-expect-error ts-migrate(2538) FIXME: Type 'null' cannot be used as an index type.
                    json[key] = localStorage.getItem(key);
                }
                return json;
            });

            await otherPage.waitForTimeout(10000);
            localStorageData.should.have.property('access_token');
            localStorageData.should.have.property('email', email);
            otherPage.url().should.containEql(utils.ADMIN_DASHBOARD_URL);
        },
        init.timeout
    );
});
