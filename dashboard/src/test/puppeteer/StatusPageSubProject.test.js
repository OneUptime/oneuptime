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



describe('StatusPage API With SubProjects', () => {
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

            if (data.isParentUser) {
                // rename default project
                await init.renameProject(data.projectName, page);
                // add sub-project
                await init.addSubProject(data.subProjectName, page);
                // add new user to sub-project
                await init.addUserToProject({ email: data.newEmail, role: 'Member', subProjectName: data.subProjectName }, page);
                // add new monitor to sub-project
                await init.addMonitorToSubProject(data.subProjectMonitorName, data.subProjectName, page);
            }
        });

        await cluster.queue({ projectName, subProjectName, email, password, newEmail, subProjectMonitorName, isParentUser: true });
        await cluster.queue({ projectName, subProjectName, email: newEmail, password: newPassword, isParentUser: false });

        await cluster.idle();
        await cluster.close();
        done();
    });

    afterAll(async (done) => {
        done();
    });

    test('should not display create status page button for subproject `member` role.', async (done) => {
        expect.assertions(1);

        const cluster = await Cluster.launch({
            concurrency: Cluster.CONCURRENCY_PAGE,
            puppeteerOptions: utils.puppeteerLaunchConfig,
            puppeteer,
            timeout: 100000
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
            await page.waitForSelector(`#statusPages > a`);
            await page.click(`#statusPages > a`);

            const createButton = await page.$(`#btnCreateStatusPage_${data.subProjectName}`);

            expect(createButton).toBe(null);
        });

        cluster.queue({ email: newEmail, password: newPassword, projectName, subProjectName });
        await cluster.idle();
        await cluster.close();
        done();

    }, operationTimeOut);

    test('should create a status page in sub-project for sub-project `admin`', async (done) => {
        expect.assertions(1);

        const cluster = await Cluster.launch({
            concurrency: Cluster.CONCURRENCY_PAGE,
            puppeteerOptions: utils.puppeteerLaunchConfig,
            puppeteer,
            timeout: 100000
        });
        const statuspageName = utils.generateRandomString();

        cluster.on('taskerror', (err) => {
            throw err;
        });

        await cluster.task(async ({ page, data }) => {
            const user = {
                email: data.email,
                password: data.password
            }
            await init.loginUser(user, page);
            await init.addStatusPageToProject(data.statuspageName, data.subProjectName, page);
            await page.waitForSelector(`#status_page_count_${data.subProjectName}`);

            const statusPageCountSelector = await page.$(`#status_page_count_${data.subProjectName}`);
            let textContent = await statusPageCountSelector.getProperty('innerText');

            textContent = await textContent.jsonValue();
            expect(textContent).toEqual('1 Status Page');
        });

        cluster.queue({ email, password, subProjectName, statuspageName });
        await cluster.idle();
        await cluster.close();
        done();

    }, operationTimeOut);

    test('should get list of status pages in sub-projects and paginate status pages in sub-project', async (done) => {
        expect.assertions(3);

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
            if (data.isParentUser) {
                // add 10 more statuspages to sub-project to test for pagination
                for (let i = 0; i < 10; i++) {
                    const statuspageName = utils.generateRandomString();
                    await init.addStatusPageToProject(statuspageName, data.subProjectName, page);
                }
            } else {
                await cluster.waitForOne();
                // switch to invited project for new user
                await init.switchProject(data.projectName, page);
                await page.waitForSelector(`#statusPages > a`);
                await page.click(`#statusPages > a`);
                await page.waitFor(5000);

                let statusPageRows = await page.$$('tr.statusPageListItem');
                let countStatusPages = statusPageRows.length;

                expect(countStatusPages).toEqual(10);

                const nextSelector = await page.$('#btnNext');

                await nextSelector.click();
                await page.waitFor(5000);
                statusPageRows = await page.$$('tr.statusPageListItem');
                countStatusPages = statusPageRows.length;
                expect(countStatusPages).toEqual(1);

                const prevSelector = await page.$('#btnPrev');

                await prevSelector.click();
                await page.waitFor(5000);
                statusPageRows = await page.$$('tr.statusPageListItem');
                countStatusPages = statusPageRows.length;
                expect(countStatusPages).toEqual(10);
            }
        });

        cluster.queue({ email, password, subProjectName, isParentUser: true });
        cluster.queue({ email: newEmail, password: newPassword, projectName, isParentUser: false });

        await cluster.idle();
        await cluster.close();
        done();

    }, 200000);

    test('should update sub-project status page settings', async (done) => {
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
            await page.waitForSelector(`#statusPages > a`);
            await page.click(`#statusPages > a`);
            await page.waitFor(3000);
            await page.waitForSelector('tr.statusPageListItem')
            await page.click('tr.statusPageListItem');
            await page.waitFor(3000);
            await page.waitForSelector(`span[title="${data.subProjectMonitorName}"]`);
            await page.click(`span[title="${data.subProjectMonitorName}"]`);
            await page.click(`#btnAddStatusPageMonitors`);
            await page.click('#domain');
            await page.type('#domain', 'https://fyipe.com');
            await page.click('#btnAddDomain');
            await page.click('textarea[name=description]');
            await page.type('textarea[name=description]', 'Statuspage Description');
            await page.waitForSelector('#btnAddLink');
            await page.click('#btnAddLink');
            await page.waitForSelector('#name');
            await page.click('#name');
            await page.type('#name', 'Home');
            await page.click('#url');
            await page.type('#url', 'https://fyipe.com');
            await page.click('#createFooter');
            await page.waitFor(5000);

        });

        cluster.queue({ email, password, subProjectMonitorName });
        await cluster.idle();
        await cluster.close();
        done();

    }, operationTimeOut);

    test('should delete sub-project status page', async (done) => {
        expect.assertions(1);

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
            await page.waitForSelector(`#statusPages > a`);
            await page.click(`#statusPages > a`);
            await page.waitFor(3000);
            await page.waitForSelector('tr.statusPageListItem');
            await page.click('tr.statusPageListItem');
            await page.waitFor(5000);
            await page.waitForSelector('#delete');
            await page.click('#delete');
            await page.waitForSelector('#confirmDelete');
            await page.click('#confirmDelete');
            await page.waitFor(5000);
            await page.waitForSelector(`#statusPages > a`);
            await page.click(`#statusPages > a`);
            await page.waitFor(5000);

            let statusPageRows = await page.$$('tr.statusPageListItem');
            let countStatusPages = statusPageRows.length;

            expect(countStatusPages).toEqual(10);
        });

        cluster.queue({ email, password, projectName, subProjectMonitorName });
        await cluster.idle();
        await cluster.close();
        done();

    }, operationTimeOut);
});     