import puppeteer from 'puppeteer';
import utils from '../../test-utils';
import init from '../../test-init';

import 'should';

// user credentials
const user: $TSFixMe = {
    email: utils.generateRandomBusinessEmail(),
    password: '1234567890',
};
const componentName: string = utils.generateRandomString();

let browser: $TSFixMe, page: $TSFixMe;

describe('Components', () => {
    const operationTimeOut: $TSFixMe = init.timeout;

    beforeAll(async () => {
        jest.setTimeout(init.timeout);

        browser = await puppeteer.launch({
            ...utils.puppeteerLaunchConfig,
        });
        page = await browser.newPage();

        await page.setUserAgent(utils.agent);

        await init.registerUser(user, page);
    });

    afterAll(async (done: $TSFixMe) => {
        await browser.close();
        done();
    });

    test(
        'Should show indicator on how to invite new Team members since no other member exist, then goto team page ',
        async (done: $TSFixMe) => {
            // Navigate to home page
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: 'networkidle0',
            });

            const componentBoxElement: $TSFixMe =
                await init.pageWaitForSelector(page, '#info-teamMember');
            expect(componentBoxElement).toBeDefined();

            let spanElement: $TSFixMe;

            spanElement = await init.pageWaitForSelector(
                page,
                `span#box-header-teamMember`
            );
            spanElement = await spanElement.getProperty('innerText');
            spanElement = await spanElement.jsonValue();
            spanElement.should.be.exactly('Invite your Team');

            // click on the call to action button

            await init.pageWaitForSelector(page, '#gotoPage-teamMember');
            await init.page$Eval(page, '#gotoPage-teamMember', (e: $TSFixMe) =>
                e.click()
            );

            const componentFormElement: $TSFixMe =
                await init.pageWaitForSelector(page, `#teamMemberPage`);
            expect(componentFormElement).toBeDefined();
            done();
        },
        operationTimeOut
    );

    test(
        'Should show indicator on how to create a component since no component exist, then goto component creation ',
        async (done: $TSFixMe) => {
            // Navigate to home page
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: 'networkidle0',
            });

            const componentBoxElement: $TSFixMe =
                await init.pageWaitForSelector(page, '#info-component');
            expect(componentBoxElement).toBeDefined();

            let spanElement: $TSFixMe;

            spanElement = await init.pageWaitForSelector(
                page,
                `span#box-header-component`
            );
            spanElement = await spanElement.getProperty('innerText');
            spanElement = await spanElement.jsonValue();
            spanElement.should.be.exactly('Create your first Component');

            // click on the call to action button

            await init.pageWaitForSelector(page, '#gotoPage-component');
            await init.page$Eval(page, '#gotoPage-component', (e: $TSFixMe) =>
                e.click()
            );

            const componentFormElement: $TSFixMe =
                await init.pageWaitForSelector(page, '#form-new-component');
            expect(componentFormElement).toBeDefined();
            done();
        },
        operationTimeOut
    );

    test(
        'Should create new component',
        async (done: $TSFixMe) => {
            // Navigate to Components page
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: 'networkidle0',
            });

            await init.pageWaitForSelector(page, '#components');
            await init.page$Eval(page, '#components', (e: $TSFixMe) =>
                e.click()
            );
            // Fill and submit New Component form

            await init.pageWaitForSelector(page, '#form-new-component');

            await init.pageType(page, 'input[id=name]', componentName);
            await init.page$Eval(page, 'button[type=submit]', (e: $TSFixMe) =>
                e.click()
            );
            await page.goto(utils.DASHBOARD_URL);
            await init.pageWaitForSelector(page, '#components', {
                visible: true,
                timeout: init.timeout,
            });
            await init.page$Eval(page, '#components', (e: $TSFixMe) =>
                e.click()
            );

            let spanElement: $TSFixMe;

            spanElement = await init.pageWaitForSelector(
                page,
                `span#component-title-${componentName}`
            );
            spanElement = await spanElement.getProperty('innerText');
            spanElement = await spanElement.jsonValue();
            spanElement.should.be.exactly(componentName);
            done();
        },
        operationTimeOut
    );

    test(
        'Should show indicator on how to create a monitor since a component exist, then goto monitor creation',
        async (done: $TSFixMe) => {
            // Navigate to home page
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: 'networkidle0',
            });

            const monitorBoxElement: $TSFixMe = await init.pageWaitForSelector(
                page,
                '#info-monitor'
            );
            expect(monitorBoxElement).toBeDefined();

            let spanElement: $TSFixMe;

            spanElement = await init.pageWaitForSelector(
                page,
                `span#box-header-monitor`
            );
            spanElement = await spanElement.getProperty('innerText');
            spanElement = await spanElement.jsonValue();
            spanElement.should.be.exactly('Create a Monitor');

            // click on the call to action button

            await init.pageWaitForSelector(page, '#gotoPage-monitor');
            await init.page$Eval(page, '#gotoPage-monitor', (e: $TSFixMe) =>
                e.click()
            );

            // Navigate to Component details

            await init.pageWaitForSelector(
                page,
                `#more-details-${componentName}`
            );
            await init.page$Eval(
                page,
                `#more-details-${componentName}`,
                (e: $TSFixMe) => e.click()
            );

            await init.pageWaitForSelector(page, '#form-new-monitor');
            done();
        },
        operationTimeOut
    );

    test(
        'should show the correct path on the breadcrumbs inside a component',
        async (done: $TSFixMe) => {
            await page.goto(utils.DASHBOARD_URL);
            await init.pageWaitForSelector(page, '#components', {
                visible: true,
                timeout: init.timeout,
            });
            await init.page$Eval(page, '#components', (e: $TSFixMe) =>
                e.click()
            );

            const moreBtn: string = `#more-details-${componentName}`;
            await init.pageWaitForSelector(page, moreBtn, {
                visible: true,
                timeout: init.timeout,
            });
            await init.page$Eval(page, moreBtn, (e: $TSFixMe) => e.click());

            const projectSelector: string = `#cbUnnamedProject`;
            const componentSelector: string = `#cb${componentName}`;
            await init.pageWaitForSelector(page, projectSelector, {
                visible: true,
                timeout: init.timeout,
            });
            const projectBreadcrumb: $TSFixMe = await page.evaluate(
                (projectSelector: $TSFixMe) =>
                    document.querySelector(projectSelector).textContent,
                projectSelector
            );
            await init.pageWaitForSelector(page, componentSelector, {
                visible: true,
                timeout: init.timeout,
            });
            const componentBreadcrumb: $TSFixMe = await page.evaluate(
                (componentSelector: $TSFixMe) =>
                    document.querySelector(componentSelector).textContent,
                componentSelector
            );

            expect(projectBreadcrumb).toBe('Unnamed Project');
            expect(componentBreadcrumb).toBe(componentName);

            done();
        },
        operationTimeOut
    );

    test(
        'Should not create new component when details are incorrect',
        async (done: $TSFixMe) => {
            // Navigate to Components page
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: 'networkidle0',
            });

            await init.pageWaitForSelector(page, '#components');
            await init.page$Eval(page, '#components', (e: $TSFixMe) =>
                e.click()
            );

            // Fill and submit New Component form with incorrect details

            await init.pageWaitForSelector(page, '#cbComponents');

            await init.pageClick(page, '#newFormId');

            await init.pageWaitForSelector(page, '#form-new-component');

            await init.pageWaitForSelector(page, '#name');
            await init.page$Eval(page, 'button[type=submit]', (e: $TSFixMe) =>
                e.click()
            );

            let spanElement: $TSFixMe = await init.page$(
                page,
                '#form-new-component span#field-error'
            );
            spanElement = await spanElement.getProperty('innerText');
            spanElement = await spanElement.jsonValue();
            spanElement.should.be.exactly('This field cannot be left blank');
            done();
        },
        operationTimeOut
    );

    test(
        'Should show indicator on how to create monitor',
        async (done: $TSFixMe) => {
            // Navigate to Component details
            await init.navigateToComponentDetails(componentName, page);

            const customTutorialType: string = 'monitor';
            // confirm that monitor box exist on component details page

            const componentBoxElement: $TSFixMe =
                await init.pageWaitForSelector(
                    page,
                    `#info-${customTutorialType}`
                );
            expect(componentBoxElement).toBeDefined();
            done();
        },
        operationTimeOut
    );
});
