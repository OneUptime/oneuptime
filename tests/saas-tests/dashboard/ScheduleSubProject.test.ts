// @ts-expect-error ts-migrate(2307) FIXME: Cannot find module 'puppeteer' or its correspondin... Remove this comment to see the full error message
import puppeteer from 'puppeteer';
import utils from '../../test-utils';
import init from '../../test-init';

let browser: $TSFixMe, page: $TSFixMe;
// parent user credentials
const email = utils.generateRandomBusinessEmail();
const password = '1234567890';
const projectName = utils.generateRandomString();
const subProjectMonitorName = utils.generateRandomString();
// sub-project user credentials
const newEmail = utils.generateRandomBusinessEmail();
const newPassword = '1234567890';
const subProjectName = utils.generateRandomString();
const componentName = utils.generateRandomString();

const user = {
    email,
    password,
};

// @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'describe'. Do you need to instal... Remove this comment to see the full error message
describe('Schedule API With SubProjects', () => {
    const operationTimeOut = init.timeout;

    // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'beforeAll'.
    beforeAll(async (done: $TSFixMe) => {
        // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'jest'.
        jest.setTimeout(init.timeout);

        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(utils.agent);

        // Register user
        await init.registerUser(user, page); // This auto log in the user.
        await init.renameProject(projectName, page);
        await init.growthPlanUpgrade(page);

        // add sub-project
        await init.addSubProject(subProjectName, page);
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await init.pageClick(page, '#projectFilterToggle');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await init.pageClick(page, `#project-${subProjectName}`);
        // Create Component
        await init.addComponent(componentName, page);
        await page.goto(utils.DASHBOARD_URL, {
            waitUntil: ['networkidle2'],
        });

        // add new user to sub-project
        await init.addUserToProject(
            {
                email: newEmail,
                role: 'Member',
                subProjectName,
            },
            page
        );
        // Navigate to details page of component created
        await init.addNewMonitorToComponent(
            page,
            componentName,
            subProjectMonitorName
        );
        await init.saasLogout(page);
        done();
    });

    // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'afterAll'.
    afterAll(async (done: $TSFixMe) => {
        await browser.close();
        done();
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test(
        'should not display create schedule button for subproject `member` role.',
        async (done: $TSFixMe) => {
            await init.registerAndLoggingTeamMember(
                { email: newEmail, password: newPassword },
                page
            ); // This is for subproject

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#projectFilterToggle');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, `#project-${subProjectName}`);

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#onCallDuty');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#onCallDuty');

            const createButton = await init.page$(
                page,
                `#btnCreateSchedule_${subProjectName}`,
                { hidden: true }
            );

            expect(createButton).toBe(null);
            await init.saasLogout(page);
            done();
        },
        operationTimeOut
    );

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test(
        'should create a schedule in sub-project for sub-project `admin`',
        async (done: $TSFixMe) => {
            const scheduleName = utils.generateRandomString();

            await init.loginUser(user, page);
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#projectFilterToggle');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, `#project-${subProjectName}`);
            await init.addScheduleToProject(scheduleName, subProjectName, page);
            await init.pageWaitForSelector(
                page,
                `#schedule_count_${subProjectName}`,
                {
                    visible: true,
                    timeout: init.timeout,
                }
            );
            await page.reload({ waitUntil: 'networkidle2' });

            const scheduleCountSelector = await init.pageWaitForSelector(
                page,
                `#schedule_count_${subProjectName}`,
                { visible: true, timeout: init.timeout }
            );
            let textContent = await scheduleCountSelector.getProperty(
                'innerText'
            );

            textContent = await textContent.jsonValue();
            expect(textContent).toMatch('Page 1 of 1 (1 duty)');
            done();
        },
        operationTimeOut
    );

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test(
        'should get list schedules in sub-projects and paginate schedules in sub-project',
        async (done: $TSFixMe) => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#projectFilterToggle');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, `#project-${subProjectName}`);
            // add 10 more schedules to sub-project to test for pagination
            for (let i = 0; i < 10; i++) {
                const scheduleName = utils.generateRandomString();
                await init.addScheduleToProject(
                    scheduleName,
                    subProjectName,
                    page
                );
            }

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#onCallDuty');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#onCallDuty');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, 'tr.scheduleListItem');

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            let scheduleRows = await init.page$$(page, 'tr.scheduleListItem');
            let countSchedules = scheduleRows.length;

            expect(countSchedules).toEqual(10);

            //const nextSelector =
            await init.pageWaitForSelector(page, `#btnNext-${subProjectName}`, {
                visible: true,
                timeout: init.timeout,
            });

            // await nextSelector.click();
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, `#btnNext-${subProjectName}`);

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            scheduleRows = await init.page$$(page, 'tr.scheduleListItem');
            countSchedules = scheduleRows.length;
            expect(countSchedules).toEqual(1);

            // const prevSelector =
            await init.pageWaitForSelector(page, `#btnPrev-${subProjectName}`, {
                visible: true,
                timeout: init.timeout,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, `#btnPrev-${subProjectName}`);
            //await prevSelector.click();

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            scheduleRows = await init.page$$(page, 'tr.scheduleListItem');
            countSchedules = scheduleRows.length;
            expect(countSchedules).toEqual(10);

            done();
        },
        init.timeout
    );

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test(
        'should add monitor to sub-project schedule',
        async (done: $TSFixMe) => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#projectFilterToggle');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, `#project-${subProjectName}`);
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#onCallDuty');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#onCallDuty');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, 'tr.scheduleListItem');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, 'tr.scheduleListItem');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(
                page,
                `span[title="${subProjectMonitorName}"]`
            );
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(
                page,
                `span[title="${subProjectMonitorName}"]`
            );
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#btnSaveMonitors');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#btnSaveMonitors');

            const monitorSelectValue = await init.page$Eval(
                page,
                'input[type=checkbox]',
                (el: $TSFixMe) => el.value
            );
            expect(monitorSelectValue).toBe('true');

            done();
        },
        operationTimeOut
    );

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test(
        'should delete sub-project schedule',
        async (done: $TSFixMe) => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#projectFilterToggle');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, `#project-${subProjectName}`);
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#onCallDuty');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#onCallDuty');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, 'tr.scheduleListItem');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, 'tr.scheduleListItem');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#delete');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#delete');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#confirmDelete');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#confirmDelete');
            await init.pageWaitForSelector(page, '#confirmDelete', {
                hidden: true,
            });

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#onCallDuty');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#onCallDuty');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, 'tr.scheduleListItem');

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            const scheduleRows = await init.page$$(page, 'tr.scheduleListItem');
            const countSchedules = scheduleRows.length;

            expect(countSchedules).toEqual(10);

            done();
        },
        operationTimeOut
    );
});
