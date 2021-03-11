const puppeteer = require('puppeteer');
const utils = require('./test-utils');
const init = require('./test-init');
const { Cluster } = require('puppeteer-cluster');

require('should');

// user credentials
const email = utils.generateRandomBusinessEmail();
const password = '1234567890';

describe('Status Page -> Pricing Plan Component', () => {
    const operationTimeOut = 500000;

    let cluster;
    beforeAll(async () => {
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
    });

    afterAll(async done => {
        await cluster.idle();
        await cluster.close();
        done();
    });

    test(
        'should show upgrade modal if project is not available in a particular plan',
        async () => {
            await cluster.execute(null, async ({ page }) => {
                await init.addProject(page, 'test');
                await page.$eval('#statusPages', elem => elem.click());
                await page.waitForSelector('#btnCreateStatusPage_test');
                await page.click('#btnCreateStatusPage_test');
                await page.waitForSelector('#name');
                await page.click('#name');
                await page.type('#name', 'test');
                await page.click('#btnCreateStatusPage');
                // select the first item from the table row
                const rowItem = await page.waitForSelector(
                    '#statusPagesListContainer > tr',
                    { visible: true }
                );
                rowItem.click();
                await page.waitForSelector('ul#customTabList > li', {
                    visible: true,
                });
                await page.$$eval('ul#customTabList > li', elems =>
                    elems[4].click() // Advanced Option is now in a new tab position.
                );
                await page.$eval('input[name="isPrivate"]', elem =>
                    elem.click()
                );
                const modal = await page.waitForSelector('#pricingPlanModal', {
                    visible: true,
                });
                expect(modal).toBeDefined();
            });
        },
        operationTimeOut
    );

    /**
     * Commented the code below because it was testing for enterprise plan, which is not available for now
     * Will rewrite it once a component which needs an enterprise plan is created
     */

    // test(
    //     'should show upgrade modal if plan is Enterprise and Project is not on Enterprise plan',
    //     async () => {
    //         await cluster.execute(null, async ({ page }) => {
    //             await page.goto(utils.DASHBOARD_URL);
    //             await page.$eval('#statusPages', elem => elem.click());
    //             // select the first item from the table row
    //             const rowItem = await page.waitForSelector(
    //                 '#statusPagesListContainer > tr',
    //                 { visible: true }
    //             );
    //             rowItem.click();
    //             await page.waitForSelector('ul#customTabList > li', {
    //                 visible: true,
    //             });
    //             await page.$$eval('ul#customTabList > li', elems =>
    //                 elems[3].click()
    //             );
    //             await page.$eval('input[name="isSubscriberEnabled"]', elem =>
    //                 elem.click()
    //             );

    //             const modal = await page.waitForSelector('#pricingPlanModal', {
    //                 visible: true,
    //             });
    //             const emailBtn = await page.waitForSelector('#enterpriseMail');

    //             expect(modal).toBeDefined();
    //             expect(emailBtn).toBeDefined();
    //         });
    //     },
    //     operationTimeOut
    // );

    test(
        'should not show upgrade modal if project is subscribed to a particular plan',
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
                    // check the box
                    await page.evaluate(() => {
                        document.querySelector('#alertEnable').click();
                    });
                }

                await page.evaluate(() => {
                    document.querySelector('#billingRiskCountries').click();
                });
                const elem = await page.waitForSelector('#pricingPlanModal', {
                    hidden: true,
                });
                expect(elem).toBeNull();
            });
        },
        operationTimeOut
    );

    test(
        'should not upgrade a project when cancel button is clicked',
        async () => {
            await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.DASHBOARD_URL);
                await page.$eval('#statusPages', elem => elem.click());
                // select the first item from the table row
                const rowItem = await page.waitForSelector(
                    '#statusPagesListContainer > tr',
                    { visible: true }
                );
                rowItem.click();
                await page.waitForSelector('ul#customTabList > li', {
                    visible: true,
                });
                await page.$$eval('ul#customTabList > li', elems =>
                    elems[4].click()
                );
                await page.$eval('input[name="isPrivate"]', elem =>
                    elem.click()
                );

                await page.waitForSelector('#pricingPlanModal', {
                    visible: true,
                });
                const growthOption = await page.waitForSelector(
                    'label[for=Growth_month]',
                    { visible: true }
                );
                growthOption.click();
                await page.click('#cancelPlanUpgrade');
                const elem = await page.waitForSelector('#pricingPlanModal', {
                    hidden: true,
                });
                expect(elem).toBeNull();
            });
        },
        operationTimeOut
    );

    test(
        'should upgrade a plan when upgrade is triggered from pricing plan component',
        async () => {
            await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.DASHBOARD_URL);
                await page.$eval('#statusPages', elem => elem.click());
                // select the first item from the table row
                const rowItem = await page.waitForSelector(
                    '#statusPagesListContainer > tr',
                    { visible: true }
                );
                rowItem.click();
                await page.waitForSelector('ul#customTabList > li', {
                    visible: true,
                });
                await page.$$eval('ul#customTabList > li', elems =>
                    elems[4].click()
                );
                await page.$eval('input[name="isPrivate"]', elem =>
                    elem.click()
                );

                await page.waitForSelector('#pricingPlanModal', {
                    visible: true,
                });
                const growthOption = await page.waitForSelector(
                    'label[for=Growth_month]',
                    { visible: true }
                );
                growthOption.click();
                await page.click('#confirmPlanUpgrade');

                await page.waitForSelector('#pricingPlanModal', {
                    hidden: true,
                });
                await page.reload({ waitUntil: 'networkidle2' });
                await page.$$eval('ul#customTabList > li', elems =>
                    elems[4].click()
                );

                await page.$eval('input[name="isPrivate"]', elem =>
                    elem.click()
                );
                const value = await page.$eval(
                    'input[name="isPrivate"]',
                    elem => elem.value
                );
                expect(utils.parseBoolean(value)).toBe(true);
            });
        },
        operationTimeOut
    );
});
