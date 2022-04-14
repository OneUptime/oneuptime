import puppeteer from 'puppeteer';
import Email from 'Common/Types/Email';

import utils from '../../test-utils';
import init from '../../test-init';
let browser: $TSFixMe, page: $TSFixMe;
import 'should';

const email: Email = utils.generateRandomBusinessEmail();
const password: string = '1234567890';

describe('About Modal (IS_SAAS_SERVICE=false)', () => {
    const operationTimeOut: $TSFixMe = init.timeout;

    beforeAll(async (done: $TSFixMe) => {
        jest.setTimeout(init.timeout);

        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(utils.agent);

        const user: $TSFixMe = {
            email: email,
            password: password,
        };

        await init.registerEnterpriseUser(user, page, false);

        done();
    });

    afterAll(async (done: $TSFixMe) => {
        await browser.close();
        done();
    });

    test(
        'should show about option in admin dashboard profile menu',
        async () => {
            await page.goto(utils.ADMIN_DASHBOARD_URL, {
                waitUntil: 'networkidle0',
            });

            // if element does not exist it will timeout and throw
            await init.pageWaitForSelector(page, '#profile-menu', {
                visible: true,
                timeout: init.timeout,
            });
            await init.page$Eval(page, '#profile-menu', (elem: $TSFixMe) =>
                elem.click()
            );
            const about: $TSFixMe = await init.pageWaitForSelector(
                page,
                '#about-button',
                {
                    visible: true,
                    timeout: init.timeout,
                }
            );
            expect(about).toBeDefined();
        },
        operationTimeOut
    );

    test(
        'should show about modal with app versions',
        async () => {
            await page.goto(utils.ADMIN_DASHBOARD_URL, {
                waitUntil: 'networkidle0',
            });
            await init.pageWaitForSelector(page, '#profile-menu', {
                visible: true,
                timeout: init.timeout,
            });
            await init.page$Eval(page, '#profile-menu', (elem: $TSFixMe) =>
                elem.click()
            );
            await init.pageWaitForSelector(page, '#about-button', {
                visible: true,
                timeout: init.timeout,
            });
            await init.page$Eval(page, '#about-button', (elem: $TSFixMe) =>
                elem.click()
            );
            await init.pageWaitForSelector(page, '.bs-Modal', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageWaitForSelector(page, '#server-version', {
                visible: true,
                timeout: init.timeout,
            });
            const serverVersion: $TSFixMe = await init.page$Eval(
                page,
                '#server-version',
                (elem: $TSFixMe) => elem.textContent
            );
            const docsVersion: $TSFixMe = await init.page$Eval(
                page,
                '#docs-version',
                (elem: $TSFixMe) => elem.textContent
            );
            const helmVersion: $TSFixMe = await init.page$Eval(
                page,
                '#helm-version',
                (elem: $TSFixMe) => elem.textContent
            );
            const dashboardVersion: $TSFixMe = await init.page$Eval(
                page,
                '#dashboard-version',
                (elem: $TSFixMe) => elem.textContent
            );
            const adminDashboardVersion: $TSFixMe = await init.page$Eval(
                page,
                '#AdminDashboard-version',
                (elem: $TSFixMe) => elem.textContent
            );

            const probeVersion: $TSFixMe = await init.page$Eval(
                page,
                '#probe-version',
                (elem: $TSFixMe) => elem.textContent
            );

            expect(serverVersion).toBeDefined();
            expect(docsVersion).toBeDefined();
            expect(helmVersion).toBeDefined();
            expect(dashboardVersion).toBeDefined();
            expect(adminDashboardVersion).toBeDefined();
            expect(probeVersion).toBeDefined();
        },
        operationTimeOut
    );

    test(
        'should close about modal',
        async () => {
            await page.goto(utils.ADMIN_DASHBOARD_URL, {
                waitUntil: 'networkidle0',
            });
            await init.pageWaitForSelector(page, '#profile-menu', {
                visible: true,
                timeout: init.timeout,
            });
            await init.page$Eval(page, '#profile-menu', (elem: $TSFixMe) =>
                elem.click()
            );
            await init.pageWaitForSelector(page, '#about-button', {
                visible: true,
                timeout: init.timeout,
            });
            await init.page$Eval(page, '#about-button', (elem: $TSFixMe) =>
                elem.click()
            );
            await init.pageWaitForSelector(page, '.bs-Button', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '.bs-Button');
        },
        operationTimeOut
    );
});
