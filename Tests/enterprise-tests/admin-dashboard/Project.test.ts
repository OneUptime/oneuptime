import puppeteer from 'puppeteer';
import Email from 'Common/Types/Email';
import utils from '../../test-utils';
import init from '../../test-init';
let browser: $TSFixMe, page: $TSFixMe;

import 'should';

// User credentials
const email: Email = utils.generateRandomBusinessEmail();
const password: string = '1234567890';

describe('Project', () => {
    const operationTimeOut: $TSFixMe = init.timeout;

    beforeAll(async () => {
        jest.setTimeout(init.timeout);

        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(utils.agent);

        const user: $TSFixMe = {
            email: email,
            password: password,
        };
        await init.registerEnterpriseUser(user, page);
    });

    afterAll(async (done: $TSFixMe) => {
        await browser.close();
        done();
    });

    test(
        'should not show upgrade/downgrade box if IS_SAAS_SERVICE is false',
        async () => {
            const email: Email = utils.generateRandomBusinessEmail();
            const password: string = '1234567890';

            await page.goto(utils.ADMIN_DASHBOARD_URL, {
                waitUntil: 'networkidle0',
            });

            await init.createUserFromAdminDashboard({ email, password }, page);

            await init.page$Eval(page, '#projects > a', (elem: $TSFixMe) => {
                return elem.click();
            });
            await page.reload({ waitUntil: 'networkidle0' });

            const elem: $TSFixMe = await init.page$$(
                page,
                'table > tbody > tr'
            );
            elem[0].click();

            await page.waitForNavigation({ waitUntil: 'networkidle0' });
            const planBox: $TSFixMe = await page.$('#planBox');
            expect(planBox).toBeNull();
        },
        operationTimeOut
    );

    test(
        'should delete a project',
        async (done: $TSFixMe) => {
            await page.goto(utils.ADMIN_DASHBOARD_URL);
            await init.pageWaitForSelector(page, '#projects', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#projects');

            const firstProject: $TSFixMe = await init.pageWaitForSelector(
                page,
                '#project_0',
                {
                    visible: true,
                    timeout: init.timeout,
                }
            );
            firstProject.click();

            await init.pageWaitForSelector(page, '#delete', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#delete');
            await init.pageWaitForSelector(page, '#confirmDelete', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#confirmDelete');
            await init.pageWaitForSelector(page, '#confirmDelete', {
                hidden: true,
            });

            const restoreBtn: $TSFixMe = await init.pageWaitForSelector(
                page,
                '#restore',
                {
                    visible: true,
                    timeout: init.timeout,
                }
            );
            expect(restoreBtn).toBeDefined();

            done();
        },
        operationTimeOut
    );

    test(
        'should restore a deleted project',
        async (done: $TSFixMe) => {
            await page.goto(utils.ADMIN_DASHBOARD_URL);
            await init.pageWaitForSelector(page, '#projects', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#projects');

            const firstProject: $TSFixMe = await init.pageWaitForSelector(
                page,
                '#project_0',
                {
                    visible: true,
                    timeout: init.timeout,
                }
            );
            firstProject.click();
            await init.pageWaitForSelector(page, '#restore', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#restore');

            const deleteBtn: $TSFixMe = await init.pageWaitForSelector(
                page,
                '#delete',
                {
                    visible: true,
                    timeout: init.timeout,
                }
            );
            expect(deleteBtn).toBeDefined();

            done();
        },
        operationTimeOut
    );
});
