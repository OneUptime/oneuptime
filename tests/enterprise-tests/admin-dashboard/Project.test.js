const puppeteer = require('puppeteer');
const utils = require('../../test-utils');
const init = require('../../test-init');
let browser, page;

require('should');

// user credentials
const email = utils.generateRandomBusinessEmail();
const password = '1234567890';

describe('Project', () => {
    const operationTimeOut = init.timeout;

    beforeAll(async () => {
        jest.setTimeout(init.timeout);

        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(utils.agent);

        const user = {
            email: email,
            password: password,
        };
        await init.registerEnterpriseUser(user, page);
    });

    afterAll(async done => {
        await browser.close();
        done();
    });

    test(
        'should not show upgrade/downgrade box if IS_SAAS_SERVICE is false',
        async () => {
            const email = utils.generateRandomBusinessEmail();
            const password = '1234567890';

            await page.goto(utils.ADMIN_DASHBOARD_URL, {
                waitUntil: 'networkidle0',
            });

            await init.createUserFromAdminDashboard({ email, password }, page);

            await page.$eval('#projects > a', elem => elem.click());
            await page.reload({ waitUntil: 'networkidle0' });

            const elem = await page.$$('table > tbody > tr');
            elem[0].click();

            await page.waitForNavigation({ waitUntil: 'networkidle0' });
            const planBox = await page.$('#planBox');
            expect(planBox).toBeNull();
        },
        operationTimeOut
    );

    test(
        'should delete a project',
        async done => {
            await page.goto(utils.ADMIN_DASHBOARD_URL);
            await page.waitForSelector('#projects', { visible: true });
            await init.pageClick(page, '#projects');

            const firstProject = await page.waitForSelector('#project_0', {
                visible: true,
            });
            firstProject.click();

            await page.waitForSelector('#delete', { visible: true });
            await init.pageClick(page, '#delete');
            await page.waitForSelector('#confirmDelete', { visible: true });
            await init.pageClick(page, '#confirmDelete');
            await page.waitForSelector('#confirmDelete', { hidden: true });

            const restoreBtn = await page.waitForSelector('#restore', {
                visible: true,
            });
            expect(restoreBtn).toBeDefined();

            done();
        },
        operationTimeOut
    );

    test(
        'should restore a deleted project',
        async done => {
            await page.goto(utils.ADMIN_DASHBOARD_URL);
            await page.waitForSelector('#projects', { visible: true });
            await init.pageClick(page, '#projects');

            const firstProject = await page.waitForSelector('#project_0', {
                visible: true,
            });
            firstProject.click();
            await page.waitForSelector('#restore', { visible: true });
            await init.pageClick(page, '#restore');

            const deleteBtn = await page.waitForSelector('#delete', {
                visible: true,
            });
            expect(deleteBtn).toBeDefined();

            done();
        },
        operationTimeOut
    );
});
