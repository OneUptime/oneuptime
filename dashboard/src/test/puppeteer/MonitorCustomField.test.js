const puppeteer = require('puppeteer');
const utils = require('./test-utils');
const init = require('./test-init');

require('should');
let browser, page;
// user credentials
const email = utils.generateRandomBusinessEmail();
const password = '1234567890';
const monitorFieldText = {
        fieldName: 'textField',
        fieldType: 'text',
    },
    monitorFieldNumber = {
        fieldName: 'numField',
        fieldType: 'number',
    };
const user = {
    email,
    password,
};

describe('Monitor Custom Field', () => {
    const operationTimeOut = 500000;

    beforeAll(async done => {
        jest.setTimeout(360000);

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
        'should configure monitor custom field in a project',
        async done => {
            await init.addCustomField(page, monitorFieldText, 'monitor');

            const firstCustomField = await page.waitForSelector(
                `#customfield_${monitorFieldText.fieldName}`,
                { visible: true }
            );
            expect(firstCustomField).toBeDefined();
            done();
        },
        operationTimeOut
    );

    test(
        'should update a monitor custom field in a project',
        async done => {
            await page.goto(utils.DASHBOARD_URL);
            await page.waitForSelector('#projectSettings', {
                visible: true,
            });
            await page.click('#projectSettings');
            await page.waitForSelector('#more', { visible: true });
            await page.click('#more');
            await page.waitForSelector('#monitor', { visible: true });
            await page.click('#monitor');
            await page.reload({
                waitUntil: 'networkidle0',
            });
            await init.gotoTab(2, page);

            await page.waitForSelector('#editCustomField_0', {
                visible: true,
            });
            await page.click('#editCustomField_0');
            await page.waitForSelector('#customFieldForm', {
                visible: true,
            });
            await page.click('#fieldName', { clickCount: 3 });
            await page.type('#fieldName', monitorFieldNumber.fieldName);
            await init.selectByText(
                '#fieldType',
                monitorFieldNumber.fieldType,
                page
            );
            await page.click('#updateCustomField');
            await page.waitForSelector('#updateCustomField', {
                hidden: true,
            });

            const updatedField = await page.waitForSelector(
                `#customfield_${monitorFieldNumber.fieldName}`,
                { visible: true }
            );
            expect(updatedField).toBeDefined();
            done();
        },
        operationTimeOut
    );

    test(
        'should delete a monitor custom field in a project',
        async done => {
            await page.goto(utils.DASHBOARD_URL);
            await page.waitForSelector('#projectSettings', {
                visible: true,
            });
            await page.click('#projectSettings');
            await page.waitForSelector('#more', { visible: true });
            await page.click('#more');
            await page.waitForSelector('#monitor', { visible: true });
            await page.click('#monitor');
            await page.reload({
                waitUntil: 'networkidle0',
            });
            await init.gotoTab(2, page);

            await page.waitForSelector('#deleteCustomField_0', {
                visible: true,
            });
            await page.click('#deleteCustomField_0');
            await page.waitForSelector('#deleteCustomFieldModalBtn', {
                visible: true,
            });
            await page.click('#deleteCustomFieldModalBtn');
            await page.waitForSelector('#deleteCustomFieldModalBtn', {
                hidden: true,
            });

            const noCustomFields = await page.waitForSelector(
                '#noCustomFields',
                { visible: true }
            );
            expect(noCustomFields).toBeDefined();
            done();
        },
        operationTimeOut
    );
});
