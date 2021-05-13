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
const incidentRequest = {
    name: 'pyInt',
    incidentTitle: 'Test Incident',
    incidentType: 'offline',
    incidentDescription:
        'This is a sample incident to test incoming http request',
};

describe('Incoming HTTP Request', () => {
    const operationTimeOut = 500000;

    beforeAll(async done => {
        jest.setTimeout(3init.timeout);

        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/61.0.3163.100 Safari/537.36'
        );
        // user
        await init.registerUser(user, page);

        done();
    });

    afterAll(async done => {
        await browser.close();
        done();
    });

    test(
        'should configure incoming http request to create incident in a project',
        async done => {
            await page.goto(utils.DASHBOARD_URL, {
            waitUntil: ['networkidle2'],
        });
            await page.waitForSelector('#projectSettings', {
                visible: true,
            });
            await init.pageClick(page, '#projectSettings');
            await page.waitForSelector('#integrations', { visible: true });
            await init.pageClick(page, '#integrations');

            await page.waitForSelector('#addIncomingRequestBtn', {
                visible: true,
            });
            await init.pageClick(page, '#addIncomingRequestBtn');
            await page.waitForSelector('#name', { visible: true });
            await init.pageClick(page, '#name');
            await init.pageType(page, '#name', incidentRequest.name);
            await page.$eval('#createIncident', elem => elem.click());
            await page.waitForSelector('#isDefault', { visible: true });
            await page.$eval('#isDefault', elem => elem.click());
            await init.pageClick(page, '#advancedOptionsBtn');
            await page.waitForSelector('#incidentTitle', { visible: true });
            await init.pageClick(page, '#incidentTitle');
            await init.pageType(
                page,
                '#incidentTitle',
                incidentRequest.incidentTitle
            );
            await init.pageClick(page, '#incidentDescription');
            await init.pageType(
                page,
                '#incidentDescription',
                incidentRequest.incidentDescription
            );

            await init.pageClick(page, '#createIncomingRequest');
            await page.waitForSelector('#createIncomingRequest', {
                hidden: true,
            });
            await page.waitForSelector('#requestOkBtn', { visible: true });
            await init.pageClick(page, '#requestOkBtn');
            await page.waitForSelector('#requestOkBtn', { hidden: true });

            const firstIncomingHttpRequest = await page.waitForSelector(
                '#copyIncomingRequestBtn_0',
                { visible: true }
            );
            expect(firstIncomingHttpRequest).toBeDefined();

            done();
        },
        operationTimeOut
    );

    test(
        'should update an incoming http request in a project',
        async done => {
            await page.goto(utils.DASHBOARD_URL, {
            waitUntil: ['networkidle2'],
        });
            await page.waitForSelector('#projectSettings', {
                visible: true,
            });
            await init.pageClick(page, '#projectSettings');
            await page.waitForSelector('#integrations', { visible: true });
            await init.pageClick(page, '#integrations');

            await page.waitForSelector('#editIncomingRequestBtn_0', {
                visible: true,
            });
            await init.pageClick(page, '#editIncomingRequestBtn_0');
            await page.waitForSelector('#name', { visible: true });
            await init.pageClick(page, '#name', { clickCount: 3 });
            // change the name of the incoming http request
            await init.pageType(page, '#name', 'newName');
            await init.pageClick(page, '#editIncomingRequest');
            await page.waitForSelector('#editIncomingRequest', {
                hidden: true,
            });

            const updatedRequest = await page.waitForSelector(
                '#incomingRequest_newName',
                { visible: true }
            );
            expect(updatedRequest).toBeDefined();
            done();
        },
        operationTimeOut
    );

    test(
        'should delete an incoming http request in a project',
        async done => {
            await page.goto(utils.DASHBOARD_URL, {
            waitUntil: ['networkidle2'],
        });
            await page.waitForSelector('#projectSettings', {
                visible: true,
            });
            await init.pageClick(page, '#projectSettings');
            await page.waitForSelector('#integrations', { visible: true });
            await init.pageClick(page, '#integrations');

            await page.waitForSelector('#deleteIncomingRequestBtn_0', {
                visible: true,
            });
            await init.pageClick(page, '#deleteIncomingRequestBtn_0');
            await page.waitForSelector('#deleteIncomingRequestBtn', {
                visible: true,
            });
            await init.pageClick(page, '#deleteIncomingRequestBtn');
            await page.waitForSelector('#deleteIncomingRequestBtn', {
                hidden: true,
            });

            const noIncomingRequest = await page.waitForSelector(
                '#noIncomingRequest',
                { visible: true }
            );
            expect(noIncomingRequest).toBeDefined();
            done();
        },
        operationTimeOut
    );
});
