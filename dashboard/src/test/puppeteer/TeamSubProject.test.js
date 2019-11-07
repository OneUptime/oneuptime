const puppeteer = require('puppeteer');
var should = require('should');
var utils = require('./test-utils');
var init = require('./test-init');

let browser1, browser2, browser3, page, newPage, newPage1, userCredentials;

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

// another sub-project user credentials
let newEmail1 = utils.generateRandomBusinessEmail();
let newPassword1 = utils.generateRandomString();
const newUser1 = {
    email: newEmail1,
    password: newPassword1
};

let projectName = utils.generateRandomString();
let subProjectName = utils.generateRandomString();

describe('Team API With SubProjects', () => {
    const operationTimeOut = 50000;

    beforeAll(async () => {
        jest.setTimeout(200000);
        // browser for parent user
        browser1 = await puppeteer.launch(utils.puppeteerLaunchConfig);
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
        browser2 = await puppeteer.launch(utils.puppeteerLaunchConfig);
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

        // browser another sub-project user
        browser3 = await puppeteer.launch(utils.puppeteerLaunchConfig);
        newPage1 = await browser3.newPage();
        await newPage1.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/61.0.3163.100 Safari/537.36');

        // intercept request and mock response for login
        await newPage1.setRequestInterception(true);
        await newPage1.on('request', async (request) => {
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
        await newPage1.on('response', async (response) => {
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

        // new user (sub-project user (Member))
        await init.registerUser(newUser, newPage);
        await init.loginUser(newUser, newPage);

        // another new user (sub-project user (Administrator))
        await init.registerUser(newUser1, newPage1);
        await init.loginUser(newUser1, newPage1);


    });

    afterAll(async () => {
        await browser1.close();
        await browser2.close();
        await browser3.close();

    });

    it('should add a new user to parent project and all sub-projects (role -> `Administrator`)', async () => {
        const role = 'Administrator';
        await page.waitForSelector('#teamMembers');
        await page.click('#teamMembers');
        await page.waitForSelector(`#btn_${projectName}`);
        await page.click(`#btn_${projectName}`);
        await page.waitForSelector(`#frm_${projectName}`);
        await page.click(`#emails_${projectName}`);
        await page.type(`#emails_${projectName}`, newEmail1);
        await page.click(`#${role}_${projectName}`);
        await page.click(`#btn_modal_${projectName}`);
        await page.waitForSelector('#btnConfirmInvite');
        await page.click('#btnConfirmInvite');
        await page.waitFor(5000);
        await newPage1.reload({ waitUntil: 'networkidle2' });
        await newPage1.waitForSelector('#AccountSwitcherId');
        await newPage1.click('#AccountSwitcherId');
        await newPage1.waitForSelector('#accountSwitcher');
        const projectSpanSelector = await newPage1.$(`#span_${projectName}`);
        let textContent = await projectSpanSelector.getProperty('innerText');
        textContent = await textContent.jsonValue();
        await expect(textContent).toEqual(projectName);
        const element = await newPage1.$(`#accountSwitcher > div[title="${projectName}"]`);
        await element.click();
        await newPage1.waitFor(5000);

    }, operationTimeOut);

    it('should add a new user to sub-project (role -> `Member`)', async () => {
        const role = 'Member';
        await page.waitForSelector('#teamMembers');
        await page.click('#teamMembers');
        await page.waitForSelector(`#btn_${subProjectName}`);
        await page.click(`#btn_${subProjectName}`);
        await page.waitForSelector(`#frm_${subProjectName}`);
        await page.click(`#emails_${subProjectName}`);
        await page.type(`#emails_${subProjectName}`, newEmail);
        await page.click(`#${role}_${subProjectName}`);
        await page.click(`#btn_modal_${subProjectName}`);
        await page.waitFor(5000);
        await newPage.reload({ waitUntil: 'networkidle2' });
        await newPage.waitForSelector('#AccountSwitcherId');
        await newPage.click('#AccountSwitcherId');
        await newPage.waitForSelector('#accountSwitcher');
        const projectSpanSelector = await newPage.$(`#span_${projectName}`);
        let textContent = await projectSpanSelector.getProperty('innerText');
        textContent = await textContent.jsonValue();
        await expect(textContent).toEqual(projectName);
        const element = await newPage.$(`#accountSwitcher > div[title="${projectName}"]`);
        await element.click();
        await newPage.waitFor(5000);

    }, operationTimeOut);

    it('should update existing user role in parent project and all sub-projects (old role -> administrator, new role -> member)', async () => {
        const newRole = 'Member';
        await page.waitForSelector('#teamMembers');
        await page.click('#teamMembers');
        await page.waitForSelector(`button[title="Change Role"]`);
        await page.click(`button[title="Change Role"]`);
        await page.waitForSelector(`div[title="${newRole}"]`);
        await page.click(`div[title="${newRole}"]`);
        await page.waitFor(5000);

    }, operationTimeOut);

    it('should remove user from project Team Members and all sub-projects.', async () => {
        await page.waitForSelector(`button[title="delete"]`);
        await page.click(`button[title="delete"]`);
        await page.waitFor(5000);

    }, operationTimeOut);
});     