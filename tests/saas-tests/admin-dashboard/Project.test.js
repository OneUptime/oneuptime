import puppeteer from 'puppeteer'
import utils from '../../test-utils'
import init from '../../test-init'

let browser, page;
require('should');

// user credentials
const email = 'masteradmin@hackerbay.io';
const password = '1234567890';
const user = {
    email: utils.generateRandomBusinessEmail(),
    password,
};

let projectId = null;

describe('Project', () => {
    const operationTimeOut = init.timeout;

    beforeAll(async () => {
        jest.setTimeout(init.timeout);

        browser = await puppeteer.launch(utils.puppeteerLaunchConfig, {
            waitUntil: 'networkidle2',
        });
        page = await browser.newPage();
        await page.setUserAgent(utils.agent);

        const adminUser = {
            email: email,
            password: password,
        };

        // login admin user
        await init.loginAdminUser(adminUser, page);
    });

    afterAll(async done => {
        await browser.close();
        done();
    });

    test(
        'should upgrade a project to enterprise plan',
        async done => {
            await page.goto(utils.ADMIN_DASHBOARD_URL, {
                waitUntil: 'networkidle2',
            });
            await init.createUserFromAdminDashboard(user, page);
            await page.reload({ waitUntil: 'networkidle2' });
            await init.pageClick(page, '#projects');
            await init.page$Eval(page, '#projects > a', elem => elem.click());
            await init.pageWaitForSelector(page, '.Table > tbody tr');

            const project = await init.pageWaitForSelector(page, '.projectId');
            projectId = await (
                await project.getProperty('innerText')
            ).jsonValue();

            await page.evaluate(() => {
                let elem = document.querySelectorAll('.Table > tbody tr');
                elem = Array.from(elem);
                elem[0].click();
            });

            await init.pageWaitForSelector(page, '#Enterprise', {
                visible: true,
                timeout: init.timeout,
            });

            await init.page$Eval(page, '#Enterprise', elem => elem.click());
            await init.page$Eval(page, '#submitChangePlan', elem =>
                elem.click()
            );

            await init.pageWaitForSelector(page, '.ball-beat', {
                hidden: true,
            });

            await page.reload({ waitUntil: 'networkidle0' });

            const checked = await init.page$Eval(
                page,
                '#Enterprise',
                elem => elem.checked
            );

            expect(checked).toEqual(true);
            done();
        },
        operationTimeOut
    );

    test(
        'should change to any other plan',
        async done => {
            await page.goto(utils.ADMIN_DASHBOARD_URL);
            await init.pageClick(page, '#projects');
            await init.page$Eval(page, '#projects > a', elem => elem.click());
            await init.pageWaitForSelector(page, '.Table > tbody tr');
            await init.pageClick(page, '#project-' + projectId);

            await init.pageWaitForSelector(page, '#Growth_annual', {
                visible: true,
                timeout: init.timeout,
            });

            await init.page$Eval(page, '#Growth_annual', elem => elem.click());
            await init.page$Eval(page, '#submitChangePlan', elem =>
                elem.click()
            );

            const loader = await init.pageWaitForSelector(page, '.ball-beat', {
                hidden: true,
            });

            await page.reload({ waitUntil: 'networkidle0' });

            const checked = await init.page$Eval(
                page,
                '#Growth_annual',
                elem => elem.checked
            );

            expect(loader).toBeNull();
            expect(checked).toEqual(true);
            done();
        },
        operationTimeOut
    );
});
