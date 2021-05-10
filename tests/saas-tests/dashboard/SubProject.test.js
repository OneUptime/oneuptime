const puppeteer = require('puppeteer');
const utils = require('../../../test-utils');
const init = require('../../../test-init');

let browser, page;
// user credentials
const email = utils.generateRandomBusinessEmail();
const teamEmail = utils.generateRandomBusinessEmail();
const projectOwnerMail = utils.generateRandomBusinessEmail();
const password = '1234567890';
const newProjectName = 'Test';
const subProjectName = 'Trial';

describe('Sub-Project API', () => {
    const operationTimeOut = 50000;

    beforeAll(async done => {
        jest.setTimeout(200000);

        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/61.0.3163.100 Safari/537.36'
        );
        const user = {
            email,
            password,
        };

        // user
        await init.registerUser(user, page);

        done();
    });

    afterAll(async done => {
        await browser.close();
        done();
    });

    test(
        'should show pricing plan modal for project not on Growth plan and above',
        async done => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: 'networkidle0',
            });
            await page.waitForSelector('#projectSettings');
            await page.click('#projectSettings');
            await page.waitForSelector('#btn_Add_SubProjects');
            await page.click('#btn_Add_SubProjects');

            const pricingPlanModal = await page.waitForSelector(
                '#pricingPlanModal',
                { visible: true }
            );

            expect(pricingPlanModal).toBeDefined();
            done();
        },
        operationTimeOut
    );
});

describe('Member Restriction', () => {
    const operationTimeOut = 50000;

    beforeAll(async done => {
        jest.setTimeout(200000);
        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/61.0.3163.100 Safari/537.36'
        );
        // user
        await init.registerUser({ email: projectOwnerMail, password }, page);
        await init.renameProject(newProjectName, page);
        await page.goto(utils.DASHBOARD_URL, {
            waitUntil: 'networkidle0',
        });
        await init.addUserToProject(
            {
                email: teamEmail,
                role: 'Member',
                subProjectName: newProjectName,
            },
            page
        );

        await init.logout(page);

        done();
    });

    afterAll(async done => {
        await browser.close();
        done();
    });

    test(
        'should show unauthorised modal to a team member who is not an admin or owner of the project',
        async done => {
            await init.registerAndLoggingTeamMember(
                { email: teamEmail, password },
                page
            ); // The team member has to register first before logging in.

            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: 'networkidle0',
            });
            await page.waitForSelector('#projectSettings', {
                visible: true,
            });
            await page.click('#projectSettings');
            await page.waitForSelector('#btn_Add_SubProjects', {
                visible: true,
            });
            await page.click('#btn_Add_SubProjects');
            const unauthorisedModal = await page.waitForSelector(
                '#unauthorisedModal',
                { visible: true }
            );

            expect(unauthorisedModal).toBeDefined();
            await init.logout(page);
            done();
        },
        operationTimeOut
    );

    test(
        'should show unauthorised modal to a team member who is not an admin of the project trying to perform any action subproject list',
        async done => {
            await init.loginUser({ email: projectOwnerMail, password }, page);

            await init.growthPlanUpgrade(page);
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: 'networkidle0',
            });
            // adding a subProject is only allowed on growth plan and above
            await init.addSubProject(subProjectName, page);
            await init.logout(page);

            await init.loginUser({ email: teamEmail, password }, page);
            await page.waitForSelector('#projectSettings', {
                visible: true,
            });
            await page.click('#projectSettings');
            const deleteSubProjectBtn = `#sub_project_delete_${subProjectName}`;
            await page.waitForSelector(deleteSubProjectBtn, {
                visible: true,
            });
            await page.click(deleteSubProjectBtn);
            const unauthorisedModal = await page.waitForSelector(
                '#unauthorisedModal',
                { visible: true }
            );
            expect(unauthorisedModal).toBeDefined();

            done();
        },
        operationTimeOut
    );
});
