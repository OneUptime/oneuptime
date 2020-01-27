const puppeteer = require('puppeteer');
var should = require('should');
var utils = require('./test-utils');
var init = require('./test-init');
const { Cluster } = require('puppeteer-cluster');

// parent user credentials
let email = utils.generateRandomBusinessEmail();
let password = '1234567890';

// sub-project user credentials
let newEmail = utils.generateRandomBusinessEmail();
let newPassword = '1234567890';

let projectName = utils.generateRandomString();
let projectMonitorName = utils.generateRandomString();
let subProjectMonitorName = utils.generateRandomString();
let subProjectName = utils.generateRandomString();

describe('Incident API With SubProjects', () => {
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
                // add new monitor to parent project
                await init.addMonitorToSubProject(data.projectMonitorName, data.projectName, page);
                // add new monitor to sub-project
                await init.addMonitorToSubProject(data.subProjectMonitorName, data.subProjectName, page);
            }
        });

        await cluster.queue({ projectName, subProjectName, email, password, newEmail, projectMonitorName, subProjectMonitorName, isParentUser: true });
        await cluster.queue({ projectName, subProjectName, email: newEmail, password: newPassword, isParentUser: false });

        await cluster.idle();
        await cluster.close();
        done();
    });

    afterAll(async (done) => {
        done();
    });


    test('should create an incident in parent project for valid `admin`', async (done) => {
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
            await page.waitForSelector(`#create_incident_${data.projectMonitorName}`);
            await page.click(`#create_incident_${data.projectMonitorName}`);
            await page.waitForSelector('#createIncident');
            await init.selectByText('#incidentType', 'Offline', page);
            await page.click('#createIncident');
            await page.waitForSelector('#incident_span_0');
            const incidentTitleSelector = await page.$('#incident_span_0');

            let textContent = await incidentTitleSelector.getProperty('innerText');
            textContent = await textContent.jsonValue();
            expect(textContent.toLowerCase()).toEqual(`${projectMonitorName}'s Incident Status`.toLowerCase());
        });

        cluster.queue({ email, password, projectMonitorName });
        await cluster.idle();
        await cluster.close();
        done();
    }, operationTimeOut);

    test('should create an incident in sub-project for sub-project `member`', async (done) => {
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
            // create incident
            await page.waitForSelector(`#create_incident_${data.subProjectMonitorName}`);
            await page.click(`#create_incident_${data.subProjectMonitorName}`);
            await page.waitForSelector('#createIncident');
            await init.selectByText('#incidentType', 'Offline', page);
            await page.click('#createIncident');
            await page.waitForSelector('#incident_span_0');
            const incidentTitleSelector = await page.$('#incident_span_0');

            let textContent = await incidentTitleSelector.getProperty('innerText');
            textContent = await textContent.jsonValue();
            expect(textContent.toLowerCase()).toEqual(`${subProjectMonitorName}'s Incident Status`.toLowerCase());
        });

        cluster.queue({ email: newEmail, password: newPassword, projectName, subProjectMonitorName });
        await cluster.idle();
        await cluster.close();
        done();

    }, operationTimeOut);

    test('should acknowledge incident in sub-project for sub-project `member`', async (done) => {
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
            // acknowledge incident
            await page.waitForSelector('#btnAcknowledge_0');
            await page.click('#btnAcknowledge_0');
            await page.waitForSelector('#AcknowledgeText_0');

            const acknowledgeTextSelector = await page.$('#AcknowledgeText_0');
            expect(acknowledgeTextSelector).not.toBeNull();
        });

        cluster.queue({ email: newEmail, password: newPassword, projectName, subProjectMonitorName });
        await cluster.idle();
        await cluster.close();
        done();

    }, operationTimeOut);


    test('should resolve incident in sub-project for sub-project `member`', async (done) => {
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
            // resolve incident
            await page.waitForSelector('#btnResolve_0');
            await page.click('#btnResolve_0');
            await page.waitForSelector('#ResolveText_0');

            const resolveTextSelector = await page.$('#ResolveText_0');
            expect(resolveTextSelector).not.toBeNull();
        });

        cluster.queue({ email: newEmail, password: newPassword, projectName });
        await cluster.idle();
        await cluster.close();
        done();

    }, operationTimeOut);

    test('should update internal and investigation notes of incident in sub-project', async (done) => {
        expect.assertions(2);

        const cluster = await Cluster.launch({
            concurrency: Cluster.CONCURRENCY_PAGE,
            puppeteerOptions: utils.puppeteerLaunchConfig,
            puppeteer,
            timeout: 100000
        });
        let investigationNote = utils.generateRandomString();
        let internalNote = utils.generateRandomString();

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
            // update internal note
            await page.waitForSelector(`#incident_${data.subProjectMonitorName}_0`);
            await page.click(`#incident_${data.subProjectMonitorName}_0`);
            await page.waitForSelector('#txtInternalNote');
            await page.type('#txtInternalNote', data.internalNote);
            await page.click('#btnUpdateInternalNote');
            await page.waitFor(5000);
            await page.waitForSelector('#txtInvestigationNote');
            await page.type('#txtInvestigationNote', data.investigationNote);
            await page.click('#btnUpdateInvestigationNote');
            await page.waitFor(5000);

            const internalNoteSelector = await page.$('#txtInternalNote');
            let internalContent = await internalNoteSelector.getProperty('textContent');

            internalContent = await internalContent.jsonValue();
            expect(internalContent).toEqual(internalNote);

            const investigationNoteSelector = await page.$('#txtInvestigationNote');
            let investigationContent = await investigationNoteSelector.getProperty('textContent');

            investigationContent = await investigationContent.jsonValue();
            expect(investigationContent).toEqual(investigationNote);

        });

        cluster.queue({ email: newEmail, password: newPassword, subProjectMonitorName, projectName, internalNote, investigationNote });
        await cluster.idle();
        await cluster.close();
        done();

    }, operationTimeOut);

    test('should get list of incidents and paginate for incidents in sub-project', async (done) => {
        expect.assertions(3);

        const cluster = await Cluster.launch({
            concurrency: Cluster.CONCURRENCY_PAGE,
            puppeteerOptions: utils.puppeteerLaunchConfig,
            puppeteer,
            timeout: 140000,
        });

        cluster.on('taskerror', (err) => {
            throw err;
        });

        const paginate = async ({ page, data }) => {
            const user = {
                email: data.email,
                password: data.password
            }

            await init.loginUser(user, page);
            // switch to invited project for new user
            await init.switchProject(data.projectName, page);

            for (let i = 0; i < 10; i++) {
                await init.addIncidentToProject(data.subProjectMonitorName, data.subProjectName, page);
            }

            let incidentRows = await page.$$('tr.incidentListItem');
            let countIncidents = incidentRows.length;

            expect(countIncidents).toEqual(10);

            const nextSelector = await page.$('#btnNext');

            await nextSelector.click();
            await page.waitFor(5000);
            incidentRows = await page.$$('tr.incidentListItem');
            countIncidents = incidentRows.length;
            expect(countIncidents).toEqual(1);

            const prevSelector = await page.$('#btnPrev');

            await prevSelector.click();
            await page.waitFor(5000);
            incidentRows = await page.$$('tr.incidentListItem');
            countIncidents = incidentRows.length;
            expect(countIncidents).toEqual(10);
        }

        cluster.queue({ email: newEmail, password: newPassword, subProjectMonitorName, subProjectName, projectName, counter: 0, limit: 10 }, paginate);

        await cluster.idle();
        await cluster.close();
        done();

    }, 200000);

});