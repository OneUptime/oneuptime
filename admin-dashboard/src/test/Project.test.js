const puppeteer = require('puppeteer');
const utils = require('./test-utils');
const init = require('./test-init');
const { Cluster } = require('puppeteer-cluster');

require('should');

// user credentials
const email = 'masteradmin@hackerbay.io';
const password = '1234567890';

describe('Project', () => {
    const operationTimeOut = 1000000;

    let cluster;

    beforeAll(async () => {
        jest.setTimeout(2000000);

        cluster = await Cluster.launch({
            concurrency: Cluster.CONCURRENCY_PAGE,
            puppeteerOptions: utils.puppeteerLaunchConfig,
            puppeteer,
            timeout: 1200000,
        });

        cluster.on('taskerror', err => {
            throw err;
        });

        await cluster.execute({ email, password }, async ({ page, data }) => {
            const email = utils.generateRandomBusinessEmail();
            const password = '1234567890';

            const user = {
                email: data.email,
                password: data.password,
            };
            await init.registerEnterpriseUser(user, page);

            // creating a user automatically
            // adds an unamed project to the user
            await init.registerUser({ email, password }, page);
        });
    });

    afterAll(async () => {
        await cluster.idle();
        await cluster.close();
    });

    test(
        'should upgrade a project to enterprise plan',
        async () => {
            await cluster.execute(
                { email, password },
                async ({ page, data }) => {
                    const user = {
                        email: data.email,
                        password: data.password,
                    };
                    await init.loginUser(user, page);

                    await page.$eval('#projects > a', elem => elem.click());
                    await page.evaluate(() => {
                        let elem = document.querySelectorAll(
                            '.Table > tbody tr'
                        );
                        elem = Array.from(elem);
                        elem[0].click();
                    });

                    await page.waitForSelector(
                        'input[name="planId"]#Enterprise',
                        { visible: true }
                    );

                    await page.$eval('input[name="planId"]#Enterprise', elem =>
                        elem.click()
                    );
                    await page.$eval('#submitChangePlan', elem => elem.click());

                    let loader = await page.waitForSelector('.ball-beat', {
                        hidden: true,
                    });

                    await page.reload({ waitUntil: 'networkidle0' });

                    const checked = await page.$eval(
                        'input[name="planId"]#Enterprise',
                        elem => elem.checked
                    );

                    expect(loader).toBeNull();
                    expect(checked).toEqual(true);
                }
            );
        },
        operationTimeOut
    );

    test(
        'should change to any other plan',
        async () => {
            await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.ADMIN_DASHBOARD_URL);
                await page.$eval('#projects > a', elem => elem.click());
                await page.evaluate(() => {
                    let elem = document.querySelectorAll('.Table > tbody tr');
                    elem = Array.from(elem);
                    elem[0].click();
                });

                await page.waitForSelector(
                    'input[name="planId"]#Growth_annual',
                    { visible: true }
                );

                await page.$eval('input[name="planId"]#Growth_annual', elem =>
                    elem.click()
                );
                await page.$eval('#submitChangePlan', elem => elem.click());

                let loader = await page.waitForSelector('.ball-beat', {
                    hidden: true,
                });

                await page.reload({ waitUntil: 'networkidle0' });

                const checked = await page.$eval(
                    'input[name="planId"]#Growth_annual',
                    elem => elem.checked
                );

                expect(loader).toBeNull();
                expect(checked).toEqual(true);
            });
        },
        operationTimeOut
    );
});
