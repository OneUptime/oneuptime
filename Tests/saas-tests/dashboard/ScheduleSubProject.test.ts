import puppeteer from 'puppeteer';
import utils from '../../test-utils';
import init from '../../test-init';

let browser: $TSFixMe, page: $TSFixMe;
// parent user credentials
const email = utils.generateRandomBusinessEmail();
const password: string = '1234567890';
const projectName = utils.generateRandomString();
const subProjectMonitorName = utils.generateRandomString();
// sub-project user credentials
const newEmail = utils.generateRandomBusinessEmail();
const newPassword: string = '1234567890';
const subProjectName = utils.generateRandomString();
const componentName = utils.generateRandomString();

const user: $TSFixMe = {
    email,
    password,
};

describe('Schedule API With SubProjects', () => {
    const operationTimeOut = init.timeout;

    beforeAll(async (done: $TSFixMe) => {
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

        await init.pageClick(page, '#projectFilterToggle');

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

    afterAll(async (done: $TSFixMe) => {
        await browser.close();
        done();
    });

    test(
        'should not display create schedule button for subproject `member` role.',
        async (done: $TSFixMe) => {
            await init.registerAndLoggingTeamMember(
                { email: newEmail, password: newPassword },
                page
            ); // This is for subproject

            await init.pageClick(page, '#projectFilterToggle');

            await init.pageClick(page, `#project-${subProjectName}`);

            await init.pageWaitForSelector(page, '#onCallDuty');

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

    test(
        'should create a schedule in sub-project for sub-project `admin`',
        async (done: $TSFixMe) => {
            const scheduleName = utils.generateRandomString();

            await init.loginUser(user, page);

            await init.pageClick(page, '#projectFilterToggle');

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

    test(
        'should get list schedules in sub-projects and paginate schedules in sub-project',
        async (done: $TSFixMe) => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });

            await init.pageClick(page, '#projectFilterToggle');

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

            await init.pageWaitForSelector(page, '#onCallDuty');

            await init.pageClick(page, '#onCallDuty');

            await init.pageWaitForSelector(page, 'tr.scheduleListItem');

            let scheduleRows = await init.page$$(page, 'tr.scheduleListItem');
            let countSchedules = scheduleRows.length;

            expect(countSchedules).toEqual(10);

            //const nextSelector =
            await init.pageWaitForSelector(page, `#btnNext-${subProjectName}`, {
                visible: true,
                timeout: init.timeout,
            });

            // await nextSelector.click();

            await init.pageClick(page, `#btnNext-${subProjectName}`);

            scheduleRows = await init.page$$(page, 'tr.scheduleListItem');
            countSchedules = scheduleRows.length;
            expect(countSchedules).toEqual(1);

            // const prevSelector =
            await init.pageWaitForSelector(page, `#btnPrev-${subProjectName}`, {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, `#btnPrev-${subProjectName}`);
            //await prevSelector.click();

            scheduleRows = await init.page$$(page, 'tr.scheduleListItem');
            countSchedules = scheduleRows.length;
            expect(countSchedules).toEqual(10);

            done();
        },
        init.timeout
    );

    test(
        'should add monitor to sub-project schedule',
        async (done: $TSFixMe) => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });

            await init.pageClick(page, '#projectFilterToggle');

            await init.pageClick(page, `#project-${subProjectName}`);

            await init.pageWaitForSelector(page, '#onCallDuty');

            await init.pageClick(page, '#onCallDuty');

            await init.pageWaitForSelector(page, 'tr.scheduleListItem');

            await init.pageClick(page, 'tr.scheduleListItem');

            await init.pageWaitForSelector(
                page,
                `span[title="${subProjectMonitorName}"]`
            );

            await init.pageClick(
                page,
                `span[title="${subProjectMonitorName}"]`
            );

            await init.pageWaitForSelector(page, '#btnSaveMonitors');

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

    test(
        'should delete sub-project schedule',
        async (done: $TSFixMe) => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });

            await init.pageClick(page, '#projectFilterToggle');

            await init.pageClick(page, `#project-${subProjectName}`);

            await init.pageWaitForSelector(page, '#onCallDuty');

            await init.pageClick(page, '#onCallDuty');

            await init.pageWaitForSelector(page, 'tr.scheduleListItem');

            await init.pageClick(page, 'tr.scheduleListItem');

            await init.pageWaitForSelector(page, '#delete');

            await init.pageClick(page, '#delete');

            await init.pageWaitForSelector(page, '#confirmDelete');

            await init.pageClick(page, '#confirmDelete');
            await init.pageWaitForSelector(page, '#confirmDelete', {
                hidden: true,
            });

            await init.pageWaitForSelector(page, '#onCallDuty');

            await init.pageClick(page, '#onCallDuty');

            await init.pageWaitForSelector(page, 'tr.scheduleListItem');

            const scheduleRows = await init.page$$(page, 'tr.scheduleListItem');
            const countSchedules = scheduleRows.length;

            expect(countSchedules).toEqual(10);

            done();
        },
        operationTimeOut
    );
});
