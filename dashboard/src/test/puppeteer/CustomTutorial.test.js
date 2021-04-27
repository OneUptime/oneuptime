const puppeteer = require('puppeteer');
const utils = require('./test-utils');
const init = require('./test-init');

let browser, page;
// user credentials
const user = {
    email: utils.generateRandomBusinessEmail(),
    password: '1234567890',
};

describe('Custom Tutorial With SubProjects', () => {
    const operationTimeOut = 500000;

    beforeAll(async done => {
        jest.setTimeout(500000);

        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/61.0.3163.100 Safari/537.36'
        );

        await init.registerUser(user, page);
        done();
    });

    afterAll(async done => {
        await browser.close();
        done();
    });
    // User is automatically route to dashboard after registration.
    test(
        'Should show indicator on how to create component, on visiting component page, it should also appear',
        async done => {
            const customTutorialType = 'component';
            // Navigate to home page
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: 'networkidle0',
            });
            const componentBoxElement = await page.waitForSelector(
                `#info-${customTutorialType}`
            );
            expect(componentBoxElement).toBeDefined();

            // click on component section
            await page.waitForSelector('#components');
            await page.click('#components');

            // find that same tutorial box on component page
            const newComponentBoxElement = await page.waitForSelector(
                `#info-${customTutorialType}`
            );
            expect(newComponentBoxElement).toBeDefined();

            done();
        },
        operationTimeOut
    );
    test(
        'Should show indicator on how to create component, and after closing, quick tip for component should appear',
        async done => {
            const customTutorialType = 'component';
            // Navigate to home page
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: 'networkidle0',
            });

            const componentBoxElement = await page.waitForSelector(
                `#info-${customTutorialType}`
            );
            expect(componentBoxElement).toBeDefined();

            // click on component section
            await page.waitForSelector('#components');
            await page.click('#components');

            // find that same tutorial box on component page
            const newComponentBoxElement = await page.waitForSelector(
                `#info-${customTutorialType}`
            );
            expect(newComponentBoxElement).toBeDefined();
            // click on the call to action button
            await page.waitForSelector(`#close-${customTutorialType}`);
            await page.click(`#close-${customTutorialType}`);
            // find component quick tip and confirm it shows
            const componentQuickTip = await page.waitForSelector(
                `#quick-tip-${customTutorialType}`
            );
            expect(componentQuickTip).toBeDefined();
            done();
        },
        operationTimeOut
    );
    test(
        'Should show indicator on how to create monitor, and after closing, it should not reapprear',
        async done => {
            const customTutorialType = 'monitor';
            // Navigate to home page
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: 'networkidle0',
            });

            const componentBoxElement = await page.waitForSelector(
                `#info-${customTutorialType}`
            );
            expect(componentBoxElement).toBeDefined();

            // click on the call to action button
            await page.waitForSelector(`#close-${customTutorialType}`);
            await page.click(`#close-${customTutorialType}`);

            done();
        },
        operationTimeOut
    );
    test(
        'Should show indicator on how to invite team member, and after closing, it should not reapprear',
        async done => {
            const customTutorialType = 'teamMember';
            // Navigate to home page
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: 'networkidle0',
            });

            const componentBoxElement = await page.waitForSelector(
                `#info-${customTutorialType}`
            );
            expect(componentBoxElement).toBeDefined();

            // click on the call to action button
            await page.waitForSelector(`#close-${customTutorialType}`);
            await page.click(`#close-${customTutorialType}`);

            done();
        },
        operationTimeOut
    );
});
