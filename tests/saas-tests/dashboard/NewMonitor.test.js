const puppeteer = require('puppeteer');
const utils = require('../../../test-utils');
const init = require('../../../test-init');

require('should');
let browser, page;
// user credentials
const email = utils.generateRandomBusinessEmail();
const password = '1234567890';
const user = {
    email,
    password,
};
describe('New Monitor API', () => {
    const operationTimeOut = 500000;

    beforeAll(async done => {
        jest.setTimeout(360000);

        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/61.0.3163.100 Safari/537.36'
        );
        // user
        await init.registerUser(user, page);
        done();
    });

    afterAll(async done => {
        await browser.close();
        done();
    });

    test(
        "should show upgrade modal if the current monitor count of a project equals it's monitor limit (Startup plan => 5 Monitors/User)",
        async done => {
            const componentName = utils.generateRandomString();
            // create a component
            // Redirects automatically component to details page
            await init.addComponent(componentName, page);

            for (let i = 0; i < 5; i++) {
                const monitorName = utils.generateRandomString();

                await init.addNewMonitorToComponent(
                    page,
                    componentName,
                    monitorName
                );
                await page.waitForSelector('.ball-beat', { hidden: true });
            }
            // try to add more monitor
            const monitorName = utils.generateRandomString();
            await page.goto(utils.DASHBOARD_URL);
            await page.waitForSelector('#components', { visible: true });
            await page.click('#components');
            await page.waitForSelector('#component0', { visible: true });
            await page.click(`#more-details-${componentName}`);
            await page.waitForSelector('#form-new-monitor', { visible: true });
            await page.waitForSelector('input[id=name]', { visible: true });
            await page.click('input[id=name]');
            await page.type('input[id=name]', monitorName);
            // Added new URL-Montior
            await page.click('[data-testId=type_url]');
            await page.waitForSelector('#url', { visible: true });
            await page.click('#url');
            await page.type('#url', 'https://google.com');
            await page.click('button[type=submit]');

            const pricingPlanModal = await page.waitForSelector(
                '#pricingPlanModal',
                { visible: true }
            );
            expect(pricingPlanModal).toBeTruthy();
            done();
        },
        operationTimeOut
    );

    test(
        "should show upgrade modal if the current monitor count of a project equals it's monitor limit (Growth plan => 10 Monitors/User)",
        async done => {
            const projectName = utils.generateRandomString();
            const componentName = utils.generateRandomString();
            await init.addGrowthProject(projectName, page);
            // create a component
            // Redirects automatically component to details page
            await init.addComponent(componentName, page);

            for (let i = 0; i < 10; i++) {
                const monitorName = utils.generateRandomString();

                await init.addNewMonitorToComponent(
                    page,
                    componentName,
                    monitorName
                );
                await page.waitForSelector('.ball-beat', { hidden: true });
            }
            // try to add more monitor
            const monitorName = utils.generateRandomString();
            await page.goto(utils.DASHBOARD_URL);
            await page.waitForSelector('#components', { visible: true });
            await page.click('#components');
            await page.waitForSelector('#component0', { visible: true });
            await page.click(`#more-details-${componentName}`);
            await page.waitForSelector('#form-new-monitor', { visible: true });
            await page.waitForSelector('input[id=name]', { visible: true });
            await page.click('input[id=name]');
            await page.type('input[id=name]', monitorName);
            // Added new URL-Montior
            await page.click('[data-testId=type_url]');
            await page.waitForSelector('#url', { visible: true });
            await page.click('#url');
            await page.type('#url', 'https://google.com');
            await page.click('button[type=submit]');

            const pricingPlanModal = await page.waitForSelector(
                '#pricingPlanModal',
                { visible: true }
            );
            expect(pricingPlanModal).toBeTruthy();
            done();
        },
        operationTimeOut
    );

    test(
        'should not show any upgrade modal if the project plan is on Scale plan and above',
        async done => {
            const projectName = utils.generateRandomString();
            const componentName = utils.generateRandomString();
            await init.addScaleProject(projectName, page);
            // create a component
            // Redirects automatically component to details page
            await init.addComponent(componentName, page);

            for (let i = 0; i < 15; i++) {
                const monitorName = utils.generateRandomString();

                await init.addNewMonitorToComponent(
                    page,
                    componentName,
                    monitorName
                );
                await page.waitForSelector('.ball-beat', { hidden: true });
            }

            // try to add more monitor
            const monitorName = utils.generateRandomString();
            await page.goto(utils.DASHBOARD_URL);
            await page.waitForSelector('#components', { visible: true });
            await page.click('#components');
            await page.waitForSelector('#component0', { visible: true });
            await page.click(`#more-details-${componentName}`);
            await page.waitForSelector('#form-new-monitor');
            await page.waitForSelector('input[id=name]');
            await page.click('input[id=name]');
            await page.type('input[id=name]', monitorName);
            // Added new URL-Montior
            await page.click('[data-testId=type_url]');
            await page.waitForSelector('#url', { visible: true });
            await page.click('#url');
            await page.type('#url', 'https://google.com');
            await page.click('button[type=submit]');

            const pricingPlanModal = await page.waitForSelector(
                '#pricingPlanModal',
                { hidden: true }
            );
            expect(pricingPlanModal).toBeNull();
            done();
        },
        operationTimeOut
    );
});
