const puppeteer = require('puppeteer');
var should = require('should');
var utils = require('./test-utils');
var init = require('./test-init');

let browser1, browser2, page, newPage, userCredentials;

// parent user credentials
let email = utils.generateRandomBusinessEmail();
let password = utils.generateRandomString();
const user = {
    email,
    password
};

// sub-project user credentials
let newEmail = utils.generateRandomBusinessEmail();
let newPassword = utils.generateRandomString();
const newUser = {
    email: newEmail,
    password: newPassword
};

let projectName = utils.generateRandomString();
let subProjectMonitorName = utils.generateRandomString();
let subProjectName = utils.generateRandomString();


describe('Schedule API With SubProjects', () => {
    const operationTimeOut = 20000;


    beforeAll(async (done) => {
        jest.setTimeout(200000);
        // browser for parent user
        browser1 = await puppeteer.launch();
        page = await browser1.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/61.0.3163.100 Safari/537.36');

        // intercept request and mock response for login
        await page.setRequestInterception(true);
        await page.on('request', async (request) => {
            if ((await request.url()).match(/user\/login/)) {
                request.respond({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify(userCredentials)
                });
            } else {
                request.continue();
            }
        });
        await page.on('response', async (response) => {
            try {
                var res = await response.json();
                if (res && res.tokens) {
                    userCredentials = res;
                }
            } catch (error) { }
        });

        // browser sub-project user
        browser2 = await puppeteer.launch();
        newPage = await browser2.newPage();
        await newPage.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/61.0.3163.100 Safari/537.36');

        // intercept request and mock response for login
        await newPage.setRequestInterception(true);
        await newPage.on('request', async (request) => {
            if ((await request.url()).match(/user\/login/)) {
                request.respond({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify(userCredentials)
                });
            } else {
                request.continue();
            }
        });
        await newPage.on('response', async (response) => {
            try {
                var res = await response.json();
                if (res && res.tokens) {
                    userCredentials = res;
                }
            } catch (error) { }
        });

        // parent user
        await init.registerUser(user, page);
        await init.loginUser(user, page);

        // rename default project
        await init.renameProject(projectName, page);

        // add sub-project
        await init.addSubProject(subProjectName, page);

        // new user (sub-project user)
        await init.registerUser(newUser, newPage);
        await init.loginUser(newUser, newPage);

        // add new user to sub-project
        await init.addUserToProject({ email: newUser.email, role: 'Member', subProjectName }, page);

        // switch to invited project for new user
        await init.switchProject(projectName, newPage);

        // add new monitor to parent project and sub-project
        await init.addMonitorToProject(subProjectMonitorName, subProjectName, page);

        done();
    });

    afterAll(async (done) => {
        await browser1.close();
        await browser2.close();
        done();
    });

    it('should not display create schedule button for subproject `member` role.', async (done) => {
        await newPage.waitForSelector(`#callSchedules > a`);
        await newPage.click(`#callSchedules > a`);
        const createButton = await newPage.$(`#btnCreateSchedule_${subProjectName}`);
        expect(createButton).toBe(null);
        done();
    });

    it('should create a schedule in sub-project for sub-project `admin`', async (done) => {
        const statuspageName = utils.generateRandomString();
        await page.waitForSelector(`#callSchedules > a`);
        await page.click(`#callSchedules > a`);
        await page.waitForSelector(`#btnCreateSchedule_${subProjectName}`);
        await page.click(`#btnCreateSchedule_${subProjectName}`);
        await page.waitForSelector('#btnCreateSchedule');
        await page.type('#name', statuspageName);
        await page.click('#btnCreateSchedule');
        await page.waitFor(5000);
        await page.waitForSelector(`#schedule_count_${subProjectName}`);
        const scheduleCountSelector = await page.$(`#schedule_count_${subProjectName}`);
        let textContent = await scheduleCountSelector.getProperty('innerText');
        textContent = await textContent.jsonValue();
        await expect(textContent).toEqual('1 schedule');
        done();
    }, operationTimeOut);

    it('should get list schedules in sub-projects and paginate schedules in sub-project', async (done) => {
        // add 10 more schedules to sub-project to test for pagination
        for (let i = 0; i < 10; i++) {
            const scheduleName = utils.generateRandomString();
            await init.addScheduleToProject(scheduleName, subProjectName, page);
        }
        await newPage.reload({ waitUntil: 'networkidle2' });
        await newPage.waitForSelector(`#callSchedules > a`);
        await newPage.click(`#callSchedules > a`);
        await newPage.waitFor(5000);
        let countSchedules = (await newPage.$$('tr.Table-row.db-ListViewItem.bs-ActionsParent.db-ListViewItem--hasLink')).length;
        expect(countSchedules).toEqual(10);
        const nextSelector = await newPage.$('button[data-db-analytics-name="list_view.pagination.next"]');
        await nextSelector.click();
        await newPage.waitFor(5000);
        countSchedules = (await newPage.$$('tr.Table-row.db-ListViewItem.bs-ActionsParent.db-ListViewItem--hasLink')).length;
        expect(countSchedules).toEqual(1);
        const prevSelector = await newPage.$('button[data-db-analytics-name="list_view.pagination.previous"]');
        await prevSelector.click();
        await newPage.waitFor(5000);
        countSchedules = (await newPage.$$('tr.Table-row.db-ListViewItem.bs-ActionsParent.db-ListViewItem--hasLink')).length;
        expect(countSchedules).toEqual(10);
        done();
    }, 120000);

    it('should add monitor to sub-project schedule', async (done) => {
        await page.waitForSelector('.Table-row.db-ListViewItem.bs-ActionsParent.db-ListViewItem--hasLink')
        await page.click('.Table-row.db-ListViewItem.bs-ActionsParent.db-ListViewItem--hasLink');
        await page.waitFor(5000);
        await page.waitForSelector(`span[title="${subProjectMonitorName}"]`);
        await page.click(`span[title="${subProjectMonitorName}"]`);
        await page.waitForSelector('#btnSaveMonitors');
        await page.click('#btnSaveMonitors');
        await page.waitFor(5000);
        done();
    }, operationTimeOut);

    it('should delete sub-project schedule', async (done) => {
        await page.waitForSelector('#delete');
        await page.click('#delete');
        await page.waitForSelector('#confirmDelete');
        await page.click('#confirmDelete');
        await page.waitFor(5000);
        done();
    }, operationTimeOut);
});     