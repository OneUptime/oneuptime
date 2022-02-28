import utils from './test-utils';
import chai from 'chai';
import chaihttp from 'chai-http';
chai.use(chaihttp);
// @ts-expect-error ts-migrate(2339) FIXME: Property 'request' does not exist on type 'ChaiSta... Remove this comment to see the full error message
const request = chai.request(utils.BACKEND_URL);

const _this = {
    /**
     *
     * @param { ObjectConstructor } user
     * @param { string } page
     * @description Registers a new user.
     * @returns { void }
     */

    timeout: 180000, // 3 mins. If things take longer than 3 mins. We consider it a failure. Please do not add your custom timeout.
    registerUser: async function(user: $TSFixMe, page: $TSFixMe) {
        if (
            utils.BACKEND_URL.includes('localhost') ||
            utils.BACKEND_URL.includes('staging.oneuptime.com') ||
            utils.BACKEND_URL.includes('staging.oneuptime.com')
        ) {
            const { email } = user;
            let frame, elementHandle;
            await page.goto(utils.ACCOUNTS_URL + '/register', {
                waitUntil: 'networkidle2',
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await _this.pageWaitForSelector(page, '#email');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await _this.pageClick(page, 'input[name=email]');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await _this.pageType(page, 'input[name=email]', email);
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await _this.pageClick(page, 'input[name=name]');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await _this.pageType(page, 'input[name=name]', 'Test Name');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await _this.pageClick(page, 'input[name=companyName]');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await _this.pageType(page, 'input[name=companyName]', 'Test Name');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await _this.pageClick(page, 'input[name=companyPhoneNumber]');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await _this.pageType(
                page,
                'input[name=companyPhoneNumber]',
                '99105688'
            );
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await _this.pageClick(page, 'input[name=password]');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await _this.pageType(page, 'input[name=password]', '1234567890');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await _this.pageClick(page, 'input[name=confirmPassword]');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await _this.pageType(
                page,
                'input[name=confirmPassword]',
                '1234567890'
            );

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await _this.pageClick(page, 'button[type=submit]');
            await _this.pageWaitForSelector(page, `form#card-form`, {
                visible: true,
                timeout: _this.timeout,
            });

            await _this.pageWaitForSelector(
                page,
                '.__PrivateStripeElement > iframe',
                {
                    visible: true,
                    timeout: _this.timeout,
                }
            );
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            const stripeIframeElements = await _this.page$$(
                page,
                '.__PrivateStripeElement > iframe'
            );

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await _this.pageClick(page, 'input[name=cardName]');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await _this.pageType(page, 'input[name=cardName]', 'Test name');

            elementHandle = stripeIframeElements[0]; // card element
            frame = await elementHandle.contentFrame();
            await frame.waitForSelector('input[name=cardnumber]');
            await frame.type('input[name=cardnumber]', '42424242424242424242', {
                delay: 200,
            });

            elementHandle = stripeIframeElements[1]; // cvc element
            frame = await elementHandle.contentFrame();
            await frame.waitForSelector('input[name=cvc]');
            await frame.type('input[name=cvc]', '123', {
                delay: 50,
            });

            elementHandle = stripeIframeElements[2]; // exp element
            frame = await elementHandle.contentFrame();
            await frame.waitForSelector('input[name=exp-date]');
            await frame.type('input[name=exp-date]', '11/23', {
                delay: 50,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await _this.pageClick(page, 'input[name=address1]');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await _this.pageType(
                page,
                'input[name=address1]',
                utils.user.address.streetA
            );
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await _this.pageClick(page, 'input[name=address2]');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await _this.pageType(
                page,
                'input[name=address2]',
                utils.user.address.streetB
            );
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await _this.pageClick(page, 'input[name=city]');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await _this.pageType(
                page,
                'input[name=city]',
                utils.user.address.city
            );
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await _this.pageClick(page, 'input[name=state]');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await _this.pageType(
                page,
                'input[name=state]',
                utils.user.address.state
            );
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await _this.pageClick(page, 'input[name=zipCode]');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await _this.pageType(
                page,
                'input[name=zipCode]',
                utils.user.address.zipcode
            );
            await page.select('#country', 'India');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await _this.pageClick(page, 'button[type=submit]');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            const home = await _this.pageWaitForSelector(page, '#profile-menu');
            expect(home).toBeDefined(); // This ensures that we have been navigated to the dashboard page

            const signupResponse = await page.waitForResponse(
                (response: $TSFixMe) => response.status() === 200
                // The page navigates however '/user/signup' is not strictly included in the response.
            );
            if (signupResponse._status !== 200) {
                throw new Error('Sign up did not return 200');
            }
        }
    },
    registerFailedUser: async function(user: $TSFixMe, page: $TSFixMe) {
        if (
            utils.BACKEND_URL.includes('localhost') ||
            utils.BACKEND_URL.includes('staging.oneuptime.com') ||
            utils.BACKEND_URL.includes('staging.oneuptime.com')
        ) {
            const { email } = user;
            let frame, elementHandle;
            await page.goto(utils.ACCOUNTS_URL + '/register', {
                waitUntil: 'networkidle2',
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await _this.pageWaitForSelector(page, '#email');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await _this.pageClick(page, 'input[name=email]');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await _this.pageType(page, 'input[name=email]', email);
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await _this.pageClick(page, 'input[name=name]');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await _this.pageType(page, 'input[name=name]', 'Test Name');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await _this.pageClick(page, 'input[name=companyName]');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await _this.pageType(page, 'input[name=companyName]', 'Test Name');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await _this.pageClick(page, 'input[name=companyPhoneNumber]');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await _this.pageType(
                page,
                'input[name=companyPhoneNumber]',
                '99105688'
            );
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await _this.pageClick(page, 'input[name=password]');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await _this.pageType(page, 'input[name=password]', '1234567890');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await _this.pageClick(page, 'input[name=confirmPassword]');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await _this.pageType(
                page,
                'input[name=confirmPassword]',
                '1234567890'
            );

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await _this.pageClick(page, 'button[type=submit]');
            await _this.pageWaitForSelector(page, `form#card-form`, {
                visible: true,
                timeout: _this.timeout,
            });

            await _this.pageWaitForSelector(
                page,
                '.__PrivateStripeElement > iframe',
                {
                    visible: true,
                    timeout: _this.timeout,
                }
            );
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            const stripeIframeElements = await _this.page$$(
                page,
                '.__PrivateStripeElement > iframe'
            );

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await _this.pageClick(page, 'input[name=cardName]');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await _this.pageType(page, 'input[name=cardName]', 'Test name');

            elementHandle = stripeIframeElements[0]; // card element
            frame = await elementHandle.contentFrame();
            await frame.waitForSelector('input[name=cardnumber]');
            await frame.type('input[name=cardnumber]', '42424242424242424242', {
                delay: 200,
            });

            elementHandle = stripeIframeElements[1]; // cvc element
            frame = await elementHandle.contentFrame();
            await frame.waitForSelector('input[name=cvc]');
            await frame.type('input[name=cvc]', '123', {
                delay: 50,
            });

            elementHandle = stripeIframeElements[2]; // exp element
            frame = await elementHandle.contentFrame();
            await frame.waitForSelector('input[name=exp-date]');
            await frame.type('input[name=exp-date]', '11/23', {
                delay: 50,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await _this.pageClick(page, 'input[name=address1]');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await _this.pageType(
                page,
                'input[name=address1]',
                utils.user.address.streetA
            );
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await _this.pageClick(page, 'input[name=address2]');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await _this.pageType(
                page,
                'input[name=address2]',
                utils.user.address.streetB
            );
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await _this.pageClick(page, 'input[name=city]');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await _this.pageType(
                page,
                'input[name=city]',
                utils.user.address.city
            );
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await _this.pageClick(page, 'input[name=state]');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await _this.pageType(
                page,
                'input[name=state]',
                utils.user.address.state
            );
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await _this.pageClick(page, 'input[name=zipCode]');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await _this.pageType(
                page,
                'input[name=zipCode]',
                utils.user.address.zipcode
            );
            await page.select('#country', 'India');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await _this.pageClick(page, 'button[type=submit]');
        }
    },
    loginProjectViewer: async function(user: $TSFixMe, page: $TSFixMe) {
        const { email, password } =
            utils.BACKEND_URL.includes('localhost') ||
            utils.BACKEND_URL.includes('staging')
                ? user
                : {
                      email: 'user@oneuptime.com',
                      password: 'mVzkm{LAP)mNC8t23ehqifb2p',
                  };
        await page.goto(utils.ACCOUNTS_URL + '/login', {
            waitUntil: 'networkidle2',
        });
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageWaitForSelector(page, '#login-button');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, 'input[name=email]');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
        await _this.pageType(page, 'input[name=email]', email);
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, 'input[name=password]');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
        await _this.pageType(page, 'input[name=password]', password);
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, 'button[type=submit]');
    },
    loginUser: async function(user: $TSFixMe, page: $TSFixMe) {
        const { email, password } =
            utils.BACKEND_URL.includes('localhost') ||
            utils.BACKEND_URL.includes('staging')
                ? user
                : {
                      email: 'user@oneuptime.com',
                      password: 'mVzkm{LAP)mNC8t23ehqifb2p',
                  };
        await page.goto(utils.ACCOUNTS_URL + '/login', {
            waitUntil: 'networkidle2',
        });
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageWaitForSelector(page, '#login-button');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, 'input[name=email]');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
        await _this.pageType(page, 'input[name=email]', email);
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, 'input[name=password]');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
        await _this.pageType(page, 'input[name=password]', password);
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, 'button[type=submit]');

        await _this.pageWaitForSelector(page, '#home', {
            visible: true,
            timeout: _this.timeout,
        });
    },
    loginAdminUser: async function(user: $TSFixMe, page: $TSFixMe) {
        const { email, password } = user;
        await page.goto(utils.ACCOUNTS_URL + '/login', {
            waitUntil: 'networkidle2',
        });
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageWaitForSelector(page, '#login-button');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, 'input[name=email]');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
        await _this.pageType(page, 'input[name=email]', email);
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, 'input[name=password]');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
        await _this.pageType(page, 'input[name=password]', password);
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, 'button[type=submit]');

        await _this.pageWaitForSelector(page, '#users', {
            visible: true,
            timeout: _this.timeout,
        });

        return;
    },
    testSmptSettings: async function(page: $TSFixMe, email: $TSFixMe) {
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageWaitForSelector(page, '#settings');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, '#settings');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageWaitForSelector(page, '#smtp');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, '#smtp');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageWaitForSelector(page, '#testSmtpSettingsButton');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, '#testSmtpSettingsButton');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageWaitForSelector(page, '#testEmail');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
        await _this.pageType(page, '#testEmail', email);
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageWaitForSelector(page, '#customSmtpBtn');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, '#customSmtpBtn');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageWaitForSelector(page, '#confirmSmtpTest');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, '#confirmSmtpTest');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageWaitForSelector(page, '#confirmDelete');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, '#confirmDelete');
    },
    addEmailCredentials: async function(page: $TSFixMe, email: $TSFixMe) {
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageWaitForSelector(page, '#settings');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, '#settings');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageWaitForSelector(page, '#smtp');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, '#smtp');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageWaitForSelector(page, '#email-enabled');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, '#email-enabled');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageWaitForSelector(page, '#customSmtp');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, '#customSmtp');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageWaitForSelector(page, '#email');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, 'input[name=email]');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
        await _this.pageType(
            page,
            'input[name=email]',
            utils.smtpCredential.user
        );
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, 'input[name=password]');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
        await _this.pageType(
            page,
            'input[name=password]',
            utils.smtpCredential.pass
        );
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, 'input[name=smtp-server]');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
        await _this.pageType(
            page,
            'input[name=smtp-server]',
            utils.smtpCredential.host
        );

        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, 'input[name=smtp-port]');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
        await _this.pageType(
            page,
            'input[name=smtp-port]',
            utils.smtpCredential.port
        );

        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, 'input[name=from]');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
        await _this.pageType(
            page,
            'input[name=from]',
            utils.smtpCredential.from
        );

        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, 'input[name=from-name]');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
        await _this.pageType(page, 'input[name=from-name]', 'Hackerbay');

        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageWaitForSelector(page, '#label_smpt_secure');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, '#label_smpt_secure');

        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageWaitForSelector(page, 'button[type=submit]');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, 'button[type=submit]');

        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageWaitForSelector(page, '#testSmtpSettingsButton');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, '#testSmtpSettingsButton');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageWaitForSelector(page, '#testEmail');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
        await _this.pageType(page, '#testEmail', email);
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageWaitForSelector(page, '#customSmtpBtn');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, '#customSmtpBtn');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageWaitForSelector(page, '#confirmSmtpTest');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, '#confirmSmtpTest');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageWaitForSelector(page, '#confirmDelete');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, '#confirmDelete');
    },
    registerEnterpriseUser: async function(user: $TSFixMe, page: $TSFixMe) {
        const masterAdmin = {
            email: 'masteradmin@hackerbay.io',
            password: '1234567890',
        };
        await page.goto(utils.ACCOUNTS_URL + '/login', {
            waitUntil: 'networkidle2',
        });
        const signUp = await _this.isElementOnPage(page, '#signUpLink');

        if (signUp) {
            await page.goto(utils.ACCOUNTS_URL + '/register', {
                waitUntil: 'networkidle2',
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await _this.pageWaitForSelector(page, '#email');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await _this.pageClick(page, 'input[name=email]');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await _this.pageType(page, 'input[name=email]', masterAdmin.email);
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await _this.pageClick(page, 'input[name=name]');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await _this.pageType(page, 'input[name=name]', 'Master Admin');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await _this.pageClick(page, 'input[name=companyName]');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await _this.pageType(page, 'input[name=companyName]', 'Master');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await _this.pageClick(page, 'input[name=companyPhoneNumber]');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await _this.pageType(
                page,
                'input[name=companyPhoneNumber]',
                '99105688'
            );
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await _this.pageClick(page, 'input[name=password]');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await _this.pageType(page, 'input[name=password]', '1234567890');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await _this.pageClick(page, 'input[name=confirmPassword]');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await _this.pageType(
                page,
                'input[name=confirmPassword]',
                '1234567890'
            );
            await Promise.all([
                // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
                _this.pageClick(page, 'button[type=submit]'),
                page.waitForSelector('#users', {
                    visible: true,
                    timeout: _this.timeout,
                }),
            ]);
        } else {
            await _this.loginAdminUser(masterAdmin, page);
        }
        // create the user from admin dashboard
        //await _this.loginAdminUser(masterAdmin, page);
        const { email } = user;
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageWaitForSelector(page, '#add_user');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, '#add_user');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageWaitForSelector(page, '#email');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, 'input[name=email]');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
        await _this.pageType(page, 'input[name=email]', email);
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, 'input[name=name]');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
        await _this.pageType(page, 'input[name=name]', 'Test Name');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, 'input[name=companyName]');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
        await _this.pageType(page, 'input[name=companyName]', 'Test Name');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, 'input[name=companyPhoneNumber]');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
        await _this.pageType(
            page,
            'input[name=companyPhoneNumber]',
            '99105688'
        );
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, 'input[name=password]');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
        await _this.pageType(page, 'input[name=password]', '1234567890');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, 'input[name=confirmPassword]');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
        await _this.pageType(page, 'input[name=confirmPassword]', '1234567890');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, 'button[type=submit]');
        try {
            const signupResponse = await page.waitForResponse(
                (response: $TSFixMe) =>
                    response.url().includes('/user/signup') &&
                    response.status() === 200
            );
            if (signupResponse) {
                const signupData = await signupResponse.text();
                const parsedSignupData = JSON.parse(signupData);
                if (parsedSignupData.verificationToken) {
                    await request
                        .get(
                            `/user/confirmation/${parsedSignupData.verificationToken}`
                        )
                        .redirects(0);
                }
            }
        } catch (error) {
            //catch
        }
    },
    logout: async function(page: $TSFixMe) {
        await page.goto(utils.ADMIN_DASHBOARD_URL, {
            waitUntil: ['networkidle2'],
        });
        await _this.pageWaitForSelector(page, 'button#profile-menu', {
            visible: true,
            timeout: _this.timeout,
        });
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, 'button#profile-menu');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageWaitForSelector(page, 'button#logout-button');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, 'button#logout-button');
        await page.reload();
    },
    saasLogout: async function(page: $TSFixMe) {
        await page.goto(utils.DASHBOARD_URL, { waitUntil: ['networkidle2'] });
        await _this.pageWaitForSelector(page, 'button#profile-menu', {
            visible: true,
            timeout: _this.timeout,
        });
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, 'button#profile-menu');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageWaitForSelector(page, 'button#logout-button');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, 'button#logout-button');
        await page.reload({ waitUntil: 'networkidle2' });
    },
    selectDropdownValue: async function(
        selector: $TSFixMe,
        text: $TSFixMe,
        page: $TSFixMe
    ) {
        await _this.pageClick(page, selector, { delay: 100 });
        await page.keyboard.type(text);
        //'div.css-1gl4k7y' is used if present. However, it presence is not consistent
        await page.keyboard.press('Tab'); //String.fromCharCode(9) could not press tab
    },
    clear: async function(selector: $TSFixMe, page: $TSFixMe) {
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        const input = await _this.page$(page, selector);
        await input.click({ clickCount: 3 });
        await input.type('');
    },
    renameProject: async function(newProjectName: $TSFixMe, page: $TSFixMe) {
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageWaitForSelector(page, '#projectSettings');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClickNavigate(page, '#projectSettings');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageWaitForSelector(page, 'input[name=project_name]');
        await _this.clear('input[name=project_name]', page);
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
        await _this.pageType(page, 'input[name=project_name]', newProjectName);
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, '#btnCreateProject');
    },
    addMonitor: async function(
        monitorName: $TSFixMe,
        description: $TSFixMe,
        page: $TSFixMe
    ) {
        await _this.pageWaitForSelector(page, '#form-new-monitor', {
            visible: true,
            timeout: _this.timeout,
        });
        await _this.pageWaitForSelector(page, 'input[id=name]', {
            visible: true,
            timeout: _this.timeout,
        });
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, 'input[id=name]');
        await page.focus('input[id=name]');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
        await _this.pageType(page, 'input[id=name]', monitorName);
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, '[data-testId=type_manual]');
        await _this.pageWaitForSelector(page, '#description', {
            visible: true,
            timeout: _this.timeout,
        });
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, '#description');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
        await _this.pageType(page, '#description', description);
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClickNavigate(page, 'button[type=submit]');
        await _this.pageWaitForSelector(page, `#cb${monitorName}`, {
            visible: true,
            timeout: _this.timeout,
        });
    },
    addAdditionalMonitor: async function(
        monitorName: $TSFixMe,
        description: $TSFixMe,
        page: $TSFixMe
    ) {
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageWaitForSelector(page, '#cbMonitors');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, '#newFormId');
        await _this.pageWaitForSelector(page, '#form-new-monitor', {
            visible: true,
            timeout: _this.timeout,
        });
        await _this.pageWaitForSelector(page, 'input[id=name]', {
            visible: true,
            timeout: _this.timeout,
        });
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, 'input[id=name]');
        await page.focus('input[id=name]');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
        await _this.pageType(page, 'input[id=name]', monitorName);
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, '[data-testId=type_manual]');
        await _this.pageWaitForSelector(page, '#description', {
            visible: true,
            timeout: _this.timeout,
        });
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, '#description');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
        await _this.pageType(page, '#description', description);
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClickNavigate(page, 'button[type=submit]');
        await _this.pageWaitForSelector(page, `#cb${monitorName}`, {
            visible: true,
            timeout: _this.timeout,
        });
    },
    navigateToComponentDetails: async function(
        component: $TSFixMe,
        page: $TSFixMe
    ) {
        // Navigate to Components page
        await page.goto(utils.DASHBOARD_URL, { waitUntil: ['networkidle2'] });
        await _this.pageWaitForSelector(page, '#components', {
            visible: true,
            timeout: _this.timeout,
        });
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClickNavigate(page, '#components');

        // Navigate to details page of component assumed created
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageWaitForSelector(page, `#more-details-${component}`);
        await _this.page$Eval(
            page,
            `#more-details-${component}`,
            (e: $TSFixMe) => e.click()
        );
    },
    addMonitorToStatusPage: async function(
        componentName: $TSFixMe,
        monitorName: $TSFixMe,
        additionalMonitor: $TSFixMe,
        page: $TSFixMe
    ) {
        await page.goto(utils.DASHBOARD_URL, { waitUntil: ['networkidle2'] });
        const description = utils.generateRandomString();
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageWaitForSelector(page, '#statusPages');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClickNavigate(page, '#statusPages');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageWaitForSelector(page, '#statusPagesListContainer');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageWaitForSelector(page, '#viewStatusPage');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClickNavigate(page, '#viewStatusPage');
        await _this.pageWaitForSelector(page, '#addMoreMonitors', {
            visible: true,
            timeout: _this.timeout,
        });
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, '#addMoreMonitors');
        await _this.selectDropdownValue(
            `#monitor-name-${additionalMonitor}`,
            `${componentName} / ${monitorName}`,
            page
        );
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(
            page,
            `#monitor-description-${additionalMonitor}`
        );
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
        await _this.pageType(
            page,
            `#monitor-description-${additionalMonitor}`,
            description
        );
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(
            page,
            `#manual-monitor-checkbox-${additionalMonitor}`
        );
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, '#btnAddStatusPageMonitors');
    },
    clickStatusPageUrl: async function(page: $TSFixMe) {
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageWaitForSelector(page, '#publicStatusPageUrl');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        let link = await _this.page$(page, '#publicStatusPageUrl > span > a');
        link = await link.getProperty('href');
        link = await link.jsonValue();
        await page.goto(link, { waitUntil: ['networkidle2'] });
    },
    navigateToStatusPage: async function(page: $TSFixMe) {
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageWaitForSelector(page, '#statusPages');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClickNavigate(page, '#statusPages');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageWaitForSelector(page, '#statusPagesListContainer');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageWaitForSelector(page, '#viewStatusPage');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClickNavigate(page, '#viewStatusPage');
        await _this.clickStatusPageUrl(page);
    },
    growthPlanUpgrade: async function(page: $TSFixMe) {
        await page.goto(utils.DASHBOARD_URL, { waitUntil: ['networkidle2'] });
        await _this.pageWaitForSelector(page, '#projectSettings', {
            visible: true,
            timeout: _this.timeout,
        });
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClickNavigate(page, '#projectSettings');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageWaitForSelector(page, '#billing');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClickNavigate(page, '#billing');
        await _this.pageWaitForSelector(page, 'input#Growth_month', {
            visible: true,
        });
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, 'input#Growth_month');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, '#changePlanBtn');
        await _this.pageWaitForSelector(page, '.ball-beat', { hidden: true });
    },
    gotoTab: async function(tabId: $TSFixMe, page: $TSFixMe) {
        await _this.pageWaitForSelector(page, `#react-tabs-${tabId}`, {
            visible: true,
            timeout: _this.timeout,
        });
        await _this.page$Eval(page, `#react-tabs-${tabId}`, (e: $TSFixMe) =>
            e.click()
        );
    },
    themeNavigationAndConfirmation: async function(
        page: $TSFixMe,
        theme: $TSFixMe
    ) {
        await _this.pageWaitForSelector(page, '.branding-tab', {
            visible: true,
        });
        await _this.page$$Eval(page, '.branding-tab', (elems: $TSFixMe) =>
            elems[0].click()
        );
        await _this.pageWaitForSelector(page, `#${theme}`, {
            visible: true,
            timeout: _this.timeout,
        });
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, `#${theme}`);
        await _this.pageWaitForSelector(page, '#changePlanBtn', {
            visible: true,
            timeout: _this.timeout,
        });
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, '#changePlanBtn');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, '.basic-tab');
    },
    registerAndLoggingTeamMember: async function(
        user: $TSFixMe,
        page: $TSFixMe
    ) {
        const { email, password } = user;
        await page.goto(utils.ACCOUNTS_URL + '/register'),
            {
                waitUntil: 'networkidle2',
            };
        // Registration
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageWaitForSelector(page, '#email');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, 'input[name=email]');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
        await _this.pageType(page, 'input[name=email]', email);
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, 'input[name=name]');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
        await _this.pageType(page, 'input[name=name]', 'Test Name');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, 'input[name=companyName]');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
        await _this.pageType(page, 'input[name=companyName]', 'Test Name');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, 'input[name=companyPhoneNumber]');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
        await _this.pageType(
            page,
            'input[name=companyPhoneNumber]',
            '99105688'
        );
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, 'input[name=password]');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
        await _this.pageType(page, 'input[name=password]', password);
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, 'input[name=confirmPassword]');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
        await _this.pageType(page, 'input[name=confirmPassword]', password);
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, 'button[type=submit]'),
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await _this.pageWaitForSelector(page, '#success-step');

        // Login
        await page.goto(utils.ACCOUNTS_URL + '/login', {
            waitUntil: 'networkidle2',
        });
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageWaitForSelector(page, '#login-form');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, 'input[name=email]');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
        await _this.pageType(page, 'input[name=email]', email);
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, 'input[name=password]');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
        await _this.pageType(page, 'input[name=password]', password);
        await _this.pageWaitForSelector(page, 'button[type=submit]', {
            visible: true,
            timeout: _this.timeout,
        });
        await Promise.all([
            page.waitForNavigation({ waitUntil: 'networkidle2' }),
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            _this.pageClick(page, 'button[type=submit]'),
        ]);
        expect(page.url().startsWith(utils.ACCOUNTS_URL + '/login')).toEqual(
            false
        );
    },

    adminLogout: async function(page: $TSFixMe) {
        await page.goto(utils.ADMIN_DASHBOARD_URL, {
            waitUntil: ['networkidle2'],
        });
        await _this.pageWaitForSelector(page, 'button#profile-menu', {
            visible: true,
            timeout: _this.timeout,
        });
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, 'button#profile-menu');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageWaitForSelector(page, 'button#logout-button');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, 'button#logout-button');
        await page.reload({ waitUntil: 'networkidle2' });
    },
    addComponent: async function(
        component: $TSFixMe,
        page: $TSFixMe,
        projectName = null
    ) {
        await page.goto(utils.DASHBOARD_URL, { waitUntil: ['networkidle2'] });
        await _this.pageWaitForSelector(page, '#components', {
            visible: true,
            timeout: _this.timeout,
        });
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClickNavigate(page, '#components');

        // Fill and submit New Component form
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageWaitForSelector(page, '#form-new-component');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, 'input[id=name]');
        await page.focus('input[id=name]');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
        await _this.pageType(page, 'input[id=name]', component);

        if (projectName) {
            await _this.selectDropdownValue('#subProjectId', projectName, page);
        }

        await Promise.all([
            page.$eval('button[type=submit]', (e: $TSFixMe) => e.click()),
            page.waitForNavigation(),
        ]);
    },
    addAdditionalComponent: async function(
        component: $TSFixMe,
        page: $TSFixMe,
        projectName = null
    ) {
        await page.goto(utils.DASHBOARD_URL, { waitUntil: ['networkidle2'] });
        await _this.pageWaitForSelector(page, '#components', {
            visible: true,
            timeout: _this.timeout,
        });
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClickNavigate(page, '#components');

        // Fill and submit New Component form
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageWaitForSelector(page, '#cbComponents');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, '#newFormId');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageWaitForSelector(page, '#form-new-component');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, 'input[id=name]');
        await page.focus('input[id=name]');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
        await _this.pageType(page, 'input[id=name]', component);

        if (projectName) {
            await _this.selectDropdownValue('#subProjectId', projectName, page);
        }

        await Promise.all([
            page.$eval('button[type=submit]', (e: $TSFixMe) => e.click()),
            page.waitForNavigation(),
        ]);
    },

    navigateToMonitorDetails: async function(
        component: $TSFixMe,
        monitor: $TSFixMe,
        page: $TSFixMe
    ) {
        // Navigate to Components page
        await _this.navigateToComponentDetails(component, page);

        // Navigate to details page of monitor assumed created
        // await _this.pageClickNavigate(page, `#more-details-${monitor}`);
        await _this.pageWaitForSelector(page, `#more-details-${monitor}`, {
            visible: true,
            timeout: _this.timeout,
        });
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, `#more-details-${monitor}`);

        await _this.pageWaitForSelector(page, `#monitor-title-${monitor}`, {
            visible: true,
        });
    },
    navigateToApplicationLogDetails: async function(
        component: $TSFixMe,
        applicationLog: $TSFixMe,
        page: $TSFixMe
    ) {
        // Navigate to Components page
        await _this.navigateToComponentDetails(component, page);

        // then goto list of log containers
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageWaitForSelector(page, '#logs');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClickNavigate(page, '#logs');

        // Navigate to details page of log container assumed created
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageWaitForSelector(
            page,
            `#more-details-${applicationLog}`
        );
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClickNavigate(page, `#more-details-${applicationLog}`);
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageWaitForSelector(
            page,
            `#application-log-title-${applicationLog}`
        );
    },
    navigateToErrorTrackerDetails: async function(
        component: $TSFixMe,
        errorTracker: $TSFixMe,
        page: $TSFixMe
    ) {
        // Navigate to Components page
        await _this.navigateToComponentDetails(component, page);

        // then goto list of error trackers
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageWaitForSelector(page, '#errorTracking');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClickNavigate(page, '#errorTracking');

        // Navigate to details page of error tracker assumed created
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageWaitForSelector(page, `#more-details-${errorTracker}`);
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClickNavigate(page, `#more-details-${errorTracker}`);
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageWaitForSelector(
            page,
            `#error-tracker-title-${errorTracker}`
        );
    },

    createUserFromAdminDashboard: async function(
        user: $TSFixMe,
        page: $TSFixMe
    ) {
        // create the user from admin dashboard
        const { email } = user;
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageWaitForSelector(page, '#add_user');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, '#add_user');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageWaitForSelector(page, '#email');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, 'input[name=email]');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
        await _this.pageType(page, 'input[name=email]', email);
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, 'input[name=name]');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
        await _this.pageType(page, 'input[name=name]', 'Test Name');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, 'input[name=companyName]');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
        await _this.pageType(page, 'input[name=companyName]', 'Test Name');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, 'input[name=companyPhoneNumber]');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
        await _this.pageType(
            page,
            'input[name=companyPhoneNumber]',
            '99105688'
        );
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, 'input[name=password]');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
        await _this.pageType(page, 'input[name=password]', '1234567890');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, 'input[name=confirmPassword]');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
        await _this.pageType(page, 'input[name=confirmPassword]', '1234567890');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, 'button[type=submit]');
        await _this.pageWaitForSelector(page, '#frmUser', { hidden: true });
    },
    addSchedule: async function(
        callSchedule: $TSFixMe,
        projectName: $TSFixMe,
        page: $TSFixMe
    ) {
        await page.goto(utils.DASHBOARD_URL, {
            waitUntil: ['networkidle2'],
        });
        await _this.pageWaitForSelector(page, '#onCallDuty', {
            visible: true,
        });
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClickNavigate(page, '#onCallDuty');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, `#btnCreateSchedule_${projectName}`);
        page.waitForSelector('#name', { timeout: _this.timeout });
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
        await _this.pageType(page, '#name', callSchedule);
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, '#btnCreateSchedule');
        await _this.pageWaitForSelector(page, `#duty_${callSchedule}`, {
            visible: true,
            timeout: _this.timeout,
        });
    },
    addSubProject: async function(subProjectName: $TSFixMe, page: $TSFixMe) {
        const subProjectNameSelector = await _this.isElementOnPage(
            page,
            '#btn_Add_SubProjects',
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 2 arguments, but got 3.
            { hidden: true } //The function is usually called after dashboard loads. Hence, '#btn_Add_SubProjects' is hidden.
        );
        if (subProjectNameSelector) {
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await _this.pageWaitForSelector(page, '#btn_Add_SubProjects');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await _this.pageClick(page, '#btn_Add_SubProjects');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await _this.pageWaitForSelector(page, '#title');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await _this.pageType(page, '#title', subProjectName);
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await _this.pageClick(page, '#btnAddSubProjects');
        } else {
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await _this.pageWaitForSelector(page, '#projectSettings');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await _this.pageClickNavigate(page, '#projectSettings');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await _this.pageWaitForSelector(page, '#btn_Add_SubProjects');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await _this.pageClick(page, '#btn_Add_SubProjects');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await _this.pageWaitForSelector(page, '#title');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await _this.pageType(page, '#title', subProjectName);
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await _this.pageClick(page, '#btnAddSubProjects');
        }
        await _this.pageWaitForSelector(page, '#btnAddSubProjects', {
            hidden: true,
        });
    },
    addUserToProject: async function(data: $TSFixMe, page: $TSFixMe) {
        const { email, role, subProjectName } = data;
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageWaitForSelector(page, '#teamMembers');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClickNavigate(page, '#teamMembers');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageWaitForSelector(page, `#btn_${subProjectName}`);
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, `#btn_${subProjectName}`);
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageWaitForSelector(page, `#frm_${subProjectName}`);
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, `#emails_${subProjectName}`);
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
        await _this.pageType(page, `#emails_${subProjectName}`, email);
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, `#${role}_${subProjectName}`);
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, `#btn_modal_${subProjectName}`);
    },
    switchProject: async function(projectName: $TSFixMe, page: $TSFixMe) {
        await page.goto(utils.DASHBOARD_URL, { waitUntil: ['networkidle2'] });
        await _this.pageWaitForSelector(page, '#AccountSwitcherId', {
            visible: true,
            timeout: _this.timeout,
        });
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, '#AccountSwitcherId');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageWaitForSelector(
            page,
            `#accountSwitcher div#${projectName}`
        );
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, `#accountSwitcher div#${projectName}`);
        await _this.pageWaitForSelector(page, '#components', {
            visible: true,
            timeout: _this.timeout,
        });
    },
    addHttpTestServerMonitorToComponent: async function(
        component: $TSFixMe,
        monitorName: $TSFixMe,
        page: $TSFixMe
    ) {
        component && (await _this.addComponent(component, page));
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageWaitForSelector(page, 'input[id=name]');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, 'input[id=name]');
        await page.focus('input[id=name]');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
        await _this.pageType(page, 'input[id=name]', monitorName);
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageWaitForSelector(page, 'button[id=showMoreMonitors]');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, 'button[id=showMoreMonitors]');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, '[data-testId=type_url]');
        await _this.pageWaitForSelector(page, '#url', {
            visible: true,
            timeout: _this.timeout,
        });
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, '#url');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
        await _this.pageType(page, '#url', 'http://localhost:3010');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClickNavigate(page, 'button[type=submit]');
        await _this.pageWaitForSelector(page, `#monitor-title-${monitorName}`, {
            visible: true,
        });
    },
    addMonitorToComponent: async function(
        component: $TSFixMe,
        monitorName: $TSFixMe,
        page: $TSFixMe
    ) {
        component && (await _this.addComponent(component, page));
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageWaitForSelector(page, 'input[id=name]');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, 'input[id=name]');
        await page.focus('input[id=name]');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
        await _this.pageType(page, 'input[id=name]', monitorName);
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageWaitForSelector(page, 'button[id=showMoreMonitors]');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, 'button[id=showMoreMonitors]');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, '[data-testId=type_url]');
        await _this.pageWaitForSelector(page, '#url', {
            visible: true,
            timeout: _this.timeout,
        });
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, '#url');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
        await _this.pageType(page, '#url', 'https://google.com');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClickNavigate(page, 'button[type=submit]');
        await _this.pageWaitForSelector(page, `#monitor-title-${monitorName}`, {
            visible: true,
        });
    },
    addNewMonitorToComponent: async function(
        page: $TSFixMe,
        componentName: $TSFixMe,
        monitorName: $TSFixMe
    ) {
        await page.goto(utils.DASHBOARD_URL, {
            waitUntil: 'networkidle2',
            timeout: _this.timeout,
        });
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageWaitForSelector(page, '#components');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClickNavigate(page, '#components');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageWaitForSelector(page, '#component0');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageWaitForSelector(page, `#more-details-${componentName}`);
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClickNavigate(page, `#more-details-${componentName}`);
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageWaitForSelector(page, '#form-new-monitor');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageWaitForSelector(page, 'input[id=name]');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, 'input[id=name]');
        await page.focus('input[id=name]');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
        await _this.pageType(page, 'input[id=name]', monitorName);
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, '[data-testId=type_url]');
        await _this.pageWaitForSelector(page, '#url', {
            visible: true,
            timeout: _this.timeout,
        });
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, '#url');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
        await _this.pageType(page, '#url', 'https://google.com');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClickNavigate(page, 'button[type=submit]');
        await _this.pageWaitForSelector(page, `#monitor-title-${monitorName}`, {
            visible: true,
        });
    },
    addAdditionalMonitorToComponent: async function(
        page: $TSFixMe,
        componentName: $TSFixMe,
        monitorName: $TSFixMe
    ) {
        await page.goto(utils.DASHBOARD_URL, {
            waitUntil: 'networkidle2',
            timeout: _this.timeout,
        });
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageWaitForSelector(page, '#components');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClickNavigate(page, '#components');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageWaitForSelector(page, '#component0');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageWaitForSelector(page, `#more-details-${componentName}`);
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClickNavigate(page, `#more-details-${componentName}`);
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageWaitForSelector(page, '#cbMonitors');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, '#newFormId');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageWaitForSelector(page, '#form-new-monitor');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageWaitForSelector(page, 'input[id=name]');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, 'input[id=name]');
        await page.focus('input[id=name]');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
        await _this.pageType(page, 'input[id=name]', monitorName);
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, '[data-testId=type_url]');
        await _this.pageWaitForSelector(page, '#url', {
            visible: true,
            timeout: _this.timeout,
        });
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, '#url');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
        await _this.pageType(page, '#url', 'https://google.com');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClickNavigate(page, 'button[type=submit]');
        await _this.pageWaitForSelector(page, `#monitor-title-${monitorName}`, {
            visible: true,
        });
    },
    /**
     *  adds an api monitor with js expressions for up and degraded events
     * @param {*} page a page instance of puppeteer
     * @param {string} monitorName the name of the new monitor
     * @param {{createAlertForOnline : boolean, createAlertForDegraded : boolean, createAlertForDown : boolean}} options
     */
    addAPIMonitorWithJSExpression: async function(
        page: $TSFixMe,
        monitorName: $TSFixMe,
        options = {}
    ) {
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageWaitForSelector(page, '#form-new-monitor');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, 'input[id=name]');
        await page.focus('input[id=name]');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
        await _this.pageType(page, 'input[id=name]', monitorName);
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, 'input[data-testId=type_api]');
        await _this.selectDropdownValue('#method', 'get', page);
        await _this.pageWaitForSelector(page, '#url', {
            visible: true,
            timeout: _this.timeout,
        });
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, '#url');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
        await _this.pageType(page, '#url', utils.HTTP_TEST_SERVER_URL);
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageWaitForSelector(page, '#advanceOptions');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, '#advanceOptions');

        // online criteria
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageWaitForSelector(page, '[data-testId=add_criterion_up]');
        await _this.page$$Eval(
            page,
            '[data-testId=add_criterion_up]',
            (addCriterionButtons: $TSFixMe) => {
                const lastAddCriterionButton =
                    addCriterionButtons[addCriterionButtons.length - 1];
                lastAddCriterionButton.click();
            }
        );
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageWaitForSelector(
            page,
            'ul[data-testId=up_criteria_list]> div:last-of-type #responseType'
        );
        await _this.selectDropdownValue(
            'ul[data-testId=up_criteria_list]> div:last-of-type #responseType',
            'responseBody',
            page
        );
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageWaitForSelector(
            page,
            'ul[data-testId=up_criteria_list]> div:last-of-type #filter'
        );
        await _this.selectDropdownValue(
            'ul[data-testId=up_criteria_list]> div:last-of-type #filter',
            'evaluateResponse',
            page
        );
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageWaitForSelector(
            page,
            'ul[data-testId=up_criteria_list]> div:last-of-type #value'
        );
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(
            page,
            'ul[data-testId=up_criteria_list]> div:last-of-type #value'
        );
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
        await _this.pageType(
            page,
            'ul[data-testId=up_criteria_list]> div:last-of-type #value',
            "response.body.status === 'ok';"
        );

        // @ts-expect-error ts-migrate(2339) FIXME: Property 'createAlertForOnline' does not exist on ... Remove this comment to see the full error message
        if (options.createAlertForOnline) {
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await _this.pageClick(
                page,
                '[data-testId=criterionAdvancedOptions_up]'
            );

            await _this.pageWaitForSelector(
                page,
                'input[name^=createAlert_up]',
                {
                    visible: true,
                    timeout: _this.timeout,
                }
            );
            await _this.page$Eval(
                page,
                'input[name^=createAlert_up]',
                (element: $TSFixMe) => element.click()
            );
        }

        // degraded criteria
        await _this.page$$Eval(
            page,
            '[data-testId=add_criterion_degraded]',
            (addCriterionButtons: $TSFixMe) => {
                const lastAddCriterionButton =
                    addCriterionButtons[addCriterionButtons.length - 1];
                lastAddCriterionButton.click();
            }
        );
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageWaitForSelector(
            page,
            'ul[data-testId=degraded_criteria_list] > div:last-of-type #responseType'
        );
        await _this.selectDropdownValue(
            'ul[data-testId=degraded_criteria_list] > div:last-of-type #responseType',
            'responseBody',
            page
        );
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageWaitForSelector(
            page,
            'ul[data-testId=degraded_criteria_list] > div:last-of-type #filter'
        );
        await _this.selectDropdownValue(
            'ul[data-testId=degraded_criteria_list] > div:last-of-type #filter',
            'evaluateResponse',
            page
        );
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageWaitForSelector(
            page,
            'ul[data-testId=degraded_criteria_list] > div:last-of-type #value'
        );
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(
            page,
            'ul[data-testId=degraded_criteria_list] > div:last-of-type #value'
        );
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
        await _this.pageType(
            page,
            'ul[data-testId=degraded_criteria_list] > div:last-of-type #value',
            "response.body.message === 'draining';"
        );

        await Promise.all([
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            _this.pageClick(page, 'button[type=submit]'),
            page.waitForNavigation(),
        ]);
    },
    addMonitorToSubProject: async function(
        monitorName: $TSFixMe,
        projectName: $TSFixMe,
        componentName: $TSFixMe,
        page: $TSFixMe
    ) {
        await page.reload({ waitUntil: 'domcontentloaded' });
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageWaitForSelector(page, '#monitors');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, '#monitors'); // Fix this
        // await _this.navigateToComponentDetails(componentName, page);
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageWaitForSelector(page, '#form-new-monitor');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, 'input[id=name]');
        await page.focus('input[id=name]');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
        await _this.pageType(page, 'input[id=name]', monitorName);
        //Please add a new monitor type here. IOT Device Monitor has been removed.
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, 'button[type=submit]');
        await _this.pageWaitForSelector(page, `#monitor-title-${monitorName}`, {
            visible: true,
        });
    },
    addIncidentToProject: async function(
        monitorName: $TSFixMe,
        projectName: $TSFixMe,
        page: $TSFixMe
    ) {
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageWaitForSelector(page, '#incidentLog');
        await _this.page$Eval(page, '#incidentLog', (e: $TSFixMe) => e.click());

        await _this.pageWaitForSelector(
            page,
            `#btnCreateIncident_${projectName}`,
            {
                visible: true,
                timeout: _this.timeout,
            }
        );
        await _this.page$Eval(
            page,
            `#btnCreateIncident_${projectName}`,
            (e: $TSFixMe) => e.click()
        );
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageWaitForSelector(page, '#frmIncident');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, '#monitorDropdown');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, `#${monitorName}`);
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, '#incidentType');
        await _this.page$Eval(page, '#createIncident', (e: $TSFixMe) =>
            e.click()
        );

        await _this.pageWaitForSelector(page, '#createIncident', {
            hidden: true,
        });
    },
    addIncidentPriority: async function(
        incidentPriority: $TSFixMe,
        page: $TSFixMe
    ) {
        await page.goto(utils.DASHBOARD_URL, {
            waitUntil: 'networkidle2',
        });
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageWaitForSelector(page, '#projectSettings');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClickNavigate(page, '#projectSettings');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageWaitForSelector(page, '#more');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, '#more');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageWaitForSelector(page, '#incidentSettings');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClickNavigate(page, '#incidentSettings');
        // To navigate to incident Priority tab
        await _this.pageWaitForSelector(page, '.incident-priority-tab', {
            visible: true,
        });
        await _this.page$$Eval(
            page,
            '.incident-priority-tab',
            (elems: $TSFixMe) => elems[0].click()
        );

        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageWaitForSelector(page, '#addNewPriority');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, '#addNewPriority');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageWaitForSelector(page, '#CreateIncidentPriority');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
        await _this.pageType(page, 'input[name=name]', incidentPriority);
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, '#CreateIncidentPriority');
        await _this.pageWaitForSelector(page, '#CreateIncidentPriority', {
            hidden: true,
        });
    },
    addStatusPageToProject: async function(
        statusPageName: $TSFixMe,
        projectName: $TSFixMe,
        page: $TSFixMe
    ) {
        const createStatusPageSelector = await page.$(
            `#btnCreateStatusPage_${projectName}`
        );
        if (createStatusPageSelector) {
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await _this.pageClick(page, `#btnCreateStatusPage_${projectName}`);
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await _this.pageWaitForSelector(page, '#btnCreateStatusPage');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await _this.pageType(page, '#name', statusPageName);
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await _this.pageClick(page, '#btnCreateStatusPage');
        } else {
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await _this.pageWaitForSelector(page, '#statusPages');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await _this.pageClickNavigate(page, '#statusPages');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await _this.pageWaitForSelector(
                page,
                `#btnCreateStatusPage_${projectName}`
            );
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await _this.pageClick(page, `#btnCreateStatusPage_${projectName}`);
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await _this.pageWaitForSelector(page, '#btnCreateStatusPage');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await _this.pageType(page, '#name', statusPageName);
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await _this.pageClick(page, '#btnCreateStatusPage');
        }
        await _this.pageWaitForSelector(page, '#btnCreateStatusPage', {
            hidden: true,
        });
    },
    addScheduleToProject: async function(
        scheduleName: $TSFixMe,
        projectName: $TSFixMe,
        page: $TSFixMe
    ) {
        const createStatusPageSelector = await _this.page$(
            page,
            `#btnCreateStatusPage_${projectName}`,
            { hidden: true }
        );
        if (createStatusPageSelector) {
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await _this.pageWaitForSelector(
                page,
                `#btnCreateSchedule_${projectName}`
            );
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await _this.pageClick(page, `#btnCreateSchedule_${projectName}`);
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await _this.pageWaitForSelector(page, '#btnCreateSchedule');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await _this.pageType(page, '#name', scheduleName);
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await _this.pageClick(page, '#btnCreateSchedule');
        } else {
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await _this.pageWaitForSelector(page, '#onCallDuty');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await _this.pageClickNavigate(page, '#onCallDuty');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await _this.pageWaitForSelector(
                page,
                `#btnCreateSchedule_${projectName}`
            );
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await _this.pageClick(page, `#btnCreateSchedule_${projectName}`);
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await _this.pageWaitForSelector(page, '#btnCreateSchedule');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await _this.pageType(page, '#name', scheduleName);
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await _this.pageClick(page, '#btnCreateSchedule');
        }
    },
    addScheduledMaintenance: async function(
        monitorName: $TSFixMe,
        scheduledEventName: $TSFixMe,
        componentName: $TSFixMe,
        page: $TSFixMe
    ) {
        await page.goto(utils.DASHBOARD_URL, {
            waitUntil: ['networkidle2'],
        });
        await _this.pageWaitForSelector(page, '#scheduledMaintenance', {
            visible: true,
        });
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClickNavigate(page, '#scheduledMaintenance');
        await _this.pageWaitForSelector(page, '#addScheduledEventButton', {
            visible: true,
        });
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, '#addScheduledEventButton');

        await _this.pageWaitForSelector(page, '#scheduledEventForm', {
            visible: true,
        });
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageWaitForSelector(page, '#name');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, '#name');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
        await _this.pageType(page, '#name', scheduledEventName);
        if (monitorName) {
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await _this.pageWaitForSelector(
                page,
                'label[for=selectAllMonitors]'
            );
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await _this.pageClick(page, '#selectSpecificMonitors');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await _this.pageClick(page, '#monitorDropdown');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await _this.pageClick(page, `#${monitorName}`);
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await _this.pageClick(page, 'label[for=monitorIds]');
        }
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, '#description');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
        await _this.pageType(
            page,
            '#description',
            'This is an example description for a test'
        );
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageWaitForSelector(page, 'input[name=startDate]');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, 'input[name=startDate]');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(
            page,
            'div.MuiDialogActions-root button:nth-child(2)'
        );
        await _this.pageWaitForSelector(
            page,
            'div.MuiDialogActions-root button:nth-child(2)',
            { hidden: true }
        );
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, 'input[name=endDate]');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(
            page,
            'div.MuiDialogActions-root button:nth-child(2)'
        );
        await _this.pageWaitForSelector(
            page,
            'div.MuiDialogActions-root button:nth-child(2)',
            { hidden: true }
        );
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, '#createScheduledEventButton');
        await _this.pageWaitForSelector(page, '.ball-beat', {
            hidden: true,
        });
    },
    filterRequest: async (request: $TSFixMe, response: $TSFixMe) => {
        if ((await request.url()).match(/user\/login/)) {
            request.respond({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify(response),
            });
        } else {
            request.continue();
        }
    },
    addProject: async function(
        page: $TSFixMe,
        projectName = null,
        checkCard = false
    ) {
        await page.goto(utils.DASHBOARD_URL, {
            waitUntil: ['networkidle2'],
        });
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageWaitForSelector(page, '#AccountSwitcherId');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, '#AccountSwitcherId');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageWaitForSelector(page, '#create-project');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, '#create-project');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageWaitForSelector(page, '#name');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
        await _this.pageType(page, '#name', projectName ? projectName : 'test');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, 'label[for=Startup_month]');
        const startupOption = await _this.pageWaitForSelector(
            page,
            'label[for=Startup_month]',
            { visible: true, timeout: _this.timeout }
        );
        startupOption.click();
        if (checkCard) {
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await _this.pageWaitForSelector(
                page,
                'iframe[name=__privateStripeFrame5]'
            );

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            const elementHandle = await _this.page$(
                page,
                'iframe[name=__privateStripeFrame5]'
            );
            const frame = await elementHandle.contentFrame();
            await frame.waitForSelector('input[name=cardnumber]');
            await frame.type('input[name=cardnumber]', '42424242424242424242', {
                delay: 200,
            });

            await frame.waitForSelector('input[name=cvc]');
            await frame.type('input[name=cvc]', '123', {
                delay: 150,
            });

            await frame.waitForSelector('input[name=exp-date]');
            await frame.type('input[name=exp-date]', '11/23', {
                delay: 150,
            });

            await frame.waitForSelector('input[name=postal]');
            await frame.type('input[name=postal]', '12345', {
                delay: 150,
            });
        }
        await _this.pageWaitForSelector(page, '#btnCreateProject', {
            visible: true,
            timeout: _this.timeout,
        });
        await Promise.all([
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            _this.pageClick(page, '#btnCreateProject'),
            page.waitForNavigation({ waitUntil: 'networkidle2' }),
        ]);
    },
    addResourceCategory: async function(
        resourceCategory: $TSFixMe,
        page: $TSFixMe
    ) {
        await page.goto(utils.DASHBOARD_URL, {
            waitUntil: ['networkidle2'],
        });
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageWaitForSelector(page, '#projectSettings');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClickNavigate(page, '#projectSettings');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageWaitForSelector(page, '#more');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, '#more');

        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageWaitForSelector(page, 'li#resources a');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClickNavigate(page, 'li#resources a');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageWaitForSelector(page, '#createResourceCategoryButton');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, '#createResourceCategoryButton');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageWaitForSelector(page, '#resourceCategoryName');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
        await _this.pageType(page, '#resourceCategoryName', resourceCategory);
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, '#addResourceCategoryButton');
        await _this.pageWaitForSelector(page, '#addResourceCategoryButton', {
            hidden: true,
        });

        const createdResourceCategorySelector =
            '#resourceCategoryList #resource-category-name';
        await _this.pageWaitForSelector(page, createdResourceCategorySelector, {
            visible: true,
        });
    },
    addGrowthProject: async function(
        projectName = 'GrowthProject',
        page: $TSFixMe
    ) {
        await page.goto(utils.DASHBOARD_URL, {
            waitUntil: ['networkidle2'],
        });
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageWaitForSelector(page, '#AccountSwitcherId');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, '#AccountSwitcherId');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageWaitForSelector(page, '#create-project');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, '#create-project');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageWaitForSelector(page, '#name');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
        await _this.pageType(page, '#name', projectName);
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, 'label[for=Growth_month]');
        const growthOption = await _this.pageWaitForSelector(
            page,
            'label[for=Growth_month]',
            { visible: true, timeout: _this.timeout }
        );
        growthOption.click();
        await Promise.all([
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await _this.pageClick(page, '#btnCreateProject'),
            await page.waitForNavigation({ waitUntil: 'networkidle2' }),
        ]);
    },
    addScaleProject: async function(
        projectName = 'ScaleProject',
        page: $TSFixMe
    ) {
        await page.goto(utils.DASHBOARD_URL, {
            waitUntil: ['networkidle2'],
        });
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageWaitForSelector(page, '#AccountSwitcherId');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, '#AccountSwitcherId');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageWaitForSelector(page, '#create-project');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, '#create-project');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageWaitForSelector(page, '#name');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
        await _this.pageType(page, '#name', projectName);
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, 'label[for=Scale_month]');
        const scaleOption = await _this.pageWaitForSelector(
            page,
            'label[for=Scale_month]',
            { visible: true, timeout: _this.timeout }
        );
        scaleOption.click();
        await Promise.all([
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await _this.pageClick(page, '#btnCreateProject'),
            await page.waitForNavigation({ waitUntil: 'networkidle2' }),
        ]);
    },
    addScheduledMaintenanceNote: async function(
        page: $TSFixMe,
        type: $TSFixMe,
        eventBtn: $TSFixMe,
        noteDescription: $TSFixMe,
        eventState = 'update'
    ) {
        await page.goto(utils.DASHBOARD_URL, {
            waitUntil: ['networkidle2'],
        });
        await _this.pageWaitForSelector(page, '#scheduledMaintenance', {
            visible: true,
        });
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClickNavigate(page, '#scheduledMaintenance');

        await _this.pageWaitForSelector(page, `#${eventBtn}`, {
            visible: true,
        });
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, `#${eventBtn}`);
        // navigate to the note tab section
        // await _this.gotoTab(utils.scheduleEventTabIndexes.NOTES, page);
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, '.timeline-tab');
        await _this.pageWaitForSelector(page, `#add-${type}-message`, {
            visible: true,
        });
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, `#add-${type}-message`);
        await _this.pageWaitForSelector(page, '#event_state', {
            visible: true,
        });
        await _this.selectDropdownValue('#event_state', eventState, page);
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, '#new-internal');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
        await _this.pageType(page, '#new-internal', noteDescription);
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, '#internal-addButton');
        await _this.pageWaitForSelector(
            page,
            '#form-new-schedule-internal-message',
            {
                hidden: true,
            }
        );
    },
    addIncident: async function(
        monitorName: $TSFixMe,
        incidentType: $TSFixMe,
        page: $TSFixMe,
        incidentPriority: $TSFixMe
    ) {
        await page.goto(utils.DASHBOARD_URL, {
            waitUntil: ['networkidle2'],
        });
        await _this.pageWaitForSelector(page, '#components', {
            visible: true,
            timeout: _this.timeout,
        });
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClickNavigate(page, '#components');
        await _this.pageWaitForSelector(page, `#view-resource-${monitorName}`, {
            visible: true,
        });
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClickNavigate(page, `#view-resource-${monitorName}`);

        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageWaitForSelector(
            page,
            `#monitorCreateIncident_${monitorName}`
        );
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, `#monitorCreateIncident_${monitorName}`);
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageWaitForSelector(page, '#createIncident');
        await _this.selectDropdownValue('#incidentType', incidentType, page);
        if (incidentPriority) {
            await _this.selectDropdownValue(
                '#incidentPriority',
                incidentPriority,
                page
            );
        }
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, '#createIncident');
        await _this.pageWaitForSelector(page, '.ball-beat', {
            visible: true,
            timeout: _this.timeout,
        });
        await _this.pageWaitForSelector(page, '.ball-beat', { hidden: true });
    },
    addTwilioSettings: async function(
        enableSms: $TSFixMe,
        accountSid: $TSFixMe,
        authToken: $TSFixMe,
        phoneNumber: $TSFixMe,
        page: $TSFixMe
    ) {
        await page.goto(utils.DASHBOARD_URL, {
            waitUntil: ['networkidle2'],
        });
        await _this.pageWaitForSelector(page, '#projectSettings', {
            visible: true,
        });
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClickNavigate(page, '#projectSettings');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, '#more');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageWaitForSelector(page, '#smsCalls');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClickNavigate(page, '#smsCalls');
        await _this.pageWaitForSelector(page, 'label[for=enabled]', {
            visible: true,
        });
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        if (enableSms) await _this.pageClick(page, 'label[for=enabled]');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
        await _this.pageType(page, '#accountSid', accountSid);
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
        await _this.pageType(page, '#authToken', authToken);
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
        await _this.pageType(page, '#phoneNumber', phoneNumber);
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, '#submitTwilioSettings');
        await _this.pageWaitForSelector(page, '.ball-beat', { hidden: true });
        await page.reload();
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageWaitForSelector(page, '#accountSid');
    },
    addGlobalTwilioSettings: async function(
        enableSms: $TSFixMe,
        enableCalls: $TSFixMe,
        accountSid: $TSFixMe,
        authToken: $TSFixMe,
        phoneNumber: $TSFixMe,
        alertLimit: $TSFixMe,
        page: $TSFixMe
    ) {
        await page.goto(utils.ADMIN_DASHBOARD_URL, {
            waitUntil: ['networkidle2'],
        });
        await _this.pageWaitForSelector(page, '#settings', {
            visible: true,
        });
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, '#settings');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageWaitForSelector(page, '#twilio');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, '#twilio');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageWaitForSelector(page, '#call-enabled');
        if (enableCalls) {
            await _this.page$Eval(page, '#call-enabled', (element: $TSFixMe) =>
                element.click()
            );
        }
        if (enableSms) {
            await _this.page$Eval(page, '#sms-enabled', (element: $TSFixMe) =>
                element.click()
            );
        }
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
        await _this.pageType(page, '#account-sid', accountSid);
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
        await _this.pageType(page, '#authentication-token', authToken);
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
        await _this.pageType(page, '#phone', phoneNumber);
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
        await _this.pageType(page, '#alert-limit', alertLimit);
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, 'button[type=submit]');

        await page.reload();
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageWaitForSelector(page, '#account-sid');
    },
    addSmtpSettings: async function(
        enable: $TSFixMe,
        user: $TSFixMe,
        pass: $TSFixMe,
        host: $TSFixMe,
        port: $TSFixMe,
        from: $TSFixMe,
        secure: $TSFixMe,
        page: $TSFixMe
    ) {
        await page.goto(utils.DASHBOARD_URL, {
            waitUntil: ['networkidle2'],
        });
        await _this.pageWaitForSelector(page, '#projectSettings', {
            visible: true,
        });
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClickNavigate(page, '#projectSettings');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, '#more');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageWaitForSelector(page, '#email');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClickNavigate(page, '#email');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageWaitForSelector(page, '#smtpswitch');
        if (enable)
            await _this.page$Eval(page, '#smtpswitch', (elem: $TSFixMe) =>
                elem.click()
            );
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageWaitForSelector(page, '#user');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
        await _this.pageType(page, '#user', user);
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
        await _this.pageType(page, '#pass', pass);
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
        await _this.pageType(page, '#host', host);
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
        await _this.pageType(page, '#port', port);
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
        await _this.pageType(page, '#from', from);
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
        await _this.pageType(page, '#name', 'Admin');
        await _this.page$Eval(page, '#secure', (e: $TSFixMe) => {
            e.checked = secure;
        });
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, '#saveSmtp');
        await _this.pageWaitForSelector(page, '.ball-beat', {
            visible: true,
            timeout: _this.timeout,
        });
        await _this.pageWaitForSelector(page, '.ball-beat', { hidden: true });
        await page.reload();
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageWaitForSelector(page, '#user');
    },
    setAlertPhoneNumber: async (
        phoneNumber: $TSFixMe,
        code: $TSFixMe,
        page: $TSFixMe
    ) => {
        await page.goto(utils.DASHBOARD_URL, {
            waitUntil: ['networkidle2'],
        });
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageWaitForSelector(page, '#profile-menu');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, '#profile-menu');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageWaitForSelector(page, '#userProfile');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClickNavigate(page, '#userProfile');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageWaitForSelector(page, 'input[type=tel]');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
        await _this.pageType(page, 'input[type=tel]', phoneNumber);
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageWaitForSelector(page, '#sendVerificationSMS');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, '#sendVerificationSMS');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageWaitForSelector(page, '#otp');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
        await _this.pageType(page, '#otp', code);
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, '#verify');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageWaitForSelector(page, '#successMessage');
    },
    addAnExternalSubscriber: async function(
        componentName: $TSFixMe,
        monitorName: $TSFixMe,
        alertType: $TSFixMe,
        page: $TSFixMe,
        data: $TSFixMe
    ) {
        await page.goto(utils.DASHBOARD_URL, {
            waitUntil: ['networkidle2'],
        });
        await _this.navigateToMonitorDetails(componentName, monitorName, page);
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageWaitForSelector(page, '#react-tabs-2');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, '#react-tabs-2');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageWaitForSelector(page, '#addSubscriberButton');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, '#addSubscriberButton');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageWaitForSelector(page, '#alertViaId');
        await _this.selectDropdownValue('#alertViaId', alertType, page);
        if (alertType === 'SMS') {
            const { countryCode, phoneNumber } = data;
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await _this.pageWaitForSelector(page, '#countryCodeId');
            await _this.selectDropdownValue(
                '#countryCodeId',
                countryCode,
                page
            );
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await _this.pageType(page, '#contactPhoneId', phoneNumber);
        }
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, '#createSubscriber');
    },
    addCustomField: async function(
        page: $TSFixMe,
        data: $TSFixMe,
        owner: $TSFixMe
    ) {
        await page.goto(utils.DASHBOARD_URL, {
            waitUntil: ['networkidle2'],
        });
        await _this.pageWaitForSelector(page, '#projectSettings', {
            visible: true,
            timeout: _this.timeout,
        });
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClickNavigate(page, '#projectSettings');
        if (owner === 'monitor') {
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await _this.pageWaitForSelector(page, '#more');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await _this.pageClick(page, '#more');
            await _this.pageWaitForSelector(page, '#monitor', {
                visible: true,
                timeout: _this.timeout,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await _this.pageClickNavigate(page, '#monitor');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await _this.pageClick(page, '.monitor-sla-advanced');
        } else {
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await _this.pageWaitForSelector(page, '#more');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await _this.pageClick(page, '#more');
            await _this.pageWaitForSelector(page, '#incidentSettings', {
                visible: true,
                timeout: _this.timeout,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await _this.pageClickNavigate(page, '#incidentSettings');
            await page.reload({
                waitUntil: 'networkidle2',
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await _this.pageClick(page, '.advanced-tab');
        }

        await _this.pageWaitForSelector(page, '#addCustomField', {
            visible: true,
            timeout: _this.timeout,
        });
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, '#addCustomField');
        await _this.pageWaitForSelector(page, '#customFieldForm', {
            visible: true,
            timeout: _this.timeout,
        });
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, '#fieldName');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
        await _this.pageType(page, '#fieldName', data.fieldName);
        await _this.selectDropdownValue('#fieldType', data.fieldType, page);

        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, '#createCustomFieldButton');
        await _this.pageWaitForSelector(page, '#customFieldForm', {
            hidden: true,
        });
    },
    navigateToCustomField: async function(page: $TSFixMe) {
        await page.goto(utils.DASHBOARD_URL, {
            waitUntil: ['networkidle2'],
        });
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClickNavigate(page, '#projectSettings');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageWaitForSelector(page, '#more');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, '#more');
        await _this.pageWaitForSelector(page, '#incidentSettings', {
            visible: true,
            timeout: _this.timeout,
        });
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClickNavigate(page, '#incidentSettings');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, '.advanced-tab');
    },
    pageType: async function(
        page: $TSFixMe,
        selector: $TSFixMe,
        text: $TSFixMe,
        opts: $TSFixMe
    ) {
        await _this.pageWaitForSelector(page, selector, {
            visible: true,
            timeout: _this.timeout,
        });
        await page.focus(selector);
        return await page.type(selector, text, opts);
    },
    pageClick: async function(
        page: $TSFixMe,
        selector: $TSFixMe,
        opts: $TSFixMe
    ) {
        await _this.pageWaitForSelector(page, selector, {
            visible: true,
            timeout: _this.timeout,
        });
        return await page.click(selector, opts);
    },
    page$Eval: async function(
        page: $TSFixMe,
        selector: $TSFixMe,
        evalFunction: $TSFixMe,
        opts = null
    ) {
        await _this.pageWaitForSelector(page, selector, opts);
        return await page.$eval(selector, evalFunction);
    },
    page$$Eval: async function(
        page: $TSFixMe,
        selector: $TSFixMe,
        evalFunction: $TSFixMe
    ) {
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageWaitForSelector(page, selector);
        return await page.$$eval(selector, evalFunction);
    },
    page$: async function(page: $TSFixMe, selector: $TSFixMe, opts: $TSFixMe) {
        await _this.pageWaitForSelector(page, selector, opts);
        return await page.$(selector, opts);
    },
    page$$: async function(page: $TSFixMe, selector: $TSFixMe, opts: $TSFixMe) {
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageWaitForSelector(page, selector);
        return await page.$$(selector, opts);
    },
    pageWaitForSelector: async function(
        page: $TSFixMe,
        selector: $TSFixMe,
        opts: $TSFixMe
    ) {
        if (!opts) {
            opts = {};
        }

        if (!opts.timeout) {
            opts.timeout = _this.timeout;
        }

        if (!opts.hidden) {
            opts.visible = true;
        }
        return await page.waitForSelector(selector, {
            ...opts,
        });
    },
    isElementOnPage: async function(page: $TSFixMe, selector: $TSFixMe) {
        if (await page.$(selector)) {
            return true;
        } else {
            return false;
        }
    },
    pageClickNavigate: async function(
        page: $TSFixMe,
        selector: $TSFixMe,
        opts: $TSFixMe
    ) {
        await _this.pageWaitForSelector(page, selector, {
            visible: true,
            timeout: _this.timeout,
        });
        return await Promise.all([
            page.click(selector, opts),
            page.waitForNavigation({ waitUntil: 'networkidle2' }), // This ensures every id is loaded upon page routing
        ]);
    },
    navigateToTwilio: async function(page: $TSFixMe) {
        await page.goto(utils.DASHBOARD_URL);
        await _this.pageWaitForSelector(page, '#projectSettings', {
            visible: true,
            timeout: _this.timeout,
        });
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, '#projectSettings');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageWaitForSelector(page, '#more');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, '#more');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageWaitForSelector(page, '#smsCalls');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, '#smsCalls');
    },
    navigateToSmtp: async function(page: $TSFixMe) {
        await page.goto(utils.DASHBOARD_URL);
        await _this.pageWaitForSelector(page, '#projectSettings', {
            visible: true,
            timeout: _this.timeout,
        });
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, '#projectSettings');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageWaitForSelector(page, '#more');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, '#more');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageWaitForSelector(page, '#email');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await _this.pageClick(page, '#email');
    },
};

export default _this;
