const utils = require('./test-utils');

module.exports = {
    /**
     *
     * @param { ObjectConstructor } user
     * @param { string } page
     * @description Registers a new user.
     * @returns { void }
     */
    registerUser: async function(user, page, checkCard = true) {
        const { email, password } = user;
        let frame, elementHandle;
        await page.goto(utils.ACCOUNTS_URL + '/register', {
            waitUntil: 'networkidle2',
        });
        await page.waitForSelector('#email');
        await page.click('input[name=email]');
        await page.type('input[name=email]', email);
        await page.click('input[name=name]');
        await page.type('input[name=name]', 'Test Name');
        await page.click('input[name=companyName]');
        await page.type('input[name=companyName]', 'Test Name');
        await page.click('input[name=companyPhoneNumber]');
        await page.type('input[name=companyPhoneNumber]', '99105688');
        await page.click('input[name=password]');
        await page.type('input[name=password]', password);
        await page.click('input[name=confirmPassword]');
        await page.type('input[name=confirmPassword]', password);

        if (checkCard) {
            await Promise.all([
                page.waitForSelector(`form#card-form`),
                page.click('button[type=submit]'),
            ]);
            await page.waitForSelector('.__PrivateStripeElement > iframe', {
                visible: true,
                timeout: 200000,
            });
            const stripeIframeElements = await page.$$(
                '.__PrivateStripeElement > iframe'
            );

            await page.click('input[name=cardName]');
            await page.type('input[name=cardName]', 'Test name');

            elementHandle = stripeIframeElements[0]; // card element
            frame = await elementHandle.contentFrame();
            await frame.waitForSelector('input[name=cardnumber]');
            await frame.type('input[name=cardnumber]', '42424242424242424242', {
                delay: 150,
            });

            elementHandle = stripeIframeElements[1]; // cvc element
            frame = await elementHandle.contentFrame();
            await frame.waitForSelector('input[name=cvc]');
            await frame.type('input[name=cvc]', '123', {
                delay: 150,
            });

            elementHandle = stripeIframeElements[2]; // exp element
            frame = await elementHandle.contentFrame();
            await frame.waitForSelector('input[name=exp-date]');
            await frame.type('input[name=exp-date]', '11/23', {
                delay: 150,
            });
            await page.click('input[name=address1]');
            await page.type('input[name=address1]', utils.user.address.streetA);
            await page.click('input[name=address2]');
            await page.type('input[name=address2]', utils.user.address.streetB);
            await page.click('input[name=city]');
            await page.type('input[name=city]', utils.user.address.city);
            await page.click('input[name=state]');
            await page.type('input[name=state]', utils.user.address.state);
            await page.click('input[name=zipCode]');
            await page.type('input[name=zipCode]', utils.user.address.zipcode);
            await page.select('#country', 'India');
        }

        await Promise.all([
            // page.waitForSelector('div#success-step'),
            page.click('button[type=submit]'),
            page.waitForNavigation(),
        ]);
    },
    registerAndLoggingTeamMember: async function(user, page) {
        const { email, password } = user;
        await page.goto(utils.ACCOUNTS_URL + '/register'),
            {
                waitUntil: 'networkidle0',
            };
        // Registration
        await page.waitForSelector('#email');
        await page.click('input[name=email]');
        await page.type('input[name=email]', email);
        await page.click('input[name=name]');
        await page.type('input[name=name]', 'Test Name');
        await page.click('input[name=companyName]');
        await page.type('input[name=companyName]', 'Test Name');
        await page.click('input[name=companyPhoneNumber]');
        await page.type('input[name=companyPhoneNumber]', '99105688');
        await page.click('input[name=password]');
        await page.type('input[name=password]', password);
        await page.click('input[name=confirmPassword]');
        await page.type('input[name=confirmPassword]', password);
        await page.click('button[type=submit]'),
            await page.waitForSelector('#success-step');

        // Login
        await page.goto(utils.ACCOUNTS_URL + '/login', {
            waitUntil: 'networkidle0',
        });
        await page.waitForSelector('#login-form');
        await page.click('input[name=email]');
        await page.type('input[name=email]', email);
        await page.click('input[name=password]');
        await page.type('input[name=password]', password);
        await page.waitForSelector('button[type=submit]', { visible: true });
        await Promise.all([
            page.waitForNavigation({ waitUntil: 'networkidle2' }),
            page.click('button[type=submit]'),
        ]);
        expect(page.url().startsWith(utils.ACCOUNTS_URL + '/login')).toEqual(
            false
        );
    },
    loginUser: async function(user, page) {
        const { email, password } = user;
        await page.goto(utils.ACCOUNTS_URL + '/login', {
            waitUntil: 'networkidle2',
        });
        await page.waitForSelector('#login-button');
        await page.click('input[name=email]');
        await page.type('input[name=email]', email);
        await page.click('input[name=password]');
        await page.type('input[name=password]', password);
        await page.waitForSelector('button[type=submit]', { visible: true });
        await Promise.all([
            page.waitForNavigation({ waitUntil: 'networkidle2' }),
            page.click('button[type=submit]'),
        ]);
        expect(page.url().startsWith(utils.ACCOUNTS_URL + '/login')).toEqual(
            false
        );
    },
    logout: async function(page) {
        await page.goto(utils.DASHBOARD_URL);
        await page.waitForSelector('button#profile-menu', { visible: true });
        await page.click('button#profile-menu');
        await page.waitForSelector('button#logout-button');
        await page.click('button#logout-button');
        await page.reload({ waitUntil: 'networkidle0' });
    },
    adminLogout: async function(page) {
        await page.goto(utils.ADMIN_DASHBOARD_URL);
        await page.waitForSelector('button#profile-menu', { visible: true });
        await page.click('button#profile-menu');
        await page.waitForSelector('button#logout-button');
        await page.click('button#logout-button');
        await page.reload({ waitUntil: 'networkidle0' });
    },
    addComponent: async function(component, page, projectName = null) {
        await page.goto(utils.DASHBOARD_URL);
        await page.waitForSelector('#components', { visible: true });
        await page.click('#components');

        // Fill and submit New Component form
        await page.waitForSelector('#form-new-component');
        await page.click('input[id=name]');
        await page.type('input[id=name]', component);

        if (projectName) {
            await this.selectByText('#subProjectId', projectName, page);
        }

        await Promise.all([
            page.$eval('button[type=submit]', e => e.click()),
            page.waitForNavigation(),
        ]);
    },
    navigateToComponentDetails: async function(component, page) {
        // Navigate to Components page
        await page.goto(utils.DASHBOARD_URL, { waitUntil: 'networkidle0' });
        await page.waitForSelector('#components', { visible: true });
        await page.click('#components');

        // Navigate to details page of component assumed created
        await page.waitForSelector(`#more-details-${component}`, {
            visible: true,
        });
        await page.$eval(`#more-details-${component}`, e => e.click());
    },
    navigateToMonitorDetails: async function(component, monitor, page) {
        // Navigate to Components page
        await this.navigateToComponentDetails(component, page);

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
        await this.navigateToComponentDetails(component, page);

        // then goto list of log containers
        await page.waitForSelector('#logs');
        await page.click('#logs');

        // Navigate to details page of log container assumed created
        await page.waitForSelector(`#more-details-${applicationLog}`);
        await page.click(`#more-details-${applicationLog}`);
        await page.waitForSelector(`#application-log-title-${applicationLog}`);
    },
    navigateToErrorTrackerDetails: async function(
        component,
        errorTracker,
        page
    ) {
        // Navigate to Components page
        await this.navigateToComponentDetails(component, page);

        // then goto list of error trackers
        await page.waitForSelector('#errorTracking');
        await page.click('#errorTracking');

        // Navigate to details page of error tracker assumed created
        await page.waitForSelector(`#more-details-${errorTracker}`);
        await page.click(`#more-details-${errorTracker}`);
        await page.waitForSelector(`#error-tracker-title-${errorTracker}`);
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
            await page.click('input[name=email]');
            await page.type('input[name=email]', masterAdmin.email);
            await page.click('input[name=name]');
            await page.type('input[name=name]', 'Master Admin');
            await page.click('input[name=companyName]');
            await page.type('input[name=companyName]', 'Master');
            await page.click('input[name=companyPhoneNumber]');
            await page.type('input[name=companyPhoneNumber]', '99105688');
            await page.click('input[name=password]');
            await page.type('input[name=password]', '1234567890');
            await page.click('input[name=confirmPassword]');
            await page.type('input[name=confirmPassword]', '1234567890');
            await Promise.all([
                page.click('button[type=submit]'),
                page.waitForNavigation({ waitUntil: 'networkidle0' }),
            ]);
            await this.createUserFromAdminDashboard(user, page);
        } else {
            await this.loginUser(masterAdmin, page);
            await this.createUserFromAdminDashboard(user, page);
        }
    },
    createUserFromAdminDashboard: async function(user, page) {
        // create the user from admin dashboard
        const { email } = user;
        await page.waitForSelector('#add_user');
        await page.click('#add_user');
        await page.waitForSelector('#email');
        await page.click('input[name=email]');
        await page.type('input[name=email]', email);
        await page.click('input[name=name]');
        await page.type('input[name=name]', 'Test Name');
        await page.click('input[name=companyName]');
        await page.type('input[name=companyName]', 'Test Name');
        await page.click('input[name=companyPhoneNumber]');
        await page.type('input[name=companyPhoneNumber]', '99105688');
        await page.click('input[name=password]');
        await page.type('input[name=password]', '1234567890');
        await page.click('input[name=confirmPassword]');
        await page.type('input[name=confirmPassword]', '1234567890');
        await page.click('button[type=submit]');
        await page.waitForSelector('#frmUser', { hidden: true });
    },
    addSchedule: async function(callSchedule, page) {
        await page.goto(utils.DASHBOARD_URL);
        await page.waitForSelector('#onCallDuty', {
            visible: true,
        });
        await page.click('#onCallDuty');
        await page.evaluate(() => {
            document.querySelector('.ActionIconParent').click();
        });
        page.waitForSelector('#name', { timeout: 2000 });
        await page.type('#name', callSchedule);
        await page.click('#btnCreateSchedule');
        await page.waitForSelector(`#duty_${callSchedule}`, { visible: true });
    },
    addSubProject: async function(subProjectName, page) {
        const subProjectNameSelector = await page.$('#btn_Add_SubProjects');
        if (subProjectNameSelector) {
            await page.waitForSelector('#btn_Add_SubProjects');
            await page.click('#btn_Add_SubProjects');
            await page.waitForSelector('#title');
            await page.type('#title', subProjectName);
            await page.click('#btnAddSubProjects');
        } else {
            await page.waitForSelector('#projectSettings');
            await page.click('#projectSettings');
            await page.waitForSelector('#btn_Add_SubProjects');
            await page.click('#btn_Add_SubProjects');
            await page.waitForSelector('#title');
            await page.type('#title', subProjectName);
            await page.click('#btnAddSubProjects');
        }
        await page.waitForSelector('#btnAddSubProjects', { hidden: true });
    },
    addUserToProject: async function(data, page) {
        const { email, role, subProjectName } = data;
        await page.waitForSelector('#teamMembers');
        await page.click('#teamMembers');
        await page.waitForSelector(`#btn_${subProjectName}`);
        await page.click(`#btn_${subProjectName}`);
        await page.waitForSelector(`#frm_${subProjectName}`);
        await page.click(`#emails_${subProjectName}`);
        await page.type(`#emails_${subProjectName}`, email);
        await page.click(`#${role}_${subProjectName}`);
        await page.click(`#btn_modal_${subProjectName}`);
    },
    switchProject: async function(projectName, page) {
        await page.goto(utils.DASHBOARD_URL);
        await page.waitForSelector('#AccountSwitcherId', { visible: true });
        await page.click('#AccountSwitcherId');
        await page.waitForSelector(`#accountSwitcher div#${projectName}`);
        await page.click(`#accountSwitcher div#${projectName}`);
        await page.waitForSelector('#components', { visible: true });
    },
    renameProject: async function(newProjectName, page) {
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForSelector('#components', { timeout: 100000 });
        const projectNameSelector = await page.$('input[name=project_name');
        if (projectNameSelector) {
            await this.clear('input[name=project_name]', page);
            await page.type('input[name=project_name]', newProjectName);
            await page.click('#btnCreateProject');
        } else {
            await page.waitForSelector('#projectSettings');
            await page.click('#projectSettings');
            await page.waitForSelector('input[name=project_name]');
            await this.clear('input[name=project_name]', page);
            await page.type('input[name=project_name]', newProjectName);
            await page.click('#btnCreateProject');
        }
    },
    clear: async function(selector, page) {
        const input = await page.$(selector);
        await input.click({ clickCount: 3 });
        await input.type('');
    },
    selectByText: async function(selector, text, page) {
        await page.waitForSelector(selector, { visible: true });
        await page.click(selector);
        await page.keyboard.type(text);
        const noOption = await page.$('div.css-1gl4k7y');
        if (!noOption) {
            await page.keyboard.press('Tab');
        }
    },
    addMonitorToComponent: async function(component, monitorName, page) {
        component && (await this.addComponent(component, page));
        await page.waitForSelector('input[id=name]');
        await page.click('input[id=name]');
        await page.type('input[id=name]', monitorName);
        await page.waitForSelector('button[id=showMoreMonitors]');
        await page.click('button[id=showMoreMonitors]');
        await page.click('[data-testId=type_url]');
        await page.waitForSelector('#url', { visible: true });
        await page.click('#url');
        await page.type('#url', 'https://google.com');
        await page.click('button[type=submit]');
        await page.waitForSelector(`#monitor-title-${monitorName}`, {
            visible: true,
        });
    },
    addNewMonitorToComponent: async function(page, componentName, monitorName) {
        await page.goto(utils.DASHBOARD_URL, {
            waitUntil: 'networkidle0',
        });
        await page.waitForSelector('#components');
        await page.click('#components');
        await page.waitForSelector('#component0');
        await page.waitForSelector(`#more-details-${componentName}`);
        await page.click(`#more-details-${componentName}`);
        await page.waitForSelector('#form-new-monitor');
        await page.waitForSelector('input[id=name]');
        await page.click('input[id=name]');
        await page.type('input[id=name]', monitorName);
        await page.click('[data-testId=type_url]');
        await page.waitForSelector('#url', { visible: true });
        await page.click('#url');
        await page.type('#url', 'https://google.com');
        await page.click('button[type=submit]');
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
        await page.click('input[id=name]');
        await page.type('input[id=name]', monitorName);
        await page.click('input[data-testId=type_api]');
        await this.selectByText('#method', 'get', page);
        await page.waitForSelector('#url', { visible: true });
        await page.click('#url');
        await page.type('#url', utils.HTTP_TEST_SERVER_URL);
        await page.waitForSelector('#advanceOptions');
        await page.click('#advanceOptions');

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
        await this.selectByText(
            'ul[data-testId=up_criteria_list]> div:last-of-type #responseType',
            'responseBody',
            page
        );
        await page.waitForSelector(
            'ul[data-testId=up_criteria_list]> div:last-of-type #filter'
        );
        await this.selectByText(
            'ul[data-testId=up_criteria_list]> div:last-of-type #filter',
            'evaluateResponse',
            page
        );
        await page.waitForSelector(
            'ul[data-testId=up_criteria_list]> div:last-of-type #value'
        );
        await page.click(
            'ul[data-testId=up_criteria_list]> div:last-of-type #value'
        );
        await page.type(
            'ul[data-testId=up_criteria_list]> div:last-of-type #value',
            "response.body.status === 'ok';"
        );

        if (options.createAlertForOnline) {
            await page.click('[data-testId=criterionAdvancedOptions_up]');

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
        await this.selectByText(
            'ul[data-testId=degraded_criteria_list] > div:last-of-type #responseType',
            'responseBody',
            page
        );
        await page.waitForSelector(
            'ul[data-testId=degraded_criteria_list] > div:last-of-type #filter'
        );
        await this.selectByText(
            'ul[data-testId=degraded_criteria_list] > div:last-of-type #filter',
            'evaluateResponse',
            page
        );
        await page.waitForSelector(
            'ul[data-testId=degraded_criteria_list] > div:last-of-type #value'
        );
        await page.click(
            'ul[data-testId=degraded_criteria_list] > div:last-of-type #value'
        );
        await page.type(
            'ul[data-testId=degraded_criteria_list] > div:last-of-type #value',
            "response.body.message === 'draining';"
        );

        await Promise.all([
            page.click('button[type=submit]'),
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
        await page.click('#monitors'); // Fix this
        // await this.navigateToComponentDetails(componentName, page);
        await page.waitForSelector('#form-new-monitor');
        await page.click('input[id=name]');
        await page.type('input[id=name]', monitorName);
        //Please add a new monitor type here. IOT Device Monitor has been removed.
        await page.click('button[type=submit]');
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
            await this.selectByText('#monitorList', monitorName, page);
            await page.$eval('#createIncident', e => e.click());
        } else {
            await page.waitForSelector('#incidentLog');
            await page.$eval('#incidentLog', e => e.click());
            await page.waitForSelector(`#btnCreateIncident_${projectName}`);
            await page.$eval(`#btnCreateIncident_${projectName}`, e =>
                e.click()
            );
            await page.waitForSelector('#frmIncident');
            await this.selectByText('#monitorList', monitorName, page);
            await page.$eval('#createIncident', e => e.click());
        }
        await page.waitForSelector('#createIncident', { hidden: true });
    },
    addIncidentPriority: async function(incidentPriority, page) {
        await page.goto(utils.DASHBOARD_URL, {
            waitUntil: 'networkidle0',
        });
        await page.waitForSelector('#projectSettings');
        await page.click('#projectSettings');
        await page.waitForSelector('#more');
        await page.click('#more');
        await page.waitForSelector('#incidentSettings');
        await page.click('#incidentSettings');
        // To navigate to incident Priority tab
        await page.waitForSelector('ul#customTabList > li', {
            visible: true,
        });
        await page.$$eval('ul#customTabList > li', elems => elems[1].click());

        await page.waitForSelector('#addNewPriority');
        await page.click('#addNewPriority');
        await page.waitForSelector('#CreateIncidentPriority');
        await page.type('input[name=name]', incidentPriority);
        await page.click('#CreateIncidentPriority');
        await page.waitForSelector('#CreateIncidentPriority', { hidden: true });
    },
    addStatusPageToProject: async function(statusPageName, projectName, page) {
        const createStatusPageSelector = await page.$(
            `#btnCreateStatusPage_${projectName}`
        );
        if (createStatusPageSelector) {
            await page.click(`#btnCreateStatusPage_${projectName}`);
            await page.waitForSelector('#btnCreateStatusPage');
            await page.type('#name', statusPageName);
            await page.click('#btnCreateStatusPage');
        } else {
            await page.waitForSelector('#statusPages');
            await page.click('#statusPages');
            await page.waitForSelector(`#btnCreateStatusPage_${projectName}`);
            await page.click(`#btnCreateStatusPage_${projectName}`);
            await page.waitForSelector('#btnCreateStatusPage');
            await page.type('#name', statusPageName);
            await page.click('#btnCreateStatusPage');
        }
        await page.waitForSelector('#btnCreateStatusPage', { hidden: true });
    },
    addScheduleToProject: async function(scheduleName, projectName, page) {
        const createStatusPageSelector = await page.$(
            `#btnCreateStatusPage_${projectName}`
        );
        if (createStatusPageSelector) {
            await page.waitForSelector(`#btnCreateSchedule_${projectName}`);
            await page.click(`#btnCreateSchedule_${projectName}`);
            await page.waitForSelector('#btnCreateSchedule');
            await page.type('#name', scheduleName);
            await page.click('#btnCreateSchedule');
        } else {
            await page.waitForSelector('#onCallDuty');
            await page.click('#onCallDuty');
            await page.waitForSelector(`#btnCreateSchedule_${projectName}`);
            await page.click(`#btnCreateSchedule_${projectName}`);
            await page.waitForSelector('#btnCreateSchedule');
            await page.type('#name', scheduleName);
            await page.click('#btnCreateSchedule');
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
        await page.click('#scheduledMaintenance');
        await page.waitForSelector('#addScheduledEventButton', {
            visible: true,
        });
        await page.click('#addScheduledEventButton');

        await page.waitForSelector('#scheduledEventForm', {
            visible: true,
        });
        await page.waitForSelector('#name');
        await page.click('#name');
        await page.type('#name', scheduledEventName);
        if (monitorName) {
            await page.click('label[for=selectAllMonitorsBox]');
            await page.click('#addMoreMonitor');
            await page.waitForSelector('#monitorfield_0');
            await this.selectByText('#monitorfield_0', componentName, page); // 'Component_Name/Monitor_Name' appears in the dropdown. Using 'componentName' selects the monitor.
        }
        await page.click('#description');
        await page.type(
            '#description',
            'This is an example description for a test'
        );
        await page.waitForSelector('input[name=startDate]');
        await page.click('input[name=startDate]');
        await page.click('div.MuiDialogActions-root button:nth-child(2)');
        await page.waitForSelector(
            'div.MuiDialogActions-root button:nth-child(2)',
            { hidden: true }
        );
        await page.click('input[name=endDate]');
        await page.click('div.MuiDialogActions-root button:nth-child(2)');
        await page.waitForSelector(
            'div.MuiDialogActions-root button:nth-child(2)',
            { hidden: true }
        );
        await page.click('#createScheduledEventButton');
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
        await page.click('#AccountSwitcherId');
        await page.waitForSelector('#create-project');
        await page.click('#create-project');
        await page.waitForSelector('#name');
        await page.type('#name', projectName ? projectName : 'test');
        await page.click('label[for=Startup_month]');
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
            await frame.type('input[name=cardnumber]', '4242424242424242', {
                delay: 150,
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
            page.click('#btnCreateProject'),
            page.waitForNavigation({ waitUntil: 'networkidle0' }),
        ]);
    },
    growthPlanUpgrade: async function(page) {
        await page.goto(utils.DASHBOARD_URL);
        await page.waitForSelector('#projectSettings', { visible: true });
        await page.click('#projectSettings');
        await page.waitForSelector('#billing');
        await page.click('#billing');
        await page.waitForSelector('input#Growth_month', {
            visible: true,
        });
        await page.click('input#Growth_month');
        await page.click('#changePlanBtn');
        await page.waitForSelector('.ball-beat', { hidden: true });
    },
    addResourceCategory: async function(resourceCategory, page) {
        await page.goto(utils.DASHBOARD_URL);
        await page.waitForSelector('#projectSettings');
        await page.click('#projectSettings');
        await page.waitForSelector('#more');
        await page.click('#more');

        await page.waitForSelector('li#resources a');
        await page.click('li#resources a');
        await page.waitForSelector('#createResourceCategoryButton');
        await page.click('#createResourceCategoryButton');
        await page.waitForSelector('#resourceCategoryName');
        await page.type('#resourceCategoryName', resourceCategory);
        await page.click('#addResourceCategoryButton');
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
        await page.click('#AccountSwitcherId');
        await page.waitForSelector('#create-project');
        await page.click('#create-project');
        await page.waitForSelector('#name');
        await page.type('#name', projectName);
        await page.click('label[for=Growth_month]');
        const growthOption = await page.waitForSelector(
            'label[for=Growth_month]',
            { visible: true }
        );
        growthOption.click();
        await Promise.all([
            await page.click('#btnCreateProject'),
            await page.waitForNavigation({ waitUntil: 'networkidle0' }),
        ]);
    },
    addScaleProject: async function(projectName = 'ScaleProject', page) {
        await page.goto(utils.DASHBOARD_URL);
        await page.waitForSelector('#AccountSwitcherId');
        await page.click('#AccountSwitcherId');
        await page.waitForSelector('#create-project');
        await page.click('#create-project');
        await page.waitForSelector('#name');
        await page.type('#name', projectName);
        await page.click('label[for=Scale_month]');
        const scaleOption = await page.waitForSelector(
            'label[for=Scale_month]',
            { visible: true }
        );
        scaleOption.click();
        await Promise.all([
            await page.click('#btnCreateProject'),
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
        await page.click('#scheduledMaintenance');

        await page.waitForSelector(`#${eventBtn}`, {
            visible: true,
        });
        await page.click(`#${eventBtn}`);
        // navigate to the note tab section
        await this.gotoTab(utils.scheduleEventTabIndexes.NOTES, page);
        await page.waitForSelector(`#add-${type}-message`, {
            visible: true,
        });
        await page.click(`#add-${type}-message`);
        await page.waitForSelector('#event_state', {
            visible: true,
        });
        await this.selectByText('#event_state', eventState, page);
        await page.click('#new-internal');
        await page.type('#new-internal', noteDescription);
        await page.click('#internal-addButton');
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
        await page.click('#components');
        await page.waitForSelector(`#view-resource-${monitorName}`, {
            visible: true,
        });
        await page.click(`#view-resource-${monitorName}`);

        await page.waitForSelector(`#monitorCreateIncident_${monitorName}`);
        await page.click(`#monitorCreateIncident_${monitorName}`);
        await page.waitForSelector('#createIncident');
        await this.selectByText('#incidentType', incidentType, page);
        if (incidentPriority) {
            await this.selectByText(
                '#incidentPriority',
                incidentPriority,
                page
            );
        }
        await page.click('#createIncident');
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
        await page.click('#projectSettings');
        await page.waitForSelector('#more');
        await page.click('#more');
        await page.waitForSelector('#smsCalls');
        await page.click('#smsCalls');
        await page.waitForSelector('label[for=enabled]', {
            visible: true,
        });
        if (enableSms) await page.click('#enableTwilio');
        await page.type('#accountSid', accountSid);
        await page.type('#authToken', authToken);
        await page.type('#phoneNumber', phoneNumber);
        await page.click('#submitTwilioSettings');
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
        await page.click('#settings');
        await page.waitForSelector('#twilio');
        await page.click('#twilio');
        await page.waitForSelector('#call-enabled');
        if (enableCalls) {
            await page.$eval('#call-enabled', element => element.click());
        }
        if (enableSms) {
            await page.$eval('#sms-enabled', element => element.click());
        }
        await page.type('#account-sid', accountSid);
        await page.type('#authentication-token', authToken);
        await page.type('#phone', phoneNumber);
        await page.type('#alert-limit', alertLimit);
        await page.click('button[type=submit]');
        await page.waitFor(5000);
        await page.reload();
        await page.waitForSelector('#account-sid');
    },
    addSmtpSettings: async function(        
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
        await page.click('#projectSettings');
        await page.waitForSelector('#more');
        await page.click('#more');
        await page.waitForSelector('#email');
        await page.click('#email');        
        await page.waitForSelector('#showsmtpForm', {visible: true});
        await page.click('#showsmtpForm');// Removal of intermittency.        
        await page.waitForSelector('#user');
        await page.type('#user', user);
        await page.type('#pass', pass);
        await page.type('#host', host);
        await page.type('#port', port);
        await page.type('#from', from);
        await page.type('#name', 'Admin');
        await page.$eval('#secure', e => {
            e.checked = secure;
        });
        await page.click('#saveSmtp');
        await page.waitForSelector('.ball-beat', { visible: true });
        await page.waitForSelector('.ball-beat', { hidden: true });
        await page.reload();
        await page.waitForSelector('#user');
    },
    gotoTab: async function(tabId, page) {
        await page.waitForSelector(`#react-tabs-${tabId}`, { visible: true });
        await page.$eval(`#react-tabs-${tabId}`, e => e.click());
    },
    setAlertPhoneNumber: async (phoneNumber, code, page) => {
        await page.goto(utils.DASHBOARD_URL);
        await page.waitForSelector('#profile-menu');
        await page.click('#profile-menu');
        await page.waitForSelector('#userProfile');
        await page.click('#userProfile');
        await page.waitForSelector('input[type=tel]');
        await page.type('input[type=tel]', phoneNumber);
        await page.waitForSelector('#sendVerificationSMS');
        await page.click('#sendVerificationSMS');
        await page.waitForSelector('#otp');
        await page.type('#otp', code);
        await page.click('#verify');
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
        await this.navigateToMonitorDetails(componentName, monitorName, page);
        await page.waitForSelector('#react-tabs-2');
        await page.click('#react-tabs-2');
        await page.waitForSelector('#addSubscriberButton');
        await page.click('#addSubscriberButton');
        await page.waitForSelector('#alertViaId');
        await this.selectByText('#alertViaId', alertType, page);
        if (alertType === 'SMS') {
            const { countryCode, phoneNumber } = data;
            await page.waitForSelector('#countryCodeId');
            await this.selectByText('#countryCodeId', countryCode, page);
            await page.type('#contactPhoneId', phoneNumber);
        }
        await page.click('#createSubscriber');
    },
    addCustomField: async function(page, data, owner) {
        await page.goto(utils.DASHBOARD_URL);
        await page.waitForSelector('#projectSettings', { visible: true });
        await page.click('#projectSettings');
        if (owner === 'monitor') {
            await page.waitForSelector('#more');
            await page.click('#more');
            await page.waitForSelector('#monitor', { visible: true });
            await page.click('#monitor');
            await page.reload({
                waitUntil: 'networkidle0',
            });
            await this.gotoTab(2, page);
        } else {
            await page.waitForSelector('#more');
            await page.click('#more');
            await page.waitForSelector('#incidentSettings', { visible: true });
            await page.click('#incidentSettings');
            await page.reload({
                waitUntil: 'networkidle0',
            });
            await this.gotoTab(6, page);
        }

        await page.waitForSelector('#addCustomField', { visible: true });
        await page.click('#addCustomField');
        await page.waitForSelector('#customFieldForm', { visible: true });
        await page.click('#fieldName');
        await page.type('#fieldName', data.fieldName);
        await this.selectByText('#fieldType', data.fieldType, page);

        await page.click('#createCustomFieldButton');
        await page.waitForSelector('#customFieldForm', { visible: 'hidden' });
    },
    themeNavigationAndConfirmation: async function(page, theme) {
        await this.gotoTab(6, page);
        await page.waitForSelector(`#${theme}`, { visible: true });
        await page.click(`#${theme}`);
        await page.waitForSelector('#changePlanBtn', { visible: true });
        await page.click('#changePlanBtn');
        await this.gotoTab(0, page);
    },
};
