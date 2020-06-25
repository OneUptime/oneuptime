const puppeteer = require('puppeteer');
const utils = require('./test-utils');
const init = require('./test-init');
const { Cluster } = require('puppeteer-cluster');

require('should');

// user credentials
const email = utils.generateRandomBusinessEmail();
const password = '1234567890';
const componentName = 'hackerbay';
const monitorName = 'fyipe.com';
const monitorName1 = 'test.fyipe.com';

const gotoTheFirstStatusPage = async page => {
    await page.goto(utils.DASHBOARD_URL);
    await page.$eval('#statusPages > a', elem => elem.click());
    const rowItem = await page.waitForSelector(
        '#statusPagesListContainer > tr',
        { visible: true }
    );
    rowItem.click();
};

describe('Status Page', () => {
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

        return await cluster.execute(
            { email, password },
            async ({ page, data }) => {
                const user = {
                    email: data.email,
                    password: data.password,
                };

                // user
                await init.registerUser(user, page);
                await init.loginUser(user, page);

                //project + status page
                await init.addProject(page);
                await init.addStatusPageToProject('test', 'test', page);

                //component + monitor
                await init.addComponent(componentName, page);
                await init.addMonitorToComponent(null, monitorName, page);
                await init.addMonitorToComponent(null, monitorName1, page);
                await page.waitForSelector('.ball-beat', { hidden: true });
            }
        );
    });

    afterAll(async done => {
        await cluster.idle();
        await cluster.close();
        done();
    });

    test(
        'should indicate that no monitor is set yet for a status page',
        async () => {
            return await cluster.execute(null, async ({ page }) => {
                await gotoTheFirstStatusPage(page);
                const elem = await page.waitForSelector('#app-loading', {
                    visible: true,
                });
                expect(elem).toBeTruthy();
                const element = await page.$eval('#app-loading', e => {
                    return e.innerHTML;
                });
                expect(element).toContain(
                    'No monitors are added to this status page.'
                );
            });
        },
        operationTimeOut
    );

    test(
        'should show error message if no chart is selected.',
        async () => {
            return await cluster.execute(null, async ({ page }) => {
                await gotoTheFirstStatusPage(page);
                await page.waitForSelector('#addMoreMonitors');
                await page.click('#addMoreMonitors');
                await page.waitForSelector('#monitor-0');
                await init.selectByText(
                    '#monitor-0 .db-select-nw',
                    `${componentName} / ${monitorName}`,
                    page
                );
                await page.click('#monitor-0 .Checkbox');
                await page.waitForSelector('#monitor-0 .errors', {
                    visible: true,
                });
                const element = await page.$eval('#monitor-0 .errors', e => {
                    return e.innerHTML;
                });
                expect(element).toContain(
                    'You must select at least one bar chart'
                );
            });
        },
        operationTimeOut
    );

    test(
        'should add a new monitor.',
        async () => {
            return await cluster.execute(null, async ({ page }) => {
                await gotoTheFirstStatusPage(page);
                await page.waitForSelector('#addMoreMonitors');
                await page.click('#addMoreMonitors');
                await page.waitForSelector('#monitor-0');
                await init.selectByText(
                    '#monitor-0 .db-select-nw',
                    `${componentName} / ${monitorName}`,
                    page
                );
                await page.click('#btnAddStatusPageMonitors');
                await page.waitFor(5000);
                await page.reload({ waitUntil: 'networkidle0' });
                const elem = await page.waitForSelector('#monitor-0', {
                    visible: true,
                });
                expect(elem).toBeTruthy();
            });
        },
        operationTimeOut
    );

    test(
        'should remove monitor.',
        async () => {
            return await cluster.execute(null, async ({ page }) => {
                await gotoTheFirstStatusPage(page);
                await page.waitForSelector('#monitor-0');
                await page.click('#delete-monitor-0');
                await page.click('#btnAddStatusPageMonitors');
                await page.waitFor(5000);
                await page.reload({ waitUntil: 'networkidle0' });
                const elem = await page.waitForSelector('#app-loading', {
                    visible: true,
                });
                expect(elem).toBeTruthy();
                const element = await page.$eval('#app-loading', e => {
                    return e.innerHTML;
                });
                expect(element).toContain(
                    'No monitors are added to this status page.'
                );
            });
        },
        operationTimeOut
    );

    test(
        'should add more than one monitor.',
        async () => {
            return await cluster.execute(null, async ({ page }) => {
                await gotoTheFirstStatusPage(page);
                await page.waitForSelector('#addMoreMonitors');
                await page.click('#addMoreMonitors');
                await page.waitForSelector('#monitor-0');
                await init.selectByText(
                    '#monitor-0 .db-select-nw',
                    `${componentName} / ${monitorName}`,
                    page
                );
                await page.click('#addMoreMonitors');
                await page.waitForSelector('#monitor-1');
                await init.selectByText(
                    '#monitor-1 .db-select-nw',
                    `${componentName} / ${monitorName1}`,
                    page
                );
                await page.click('#btnAddStatusPageMonitors');
                await page.waitFor(5000);
                await page.reload({ waitUntil: 'networkidle0' });
                const firstMonitorContainer = await page.waitForSelector(
                    '#monitor-0',
                    {
                        visible: true,
                    }
                );
                expect(firstMonitorContainer).toBeTruthy();
                const secondMonitorContainer = await page.waitForSelector(
                    '#monitor-1',
                    {
                        visible: true,
                    }
                );
                expect(secondMonitorContainer).toBeTruthy();
            });
        },
        operationTimeOut
    );

    test(
        'should indicate that no domain is set yet for a status page.',
        async () => {
            return await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.DASHBOARD_URL);
                await page.$eval('#statusPages > a', elem => elem.click());
                const elem = await page.waitForSelector('#domainNotSet', {
                    visible: true,
                });
                expect(elem).toBeTruthy();
            });
        },
        operationTimeOut
    );

    test(
        'should create a domain',
        async () => {
            return await cluster.execute(null, async ({ page }) => {
                await gotoTheFirstStatusPage(page);
                await page.waitForNavigation({ waitUntil: 'networkidle0' });
                await page.waitForSelector('#domain', { visible: true });
                await page.type('#domain', 'fyipeapp.com');
                await page.click('#btnAddDomain');
                // if domain was not added sucessfully, list will be undefined
                // it will timeout
                const list = await page.waitForSelector(
                    'fieldset[name="added-domain"]',
                    { visible: true }
                );
                expect(list).toBeTruthy();
            });
        },
        operationTimeOut
    );

    // This test comes after you must have created a domain
    test(
        'should indicate if domain(s) is set on a status page',
        async () => {
            return await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.DASHBOARD_URL);
                await page.$eval('#statusPages > a', elem => elem.click());

                const elem = await page.waitForSelector('#domainSet', {
                    visible: true,
                });
                expect(elem).toBeTruthy();
            });
        },
        operationTimeOut
    );

    test(
        'should update a domain',
        async () => {
            return await cluster.execute(null, async ({ page }) => {
                const finalValue = 'status.fyipeapp.com';

                await gotoTheFirstStatusPage(page);
                await page.waitForNavigation({ waitUntil: 'networkidle0' });
                const input = await page.$(
                    'fieldset[name="added-domain"] input[type="text"]'
                );
                await input.click({ clickCount: 3 });
                await input.type(finalValue);

                await page.click('#btnAddDomain');
                await page.reload({ waitUntil: 'networkidle0' });

                const finalInputValue = await page.$eval(
                    'fieldset[name="added-domain"] input[type="text"]',
                    domain => domain.value
                );

                expect(finalInputValue).toEqual(finalValue);
            });
        },
        operationTimeOut
    );

    test(
        'should not verify a domain when txt record does not match token',
        async () => {
            return await cluster.execute(null, async ({ page }) => {
                await gotoTheFirstStatusPage(page);
                await page.waitForNavigation({ waitUntil: 'networkidle0' });
                await page.waitForSelector('#btnVerifyDomain');
                await page.click('#btnVerifyDomain');

                await page.waitForSelector('#confirmVerifyDomain');
                await page.click('#confirmVerifyDomain');
                // element will be visible once the domain was not verified
                const elem = await page.waitForSelector('#verifyDomainError', {
                    visible: true,
                });
                expect(elem).toBeTruthy();
            });
        },
        operationTimeOut
    );

    test(
        'should not have option of deleting a domain, if there is only one domain in the status page',
        async () => {
            return await cluster.execute(null, async ({ page }) => {
                await page.reload({ waitUntil: 'networkidle0' });
                const elem = await page.$('.btnDeleteDomain');
                expect(elem).toBeNull();
            });
        },
        operationTimeOut
    );

    test(
        'should delete a domain in a status page',
        async () => {
            return await cluster.execute(null, async ({ page }) => {
                await gotoTheFirstStatusPage(page);
                await page.waitForNavigation({ waitUntil: 'networkidle0' });

                //Get the initial length of domains
                const initialLength = await page.$$eval(
                    'fieldset[name="added-domain"]',
                    domains => domains.length
                );

                // create one more domain on the status page
                await page.waitForSelector('#addMoreDomain');
                await page.click('#addMoreDomain');
                await page.waitForSelector('#domain', { visible: true });
                await page.type('#domain', 'app.fyipeapp.com');
                await page.click('#btnAddDomain');
                await page.reload({ waitUntil: 'networkidle0' });

                await page.$eval('.btnDeleteDomain', elem => elem.click());
                await page.$eval('#confirmDomainDelete', elem => elem.click());

                await page.reload({ waitUntil: 'networkidle0' });
                // get the final length of domains after deleting
                const finalLength = await page.$$eval(
                    'fieldset[name="added-domain"]',
                    domains => domains.length
                );

                expect(finalLength).toEqual(initialLength);
            });
        },
        operationTimeOut
    );

    test(
        'should cancel deleting of a domain in a status page',
        async () => {
            return await cluster.execute(null, async ({ page }) => {
                await gotoTheFirstStatusPage(page);
                await page.waitForNavigation({ waitUntil: 'networkidle0' });

                //Get the initial length of domains
                const initialLength = await page.$$eval(
                    'fieldset[name="added-domain"]',
                    domains => domains.length
                );

                // create one more domain on the status page
                await page.waitForSelector('#addMoreDomain');
                await page.click('#addMoreDomain');
                await page.waitForSelector('#domain', { visible: true });
                await page.type('#domain', 'app.fyipeapp.com');
                await page.click('#btnAddDomain');
                await page.reload({ waitUntil: 'networkidle0' });

                await page.$eval('.btnDeleteDomain', elem => elem.click());
                await page.$eval('#cancelDomainDelete', elem => elem.click());

                await page.reload({ waitUntil: 'networkidle0' });
                // get the final length of domains after cancelling
                const finalLength = await page.$$eval(
                    'fieldset[name="added-domain"]',
                    domains => domains.length
                );

                expect(finalLength).toBeGreaterThan(initialLength);
            });
        },
        operationTimeOut
    );

    test(
        'should create custom HTML and CSS',
        async () => {
            return await cluster.execute(null, async ({ page }) => {
                await gotoTheFirstStatusPage(page);

                await page.waitForNavigation({ waitUntil: 'load' });
                await page.type('#headerHTML textarea', '<div>My header'); // Ace editor completes the div tag
                await page.click('#btnAddCustomStyles');
                await page.waitFor(3000);

                let link = await page.$('#publicStatusPageUrl > span > a');
                link = await link.getProperty('href');
                link = await link.jsonValue();
                await page.goto(link);
                await page.waitForSelector('#customHeaderHTML > div');

                let spanElement = await page.$('#customHeaderHTML > div');
                spanElement = await spanElement.getProperty('innerText');
                spanElement = await spanElement.jsonValue();
                spanElement.should.be.exactly('My header');
            });
        },
        operationTimeOut
    );
});
