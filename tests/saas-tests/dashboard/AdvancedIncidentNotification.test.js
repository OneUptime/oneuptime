import puppeteer from 'puppeteer'
import utils from '../../test-utils'
import init from '../../test-init'

require('should');
let browser, page;
// user credentials
const email = utils.generateRandomBusinessEmail();
const password = '1234567890';
const user = {
    email,
    password,
};
describe('Project Settings Page - (Email and SMS & Calls)', () => {
    const operationTimeOut = init.timeout;

    beforeAll(async done => {
        jest.setTimeout(operationTimeOut);

        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(utils.agent);
        // user
        await init.registerUser(user, page);
        done();
    });

    afterAll(async done => {
        await browser.close();
        done();
    });

    test(
        'should enable sending email notification when incident is created, acknowledged, resolved or investigated',
        async done => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });

            await init.pageWaitForSelector(page, '#projectSettings', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageClick(page, '#projectSettings');
            await init.pageWaitForSelector(page, '#more');
            await init.pageClick(page, '#more');
            await init.pageWaitForSelector(page, '#email', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageClick(page, '#email');

            await init.pageWaitForSelector(
                page,
                '#sendCreatedIncidentNotificationEmail',
                {
                    visible: true,
                }
            );
            let sendCreatedIncidentNotification = await init.page$Eval(
                page,
                '#sendCreatedIncidentNotificationEmail',
                elem => elem.value
            );
            let sendAcknowledgedIncidentNotification = await init.page$Eval(
                page,
                '#sendAcknowledgedIncidentNotificationEmail',
                elem => elem.value
            );
            let sendResolvedIncidentNotification = await init.page$Eval(
                page,
                '#sendResolvedIncidentNotificationEmail',
                elem => elem.value
            );
            let sendInvestigationNoteNotification = await init.page$Eval(
                page,
                '#enableInvestigationNoteNotificationEmail',
                elem => elem.value
            );
            sendCreatedIncidentNotification = utils.parseBoolean(
                sendCreatedIncidentNotification
            );
            sendAcknowledgedIncidentNotification = utils.parseBoolean(
                sendAcknowledgedIncidentNotification
            );
            sendResolvedIncidentNotification = utils.parseBoolean(
                sendResolvedIncidentNotification
            );
            sendInvestigationNoteNotification = utils.parseBoolean(
                sendInvestigationNoteNotification
            );
            expect(sendCreatedIncidentNotification).toBeTruthy();
            expect(sendAcknowledgedIncidentNotification).toBeTruthy();
            expect(sendResolvedIncidentNotification).toBeTruthy();
            expect(sendInvestigationNoteNotification).toBeTruthy();

            done();
        },
        operationTimeOut
    );

    test(
        'should disable sending email notification when incident is created',
        async done => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });

            await init.pageWaitForSelector(page, '#projectSettings', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageClick(page, '#projectSettings');
            await init.pageWaitForSelector(page, '#more');
            await init.pageClick(page, '#more');
            await init.pageWaitForSelector(page, '#email', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageClick(page, '#email');

            await init.pageWaitForSelector(
                page,
                '#sendCreatedIncidentNotificationEmail',
                {
                    visible: true,
                }
            );
            await init.page$Eval(
                page,
                '#sendCreatedIncidentNotificationEmail',
                elem => elem.click()
            );
            await init.pageClick(page, '#saveIncidentNotification');

            await init.pageWaitForSelector(page, '.ball-beat', {
                hidden: true,
            });

            await page.reload({ waitUntil: 'networkidle2' });
            await init.pageWaitForSelector(
                page,
                '#sendCreatedIncidentNotificationEmail',
                {
                    visible: true,
                }
            );
            let checkedState = await init.page$Eval(
                page,
                '#sendCreatedIncidentNotificationEmail',
                elem => elem.value
            );
            checkedState = utils.parseBoolean(checkedState);
            expect(checkedState).toBeFalsy();

            done();
        },
        operationTimeOut
    );

    test(
        'should disable sending email notification when incident is acknowledged',
        async done => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });

            await init.pageWaitForSelector(page, '#projectSettings', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageClick(page, '#projectSettings');
            await init.pageWaitForSelector(page, '#more');
            await init.pageClick(page, '#more');
            await init.pageWaitForSelector(page, '#email', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageClick(page, '#email');

            await init.pageWaitForSelector(
                page,
                '#sendAcknowledgedIncidentNotificationEmail',
                {
                    visible: true,
                }
            );
            await init.page$Eval(
                page,
                '#sendAcknowledgedIncidentNotificationEmail',
                elem => elem.click()
            );
            await init.pageClick(page, '#saveIncidentNotification');

            await init.pageWaitForSelector(page, '.ball-beat', {
                hidden: true,
            });

            await page.reload({ waitUntil: 'networkidle2' });
            await init.pageWaitForSelector(
                page,
                '#sendAcknowledgedIncidentNotificationEmail',
                {
                    visible: true,
                }
            );
            let checkedState = await init.page$Eval(
                page,
                '#sendAcknowledgedIncidentNotificationEmail',
                elem => elem.value
            );
            checkedState = utils.parseBoolean(checkedState);
            expect(checkedState).toBeFalsy();

            done();
        },
        operationTimeOut
    );

    test(
        'should disable sending email notification when incident is resolved',
        async done => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });

            await init.pageWaitForSelector(page, '#projectSettings', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageClick(page, '#projectSettings');
            await init.pageWaitForSelector(page, '#more');
            await init.pageClick(page, '#more');
            await init.pageWaitForSelector(page, '#email', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageClick(page, '#email');

            await init.pageWaitForSelector(
                page,
                '#sendResolvedIncidentNotificationEmail',
                {
                    visible: true,
                }
            );
            await init.page$Eval(
                page,
                '#sendResolvedIncidentNotificationEmail',
                elem => elem.click()
            );
            await init.pageClick(page, '#saveIncidentNotification');

            await init.pageWaitForSelector(page, '.ball-beat', {
                hidden: true,
            });

            await page.reload({ waitUntil: 'networkidle2' });
            await init.pageWaitForSelector(
                page,
                '#sendResolvedIncidentNotificationEmail',
                {
                    visible: true,
                }
            );
            let checkedState = await init.page$Eval(
                page,
                '#sendResolvedIncidentNotificationEmail',
                elem => elem.value
            );
            checkedState = utils.parseBoolean(checkedState);
            expect(checkedState).toBeFalsy();

            done();
        },
        operationTimeOut
    );

    test(
        'should disable sending email notification for investigation note',
        async done => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });

            await init.pageWaitForSelector(page, '#projectSettings', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageClick(page, '#projectSettings');
            await init.pageWaitForSelector(page, '#more');
            await init.pageClick(page, '#more');
            await init.pageWaitForSelector(page, '#email', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageClick(page, '#email');

            await init.pageWaitForSelector(
                page,
                '#enableInvestigationNoteNotificationEmail',
                {
                    visible: true,
                }
            );
            await init.page$Eval(
                page,
                '#enableInvestigationNoteNotificationEmail',
                elem => elem.click()
            );
            await init.pageClick(page, '#saveIncidentNotification');

            await init.pageWaitForSelector(page, '.ball-beat', {
                hidden: true,
            });

            await page.reload({ waitUntil: 'networkidle2' });
            await init.pageWaitForSelector(
                page,
                '#enableInvestigationNoteNotificationEmail',
                {
                    visible: true,
                }
            );
            let checkedState = await init.page$Eval(
                page,
                '#enableInvestigationNoteNotificationEmail',
                elem => elem.value
            );
            checkedState = utils.parseBoolean(checkedState);
            expect(checkedState).toBeFalsy();

            done();
        },
        operationTimeOut
    );

    test(
        'should enable sending sms notification when incident is created, acknowledged, resolved or investigated',
        async done => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });

            await init.pageWaitForSelector(page, '#projectSettings', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageClick(page, '#projectSettings');
            await init.pageWaitForSelector(page, '#more');
            await init.pageClick(page, '#more');
            await init.pageWaitForSelector(page, '#smsCalls', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageClick(page, '#smsCalls');

            await init.pageWaitForSelector(
                page,
                '#sendCreatedIncidentNotificationSms',
                {
                    visible: true,
                    timeout: init.timeout,
                }
            );
            let sendCreatedIncidentNotification = await init.page$Eval(
                page,
                '#sendCreatedIncidentNotificationSms',
                elem => elem.value
            );
            let sendAcknowledgedIncidentNotification = await init.page$Eval(
                page,
                '#sendAcknowledgedIncidentNotificationSms',
                elem => elem.value
            );
            let sendResolvedIncidentNotification = await init.page$Eval(
                page,
                '#sendResolvedIncidentNotificationSms',
                elem => elem.value
            );
            let sendInvestigationNoteNotification = await init.page$Eval(
                page,
                '#enableInvestigationNoteNotificationSMS',
                elem => elem.value
            );
            sendCreatedIncidentNotification = utils.parseBoolean(
                sendCreatedIncidentNotification
            );
            sendAcknowledgedIncidentNotification = utils.parseBoolean(
                sendAcknowledgedIncidentNotification
            );
            sendResolvedIncidentNotification = utils.parseBoolean(
                sendResolvedIncidentNotification
            );
            sendInvestigationNoteNotification = utils.parseBoolean(
                sendInvestigationNoteNotification
            );
            expect(sendCreatedIncidentNotification).toBeTruthy();
            expect(sendAcknowledgedIncidentNotification).toBeTruthy();
            expect(sendResolvedIncidentNotification).toBeTruthy();
            expect(sendInvestigationNoteNotification).toBeTruthy();

            done();
        },
        operationTimeOut
    );

    test(
        'should disable sending sms notification when incident is created',
        async done => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });

            await init.pageWaitForSelector(page, '#projectSettings', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageClick(page, '#projectSettings');
            await init.pageWaitForSelector(page, '#more');
            await init.pageClick(page, '#more');
            await init.pageWaitForSelector(page, '#smsCalls', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageClick(page, '#smsCalls');

            await init.pageWaitForSelector(
                page,
                '#sendCreatedIncidentNotificationSms',
                {
                    visible: true,
                    timeout: init.timeout,
                }
            );
            await init.page$Eval(
                page,
                '#sendCreatedIncidentNotificationSms',
                elem => elem.click()
            );
            await init.pageClick(page, '#saveIncidentNotification');

            await init.pageWaitForSelector(page, '.ball-beat', {
                hidden: true,
            });

            await page.reload({ waitUntil: 'networkidle2' });
            await init.pageWaitForSelector(
                page,
                '#sendCreatedIncidentNotificationSms',
                {
                    visible: true,
                    timeout: init.timeout,
                }
            );
            let checkedState = await init.page$Eval(
                page,
                '#sendCreatedIncidentNotificationSms',
                elem => elem.value
            );
            checkedState = utils.parseBoolean(checkedState);
            expect(checkedState).toBeFalsy();

            done();
        },
        operationTimeOut
    );

    test(
        'should disable sending sms notification when incident is acknowledged',
        async done => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });

            await init.pageWaitForSelector(page, '#projectSettings', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageClick(page, '#projectSettings');
            await init.pageWaitForSelector(page, '#more');
            await init.pageClick(page, '#more');
            await init.pageWaitForSelector(page, '#smsCalls', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageClick(page, '#smsCalls');
            await init.pageWaitForSelector(
                page,
                '#sendAcknowledgedIncidentNotificationSms',
                {
                    visible: true,
                }
            );
            await init.page$Eval(
                page,
                '#sendAcknowledgedIncidentNotificationSms',
                elem => elem.click()
            );
            await init.pageClick(page, '#saveIncidentNotification');

            await init.pageWaitForSelector(page, '.ball-beat', {
                hidden: true,
            });

            await page.reload({ waitUntil: 'networkidle2' });
            await init.pageWaitForSelector(
                page,
                '#sendAcknowledgedIncidentNotificationSms',
                {
                    visible: true,
                }
            );
            let checkedState = await init.page$Eval(
                page,
                '#sendAcknowledgedIncidentNotificationSms',
                elem => elem.value
            );
            checkedState = utils.parseBoolean(checkedState);
            expect(checkedState).toBeFalsy();

            done();
        },
        operationTimeOut
    );

    test(
        'should disable sending sms notification when incident is resolved',
        async done => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });

            await init.pageWaitForSelector(page, '#projectSettings', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageClick(page, '#projectSettings');
            await init.pageWaitForSelector(page, '#more');
            await init.pageClick(page, '#more');
            await init.pageWaitForSelector(page, '#smsCalls', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageClick(page, '#smsCalls');
            await init.pageWaitForSelector(page, '#more');
            await init.pageClick(page, '#more');
            await init.pageWaitForSelector(
                page,
                '#sendResolvedIncidentNotificationSms',
                {
                    visible: true,
                    timeout: init.timeout,
                }
            );
            await init.page$Eval(
                page,
                '#sendResolvedIncidentNotificationSms',
                elem => elem.click()
            );
            await init.pageClick(page, '#saveIncidentNotification');

            await init.pageWaitForSelector(page, '.ball-beat', {
                hidden: true,
            });

            await page.reload({ waitUntil: 'networkidle2' });
            await init.pageWaitForSelector(
                page,
                '#sendResolvedIncidentNotificationSms',
                {
                    visible: true,
                    timeout: init.timeout,
                }
            );
            let checkedState = await init.page$Eval(
                page,
                '#sendResolvedIncidentNotificationSms',
                elem => elem.value
            );
            checkedState = utils.parseBoolean(checkedState);
            expect(checkedState).toBeFalsy();

            done();
        },
        operationTimeOut
    );
    test(
        'should disable sending sms notification for investigation note',
        async done => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });

            await init.pageWaitForSelector(page, '#projectSettings', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageClick(page, '#projectSettings');
            await init.pageWaitForSelector(page, '#more');
            await init.pageClick(page, '#more');
            await init.pageWaitForSelector(page, '#smsCalls', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageClick(page, '#smsCalls');

            await init.pageWaitForSelector(
                page,
                '#enableInvestigationNoteNotificationSMS',
                {
                    visible: true,
                }
            );
            await init.page$Eval(
                page,
                '#enableInvestigationNoteNotificationSMS',
                elem => elem.click()
            );
            await init.pageClick(page, '#saveIncidentNotification');

            await init.pageWaitForSelector(page, '.ball-beat', {
                hidden: true,
            });

            await page.reload({ waitUntil: 'networkidle2' });
            await init.pageWaitForSelector(
                page,
                '#enableInvestigationNoteNotificationSMS',
                {
                    visible: true,
                }
            );
            let checkedState = await init.page$Eval(
                page,
                '#enableInvestigationNoteNotificationSMS',
                elem => elem.value
            );
            checkedState = utils.parseBoolean(checkedState);
            expect(checkedState).toBeFalsy();

            done();
        },
        operationTimeOut
    );
});
