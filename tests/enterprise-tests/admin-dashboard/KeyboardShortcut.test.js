const puppeteer = require('puppeteer');
const utils = require('../../test-utils');
const init = require('../../test-init');

let browser, page;
require('should');

// user credentials
const email = utils.generateRandomBusinessEmail();
const password = '1234567890';

describe('Keyboard Shortcut: Admin Dashboard', () => {
    const operationTimeOut = init.timeout;

    beforeAll(async done => {
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

    afterAll(async done => {
        await browser.close();
        done();
    });

    test(
        'should navigate to projects page with keyboard shortcut (f + p)',
        async done => {
            await page.goto(utils.ADMIN_DASHBOARD_URL);
            await page.waitForSelector('#projects', { visible: true });
            await page.keyboard.press('f');
            await page.keyboard.press('p');
            const project = await page.waitForSelector('#fyipeProject', {
                visible: true,
            });
            expect(project).toBeDefined();

            done();
        },
        operationTimeOut
    );

    test(
        'should navigate to probes page with keyboard shortcut (f + b)',
        async done => {
            await page.goto(utils.ADMIN_DASHBOARD_URL);
            await page.waitForSelector('#probes', { visible: true });
            await page.keyboard.press('f');
            await page.keyboard.press('b');
            const probe = await page.waitForSelector('#fyipeProbe', {
                visible: true,
            });
            expect(probe).toBeDefined();

            done();
        },
        operationTimeOut
    );

    test(
        'should navigate to audit logs with keyboard shortcut (f + a)',
        async done => {
            await page.goto(utils.ADMIN_DASHBOARD_URL);
            await page.waitForSelector('#logs');
            await init.pageClick(page, '#logs');
            await page.waitForSelector('#auditLogs', { visible: true });
            await page.keyboard.press('f');
            await page.keyboard.press('a');
            const auditLog = await page.waitForSelector('#fyipeAuditLog', {
                visible: true,
            });
            expect(auditLog).toBeDefined();

            done();
        },
        operationTimeOut
    );

    test(
        'should navigate to license setting with keyboard shortcut (f + l)',
        async done => {
            await page.goto(utils.ADMIN_DASHBOARD_URL);
            await page.waitForSelector('#settings', { visible: true });
            await page.keyboard.press('f');
            await page.keyboard.press('l');
            const license = await page.waitForSelector('#fyipeLicense', {
                visible: true,
            });
            expect(license).toBeDefined();

            done();
        },
        operationTimeOut
    );

    test(
        'should navigate to smtp setting with keyboard shortcut (f + m)',
        async done => {
            await page.goto(utils.ADMIN_DASHBOARD_URL);
            await page.waitForSelector('#settings', { visible: true });
            await page.keyboard.press('f');
            await page.keyboard.press('m');
            const smtp = await page.waitForSelector('#fyipeSmtp', {
                visible: true,
            });
            expect(smtp).toBeDefined();

            done();
        },
        operationTimeOut
    );

    test(
        'should navigate to twilio setting with keyboard shortcut (f + t)',
        async done => {
            await page.goto(utils.ADMIN_DASHBOARD_URL);
            await page.waitForSelector('#settings', { visible: true });
            await page.keyboard.press('f');
            await page.keyboard.press('t');
            const twilio = await page.waitForSelector('#fyipeTwilio', {
                visible: true,
            });
            expect(twilio).toBeDefined();

            done();
        },
        operationTimeOut
    );

    test(
        'should navigate to sso setting with keyboard shortcut (f + o)',
        async done => {
            await page.goto(utils.ADMIN_DASHBOARD_URL);
            await page.waitForSelector('#settings', { visible: true });
            await page.keyboard.press('f');
            await page.keyboard.press('o');
            const sso = await page.waitForSelector('#fyipeSso', {
                visible: true,
            });
            expect(sso).toBeDefined();

            done();
        },
        operationTimeOut
    );

    test(
        'should navigate to dashboard from admin dashboard with keyboard shortcut (f + d)',
        async done => {
            await page.goto(utils.ADMIN_DASHBOARD_URL);
            await page.waitForSelector('#goToUserDashboard', {
                visible: true,
            });
            await page.keyboard.press('f');
            await page.keyboard.press('d');
            const component = await page.waitForSelector('#components', {
                visible: true,
            });
            expect(component).toBeDefined();

            done();
        },
        operationTimeOut
    );
});
