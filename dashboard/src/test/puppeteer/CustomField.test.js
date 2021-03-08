const puppeteer = require('puppeteer');
const utils = require('./test-utils');
const init = require('./test-init');
const { Cluster } = require('puppeteer-cluster');

require('should');

// user credentials
const email = utils.generateRandomBusinessEmail();
const password = '1234567890';
const incidentFieldText = {
        fieldName: 'textField',
        fieldType: 'text',
    },
    incidentFieldNumber = {
        fieldName: 'numField',
        fieldType: 'number',
    };

describe('Incident Custom Field', () => {
    const operationTimeOut = 500000;

    let cluster;
    beforeAll(async done => {
        jest.setTimeout(360000);

        cluster = await Cluster.launch({
            concurrency: Cluster.CONCURRENCY_PAGE,
            puppeteerOptions: utils.puppeteerLaunchConfig,
            puppeteer,
            timeout: 500000,
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
        });

        done();
    });

    afterAll(async done => {
        await cluster.idle();
        await cluster.close();
        done();
    });

    test(
        'should configure incident custom field in a project',
        async done => {
            await cluster.execute(null, async ({ page }) => {
                await init.addCustomField(page, incidentFieldText, 'incident');

                const firstCustomField = await page.waitForSelector(
                    `#customfield_${incidentFieldText.fieldName}`,
                    { visible: true }
                );
                expect(firstCustomField).toBeDefined();
            });
            done();
        },
        operationTimeOut
    );

    test(
        'should update a incident custom field in a project',
        async done => {
            await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.DASHBOARD_URL);
                await page.waitForSelector('#projectSettings', {
                    visible: true,
                });
                await page.click('#projectSettings');
                await page.waitForSelector('#more');
                await page.click('#more');
                await page.waitForSelector('#incidentSettings', {
                    visible: true,
                });
                await page.click('#incidentSettings');
                await page.reload({
                    waitUntil: 'networkidle0',
                });
                await init.gotoTab(6, page);

                await page.waitForSelector('#editCustomField_0', {
                    visible: true,
                });
                await page.click('#editCustomField_0');
                await page.waitForSelector('#customFieldForm', {
                    visible: true,
                });
                await page.click('#fieldName', { clickCount: 3 });
                await page.type('#fieldName', incidentFieldNumber.fieldName);
                await init.selectByText(
                    '#fieldType',
                    incidentFieldNumber.fieldType,
                    page
                );
                await page.click('#updateCustomField');
                await page.waitForSelector('#updateCustomField', {
                    hidden: true,
                });

                const updatedField = await page.waitForSelector(
                    `#customfield_${incidentFieldNumber.fieldName}`,
                    { visible: true }
                );
                expect(updatedField).toBeDefined();
            });
            done();
        },
        operationTimeOut
    );

    test(
        'should delete a incident custom field in a project',
        async done => {
            await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.DASHBOARD_URL);
                await page.waitForSelector('#projectSettings', {
                    visible: true,
                });
                await page.click('#projectSettings');
                await page.waitForSelector('#more');
                await page.click('#more');
                await page.waitForSelector('#incidentSettings', {
                    visible: true,
                });
                await page.click('#incidentSettings');
                await page.reload({
                    waitUntil: 'networkidle0',
                });
                await init.gotoTab(6, page);

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
            });
            done();
        },
        operationTimeOut
    );
});
