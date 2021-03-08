const puppeteer = require('puppeteer');
const utils = require('./test-utils');
const init = require('./test-init');
const { Cluster } = require('puppeteer-cluster');

require('should');

// user credentials
const email = utils.generateRandomBusinessEmail();
const password = '1234567890';

describe('Project Settings Page - (Email and SMS & Calls)', () => {
    const operationTimeOut = 500000;
    let cluster;
    beforeAll(async done => {
        jest.setTimeout(operationTimeOut);

        cluster = await Cluster.launch({
            concurrency: Cluster.CONCURRENCY_PAGE,
            puppeteerOptions: utils.puppeteerLaunchConfig,
            puppeteer,
            timeout: operationTimeOut,
        });

        cluster.on('error', err => {
            throw err;
        });

        await cluster.execute({ email, password }, async ({ page, data }) => {
            const user = {
                email: data.email,
                password: data.password,
            };
            // user
            await init.registerUser(user, page);
            // await init.loginUser(user, page);
            done();
        });
    });

    afterAll(async done => {
        await cluster.idle();
        await cluster.close();
        done();
    });

    test(
        'should enable sending email notification when incident is created, acknowledged, resolved or investigated',
        async done => {
            await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.DASHBOARD_URL);

                await page.waitForSelector('#projectSettings', {
                    visible: true,
                });
                await page.click('#projectSettings');
                await page.waitForSelector('#more');
                await page.click('#more');
                await page.waitForSelector('#email', { visible: true });
                await page.click('#email');

                await page.waitForSelector('#sendCreatedIncidentNotificationEmail', {
                    visible: true,
                });
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
            });
            done();
        },
        operationTimeOut
    );

    test(
        'should disable sending email notification when incident is created',
        async done => {
            await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.DASHBOARD_URL);

                await page.waitForSelector('#projectSettings', {
                    visible: true,
                });
                await page.click('#projectSettings');
                await page.waitForSelector('#more');
                await page.click('#more');
                await page.waitForSelector('#email', { visible: true });
                await page.click('#email');

                await page.waitForSelector('#sendCreatedIncidentNotificationEmail', {
                    visible: true,
                });
                await page.$eval('#sendCreatedIncidentNotificationEmail', elem =>
                    elem.click()
                );
                await page.click('#saveIncidentNotification');
                await page.waitForTimeout(2000);
                await page.waitForSelector('.ball-beat', { hidden: true });

                await page.reload({ waitUntil: 'networkidle0' });
                await page.waitForSelector('#sendCreatedIncidentNotificationEmail', {
                    visible: true,
                });
                let checkedState = await page.$eval(
                    '#sendCreatedIncidentNotificationEmail',
                    elem => elem.value
                );
                checkedState = utils.parseBoolean(checkedState);
                expect(checkedState).toBeFalsy();
            });
            done();
        },
        operationTimeOut
    );

    test(
        'should disable sending email notification when incident is acknowledged',
        async done => {
            await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.DASHBOARD_URL);

                await page.waitForSelector('#projectSettings', {
                    visible: true,
                });
                await page.click('#projectSettings');
                await page.waitForSelector('#more');
                await page.click('#more');
                await page.waitForSelector('#email', { visible: true });
                await page.click('#email');

                await page.waitForSelector(
                    '#sendAcknowledgedIncidentNotificationEmail',
                    {
                        visible: true,
                    }
                );
                await page.$eval('#sendAcknowledgedIncidentNotificationEmail', elem =>
                    elem.click()
                );
                await page.click('#saveIncidentNotification');
                await page.waitForTimeout(2000);
                await page.waitForSelector('.ball-beat', { hidden: true });

                await page.reload({ waitUntil: 'networkidle0' });
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
            });
            done();
        },
        operationTimeOut
    );

    test(
        'should disable sending email notification when incident is resolved',
        async done => {
            await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.DASHBOARD_URL);

                await page.waitForSelector('#projectSettings', {
                    visible: true,
                });
                await page.click('#projectSettings');
                await page.waitForSelector('#more');
                await page.click('#more');
                await page.waitForSelector('#email', { visible: true });
                await page.click('#email');

                await page.waitForSelector('#sendResolvedIncidentNotificationEmail', {
                    visible: true,
                });
                await page.$eval('#sendResolvedIncidentNotificationEmail', elem =>
                    elem.click()
                );
                await page.click('#saveIncidentNotification');
                await page.waitForTimeout(2000);
                await page.waitForSelector('.ball-beat', { hidden: true });

                await page.reload({ waitUntil: 'networkidle0' });
                await page.waitForSelector('#sendResolvedIncidentNotificationEmail', {
                    visible: true,
                });
                let checkedState = await page.$eval(
                    '#sendResolvedIncidentNotificationEmail',
                    elem => elem.value
                );
                checkedState = utils.parseBoolean(checkedState);
                expect(checkedState).toBeFalsy();
            });
            done();
        },
        operationTimeOut
    );

    test(
        'should disable sending email notification for investigation note',
        async done => {
            await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.DASHBOARD_URL);

                await page.waitForSelector('#projectSettings', {
                    visible: true,
                });
                await page.click('#projectSettings');
                await page.waitForSelector('#more');
                await page.click('#more');
                await page.waitForSelector('#email', { visible: true });
                await page.click('#email');

                await page.waitForSelector('#enableInvestigationNoteNotificationEmail', {
                    visible: true,
                });
                await page.$eval('#enableInvestigationNoteNotificationEmail', elem =>
                    elem.click()
                );
                await page.click('#saveIncidentNotification');
                await page.waitForTimeout(2000);
                await page.waitForSelector('.ball-beat', { hidden: true });

                await page.reload({ waitUntil: 'networkidle0' });
                await page.waitForSelector('#enableInvestigationNoteNotificationEmail', {
                    visible: true,
                });
                let checkedState = await page.$eval(
                    '#enableInvestigationNoteNotificationEmail',
                    elem => elem.value
                );
                checkedState = utils.parseBoolean(checkedState);
                expect(checkedState).toBeFalsy();
            });
            done();
        },
        operationTimeOut
    );

    test(
        'should enable enabling sms notification when incident is created, acknowledged, resolved or investigated',
        async done => {
            await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.DASHBOARD_URL);

                await page.waitForSelector('#projectSettings', {
                    visible: true,
                });
                await page.click('#projectSettings');
                await page.waitForSelector('#more');    
                await page.click('#more');
                await page.waitForSelector('#smsCalls', { visible: true });
                await page.click('#smsCalls');
               

                await page.waitForSelector('#sendCreatedIncidentNotificationSms', {
                    visible: true,
                });
                let enableCreatedIncidentNotification = await page.$eval(
                    '#sendCreatedIncidentNotificationSms',
                    elem => elem.value
                );
                let enableAcknowledgedIncidentNotification = await page.$eval(
                    '#sendAcknowledgedIncidentNotificationSms',
                    elem => elem.value
                );
                let enableResolvedIncidentNotification = await page.$eval(
                    '#sendResolvedIncidentNotificationSms',
                    elem => elem.value
                );
                let enableInvestigationNoteNotification = await page.$eval(
                    '#enableInvestigationNoteNotificationSMS',
                    elem => elem.value
                );
                enableCreatedIncidentNotification = utils.parseBoolean(
                    enableCreatedIncidentNotification
                );
                enableAcknowledgedIncidentNotification = utils.parseBoolean(
                    enableAcknowledgedIncidentNotification
                );
                enableResolvedIncidentNotification = utils.parseBoolean(
                    enableResolvedIncidentNotification
                );
                enableInvestigationNoteNotification = utils.parseBoolean(
                    enableInvestigationNoteNotification
                );
                expect(enableCreatedIncidentNotification).toBeTruthy();
                expect(enableAcknowledgedIncidentNotification).toBeTruthy();
                expect(enableResolvedIncidentNotification).toBeTruthy();
                expect(enableInvestigationNoteNotification).toBeTruthy();
            });
            done();
        },
        operationTimeOut
    );

    test(
        'should disable enabling sms notification when incident is created',
        async done => {
            await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.DASHBOARD_URL);

                await page.waitForSelector('#projectSettings', {
                    visible: true,
                });
                await page.click('#projectSettings');
                await page.waitForSelector('#more');    
                await page.click('#more');
                await page.waitForSelector('#smsCalls', { visible: true });
                await page.click('#smsCalls');

                await page.waitForSelector('#sendCreatedIncidentNotificationSms', {
                    visible: true,
                });
                await page.$eval('#sendCreatedIncidentNotificationSms', elem =>
                    elem.click()
                );
                await page.click('#saveIncidentNotification');
                await page.waitForTimeout(2000);
                await page.waitForSelector('.ball-beat', { hidden: true });

                await page.reload({ waitUntil: 'networkidle0' });
                await page.waitForSelector('#sendCreatedIncidentNotificationSms', {
                    visible: true,
                });
                let checkedState = await page.$eval(
                    '#sendCreatedIncidentNotificationSms',
                    elem => elem.value
                );
                checkedState = utils.parseBoolean(checkedState);
                expect(checkedState).toBeFalsy();
            });
            done();
        },
        operationTimeOut
    );

    test(
        'should disable enabling sms notification when incident is acknowledged',
        async done => {
            await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.DASHBOARD_URL);

                await page.waitForSelector('#projectSettings', {
                    visible: true,
                });
                await page.click('#projectSettings');
                await page.waitForSelector('#more');    
                await page.click('#more');
                await page.waitForSelector('#smsCalls', { visible: true });
                await page.click('#smsCalls');
                await page.waitForSelector(
                    '#sendAcknowledgedIncidentNotificationSms',
                    {
                        visible: true,
                    }
                );
                await page.$eval('#sendAcknowledgedIncidentNotificationSms', elem =>
                    elem.click()
                );
                await page.click('#saveIncidentNotification');
                await page.waitForTimeout(2000);
                await page.waitForSelector('.ball-beat', { hidden: true });

                await page.reload({ waitUntil: 'networkidle0' });
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
            });
            done();
        },
        operationTimeOut
    );

    test(
        'should disable enabling sms notification when incident is resolved',
        async done => {
            await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.DASHBOARD_URL);

                await page.waitForSelector('#projectSettings', {
                    visible: true,
                });
                await page.click('#projectSettings');
                await page.waitForSelector('#more');
                await page.click('#more')
                await page.waitForSelector('#smsCalls', { visible: true });
                await page.click('#smsCalls');
                await page.waitForSelector('#more');    
                await page.click('#more');
                await page.waitForSelector('#sendResolvedIncidentNotificationSms', {
                    visible: true,
                });
                await page.$eval('#sendResolvedIncidentNotificationSms', elem =>
                    elem.click()
                );
                await page.click('#saveIncidentNotification');
                await page.waitForTimeout(2000);
                await page.waitForSelector('.ball-beat', { hidden: true });

                await page.reload({ waitUntil: 'networkidle0' });
                await page.waitForSelector('#sendResolvedIncidentNotificationSms', {
                    visible: true,
                });
                let checkedState = await page.$eval(
                    '#sendResolvedIncidentNotificationSms',
                    elem => elem.value
                );
                checkedState = utils.parseBoolean(checkedState);
                expect(checkedState).toBeFalsy();
            });
            done();
        },
        operationTimeOut
    );
    test(
        'should disable enabling sms notification for investigation note',
        async done => {
            await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.DASHBOARD_URL);

                await page.waitForSelector('#projectSettings', {
                    visible: true,
                });
                await page.click('#projectSettings');
                await page.waitForSelector('#more');
                await page.click('#more');
                await page.waitForSelector('#smsCalls', { visible: true });
                await page.click('#smsCalls');

                await page.waitForSelector('#enableInvestigationNoteNotificationSMS', {
                    visible: true,
                });
                await page.$eval('#enableInvestigationNoteNotificationSMS', elem =>
                    elem.click()
                );
                await page.click('#saveIncidentNotification');
                await page.waitForTimeout(2000);
                await page.waitForSelector('.ball-beat', { hidden: true });

                await page.reload({ waitUntil: 'networkidle0' });
                await page.waitForSelector('#enableInvestigationNoteNotificationSMS', {
                    visible: true,
                });
                let checkedState = await page.$eval(
                    '#enableInvestigationNoteNotificationSMS',
                    elem => elem.value
                );
                checkedState = utils.parseBoolean(checkedState);
                expect(checkedState).toBeFalsy();
            });
            done();
        },
        operationTimeOut
    );
});
