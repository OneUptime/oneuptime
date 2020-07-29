const puppeteer = require('puppeteer');
const utils = require('./test-utils');
const init = require('./test-init');
const { Cluster } = require('puppeteer-cluster');

require('should');

// user credentials
const user = {
    email: utils.generateRandomBusinessEmail(),
    password: '1234567890',
};
const user1 = {
    email: utils.generateRandomBusinessEmail(),
    password: '1234567890',
};

describe('Incident Created test', () => {
    const operationTimeOut = 500000;

    let cluster;

    beforeAll(async () => {
        jest.setTimeout(500000);

        cluster = await Cluster.launch({
            concurrency: Cluster.CONCURRENCY_PAGE,
            puppeteerOptions: utils.puppeteerLaunchConfig,
            puppeteer,
            timeout: utils.timeout,
        });

        cluster.on('taskerror', err => {
            throw err;
        });

        // Register user
        return await cluster.execute(null, async ({ page }) => {
            await init.registerUser(user, page);
            await init.registerUser(user1, page);
            await init.loginUser(user, page);
        });
    });

    afterAll(async () => {
        await cluster.idle();
        await cluster.close();
    });

    test(
        'Should show a pop up when an incident is created',
        async () => {
            const projectName = 'Project1';
            const componentName = 'Home Page';
            const monitorName = 'My Monitor';
            return await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.DASHBOARD_URL);
                // Rename project
                await page.waitForSelector('#projectSettings');
                await page.click('#projectSettings');
                await page.waitForSelector('input[name=project_name]');
                await page.click('input[name=project_name]', { clickCount: 3 });
                await page.type('input[name=project_name]', projectName);
                await page.waitForSelector('button[id=btnCreateProject]');
                await page.click('button[id=btnCreateProject]');

                await init.addComponent(componentName, page);
                await init.addMonitorToComponent(null, monitorName, page);
                await init.addIncidentToProject(monitorName, projectName, page);
                const viewIncidentButton = await page.$(
                    'button[id=viewIncident-0]'
                );
                expect(viewIncidentButton).not.toEqual(null);
            });
        },
        operationTimeOut
    );

    test(
        'Should show the incident created pop up to other team members',
        async () => {
            const projectName = 'Project1';
            const role = 'Member';
            return await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.DASHBOARD_URL);

                // Invite member on the project
                await page.waitForSelector('#teamMembers');
                await page.click('#teamMembers');
                await page.waitForSelector(`#btn_${projectName}`);
                await page.click(`#btn_${projectName}`);
                await page.waitForSelector('input[name=emails]');
                await page.click('input[name=emails]');
                await page.type('input[name=emails]', user1.email);
                await page.waitForSelector(`#${role}_${projectName}`);
                await page.click(`#${role}_${projectName}`);
                await page.waitForSelector('button[type=submit]');
                await page.click('button[type=submit]');
                await page.waitFor(5000);

                await init.logout(page);
                await init.loginUser(user1, page);
                // Switch projects
                await init.switchProject(projectName, page);
                await page.waitFor(5000);
                const viewIncidentButton = await page.$(
                    'button[id=viewIncident-0]'
                );
                expect(viewIncidentButton).not.toEqual(null);
            });
        },
        operationTimeOut
    );

    test(
        'Should navigate to incident detail page when the view button is clicked',
        async () => {
            return await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.DASHBOARD_URL);

                await page.waitForSelector('button[id=viewIncident-0]');
                await page.click('button[id=viewIncident-0]');
                let pageTitle = await page.$('#cbIncident');
                pageTitle = await pageTitle.getProperty('innerText');
                pageTitle = await pageTitle.jsonValue();
                pageTitle.should.be.exactly('Incident');
                expect(pageTitle).not.toEqual(null);
            });
        },
        operationTimeOut
    );
});
