// @ts-expect-error ts-migrate(2307) FIXME: Cannot find module 'puppeteer' or its correspondin... Remove this comment to see the full error message
import puppeteer from 'puppeteer'
import utils from '../../test-utils'
import init from '../../test-init'

let browser: $TSFixMe, page: $TSFixMe;
// user credentials
const user = {
    email: utils.generateRandomBusinessEmail(),
    password: '1234567890',
};

// @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'describe'. Do you need to instal... Remove this comment to see the full error message
describe('Custom Tutorial With SubProjects', () => {
    const operationTimeOut = init.timeout;

    // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'beforeAll'.
    beforeAll(async (done: $TSFixMe) => {
        // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'jest'.
        jest.setTimeout(init.timeout);

        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(utils.agent);

        await init.registerUser(user, page);
        done();
    });

    // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'afterAll'.
    afterAll(async (done: $TSFixMe) => {
        await browser.close();
        done();
    });
    // User is automatically route to dashboard after registration.
    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test(
        'Should show indicator on how to create component, on visiting component page, it should also appear',
        async (done: $TSFixMe) => {
            const customTutorialType = 'component';
            // Navigate to home page
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: 'networkidle2',
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            const componentBoxElement = await init.pageWaitForSelector(
                page,
                `#info-${customTutorialType}`
            );
            expect(componentBoxElement).toBeDefined();

            // click on component section
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#components');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#components');

            // find that same tutorial box on component page
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            const newComponentBoxElement = await init.pageWaitForSelector(
                page,
                `#info-${customTutorialType}`
            );
            expect(newComponentBoxElement).toBeDefined();

            done();
        },
        operationTimeOut
    );
    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test(
        'Should show indicator on how to create component, and after closing, quick tip for component should appear',
        async (done: $TSFixMe) => {
            const customTutorialType = 'component';
            // Navigate to home page
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: 'networkidle2',
            });

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            const componentBoxElement = await init.pageWaitForSelector(
                page,
                `#info-${customTutorialType}`
            );
            expect(componentBoxElement).toBeDefined();

            // click on component section
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#components');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#components');

            // find that same tutorial box on component page
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            const newComponentBoxElement = await init.pageWaitForSelector(
                page,
                `#info-${customTutorialType}`
            );
            expect(newComponentBoxElement).toBeDefined();
            // click on the call to action button
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(
                page,
                `#close-${customTutorialType}`
            );
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, `#close-${customTutorialType}`);
            // find component quick tip and confirm it shows
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            const componentQuickTip = await init.pageWaitForSelector(
                page,
                `#quick-tip-${customTutorialType}`
            );
            expect(componentQuickTip).toBeDefined();
            done();
        },
        operationTimeOut
    );
    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test(
        'Should show indicator on how to create monitor, and after closing, it should not reapprear',
        async (done: $TSFixMe) => {
            const customTutorialType = 'monitor';
            // Navigate to home page
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: 'networkidle2',
            });

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            const componentBoxElement = await init.pageWaitForSelector(
                page,
                `#info-${customTutorialType}`
            );
            expect(componentBoxElement).toBeDefined();

            // click on the call to action button
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(
                page,
                `#close-${customTutorialType}`
            );
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, `#close-${customTutorialType}`);

            done();
        },
        operationTimeOut
    );
    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test(
        'Should show indicator on how to invite team member, and after closing, it should not reapprear',
        async (done: $TSFixMe) => {
            const customTutorialType = 'teamMember';
            // Navigate to home page
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: 'networkidle2',
            });

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            const componentBoxElement = await init.pageWaitForSelector(
                page,
                `#info-${customTutorialType}`
            );
            expect(componentBoxElement).toBeDefined();

            // click on the call to action button
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(
                page,
                `#close-${customTutorialType}`
            );
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, `#close-${customTutorialType}`);

            done();
        },
        operationTimeOut
    );
});
