// @ts-expect-error ts-migrate(2307) FIXME: Cannot find module 'puppeteer' or its correspondin... Remove this comment to see the full error message
import puppeteer from 'puppeteer'
import utils from '../../test-utils'
import init from '../../test-init'
let browser: $TSFixMe, page: $TSFixMe;

require('should');

// user credentials
const email = 'masteradmin@hackerbay.io';
const password = '1234567890';

const moveToSsoPage = async (page: $TSFixMe) => {
    // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
    await init.pageWaitForSelector(page, '#settings');
    // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
    await init.pageClick(page, '#settings');
    // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
    await init.pageWaitForSelector(page, '#sso');
    // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
    await init.pageClick(page, '#sso');
};

const createSso = async (page: $TSFixMe, data: $TSFixMe) => {
    // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
    await init.pageClick(page, '#add-sso');
    // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
    await init.pageWaitForSelector(page, '#save-button');

    // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
    await init.pageClick(page, '#domain');
    // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
    await init.pageType(page, '#domain', data.domain);

    // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
    await init.pageClick(page, '#entityId');
    // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
    await init.pageType(page, '#entityId', data.entityId);

    // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
    await init.pageClick(page, '#remoteLoginUrl');
    // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
    await init.pageType(page, '#remoteLoginUrl', data.remoteLoginUrl);

    // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
    await init.pageClick(page, '#certificateFingerprint');
    // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
    await init.pageType(
        page,
        '#certificateFingerprint',
        data.certificateFingerprint
    );

    // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
    await init.pageClick(page, '#remoteLogoutUrl');
    // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
    await init.pageType(page, '#remoteLogoutUrl', data.remoteLogoutUrl);

    // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
    await init.pageClick(page, '#ipRanges');
    // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
    await init.pageType(page, '#ipRanges', data.ipRanges);

    // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
    await init.pageClick(page, '#save-button');
};

