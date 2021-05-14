const puppeteer = require('puppeteer');
const utils = require('../../test-utils');
const init = require('../../test-init');

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

            await init.pageWaitForSelector(page, 
                '#sendCreatedIncidentNotificationEmail',
                {
                    visible: true,
                }
            );
            let sendCreatedIncidentNotification = await page.$eval(
                '#sendCreatedIncidentNotificationEmail',
                elem => elem.value
            );
            let sendAcknowledgedIncidentNotification = await page.$eval(
                '#sendAcknowledgedIncidentNotificationEmail',
                elem => elem.value
            );
            let sendResolvedIncidentNotification = await page.$eval(
                '#sendResolvedIncidentNotificationEmail',
                elem => elem.value
            );
            let sendInvestigationNoteNotification = await page.$eval(
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

            await init.pageWaitForSelector(page, 
                '#sendCreatedIncidentNotificationEmail',
                {
                    visible: true,
                }
            );
            await page.$eval('#sendCreatedIncidentNotificationEmail', elem =>
                elem.click()
            );
            await init.pageClick(page, '#saveIncidentNotification');

            await init.pageWaitForSelector(page, '.ball-beat', { hidden: true });

            await page.reload({ waitUntil: 'networkidle2' });
            await init.pageWaitForSelector(page, 
                '#sendCreatedIncidentNotificationEmail',
                {
                    visible: true,
                }
            );
            let checkedState = await page.$eval(
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

            await init.pageWaitForSelector(page, 
                '#sendAcknowledgedIncidentNotificationEmail',
                {
                    visible: true,
                }
            );
            await page.$eval(
                '#sendAcknowledgedIncidentNotificationEmail',
                elem => elem.click()
            );
            await init.pageClick(page, '#saveIncidentNotification');

            await init.pageWaitForSelector(page, '.ball-beat', { hidden: true });

            await page.reload({ waitUntil: 'networkidle2' });
            await init.pageWaitForSelector(page, 
                '#sendAcknowledgedIncidentNotificationEmail',
                {
                    visible: true,
                }
            );
            let checkedState = await page.$eval(
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

            await init.pageWaitForSelector(page, 
                '#sendResolvedIncidentNotificationEmail',
                {
                    visible: true,
                }
            );
            await page.$eval('#sendResolvedIncidentNotificationEmail', elem =>
                elem.click()
            );
            await init.pageClick(page, '#saveIncidentNotification');

            await init.pageWaitForSelector(page, '.ball-beat', { hidden: true });

            await page.reload({ waitUntil: 'networkidle2' });
            await init.pageWaitForSelector(page, 
                '#sendResolvedIncidentNotificationEmail',
                {
                    visible: true,
                }
            );
            let checkedState = await page.$eval(
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

            await init.pageWaitForSelector(page, 
                '#enableInvestigationNoteNotificationEmail',
                {
                    visible: true,
                }
            );
            await page.$eval(
                '#enableInvestigationNoteNotificationEmail',
                elem => elem.click()
            );
            await init.pageClick(page, '#saveIncidentNotification');

            await init.pageWaitForSelector(page, '.ball-beat', { hidden: true });

            await page.reload({ waitUntil: 'networkidle2' });
            await init.pageWaitForSelector(page, 
                '#enableInvestigationNoteNotificationEmail',
                {
                    visible: true,
                }
            );
            let checkedState = await page.$eval(
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

            await init.pageWaitForSelector(page, '#sendCreatedIncidentNotificationSms', {
                visible: true,
                timeout: init.timeout,
            });
            let sendCreatedIncidentNotification = await page.$eval(
                '#sendCreatedIncidentNotificationSms',
                elem => elem.value
            );
            let sendAcknowledgedIncidentNotification = await page.$eval(
                '#sendAcknowledgedIncidentNotificationSms',
                elem => elem.value
            );
            let sendResolvedIncidentNotification = await page.$eval(
                '#sendResolvedIncidentNotificationSms',
                elem => elem.value
            );
            let sendInvestigationNoteNotification = await page.$eval(
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

            await init.pageWaitForSelector(page, '#sendCreatedIncidentNotificationSms', {
                visible: true,
                timeout: init.timeout,
            });
            await page.$eval('#sendCreatedIncidentNotificationSms', elem =>
                elem.click()
            );
            await init.pageClick(page, '#saveIncidentNotification');

            await init.pageWaitForSelector(page, '.ball-beat', { hidden: true });

            await page.reload({ waitUntil: 'networkidle2' });
            await init.pageWaitForSelector(page, '#sendCreatedIncidentNotificationSms', {
                visible: true,
                timeout: init.timeout,
            });
            let checkedState = await page.$eval(
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
            await init.pageWaitForSelector(page, 
                '#sendAcknowledgedIncidentNotificationSms',
                {
                    visible: true,
                }
            );
            await page.$eval('#sendAcknowledgedIncidentNotificationSms', elem =>
                elem.click()
            );
            await init.pageClick(page, '#saveIncidentNotification');

            await init.pageWaitForSelector(page, '.ball-beat', { hidden: true });

            await page.reload({ waitUntil: 'networkidle2' });
            await init.pageWaitForSelector(page, 
                '#sendAcknowledgedIncidentNotificationSms',
                {
                    visible: true,
                }
            );
            let checkedState = await page.$eval(
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
            await init.pageWaitForSelector(page, '#sendResolvedIncidentNotificationSms', {
                visible: true,
                timeout: init.timeout,
            });
            await page.$eval('#sendResolvedIncidentNotificationSms', elem =>
                elem.click()
            );
            await init.pageClick(page, '#saveIncidentNotification');

            await init.pageWaitForSelector(page, '.ball-beat', { hidden: true });

            await page.reload({ waitUntil: 'networkidle2' });
            await init.pageWaitForSelector(page, '#sendResolvedIncidentNotificationSms', {
                visible: true,
                timeout: init.timeout,
            });
            let checkedState = await page.$eval(
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

            await init.pageWaitForSelector(page, 
                '#enableInvestigationNoteNotificationSMS',
                {
                    visible: true,
                }
            );
            await page.$eval('#enableInvestigationNoteNotificationSMS', elem =>
                elem.click()
            );
            await init.pageClick(page, '#saveIncidentNotification');

            await init.pageWaitForSelector(page, '.ball-beat', { hidden: true });

            await page.reload({ waitUntil: 'networkidle2' });
            await init.pageWaitForSelector(page, 
                '#enableInvestigationNoteNotificationSMS',
                {
                    visible: true,
                }
            );
            let checkedState = await page.$eval(
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
