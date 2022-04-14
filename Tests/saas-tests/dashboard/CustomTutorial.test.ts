import puppeteer from 'puppeteer';
import utils from '../../test-utils';
import init from '../../test-init';

let browser: $TSFixMe, page: $TSFixMe;
// user credentials
const user: $TSFixMe = {
    email: utils.generateRandomBusinessEmail(),
    password: '1234567890',
};

describe('Custom Tutorial With SubProjects', () => {
    const operationTimeOut = init.timeout;

    beforeAll(async (done: $TSFixMe) => {
        jest.setTimeout(init.timeout);

        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(utils.agent);

        await init.registerUser(user, page);
        done();
    });

    afterAll(async (done: $TSFixMe) => {
        await browser.close();
        done();
    });
    // User is automatically route to dashboard after registration.

    test(
        'Should show indicator on how to create component, on visiting component page, it should also appear',
        async (done: $TSFixMe) => {
            const customTutorialType: string = 'component';
            // Navigate to home page
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: 'networkidle2',
            });

            const componentBoxElement = await init.pageWaitForSelector(
                page,
                `#info-${customTutorialType}`
            );
            expect(componentBoxElement).toBeDefined();

            // click on component section

            await init.pageWaitForSelector(page, '#components');

            await init.pageClick(page, '#components');

            // find that same tutorial box on component page

            const newComponentBoxElement = await init.pageWaitForSelector(
                page,
                `#info-${customTutorialType}`
            );
            expect(newComponentBoxElement).toBeDefined();

            done();
        },
        operationTimeOut
    );

    test(
        'Should show indicator on how to create component, and after closing, quick tip for component should appear',
        async (done: $TSFixMe) => {
            const customTutorialType: string = 'component';
            // Navigate to home page
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: 'networkidle2',
            });

            const componentBoxElement = await init.pageWaitForSelector(
                page,
                `#info-${customTutorialType}`
            );
            expect(componentBoxElement).toBeDefined();

            // click on component section

            await init.pageWaitForSelector(page, '#components');

            await init.pageClick(page, '#components');

            // find that same tutorial box on component page

            const newComponentBoxElement = await init.pageWaitForSelector(
                page,
                `#info-${customTutorialType}`
            );
            expect(newComponentBoxElement).toBeDefined();
            // click on the call to action button

            await init.pageWaitForSelector(
                page,
                `#close-${customTutorialType}`
            );

            await init.pageClick(page, `#close-${customTutorialType}`);
            // find component quick tip and confirm it shows

            const componentQuickTip = await init.pageWaitForSelector(
                page,
                `#quick-tip-${customTutorialType}`
            );
            expect(componentQuickTip).toBeDefined();
            done();
        },
        operationTimeOut
    );

    test(
        'Should show indicator on how to create monitor, and after closing, it should not reapprear',
        async (done: $TSFixMe) => {
            const customTutorialType: string = 'monitor';
            // Navigate to home page
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: 'networkidle2',
            });

            const componentBoxElement = await init.pageWaitForSelector(
                page,
                `#info-${customTutorialType}`
            );
            expect(componentBoxElement).toBeDefined();

            // click on the call to action button

            await init.pageWaitForSelector(
                page,
                `#close-${customTutorialType}`
            );

            await init.pageClick(page, `#close-${customTutorialType}`);

            done();
        },
        operationTimeOut
    );

    test(
        'Should show indicator on how to invite team member, and after closing, it should not reapprear',
        async (done: $TSFixMe) => {
            const customTutorialType: string = 'teamMember';
            // Navigate to home page
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: 'networkidle2',
            });

            const componentBoxElement = await init.pageWaitForSelector(
                page,
                `#info-${customTutorialType}`
            );
            expect(componentBoxElement).toBeDefined();

            // click on the call to action button

            await init.pageWaitForSelector(
                page,
                `#close-${customTutorialType}`
            );

            await init.pageClick(page, `#close-${customTutorialType}`);

            done();
        },
        operationTimeOut
    );
});
