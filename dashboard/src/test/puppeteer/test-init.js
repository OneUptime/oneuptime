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
        const { email } = user;
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
        await page.type('input[name=password]', '1234567890');
        await page.click('input[name=confirmPassword]');
        await page.type('input[name=confirmPassword]', '1234567890');

        if (checkCard) {
            await Promise.all([
                page.waitForSelector(`form#card-form`),
                page.click('button[type=submit]'),
            ]);
            await page.waitForSelector('iframe[name=__privateStripeFrame5]');
            await page.waitForSelector('iframe[name=__privateStripeFrame6]');
            await page.waitForSelector('iframe[name=__privateStripeFrame7]');

            await page.click('input[name=cardName]');
            await page.type('input[name=cardName]', 'Test name');

            elementHandle = await page.$('iframe[name=__privateStripeFrame5]');
            frame = await elementHandle.contentFrame();
            await frame.waitForSelector('input[name=cardnumber]');
            await frame.type('input[name=cardnumber]', '42424242424242424242', {
                delay: 50,
            });

            elementHandle = await page.$('iframe[name=__privateStripeFrame6]');
            frame = await elementHandle.contentFrame();
            await frame.waitForSelector('input[name=cvc]');
            await frame.type('input[name=cvc]', '123', {
                delay: 50,
            });

            elementHandle = await page.$('iframe[name=__privateStripeFrame7]');
            frame = await elementHandle.contentFrame();
            await frame.waitForSelector('input[name=exp-date]');
            await frame.type('input[name=exp-date]', '11/23', {
                delay: 50,
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
            page.waitForSelector('div#success-step'),
            page.click('button[type=submit]'),
        ]);
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
        await Promise.all([
            page.waitForNavigation(),
            page.click('button[type=submit]'),
        ]);
    },
    logout: async function(page) {
        await page.goto(utils.DASHBOARD_URL);
        await page.click('button#profile-menu');
        await page.waitForSelector('button#logout-button');
        await page.click('button#logout-button');
        await page.reload();
        await page.waitFor(3000);
    },
    addComponent: async function(component, page, projectName = null) {
        const componentsMenuItem = await page.$('#components');

        if (componentsMenuItem == null) {
            // Navigate to Components page
            await page.goto(utils.DASHBOARD_URL);
            await page.waitForSelector('#components');
        }

        await page.click('#components');

        // Fill and submit New Component form
        await page.waitForSelector('#form-new-component');
        await page.click('input[id=name]');
        await page.type('input[id=name]', component);

        if (projectName) {
            await this.selectByText('#subProjectId', projectName, page);
        }

        await page.click('button[type=submit]');
    },
    navigateToComponentDetails: async function(component, page) {
        // Navigate to Components page
        await page.goto(utils.DASHBOARD_URL);

        // Navigate to details page of component assumed created
        await page.waitForSelector(`#more-details-${component}`);
        await page.click(`#more-details-${component}`);
    },
    navigateToMonitorDetails: async function(component, monitor, page) {
        // Navigate to Components page
        await this.navigateToComponentDetails(component, page);

        // Navigate to details page of monitor assumed created
        await page.waitForSelector(`#more-details-${monitor}`);
        await page.click(`#more-details-${monitor}`);
        await page.waitForSelector(`#monitor-title-${monitor}`);
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
            await page.click('button[type=submit]');
            await page.waitFor(5000);
        }
        await this.loginUser(masterAdmin, page);
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
        await page.waitFor(10000);
    },
    addSchedule: async function(callSchedule, page) {
        await page.waitForSelector('#callSchedules');
        await page.click('#callSchedules');
        await page.evaluate(() => {
            document.querySelector('.ActionIconParent').click();
        });
        page.waitForSelector('#name', { timeout: 2000 });
        await page.type('#name', callSchedule);
        await page.click('#btnCreateSchedule');
        await page.waitFor(2000);
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
        await page.waitFor(5000);
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
        await page.waitFor(5000);
    },
    switchProject: async function(projectName, page) {
        await page.goto(utils.DASHBOARD_URL);
        // await page.waitForSelector('#AccountSwitcherId');
        await page.click('#AccountSwitcherId');
        await page.waitFor(2000);
        await page.waitForSelector(`#accountSwitcher div#${projectName}`);
        await page.click(`#accountSwitcher div#${projectName}`);
        await page.waitFor(5000);
    },
    renameProject: async function(newProjectName, page) {
        await page.reload({ waitUntil: 'domcontentloaded' });
        // Navigate to Components page
        // await page.goto(utils.DASHBOARD_URL);
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
        await page.waitFor(5000);
    },
    clear: async function(selector, page) {
        const input = await page.$(selector);
        await input.click({ clickCount: 3 });
        await input.type('');
    },
    selectByText: async function(selector, text, page) {
        await page.click(selector);
        await page.keyboard.type(text);
        const noOption = await page.$('div.css-1gl4k7y');
        // eslint-disable-next-line no-empty
        if (noOption) {
        } else {
            await page.keyboard.press('Enter');
        }
    },
    addMonitorToComponent: async function(component, monitorName, page) {
        await this.addComponent(component, page);
        // Navigate to details page of component created in previous test
        await page.waitForSelector(`#more-details-${component}`);
        await page.click(`#more-details-${component}`);

        await page.waitForSelector('#form-new-monitor');
        await page.click('input[id=name]');
        await page.type('input[id=name]', monitorName);
        await this.selectByText('#type', 'device', page);
        await page.waitForSelector('#deviceId');
        await page.click('#deviceId');
        await page.type('#deviceId', utils.generateRandomString());
        await page.click('button[type=submit]');
    },
    addMonitorToSubProject: async function(
        monitorName,
        projectName,
        componentName,
        page
    ) {
        // await page.reload({ waitUntil: 'domcontentloaded' });
        // await page.waitForSelector('#monitors');
        // await page.click('#monitors'); // Fix this
        await this.navigateToComponentDetails(componentName, page);
        await page.waitForSelector('#form-new-monitor');
        await page.click('input[id=name]');
        await page.type('input[id=name]', monitorName);
        if (projectName) {
            await this.selectByText('#subProjectId', projectName, page);
        }
        await this.selectByText('#type', 'device', page);
        await page.waitForSelector('#deviceId');
        await page.click('#deviceId');
        await page.type('#deviceId', utils.generateRandomString());
        await page.click('button[type=submit]');
        await page.waitFor(5000);
    },
    addIncidentToProject: async function(monitorName, projectName, page) {
        const createIncidentSelector = await page.$(
            `#btnCreateIncident_${projectName}`
        );
        if (createIncidentSelector) {
            await page.waitForSelector(`#btnCreateIncident_${projectName}`);
            await page.click(`#btnCreateIncident_${projectName}`);
            await page.waitForSelector('#frmIncident');
            await this.selectByText('#monitorList', monitorName, page);
            await page.click('#createIncident');
            await page.waitFor(5000);
        } else {
            await page.waitForSelector('#incidentLog a');
            await page.click('#incidentLog a');
            await page.waitForSelector(`#btnCreateIncident_${projectName}`);
            await page.click(`#btnCreateIncident_${projectName}`);
            await page.waitForSelector('#frmIncident');
            await this.selectByText('#monitorList', monitorName, page);
            await page.click('#createIncident');
            await page.waitFor(5000);
        }
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
            await page.waitForSelector('#callSchedules');
            await page.click('#callSchedules');
            await page.waitForSelector(`#btnCreateSchedule_${projectName}`);
            await page.click(`#btnCreateSchedule_${projectName}`);
            await page.waitForSelector('#btnCreateSchedule');
            await page.type('#name', scheduleName);
            await page.click('#btnCreateSchedule');
        }
    },
    addScheduledEvent: async function(eventName, eventDescription, page) {
        const addButtonSelector = '#addScheduledEventButton';
        await page.click(addButtonSelector);

        await page.waitForSelector('input[name=startDate]');
        await page.click('input[name=startDate]');
        await page.click(
            'div > div:nth-child(3) > div > div:nth-child(2) button:nth-child(2)'
        );
        await page.waitFor(1000);
        await page.click('input[name=endDate]');
        await page.click(
            'div > div:nth-child(3) > div > div:nth-child(2) button:nth-child(2)'
        );

        await page.type('input[name=name]', eventName);
        await page.type('textarea[name=description]', eventDescription);

        await page.evaluate(() => {
            document.querySelector('input[name=showEventOnStatusPage]').click();
        });
        await page.click('#createScheduledEventButton');
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
};
