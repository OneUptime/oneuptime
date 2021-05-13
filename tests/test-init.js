const utils = require('./test-utils');
const chai = require('chai');
chai.use(require('chai-http'));
const request = chai.request(utils.BACKEND_URL);

const _this = {
    /**
     *
     * @param { ObjectConstructor } user
     * @param { string } page
     * @description Registers a new user.
     * @returns { void }
     */
    registerUser: async function(user, page) {
        if (
            utils.BACKEND_URL.includes('localhost') ||
            utils.BACKEND_URL.includes('staging.fyipe.com')
        ) {
            const { email } = user;
            let frame, elementHandle;
            await page.goto(utils.ACCOUNTS_URL + '/register', {
                waitUntil: 'networkidle2',
            });
            await page.waitForSelector('#email');
            await _this.pageClick(page, 'input[name=email]');
            await _this.pageType(page, 'input[name=email]', email);
            await _this.pageClick(page, 'input[name=name]');
            await _this.pageType(page, 'input[name=name]', 'Test Name');
            await _this.pageClick(page, 'input[name=companyName]');
            await _this.pageType(page, 'input[name=companyName]', 'Test Name');
            await _this.pageClick(page, 'input[name=companyPhoneNumber]');
            await _this.pageType(
                page,
                'input[name=companyPhoneNumber]',
                '99105688'
            );
            await _this.pageClick(page, 'input[name=password]');
            await _this.pageType(page, 'input[name=password]', '1234567890');
            await _this.pageClick(page, 'input[name=confirmPassword]');
            await _this.pageType(
                page,
                'input[name=confirmPassword]',
                '1234567890'
            );

            await _this.pageClick(page, 'button[type=submit]');
            await page.waitForSelector(`form#card-form`, {
                visible: true,
            });

            await page.waitForSelector('.__PrivateStripeElement > iframe', {
                visible: true,
            });
            const stripeIframeElements = await page.$$(
                '.__PrivateStripeElement > iframe'
            );

            await _this.pageClick(page, 'input[name=cardName]');
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
            await _this.pageClick(page, 'input[name=address1]');
            await _this.pageType(
                page,
                'input[name=address1]',
                utils.user.address.streetA
            );
            await _this.pageClick(page, 'input[name=address2]');
            await _this.pageType(
                page,
                'input[name=address2]',
                utils.user.address.streetB
            );
            await _this.pageClick(page, 'input[name=city]');
            await _this.pageType(
                page,
                'input[name=city]',
                utils.user.address.city
            );
            await _this.pageClick(page, 'input[name=state]');
            await _this.pageType(
                page,
                'input[name=state]',
                utils.user.address.state
            );
            await _this.pageClick(page, 'input[name=zipCode]');
            await _this.pageType(
                page,
                'input[name=zipCode]',
                utils.user.address.zipcode
            );
            await page.select('#country', 'India');
            await _this.pageClick(page, 'button[type=submit]');

            const signupResponse = await page.waitForResponse(
                response =>
                    response.url().includes('/user/signup') &&
                    response.status() === 200
            );
            if (signupResponse._status !== 200) {
                throw new Error('Sign up did not return 200');
            }
        }
    },
    loginUser: async function(user, page) {
        const { email, password } =
            utils.BACKEND_URL.includes('localhost') ||
            utils.BACKEND_URL.includes('staging')
                ? user
                : {
                      email: 'user@fyipe.com',
                      password: 'mVzkm{LAP)mNC8t23ehqifb2p',
                  };
        await page.goto(utils.ACCOUNTS_URL + '/login', {
            waitUntil: 'networkidle2',
        });
        await page.waitForSelector('#login-button');
        await _this.pageClick(page, 'input[name=email]');
        await _this.pageType(page, 'input[name=email]', email);
        await _this.pageClick(page, 'input[name=password]');
        await _this.pageType(page, 'input[name=password]', password);
        await _this.pageClick(page, 'button[type=submit]');

        await page.waitForSelector('#home', { visible: true, timeout: 100000 });
    },
    loginEnterpriseUser: async function(user, page) {
        const { email, password } = user;
        await page.goto(utils.ACCOUNTS_URL + '/login', {
            waitUntil: 'networkidle2',
        });
        await page.waitForSelector('#login-button');
        await _this.pageClick(page, 'input[name=email]');
        await _this.pageType(page, 'input[name=email]', email);
        await _this.pageClick(page, 'input[name=password]');
        await _this.pageType(page, 'input[name=password]', password);
        await _this.pageClick(page, 'button[type=submit]');

        await page.waitForSelector('#users', {
            visible: true,
            timeout: 100000,
        });
    },
    registerEnterpriseUser: async function(user, page) {
        const masterAdmin = {
            email: 'masteradmin@hackerbay.io',
            password: '1234567890',
        };
        await page.goto(utils.ACCOUNTS_URL + '/login', {
            waitUntil: 'networkidle2',
        });
        const signUp = await page.$('#signUpLink');
        if (signUp) {
            await page.goto(utils.ACCOUNTS_URL + '/register', {
                waitUntil: 'networkidle2',
            });
            await page.waitForSelector('#email');
            await _this.pageClick(page, 'input[name=email]');
            await _this.pageType(page, 'input[name=email]', masterAdmin.email);
            await _this.pageClick(page, 'input[name=name]');
            await _this.pageType(page, 'input[name=name]', 'Master Admin');
            await _this.pageClick(page, 'input[name=companyName]');
            await _this.pageType(page, 'input[name=companyName]', 'Master');
            await _this.pageClick(page, 'input[name=companyPhoneNumber]');
            await _this.pageType(
                page,
                'input[name=companyPhoneNumber]',
                '99105688'
            );
            await _this.pageClick(page, 'input[name=password]');
            await _this.pageType(page, 'input[name=password]', '1234567890');
            await _this.pageClick(page, 'input[name=confirmPassword]');
            await _this.pageType(
                page,
                'input[name=confirmPassword]',
                '1234567890'
            );
            await Promise.all([
                _this.pageClick(page, 'button[type=submit]'),
                page.waitForSelector('#users', {
                    visible: true,
                    timeout: 100000,
                }),
            ]);
        } else {
            await _this.loginEnterpriseUser(masterAdmin, page);
        }
        // create the user from admin dashboard
        const { email } = user;
        await page.waitForSelector('#add_user');
        await _this.pageClick(page, '#add_user');
        await page.waitForSelector('#email');
        await _this.pageClick(page, 'input[name=email]');
        await _this.pageType(page, 'input[name=email]', email);
        await _this.pageClick(page, 'input[name=name]');
        await _this.pageType(page, 'input[name=name]', 'Test Name');
        await _this.pageClick(page, 'input[name=companyName]');
        await _this.pageType(page, 'input[name=companyName]', 'Test Name');
        await _this.pageClick(page, 'input[name=companyPhoneNumber]');
        await _this.pageType(
            page,
            'input[name=companyPhoneNumber]',
            '99105688'
        );
        await _this.pageClick(page, 'input[name=password]');
        await _this.pageType(page, 'input[name=password]', '1234567890');
        await _this.pageClick(page, 'input[name=confirmPassword]');
        await _this.pageType(page, 'input[name=confirmPassword]', '1234567890');
        await _this.pageClick(page, 'button[type=submit]');
        try {
            const signupResponse = await page.waitForResponse(
                response =>
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
    logout: async function(page) {
        await page.goto(utils.ADMIN_DASHBOARD_URL, {
            waitUntil: ['networkidle2'],
        });
        await page.waitForSelector('button#profile-menu', { visible: true });
        await _this.pageClick(page, 'button#profile-menu');
        await page.waitForSelector('button#logout-button');
        await _this.pageClick(page, 'button#logout-button');
        await page.reload();
        await page.waitForTimeout(3000);
    },
    saasLogout: async function(page) {
        await page.goto(utils.DASHBOARD_URL, { waitUntil: ['networkidle2'] });
        await page.waitForSelector('button#profile-menu', { visible: true });
        await _this.pageClick(page, 'button#profile-menu');
        await page.waitForSelector('button#logout-button');
        await _this.pageClick(page, 'button#logout-button');
        await page.reload({ waitUntil: 'networkidle0' });
    },
    selectByText: async function(selector, text, page) {
        await _this.pageClick(page, selector, { delay: 100 });
        await page.keyboard.type(text);
        const noOption = await page.$('div.css-1gl4k7y');
        if (!noOption) {
            await page.keyboard.type(String.fromCharCode(13));
        }
    },
    clear: async function(selector, page) {
        const input = await page.$(selector);
        await input.click({ clickCount: 3 });
        await input.type('');
    },
    renameProject: async function(newProjectName, page) {
        await page.waitForSelector('#projectSettings');
        await _this.pageClick(page, '#projectSettings');
        await page.waitForSelector('input[name=project_name]');
        await _this.clear('input[name=project_name]', page);
        await _this.pageType(page, 'input[name=project_name]', newProjectName);
        await _this.pageClick(page, '#btnCreateProject');
    },
    addMonitor: async function(monitorName, description, page) {
        await page.waitForSelector('#form-new-monitor', { visible: true });
        await page.waitForSelector('input[id=name]', { visible: true });
        await _this.pageClick(page, 'input[id=name]');
        await page.focus('input[id=name]');
        await _this.pageType(page, 'input[id=name]', monitorName);
        await _this.pageClick(page, '[data-testId=type_manual]');
        await page.waitForSelector('#description', { visible: true });
        await _this.pageClick(page, '#description');
        await _this.pageType(page, '#description', description);
        await _this.pageClick(page, 'button[type=submit]');
        await page.waitForSelector(`#cb${monitorName}`, { visible: true });
    },
    navigateToComponentDetails: async function(component, page) {
        // Navigate to Components page
        await page.goto(utils.DASHBOARD_URL, { waitUntil: ['networkidle2'] });
        await page.waitForSelector('#components', { visible: true });
        await _this.pageClick(page, '#components');

        // Navigate to details page of component assumed created
        await page.waitForSelector(`#more-details-${component}`);
        await page.$eval(`#more-details-${component}`, e => e.click());
    },
    addMonitorToStatusPage: async function(componentName, monitorName, page) {
        await page.goto(utils.DASHBOARD_URL, { waitUntil: ['networkidle2'] });
        const description = utils.generateRandomString();
        await page.waitForSelector('#statusPages');
        await _this.pageClick(page, '#statusPages');
        await page.waitForSelector('#statusPagesListContainer');
        await page.waitForSelector('#viewStatusPage');
        await _this.pageClick(page, '#viewStatusPage');
        await page.waitForSelector('#addMoreMonitors');
        await _this.pageClick(page, '#addMoreMonitors');
        await _this.selectByText(
            'ul > li:last-of-type #monitor-name',
            `${componentName} / ${monitorName}`,
            page
        );
        await _this.pageClick(
            page,
            'ul > li:last-of-type #monitor-description'
        );
        await _this.pageType(
            page,
            'ul > li:last-of-type #monitor-description',
            description
        );
        await _this.pageClick(
            page,
            'ul > li:last-of-type #manual-monitor-checkbox'
        );
        await _this.pageClick(page, '#btnAddStatusPageMonitors');
    },
    clickStatusPageUrl: async function(page) {
        await page.waitForSelector('#publicStatusPageUrl');
        let link = await page.$('#publicStatusPageUrl > span > a');
        link = await link.getProperty('href');
        link = await link.jsonValue();
        await page.goto(link, { waitUntil: ['networkidle2'] });
    },
    navigateToStatusPage: async function(page) {
        await page.waitForSelector('#statusPages');
        await _this.pageClick(page, '#statusPages');
        await page.waitForSelector('#statusPagesListContainer');
        await page.waitForSelector('#viewStatusPage');
        await _this.pageClick(page, '#viewStatusPage');
        await _this.clickStatusPageUrl(page);
    },
    growthPlanUpgrade: async function(page) {
        await page.goto(utils.DASHBOARD_URL, { waitUntil: ['networkidle2'] });
        await page.waitForSelector('#projectSettings', { visible: true });
        await _this.pageClick(page, '#projectSettings');
        await page.waitForSelector('#billing');
        await _this.pageClick(page, '#billing');
        await page.waitForSelector('input#Growth_month', {
            visible: true,
        });
        await _this.pageClick(page, 'input#Growth_month');
        await _this.pageClick(page, '#changePlanBtn');
        await page.waitForSelector('.ball-beat', { hidden: true });
    },
    gotoTab: async function(tabId, page) {
        await page.waitForSelector(`#react-tabs-${tabId}`, { visible: true });
        await page.$eval(`#react-tabs-${tabId}`, e => e.click());
    },
    themeNavigationAndConfirmation: async function(page, theme) {
        await page.waitForSelector('ul#customTabList > li', { visible: true });
        await page.$$eval('ul#customTabList > li', elems => elems.find((i)=> i.innerText === "Branding").click());
        await page.waitForSelector(`#${theme}`, { visible: true });
        await _this.pageClick(page, `#${theme}`);
        await page.waitForSelector('#changePlanBtn', { visible: true });
        await _this.pageClick(page, '#changePlanBtn');
        await _this.gotoTab(0, page);
    },
    registerAndLoggingTeamMember: async function(user, page) {
        const { email, password } = user;
        await page.goto(utils.ACCOUNTS_URL + '/register'),
            {
                waitUntil: 'networkidle2',
            };
        // Registration
        await page.waitForSelector('#email');
        await _this.pageClick(page, 'input[name=email]');
        await _this.pageType(page, 'input[name=email]', email);
        await _this.pageClick(page, 'input[name=name]');
        await _this.pageType(page, 'input[name=name]', 'Test Name');
        await _this.pageClick(page, 'input[name=companyName]');
        await _this.pageType(page, 'input[name=companyName]', 'Test Name');
        await _this.pageClick(page, 'input[name=companyPhoneNumber]');
        await _this.pageType(
            page,
            'input[name=companyPhoneNumber]',
            '99105688'
        );
        await _this.pageClick(page, 'input[name=password]');
        await _this.pageType(page, 'input[name=password]', password);
        await _this.pageClick(page, 'input[name=confirmPassword]');
        await _this.pageType(page, 'input[name=confirmPassword]', password);
        await _this.pageClick(page, 'button[type=submit]'),
            await page.waitForSelector('#success-step');

        // Login
        await page.goto(utils.ACCOUNTS_URL + '/login', {
            waitUntil: 'networkidle2',
        });
        await page.waitForSelector('#login-form');
        await _this.pageClick(page, 'input[name=email]');
        await _this.pageType(page, 'input[name=email]', email);
        await _this.pageClick(page, 'input[name=password]');
        await _this.pageType(page, 'input[name=password]', password);
        await page.waitForSelector('button[type=submit]', { visible: true });
        await Promise.all([
            page.waitForNavigation({ waitUntil: 'networkidle2' }),
            _this.pageClick(page, 'button[type=submit]'),
        ]);
        expect(page.url().startsWith(utils.ACCOUNTS_URL + '/login')).toEqual(
            false
        );
    },

    adminLogout: async function(page) {
        await page.goto(utils.ADMIN_DASHBOARD_URL, {
            waitUntil: ['networkidle2'],
        });
        await page.waitForSelector('button#profile-menu', { visible: true });
        await _this.pageClick(page, 'button#profile-menu');
        await page.waitForSelector('button#logout-button');
        await _this.pageClick(page, 'button#logout-button');
        await page.reload({ waitUntil: 'networkidle0' });
    },
    addComponent: async function(component, page, projectName = null) {
        await page.goto(utils.DASHBOARD_URL, { waitUntil: ['networkidle2'] });
        await page.waitForSelector('#components', { visible: true });
        await _this.pageClick(page, '#components');

        // Fill and submit New Component form
        await page.waitForSelector('#form-new-component');
        await _this.pageClick(page, 'input[id=name]');
        await page.focus('input[id=name]');
        await _this.pageType(page, 'input[id=name]', component);

        if (projectName) {
            await _this.selectByText('#subProjectId', projectName, page);
        }

        await Promise.all([
            page.$eval('button[type=submit]', e => e.click()),
            page.waitForNavigation(),
        ]);
    },
    navigateToMonitorDetails: async function(component, monitor, page) {
        // Navigate to Components page
        await _this.navigateToComponentDetails(component, page);

        // Navigate to details page of monitor assumed created
        await page.waitForSelector(`#more-details-${monitor}`);
        await page.$eval(`#more-details-${monitor}`, e => e.click());
        await page.waitForSelector(`#monitor-title-${monitor}`, {
            visible: true,
        });
    },
    navigateToApplicationLogDetails: async function(
        component,
        applicationLog,
        page
    ) {
        // Navigate to Components page
        await _this.navigateToComponentDetails(component, page);

        // then goto list of log containers
        await page.waitForSelector('#logs');
        await _this.pageClick(page, '#logs');

        // Navigate to details page of log container assumed created
        await page.waitForSelector(`#more-details-${applicationLog}`);
        await _this.pageClick(page, `#more-details-${applicationLog}`);
        await page.waitForSelector(`#application-log-title-${applicationLog}`);
    },
    navigateToErrorTrackerDetails: async function(
        component,
        errorTracker,
        page
    ) {
        // Navigate to Components page
        await _this.navigateToComponentDetails(component, page);

        // then goto list of error trackers
        await page.waitForSelector('#errorTracking');
        await _this.pageClick(page, '#errorTracking');

        // Navigate to details page of error tracker assumed created
        await page.waitForSelector(`#more-details-${errorTracker}`);
        await _this.pageClick(page, `#more-details-${errorTracker}`);
        await page.waitForSelector(`#error-tracker-title-${errorTracker}`);
    },

    createUserFromAdminDashboard: async function(user, page) {
        // create the user from admin dashboard
        const { email } = user;
        await page.waitForSelector('#add_user');
        await _this.pageClick(page, '#add_user');
        await page.waitForSelector('#email');
        await _this.pageClick(page, 'input[name=email]');
        await _this.pageType(page, 'input[name=email]', email);
        await _this.pageClick(page, 'input[name=name]');
        await _this.pageType(page, 'input[name=name]', 'Test Name');
        await _this.pageClick(page, 'input[name=companyName]');
        await _this.pageType(page, 'input[name=companyName]', 'Test Name');
        await _this.pageClick(page, 'input[name=companyPhoneNumber]');
        await _this.pageType(
            page,
            'input[name=companyPhoneNumber]',
            '99105688'
        );
        await _this.pageClick(page, 'input[name=password]');
        await _this.pageType(page, 'input[name=password]', '1234567890');
        await _this.pageClick(page, 'input[name=confirmPassword]');
        await _this.pageType(page, 'input[name=confirmPassword]', '1234567890');
        await _this.pageClick(page, 'button[type=submit]');
        await page.waitForSelector('#frmUser', { hidden: true });
    },
    addSchedule: async function(callSchedule, page) {
        await page.goto(utils.DASHBOARD_URL);
        await page.waitForSelector('#onCallDuty', {
            visible: true,
        });
        await _this.pageClick(page, '#onCallDuty');
        await page.evaluate(() => {
            document.querySelector('.ActionIconParent').click();
        });
        page.waitForSelector('#name', { timeout: 2000 });
        await _this.pageType(page, '#name', callSchedule);
        await _this.pageClick(page, '#btnCreateSchedule');
        await page.waitForSelector(`#duty_${callSchedule}`, { visible: true });
    },
    addSubProject: async function(subProjectName, page) {
        const subProjectNameSelector = await page.$('#btn_Add_SubProjects');
        if (subProjectNameSelector) {
            await page.waitForSelector('#btn_Add_SubProjects');
            await _this.pageClick(page, '#btn_Add_SubProjects');
            await page.waitForSelector('#title');
            await _this.pageType(page, '#title', subProjectName);
            await _this.pageClick(page, '#btnAddSubProjects');
        } else {
            await page.waitForSelector('#projectSettings');
            await _this.pageClick(page, '#projectSettings');
            await page.waitForSelector('#btn_Add_SubProjects');
            await _this.pageClick(page, '#btn_Add_SubProjects');
            await page.waitForSelector('#title');
            await _this.pageType(page, '#title', subProjectName);
            await _this.pageClick(page, '#btnAddSubProjects');
        }
        await page.waitForSelector('#btnAddSubProjects', { hidden: true });
    },
    addUserToProject: async function(data, page) {
        const { email, role, subProjectName } = data;
        await page.waitForSelector('#teamMembers');
        await _this.pageClick(page, '#teamMembers');
        await page.waitForSelector(`#btn_${subProjectName}`);
        await _this.pageClick(page, `#btn_${subProjectName}`);
        await page.waitForSelector(`#frm_${subProjectName}`);
        await _this.pageClick(page, `#emails_${subProjectName}`);
        await _this.pageType(page, `#emails_${subProjectName}`, email);
        await _this.pageClick(page, `#${role}_${subProjectName}`);
        await _this.pageClick(page, `#btn_modal_${subProjectName}`);
    },
    switchProject: async function(projectName, page) {
        await page.goto(utils.DASHBOARD_URL, { waitUntil: ['networkidle2'] });
        await page.waitForSelector('#AccountSwitcherId', { visible: true });
        await _this.pageClick(page, '#AccountSwitcherId');
        await page.waitForSelector(`#accountSwitcher div#${projectName}`);
        await _this.pageClick(page, `#accountSwitcher div#${projectName}`);
        await page.waitForSelector('#components', { visible: true });
    },
    addMonitorToComponent: async function(component, monitorName, page) {
        component && (await _this.addComponent(component, page));
        await page.waitForSelector('input[id=name]');
        await _this.pageClick(page, 'input[id=name]');
        await page.focus('input[id=name]');
        await _this.pageType(page, 'input[id=name]', monitorName);
        await page.waitForSelector('button[id=showMoreMonitors]');
        await _this.pageClick(page, 'button[id=showMoreMonitors]');
        await _this.pageClick(page, '[data-testId=type_url]');
        await page.waitForSelector('#url', { visible: true });
        await _this.pageClick(page, '#url');
        await _this.pageType(page, '#url', 'https://google.com');
        await _this.pageClick(page, 'button[type=submit]');
        await page.waitForSelector(`#monitor-title-${monitorName}`, {
            visible: true,
        });
    },
    addNewMonitorToComponent: async function(page, componentName, monitorName) {
        await page.goto(utils.DASHBOARD_URL, {
            waitUntil: 'networkidle0',
        });
        await page.waitForSelector('#components');
        await _this.pageClick(page, '#components');
        await page.waitForSelector('#component0');
        await page.waitForSelector(`#more-details-${componentName}`);
        await _this.pageClick(page, `#more-details-${componentName}`);
        await page.waitForSelector('#form-new-monitor');
        await page.waitForSelector('input[id=name]');
        await _this.pageClick(page, 'input[id=name]');
        await page.focus('input[id=name]');
        await _this.pageType(page, 'input[id=name]', monitorName);
        await _this.pageClick(page, '[data-testId=type_url]');
        await page.waitForSelector('#url', { visible: true });
        await _this.pageClick(page, '#url');
        await _this.pageType(page, '#url', 'https://google.com');
        await _this.pageClick(page, 'button[type=submit]');
        await page.waitForSelector(`#monitor-title-${monitorName}`, {
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
        page,
        monitorName,
        options = {}
    ) {
        await page.waitForSelector('#form-new-monitor');
        await _this.pageClick(page, 'input[id=name]');
        await page.focus('input[id=name]');
        await _this.pageType(page, 'input[id=name]', monitorName);
        await _this.pageClick(page, 'input[data-testId=type_api]');
        await _this.selectByText('#method', 'get', page);
        await page.waitForSelector('#url', { visible: true });
        await _this.pageClick(page, '#url');
        await _this.pageType(page, '#url', utils.HTTP_TEST_SERVER_URL);
        await page.waitForSelector('#advanceOptions');
        await _this.pageClick(page, '#advanceOptions');

        // online criteria
        await page.waitForSelector('[data-testId=add_criterion_up]');
        await page.$$eval(
            '[data-testId=add_criterion_up]',
            addCriterionButtons => {
                const lastAddCriterionButton =
                    addCriterionButtons[addCriterionButtons.length - 1];
                lastAddCriterionButton.click();
            }
        );
        await page.waitForSelector(
            'ul[data-testId=up_criteria_list]> div:last-of-type #responseType'
        );
        await _this.selectByText(
            'ul[data-testId=up_criteria_list]> div:last-of-type #responseType',
            'responseBody',
            page
        );
        await page.waitForSelector(
            'ul[data-testId=up_criteria_list]> div:last-of-type #filter'
        );
        await _this.selectByText(
            'ul[data-testId=up_criteria_list]> div:last-of-type #filter',
            'evaluateResponse',
            page
        );
        await page.waitForSelector(
            'ul[data-testId=up_criteria_list]> div:last-of-type #value'
        );
        await _this.pageClick(
            page,
            'ul[data-testId=up_criteria_list]> div:last-of-type #value'
        );
        await _this.pageType(
            page,
            'ul[data-testId=up_criteria_list]> div:last-of-type #value',
            "response.body.status === 'ok';"
        );

        if (options.createAlertForOnline) {
            await _this.pageClick(
                page,
                '[data-testId=criterionAdvancedOptions_up]'
            );

            await page.waitForSelector('input[name^=createAlert_up]', {
                visible: true,
            });
            await page.$eval('input[name^=createAlert_up]', element =>
                element.click()
            );
        }

        // degraded criteria
        await page.$$eval(
            '[data-testId=add_criterion_degraded]',
            addCriterionButtons => {
                const lastAddCriterionButton =
                    addCriterionButtons[addCriterionButtons.length - 1];
                lastAddCriterionButton.click();
            }
        );
        await page.waitForSelector(
            'ul[data-testId=degraded_criteria_list] > div:last-of-type #responseType'
        );
        await _this.selectByText(
            'ul[data-testId=degraded_criteria_list] > div:last-of-type #responseType',
            'responseBody',
            page
        );
        await page.waitForSelector(
            'ul[data-testId=degraded_criteria_list] > div:last-of-type #filter'
        );
        await _this.selectByText(
            'ul[data-testId=degraded_criteria_list] > div:last-of-type #filter',
            'evaluateResponse',
            page
        );
        await page.waitForSelector(
            'ul[data-testId=degraded_criteria_list] > div:last-of-type #value'
        );
        await _this.pageClick(
            page,
            'ul[data-testId=degraded_criteria_list] > div:last-of-type #value'
        );
        await _this.pageType(
            page,
            'ul[data-testId=degraded_criteria_list] > div:last-of-type #value',
            "response.body.message === 'draining';"
        );

        await Promise.all([
            _this.pageClick(page, 'button[type=submit]'),
            page.waitForNavigation(),
        ]);
    },
    addMonitorToSubProject: async function(
        monitorName,
        projectName,
        componentName,
        page
    ) {
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForSelector('#monitors');
        await _this.pageClick(page, '#monitors'); // Fix this
        // await _this.navigateToComponentDetails(componentName, page);
        await page.waitForSelector('#form-new-monitor');
        await _this.pageClick(page, 'input[id=name]');
        await page.focus('input[id=name]');
        await _this.pageType(page, 'input[id=name]', monitorName);
        //Please add a new monitor type here. IOT Device Monitor has been removed.
        await _this.pageClick(page, 'button[type=submit]');
        await page.waitForSelector(`#monitor-title-${monitorName}`, {
            visible: true,
        });
    },
    addIncidentToProject: async function(monitorName, projectName, page) {
        const createIncidentSelector = await page.$(
            `#btnCreateIncident_${projectName}`,
            { visible: true }
        );
        if (createIncidentSelector) {
            await page.waitForSelector(`#btnCreateIncident_${projectName}`);
            await page.$eval(`#btnCreateIncident_${projectName}`, e =>
                e.click()
            );
            await page.waitForSelector('#frmIncident');
            await _this.selectByText('#monitorList', monitorName, page);
            await page.$eval('#createIncident', e => e.click());
        } else {
            await page.waitForSelector('#incidentLog');
            await page.$eval('#incidentLog', e => e.click());
            await page.waitForSelector(`#btnCreateIncident_${projectName}`);
            await page.$eval(`#btnCreateIncident_${projectName}`, e =>
                e.click()
            );
            await page.waitForSelector('#frmIncident');
            await _this.selectByText('#monitorList', monitorName, page);
            await page.$eval('#createIncident', e => e.click());
        }
        await page.waitForSelector('#createIncident', { hidden: true });
    },
    addIncidentPriority: async function(incidentPriority, page) {
        await page.goto(utils.DASHBOARD_URL, {
            waitUntil: 'networkidle0',
        });
        await page.waitForSelector('#projectSettings');
        await _this.pageClick(page, '#projectSettings');
        await page.waitForSelector('#more');
        await _this.pageClick(page, '#more');
        await page.waitForSelector('#incidentSettings');
        await _this.pageClick(page, '#incidentSettings');
        // To navigate to incident Priority tab
        await page.waitForSelector('ul#customTabList > li', {
            visible: true,
        });
        await page.$$eval('ul#customTabList > li', elems => elems[1].click());

        await page.waitForSelector('#addNewPriority');
        await _this.pageClick(page, '#addNewPriority');
        await page.waitForSelector('#CreateIncidentPriority');
        await _this.pageType(page, 'input[name=name]', incidentPriority);
        await _this.pageClick(page, '#CreateIncidentPriority');
        await page.waitForSelector('#CreateIncidentPriority', { hidden: true });
    },
    addStatusPageToProject: async function(statusPageName, projectName, page) {
        const createStatusPageSelector = await page.$(
            `#btnCreateStatusPage_${projectName}`
        );
        if (createStatusPageSelector) {
            await _this.pageClick(page, `#btnCreateStatusPage_${projectName}`);
            await page.waitForSelector('#btnCreateStatusPage');
            await _this.pageType(page, '#name', statusPageName);
            await _this.pageClick(page, '#btnCreateStatusPage');
        } else {
            await page.waitForSelector('#statusPages');
            await _this.pageClick(page, '#statusPages');
            await page.waitForSelector(`#btnCreateStatusPage_${projectName}`);
            await _this.pageClick(page, `#btnCreateStatusPage_${projectName}`);
            await page.waitForSelector('#btnCreateStatusPage');
            await _this.pageType(page, '#name', statusPageName);
            await _this.pageClick(page, '#btnCreateStatusPage');
        }
        await page.waitForSelector('#btnCreateStatusPage', { hidden: true });
    },
    addScheduleToProject: async function(scheduleName, projectName, page) {
        const createStatusPageSelector = await page.$(
            `#btnCreateStatusPage_${projectName}`
        );
        if (createStatusPageSelector) {
            await page.waitForSelector(`#btnCreateSchedule_${projectName}`);
            await _this.pageClick(page, `#btnCreateSchedule_${projectName}`);
            await page.waitForSelector('#btnCreateSchedule');
            await _this.pageType(page, '#name', scheduleName);
            await _this.pageClick(page, '#btnCreateSchedule');
        } else {
            await page.waitForSelector('#onCallDuty');
            await _this.pageClick(page, '#onCallDuty');
            await page.waitForSelector(`#btnCreateSchedule_${projectName}`);
            await _this.pageClick(page, `#btnCreateSchedule_${projectName}`);
            await page.waitForSelector('#btnCreateSchedule');
            await _this.pageType(page, '#name', scheduleName);
            await _this.pageClick(page, '#btnCreateSchedule');
        }
    },
    addScheduledMaintenance: async function(
        monitorName,
        scheduledEventName,
        componentName,
        page
    ) {
        await page.goto(utils.DASHBOARD_URL);
        await page.waitForSelector('#scheduledMaintenance', {
            visible: true,
        });
        await _this.pageClick(page, '#scheduledMaintenance');
        await page.waitForSelector('#addScheduledEventButton', {
            visible: true,
        });
        await _this.pageClick(page, '#addScheduledEventButton');

        await page.waitForSelector('#scheduledEventForm', {
            visible: true,
        });
        await page.waitForSelector('#name');
        await _this.pageClick(page, '#name');
        await _this.pageType(page, '#name', scheduledEventName);
        if (monitorName) {
            await _this.pageClick(page, 'label[for=selectAllMonitorsBox]');
            await _this.pageClick(page, '#addMoreMonitor');
            await page.waitForSelector('#monitorfield_0');
            await _this.selectByText('#monitorfield_0', componentName, page); // 'Component_Name/Monitor_Name' appears in the dropdown. Using 'componentName' selects the monitor.
        }
        await _this.pageClick(page, '#description');
        await _this.pageType(
            page,
            '#description',
            'This is an example description for a test'
        );
        await page.waitForSelector('input[name=startDate]');
        await _this.pageClick(page, 'input[name=startDate]');
        await _this.pageClick(
            page,
            'div.MuiDialogActions-root button:nth-child(2)'
        );
        await page.waitForSelector(
            'div.MuiDialogActions-root button:nth-child(2)',
            { hidden: true }
        );
        await _this.pageClick(page, 'input[name=endDate]');
        await _this.pageClick(
            page,
            'div.MuiDialogActions-root button:nth-child(2)'
        );
        await page.waitForSelector(
            'div.MuiDialogActions-root button:nth-child(2)',
            { hidden: true }
        );
        await _this.pageClick(page, '#createScheduledEventButton');
        await page.waitForSelector('.ball-beat', {
            hidden: true,
        });
    },
    filterRequest: async (request, response) => {
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
    addProject: async function(page, projectName = null, checkCard = false) {
        await page.goto(utils.DASHBOARD_URL);
        await page.waitForSelector('#AccountSwitcherId');
        await _this.pageClick(page, '#AccountSwitcherId');
        await page.waitForSelector('#create-project');
        await _this.pageClick(page, '#create-project');
        await page.waitForSelector('#name');
        await _this.pageType(page, '#name', projectName ? projectName : 'test');
        await _this.pageClick(page, 'label[for=Startup_month]');
        const startupOption = await page.waitForSelector(
            'label[for=Startup_month]',
            { visible: true }
        );
        startupOption.click();
        if (checkCard) {
            await page.waitFor(5000);
            await page.waitForSelector('iframe[name=__privateStripeFrame5]');

            const elementHandle = await page.$(
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
        await page.waitForSelector('#btnCreateProject', { visible: true });
        await Promise.all([
            _this.pageClick(page, '#btnCreateProject'),
            page.waitForNavigation({ waitUntil: 'networkidle0' }),
        ]);
    },
    addResourceCategory: async function(resourceCategory, page) {
        await page.goto(utils.DASHBOARD_URL);
        await page.waitForSelector('#projectSettings');
        await _this.pageClick(page, '#projectSettings');
        await page.waitForSelector('#more');
        await _this.pageClick(page, '#more');

        await page.waitForSelector('li#resources a');
        await _this.pageClick(page, 'li#resources a');
        await page.waitForSelector('#createResourceCategoryButton');
        await _this.pageClick(page, '#createResourceCategoryButton');
        await page.waitForSelector('#resourceCategoryName');
        await _this.pageType(page, '#resourceCategoryName', resourceCategory);
        await _this.pageClick(page, '#addResourceCategoryButton');
        await page.waitForSelector('#addResourceCategoryButton', {
            hidden: true,
        });

        const createdResourceCategorySelector =
            '#resourceCategoryList #resource-category-name';
        await page.waitForSelector(createdResourceCategorySelector, {
            visible: true,
        });
    },
    addGrowthProject: async function(projectName = 'GrowthProject', page) {
        await page.goto(utils.DASHBOARD_URL);
        await page.waitForSelector('#AccountSwitcherId');
        await _this.pageClick(page, '#AccountSwitcherId');
        await page.waitForSelector('#create-project');
        await _this.pageClick(page, '#create-project');
        await page.waitForSelector('#name');
        await _this.pageType(page, '#name', projectName);
        await _this.pageClick(page, 'label[for=Growth_month]');
        const growthOption = await page.waitForSelector(
            'label[for=Growth_month]',
            { visible: true }
        );
        growthOption.click();
        await Promise.all([
            await _this.pageClick(page, '#btnCreateProject'),
            await page.waitForNavigation({ waitUntil: 'networkidle0' }),
        ]);
    },
    addScaleProject: async function(projectName = 'ScaleProject', page) {
        await page.goto(utils.DASHBOARD_URL);
        await page.waitForSelector('#AccountSwitcherId');
        await _this.pageClick(page, '#AccountSwitcherId');
        await page.waitForSelector('#create-project');
        await _this.pageClick(page, '#create-project');
        await page.waitForSelector('#name');
        await _this.pageType(page, '#name', projectName);
        await _this.pageClick(page, 'label[for=Scale_month]');
        const scaleOption = await page.waitForSelector(
            'label[for=Scale_month]',
            { visible: true }
        );
        scaleOption.click();
        await Promise.all([
            await _this.pageClick(page, '#btnCreateProject'),
            await page.waitForNavigation({ waitUntil: 'networkidle0' }),
        ]);
    },
    addScheduledMaintenanceNote: async function(
        page,
        type,
        eventBtn,
        noteDescription,
        eventState = 'update'
    ) {
        await page.goto(utils.DASHBOARD_URL);
        await page.waitForSelector('#scheduledMaintenance', {
            visible: true,
        });
        await _this.pageClick(page, '#scheduledMaintenance');

        await page.waitForSelector(`#${eventBtn}`, {
            visible: true,
        });
        await _this.pageClick(page, `#${eventBtn}`);
        // navigate to the note tab section
        await _this.gotoTab(utils.scheduleEventTabIndexes.NOTES, page);
        await page.waitForSelector(`#add-${type}-message`, {
            visible: true,
        });
        await _this.pageClick(page, `#add-${type}-message`);
        await page.waitForSelector('#event_state', {
            visible: true,
        });
        await _this.selectByText('#event_state', eventState, page);
        await _this.pageClick(page, '#new-internal');
        await _this.pageType(page, '#new-internal', noteDescription);
        await _this.pageClick(page, '#internal-addButton');
        await page.waitForSelector('#form-new-schedule-internal-message', {
            hidden: true,
        });
    },
    addIncident: async function(
        monitorName,
        incidentType,
        page,
        incidentPriority
    ) {
        await page.goto(utils.DASHBOARD_URL);
        await page.waitForSelector('#components', { visible: true });
        await _this.pageClick(page, '#components');
        await page.waitForSelector(`#view-resource-${monitorName}`, {
            visible: true,
        });
        await _this.pageClick(page, `#view-resource-${monitorName}`);

        await page.waitForSelector(`#monitorCreateIncident_${monitorName}`);
        await _this.pageClick(page, `#monitorCreateIncident_${monitorName}`);
        await page.waitForSelector('#createIncident');
        await _this.selectByText('#incidentType', incidentType, page);
        if (incidentPriority) {
            await _this.selectByText(
                '#incidentPriority',
                incidentPriority,
                page
            );
        }
        await _this.pageClick(page, '#createIncident');
        await page.waitForSelector('.ball-beat', { visible: true });
        await page.waitForSelector('.ball-beat', { hidden: true });
    },
    addTwilioSettings: async function(
        enableSms,
        accountSid,
        authToken,
        phoneNumber,
        page
    ) {
        await page.goto(utils.DASHBOARD_URL);
        await page.waitForSelector('#projectSettings', {
            visible: true,
        });
        await _this.pageClick(page, '#projectSettings');
        await page.waitForSelector('#smsCalls');
        await _this.pageClick(page, '#smsCalls');
        await page.waitForSelector('label[for=enabled]', {
            visible: true,
        });
        if (enableSms) await _this.pageClick(page, 'label[for=enabled]');
        await _this.pageType(page, '#accountSid', accountSid);
        await _this.pageType(page, '#authToken', authToken);
        await _this.pageType(page, '#phoneNumber', phoneNumber);
        await _this.pageClick(page, '#submitTwilioSettings');
        await page.waitForSelector('.ball-beat', { hidden: true });
        await page.reload();
        await page.waitForSelector('#accountSid');
    },
    addGlobalTwilioSettings: async function(
        enableSms,
        enableCalls,
        accountSid,
        authToken,
        phoneNumber,
        alertLimit,
        page
    ) {
        await page.goto(utils.ADMIN_DASHBOARD_URL);
        await page.waitForSelector('#settings', {
            visible: true,
        });
        await _this.pageClick(page, '#settings');
        await page.waitForSelector('#twilio');
        await _this.pageClick(page, '#twilio');
        await page.waitForSelector('#call-enabled');
        if (enableCalls) {
            await page.$eval('#call-enabled', element => element.click());
        }
        if (enableSms) {
            await page.$eval('#sms-enabled', element => element.click());
        }
        await _this.pageType(page, '#account-sid', accountSid);
        await _this.pageType(page, '#authentication-token', authToken);
        await _this.pageType(page, '#phone', phoneNumber);
        await _this.pageType(page, '#alert-limit', alertLimit);
        await _this.pageClick(page, 'button[type=submit]');
        await page.waitFor(5000);
        await page.reload();
        await page.waitForSelector('#account-sid');
    },
    addSmtpSettings: async function(
        enable,
        user,
        pass,
        host,
        port,
        from,
        secure,
        page
    ) {
        await page.goto(utils.DASHBOARD_URL);
        await page.waitForSelector('#projectSettings', {
            visible: true,
        });
        await _this.pageClick(page, '#projectSettings');
        await page.waitForSelector('#email');
        await _this.pageClick(page, '#email');
        await page.waitForSelector('#smtpswitch');
        if (enable) await page.$eval('#smtpswitch', elem => elem.click());
        await page.waitForSelector('#user');
        await _this.pageType(page, '#user', user);
        await _this.pageType(page, '#pass', pass);
        await _this.pageType(page, '#host', host);
        await _this.pageType(page, '#port', port);
        await _this.pageType(page, '#from', from);
        await _this.pageType(page, '#name', 'Admin');
        await page.$eval('#secure', e => {
            e.checked = secure;
        });
        await _this.pageClick(page, '#saveSmtp');
        await page.waitForSelector('.ball-beat', { visible: true });
        await page.waitForSelector('.ball-beat', { hidden: true });
        await page.reload();
        await page.waitForSelector('#user');
    },
    setAlertPhoneNumber: async (phoneNumber, code, page) => {
        await page.goto(utils.DASHBOARD_URL);
        await page.waitForSelector('#profile-menu');
        await _this.pageClick(page, '#profile-menu');
        await page.waitForSelector('#userProfile');
        await _this.pageClick(page, '#userProfile');
        await page.waitForSelector('input[type=tel]');
        await _this.pageType(page, 'input[type=tel]', phoneNumber);
        await page.waitForSelector('#sendVerificationSMS');
        await _this.pageClick(page, '#sendVerificationSMS');
        await page.waitForSelector('#otp');
        await _this.pageType(page, '#otp', code);
        await _this.pageClick(page, '#verify');
        await page.waitForSelector('#successMessage');
    },
    addAnExternalSubscriber: async function(
        componentName,
        monitorName,
        alertType,
        page,
        data
    ) {
        await page.goto(utils.DASHBOARD_URL);
        await _this.navigateToMonitorDetails(componentName, monitorName, page);
        await page.waitForSelector('#react-tabs-2');
        await _this.pageClick(page, '#react-tabs-2');
        await page.waitForSelector('#addSubscriberButton');
        await _this.pageClick(page, '#addSubscriberButton');
        await page.waitForSelector('#alertViaId');
        await _this.selectByText('#alertViaId', alertType, page);
        if (alertType === 'SMS') {
            const { countryCode, phoneNumber } = data;
            await page.waitForSelector('#countryCodeId');
            await _this.selectByText('#countryCodeId', countryCode, page);
            await _this.pageType(page, '#contactPhoneId', phoneNumber);
        }
        await _this.pageClick(page, '#createSubscriber');
    },
    addCustomField: async function(page, data, owner) {
        await page.goto(utils.DASHBOARD_URL);
        await page.waitForSelector('#projectSettings', { visible: true });
        await _this.pageClick(page, '#projectSettings');
        if (owner === 'monitor') {
            await page.waitForSelector('#more');
            await _this.pageClick(page, '#more');
            await page.waitForSelector('#monitor', { visible: true });
            await _this.pageClick(page, '#monitor');
            await page.reload({
                waitUntil: 'networkidle0',
            });
            await _this.gotoTab(2, page);
        } else {
            await page.waitForSelector('#more');
            await _this.pageClick(page, '#more');
            await page.waitForSelector('#incidentSettings', { visible: true });
            await _this.pageClick(page, '#incidentSettings');
            await page.reload({
                waitUntil: 'networkidle0',
            });
            await _this.gotoTab(6, page);
        }

        await page.waitForSelector('#addCustomField', { visible: true });
        await _this.pageClick(page, '#addCustomField');
        await page.waitForSelector('#customFieldForm', { visible: true });
        await _this.pageClick(page, '#fieldName');
        await _this.pageType(page, '#fieldName', data.fieldName);
        await _this.selectByText('#fieldType', data.fieldType, page);

        await _this.pageClick(page, '#createCustomFieldButton');
        await page.waitForSelector('#customFieldForm', { visible: 'hidden' });
    },
    pageType: async function(page, selector, text, opts) {
        await page.waitForSelector(selector, { visible: true });
        await page.focus(selector);
        await page.type(selector, text, opts);
    },
    pageClick: async function(page, selector) {
        await page.waitForSelector(selector, { visible: true });
        await page.click(selector);
    },
};

module.exports = _this;
