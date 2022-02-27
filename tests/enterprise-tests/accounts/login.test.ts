// @ts-expect-error ts-migrate(2307) FIXME: Cannot find module 'puppeteer' or its correspondin... Remove this comment to see the full error message
import puppeteer from 'puppeteer';

import utils from '../../test-utils';
import init from '../../test-init';
let browser: $TSFixMe, page: $TSFixMe;
require('should');
const operationTimeOut = init.timeout;
const email = utils.generateRandomBusinessEmail();
const password = '1234567890';

const moveToSsoPage = async (page: $TSFixMe) => {
    await init.pageWaitForSelector(page, '#settings', {
        visible: true,
        timeout: init.timeout,
    });
    // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
    await init.pageClick(page, '#settings');
    // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
    await init.pageWaitForSelector(page, '#sso');
    // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
    await init.pageClick(page, '#sso');
};

const createSso = async (page: $TSFixMe, data: $TSFixMe) => {
    await init.pageWaitForSelector(page, '#add-sso', {
        visible: true,
        timeout: init.timeout,
    });
    // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
    await init.pageClick(page, '#add-sso');
    // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
    await init.pageWaitForSelector(page, '#save-button');

    if (data['saml-enabled'])
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await init.pageClick(page, '#saml-enabled-slider');

    // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
    await init.pageClick(page, '#domain');
    // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
    await init.pageType(page, '#domain', data.domain);

    // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
    await init.pageClick(page, '#entityId');
    // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
    await init.pageType(page, '#entityId', data.applicationId);

    // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
    await init.pageClick(page, '#remoteLoginUrl');
    // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
    await init.pageType(page, '#remoteLoginUrl', data.samlSsoUrl);

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
    await init.pageWaitForSelector(page, '#save-button', { hidden: true });
};

// @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'describe'. Do you need to instal... Remove this comment to see the full error message
describe('SSO login', () => {
    // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'beforeAll'.
    beforeAll(async (done: $TSFixMe) => {
        // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'jest'.
        jest.setTimeout(init.timeout);

        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(utils.agent);

        const user = { email, password };
        await init.registerEnterpriseUser(user, page);
        await moveToSsoPage(page);
        await createSso(page, {
            'saml-enabled': false,
            applicationId: 'hackerbay.io',
            domain: `disabled-domain.hackerbay.io`,
            samlSsoUrl:
                'http://localhost:9876/simplesaml/saml2/idp/SSOService.php',
            certificateFingerprint: 'AZERTYUIOP',
            remoteLogoutUrl: 'http://localhost:9876/logout',
            ipRanges: '127.0.0.1',
        });
        await createSso(page, {
            'saml-enabled': true,
            domain: `tests.hackerbay.io`,
            applicationId: 'hackerbay.io',
            samlSsoUrl:
                'http://localhost:9876/simplesaml/saml2/idp/SSOService.php',
            certificateFingerprint: 'AZERTYUIOP',
            remoteLogoutUrl: 'http://localhost:9876/logout',
            ipRanges: '127.0.0.1',
        });
        await init.logout(page);

        done();
    });

    // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'afterAll'.
    afterAll(async (done: $TSFixMe) => {
        await browser.close();
        done();
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it(
        'Should return an error message if the domain is not defined in the database.',
        async (done: $TSFixMe) => {
            await page.goto(utils.ACCOUNTS_URL + '/login', {
                waitUntil: 'networkidle2',
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#login-button');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#sso-login');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, 'input[name=email]');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await init.pageType(
                page,
                'input[name=email]',
                'email@inexistent-domain.hackerbay.io'
            );
            await Promise.all([
                // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
                init.pageClick(page, 'button[type=submit]'),
                page.waitForResponse((response: $TSFixMe) =>
                    response.url().includes('/login')
                ),
            ]);
            const html = await init.page$Eval(
                page,
                '#main-body',
                (e: $TSFixMe) => e.innerHTML
            );
            html.should.containEql('Domain not found.');

            done();
        },
        operationTimeOut
    );

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it(
        "Should return an error message if the SSO authentication is disabled for the email's domain.",
        async (done: $TSFixMe) => {
            await page.goto(utils.ACCOUNTS_URL + '/login', {
                waitUntil: 'networkidle2',
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#login-button');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#sso-login');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, 'input[name=email]');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await init.pageType(
                page,
                'input[name=email]',
                'email@disabled-domain.hackerbay.io'
            );
            await Promise.all([
                // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
                init.pageClick(page, 'button[type=submit]'),
                page.waitForResponse((response: $TSFixMe) =>
                    response.url().includes('/login')
                ),
            ]);
            const html = await init.page$Eval(
                page,
                '#main-body',
                (e: $TSFixMe) => e.innerHTML
            );
            html.should.containEql('SSO disabled for this domain.');

            done();
        },
        operationTimeOut
    );

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it(
        'Should redirects the user if the domain is defined in the database.',
        async (done: $TSFixMe) => {
            await page.goto(utils.ACCOUNTS_URL + '/login', {
                waitUntil: 'networkidle2',
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#login-button');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#sso-login');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, 'input[name=email]');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await init.pageType(
                page,
                'input[name=email]',
                'email@tests.hackerbay.io'
            );
            const [response] = await Promise.all([
                page.waitForNavigation('networkidle2'),
                // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
                init.pageClick(page, 'button[type=submit]'),
            ]);
            const chain = response.request().redirectChain();
            expect(chain.length).not.toBe(0);

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#username');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await init.pageType(page, '#username', 'user1');

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#password');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await init.pageType(page, '#password', 'user1pass');

            await Promise.all([
                page.waitForNavigation('networkidle2'),
                // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
                init.pageClick(page, 'button'),
            ]);

            done();
        },
        operationTimeOut
    );
});
