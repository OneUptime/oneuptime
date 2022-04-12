import puppeteer from 'puppeteer';

import utils from '../../test-utils';
import init from '../../test-init';
let browser: $TSFixMe, page: $TSFixMe;
import 'should';
const operationTimeOut = init.timeout;
const email = utils.generateRandomBusinessEmail();
const password = '1234567890';

const moveToSsoPage = async (page: $TSFixMe): void => {
    await init.pageWaitForSelector(page, '#settings', {
        visible: true,
        timeout: init.timeout,
    });

    await init.pageClick(page, '#settings');

    await init.pageWaitForSelector(page, '#sso');

    await init.pageClick(page, '#sso');
};

const createSso = async (page: $TSFixMe, data: $TSFixMe): void => {
    await init.pageWaitForSelector(page, '#add-sso', {
        visible: true,
        timeout: init.timeout,
    });

    await init.pageClick(page, '#add-sso');

    await init.pageWaitForSelector(page, '#save-button');

    if (data['saml-enabled'])
        await init.pageClick(page, '#saml-enabled-slider');

    await init.pageClick(page, '#domain');

    await init.pageType(page, '#domain', data.domain);

    await init.pageClick(page, '#entityId');

    await init.pageType(page, '#entityId', data.applicationId);

    await init.pageClick(page, '#remoteLoginUrl');

    await init.pageType(page, '#remoteLoginUrl', data.samlSsoUrl);

    await init.pageClick(page, '#certificateFingerprint');

    await init.pageType(
        page,
        '#certificateFingerprint',
        data.certificateFingerprint
    );

    await init.pageClick(page, '#remoteLogoutUrl');

    await init.pageType(page, '#remoteLogoutUrl', data.remoteLogoutUrl);

    await init.pageClick(page, '#ipRanges');

    await init.pageType(page, '#ipRanges', data.ipRanges);

    await init.pageClick(page, '#save-button');
    await init.pageWaitForSelector(page, '#save-button', { hidden: true });
};

describe('SSO login', () => {
    beforeAll(async (done: $TSFixMe) => {
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

    afterAll(async (done: $TSFixMe) => {
        await browser.close();
        done();
    });

    it(
        'Should return an error message if the domain is not defined in the database.',
        async (done: $TSFixMe) => {
            await page.goto(utils.ACCOUNTS_URL + '/login', {
                waitUntil: 'networkidle2',
            });

            await init.pageWaitForSelector(page, '#login-button');

            await init.pageClick(page, '#sso-login');

            await init.pageClick(page, 'input[name=email]');

            await init.pageType(
                page,
                'input[name=email]',
                'email@inexistent-domain.hackerbay.io'
            );
            await Promise.all([
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

    it(
        "Should return an error message if the SSO authentication is disabled for the email's domain.",
        async (done: $TSFixMe) => {
            await page.goto(utils.ACCOUNTS_URL + '/login', {
                waitUntil: 'networkidle2',
            });

            await init.pageWaitForSelector(page, '#login-button');

            await init.pageClick(page, '#sso-login');

            await init.pageClick(page, 'input[name=email]');

            await init.pageType(
                page,
                'input[name=email]',
                'email@disabled-domain.hackerbay.io'
            );
            await Promise.all([
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

    it(
        'Should redirects the user if the domain is defined in the database.',
        async (done: $TSFixMe) => {
            await page.goto(utils.ACCOUNTS_URL + '/login', {
                waitUntil: 'networkidle2',
            });

            await init.pageWaitForSelector(page, '#login-button');

            await init.pageClick(page, '#sso-login');

            await init.pageClick(page, 'input[name=email]');

            await init.pageType(
                page,
                'input[name=email]',
                'email@tests.hackerbay.io'
            );
            const [response] = await Promise.all([
                page.waitForNavigation('networkidle2'),

                init.pageClick(page, 'button[type=submit]'),
            ]);
            const chain = response.request().redirectChain();
            expect(chain.length).not.toBe(0);

            await init.pageClick(page, '#username');

            await init.pageType(page, '#username', 'user1');

            await init.pageClick(page, '#password');

            await init.pageType(page, '#password', 'user1pass');

            await Promise.all([
                page.waitForNavigation('networkidle2'),

                init.pageClick(page, 'button'),
            ]);

            done();
        },
        operationTimeOut
    );
});
