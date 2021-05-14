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

            await page.waitForSelector('#projectSettings', {
                visible: true,
            });
            await init.pageClick(page, '#projectSettings');
            await page.waitForSelector('#more');
            await init.pageClick(page, '#more');
            await page.waitForSelector('#email', { visible: true });
            await init.pageClick(page, '#email');

            await page.waitForSelector(
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

            await page.waitForSelector('#projectSettings', {
                visible: true,
            });
            await init.pageClick(page, '#projectSettings');
            await page.waitForSelector('#more');
            await init.pageClick(page, '#more');
            await page.waitForSelector('#email', { visible: true });
            await init.pageClick(page, '#email');

            await page.waitForSelector(
                '#sendCreatedIncidentNotificationEmail',
                {
                    visible: true,
                }
            );
            await page.$eval('#sendCreatedIncidentNotificationEmail', elem =>
                elem.click()
            );
            await init.pageClick(page, '#saveIncidentNotification');

            await page.waitForSelector('.ball-beat', { hidden: true });

            await page.reload({ waitUntil: 'networkidle2' });
            await page.waitForSelector(
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

            await page.waitForSelector('#projectSettings', {
                visible: true,
            });
            await init.pageClick(page, '#projectSettings');
            await page.waitForSelector('#more');
            await init.pageClick(page, '#more');
            await page.waitForSelector('#email', { visible: true });
            await init.pageClick(page, '#email');

            await page.waitForSelector(
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

            await page.waitForSelector('.ball-beat', { hidden: true });

            await page.reload({ waitUntil: 'networkidle2' });
            await page.waitForSelector(
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

            await page.waitForSelector('#projectSettings', {
                visible: true,
            });
            await init.pageClick(page, '#projectSettings');
            await page.waitForSelector('#more');
            await init.pageClick(page, '#more');
            await page.waitForSelector('#email', { visible: true });
            await init.pageClick(page, '#email');

            await page.waitForSelector(
                '#sendResolvedIncidentNotificationEmail',
                {
                    visible: true,
                }
            );
            await page.$eval('#sendResolvedIncidentNotificationEmail', elem =>
                elem.click()
            );
            await init.pageClick(page, '#saveIncidentNotification');

            await page.waitForSelector('.ball-beat', { hidden: true });

            await page.reload({ waitUntil: 'networkidle2' });
            await page.waitForSelector(
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

            await page.waitForSelector('#projectSettings', {
                visible: true,
            });
            await init.pageClick(page, '#projectSettings');
            await page.waitForSelector('#more');
            await init.pageClick(page, '#more');
            await page.waitForSelector('#email', { visible: true });
            await init.pageClick(page, '#email');

            await page.waitForSelector(
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

            await page.waitForSelector('.ball-beat', { hidden: true });

            await page.reload({ waitUntil: 'networkidle2' });
            await page.waitForSelector(
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

            await page.waitForSelector('#projectSettings', {
                visible: true,
            });
            await init.pageClick(page, '#projectSettings');
            await page.waitForSelector('#more');
            await init.pageClick(page, '#more');
            await page.waitForSelector('#smsCalls', { visible: true });
            await init.pageClick(page, '#smsCalls');

            await page.waitForSelector('#sendCreatedIncidentNotificationSms', {
                visible: true,
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

            await page.waitForSelector('#projectSettings', {
                visible: true,
            });
            await init.pageClick(page, '#projectSettings');
            await page.waitForSelector('#more');
            await init.pageClick(page, '#more');
            await page.waitForSelector('#smsCalls', { visible: true });
            await init.pageClick(page, '#smsCalls');

            await page.waitForSelector('#sendCreatedIncidentNotificationSms', {
                visible: true,
            });
            await page.$eval('#sendCreatedIncidentNotificationSms', elem =>
                elem.click()
            );
            await init.pageClick(page, '#saveIncidentNotification');

            await page.waitForSelector('.ball-beat', { hidden: true });

            await page.reload({ waitUntil: 'networkidle2' });
            await page.waitForSelector('#sendCreatedIncidentNotificationSms', {
                visible: true,
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

            await page.waitForSelector('#projectSettings', {
                visible: true,
            });
            await init.pageClick(page, '#projectSettings');
            await page.waitForSelector('#more');
            await init.pageClick(page, '#more');
            await page.waitForSelector('#smsCalls', { visible: true });
            await init.pageClick(page, '#smsCalls');
            await page.waitForSelector(
                '#sendAcknowledgedIncidentNotificationSms',
                {
                    visible: true,
                }
            );
            await page.$eval('#sendAcknowledgedIncidentNotificationSms', elem =>
                elem.click()
            );
            await init.pageClick(page, '#saveIncidentNotification');

            await page.waitForSelector('.ball-beat', { hidden: true });

            await page.reload({ waitUntil: 'networkidle2' });
            await page.waitForSelector(
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

            await page.waitForSelector('#projectSettings', {
                visible: true,
            });
            await init.pageClick(page, '#projectSettings');
            await page.waitForSelector('#more');
            await init.pageClick(page, '#more');
            await page.waitForSelector('#smsCalls', { visible: true });
            await init.pageClick(page, '#smsCalls');
            await page.waitForSelector('#more');
            await init.pageClick(page, '#more');
            await page.waitForSelector('#sendResolvedIncidentNotificationSms', {
                visible: true,
            });
            await page.$eval('#sendResolvedIncidentNotificationSms', elem =>
                elem.click()
            );
            await init.pageClick(page, '#saveIncidentNotification');

            await page.waitForSelector('.ball-beat', { hidden: true });

            await page.reload({ waitUntil: 'networkidle2' });
            await page.waitForSelector('#sendResolvedIncidentNotificationSms', {
                visible: true,
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

            await page.waitForSelector('#projectSettings', {
                visible: true,
            });
            await init.pageClick(page, '#projectSettings');
            await page.waitForSelector('#more');
            await init.pageClick(page, '#more');
            await page.waitForSelector('#smsCalls', { visible: true });
            await init.pageClick(page, '#smsCalls');

            await page.waitForSelector(
                '#enableInvestigationNoteNotificationSMS',
                {
                    visible: true,
                }
            );
            await page.$eval('#enableInvestigationNoteNotificationSMS', elem =>
                elem.click()
            );
            await init.pageClick(page, '#saveIncidentNotification');

            await page.waitForSelector('.ball-beat', { hidden: true });

            await page.reload({ waitUntil: 'networkidle2' });
            await page.waitForSelector(
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
