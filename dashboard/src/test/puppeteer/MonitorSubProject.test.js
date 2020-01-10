const puppeteer = require('puppeteer');
var should = require('should');
var utils = require('./test-utils');
var init = require('./test-init');
const { Cluster } = require('puppeteer-cluster');

// parent user credentials
let email = utils.generateRandomBusinessEmail();
let password = '1234567890';
let projectName = utils.generateRandomString();
let subProjectMonitorName = utils.generateRandomString();
// sub-project user credentials
let newEmail = utils.generateRandomBusinessEmail();
let newPassword = '1234567890';
let subProjectName = utils.generateRandomString();

describe('Monitor API With SubProjects', () => {
    const operationTimeOut = 50000;

    beforeAll(async (done) => {
        jest.setTimeout(200000);

        const cluster = await Cluster.launch({
            concurrency: Cluster.CONCURRENCY_CONTEXT,
            puppeteerOptions: utils.puppeteerLaunchConfig,
            maxConcurrency: 2,
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
                // add new user to sub-project
                await init.addUserToProject({ email: data.newEmail, role: 'Member', subProjectName: data.subProjectName }, page);
            }
        });

        cluster.queue({ projectName, subProjectName, email, password, newEmail, isParentUser: true });
        cluster.queue({ projectName, subProjectName, email: newEmail, password: newPassword, isParentUser: false });

        await cluster.idle();
        await cluster.close();
        done();
    });
    
    afterAll(async (done) => {
        done();
    });

    test('should not display new monitor form for user that is not `admin` in sub-project.', async (done) =>{
        expect.assertions(1);
        
        const cluster = await Cluster.launch({
            concurrency: Cluster.CONCURRENCY_PAGE,
            puppeteerOptions: utils.puppeteerLaunchConfig,
            puppeteer,
            timeout: 45000
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
            // switch to invited project for new user
            await init.switchProject(data.projectName, page);
            await page.waitForSelector('#monitors');
            await page.click('#monitors');

            const newMonitorForm = await page.$('#frmNewMonitor');

            expect(newMonitorForm).toEqual(null);
        });

        cluster.queue({ email: newEmail, password: newPassword, projectName });
        await cluster.idle();
        await cluster.close();
        done();

    }, operationTimeOut);

    test('should create a monitor in sub-project for valid `admin`', async (done) => {
        expect.assertions(1);

        const cluster = await Cluster.launch({
            concurrency: Cluster.CONCURRENCY_PAGE,
            puppeteerOptions: utils.puppeteerLaunchConfig,
            puppeteer,
            timeout: 45000
        });

        cluster.on('taskerror', (err) => {
            throw err;
        });

        await cluster.task(async ({ page, data }) => {
            const user = {
                email: data.email,
                password: data.password
            }
            let spanElement;
            await init.loginUser(user, page);
            // switch to invited project for new user
            await page.waitForSelector('#monitors');
            await page.click('#monitors');
            await page.waitForSelector('#frmNewMonitor');
            await page.click('input[id=name]');
            await page.type('input[id=name]', data.subProjectMonitorName);
            await init.selectByText('#type', 'url', page);
            await init.selectByText('#subProjectId', data.subProjectName, page);
            await page.waitForSelector('#url');
            await page.click('#url');
            await page.type('#url', 'https://google.com');
            await page.click('button[type=submit]');
            await page.waitFor(5000);
            spanElement = await page.$(`#monitor_title_${data.subProjectMonitorName}`);
            spanElement = await spanElement.getProperty('innerText');
            spanElement = await spanElement.jsonValue();
            expect(spanElement).toBe(data.subProjectMonitorName);
        });

        cluster.queue({ email, password, subProjectName, subProjectMonitorName });
        await cluster.idle();
        await cluster.close();
        done();

    }, operationTimeOut);

    test('should create a monitor in parent project for valid `admin`', async (done) => {
        expect.assertions(1);

        const cluster = await Cluster.launch({
            concurrency: Cluster.CONCURRENCY_PAGE,
            puppeteerOptions: utils.puppeteerLaunchConfig,
            puppeteer,
            timeout: 45000
        });
        let monitorName = utils.generateRandomString();

        cluster.on('taskerror', (err) => {
            throw err;
        });

        await cluster.task(async ({ page, data }) => {
            const user = {
                email: data.email,
                password: data.password
            }
            let spanElement;

            await init.loginUser(user, page);
            // switch to invited project for new user
            await page.waitForSelector('#monitors');
            await page.click('#monitors');
            await page.waitForSelector('#frmNewMonitor');
            await page.click('input[id=name]');
            await page.type('input[id=name]', data.monitorName);
            await init.selectByText('#type', 'url', page);
            await page.waitForSelector('#url');
            await page.click('#url');
            await page.type('#url', 'https://fyipe.com');
            await page.click('button[type=submit]');
            await page.waitFor(5000);
            spanElement = await page.$(`#monitor_title_${data.monitorName}`);
            spanElement = await spanElement.getProperty('innerText');
            spanElement = await spanElement.jsonValue();
            expect(spanElement).toBe(data.monitorName);
        });

        cluster.queue({ email, password, monitorName });
        await cluster.idle();
        await cluster.close();
        done();

    }, operationTimeOut);

    test(`should get only sub-project's monitors for valid sub-project user`, async (done) => {
        expect.assertions(2);

        const cluster = await Cluster.launch({
            concurrency: Cluster.CONCURRENCY_PAGE,
            puppeteerOptions: utils.puppeteerLaunchConfig,
            puppeteer,
            timeout: 45000
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
            // switch to invited project for new user
            await init.switchProject(data.projectName, page);

            const projectBadgeSelector = await page.$(`#badge_${data.projectName}`);
            
            expect(projectBadgeSelector).toEqual(null);
            
            const subProjectBadgeSelector = await page.$(`#badge_${data.subProjectName}`);
            let textContent = await subProjectBadgeSelector.getProperty('innerText');
            
            textContent = await textContent.jsonValue();
            expect(textContent).toEqual(data.subProjectName.toUpperCase());
        });

        cluster.queue({ email: newEmail, password: newPassword, projectName, subProjectName });
        await cluster.idle();
        await cluster.close();
        done();

    }, operationTimeOut);

    test('should get both project and sub-project monitors for valid parent project user.', async (done) => {
        expect.assertions(2);

        const cluster = await Cluster.launch({
            concurrency: Cluster.CONCURRENCY_PAGE,
            puppeteerOptions: utils.puppeteerLaunchConfig,
            puppeteer,
            timeout: 45000
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

            const projectBadgeSelector = await page.$(`#badge_${projectName}`);
            let textContent = await projectBadgeSelector.getProperty('innerText');
            
            textContent = await textContent.jsonValue();
            expect(textContent).toEqual('PROJECT');

            const subProjectBadgeSelector = await page.$(`#badge_${subProjectName}`);
            
            textContent = await subProjectBadgeSelector.getProperty('innerText');
            textContent = await textContent.jsonValue();
            expect(textContent).toEqual(subProjectName.toUpperCase());
        });

        cluster.queue({ email, password, projectName, subProjectName });
        await cluster.idle();
        await cluster.close();
        done();

    }, operationTimeOut);
});