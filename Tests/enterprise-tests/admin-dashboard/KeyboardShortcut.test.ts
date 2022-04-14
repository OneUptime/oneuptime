import puppeteer from 'puppeteer';
import utils from '../../test-utils';
import init from '../../test-init';

let browser: $TSFixMe, page: $TSFixMe;
import 'should';

// user credentials
const email = utils.generateRandomBusinessEmail();
const  password: string = '1234567890';

describe('Keyboard Shortcut: Admin Dashboard', () => {
    const operationTimeOut = init.timeout;

    beforeAll(async (done: $TSFixMe) => {
        jest.setTimeout(360000);

        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(utils.agent);

        const user = {
            email: email,
            password: password,
        };
        // user
        await init.registerEnterpriseUser(user, page);

        done();
    });

    afterAll(async (done: $TSFixMe) => {
        await browser.close();
        done();
    });

    test(
        'should navigate to projects page with keyboard shortcut (f + p)',
        async (done: $TSFixMe) => {
            await page.goto(utils.ADMIN_DASHBOARD_URL);
            await init.pageWaitForSelector(page, '#projects', {
                visible: true,
                timeout: init.timeout,
            });
            await page.keyboard.press('f');
            await page.keyboard.press('p');
            const project = await init.pageWaitForSelector(
                page,
                '#oneuptimeProject',
                {
                    visible: true,
                    timeout: init.timeout,
                }
            );
            expect(project).toBeDefined();

            done();
        },
        operationTimeOut
    );

    test(
        'should navigate to probes page with keyboard shortcut (f + b)',
        async (done: $TSFixMe) => {
            await page.goto(utils.ADMIN_DASHBOARD_URL);
            await init.pageWaitForSelector(page, '#probes', {
                visible: true,
                timeout: init.timeout,
            });
            await page.keyboard.press('f');
            await page.keyboard.press('b');
            const probe = await init.pageWaitForSelector(
                page,
                '#oneuptimeProbe',
                {
                    visible: true,
                    timeout: init.timeout,
                }
            );
            expect(probe).toBeDefined();

            done();
        },
        operationTimeOut
    );

    test(
        'should navigate to audit logs with keyboard shortcut (f + a)',
        async (done: $TSFixMe) => {
            await page.goto(utils.ADMIN_DASHBOARD_URL);

            await init.pageWaitForSelector(page, '#logs');

            await init.pageClick(page, '#logs');
            await init.pageWaitForSelector(page, '#auditLogs', {
                visible: true,
                timeout: init.timeout,
            });
            await page.keyboard.press('f');
            await page.keyboard.press('a');
            const auditLog = await init.pageWaitForSelector(
                page,
                '#oneuptimeAuditLog',
                {
                    visible: true,
                    timeout: init.timeout,
                }
            );
            expect(auditLog).toBeDefined();

            done();
        },
        operationTimeOut
    );

    test(
        'should navigate to license setting with keyboard shortcut (f + l)',
        async (done: $TSFixMe) => {
            await page.goto(utils.ADMIN_DASHBOARD_URL);
            await init.pageWaitForSelector(page, '#settings', {
                visible: true,
                timeout: init.timeout,
            });
            await page.keyboard.press('f');
            await page.keyboard.press('l');
            const license = await init.pageWaitForSelector(
                page,
                '#oneuptimeLicense',
                {
                    visible: true,
                    timeout: init.timeout,
                }
            );
            expect(license).toBeDefined();

            done();
        },
        operationTimeOut
    );

    test(
        'should navigate to smtp setting with keyboard shortcut (f + m)',
        async (done: $TSFixMe) => {
            await page.goto(utils.ADMIN_DASHBOARD_URL);
            await init.pageWaitForSelector(page, '#settings', {
                visible: true,
                timeout: init.timeout,
            });
            await page.keyboard.press('f');
            await page.keyboard.press('m');
            const smtp = await init.pageWaitForSelector(
                page,
                '#oneuptimeSmtp',
                {
                    visible: true,
                    timeout: init.timeout,
                }
            );
            expect(smtp).toBeDefined();

            done();
        },
        operationTimeOut
    );

    test(
        'should navigate to twilio setting with keyboard shortcut (f + t)',
        async (done: $TSFixMe) => {
            await page.goto(utils.ADMIN_DASHBOARD_URL);
            await init.pageWaitForSelector(page, '#settings', {
                visible: true,
                timeout: init.timeout,
            });
            await page.keyboard.press('f');
            await page.keyboard.press('t');
            const twilio = await init.pageWaitForSelector(
                page,
                '#oneuptimeTwilio',
                {
                    visible: true,
                    timeout: init.timeout,
                }
            );
            expect(twilio).toBeDefined();

            done();
        },
        operationTimeOut
    );

    test(
        'should navigate to sso setting with keyboard shortcut (f + o)',
        async (done: $TSFixMe) => {
            await page.goto(utils.ADMIN_DASHBOARD_URL);
            await init.pageWaitForSelector(page, '#settings', {
                visible: true,
                timeout: init.timeout,
            });
            await page.keyboard.press('f');
            await page.keyboard.press('o');
            const sso = await init.pageWaitForSelector(page, '#oneuptimeSso', {
                visible: true,
                timeout: init.timeout,
            });
            expect(sso).toBeDefined();

            done();
        },
        operationTimeOut
    );

    test(
        'should navigate to dashboard from admin dashboard with keyboard shortcut (f + d)',
        async (done: $TSFixMe) => {
            await page.goto(utils.ADMIN_DASHBOARD_URL);
            await init.pageWaitForSelector(page, '#goToUserDashboard', {
                visible: true,
                timeout: init.timeout,
            });
            await page.keyboard.press('f');
            await page.keyboard.press('d');
            const component = await init.pageWaitForSelector(
                page,
                '#components',
                {
                    visible: true,
                    timeout: init.timeout,
                }
            );
            expect(component).toBeDefined();

            done();
        },
        operationTimeOut
    );
});
