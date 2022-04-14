import utils from './test-utils';
import chai from 'chai';
import chaihttp from 'chai-http';
import PositiveNumber from 'Common/Types/PositiveNumber';
chai.use(chaihttp);

const request = chai.request(utils.BACKEND_URL);

const _this: $TSFixMe = {
    /**
     *
     * @param { ObjectConstructor } user
     * @param { string } page
     * @description Registers a new user.
     * @returns { void }
     */

    timeout: 180000, // 3 mins. If things take longer than 3 mins. We consider it a failure. Please do not add your custom timeout.
    registerUser: async function (user: $TSFixMe, page: $TSFixMe): void {
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

            await this.pageWaitForSelector(page, '#email');

            await this.pageClick(page, 'input[name=email]');

            await this.pageType(page, 'input[name=email]', email);

            await this.pageClick(page, 'input[name=name]');

            await this.pageType(page, 'input[name=name]', 'Test Name');

            await this.pageClick(page, 'input[name=companyName]');

            await this.pageType(page, 'input[name=companyName]', 'Test Name');

            await this.pageClick(page, 'input[name=companyPhoneNumber]');

            await this.pageType(
                page,
                'input[name=companyPhoneNumber]',
                '99105688'
            );

            await this.pageClick(page, 'input[name=password]');

            await this.pageType(page, 'input[name=password]', '1234567890');

            await this.pageClick(page, 'input[name=confirmPassword]');

            await this.pageType(
                page,
                'input[name=confirmPassword]',
                '1234567890'
            );

            await this.pageClick(page, 'button[type=submit]');
            await this.pageWaitForSelector(page, `form#card-form`, {
                visible: true,
                timeout: this.timeout,
            });

            await this.pageWaitForSelector(
                page,
                '.__PrivateStripeElement > iframe',
                {
                    visible: true,
                    timeout: this.timeout,
                }
            );

            const stripeIframeElements = await this.page$$(
                page,
                '.__PrivateStripeElement > iframe'
            );

            await this.pageClick(page, 'input[name=cardName]');

            await this.pageType(page, 'input[name=cardName]', 'Test name');

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

            await this.pageClick(page, 'input[name=address1]');

            await this.pageType(
                page,
                'input[name=address1]',
                utils.user.address.streetA
            );

            await this.pageClick(page, 'input[name=address2]');

            await this.pageType(
                page,
                'input[name=address2]',
                utils.user.address.streetB
            );

            await this.pageClick(page, 'input[name=city]');

            await this.pageType(
                page,
                'input[name=city]',
                utils.user.address.city
            );

            await this.pageClick(page, 'input[name=state]');

            await this.pageType(
                page,
                'input[name=state]',
                utils.user.address.state
            );

            await this.pageClick(page, 'input[name=zipCode]');

            await this.pageType(
                page,
                'input[name=zipCode]',
                utils.user.address.zipcode
            );
            await page.select('#country', 'India');

            await this.pageClick(page, 'button[type=submit]');

            const home = await this.pageWaitForSelector(page, '#profile-menu');
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
    registerFailedUser: async function (user: $TSFixMe, page: $TSFixMe): void {
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

            await this.pageWaitForSelector(page, '#email');

            await this.pageClick(page, 'input[name=email]');

            await this.pageType(page, 'input[name=email]', email);

            await this.pageClick(page, 'input[name=name]');

            await this.pageType(page, 'input[name=name]', 'Test Name');

            await this.pageClick(page, 'input[name=companyName]');

            await this.pageType(page, 'input[name=companyName]', 'Test Name');

            await this.pageClick(page, 'input[name=companyPhoneNumber]');

            await this.pageType(
                page,
                'input[name=companyPhoneNumber]',
                '99105688'
            );

            await this.pageClick(page, 'input[name=password]');

            await this.pageType(page, 'input[name=password]', '1234567890');

            await this.pageClick(page, 'input[name=confirmPassword]');

            await this.pageType(
                page,
                'input[name=confirmPassword]',
                '1234567890'
            );

            await this.pageClick(page, 'button[type=submit]');
            await this.pageWaitForSelector(page, `form#card-form`, {
                visible: true,
                timeout: this.timeout,
            });

            await this.pageWaitForSelector(
                page,
                '.__PrivateStripeElement > iframe',
                {
                    visible: true,
                    timeout: this.timeout,
                }
            );

            const stripeIframeElements = await this.page$$(
                page,
                '.__PrivateStripeElement > iframe'
            );

            await this.pageClick(page, 'input[name=cardName]');

            await this.pageType(page, 'input[name=cardName]', 'Test name');

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

            await this.pageClick(page, 'input[name=address1]');

            await this.pageType(
                page,
                'input[name=address1]',
                utils.user.address.streetA
            );

            await this.pageClick(page, 'input[name=address2]');

            await this.pageType(
                page,
                'input[name=address2]',
                utils.user.address.streetB
            );

            await this.pageClick(page, 'input[name=city]');

            await this.pageType(
                page,
                'input[name=city]',
                utils.user.address.city
            );

            await this.pageClick(page, 'input[name=state]');

            await this.pageType(
                page,
                'input[name=state]',
                utils.user.address.state
            );

            await this.pageClick(page, 'input[name=zipCode]');

            await this.pageType(
                page,
                'input[name=zipCode]',
                utils.user.address.zipcode
            );
            await page.select('#country', 'India');

            await this.pageClick(page, 'button[type=submit]');
        }
    },
    loginProjectViewer: async function (user: $TSFixMe, page: $TSFixMe): void {
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

        await this.pageWaitForSelector(page, '#login-button');

        await this.pageClick(page, 'input[name=email]');

        await this.pageType(page, 'input[name=email]', email);

        await this.pageClick(page, 'input[name=password]');

        await this.pageType(page, 'input[name=password]', password);

        await this.pageClick(page, 'button[type=submit]');
    },
    loginUser: async function (user: $TSFixMe, page: $TSFixMe): void {
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

        await this.pageWaitForSelector(page, '#login-button');

        await this.pageClick(page, 'input[name=email]');

        await this.pageType(page, 'input[name=email]', email);

        await this.pageClick(page, 'input[name=password]');

        await this.pageType(page, 'input[name=password]', password);

        await this.pageClick(page, 'button[type=submit]');

        await this.pageWaitForSelector(page, '#home', {
            visible: true,
            timeout: this.timeout,
        });
    },
    loginAdminUser: async function (user: $TSFixMe, page: $TSFixMe): void {
        const { email, password } = user;
        await page.goto(utils.ACCOUNTS_URL + '/login', {
            waitUntil: 'networkidle2',
        });

        await this.pageWaitForSelector(page, '#login-button');

        await this.pageClick(page, 'input[name=email]');

        await this.pageType(page, 'input[name=email]', email);

        await this.pageClick(page, 'input[name=password]');

        await this.pageType(page, 'input[name=password]', password);

        await this.pageClick(page, 'button[type=submit]');

        await this.pageWaitForSelector(page, '#users', {
            visible: true,
            timeout: this.timeout,
        });

        return;
    },
    testSmptSettings: async function (page: $TSFixMe, email: $TSFixMe): void {
        await this.pageWaitForSelector(page, '#settings');

        await this.pageClick(page, '#settings');

        await this.pageWaitForSelector(page, '#smtp');

        await this.pageClick(page, '#smtp');

        await this.pageWaitForSelector(page, '#testSmtpSettingsButton');

        await this.pageClick(page, '#testSmtpSettingsButton');

        await this.pageWaitForSelector(page, '#testEmail');

        await this.pageType(page, '#testEmail', email);

        await this.pageWaitForSelector(page, '#customSmtpBtn');

        await this.pageClick(page, '#customSmtpBtn');

        await this.pageWaitForSelector(page, '#confirmSmtpTest');

        await this.pageClick(page, '#confirmSmtpTest');

        await this.pageWaitForSelector(page, '#confirmDelete');

        await this.pageClick(page, '#confirmDelete');
    },
    addEmailCredentials: async function (
        page: $TSFixMe,
        email: $TSFixMe
    ): void {
        await this.pageWaitForSelector(page, '#settings');

        await this.pageClick(page, '#settings');

        await this.pageWaitForSelector(page, '#smtp');

        await this.pageClick(page, '#smtp');

        await this.pageWaitForSelector(page, '#email-enabled');

        await this.pageClick(page, '#email-enabled');

        await this.pageWaitForSelector(page, '#customSmtp');

        await this.pageClick(page, '#customSmtp');

        await this.pageWaitForSelector(page, '#email');

        await this.pageClick(page, 'input[name=email]');

        await this.pageType(
            page,
            'input[name=email]',
            utils.smtpCredential.user
        );

        await this.pageClick(page, 'input[name=password]');

        await this.pageType(
            page,
            'input[name=password]',
            utils.smtpCredential.pass
        );

        await this.pageClick(page, 'input[name=smtp-server]');

        await this.pageType(
            page,
            'input[name=smtp-server]',
            utils.smtpCredential.host
        );

        await this.pageClick(page, 'input[name=smtp-port]');

        await this.pageType(
            page,
            'input[name=smtp-port]',
            utils.smtpCredential.port
        );

        await this.pageClick(page, 'input[name=from]');

        await this.pageType(
            page,
            'input[name=from]',
            utils.smtpCredential.from
        );

        await this.pageClick(page, 'input[name=from-name]');

        await this.pageType(page, 'input[name=from-name]', 'Hackerbay');

        await this.pageWaitForSelector(page, '#label_smpt_secure');

        await this.pageClick(page, '#label_smpt_secure');

        await this.pageWaitForSelector(page, 'button[type=submit]');

        await this.pageClick(page, 'button[type=submit]');

        await this.pageWaitForSelector(page, '#testSmtpSettingsButton');

        await this.pageClick(page, '#testSmtpSettingsButton');

        await this.pageWaitForSelector(page, '#testEmail');

        await this.pageType(page, '#testEmail', email);

        await this.pageWaitForSelector(page, '#customSmtpBtn');

        await this.pageClick(page, '#customSmtpBtn');

        await this.pageWaitForSelector(page, '#confirmSmtpTest');

        await this.pageClick(page, '#confirmSmtpTest');

        await this.pageWaitForSelector(page, '#confirmDelete');

        await this.pageClick(page, '#confirmDelete');
    },
    registerEnterpriseUser: async function (
        user: $TSFixMe,
        page: $TSFixMe
    ): void {
        const masterAdmin: $TSFixMe = {
            email: 'masteradmin@hackerbay.io',
            password: '1234567890',
        };
        await page.goto(utils.ACCOUNTS_URL + '/login', {
            waitUntil: 'networkidle2',
        });
        const signUp = await this.isElementOnPage(page, '#signUpLink');

        if (signUp) {
            await page.goto(utils.ACCOUNTS_URL + '/register', {
                waitUntil: 'networkidle2',
            });

            await this.pageWaitForSelector(page, '#email');

            await this.pageClick(page, 'input[name=email]');

            await this.pageType(page, 'input[name=email]', masterAdmin.email);

            await this.pageClick(page, 'input[name=name]');

            await this.pageType(page, 'input[name=name]', 'Master Admin');

            await this.pageClick(page, 'input[name=companyName]');

            await this.pageType(page, 'input[name=companyName]', 'Master');

            await this.pageClick(page, 'input[name=companyPhoneNumber]');

            await this.pageType(
                page,
                'input[name=companyPhoneNumber]',
                '99105688'
            );

            await this.pageClick(page, 'input[name=password]');

            await this.pageType(page, 'input[name=password]', '1234567890');

            await this.pageClick(page, 'input[name=confirmPassword]');

            await this.pageType(
                page,
                'input[name=confirmPassword]',
                '1234567890'
            );
            await Promise.all([
                this.pageClick(page, 'button[type=submit]'),
                page.waitForSelector('#users', {
                    visible: true,
                    timeout: this.timeout,
                }),
            ]);
        } else {
            await this.loginAdminUser(masterAdmin, page);
        }
        // create the user from admin dashboard
        //await this.loginAdminUser(masterAdmin, page);
        const { email } = user;

        await this.pageWaitForSelector(page, '#add_user');

        await this.pageClick(page, '#add_user');

        await this.pageWaitForSelector(page, '#email');

        await this.pageClick(page, 'input[name=email]');

        await this.pageType(page, 'input[name=email]', email);

        await this.pageClick(page, 'input[name=name]');

        await this.pageType(page, 'input[name=name]', 'Test Name');

        await this.pageClick(page, 'input[name=companyName]');

        await this.pageType(page, 'input[name=companyName]', 'Test Name');

        await this.pageClick(page, 'input[name=companyPhoneNumber]');

        await this.pageType(page, 'input[name=companyPhoneNumber]', '99105688');

        await this.pageClick(page, 'input[name=password]');

        await this.pageType(page, 'input[name=password]', '1234567890');

        await this.pageClick(page, 'input[name=confirmPassword]');

        await this.pageType(page, 'input[name=confirmPassword]', '1234567890');

        await this.pageClick(page, 'button[type=submit]');
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
    logout: async function (page: $TSFixMe): void {
        await page.goto(utils.ADMIN_DASHBOARD_URL, {
            waitUntil: ['networkidle2'],
        });
        await this.pageWaitForSelector(page, 'button#profile-menu', {
            visible: true,
            timeout: this.timeout,
        });

        await this.pageClick(page, 'button#profile-menu');

        await this.pageWaitForSelector(page, 'button#logout-button');

        await this.pageClick(page, 'button#logout-button');
        await page.reload();
    },
    saasLogout: async function (page: $TSFixMe): void {
        await page.goto(utils.DASHBOARD_URL, { waitUntil: ['networkidle2'] });
        await this.pageWaitForSelector(page, 'button#profile-menu', {
            visible: true,
            timeout: this.timeout,
        });

        await this.pageClick(page, 'button#profile-menu');

        await this.pageWaitForSelector(page, 'button#logout-button');

        await this.pageClick(page, 'button#logout-button');
        await page.reload({ waitUntil: 'networkidle2' });
    },
    selectDropdownValue: async function (
        selector: $TSFixMe,
        text: $TSFixMe,
        page: $TSFixMe
    ): void {
        await this.pageClick(page, selector, { delay: 100 });
        await page.keyboard.type(text);
        //'div.css-1gl4k7y' is used if present. However, it presence is not consistent
        await page.keyboard.press('Tab'); //String.fromCharCode(9) could not press tab
    },
    clear: async function (selector: $TSFixMe, page: $TSFixMe): void {
        const input = await this.page$(page, selector);
        await input.click({ clickCount: 3 });
        await input.type('');
    },
    renameProject: async function (
        newProjectName: $TSFixMe,
        page: $TSFixMe
    ): void {
        await this.pageWaitForSelector(page, '#projectSettings');

        await this.pageClickNavigate(page, '#projectSettings');

        await this.pageWaitForSelector(page, 'input[name=project_name]');
        await this.clear('input[name=project_name]', page);

        await this.pageType(page, 'input[name=project_name]', newProjectName);

        await this.pageClick(page, '#btnCreateProject');
    },
    addMonitor: async function (
        monitorName: $TSFixMe,
        description: $TSFixMe,
        page: $TSFixMe
    ): void {
        await this.pageWaitForSelector(page, '#form-new-monitor', {
            visible: true,
            timeout: this.timeout,
        });
        await this.pageWaitForSelector(page, 'input[id=name]', {
            visible: true,
            timeout: this.timeout,
        });

        await this.pageClick(page, 'input[id=name]');
        await page.focus('input[id=name]');

        await this.pageType(page, 'input[id=name]', monitorName);

        await this.pageClick(page, '[data-testId=type_manual]');
        await this.pageWaitForSelector(page, '#description', {
            visible: true,
            timeout: this.timeout,
        });

        await this.pageClick(page, '#description');

        await this.pageType(page, '#description', description);

        await this.pageClickNavigate(page, 'button[type=submit]');
        await this.pageWaitForSelector(page, `#cb${monitorName}`, {
            visible: true,
            timeout: this.timeout,
        });
    },
    addAdditionalMonitor: async function (
        monitorName: $TSFixMe,
        description: $TSFixMe,
        page: $TSFixMe
    ): void {
        await this.pageWaitForSelector(page, '#cbMonitors');

        await this.pageClick(page, '#newFormId');
        await this.pageWaitForSelector(page, '#form-new-monitor', {
            visible: true,
            timeout: this.timeout,
        });
        await this.pageWaitForSelector(page, 'input[id=name]', {
            visible: true,
            timeout: this.timeout,
        });

        await this.pageClick(page, 'input[id=name]');
        await page.focus('input[id=name]');

        await this.pageType(page, 'input[id=name]', monitorName);

        await this.pageClick(page, '[data-testId=type_manual]');
        await this.pageWaitForSelector(page, '#description', {
            visible: true,
            timeout: this.timeout,
        });

        await this.pageClick(page, '#description');

        await this.pageType(page, '#description', description);

        await this.pageClickNavigate(page, 'button[type=submit]');
        await this.pageWaitForSelector(page, `#cb${monitorName}`, {
            visible: true,
            timeout: this.timeout,
        });
    },
    navigateToComponentDetails: async function (
        component: $TSFixMe,
        page: $TSFixMe
    ): void {
        // Navigate to Components page
        await page.goto(utils.DASHBOARD_URL, { waitUntil: ['networkidle2'] });
        await this.pageWaitForSelector(page, '#components', {
            visible: true,
            timeout: this.timeout,
        });

        await this.pageClickNavigate(page, '#components');

        // Navigate to details page of component assumed created

        await this.pageWaitForSelector(page, `#more-details-${component}`);
        await this.page$Eval(
            page,
            `#more-details-${component}`,
            (e: $TSFixMe) => e.click()
        );
    },
    addMonitorToStatusPage: async function (
        componentName: $TSFixMe,
        monitorName: $TSFixMe,
        additionalMonitor: $TSFixMe,
        page: $TSFixMe
    ) {
        await page.goto(utils.DASHBOARD_URL, { waitUntil: ['networkidle2'] });
        const description = utils.generateRandomString();

        await this.pageWaitForSelector(page, '#statusPages');

        await this.pageClickNavigate(page, '#statusPages');

        await this.pageWaitForSelector(page, '#statusPagesListContainer');

        await this.pageWaitForSelector(page, '#viewStatusPage');

        await this.pageClickNavigate(page, '#viewStatusPage');
        await this.pageWaitForSelector(page, '#addMoreMonitors', {
            visible: true,
            timeout: this.timeout,
        });

        await this.pageClick(page, '#addMoreMonitors');
        await this.selectDropdownValue(
            `#monitor-name-${additionalMonitor}`,
            `${componentName} / ${monitorName}`,
            page
        );

        await this.pageClick(page, `#monitor-description-${additionalMonitor}`);

        await this.pageType(
            page,
            `#monitor-description-${additionalMonitor}`,
            description
        );

        await this.pageClick(
            page,
            `#manual-monitor-checkbox-${additionalMonitor}`
        );

        await this.pageClick(page, '#btnAddStatusPageMonitors');
    },
    clickStatusPageUrl: async function (page: $TSFixMe): void {
        await this.pageWaitForSelector(page, '#publicStatusPageUrl');

        let link: $TSFixMe = await this.page$(page, '#publicStatusPageUrl > span > a');
        link = await link.getProperty('href');
        link = await link.jsonValue();
        await page.goto(link, { waitUntil: ['networkidle2'] });
    },
    navigateToStatusPage: async function (page: $TSFixMe): void {
        await this.pageWaitForSelector(page, '#statusPages');

        await this.pageClickNavigate(page, '#statusPages');

        await this.pageWaitForSelector(page, '#statusPagesListContainer');

        await this.pageWaitForSelector(page, '#viewStatusPage');

        await this.pageClickNavigate(page, '#viewStatusPage');
        await this.clickStatusPageUrl(page);
    },
    growthPlanUpgrade: async function (page: $TSFixMe): void {
        await page.goto(utils.DASHBOARD_URL, { waitUntil: ['networkidle2'] });
        await this.pageWaitForSelector(page, '#projectSettings', {
            visible: true,
            timeout: this.timeout,
        });

        await this.pageClickNavigate(page, '#projectSettings');

        await this.pageWaitForSelector(page, '#billing');

        await this.pageClickNavigate(page, '#billing');
        await this.pageWaitForSelector(page, 'input#Growth_month', {
            visible: true,
        });

        await this.pageClick(page, 'input#Growth_month');

        await this.pageClick(page, '#changePlanBtn');
        await this.pageWaitForSelector(page, '.ball-beat', { hidden: true });
    },
    gotoTab: async function (tabId: $TSFixMe, page: $TSFixMe): void {
        await this.pageWaitForSelector(page, `#react-tabs-${tabId}`, {
            visible: true,
            timeout: this.timeout,
        });
        await this.page$Eval(page, `#react-tabs-${tabId}`, (e: $TSFixMe) =>
            e.click()
        );
    },
    themeNavigationAndConfirmation: async function (
        page: $TSFixMe,
        theme: $TSFixMe
    ): void {
        await this.pageWaitForSelector(page, '.branding-tab', {
            visible: true,
        });
        await this.page$$Eval(page, '.branding-tab', (elems: $TSFixMe) =>
            elems[0].click()
        );
        await this.pageWaitForSelector(page, `#${theme}`, {
            visible: true,
            timeout: this.timeout,
        });

        await this.pageClick(page, `#${theme}`);
        await this.pageWaitForSelector(page, '#changePlanBtn', {
            visible: true,
            timeout: this.timeout,
        });

        await this.pageClick(page, '#changePlanBtn');

        await this.pageClick(page, '.basic-tab');
    },
    registerAndLoggingTeamMember: async function (
        user: $TSFixMe,
        page: $TSFixMe
    ): void {
        const { email, password } = user;
        await page.goto(utils.ACCOUNTS_URL + '/register'),
            {
                waitUntil: 'networkidle2',
            };
        // Registration

        await this.pageWaitForSelector(page, '#email');

        await this.pageClick(page, 'input[name=email]');

        await this.pageType(page, 'input[name=email]', email);

        await this.pageClick(page, 'input[name=name]');

        await this.pageType(page, 'input[name=name]', 'Test Name');

        await this.pageClick(page, 'input[name=companyName]');

        await this.pageType(page, 'input[name=companyName]', 'Test Name');

        await this.pageClick(page, 'input[name=companyPhoneNumber]');

        await this.pageType(page, 'input[name=companyPhoneNumber]', '99105688');

        await this.pageClick(page, 'input[name=password]');

        await this.pageType(page, 'input[name=password]', password);

        await this.pageClick(page, 'input[name=confirmPassword]');

        await this.pageType(page, 'input[name=confirmPassword]', password);

        await this.pageClick(page, 'button[type=submit]'),
            await this.pageWaitForSelector(page, '#success-step');

        // Login
        await page.goto(utils.ACCOUNTS_URL + '/login', {
            waitUntil: 'networkidle2',
        });

        await this.pageWaitForSelector(page, '#login-form');

        await this.pageClick(page, 'input[name=email]');

        await this.pageType(page, 'input[name=email]', email);

        await this.pageClick(page, 'input[name=password]');

        await this.pageType(page, 'input[name=password]', password);
        await this.pageWaitForSelector(page, 'button[type=submit]', {
            visible: true,
            timeout: this.timeout,
        });
        await Promise.all([
            page.waitForNavigation({ waitUntil: 'networkidle2' }),

            this.pageClick(page, 'button[type=submit]'),
        ]);
        expect(page.url().startsWith(utils.ACCOUNTS_URL + '/login')).toEqual(
            false
        );
    },

    adminLogout: async function (page: $TSFixMe): void {
        await page.goto(utils.ADMIN_DASHBOARD_URL, {
            waitUntil: ['networkidle2'],
        });
        await this.pageWaitForSelector(page, 'button#profile-menu', {
            visible: true,
            timeout: this.timeout,
        });

        await this.pageClick(page, 'button#profile-menu');

        await this.pageWaitForSelector(page, 'button#logout-button');

        await this.pageClick(page, 'button#logout-button');
        await page.reload({ waitUntil: 'networkidle2' });
    },
    addComponent: async function (
        component: $TSFixMe,
        page: $TSFixMe,
        projectName = null
    ): void {
        await page.goto(utils.DASHBOARD_URL, { waitUntil: ['networkidle2'] });
        await this.pageWaitForSelector(page, '#components', {
            visible: true,
            timeout: this.timeout,
        });

        await this.pageClickNavigate(page, '#components');

        // Fill and submit New Component form

        await this.pageWaitForSelector(page, '#form-new-component');

        await this.pageClick(page, 'input[id=name]');
        await page.focus('input[id=name]');

        await this.pageType(page, 'input[id=name]', component);

        if (projectName) {
            await this.selectDropdownValue('#subProjectId', projectName, page);
        }

        await Promise.all([
            page.$eval('button[type=submit]', (e: $TSFixMe) => e.click()),
            page.waitForNavigation(),
        ]);
    },
    addAdditionalComponent: async function (
        component: $TSFixMe,
        page: $TSFixMe,
        projectName = null
    ): void {
        await page.goto(utils.DASHBOARD_URL, { waitUntil: ['networkidle2'] });
        await this.pageWaitForSelector(page, '#components', {
            visible: true,
            timeout: this.timeout,
        });

        await this.pageClickNavigate(page, '#components');

        // Fill and submit New Component form

        await this.pageWaitForSelector(page, '#cbComponents');

        await this.pageClick(page, '#newFormId');

        await this.pageWaitForSelector(page, '#form-new-component');

        await this.pageClick(page, 'input[id=name]');
        await page.focus('input[id=name]');

        await this.pageType(page, 'input[id=name]', component);

        if (projectName) {
            await this.selectDropdownValue('#subProjectId', projectName, page);
        }

        await Promise.all([
            page.$eval('button[type=submit]', (e: $TSFixMe) => e.click()),
            page.waitForNavigation(),
        ]);
    },

    navigateToMonitorDetails: async function (
        component: $TSFixMe,
        monitor: $TSFixMe,
        page: $TSFixMe
    ): void {
        // Navigate to Components page
        await this.navigateToComponentDetails(component, page);

        // Navigate to details page of monitor assumed created
        // await this.pageClickNavigate(page, `#more-details-${monitor}`);
        await this.pageWaitForSelector(page, `#more-details-${monitor}`, {
            visible: true,
            timeout: this.timeout,
        });

        await this.pageClick(page, `#more-details-${monitor}`);

        await this.pageWaitForSelector(page, `#monitor-title-${monitor}`, {
            visible: true,
        });
    },
    navigateToApplicationLogDetails: async function (
        component: $TSFixMe,
        applicationLog: $TSFixMe,
        page: $TSFixMe
    ): void {
        // Navigate to Components page
        await this.navigateToComponentDetails(component, page);

        // then goto list of log containers

        await this.pageWaitForSelector(page, '#logs');

        await this.pageClickNavigate(page, '#logs');

        // Navigate to details page of log container assumed created

        await this.pageWaitForSelector(page, `#more-details-${applicationLog}`);

        await this.pageClickNavigate(page, `#more-details-${applicationLog}`);

        await this.pageWaitForSelector(
            page,
            `#application-log-title-${applicationLog}`
        );
    },
    navigateToErrorTrackerDetails: async function (
        component: $TSFixMe,
        errorTracker: $TSFixMe,
        page: $TSFixMe
    ): void {
        // Navigate to Components page
        await this.navigateToComponentDetails(component, page);

        // then goto list of error trackers

        await this.pageWaitForSelector(page, '#errorTracking');

        await this.pageClickNavigate(page, '#errorTracking');

        // Navigate to details page of error tracker assumed created

        await this.pageWaitForSelector(page, `#more-details-${errorTracker}`);

        await this.pageClickNavigate(page, `#more-details-${errorTracker}`);

        await this.pageWaitForSelector(
            page,
            `#error-tracker-title-${errorTracker}`
        );
    },

    createUserFromAdminDashboard: async function (
        user: $TSFixMe,
        page: $TSFixMe
    ): void {
        // create the user from admin dashboard
        const { email } = user;

        await this.pageWaitForSelector(page, '#add_user');

        await this.pageClick(page, '#add_user');

        await this.pageWaitForSelector(page, '#email');

        await this.pageClick(page, 'input[name=email]');

        await this.pageType(page, 'input[name=email]', email);

        await this.pageClick(page, 'input[name=name]');

        await this.pageType(page, 'input[name=name]', 'Test Name');

        await this.pageClick(page, 'input[name=companyName]');

        await this.pageType(page, 'input[name=companyName]', 'Test Name');

        await this.pageClick(page, 'input[name=companyPhoneNumber]');

        await this.pageType(page, 'input[name=companyPhoneNumber]', '99105688');

        await this.pageClick(page, 'input[name=password]');

        await this.pageType(page, 'input[name=password]', '1234567890');

        await this.pageClick(page, 'input[name=confirmPassword]');

        await this.pageType(page, 'input[name=confirmPassword]', '1234567890');

        await this.pageClick(page, 'button[type=submit]');
        await this.pageWaitForSelector(page, '#frmUser', { hidden: true });
    },
    addSchedule: async function (
        callSchedule: $TSFixMe,
        projectName: $TSFixMe,
        page: $TSFixMe
    ): void {
        await page.goto(utils.DASHBOARD_URL, {
            waitUntil: ['networkidle2'],
        });
        await this.pageWaitForSelector(page, '#onCallDuty', {
            visible: true,
        });

        await this.pageClickNavigate(page, '#onCallDuty');

        await this.pageClick(page, `#btnCreateSchedule_${projectName}`);
        page.waitForSelector('#name', { timeout: this.timeout });

        await this.pageType(page, '#name', callSchedule);

        await this.pageClick(page, '#btnCreateSchedule');
        await this.pageWaitForSelector(page, `#duty_${callSchedule}`, {
            visible: true,
            timeout: this.timeout,
        });
    },
    addSubProject: async function (
        subProjectName: $TSFixMe,
        page: $TSFixMe
    ): void {
        const subProjectNameSelector = await this.isElementOnPage(
            page,
            '#btn_Add_SubProjects',

            { hidden: true } //The function is usually called after dashboard loads. Hence, '#btn_Add_SubProjects' is hidden.
        );
        if (subProjectNameSelector) {
            await this.pageWaitForSelector(page, '#btn_Add_SubProjects');

            await this.pageClick(page, '#btn_Add_SubProjects');

            await this.pageWaitForSelector(page, '#title');

            await this.pageType(page, '#title', subProjectName);

            await this.pageClick(page, '#btnAddSubProjects');
        } else {
            await this.pageWaitForSelector(page, '#projectSettings');

            await this.pageClickNavigate(page, '#projectSettings');

            await this.pageWaitForSelector(page, '#btn_Add_SubProjects');

            await this.pageClick(page, '#btn_Add_SubProjects');

            await this.pageWaitForSelector(page, '#title');

            await this.pageType(page, '#title', subProjectName);

            await this.pageClick(page, '#btnAddSubProjects');
        }
        await this.pageWaitForSelector(page, '#btnAddSubProjects', {
            hidden: true,
        });
    },
    addUserToProject: async function (data: $TSFixMe, page: $TSFixMe): void {
        const { email, role, subProjectName } = data;

        await this.pageWaitForSelector(page, '#teamMembers');

        await this.pageClickNavigate(page, '#teamMembers');

        await this.pageWaitForSelector(page, `#btn_${subProjectName}`);

        await this.pageClick(page, `#btn_${subProjectName}`);

        await this.pageWaitForSelector(page, `#frm_${subProjectName}`);

        await this.pageClick(page, `#emails_${subProjectName}`);

        await this.pageType(page, `#emails_${subProjectName}`, email);

        await this.pageClick(page, `#${role}_${subProjectName}`);

        await this.pageClick(page, `#btn_modal_${subProjectName}`);
    },
    switchProject: async function (
        projectName: $TSFixMe,
        page: $TSFixMe
    ): void {
        await page.goto(utils.DASHBOARD_URL, { waitUntil: ['networkidle2'] });
        await this.pageWaitForSelector(page, '#AccountSwitcherId', {
            visible: true,
            timeout: this.timeout,
        });

        await this.pageClick(page, '#AccountSwitcherId');

        await this.pageWaitForSelector(
            page,
            `#accountSwitcher div#${projectName}`
        );

        await this.pageClick(page, `#accountSwitcher div#${projectName}`);
        await this.pageWaitForSelector(page, '#components', {
            visible: true,
            timeout: this.timeout,
        });
    },
    addHttpTestServerMonitorToComponent: async function (
        component: $TSFixMe,
        monitorName: $TSFixMe,
        page: $TSFixMe
    ): void {
        component && (await this.addComponent(component, page));

        await this.pageWaitForSelector(page, 'input[id=name]');

        await this.pageClick(page, 'input[id=name]');
        await page.focus('input[id=name]');

        await this.pageType(page, 'input[id=name]', monitorName);

        await this.pageWaitForSelector(page, 'button[id=showMoreMonitors]');

        await this.pageClick(page, 'button[id=showMoreMonitors]');

        await this.pageClick(page, '[data-testId=type_url]');
        await this.pageWaitForSelector(page, '#url', {
            visible: true,
            timeout: this.timeout,
        });

        await this.pageClick(page, '#url');

        await this.pageType(page, '#url', 'http://localhost:3010');

        await this.pageClickNavigate(page, 'button[type=submit]');
        await this.pageWaitForSelector(page, `#monitor-title-${monitorName}`, {
            visible: true,
        });
    },
    addMonitorToComponent: async function (
        component: $TSFixMe,
        monitorName: $TSFixMe,
        page: $TSFixMe
    ): void {
        component && (await this.addComponent(component, page));

        await this.pageWaitForSelector(page, 'input[id=name]');

        await this.pageClick(page, 'input[id=name]');
        await page.focus('input[id=name]');

        await this.pageType(page, 'input[id=name]', monitorName);

        await this.pageWaitForSelector(page, 'button[id=showMoreMonitors]');

        await this.pageClick(page, 'button[id=showMoreMonitors]');

        await this.pageClick(page, '[data-testId=type_url]');
        await this.pageWaitForSelector(page, '#url', {
            visible: true,
            timeout: this.timeout,
        });

        await this.pageClick(page, '#url');

        await this.pageType(page, '#url', 'https://google.com');

        await this.pageClickNavigate(page, 'button[type=submit]');
        await this.pageWaitForSelector(page, `#monitor-title-${monitorName}`, {
            visible: true,
        });
    },
    addNewMonitorToComponent: async function (
        page: $TSFixMe,
        componentName: $TSFixMe,
        monitorName: $TSFixMe
    ): void {
        await page.goto(utils.DASHBOARD_URL, {
            waitUntil: 'networkidle2',
            timeout: this.timeout,
        });

        await this.pageWaitForSelector(page, '#components');

        await this.pageClickNavigate(page, '#components');

        await this.pageWaitForSelector(page, '#component0');

        await this.pageWaitForSelector(page, `#more-details-${componentName}`);

        await this.pageClickNavigate(page, `#more-details-${componentName}`);

        await this.pageWaitForSelector(page, '#form-new-monitor');

        await this.pageWaitForSelector(page, 'input[id=name]');

        await this.pageClick(page, 'input[id=name]');
        await page.focus('input[id=name]');

        await this.pageType(page, 'input[id=name]', monitorName);

        await this.pageClick(page, '[data-testId=type_url]');
        await this.pageWaitForSelector(page, '#url', {
            visible: true,
            timeout: this.timeout,
        });

        await this.pageClick(page, '#url');

        await this.pageType(page, '#url', 'https://google.com');

        await this.pageClickNavigate(page, 'button[type=submit]');
        await this.pageWaitForSelector(page, `#monitor-title-${monitorName}`, {
            visible: true,
        });
    },
    addAdditionalMonitorToComponent: async function (
        page: $TSFixMe,
        componentName: $TSFixMe,
        monitorName: $TSFixMe
    ): void {
        await page.goto(utils.DASHBOARD_URL, {
            waitUntil: 'networkidle2',
            timeout: this.timeout,
        });

        await this.pageWaitForSelector(page, '#components');

        await this.pageClickNavigate(page, '#components');

        await this.pageWaitForSelector(page, '#component0');

        await this.pageWaitForSelector(page, `#more-details-${componentName}`);

        await this.pageClickNavigate(page, `#more-details-${componentName}`);

        await this.pageWaitForSelector(page, '#cbMonitors');

        await this.pageClick(page, '#newFormId');

        await this.pageWaitForSelector(page, '#form-new-monitor');

        await this.pageWaitForSelector(page, 'input[id=name]');

        await this.pageClick(page, 'input[id=name]');
        await page.focus('input[id=name]');

        await this.pageType(page, 'input[id=name]', monitorName);

        await this.pageClick(page, '[data-testId=type_url]');
        await this.pageWaitForSelector(page, '#url', {
            visible: true,
            timeout: this.timeout,
        });

        await this.pageClick(page, '#url');

        await this.pageType(page, '#url', 'https://google.com');

        await this.pageClickNavigate(page, 'button[type=submit]');
        await this.pageWaitForSelector(page, `#monitor-title-${monitorName}`, {
            visible: true,
        });
    },
    /**
     *  adds an api monitor with js expressions for up and degraded events
     * @param {*} page a page instance of puppeteer
     * @param {string} monitorName the name of the new monitor
     * @param {{createAlertForOnline : boolean, createAlertForDegraded : boolean, createAlertForDown : boolean}} options
     */
    addAPIMonitorWithJSExpression: async function (
        page: $TSFixMe,
        monitorName: $TSFixMe,
        options = {}
    ): void {
        await this.pageWaitForSelector(page, '#form-new-monitor');

        await this.pageClick(page, 'input[id=name]');
        await page.focus('input[id=name]');

        await this.pageType(page, 'input[id=name]', monitorName);

        await this.pageClick(page, 'input[data-testId=type_api]');
        await this.selectDropdownValue('#method', 'get', page);
        await this.pageWaitForSelector(page, '#url', {
            visible: true,
            timeout: this.timeout,
        });

        await this.pageClick(page, '#url');

        await this.pageType(page, '#url', utils.HTTP_TEST_SERVER_URL);

        await this.pageWaitForSelector(page, '#advanceOptions');

        await this.pageClick(page, '#advanceOptions');

        // online criteria

        await this.pageWaitForSelector(page, '[data-testId=add_criterion_up]');
        await this.page$$Eval(
            page,
            '[data-testId=add_criterion_up]',
            (addCriterionButtons: $TSFixMe) => {
                const lastAddCriterionButton =
                    addCriterionButtons[addCriterionButtons.length - 1];
                lastAddCriterionButton.click();
            }
        );

        await this.pageWaitForSelector(
            page,
            'ul[data-testId=up_criteria_list]> div:last-of-type #responseType'
        );
        await this.selectDropdownValue(
            'ul[data-testId=up_criteria_list]> div:last-of-type #responseType',
            'responseBody',
            page
        );

        await this.pageWaitForSelector(
            page,
            'ul[data-testId=up_criteria_list]> div:last-of-type #filter'
        );
        await this.selectDropdownValue(
            'ul[data-testId=up_criteria_list]> div:last-of-type #filter',
            'evaluateResponse',
            page
        );

        await this.pageWaitForSelector(
            page,
            'ul[data-testId=up_criteria_list]> div:last-of-type #value'
        );

        await this.pageClick(
            page,
            'ul[data-testId=up_criteria_list]> div:last-of-type #value'
        );

        await this.pageType(
            page,
            'ul[data-testId=up_criteria_list]> div:last-of-type #value',
            "response.body.status === 'ok';"
        );

        if (options.createAlertForOnline) {
            await this.pageClick(
                page,
                '[data-testId=criterionAdvancedOptions_up]'
            );

            await this.pageWaitForSelector(
                page,
                'input[name^=createAlert_up]',
                {
                    visible: true,
                    timeout: this.timeout,
                }
            );
            await this.page$Eval(
                page,
                'input[name^=createAlert_up]',
                (element: $TSFixMe) => element.click()
            );
        }

        // degraded criteria
        await this.page$$Eval(
            page,
            '[data-testId=add_criterion_degraded]',
            (addCriterionButtons: $TSFixMe) => {
                const lastAddCriterionButton =
                    addCriterionButtons[addCriterionButtons.length - 1];
                lastAddCriterionButton.click();
            }
        );

        await this.pageWaitForSelector(
            page,
            'ul[data-testId=degraded_criteria_list] > div:last-of-type #responseType'
        );
        await this.selectDropdownValue(
            'ul[data-testId=degraded_criteria_list] > div:last-of-type #responseType',
            'responseBody',
            page
        );

        await this.pageWaitForSelector(
            page,
            'ul[data-testId=degraded_criteria_list] > div:last-of-type #filter'
        );
        await this.selectDropdownValue(
            'ul[data-testId=degraded_criteria_list] > div:last-of-type #filter',
            'evaluateResponse',
            page
        );

        await this.pageWaitForSelector(
            page,
            'ul[data-testId=degraded_criteria_list] > div:last-of-type #value'
        );

        await this.pageClick(
            page,
            'ul[data-testId=degraded_criteria_list] > div:last-of-type #value'
        );

        await this.pageType(
            page,
            'ul[data-testId=degraded_criteria_list] > div:last-of-type #value',
            "response.body.message === 'draining';"
        );

        await Promise.all([
            this.pageClick(page, 'button[type=submit]'),
            page.waitForNavigation(),
        ]);
    },
    addMonitorToSubProject: async function (
        monitorName: $TSFixMe,
        projectName: $TSFixMe,
        componentName: $TSFixMe,
        page: $TSFixMe
    ) {
        await page.reload({ waitUntil: 'domcontentloaded' });

        await this.pageWaitForSelector(page, '#monitors');

        await this.pageClick(page, '#monitors'); // Fix this
        // await this.navigateToComponentDetails(componentName, page);

        await this.pageWaitForSelector(page, '#form-new-monitor');

        await this.pageClick(page, 'input[id=name]');
        await page.focus('input[id=name]');

        await this.pageType(page, 'input[id=name]', monitorName);
        //Please add a new monitor type here. IOT Device Monitor has been removed.

        await this.pageClick(page, 'button[type=submit]');
        await this.pageWaitForSelector(page, `#monitor-title-${monitorName}`, {
            visible: true,
        });
    },
    addIncidentToProject: async function (
        monitorName: $TSFixMe,
        projectName: $TSFixMe,
        page: $TSFixMe
    ): void {
        await this.pageWaitForSelector(page, '#incidentLog');
        await this.page$Eval(page, '#incidentLog', (e: $TSFixMe) => e.click());

        await this.pageWaitForSelector(
            page,
            `#btnCreateIncident_${projectName}`,
            {
                visible: true,
                timeout: this.timeout,
            }
        );
        await this.page$Eval(
            page,
            `#btnCreateIncident_${projectName}`,
            (e: $TSFixMe) => e.click()
        );

        await this.pageWaitForSelector(page, '#frmIncident');

        await this.pageClick(page, '#monitorDropdown');

        await this.pageClick(page, `#${monitorName}`);

        await this.pageClick(page, '#incidentType');
        await this.page$Eval(page, '#createIncident', (e: $TSFixMe) =>
            e.click()
        );

        await this.pageWaitForSelector(page, '#createIncident', {
            hidden: true,
        });
    },
    addIncidentPriority: async function (
        incidentPriority: $TSFixMe,
        page: $TSFixMe
    ): void {
        await page.goto(utils.DASHBOARD_URL, {
            waitUntil: 'networkidle2',
        });

        await this.pageWaitForSelector(page, '#projectSettings');

        await this.pageClickNavigate(page, '#projectSettings');

        await this.pageWaitForSelector(page, '#more');

        await this.pageClick(page, '#more');

        await this.pageWaitForSelector(page, '#incidentSettings');

        await this.pageClickNavigate(page, '#incidentSettings');
        // To navigate to incident Priority tab
        await this.pageWaitForSelector(page, '.incident-priority-tab', {
            visible: true,
        });
        await this.page$$Eval(
            page,
            '.incident-priority-tab',
            (elems: $TSFixMe) => elems[0].click()
        );

        await this.pageWaitForSelector(page, '#addNewPriority');

        await this.pageClick(page, '#addNewPriority');

        await this.pageWaitForSelector(page, '#CreateIncidentPriority');

        await this.pageType(page, 'input[name=name]', incidentPriority);

        await this.pageClick(page, '#CreateIncidentPriority');
        await this.pageWaitForSelector(page, '#CreateIncidentPriority', {
            hidden: true,
        });
    },
    addStatusPageToProject: async function (
        statusPageName: $TSFixMe,
        projectName: $TSFixMe,
        page: $TSFixMe
    ): void {
        const createStatusPageSelector = await page.$(
            `#btnCreateStatusPage_${projectName}`
        );
        if (createStatusPageSelector) {
            await this.pageClick(page, `#btnCreateStatusPage_${projectName}`);

            await this.pageWaitForSelector(page, '#btnCreateStatusPage');

            await this.pageType(page, '#name', statusPageName);

            await this.pageClick(page, '#btnCreateStatusPage');
        } else {
            await this.pageWaitForSelector(page, '#statusPages');

            await this.pageClickNavigate(page, '#statusPages');

            await this.pageWaitForSelector(
                page,
                `#btnCreateStatusPage_${projectName}`
            );

            await this.pageClick(page, `#btnCreateStatusPage_${projectName}`);

            await this.pageWaitForSelector(page, '#btnCreateStatusPage');

            await this.pageType(page, '#name', statusPageName);

            await this.pageClick(page, '#btnCreateStatusPage');
        }
        await this.pageWaitForSelector(page, '#btnCreateStatusPage', {
            hidden: true,
        });
    },
    addScheduleToProject: async function (
        scheduleName: $TSFixMe,
        projectName: $TSFixMe,
        page: $TSFixMe
    ): void {
        const createStatusPageSelector = await this.page$(
            page,
            `#btnCreateStatusPage_${projectName}`,
            { hidden: true }
        );
        if (createStatusPageSelector) {
            await this.pageWaitForSelector(
                page,
                `#btnCreateSchedule_${projectName}`
            );

            await this.pageClick(page, `#btnCreateSchedule_${projectName}`);

            await this.pageWaitForSelector(page, '#btnCreateSchedule');

            await this.pageType(page, '#name', scheduleName);

            await this.pageClick(page, '#btnCreateSchedule');
        } else {
            await this.pageWaitForSelector(page, '#onCallDuty');

            await this.pageClickNavigate(page, '#onCallDuty');

            await this.pageWaitForSelector(
                page,
                `#btnCreateSchedule_${projectName}`
            );

            await this.pageClick(page, `#btnCreateSchedule_${projectName}`);

            await this.pageWaitForSelector(page, '#btnCreateSchedule');

            await this.pageType(page, '#name', scheduleName);

            await this.pageClick(page, '#btnCreateSchedule');
        }
    },
    addScheduledMaintenance: async function (
        monitorName: $TSFixMe,
        scheduledEventName: $TSFixMe,
        componentName: $TSFixMe,
        page: $TSFixMe
    ) {
        await page.goto(utils.DASHBOARD_URL, {
            waitUntil: ['networkidle2'],
        });
        await this.pageWaitForSelector(page, '#scheduledMaintenance', {
            visible: true,
        });

        await this.pageClickNavigate(page, '#scheduledMaintenance');
        await this.pageWaitForSelector(page, '#addScheduledEventButton', {
            visible: true,
        });

        await this.pageClick(page, '#addScheduledEventButton');

        await this.pageWaitForSelector(page, '#scheduledEventForm', {
            visible: true,
        });

        await this.pageWaitForSelector(page, '#name');

        await this.pageClick(page, '#name');

        await this.pageType(page, '#name', scheduledEventName);
        if (monitorName) {
            await this.pageWaitForSelector(
                page,
                'label[for=selectAllMonitors]'
            );

            await this.pageClick(page, '#selectSpecificMonitors');

            await this.pageClick(page, '#monitorDropdown');

            await this.pageClick(page, `#${monitorName}`);

            await this.pageClick(page, 'label[for=monitorIds]');
        }

        await this.pageClick(page, '#description');

        await this.pageType(
            page,
            '#description',
            'This is an example description for a test'
        );

        await this.pageWaitForSelector(page, 'input[name=startDate]');

        await this.pageClick(page, 'input[name=startDate]');

        await this.pageClick(
            page,
            'div.MuiDialogActions-root button:nth-child(2)'
        );
        await this.pageWaitForSelector(
            page,
            'div.MuiDialogActions-root button:nth-child(2)',
            { hidden: true }
        );

        await this.pageClick(page, 'input[name=endDate]');

        await this.pageClick(
            page,
            'div.MuiDialogActions-root button:nth-child(2)'
        );
        await this.pageWaitForSelector(
            page,
            'div.MuiDialogActions-root button:nth-child(2)',
            { hidden: true }
        );

        await this.pageClick(page, '#createScheduledEventButton');
        await this.pageWaitForSelector(page, '.ball-beat', {
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
    addProject: async function (
        page: $TSFixMe,
        projectName = null,
        checkCard = false
    ): void {
        await page.goto(utils.DASHBOARD_URL, {
            waitUntil: ['networkidle2'],
        });

        await this.pageWaitForSelector(page, '#AccountSwitcherId');

        await this.pageClick(page, '#AccountSwitcherId');

        await this.pageWaitForSelector(page, '#create-project');

        await this.pageClick(page, '#create-project');

        await this.pageWaitForSelector(page, '#name');

        await this.pageType(page, '#name', projectName ? projectName : 'test');

        await this.pageClick(page, 'label[for=Startup_month]');
        const startupOption = await this.pageWaitForSelector(
            page,
            'label[for=Startup_month]',
            { visible: true, timeout: this.timeout }
        );
        startupOption.click();
        if (checkCard) {
            await this.pageWaitForSelector(
                page,
                'iframe[name=__privateStripeFrame5]'
            );

            const elementHandle = await this.page$(
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
        await this.pageWaitForSelector(page, '#btnCreateProject', {
            visible: true,
            timeout: this.timeout,
        });
        await Promise.all([
            this.pageClick(page, '#btnCreateProject'),
            page.waitForNavigation({ waitUntil: 'networkidle2' }),
        ]);
    },
    addResourceCategory: async function (
        resourceCategory: $TSFixMe,
        page: $TSFixMe
    ): void {
        await page.goto(utils.DASHBOARD_URL, {
            waitUntil: ['networkidle2'],
        });

        await this.pageWaitForSelector(page, '#projectSettings');

        await this.pageClickNavigate(page, '#projectSettings');

        await this.pageWaitForSelector(page, '#more');

        await this.pageClick(page, '#more');

        await this.pageWaitForSelector(page, 'li#resources a');

        await this.pageClickNavigate(page, 'li#resources a');

        await this.pageWaitForSelector(page, '#createResourceCategoryButton');

        await this.pageClick(page, '#createResourceCategoryButton');

        await this.pageWaitForSelector(page, '#resourceCategoryName');

        await this.pageType(page, '#resourceCategoryName', resourceCategory);

        await this.pageClick(page, '#addResourceCategoryButton');
        await this.pageWaitForSelector(page, '#addResourceCategoryButton', {
            hidden: true,
        });

        const createdResourceCategorySelector =
            '#resourceCategoryList #resource-category-name';
        await this.pageWaitForSelector(page, createdResourceCategorySelector, {
            visible: true,
        });
    },
    addGrowthProject: async function (
        projectName = 'GrowthProject',
        page: $TSFixMe
    ): void {
        await page.goto(utils.DASHBOARD_URL, {
            waitUntil: ['networkidle2'],
        });

        await this.pageWaitForSelector(page, '#AccountSwitcherId');

        await this.pageClick(page, '#AccountSwitcherId');

        await this.pageWaitForSelector(page, '#create-project');

        await this.pageClick(page, '#create-project');

        await this.pageWaitForSelector(page, '#name');

        await this.pageType(page, '#name', projectName);

        await this.pageClick(page, 'label[for=Growth_month]');
        const growthOption = await this.pageWaitForSelector(
            page,
            'label[for=Growth_month]',
            { visible: true, timeout: this.timeout }
        );
        growthOption.click();
        await Promise.all([
            await this.pageClick(page, '#btnCreateProject'),
            await page.waitForNavigation({ waitUntil: 'networkidle2' }),
        ]);
    },
    addScaleProject: async function (
        projectName = 'ScaleProject',
        page: $TSFixMe
    ): void {
        await page.goto(utils.DASHBOARD_URL, {
            waitUntil: ['networkidle2'],
        });

        await this.pageWaitForSelector(page, '#AccountSwitcherId');

        await this.pageClick(page, '#AccountSwitcherId');

        await this.pageWaitForSelector(page, '#create-project');

        await this.pageClick(page, '#create-project');

        await this.pageWaitForSelector(page, '#name');

        await this.pageType(page, '#name', projectName);

        await this.pageClick(page, 'label[for=Scale_month]');
        const scaleOption = await this.pageWaitForSelector(
            page,
            'label[for=Scale_month]',
            { visible: true, timeout: this.timeout }
        );
        scaleOption.click();
        await Promise.all([
            await this.pageClick(page, '#btnCreateProject'),
            await page.waitForNavigation({ waitUntil: 'networkidle2' }),
        ]);
    },
    addScheduledMaintenanceNote: async function (
        page: $TSFixMe,
        type: $TSFixMe,
        eventBtn: $TSFixMe,
        noteDescription: $TSFixMe,
        eventState = 'update'
    ) {
        await page.goto(utils.DASHBOARD_URL, {
            waitUntil: ['networkidle2'],
        });
        await this.pageWaitForSelector(page, '#scheduledMaintenance', {
            visible: true,
        });

        await this.pageClickNavigate(page, '#scheduledMaintenance');

        await this.pageWaitForSelector(page, `#${eventBtn}`, {
            visible: true,
        });

        await this.pageClick(page, `#${eventBtn}`);
        // navigate to the note tab section
        // await this.gotoTab(utils.scheduleEventTabIndexes.NOTES, page);

        await this.pageClick(page, '.timeline-tab');
        await this.pageWaitForSelector(page, `#add-${type}-message`, {
            visible: true,
        });

        await this.pageClick(page, `#add-${type}-message`);
        await this.pageWaitForSelector(page, '#event_state', {
            visible: true,
        });
        await this.selectDropdownValue('#event_state', eventState, page);

        await this.pageClick(page, '#new-internal');

        await this.pageType(page, '#new-internal', noteDescription);

        await this.pageClick(page, '#internal-addButton');
        await this.pageWaitForSelector(
            page,
            '#form-new-schedule-internal-message',
            {
                hidden: true,
            }
        );
    },
    addIncident: async function (
        monitorName: $TSFixMe,
        incidentType: $TSFixMe,
        page: $TSFixMe,
        incidentPriority: $TSFixMe
    ) {
        await page.goto(utils.DASHBOARD_URL, {
            waitUntil: ['networkidle2'],
        });
        await this.pageWaitForSelector(page, '#components', {
            visible: true,
            timeout: this.timeout,
        });

        await this.pageClickNavigate(page, '#components');
        await this.pageWaitForSelector(page, `#view-resource-${monitorName}`, {
            visible: true,
        });

        await this.pageClickNavigate(page, `#view-resource-${monitorName}`);

        await this.pageWaitForSelector(
            page,
            `#monitorCreateIncident_${monitorName}`
        );

        await this.pageClick(page, `#monitorCreateIncident_${monitorName}`);

        await this.pageWaitForSelector(page, '#createIncident');
        await this.selectDropdownValue('#incidentType', incidentType, page);
        if (incidentPriority) {
            await this.selectDropdownValue(
                '#incidentPriority',
                incidentPriority,
                page
            );
        }

        await this.pageClick(page, '#createIncident');
        await this.pageWaitForSelector(page, '.ball-beat', {
            visible: true,
            timeout: this.timeout,
        });
        await this.pageWaitForSelector(page, '.ball-beat', { hidden: true });
    },
    addTwilioSettings: async function (
        enableSms: $TSFixMe,
        accountSid: $TSFixMe,
        authToken: $TSFixMe,
        phoneNumber: $TSFixMe,
        page: $TSFixMe
    ) {
        await page.goto(utils.DASHBOARD_URL, {
            waitUntil: ['networkidle2'],
        });
        await this.pageWaitForSelector(page, '#projectSettings', {
            visible: true,
        });

        await this.pageClickNavigate(page, '#projectSettings');

        await this.pageClick(page, '#more');

        await this.pageWaitForSelector(page, '#smsCalls');

        await this.pageClickNavigate(page, '#smsCalls');
        await this.pageWaitForSelector(page, 'label[for=enabled]', {
            visible: true,
        });

        if (enableSms) {
            await this.pageClick(page, 'label[for=enabled]');
        }

        await this.pageType(page, '#accountSid', accountSid);

        await this.pageType(page, '#authToken', authToken);

        await this.pageType(page, '#phoneNumber', phoneNumber);

        await this.pageClick(page, '#submitTwilioSettings');
        await this.pageWaitForSelector(page, '.ball-beat', { hidden: true });
        await page.reload();

        await this.pageWaitForSelector(page, '#accountSid');
    },
    addGlobalTwilioSettings: async function (
        enableSms: $TSFixMe,
        enableCalls: $TSFixMe,
        accountSid: $TSFixMe,
        authToken: $TSFixMe,
        phoneNumber: $TSFixMe,
        alertLimit: PositiveNumber,
        page: $TSFixMe
    ) {
        await page.goto(utils.ADMIN_DASHBOARD_URL, {
            waitUntil: ['networkidle2'],
        });
        await this.pageWaitForSelector(page, '#settings', {
            visible: true,
        });

        await this.pageClick(page, '#settings');

        await this.pageWaitForSelector(page, '#twilio');

        await this.pageClick(page, '#twilio');

        await this.pageWaitForSelector(page, '#call-enabled');
        if (enableCalls) {
            await this.page$Eval(page, '#call-enabled', (element: $TSFixMe) =>
                element.click()
            );
        }
        if (enableSms) {
            await this.page$Eval(page, '#sms-enabled', (element: $TSFixMe) =>
                element.click()
            );
        }

        await this.pageType(page, '#account-sid', accountSid);

        await this.pageType(page, '#authentication-token', authToken);

        await this.pageType(page, '#phone', phoneNumber);

        await this.pageType(page, '#alert-limit', alertLimit);

        await this.pageClick(page, 'button[type=submit]');

        await page.reload();

        await this.pageWaitForSelector(page, '#account-sid');
    },
    addSmtpSettings: async function (
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
        await this.pageWaitForSelector(page, '#projectSettings', {
            visible: true,
        });

        await this.pageClickNavigate(page, '#projectSettings');

        await this.pageClick(page, '#more');

        await this.pageWaitForSelector(page, '#email');

        await this.pageClickNavigate(page, '#email');

        await this.pageWaitForSelector(page, '#smtpswitch');
        if (enable) {
            await this.page$Eval(page, '#smtpswitch', (elem: $TSFixMe) =>
                elem.click()
            );
        }

        await this.pageWaitForSelector(page, '#user');

        await this.pageType(page, '#user', user);

        await this.pageType(page, '#pass', pass);

        await this.pageType(page, '#host', host);

        await this.pageType(page, '#port', port);

        await this.pageType(page, '#from', from);

        await this.pageType(page, '#name', 'Admin');
        await this.page$Eval(page, '#secure', (e: $TSFixMe) => {
            e.checked = secure;
        });

        await this.pageClick(page, '#saveSmtp');
        await this.pageWaitForSelector(page, '.ball-beat', {
            visible: true,
            timeout: this.timeout,
        });
        await this.pageWaitForSelector(page, '.ball-beat', { hidden: true });
        await page.reload();

        await this.pageWaitForSelector(page, '#user');
    },
    setAlertPhoneNumber: async (
        phoneNumber: $TSFixMe,
        code: $TSFixMe,
        page: $TSFixMe
    ) => {
        await page.goto(utils.DASHBOARD_URL, {
            waitUntil: ['networkidle2'],
        });

        await this.pageWaitForSelector(page, '#profile-menu');

        await this.pageClick(page, '#profile-menu');

        await this.pageWaitForSelector(page, '#userProfile');

        await this.pageClickNavigate(page, '#userProfile');

        await this.pageWaitForSelector(page, 'input[type=tel]');

        await this.pageType(page, 'input[type=tel]', phoneNumber);

        await this.pageWaitForSelector(page, '#sendVerificationSMS');

        await this.pageClick(page, '#sendVerificationSMS');

        await this.pageWaitForSelector(page, '#otp');

        await this.pageType(page, '#otp', code);

        await this.pageClick(page, '#verify');

        await this.pageWaitForSelector(page, '#successMessage');
    },
    addAnExternalSubscriber: async function (
        componentName: $TSFixMe,
        monitorName: $TSFixMe,
        alertType: $TSFixMe,
        page: $TSFixMe,
        data: $TSFixMe
    ) {
        await page.goto(utils.DASHBOARD_URL, {
            waitUntil: ['networkidle2'],
        });
        await this.navigateToMonitorDetails(componentName, monitorName, page);

        await this.pageWaitForSelector(page, '#react-tabs-2');

        await this.pageClick(page, '#react-tabs-2');

        await this.pageWaitForSelector(page, '#addSubscriberButton');

        await this.pageClick(page, '#addSubscriberButton');

        await this.pageWaitForSelector(page, '#alertViaId');
        await this.selectDropdownValue('#alertViaId', alertType, page);
        if (alertType === 'SMS') {
            const { countryCode, phoneNumber } = data;

            await this.pageWaitForSelector(page, '#countryCodeId');
            await this.selectDropdownValue('#countryCodeId', countryCode, page);

            await this.pageType(page, '#contactPhoneId', phoneNumber);
        }

        await this.pageClick(page, '#createSubscriber');
    },
    addCustomField: async function (
        page: $TSFixMe,
        data: $TSFixMe,
        owner: $TSFixMe
    ): void {
        await page.goto(utils.DASHBOARD_URL, {
            waitUntil: ['networkidle2'],
        });
        await this.pageWaitForSelector(page, '#projectSettings', {
            visible: true,
            timeout: this.timeout,
        });

        await this.pageClickNavigate(page, '#projectSettings');
        if (owner === 'monitor') {
            await this.pageWaitForSelector(page, '#more');

            await this.pageClick(page, '#more');
            await this.pageWaitForSelector(page, '#monitor', {
                visible: true,
                timeout: this.timeout,
            });

            await this.pageClickNavigate(page, '#monitor');

            await this.pageClick(page, '.monitor-sla-advanced');
        } else {
            await this.pageWaitForSelector(page, '#more');

            await this.pageClick(page, '#more');
            await this.pageWaitForSelector(page, '#incidentSettings', {
                visible: true,
                timeout: this.timeout,
            });

            await this.pageClickNavigate(page, '#incidentSettings');
            await page.reload({
                waitUntil: 'networkidle2',
            });

            await this.pageClick(page, '.advanced-tab');
        }

        await this.pageWaitForSelector(page, '#addCustomField', {
            visible: true,
            timeout: this.timeout,
        });

        await this.pageClick(page, '#addCustomField');
        await this.pageWaitForSelector(page, '#customFieldForm', {
            visible: true,
            timeout: this.timeout,
        });

        await this.pageClick(page, '#fieldName');

        await this.pageType(page, '#fieldName', data.fieldName);
        await this.selectDropdownValue('#fieldType', data.fieldType, page);

        await this.pageClick(page, '#createCustomFieldButton');
        await this.pageWaitForSelector(page, '#customFieldForm', {
            hidden: true,
        });
    },
    navigateToCustomField: async function (page: $TSFixMe): void {
        await page.goto(utils.DASHBOARD_URL, {
            waitUntil: ['networkidle2'],
        });

        await this.pageClickNavigate(page, '#projectSettings');

        await this.pageWaitForSelector(page, '#more');

        await this.pageClick(page, '#more');
        await this.pageWaitForSelector(page, '#incidentSettings', {
            visible: true,
            timeout: this.timeout,
        });

        await this.pageClickNavigate(page, '#incidentSettings');

        await this.pageClick(page, '.advanced-tab');
    },
    pageType: async function (
        page: $TSFixMe,
        selector: $TSFixMe,
        text: $TSFixMe,
        opts: $TSFixMe
    ) {
        await this.pageWaitForSelector(page, selector, {
            visible: true,
            timeout: this.timeout,
        });
        await page.focus(selector);
        return await page.type(selector, text, opts);
    },
    pageClick: async function (
        page: $TSFixMe,
        selector: $TSFixMe,
        opts: $TSFixMe
    ): void {
        await this.pageWaitForSelector(page, selector, {
            visible: true,
            timeout: this.timeout,
        });
        return await page.click(selector, opts);
    },
    page$Eval: async function (
        page: $TSFixMe,
        selector: $TSFixMe,
        evalFunction: $TSFixMe,
        opts = null
    ) {
        await this.pageWaitForSelector(page, selector, opts);
        return await page.$eval(selector, evalFunction);
    },
    page$$Eval: async function (
        page: $TSFixMe,
        selector: $TSFixMe,
        evalFunction: $TSFixMe
    ): void {
        await this.pageWaitForSelector(page, selector);
        return await page.$$eval(selector, evalFunction);
    },
    page$: async function (
        page: $TSFixMe,
        selector: $TSFixMe,
        opts: $TSFixMe
    ): void {
        await this.pageWaitForSelector(page, selector, opts);
        return await page.$(selector, opts);
    },
    page$$: async function (
        page: $TSFixMe,
        selector: $TSFixMe,
        opts: $TSFixMe
    ): void {
        await this.pageWaitForSelector(page, selector);
        return await page.$$(selector, opts);
    },
    pageWaitForSelector: async function (
        page: $TSFixMe,
        selector: $TSFixMe,
        opts: $TSFixMe
    ): void {
        if (!opts) {
            opts = {};
        }

        if (!opts.timeout) {
            opts.timeout = this.timeout;
        }

        if (!opts.hidden) {
            opts.visible = true;
        }
        return await page.waitForSelector(selector, {
            ...opts,
        });
    },
    isElementOnPage: async function (page: $TSFixMe, selector: $TSFixMe): void {
        if (await page.$(selector)) {
            return true;
        } else {
            return false;
        }
    },
    pageClickNavigate: async function (
        page: $TSFixMe,
        selector: $TSFixMe,
        opts: $TSFixMe
    ): void {
        await this.pageWaitForSelector(page, selector, {
            visible: true,
            timeout: this.timeout,
        });
        return await Promise.all([
            page.click(selector, opts),
            page.waitForNavigation({ waitUntil: 'networkidle2' }), // This ensures every id is loaded upon page routing
        ]);
    },
    navigateToTwilio: async function (page: $TSFixMe): void {
        await page.goto(utils.DASHBOARD_URL);
        await this.pageWaitForSelector(page, '#projectSettings', {
            visible: true,
            timeout: this.timeout,
        });

        await this.pageClick(page, '#projectSettings');

        await this.pageWaitForSelector(page, '#more');

        await this.pageClick(page, '#more');

        await this.pageWaitForSelector(page, '#smsCalls');

        await this.pageClick(page, '#smsCalls');
    },
    navigateToSmtp: async function (page: $TSFixMe): void {
        await page.goto(utils.DASHBOARD_URL);
        await this.pageWaitForSelector(page, '#projectSettings', {
            visible: true,
            timeout: this.timeout,
        });

        await this.pageClick(page, '#projectSettings');

        await this.pageWaitForSelector(page, '#more');

        await this.pageClick(page, '#more');

        await this.pageWaitForSelector(page, '#email');

        await this.pageClick(page, '#email');
    },
};

export default _this;
