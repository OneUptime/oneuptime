import puppeteer from 'puppeteer';
import utils from '../../test-utils';
import init from '../../test-init';

import 'should';

// user credentials
const email: $TSFixMe = utils.generateRandomBusinessEmail();
const password: string = '1234567890';
const componentName: string = 'hackerbay';
const monitorName: string = 'oneuptime';
const monitorName1: string = 'testoneuptime';

let browser: $TSFixMe, page: $TSFixMe;
const gotoTheFirstStatusPage = async (page: $TSFixMe): void => {
    await page.goto(utils.DASHBOARD_URL, {
        waitUntil: ['networkidle2'],
    });

    await init.pageWaitForSelector(page, '#statusPages');
    await init.page$Eval(page, '#statusPages', (e: $TSFixMe) => e.click());
    const rowItem: $TSFixMe = await init.pageWaitForSelector(
        page,
        '#statusPagesListContainer > tr',
        { visible: true, timeout: init.timeout }
    );
    rowItem.click();
};

describe('Status Page', () => {
    const operationTimeOut: $TSFixMe = init.timeout;

    beforeAll(async () => {
        jest.setTimeout(init.timeout);

        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(utils.agent);
        const user: $TSFixMe = {
            email,
            password,
        };

        // user
        await init.registerUser(user, page);
        // await init.loginUser(user, page);

        //project + status page
        await init.addProject(page);
        await init.addStatusPageToProject('test', 'test', page);

        //component + monitor
        await init.addComponent(componentName, page);
        await init.addNewMonitorToComponent(page, componentName, monitorName);
        // Creates the second monitor
        await init.addAdditionalMonitorToComponent(
            page,
            componentName,
            monitorName1
        );
    });

    afterAll(async (done: $TSFixMe) => {
        await browser.close();
        done();
    });

    test(
        'should indicate that no monitor is set yet for a status page',
        async (done: $TSFixMe) => {
            await gotoTheFirstStatusPage(page);
            const elem: $TSFixMe = await init.pageWaitForSelector(
                page,
                '#app-loading',
                {
                    visible: true,
                    timeout: init.timeout,
                }
            );
            expect(elem).toBeTruthy();
            const element: $TSFixMe = await init.page$Eval(
                page,
                '#app-loading',
                (e: $TSFixMe) => {
                    return e.innerHTML;
                }
            );
            expect(element).toContain(
                'No monitors are added to this status page.'
            );
            done();
        },
        operationTimeOut
    );

    test(
        'should show error message and not submit the form if no monitor is selected and user clicks on save.',
        async (done: $TSFixMe) => {
            await gotoTheFirstStatusPage(page);
            await init.pageWaitForSelector(page, '#addMoreMonitors', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#addMoreMonitors');

            await init.pageWaitForSelector(page, '#monitor-0');

            await init.pageClick(page, '#btnAddStatusPageMonitors');
            await init.pageWaitForSelector(page, '#monitor-0', {
                visible: true,
                timeout: init.timeout,
            });
            const textContent: $TSFixMe = await init.page$Eval(
                page,
                '#monitor-0',
                (e: $TSFixMe) => e.textContent
            );
            expect(textContent.includes('A monitor must be selected.')).toEqual(
                true
            );
            await page.reload({ waitUntil: 'networkidle2' });
            const monitor: $TSFixMe = await init.pageWaitForSelector(
                page,
                '#monitor-0',
                {
                    hidden: true,
                }
            );
            expect(monitor).toBeNull();
            done();
        },
        operationTimeOut
    );

    test(
        'should show an error message and not submit the form if the users select the same monitor twice.',
        async (done: $TSFixMe) => {
            await gotoTheFirstStatusPage(page);
            await init.pageWaitForSelector(page, '#addMoreMonitors', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#addMoreMonitors');

            await init.pageWaitForSelector(page, '#monitor-0');
            await init.selectDropdownValue(
                '#monitor-0 .db-select-nw',
                `${componentName} / ${monitorName}`,
                page
            );

            await init.pageClick(page, '#addMoreMonitors');

            await init.pageWaitForSelector(page, '#monitor-1');
            await init.selectDropdownValue(
                '#monitor-1 .db-select-nw',
                `${componentName} / ${monitorName}`,
                page
            );

            await init.pageClick(page, '#btnAddStatusPageMonitors');
            await init.pageWaitForSelector(page, '#monitor-1', {
                visible: true,
                timeout: init.timeout,
            });
            const textContent: $TSFixMe = await init.page$Eval(
                page,
                '#monitor-1',
                (e: $TSFixMe) => e.textContent
            );
            expect(
                textContent.includes('This monitor is already selected.')
            ).toEqual(true);
            await page.reload({ waitUntil: 'networkidle2' });

            const monitor: $TSFixMe = await init.pageWaitForSelector(
                page,
                '#monitor-0',
                {
                    hidden: true,
                }
            );
            expect(monitor).toBeNull();
            const monitor1: $TSFixMe = await init.pageWaitForSelector(
                page,
                '#montior-1',
                {
                    hidden: true,
                }
            );
            expect(monitor1).toBeNull();
            done();
        },
        operationTimeOut
    );

    test(
        'should add a new monitor.',
        async (done: $TSFixMe) => {
            await gotoTheFirstStatusPage(page);
            await init.pageWaitForSelector(page, '#addMoreMonitors', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#addMoreMonitors');

            await init.pageWaitForSelector(page, '#monitor-0');
            await init.selectDropdownValue(
                '#monitor-0 .db-select-nw',
                `${componentName} / ${monitorName}`,
                page
            );

            await init.pageClick(page, '#btnAddStatusPageMonitors');

            await page.reload({ waitUntil: 'networkidle2' });
            const elem: $TSFixMe = await init.pageWaitForSelector(
                page,
                '#monitor-0',
                {
                    visible: true,
                    timeout: init.timeout,
                }
            );
            expect(elem).toBeDefined();
            done();
        },
        operationTimeOut
    );

    test(
        'should remove monitor.',
        async (done: $TSFixMe) => {
            await gotoTheFirstStatusPage(page);

            await init.pageWaitForSelector(page, '#monitor-0');

            await init.pageClick(page, '#delete-monitor-0');

            await init.pageClick(page, '#btnAddStatusPageMonitors');

            await page.reload({ waitUntil: 'networkidle2' });
            const elem: $TSFixMe = await init.pageWaitForSelector(
                page,
                '#app-loading',
                {
                    visible: true,
                    timeout: init.timeout,
                }
            );
            expect(elem).toBeTruthy();
            const element: $TSFixMe = await init.page$Eval(
                page,
                '#app-loading',
                (e: $TSFixMe) => {
                    return e.innerHTML;
                }
            );
            expect(element).toContain(
                'No monitors are added to this status page.'
            );
            done();
        },
        operationTimeOut
    );

    // Test Splits
});
