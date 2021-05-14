const puppeteer = require('puppeteer');
const utils = require('../../test-utils');
const init = require('../../test-init');

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
    const operationTimeOut = init.timeout;

    beforeAll(async done => {
        jest.setTimeout(init.timeout);

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
        'should configure monitor custom field in a project',
        async done => {
            await init.addCustomField(page, monitorFieldText, 'monitor');

            const firstCustomField = await page.waitForSelector(
                `#customfield_${monitorFieldText.fieldName}`,
                { visible: true, timeout: init.timeout }
            );
            expect(firstCustomField).toBeDefined();
            done();
        },
        operationTimeOut
    );

    test(
        'should update a monitor custom field in a project',
        async done => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });
            await page.waitForSelector('#projectSettings', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageClick(page, '#projectSettings');
            await page.waitForSelector('#more', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageClick(page, '#more');
            await page.waitForSelector('#monitor', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageClick(page, '#monitor');
            await page.reload({
                waitUntil: 'networkidle2',
            });
            await init.gotoTab(2, page);

            await page.waitForSelector('#editCustomField_0', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageClick(page, '#editCustomField_0');
            await page.waitForSelector('#customFieldForm', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageClick(page, '#fieldName', { clickCount: 3 });
            await init.pageType(
                page,
                '#fieldName',
                monitorFieldNumber.fieldName
            );
            await init.selectByText(
                '#fieldType',
                monitorFieldNumber.fieldType,
                page
            );
            await init.pageClick(page, '#updateCustomField');
            await page.waitForSelector('#updateCustomField', {
                hidden: true,
            });

            const updatedField = await page.waitForSelector(
                `#customfield_${monitorFieldNumber.fieldName}`,
                { visible: true, timeout: init.timeout }
            );
            expect(updatedField).toBeDefined();
            done();
        },
        operationTimeOut
    );

    test(
        'should delete a monitor custom field in a project',
        async done => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });
            await page.waitForSelector('#projectSettings', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageClick(page, '#projectSettings');
            await page.waitForSelector('#more', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageClick(page, '#more');
            await page.waitForSelector('#monitor', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageClick(page, '#monitor');
            await page.reload({
                waitUntil: 'networkidle2',
            });
            await init.gotoTab(2, page);

            await page.waitForSelector('#deleteCustomField_0', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageClick(page, '#deleteCustomField_0');
            await page.waitForSelector('#deleteCustomFieldModalBtn', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageClick(page, '#deleteCustomFieldModalBtn');
            await page.waitForSelector('#deleteCustomFieldModalBtn', {
                hidden: true,
            });

            const noCustomFields = await page.waitForSelector(
                '#noCustomFields',
                { visible: true, timeout: init.timeout }
            );
            expect(noCustomFields).toBeDefined();
            done();
        },
        operationTimeOut
    );
});
