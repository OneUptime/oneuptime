// @ts-expect-error ts-migrate(2307) FIXME: Cannot find module 'puppeteer' or its correspondin... Remove this comment to see the full error message
import puppeteer from 'puppeteer';
import utils from '../../test-utils';
import init from '../../test-init';
let browser: $TSFixMe, page: $TSFixMe;

// parent user credentials
const email = utils.generateRandomBusinessEmail();
const password = '1234567890';

const monitorName = utils.generateRandomString();
const componentName = utils.generateRandomString();

// @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'describe'. Do you need to instal... Remove this comment to see the full error message
describe('Incident Reports API', () => {
    const operationTimeOut = init.timeout;

    // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'beforeAll'.
    beforeAll(async () => {
        // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'jest'.
        jest.setTimeout(360000);

        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(utils.agent);

        const user = {
            email,
            password,
        };
        // user
        await init.registerUser(user, page);

        // Create component
        await init.addComponent(componentName, page);

        // add new monitor to project
        await init.addNewMonitorToComponent(page, componentName, monitorName);
    });

    // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'afterAll'.
    afterAll(async (done: $TSFixMe) => {
        await browser.close();
        done();
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test(
        'should create 5 incidents and resolved them',
        async (done: $TSFixMe) => {
            for (let i = 0; i < 4; i++) {
                await init.navigateToMonitorDetails(
                    componentName,
                    monitorName,
                    page
                );
                // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
                await init.pageClick(
                    page,
                    `#monitorCreateIncident_${monitorName}`
                );
                // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
                await init.pageWaitForSelector(page, '#incidentType');
                // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
                await init.pageClick(page, '#createIncident');
                await init.pageWaitForSelector(page, '#createIncident', {
                    hidden: true,
                });
                // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
                await init.pageClick(page, '#viewIncident-0');
                // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
                await init.pageWaitForSelector(page, '#btnAcknowledge_0');
                // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
                await init.pageClick(page, '#btnAcknowledge_0');
                // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
                await init.pageClick(page, '#btnResolve_0');

                // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
                const resolvedConfirmation = await init.pageWaitForSelector(
                    page,
                    '.bs-resolved-green'
                );
                expect(resolvedConfirmation).toBeDefined();
            }
            done();
        },
        operationTimeOut
    );

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test(
        'should notice that all resolved incidents are closed on navigation to dashboard',
        async (done: $TSFixMe) => {
            // Resolved Incidents are closed on page reload or navigation to dashboard.
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: 'networkidle2',
            });

            const closedResolvedIncidents = await init.pageWaitForSelector(
                page,
                '#incidents-close-all-btn',
                { hidden: true }
            );
            expect(closedResolvedIncidents).toBeNull();
            done();
        },
        operationTimeOut
    );
});
