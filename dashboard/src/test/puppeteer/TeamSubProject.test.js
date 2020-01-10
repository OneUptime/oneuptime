const puppeteer = require('puppeteer');
var should = require('should');
var utils = require('./test-utils');
var init = require('./test-init');
const { Cluster } = require('puppeteer-cluster');

// parent user credentials
let email = utils.generateRandomBusinessEmail();
let password = '1234567890';
let projectName = utils.generateRandomString();
// sub-project user credentials
let newEmail = utils.generateRandomBusinessEmail();
let newPassword = '1234567890';
// another user credentials
let anotherEmail = utils.generateRandomBusinessEmail();
let anotherPassword = utils.generateRandomString();

let subProjectName = utils.generateRandomString();
let subProjectMonitorName = utils.generateRandomString();

describe('Team API With SubProjects', () => {
    const operationTimeOut = 50000;

    beforeAll(async (done) => {
        jest.setTimeout(200000);

        const cluster = await Cluster.launch({
            concurrency: Cluster.CONCURRENCY_CONTEXT,
            puppeteerOptions: utils.puppeteerLaunchConfig,
            maxConcurrency: 3,
            puppeteer,
            timeout: 120000
        });

        cluster.on('taskerror', (err) => {
            throw err;
        });

        // Register user
        await cluster.task(async ({ page, data }) => {
            const user = {
                email: data.email,
                password: data.password
            }



            // user
            await init.registerUser(user, page);
            await init.loginUser(user, page);

            if(data.isParentUser){
                // rename default project
                await init.renameProject(data.projectName, page);
                // add sub-project
                await init.addSubProject(data.subProjectName, page);
            }
        });

        await cluster.queue({ projectName, subProjectName, email, password, newEmail, subProjectMonitorName, isParentUser: true });
        await cluster.queue({ projectName, subProjectName, email: newEmail, password: newPassword, isParentUser: false });
        await cluster.queue({ projectName, subProjectName, email: anotherEmail, password: anotherPassword, isParentUser: false });

        await cluster.idle();
        await cluster.close();
        done();
    });

    afterAll(async (done) => {
        done();
    });

    test('should add a new user to parent project and all sub-projects (role -> `Administrator`)', async (done)=>{
        expect.assertions(1);

        const cluster = await Cluster.launch({
            concurrency: Cluster.CONCURRENCY_CONTEXT,
            puppeteerOptions: utils.puppeteerLaunchConfig,
            puppeteer,
            timeout: 150000,
            maxConcurrency: 2
        });

        cluster.on('taskerror', (err) => {
            throw err;
        });

        await cluster.task(async ({ page, data }) => {
            const user = {
                email: data.email,
                password: data.password
            }

            await init.loginUser(user, page);
            if(data.isParentUser){
                const role = 'Administrator';

                await page.waitForSelector('#teamMembers');
                await page.click('#teamMembers');
                await page.waitForSelector(`#btn_${data.projectName}`);
                await page.click(`#btn_${data.projectName}`);
                await page.waitForSelector(`#frm_${data.projectName}`);
                await page.click(`#emails_${data.projectName}`);
                await page.type(`#emails_${data.projectName}`, data.anotherEmail);
                await page.click(`#${role}_${data.projectName}`);
                await page.click(`#btn_modal_${data.projectName}`);
                await page.waitForSelector('#btnConfirmInvite');
                await page.click('#btnConfirmInvite');
                await page.waitFor(5000);
            }else{
                await cluster.waitForOne();
                await page.reload({ waitUntil: 'networkidle2' });
                await page.waitForSelector('#AccountSwitcherId');
                await page.click('#AccountSwitcherId');
                await page.waitForSelector('#accountSwitcher');

                const projectSpanSelector = await page.$(`#span_${data.projectName}`);
                let textContent = await projectSpanSelector.getProperty('innerText');

                textContent = await textContent.jsonValue();
                expect(textContent).toEqual(data.projectName);

                const element = await page.$(`#accountSwitcher > div[title="${data.projectName}"]`);

                await element.click();
                await page.waitFor(5000);
            }
        });

        cluster.queue({ email, password, anotherEmail, projectName, isParentUser: true });
        cluster.queue({ email: anotherEmail, password: anotherPassword, projectName, isParentUser: false });

        await cluster.idle();
        await cluster.close();
        done();

    }, 200000);

    test('should add a new user to sub-project (role -> `Member`)', async (done)=>{
        expect.assertions(1);

        const cluster = await Cluster.launch({
            concurrency: Cluster.CONCURRENCY_CONTEXT,
            puppeteerOptions: utils.puppeteerLaunchConfig,
            puppeteer,
            timeout: 150000,
            maxConcurrency: 2
        });

        cluster.on('taskerror', (err) => {
            throw err;
        });

        await cluster.task(async ({ page, data }) => {
            const user = {
                email: data.email,
                password: data.password
            }

            await init.loginUser(user, page);
            if(data.isParentUser){
                const role = 'Member';

                await page.waitForSelector('#teamMembers');
                await page.click('#teamMembers');
                await page.waitForSelector(`#btn_${data.subProjectName}`);
                await page.click(`#btn_${data.subProjectName}`);
                await page.waitForSelector(`#frm_${data.subProjectName}`);
                await page.click(`#emails_${data.subProjectName}`);
                await page.type(`#emails_${data.subProjectName}`, data.newEmail);
                await page.click(`#${role}_${data.subProjectName}`);
                await page.click(`#btn_modal_${data.subProjectName}`);
                await page.waitFor(5000);
            }else{
                await cluster.waitForOne();
                await page.reload({ waitUntil: 'networkidle2' });
                await page.waitForSelector('#AccountSwitcherId');
                await page.click('#AccountSwitcherId');
                await page.waitForSelector('#accountSwitcher');

                const projectSpanSelector = await page.$(`#span_${projectName}`);
                let textContent = await projectSpanSelector.getProperty('innerText');

                textContent = await textContent.jsonValue();
                expect(textContent).toEqual(projectName);

                const element = await page.$(`#accountSwitcher > div[title="${projectName}"]`);

                await element.click();
                await page.waitFor(5000);
            }
        });

        cluster.queue({ email, password, newEmail, subProjectName, isParentUser: true });
        cluster.queue({ email: newEmail, password: newPassword, projectName, isParentUser: false });

        await cluster.idle();
        await cluster.close();
        done();

    }, 200000);

    test('should update existing user role in parent project and all sub-projects (old role -> administrator, new role -> member)', async (done) =>{
        expect.assertions(1);

        const cluster = await Cluster.launch({
            concurrency: Cluster.CONCURRENCY_PAGE,
            puppeteerOptions: utils.puppeteerLaunchConfig,
            puppeteer,
            timeout: 60000
        });
        const newRole = 'Member';

        cluster.on('taskerror', (err) => {
            throw err;
        });

        await cluster.task(async ({ page, data }) => {
            const user = {
                email: data.email,
                password: data.password
            }

            await init.loginUser(user, page);
            await page.waitForSelector('#teamMembers');
            await page.click('#teamMembers');
            await page.waitForSelector(`button[title="Change Role"]`);
            await page.click(`button[title="Change Role"]`);
            await page.waitForSelector(`div[title="${data.newRole}"]`);
            await page.click(`div[title="${data.newRole}"]`);
            await page.waitFor(5000);

            const userRoleValue = await page.$eval(`div[title="${data.newRole}"]`, el => el.textContent);

            expect(userRoleValue).toBe(data.newRole);
        });

        cluster.queue({ email, password, newRole });
        await cluster.idle();
        await cluster.close();
        done();

    }, operationTimeOut);

    test('should remove user from project Team Members and all sub-projects.', async (done) =>{
        const cluster = await Cluster.launch({
            concurrency: Cluster.CONCURRENCY_PAGE,
            puppeteerOptions: utils.puppeteerLaunchConfig,
            puppeteer,
            timeout: 60000
        });

        cluster.on('taskerror', (err) => {
            throw err;
        });

        await cluster.task(async ({ page, data }) => {
            const user = {
                email: data.email,
                password: data.password
            }

            await init.loginUser(user, page);
            await page.waitForSelector('#teamMembers');
            await page.click('#teamMembers');
            await page.waitForSelector(`button[title="delete"]`);
            await page.click(`button[title="delete"]`);
            await page.waitForSelector('#removeTeamUser');
            await page.click('#removeTeamUser');
            await page.waitFor(5000);
        });

        cluster.queue({ email, password });
        await cluster.idle();
        await cluster.close();
        done();

    }, operationTimeOut);
});