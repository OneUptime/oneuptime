const puppeteer = require('puppeteer');
const utils = require('./test-utils');
const init = require('./test-init');
const { Cluster } = require('puppeteer-cluster');

require('should');

// user credentials
const email = utils.generateRandomBusinessEmail();
const password = '1234567890';

describe('Audit Logs', () => {
    const operationTimeOut = 1000000;

    let cluster;

    beforeAll(async (done) => {
        jest.setTimeout(2000000);

        cluster = await Cluster.launch({
            concurrency: Cluster.CONCURRENCY_PAGE,
            puppeteerOptions: utils.puppeteerLaunchConfig,
            puppeteer,
            timeout: 1200000,
            env: {
                REACT_APP_IS_SAAS_SERVICE: true
            }
        });

        cluster.on('taskerror', err => {
            throw err;
        });

        await cluster.execute({ email, password }, async ({ page, data }) => {
            const user = {
                email: data.email,
                password: data.password,
            };
            await init.registerUser(user, page);
            await init.loginUser(user, page);
            done();
        });
    });

    afterAll(async (done) => {
        await cluster.idle();
        await cluster.close();
        done();
    });

    test(
        'Should show a warning alert if call and sms alerts are disabled',
        async () => {
            await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.DASHBOARD_URL);
                await page.waitForSelector('#projectSettings');
                await page.click('#projectSettings');
                await page.waitForSelector('#billing');
                await page.click('#billing a');
                await page.waitForSelector('#alertEnable');

                const rowLength = await page.$$eval(
                    '#alertOptionRow > div.bs-Fieldset-row',
                    rows => rows.length
                );
                if (rowLength === 1) {
                    // enable sms and call alerts
                    await page.evaluate(() => {
                        document.querySelector('#alertEnable').click();
                        document.querySelector('#alertOptionSave').click();
                    })
                }
                let element = await page.waitForSelector('#alertWarning');
                expect(element).not.toBe(null);
            });
        },
        operationTimeOut
    );

    test(
        'Should not show any warning alert if call and sms alerts are enabled',
        async () => {
            await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.DASHBOARD_URL);
                await page.waitForSelector('#projectSettings');
                await page.click('#projectSettings');
                await page.waitForSelector('#billing');
                await page.click('#billing a');
                await page.waitForSelector('#alertEnable');

                const rowLength = await page.$$eval(
                    '#alertOptionRow > div.bs-Fieldset-row',
                    rows => rows.length
                );

                if (rowLength === 1) {
                    // enable sms and call alerts
                    await page.evaluate(() => {
                        document.querySelector('#alertEnable').click();
                        document.querySelector('#alertOptionSave').click();
                    })
                }

                const newRowLength = await page.$$eval(
                    '#alertOptionRow > div.bs-Fieldset-row',
                    rows => rows.length
                );

                if (newRowLength > 1) {
                    // disable sms and call alerts
                    await page.evaluate(() => {
                        document.querySelector('#alertEnable').click();
                        document.querySelector('#alertOptionSave').click();
                    })
                }

                let element = await page.$('#alertWarning');
                expect(element).toBeNull();
            });
        },
        operationTimeOut
    );
});