// @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'describe'. Do you need to instal... Remove this comment to see the full error message
describe('SSO API', () => {
    const operationTimeOut = init.timeout;

    // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'afterAll'.
    afterAll(async (done: $TSFixMe) => {
        /**This takes care of the closing the browser when the test is complete */
        await browser.close();
        done();
    });

    // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'beforeAll'.
    beforeAll(async (done: $TSFixMe) => {
        // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'jest'.
        jest.setTimeout(init.timeout);

        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(utils.agent);

        const user = {
            email: email,
            password: password,
        };

        await init.loginAdminUser(user, page);

        done();
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test(
        'should add new SSO',
        async (done: $TSFixMe) => {
            /** Upon login, admin-dashboard is loaded */
            await moveToSsoPage(page);

            /**  With respect to admin-dashboard code refactoring,
             *  removal of UNDEFINED
             *  sso-count is only visible after an sso has been created*/

            // delete all previous SSO
            while (await init.isElementOnPage(page, '#delete-button')) {
                // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
                await init.pageWaitForSelector(page, '#delete-button');
                // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
                await init.pageClick(page, '#delete-button');
                // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
                await init.pageWaitForSelector(page, '#confirmDelete');
                // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
                await init.pageClick(page, '#confirmDelete');
                await page.reload({ waitUntil: 'networkidle2' });
            }

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#no-sso-message');

            await createSso(page, {
                domain: 'test.hackerbay.io',
                entityId: 'hackerbay.io', //Updated UI
                remoteLoginUrl: 'test.hackerbay.io/login',
                certificateFingerprint: 'AZERTYUIOP',
                remoteLogoutUrl: 'test.hackerbay.io/logout',
                ipRanges: '127.0.0.1',
            });

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#sso-domain');

            const ssoCountAfterCreation = await init.page$Eval(
                page,
                '#sso-count',
                (e: $TSFixMe) => {
                    return e.innerHTML;
                }
            );

            expect(ssoCountAfterCreation).toContain('1');

            const tbody = await init.page$Eval(page, 'tbody', (e: $TSFixMe) => {
                return e.innerHTML;
            });

            expect(tbody).toContain('test.hackerbay.io');

            done();
        },
        operationTimeOut
    );

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test(
        'should update existing SSO',
        async (done: $TSFixMe) => {
            /** No need for additional logout and login as it slows down testing
             * Testing is done in the same admin UI */

            await page.goto(utils.ADMIN_DASHBOARD_URL);
            await moveToSsoPage(page);

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#sso-count');

            const ssoCountAfterCreation = await init.page$Eval(
                page,
                '#sso-count',
                (e: $TSFixMe) => {
                    return e.innerHTML;
                }
            );

            expect(ssoCountAfterCreation).toContain('1');

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#edit-button');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#edit-button');

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#save-button');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#domain');
            await page.keyboard.down('Control');
            await page.keyboard.press('A');
            await page.keyboard.up('Control');
            await page.keyboard.press('Backspace');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await init.pageType(page, '#domain', 'updated.test.hackerbay.io');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#save-button');

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#sso-domain');

            const tbody = await init.page$Eval(page, 'tbody', (e: $TSFixMe) => {
                return e.innerHTML;
            });
            expect(tbody).toContain('updated.test.hackerbay.io');

            done();
        },
        operationTimeOut
    );

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test(
        'should delete existing SSO',
        async (done: $TSFixMe) => {
            await page.goto(utils.ADMIN_DASHBOARD_URL);
            await moveToSsoPage(page);

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#sso-count');

            const count = await init.page$Eval(page, '#sso-count', (e: $TSFixMe) => {
                return e.innerHTML;
            });

            expect(count).toContain('1');

            while (await init.isElementOnPage(page, '#delete-button')) {
                // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
                await init.pageWaitForSelector(page, '#delete-button');
                // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
                await init.pageClick(page, '#delete-button');
                // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
                await init.pageWaitForSelector(page, '#confirmDelete');
                // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
                await init.pageClick(page, '#confirmDelete');
                await page.reload({ waitUntil: 'networkidle2' });
            }

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            const ssoMessage = await init.pageWaitForSelector(
                page,
                '#no-sso-message'
            ); // 'No SSO created yet' is rendered when none is available
            expect(ssoMessage).toBeDefined();

            const ssoCountAfterDeletion = await init.pageWaitForSelector(
                page,
                '#sso-count',
                { hidden: true }
            );
            expect(ssoCountAfterDeletion).toBeNull();

            done();
        },
        operationTimeOut
    );

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it(
        'should enable Next/Previous buttons when there are more than 10 SSOs',
        async (done: $TSFixMe) => {
            await page.goto(utils.ADMIN_DASHBOARD_URL);
            await moveToSsoPage(page);
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#no-sso-message');

            for (let i = 0; i <= 11; i++) {
                await createSso(page, {
                    domain: `subdomain.${i}.test.hackerbay.io`,
                    entityId: 'hackerbay.io', //Updated UI
                    remoteLoginUrl: 'test.hackerbay.io/login',
                    certificateFingerprint: 'AZERTYUIOP',
                    remoteLogoutUrl: 'test.hackerbay.io/logout',
                    ipRanges: '127.0.0.1',
                });
            }

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#sso-domain');

            const ssoCount = await init.page$Eval(page, '#sso-count', (e: $TSFixMe) => {
                return e.innerHTML;
            });

            expect(ssoCount).toContain('12');

            const firstPageTbody = await init.page$Eval(page, 'tbody', (e: $TSFixMe) => {
                return e.innerHTML;
            });
            expect(firstPageTbody).toContain('subdomain.11.test.hackerbay.io');
            expect(firstPageTbody).toContain('subdomain.2.test.hackerbay.io');

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#next-button');

            const secondPageTbody = await init.page$Eval(page, 'tbody', (e: $TSFixMe) => {
                return e.innerHTML;
            });
            expect(secondPageTbody).toContain('subdomain.1.test.hackerbay.io');
            expect(secondPageTbody).toContain('subdomain.0.test.hackerbay.io');

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#previous-button');

            const initalPageTbody = await init.page$Eval(page, 'tbody', (e: $TSFixMe) => {
                return e.innerHTML;
            });

            expect(initalPageTbody).toContain('subdomain.11.test.hackerbay.io');
            expect(initalPageTbody).toContain('subdomain.2.test.hackerbay.io');

            done();
        },
        operationTimeOut
    );
});
