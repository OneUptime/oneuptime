var utils = require('./test-utils');

module.exports = {
    /**
     * 
     * @param { ObjectConstructor } user 
     * @param { string } page 
     * @description Registers a new user.
     * @returns { void }
     */
    registerUser: async function (user, page){
        const { email } = user;
        let frame, elementHandle;
        await page.goto(utils.ACCOUNTS_URL + '/register', { waitUntil: 'networkidle2' });
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
        await page.waitForSelector('iframe[name=__privateStripeFrame5]');
        await page.waitForSelector('iframe[name=__privateStripeFrame6]');
        await page.waitForSelector('iframe[name=__privateStripeFrame7]');
        await page.waitFor(5000);
        await page.click('input[name=cardName]');
        await page.type('input[name=cardName]', 'Test name');

        elementHandle = await page.$('iframe[name=__privateStripeFrame5]');
        frame = await elementHandle.contentFrame();
        await frame.waitForSelector('input[name=cardnumber]');
        await frame.type('input[name=cardnumber]', '42424242424242424242', {
            delay:50
        });

        elementHandle = await page.$('iframe[name=__privateStripeFrame6]');
        frame = await elementHandle.contentFrame();
        await frame.waitForSelector('input[name=cvc]');
        await frame.type('input[name=cvc]', '123', {
            delay:50
        });

        elementHandle = await page.$('iframe[name=__privateStripeFrame7]');
        frame = await elementHandle.contentFrame();
        await frame.waitForSelector('input[name=exp-date]');
        await frame.type('input[name=exp-date]', '11/23', {
            delay:50
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
        await page.select('#country', 'India')
        await page.click('button[type=submit]');
        await page.waitFor(25000);
    },
    loginUser: async function (user, page) {
        const { email, password } = user;
        await page.goto(utils.ACCOUNTS_URL + '/login', { waitUntil: 'networkidle2' });
        await page.waitForSelector('#login-button');
        await page.click('input[name=email]');
        await page.type('input[name=email]', email);
        await page.click('input[name=password]');
        await page.type('input[name=password]', password);
        await page.click('button[type=submit]');
        await page.waitFor(5000);
        // await page.screenshot({path: 'screenshot-login.png'});
    },
    addSchedule: async function (callSchedule, page) {
        await page.waitForSelector('#callSchedules');
        await page.click('#callSchedules');
        await page.evaluate(() => {
            document.querySelector('.ActionIconParent').click();
        });
        page.waitForSelector('#name', { timeout: 2000 });
        await page.type('#name', callSchedule);
        await page.click('#btnCreateSchedule');
        await page.waitFor(2000);
        // await page.screenshot({path: 'screenshot-addSchedule.png'});
    },
    addSubProject: async function (subProjectName, page) {
        const subProjectNameSelector = await page.$('#btnAddSubProjects');
        if (subProjectNameSelector) {
            await page.waitForSelector('#btnAddSubProjects');
            await page.click('#btnAddSubProjects');
            await page.waitForSelector('#sub_project_name_0');
            await page.type('#sub_project_name_0', subProjectName);
            await page.click('#btnSaveSubproject');
        } else {
            await page.waitForSelector('#projectSettings');
            await page.click('#projectSettings');
            await page.waitForSelector('#btnAddSubProjects');
            await page.click('#btnAddSubProjects');
            await page.waitForSelector('#sub_project_name_0');
            await page.type('#sub_project_name_0', subProjectName);
            await page.click('#btnSaveSubproject');
        }
        await page.waitFor(5000);
        // await page.screenshot({ path: 'screenshot-addSubProject.png' });
    },
    addUserToProject: async function (data, page) {
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
        // await page.screenshot({ path: 'screenshot-addUserToProject.png' });
    },
    switchProject: async function (projectName, page) {
        await page.reload({ waitUntil: 'networkidle2' });
        await page.waitForSelector('#AccountSwitcherId');
        await page.click('#AccountSwitcherId');
        await page.waitForSelector('#accountSwitcher');
        const element = await page.$(`#accountSwitcher > div[title="${projectName}"]`);
        await element.click();
        await page.waitFor(5000);
        // await page.screenshot({ path: 'screenshot-switchProject.png' });
    },
    renameProject: async function (newProjectName, page) {
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
        // await page.screenshot({ path: 'screenshot-renameProject.png' });
    },
    clear: async function (selector, page) {
        const input = await page.$(selector);
        await input.click({ clickCount: 3 })
        await input.type('');
        // await page.screenshot({path: 'screenshot-clear.png'});
    },
    selectByText: async function (selector, text, page) {
        await page.click(selector);
        await page.keyboard.type(text);
        let noOption = await page.$('div.css-1gl4k7y');
        if (!noOption) {
            await page.keyboard.type(String.fromCharCode(13));
        }
        // await page.screenshot({ path: 'screenshot-selectByText.png' });
    },
    addMonitorToProject: async function (monitorName, projectName, page) {
        await page.waitForSelector('#monitors');
        await page.click('#monitors');
        await page.waitForSelector('#frmNewMonitor');
        await page.click('input[id=name]');
        await page.type('input[id=name]', monitorName);
        await this.selectByText('#type', 'url', page);
        await this.selectByText('#subProjectId', projectName, page);
        await page.waitForSelector('#url');
        await page.click('#url');
        await page.type('#url', 'https://google.com');
        await page.click('button[type=submit]');
        await page.waitFor(5000);
        // await page.screenshot({ path: `screenshot-addMonitorToProject${monitorName}.png` });
    },
    addIncidentToProject: async function (monitorName, projectName, page) {
        const createIncidentSelector = await page.$(`#btnCreateIncident_${projectName}`);
        if (createIncidentSelector) {
            await page.waitForSelector(`#btnCreateIncident_${projectName}`);
            await page.click(`#btnCreateIncident_${projectName}`);
            await page.waitForSelector('#frmIncident');
            await this.selectByText('#monitorList', monitorName, page);
            await page.click('#createIncident');
            await page.waitFor(5000);
        } else {
            await page.waitForSelector('#monitors > div > span > ul > li > div > a');
            await page.click('#monitors > div > span > ul > li > div > a');
            await page.waitForSelector(`#btnCreateIncident_${projectName}`);
            await page.click(`#btnCreateIncident_${projectName}`);
            await page.waitForSelector('#frmIncident');
            await this.selectByText('#monitorList', monitorName, page);
            await page.click('#createIncident');
            await page.waitFor(5000);
        }
        // await page.screenshot({path: 'screenshot-addIncidentToProject.png'});
    },
    addStatusPageToProject: async function (statusPageName, projectName, page) {
        const createStatusPageSelector = await page.$(`#btnCreateStatusPage_${projectName}`);
        if (createStatusPageSelector) {
            await page.waitForSelector(`#btnCreateStatusPage_${projectName}`);
            await page.click(`#btnCreateStatusPage_${projectName}`);
            await page.waitForSelector('#btnCreateStatusPage');
            await page.type('#title', statusPageName);
            await page.click('#btnCreateStatusPage');
            await page.waitFor(5000);
        } else {
            await page.waitForSelector('#statusPages > a');
            await page.click('#statusPages > a');
            await page.waitForSelector(`#btnCreateStatusPage_${projectName}`);
            await page.click(`#btnCreateStatusPage_${projectName}`);
            await page.waitForSelector('#btnCreateStatusPage');
            await page.type('#title', statusPageName);
            await page.click('#btnCreateStatusPage');
            await page.waitFor(5000);
        }
        // await page.screenshot({path: 'screenshot-addStatusPageToProject.png'});
    },
    addScheduleToProject: async function (scheduleName, projectName, page) {
        const createStatusPageSelector = await page.$(`#btnCreateStatusPage_${projectName}`);
        if (createStatusPageSelector) {
            await page.waitForSelector(`#btnCreateSchedule_${projectName}`);
            await page.click(`#btnCreateSchedule_${projectName}`);
            await page.waitForSelector('#btnCreateSchedule');
            await page.type('#name', scheduleName);
            await page.click('#btnCreateSchedule');
            await page.waitFor(5000);
        } else {
            await page.waitForSelector('#callSchedules > a');
            await page.click('#callSchedules > a');
            await page.waitForSelector(`#btnCreateSchedule_${projectName}`);
            await page.click(`#btnCreateSchedule_${projectName}`);
            await page.waitForSelector('#btnCreateSchedule');
            await page.type('#name', scheduleName);
            await page.click('#btnCreateSchedule');
            await page.waitFor(5000);
        }
        // await page.screenshot({path: 'screenshot-addScheduleToProject.png'});
    }
}