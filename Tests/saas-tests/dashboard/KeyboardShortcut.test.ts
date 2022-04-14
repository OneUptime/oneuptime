import puppeteer from 'puppeteer';
import utils from '../../test-utils';
import init from '../../test-init';

import 'should';
let browser: $TSFixMe, page: $TSFixMe;
// user credentials
const email: $TSFixMe = utils.generateRandomBusinessEmail();
const password: string = '1234567890';

const user: $TSFixMe = {
    email,
    password,
};

describe('Keyboard Shortcut: Dashboard', () => {
    const operationTimeOut: $TSFixMe = init.timeout;

    beforeAll(async (done: $TSFixMe) => {
        jest.setTimeout(init.timeout);

        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(utils.agent);
        // user
        await init.registerUser(user, page);

        done();
    });

    afterAll(async (done: $TSFixMe) => {
        await browser.close();
        done();
    });

    test(
        'should navigate to component pages with keyboard shortcut (f + c)',
        async (done: $TSFixMe) => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });
            await init.pageWaitForSelector(page, '#components', {
                visible: true,
                timeout: init.timeout,
            });
            await page.keyboard.press('f');
            await page.keyboard.press('c');
            const componentForm: $TSFixMe = await init.pageWaitForSelector(
                page,
                '#form-new-component',
                { visible: true, timeout: init.timeout }
            );
            expect(componentForm).toBeDefined();

            done();
        },
        operationTimeOut
    );

    test(
        'should navigate to incident logs page with keyboard shortcut (f + i)',
        async (done: $TSFixMe) => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });
            await init.pageWaitForSelector(page, '#incidents', {
                visible: true,
                timeout: init.timeout,
            });
            await page.keyboard.press('f');
            await page.keyboard.press('i');
            const incidentLogs: $TSFixMe = await init.pageWaitForSelector(
                page,
                '#incidentLogs',
                {
                    visible: true,
                    timeout: init.timeout,
                }
            );
            expect(incidentLogs).toBeDefined();

            done();
        },
        operationTimeOut
    );

    test(
        'should navigate to status pages with keyboard shortcut (f + p)',
        async (done: $TSFixMe) => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });
            await init.pageWaitForSelector(page, '#statusPages', {
                visible: true,
                timeout: init.timeout,
            });
            await page.keyboard.press('f');
            await page.keyboard.press('p');
            const statusPageTable: $TSFixMe = await init.pageWaitForSelector(
                page,
                '#statusPageTable',
                { visible: true, timeout: init.timeout }
            );
            expect(statusPageTable).toBeDefined();

            done();
        },
        operationTimeOut
    );

    test(
        'should navigate to on-call schedule page with keyboard shortcut (f + o)',
        async (done: $TSFixMe) => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });
            await init.pageWaitForSelector(page, '#onCallDuty', {
                visible: true,
                timeout: init.timeout,
            });
            await page.keyboard.press('f');
            await page.keyboard.press('o');
            const onCall: $TSFixMe = await init.pageWaitForSelector(
                page,
                '#onCallSchedulePage',
                {
                    visible: true,
                    timeout: init.timeout,
                }
            );
            expect(onCall).toBeDefined();

            done();
        },
        operationTimeOut
    );

    test(
        'should navigate to alert log page with keyboard shortcut (o + a)',
        async (done: $TSFixMe) => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });
            await init.pageWaitForSelector(page, '#onCallDuty', {
                visible: true,
                timeout: init.timeout,
            });
            await page.keyboard.press('o');
            await page.keyboard.press('a');
            const alertLog: $TSFixMe = await init.pageWaitForSelector(
                page,
                '#alertLogPage',
                {
                    visible: true,
                    timeout: init.timeout,
                }
            );
            expect(alertLog).toBeDefined();

            done();
        },
        operationTimeOut
    );

    test(
        'should navigate scheduled events page with keyboard shortcut (f + e)',
        async (done: $TSFixMe) => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });
            await init.pageWaitForSelector(page, '#scheduledMaintenance', {
                visible: true,
                timeout: init.timeout,
            });
            await page.keyboard.press('f');
            await page.keyboard.press('e');
            const scheduledEventsPage: $TSFixMe =
                await init.pageWaitForSelector(page, '#scheduleEventsPage', {
                    visible: true,
                    timeout: init.timeout,
                });
            expect(scheduledEventsPage).toBeDefined();

            done();
        },
        operationTimeOut
    );

    test(
        'should navigate to automation script page with keyboard shortcut (f + z)',
        async (done: $TSFixMe) => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });
            await init.pageWaitForSelector(page, '#automationScripts', {
                visible: true,
                timeout: init.timeout,
            });
            await page.keyboard.press('f');
            await page.keyboard.press('z');
            const automationScriptsPage: $TSFixMe =
                await init.pageWaitForSelector(page, '#automationScriptsPage', {
                    visible: true,
                    timeout: init.timeout,
                });
            expect(automationScriptsPage).toBeDefined();

            done();
        },
        operationTimeOut
    );

    test(
        'should navigate to reports page with keyboard shortcut (f + v)',
        async (done: $TSFixMe) => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });
            await init.pageWaitForSelector(page, '#reports', {
                visible: true,
                timeout: init.timeout,
            });
            await page.keyboard.press('f');
            await page.keyboard.press('v');
            const report: $TSFixMe = await init.pageWaitForSelector(
                page,
                '#reportPage',
                {
                    visible: true,
                    timeout: init.timeout,
                }
            );
            expect(report).toBeDefined();

            done();
        },
        operationTimeOut
    );

    test(
        'should navigate to team members page with keyboard shortcut (f + u)',
        async (done: $TSFixMe) => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });
            await init.pageWaitForSelector(page, '#teamMembers', {
                visible: true,
                timeout: init.timeout,
            });
            await page.keyboard.press('f');
            await page.keyboard.press('u');
            const teamMember: $TSFixMe = await init.pageWaitForSelector(
                page,
                '#teamMemberPage',
                {
                    visible: true,
                    timeout: init.timeout,
                }
            );
            expect(teamMember).toBeDefined();

            done();
        },
        operationTimeOut
    );

    test(
        'should navigate to project settings page with keyboard shortcut (f + s)',
        async (done: $TSFixMe) => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });
            await init.pageWaitForSelector(page, '#projectSettings', {
                visible: true,
                timeout: init.timeout,
            });
            await page.keyboard.press('f');
            await page.keyboard.press('s');
            const projectSettings: $TSFixMe = await init.pageWaitForSelector(
                page,
                '#settingsPage',
                { visible: true, timeout: init.timeout }
            );
            expect(projectSettings).toBeDefined();

            done();
        },
        operationTimeOut
    );

    test(
        'should navigate to consulting and services page with keyboard shortcut (f + q)',
        async (done: $TSFixMe) => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });
            await init.pageWaitForSelector(page, '#consultingServices', {
                visible: true,
                timeout: init.timeout,
            });
            await page.keyboard.press('f');
            await page.keyboard.press('q');
            const consultingServicesPage: $TSFixMe =
                await init.pageWaitForSelector(
                    page,
                    '#consultingServicesPage',
                    { visible: true, timeout: init.timeout }
                );
            expect(consultingServicesPage).toBeDefined();

            done();
        },
        operationTimeOut
    );

    test(
        'should navigate to billing settings page with keyboard shortcut (s + b)',
        async (done: $TSFixMe) => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });
            await init.pageWaitForSelector(page, '#projectSettings', {
                visible: true,
                timeout: init.timeout,
            });
            await page.keyboard.press('s');
            await page.keyboard.press('b');
            const billing: $TSFixMe = await init.pageWaitForSelector(
                page,
                '#billing',
                {
                    visible: true,
                    timeout: init.timeout,
                }
            );
            expect(billing).toBeDefined();

            done();
        },
        operationTimeOut
    );

    test.skip(
        'should navigate to resource category page with keyboard shortcut (s + r)',
        async (done: $TSFixMe) => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });
            await init.pageWaitForSelector(page, '#projectSettings', {
                visible: true,
                timeout: init.timeout,
            });
            await page.keyboard.press('s');
            await page.keyboard.press('r');
            const resourceCategory: $TSFixMe = await init.pageWaitForSelector(
                page,
                '#resourceCategories',
                { visible: true, timeout: init.timeout }
            );
            expect(resourceCategory).toBeDefined();

            done();
        },
        operationTimeOut
    );

    test(
        'should navigate to monitor page (project settings) with keyboard shortcut (s + m)',
        async (done: $TSFixMe) => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });
            await init.pageWaitForSelector(page, '#projectSettings', {
                visible: true,
                timeout: init.timeout,
            });
            await page.keyboard.press('s');
            await page.keyboard.press('m');
            const monitorSettings: $TSFixMe = await init.pageWaitForSelector(
                page,
                '#monitorSettingsPage',
                { visible: true, timeout: init.timeout }
            );
            expect(monitorSettings).toBeDefined();

            done();
        },
        operationTimeOut
    );

    test(
        'should navigate to incidents page (project settings) with keyboard shortcut (s + t)',
        async (done: $TSFixMe) => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });
            await init.pageWaitForSelector(page, '#projectSettings', {
                visible: true,
                timeout: init.timeout,
            });
            await page.keyboard.press('s');
            await page.keyboard.press('t');
            const incidentSettings: $TSFixMe = await init.pageWaitForSelector(
                page,
                '#incidentSettingsPage',
                { visible: true, timeout: init.timeout }
            );
            expect(incidentSettings).toBeDefined();

            done();
        },
        operationTimeOut
    );

    test(
        'should navigate to integrations page with keyboard shortcut (s + i)',
        async (done: $TSFixMe) => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });
            await init.pageWaitForSelector(page, '#projectSettings', {
                visible: true,
                timeout: init.timeout,
            });
            await page.keyboard.press('s');
            await page.keyboard.press('i');
            const integrations: $TSFixMe = await init.pageWaitForSelector(
                page,
                '#integrations',
                {
                    visible: true,
                    timeout: init.timeout,
                }
            );
            expect(integrations).toBeDefined();

            done();
        },
        operationTimeOut
    );

    test(
        'should navigate to email settings page with keyboard shortcut (s + e)',
        async (done: $TSFixMe) => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });
            await init.pageWaitForSelector(page, '#projectSettings', {
                visible: true,
                timeout: init.timeout,
            });
            await page.keyboard.press('s');
            await page.keyboard.press('e');
            const emailTemplate: $TSFixMe = await init.pageWaitForSelector(
                page,
                '#emailTemplate',
                {
                    visible: true,
                    timeout: init.timeout,
                }
            );
            expect(emailTemplate).toBeDefined();

            done();
        },
        operationTimeOut
    );

    test(
        'should navigate to sms settings page with keyboard shortcut (s + c)',
        async (done: $TSFixMe) => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });
            await init.pageWaitForSelector(page, '#projectSettings', {
                visible: true,
                timeout: init.timeout,
            });
            await page.keyboard.press('s');
            await page.keyboard.press('c');
            const smsTemplate: $TSFixMe = await init.pageWaitForSelector(
                page,
                '#smsTemplate',
                {
                    visible: true,
                    timeout: init.timeout,
                }
            );
            expect(smsTemplate).toBeDefined();

            done();
        },
        operationTimeOut
    );

    test(
        'should navigate to webhooks page (project settings) with keyboard shortcut (s + w)',
        async (done: $TSFixMe) => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });
            await init.pageWaitForSelector(page, '#projectSettings', {
                visible: true,
                timeout: init.timeout,
            });
            await page.keyboard.press('s');
            await page.keyboard.press('w');
            const webhooksSettingsPage: $TSFixMe =
                await init.pageWaitForSelector(page, '#webhooksSettingsPage', {
                    visible: true,
                    timeout: init.timeout,
                });
            expect(webhooksSettingsPage).toBeDefined();

            done();
        },
        operationTimeOut
    );

    test(
        'should navigate to probe in settings page with keyboard shortcut (s + p)',
        async (done: $TSFixMe) => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });
            await init.pageWaitForSelector(page, '#projectSettings', {
                visible: true,
                timeout: init.timeout,
            });
            await page.keyboard.press('s');
            await page.keyboard.press('p');
            const probe: $TSFixMe = await init.pageWaitForSelector(
                page,
                '#probeList',
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
        'should navigate to git credential page with keyboard shortcut (s + g)',
        async (done: $TSFixMe) => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });
            await init.pageWaitForSelector(page, '#projectSettings', {
                visible: true,
                timeout: init.timeout,
            });
            await page.keyboard.press('s');
            await page.keyboard.press('g');
            const gitCredential: $TSFixMe = await init.pageWaitForSelector(
                page,
                '#gitCredentialPage',
                { visible: true, timeout: init.timeout }
            );
            expect(gitCredential).toBeDefined();

            done();
        },
        operationTimeOut
    );

    test(
        'should navigate to docker credential page with keyboard shortcut (s + k)',
        async (done: $TSFixMe) => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });
            await init.pageWaitForSelector(page, '#projectSettings', {
                visible: true,
                timeout: init.timeout,
            });
            await page.keyboard.press('s');
            await page.keyboard.press('k'); // k is the new addition
            const dockerCredential: $TSFixMe = await init.pageWaitForSelector(
                page,
                '#dockerCredentialPage',
                { visible: true, timeout: init.timeout }
            );
            expect(dockerCredential).toBeDefined();

            done();
        },
        operationTimeOut
    );

    test(
        'should navigate to git credentials page (project settings) with keyboard shortcut (s + g)',
        async (done: $TSFixMe) => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });
            await init.pageWaitForSelector(page, '#projectSettings', {
                visible: true,
                timeout: init.timeout,
            });
            await page.keyboard.press('s');
            await page.keyboard.press('g');
            const gitCredentialsSettings: $TSFixMe =
                await init.pageWaitForSelector(page, '#gitCredentialPage', {
                    visible: true,
                    timeout: init.timeout,
                });
            expect(gitCredentialsSettings).toBeDefined();

            done();
        },
        operationTimeOut
    );

    test(
        'should navigate to docker credentials page (project settings) with keyboard shortcut (s + d)',
        async (done: $TSFixMe) => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });
            await init.pageWaitForSelector(page, '#projectSettings', {
                visible: true,
                timeout: init.timeout,
            });
            await page.keyboard.press('s');
            await page.keyboard.press('k'); // k is the new addition
            const dockerCredentialsSettings: $TSFixMe =
                await init.pageWaitForSelector(page, '#dockerCredentialPage', {
                    visible: true,
                    timeout: init.timeout,
                });
            expect(dockerCredentialsSettings).toBeDefined();

            done();
        },
        operationTimeOut
    );

    test(
        'should navigate to api page with keyboard shortcut (s + a)',
        async (done: $TSFixMe) => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });
            await init.pageWaitForSelector(page, '#projectSettings', {
                visible: true,
                timeout: init.timeout,
            });
            await page.keyboard.press('s');
            await page.keyboard.press('a');
            const oneuptimeApi: $TSFixMe = await init.pageWaitForSelector(
                page,
                '#oneuptimeApi',
                {
                    visible: true,
                    timeout: init.timeout,
                }
            );
            expect(oneuptimeApi).toBeDefined();

            done();
        },
        operationTimeOut
    );

    test(
        'should navigate to advanced page (project settings) with keyboard shortcut (s + v)',
        async (done: $TSFixMe) => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });
            await init.pageWaitForSelector(page, '#projectSettings', {
                visible: true,
                timeout: init.timeout,
            });
            await page.keyboard.press('s');
            await page.keyboard.press('v');
            const advancedSettingsPage: $TSFixMe =
                await init.pageWaitForSelector(page, '#advancedPage', {
                    visible: true,
                    timeout: init.timeout,
                });
            expect(advancedSettingsPage).toBeDefined();

            done();
        },
        operationTimeOut
    );

    test(
        'should navigate to profile settings with keyboard shortcut (f + n)',
        async (done: $TSFixMe) => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });
            await init.pageWaitForSelector(page, '#profile-menu', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#profile-menu');

            await init.pageWaitForSelector(page, '#profileBilling');

            await init.pageClick(page, '#profileBilling');
            await init.pageWaitForSelector(page, '#profileSettings', {
                visible: true,
                timeout: init.timeout,
            });

            await page.keyboard.press('f');
            await page.keyboard.press('n');
            const profileSetting: $TSFixMe = await init.pageWaitForSelector(
                page,
                '#profileSettingPage',
                { visible: true, timeout: init.timeout }
            );
            expect(profileSetting).toBeDefined();

            done();
        },
        operationTimeOut
    );

    test(
        'should navigate to change password page with keyboard shortcut (f + w)',
        async (done: $TSFixMe) => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });
            await init.pageWaitForSelector(page, '#profile-menu', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#profile-menu');

            await init.pageWaitForSelector(page, '#userProfile');

            await init.pageClick(page, '#userProfile');
            await init.pageWaitForSelector(page, '#changePassword', {
                visible: true,
                timeout: init.timeout,
            });

            await page.keyboard.press('f');
            await page.keyboard.press('w');
            const changePassword: $TSFixMe = await init.pageWaitForSelector(
                page,
                '#changePasswordSetting',
                { visible: true, timeout: init.timeout }
            );
            expect(changePassword).toBeDefined();

            done();
        },
        operationTimeOut
    );

    test(
        'should navigate to profile billing page with keyboard shortcut (f + b)',
        async (done: $TSFixMe) => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });
            await init.pageWaitForSelector(page, '#profile-menu', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#profile-menu');

            await init.pageWaitForSelector(page, '#userProfile');

            await init.pageClick(page, '#userProfile');
            await init.pageWaitForSelector(page, '#billing', {
                visible: true,
                timeout: init.timeout,
            });

            await page.keyboard.press('f');
            await page.keyboard.press('b');
            const profileBilling: $TSFixMe = await init.pageWaitForSelector(
                page,
                '#profileBilling',
                { visible: true, timeout: init.timeout }
            );
            expect(profileBilling).toBeDefined();

            done();
        },
        operationTimeOut
    );

    test(
        'should navigate to advanced page with keyboard shortcut (f + a)',
        async (done: $TSFixMe) => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });
            await init.pageWaitForSelector(page, '#profile-menu', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#profile-menu');

            await init.pageWaitForSelector(page, '#userProfile');

            await init.pageClick(page, '#userProfile');
            await init.pageWaitForSelector(page, '#advanced', {
                visible: true,
                timeout: init.timeout,
            });

            await page.keyboard.press('f');
            await page.keyboard.press('a');
            const deleteBtn: $TSFixMe = await init.pageWaitForSelector(
                page,
                '#btn_delete_account',
                { visible: true, timeout: init.timeout }
            );
            expect(deleteBtn).toBeDefined();

            done();
        },
        operationTimeOut
    );

    test(
        'should navigate back to dashboard from profile using keyboard shortcut (f + k)',
        async (done: $TSFixMe) => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });
            await init.pageWaitForSelector(page, '#profile-menu', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#profile-menu');

            await init.pageWaitForSelector(page, '#userProfile');

            await init.pageClick(page, '#userProfile');
            await init.pageWaitForSelector(page, '#backToDashboard', {
                visible: true,
                timeout: init.timeout,
            });

            await page.keyboard.press('f');
            await page.keyboard.press('k');
            const component: $TSFixMe = await init.pageWaitForSelector(
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
