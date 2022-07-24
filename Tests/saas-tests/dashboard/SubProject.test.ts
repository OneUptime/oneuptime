import puppeteer from 'puppeteer';
import Email from 'Common/Types/Email';
import utils from '../../test-utils';
import init from '../../test-init';

let browser: $TSFixMe, page: $TSFixMe;
// User credentials
const email: Email = utils.generateRandomBusinessEmail();
const teamEmail: Email = utils.generateRandomBusinessEmail();
const projectOwnerMail: Email = utils.generateRandomBusinessEmail();
const password = '1234567890';
const newProjectName = 'Test';
const subProjectName = 'Trial';

describe('Sub-Project API', () => {
    const operationTimeOut: $TSFixMe = init.timeout;

    beforeAll(async (done: $TSFixMe) => {
        jest.setTimeout(init.timeout);

        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(utils.agent);
        const user: $TSFixMe = {
            email,
            password,
        };

        // User
        await init.registerUser(user, page);

        done();
    });

    afterAll(async (done: $TSFixMe) => {
        await browser.close();
        done();
    });

    test(
        'should show pricing plan modal for project not on Growth plan and above',
        async (done: $TSFixMe) => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: 'networkidle2',
            });

            await init.pageWaitForSelector(page, '#projectSettings');

            await init.pageClick(page, '#projectSettings');

            await init.pageWaitForSelector(page, '#btn_Add_SubProjects');

            await init.pageClick(page, '#btn_Add_SubProjects');

            const pricingPlanModal: $TSFixMe = await init.pageWaitForSelector(
                page,
                '#pricingPlanModal',
                { visible: true, timeout: init.timeout }
            );

            expect(pricingPlanModal).toBeDefined();
            done();
        },
        operationTimeOut
    );
});

describe('Member Restriction', () => {
    const operationTimeOut: $TSFixMe = init.timeout;

    beforeAll(async (done: $TSFixMe) => {
        jest.setTimeout(init.timeout);

        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(utils.agent);
        // User
        await init.registerUser({ email: projectOwnerMail, password }, page);
        await init.renameProject(newProjectName, page);
        await page.goto(utils.DASHBOARD_URL, {
            waitUntil: 'networkidle2',
        });
        await init.addUserToProject(
            {
                email: teamEmail,
                role: 'Member',
                subProjectName: newProjectName,
            },
            page
        );

        await init.saasLogout(page);

        done();
    });

    afterAll(async (done: $TSFixMe) => {
        await browser.close();
        done();
    });

    test(
        'should show unauthorised modal to a team member who is not an admin or owner of the project',
        async (done: $TSFixMe) => {
            await init.registerAndLoggingTeamMember(
                { email: teamEmail, password },
                page
            ); // The team member has to register first before logging in.

            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: 'networkidle2',
            });
            await init.pageWaitForSelector(page, '#projectSettings', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#projectSettings');
            await init.pageWaitForSelector(page, '#btn_Add_SubProjects', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#btn_Add_SubProjects');
            const unauthorisedModal: $TSFixMe = await init.pageWaitForSelector(
                page,
                '#unauthorisedModal',
                { visible: true, timeout: init.timeout }
            );

            expect(unauthorisedModal).toBeDefined();
            await init.saasLogout(page);
            done();
        },
        operationTimeOut
    );

    test(
        'should show unauthorised modal to a team member who is not an admin of the project trying to perform any action subproject list',
        async (done: $TSFixMe) => {
            await init.loginUser({ email: projectOwnerMail, password }, page);

            await init.growthPlanUpgrade(page);
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: 'networkidle2',
            });
            // Adding a subProject is only allowed on growth plan and above
            await init.addSubProject(subProjectName, page);
            await init.saasLogout(page);

            await init.loginUser({ email: teamEmail, password }, page);
            await init.pageWaitForSelector(page, '#projectSettings', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#projectSettings');
            const deleteSubProjectBtn = `#sub_project_delete_${subProjectName}`;
            await init.pageWaitForSelector(page, deleteSubProjectBtn, {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, deleteSubProjectBtn);
            const unauthorisedModal: $TSFixMe = await init.pageWaitForSelector(
                page,
                '#unauthorisedModal',
                { visible: true, timeout: init.timeout }
            );
            expect(unauthorisedModal).toBeDefined();

            done();
        },
        operationTimeOut
    );
});
