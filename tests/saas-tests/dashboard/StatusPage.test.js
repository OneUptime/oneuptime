const puppeteer = require('puppeteer');
const utils = require('../../test-utils');
const init = require('../../test-init');

require('should');

// user credentials
const email = utils.generateRandomBusinessEmail();
const password = '1234567890';
const componentName = 'hackerbay';
const monitorName = 'fyipe';
const monitorName1 = 'testFyipe';

let browser, page;
const gotoTheFirstStatusPage = async page => {
    await page.goto(utils.DASHBOARD_URL, {
        waitUntil: ['networkidle2'],
    });
    await init.pageWaitForSelector(page, '#statusPages');
    await page.$eval('#statusPages', e => e.click());
    const rowItem = await init.pageWaitForSelector(page, 
        '#statusPagesListContainer > tr',
        { visible: true, timeout: init.timeout }
    );
    rowItem.click();
};

describe('Status Page', () => {
    const operationTimeOut = init.timeout;

    beforeAll(async () => {
        jest.setTimeout(init.timeout);

        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(utils.agent);
        const user = {
            email,
            password,
        };

        // user
        await init.registerUser(user, page);
        // await init.loginUser(user, page);

        //project + status page
        await init.addProject(page);
        await init.addStatusPageToProject('test', 'test', page);

        //component + monitor
        await init.addComponent(componentName, page);
        await init.addNewMonitorToComponent(page, componentName, monitorName);
        // Creates the second monitor
        await init.addNewMonitorToComponent(page, componentName, monitorName1);
    });

    afterAll(async done => {
        await browser.close();
        done();
    });

    test(
        'should indicate that no monitor is set yet for a status page',
        async done => {
            await gotoTheFirstStatusPage(page);
            const elem = await init.pageWaitForSelector(page, '#app-loading', {
                visible: true,
                timeout: init.timeout,
            });
            expect(elem).toBeTruthy();
            const element = await page.$eval('#app-loading', e => {
                return e.innerHTML;
            });
            expect(element).toContain(
                'No monitors are added to this status page.'
            );
            done();
        },
        operationTimeOut
    );

    test(
        'should show error message and not submit the form if no monitor is selected and user clicks on save.',
        async done => {
            await gotoTheFirstStatusPage(page);
            await init.pageWaitForSelector(page, '#addMoreMonitors', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageClick(page, '#addMoreMonitors');
            await init.pageWaitForSelector(page, '#monitor-0');
            await init.pageClick(page, '#btnAddStatusPageMonitors');
            await init.pageWaitForSelector(page, '#monitor-0', {
                visible: true,
                timeout: init.timeout,
            });
            const textContent = await page.$eval(
                '#monitor-0',
                e => e.textContent
            );
            expect(textContent.includes('A monitor must be selected.')).toEqual(
                true
            );
            await page.reload({ waitUntil: 'networkidle2' });
            const monitor = await init.pageWaitForSelector(page, '#monitor-0', {
                hidden: true,
            });
            expect(monitor).toBeNull();
            done();
        },
        operationTimeOut
    );
    // Status-page monitor can now be saved without chart type
    test.skip(
        'should show error message and not submit the form if no chart is selected.',
        async done => {
            await gotoTheFirstStatusPage(page);
            await init.pageWaitForSelector(page, '#addMoreMonitors', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageClick(page, '#addMoreMonitors');
            await init.pageWaitForSelector(page, '#monitor-0');
            await init.selectByText(
                '#monitor-0 .db-select-nw',
                `${componentName} / ${monitorName}`,
                page
            );
            await init.pageClick(page, '#monitor-0 .Checkbox');
            await init.pageWaitForSelector(page, '#monitor-0 .errors', {
                visible: true,
                timeout: init.timeout,
            });
            const element = await page.$eval('#monitor-0 .errors', e => {
                return e.innerHTML;
            });
            expect(element).toContain(
                'You must select at least one chart type'
            );
            await init.pageClick(page, '#btnAddStatusPageMonitors');
            await page.reload({ waitUntil: 'networkidle2' });
            const monitor = await init.pageWaitForSelector(page, '#monitor-0', {
                hidden: true,
            });
            expect(monitor).toBeNull();
            done();
        },
        operationTimeOut
    );

    test(
        'should show an error message and not submit the form if the users select the same monitor twice.',
        async done => {
            await gotoTheFirstStatusPage(page);
            await init.pageWaitForSelector(page, '#addMoreMonitors', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageClick(page, '#addMoreMonitors');
            await init.pageWaitForSelector(page, '#monitor-0');
            await init.selectByText(
                '#monitor-0 .db-select-nw',
                `${componentName} / ${monitorName}`,
                page
            );
            await init.pageClick(page, '#addMoreMonitors');
            await init.pageWaitForSelector(page, '#monitor-1');
            await init.selectByText(
                '#monitor-1 .db-select-nw',
                `${componentName} / ${monitorName}`,
                page
            );
            await init.pageClick(page, '#btnAddStatusPageMonitors');
            await init.pageWaitForSelector(page, '#monitor-1', {
                visible: true,
                timeout: init.timeout,
            });
            const textContent = await page.$eval(
                '#monitor-1',
                e => e.textContent
            );
            expect(
                textContent.includes('This monitor is already selected.')
            ).toEqual(true);
            await page.reload({ waitUntil: 'networkidle2' });

            const monitor = await init.pageWaitForSelector(page, '#monitor-0', {
                hidden: true,
            });
            expect(monitor).toBeNull();
            const monitor1 = await init.pageWaitForSelector(page, '#montior-1', {
                hidden: true,
            });
            expect(monitor1).toBeNull();
            done();
        },
        operationTimeOut
    );

    test(
        'should add a new monitor.',
        async done => {
            await gotoTheFirstStatusPage(page);
            await init.pageWaitForSelector(page, '#addMoreMonitors', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageClick(page, '#addMoreMonitors');
            await init.pageWaitForSelector(page, '#monitor-0');
            await init.selectByText(
                '#monitor-0 .db-select-nw',
                `${componentName} / ${monitorName}`,
                page
            );
            await init.pageClick(page, '#btnAddStatusPageMonitors');
            await init.pageWaitForSelector(page, '.ball-beat', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageWaitForSelector(page, '.ball-beat', { hidden: true });

            await page.reload({ waitUntil: 'networkidle2' });
            const elem = await init.pageWaitForSelector(page, '#monitor-0', {
                visible: true,
                timeout: init.timeout,
            });
            expect(elem).toBeDefined();
            done();
        },
        operationTimeOut
    );

    test(
        'should remove monitor.',
        async done => {
            await gotoTheFirstStatusPage(page);
            await init.pageWaitForSelector(page, '#monitor-0');
            await init.pageClick(page, '#delete-monitor-0');
            await init.pageClick(page, '#btnAddStatusPageMonitors');
            await init.pageWaitForSelector(page, '.ball-beat', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageWaitForSelector(page, '.ball-beat', { hidden: true });
            await page.reload({ waitUntil: 'networkidle2' });
            const elem = await init.pageWaitForSelector(page, '#app-loading', {
                visible: true,
                timeout: init.timeout,
            });
            expect(elem).toBeTruthy();
            const element = await page.$eval('#app-loading', e => {
                return e.innerHTML;
            });
            expect(element).toContain(
                'No monitors are added to this status page.'
            );
            done();
        },
        operationTimeOut
    );

    test(
        'should add more than one monitor.',
        async done => {
            await gotoTheFirstStatusPage(page);
            await init.pageWaitForSelector(page, '#addMoreMonitors', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageClick(page, '#addMoreMonitors');
            await init.pageWaitForSelector(page, '#monitor-0');
            await init.selectByText(
                '#monitor-0 .db-select-nw',
                `${componentName} / ${monitorName}`,
                page
            );
            await init.pageClick(page, '#addMoreMonitors');
            await init.pageWaitForSelector(page, '#monitor-1');
            await init.selectByText(
                '#monitor-1 .db-select-nw',
                `${componentName} / ${monitorName1}`,
                page
            );
            await init.pageClick(page, '#btnAddStatusPageMonitors');
            await init.pageWaitForSelector(page, '.ball-beat', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageWaitForSelector(page, '.ball-beat', { hidden: true });
            await page.reload({ waitUntil: 'networkidle2' });
            const firstMonitorContainer = await init.pageWaitForSelector(page, 
                '#monitor-0',
                {
                    visible: true,
                }
            );
            expect(firstMonitorContainer).toBeDefined();
            const secondMonitorContainer = await init.pageWaitForSelector(page, 
                '#monitor-1',
                {
                    visible: true,
                }
            );
            expect(secondMonitorContainer).toBeDefined();
            done();
        },
        operationTimeOut
    );
    test('Should change status-page theme to Classic theme', async done => {
        await gotoTheFirstStatusPage(page);
        await init.themeNavigationAndConfirmation(page, 'Classic');
        let link = await page.$('#publicStatusPageUrl > span > a');
        link = await link.getProperty('href');
        link = await link.jsonValue();
        await page.goto(link);
        const classicTheme = await init.pageWaitForSelector(page, '.uptime-stat-name');
        expect(classicTheme).toBeDefined();
        done();
    });
    // The test below depends on Classic team
    test(
        'Status page should render monitors in the same order as in the form.',
        async done => {
            await gotoTheFirstStatusPage(page);
            await init.pageWaitForSelector(page, '#publicStatusPageUrl');

            let link = await page.$('#publicStatusPageUrl > span > a');
            link = await link.getProperty('href');
            link = await link.jsonValue();
            await page.goto(link);
            await init.pageWaitForSelector(page, '#monitor0');
            const firstMonitorBeforeSwap = await page.$eval(
                '#monitor0 .uptime-stat-name',
                e => e.textContent
            );
            const secondMonitorBeforeSwap = await page.$eval(
                '#monitor1 .uptime-stat-name',
                e => e.textContent
            );
            expect(firstMonitorBeforeSwap).toEqual(monitorName);
            expect(secondMonitorBeforeSwap).toEqual(monitorName1);

            // We delete the first monitor in the status page, and we insert it again
            await gotoTheFirstStatusPage(page);
            await init.pageWaitForSelector(page, '#delete-monitor-0');
            await init.pageClick(page, '#delete-monitor-0');
            await init.pageClick(page, '#addMoreMonitors');
            await init.pageWaitForSelector(page, '#monitor-1');
            await init.selectByText(
                '#monitor-1 .db-select-nw',
                `${componentName} / ${monitorName}`,
                page
            );
            await init.pageClick(page, '#btnAddStatusPageMonitors');
            await init.pageWaitForSelector(page, '.ball-beat', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageWaitForSelector(page, '.ball-beat', { hidden: true });
            await page.reload({ waitUntil: 'networkidle2' });
            // We check if the monitors are added
            const firstMonitorContainer = await init.pageWaitForSelector(page, 
                '#monitor-0',
                {
                    visible: true,
                }
            );
            expect(firstMonitorContainer).toBeDefined();
            const secondMonitorContainer = await init.pageWaitForSelector(page, 
                '#monitor-1',
                {
                    visible: true,
                }
            );
            expect(secondMonitorContainer).toBeDefined();

            await page.goto(link);
            await init.pageWaitForSelector(page, '#monitor0');
            const firstMonitorAfterSwap = await page.$eval(
                '#monitor0 .uptime-stat-name',
                e => e.textContent
            );
            const secondMonitorAfterSwap = await page.$eval(
                '#monitor1 .uptime-stat-name',
                e => e.textContent
            );
            expect(firstMonitorAfterSwap).toEqual(secondMonitorBeforeSwap);
            expect(secondMonitorAfterSwap).toEqual(firstMonitorBeforeSwap);
            done();
        },
        operationTimeOut
    );
    // Domain is in react tab 4
    test(
        'should indicate that no domain is set yet for a status page.',
        async done => {
            await gotoTheFirstStatusPage(page);
            await init.gotoTab(4, page);
            const elem = await init.pageWaitForSelector(page, '#domainNotSet', {
                visible: true,
                timeout: init.timeout,
            });
            expect(elem).toBeDefined();
            done();
        },
        operationTimeOut
    );

    test(
        'should create a domain',
        async done => {
            await gotoTheFirstStatusPage(page);
            await init.gotoTab(4, page);
            await init.pageWaitForSelector(page, '#addMoreDomain');
            await init.pageClick(page, '#addMoreDomain');

            await init.pageWaitForSelector(page, '#addMoreDomainModal', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageType(page, '#customDomain', 'fyipeapp.com');
            await init.pageClick(page, '#createCustomDomainBtn');
            await init.pageWaitForSelector(page, '#addMoreDomainModal', {
                hidden: true,
            });
            const elem = await init.pageWaitForSelector(page, '#domainNotSet', {
                hidden: true,
            });
            expect(elem).toBeNull();

            // if domain was not added sucessfully, list will be undefined
            // it will timeout
            const list = await init.pageWaitForSelector(page, 
                'fieldset[name="added-domain"]',
                { visible: true, timeout: init.timeout }
            );
            expect(list).toBeDefined();
            done();
        },
        operationTimeOut
    );

    // this test case is no longer viable for custom domains
    test.skip(
        'should indicate if domain(s) is set on a status page',
        async done => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });
            await page.$eval('#statusPages', elem => elem.click());

            const elem = await init.pageWaitForSelector(page, '#domainSet', {
                visible: true,
                timeout: init.timeout,
            });
            expect(elem).toBeDefined();
            done();
        },
        operationTimeOut
    );

    test(
        'should update a domain',
        async done => {
            const finalValue = 'status.fyipeapp.com';

            await gotoTheFirstStatusPage(page);
            await init.gotoTab(4, page);

            await init.pageWaitForSelector(page, '#editDomain_0', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageClick(page, '#editDomain_0');
            await init.pageWaitForSelector(page, '#editMoreDomainModal', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageWaitForSelector(page, '#customDomain');
            const input = await page.$('#customDomain');
            await input.click({ clickCount: 3 });
            await input.type(finalValue);

            await init.pageClick(page, '#updateCustomDomainBtn');
            await init.pageWaitForSelector(page, '.ball-beat', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageWaitForSelector(page, '.ball-beat', { hidden: true });
            await init.pageWaitForSelector(page, '#editMoreDomainModal', {
                hidden: true,
            });
            await page.reload({ waitUntil: 'networkidle2' });

            await init.gotoTab(4, page);
            let finalInputValue;
            finalInputValue = await init.pageWaitForSelector(page, '#domain-name', {
                visible: true,
                timeout: init.timeout,
            });
            finalInputValue = await finalInputValue.getProperty('innerText');
            finalInputValue = await finalInputValue.jsonValue();

            expect(finalInputValue).toMatch(finalValue);
            done();
        },
        operationTimeOut
    );

    test(
        'should not verify a domain when txt record does not match token',
        async done => {
            await gotoTheFirstStatusPage(page);
            await init.gotoTab(4, page);
            await init.pageWaitForSelector(page, '#btnVerifyDomain_0');
            await init.pageClick(page, '#btnVerifyDomain_0');

            await init.pageWaitForSelector(page, '#confirmVerifyDomain');
            await init.pageClick(page, '#confirmVerifyDomain');
            // element will be visible once the domain was not verified
            const elem = await init.pageWaitForSelector(page, '#verifyDomainError', {
                visible: true,
                timeout: init.timeout,
            });
            expect(elem).toBeDefined();
            done();
        },
        operationTimeOut
    );

    test(
        'should delete a domain in a status page',
        async done => {
            await gotoTheFirstStatusPage(page);
            await init.gotoTab(4, page);
            await init.pageWaitForSelector(page, 'fieldset[name="added-domain"]', {
                visible: true,
                timeout: init.timeout,
            });

            //Get the initial length of domains
            const initialLength = await page.$$eval(
                'fieldset[name="added-domain"]',
                domains => domains.length
            );

            // create one more domain on the status page
            await init.pageWaitForSelector(page, '#addMoreDomain');
            await init.pageClick(page, '#addMoreDomain');
            await init.pageWaitForSelector(page, '#addMoreDomainModal', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageType(page, '#customDomain', 'app.fyipeapp.com');
            await init.pageClick(page, '#createCustomDomainBtn');
            await init.pageWaitForSelector(page, '#addMoreDomainModal', {
                hidden: true,
            });
            await page.reload({ waitUntil: 'networkidle2' });

            await init.gotoTab(4, page);
            await init.pageWaitForSelector(page, '#btnDeleteDomain_0');
            await page.$eval('#btnDeleteDomain_0', elem => elem.click());
            await init.pageWaitForSelector(page, '#confirmDomainDelete', {
                visible: true,
                timeout: init.timeout,
            });
            await page.$eval('#confirmDomainDelete', elem => elem.click());
            await init.pageWaitForSelector(page, '#confirmDomainDelete', {
                hidden: true,
            });

            await page.reload({ waitUntil: 'networkidle2' });
            // get the final length of domains after deleting
            await init.gotoTab(4, page);
            await init.pageWaitForSelector(page, 'fieldset[name="added-domain"]');
            const finalLength = await page.$$eval(
                'fieldset[name="added-domain"]',
                domains => domains.length
            );

            expect(finalLength).toEqual(initialLength);
            done();
        },
        operationTimeOut
    );

    test(
        'should cancel deleting of a domain in a status page',
        async done => {
            await gotoTheFirstStatusPage(page);
            await init.gotoTab(4, page);

            await init.pageWaitForSelector(page, 'fieldset[name="added-domain"]', {
                visible: true,
                timeout: init.timeout,
            });
            //Get the initial length of domains
            const initialLength = await page.$$eval(
                'fieldset[name="added-domain"]',
                domains => domains.length
            );

            // create one more domain on the status page
            await init.pageWaitForSelector(page, '#addMoreDomain');
            await init.pageClick(page, '#addMoreDomain');
            await init.pageWaitForSelector(page, '#addMoreDomainModal', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageType(page, '#customDomain', 'server.fyipeapp.com');
            await init.pageClick(page, '#createCustomDomainBtn');
            await init.pageWaitForSelector(page, '#addMoreDomainModal', {
                hidden: true,
            });
            await page.reload({ waitUntil: 'networkidle2' });

            await init.gotoTab(4, page);

            await init.pageWaitForSelector(page, '#btnDeleteDomain_0');
            await page.$eval('#btnDeleteDomain_0', elem => elem.click());
            await page.$eval('#cancelDomainDelete', elem => elem.click());

            await page.reload({ waitUntil: 'networkidle2' });
            await init.gotoTab(4, page);
            await init.pageWaitForSelector(page, 'fieldset[name="added-domain"]');
            // get the final length of domains after cancelling
            const finalLength = await page.$$eval(
                'fieldset[name="added-domain"]',
                domains => domains.length
            );

            expect(finalLength).toBeGreaterThan(initialLength);
            done();
        },
        operationTimeOut
    );
    //Custom HTML,CSS and JS are now in react-tab-6
    test(
        'should create custom HTML and CSS',
        async done => {
            await gotoTheFirstStatusPage(page);

            await init.pageWaitForSelector(page, '#react-tabs-6');
            await init.pageClick(page, '#react-tabs-6');
            await init.pageType(page, '#headerHTML textarea', '<div>My header'); // Ace editor completes the div tag
            await init.pageClick(page, '#btnAddCustomStyles');

            await init.pageWaitForSelector(page, '.ball-beat', { hidden: true });

            await init.pageWaitForSelector(page, '#react-tabs-2');
            await init.pageClick(page, '#react-tabs-2');
            await init.pageWaitForSelector(page, '#publicStatusPageUrl');

            let link = await page.$('#publicStatusPageUrl > span > a');
            link = await link.getProperty('href');
            link = await link.jsonValue();
            await page.goto(link);
            await init.pageWaitForSelector(page, '#customHeaderHTML > div');

            let spanElement = await page.$('#customHeaderHTML > div');
            spanElement = await spanElement.getProperty('innerText');
            spanElement = await spanElement.jsonValue();
            spanElement.should.be.exactly('My header');
            done();
        },
        operationTimeOut
    );

    test(
        'should create custom Javascript',
        async done => {
            const javascript = `console.log('this is a js code');`;
            await gotoTheFirstStatusPage(page);
            await page.waitForNavigation({ waitUntil: 'load' });

            await init.pageWaitForSelector(page, '#react-tabs-6');
            await init.pageClick(page, '#react-tabs-6');
            await init.pageWaitForSelector(page, '#customJS textarea');
            await init.pageType(
                page,
                '#customJS textarea',
                `<script id='js'>${javascript}`
            );
            await init.pageClick(page, '#btnAddCustomStyles');

            await init.pageWaitForSelector(page, '.ball-beat', { hidden: true });

            await init.pageWaitForSelector(page, '#react-tabs-2');
            await init.pageClick(page, '#react-tabs-2');
            await init.pageWaitForSelector(page, '#publicStatusPageUrl');

            let link = await page.$('#publicStatusPageUrl > span > a');
            link = await link.getProperty('href');
            link = await link.jsonValue();
            await page.goto(link);
            await init.pageWaitForSelector(page, '#js');

            const code = await page.$eval('#js', script => script.innerHTML);
            expect(code).toEqual(javascript);
            done();
        },
        operationTimeOut
    );

    test(
        'should show incidents in the top of status page',
        async done => {
            await gotoTheFirstStatusPage(page);
            await init.pageWaitForSelector(page, '#publicStatusPageUrl');

            await init.pageWaitForSelector(page, '#react-tabs-10'); // Advanced tab
            await init.pageClick(page, '#react-tabs-10');

            await init.pageWaitForSelector(page, '#moreAdvancedOptions', {
                visible: true,
                timeout: init.timeout,
            });
            await page.$eval('#moreAdvancedOptions', elem => elem.click());
            await init.pageWaitForSelector(page, '#statuspage_moveIncidentToTheTop', {
                visible: true,
                timeout: init.timeout,
            });
            await page.$eval('#statuspage_moveIncidentToTheTop', elem =>
                elem.click()
            );
            await init.pageClick(page, '#saveAdvancedOptions');

            await init.pageWaitForSelector(page, '.ball-beat', { hidden: true });

            await init.pageWaitForSelector(page, '#statuspage_moveIncidentToTheTop', {
                visible: true,
                timeout: init.timeout,
            });
            const checked = await page.$eval(
                '#statuspage_moveIncidentToTheTop',
                elem => elem.value
            );
            expect(checked).toBeTruthy();
            done();
        },
        operationTimeOut
    );

    test(
        'should not add a domain when the field is empty',
        async done => {
            await gotoTheFirstStatusPage(page);
            await init.gotoTab(4, page);
            await init.pageWaitForSelector(page, '#addMoreDomain');
            await init.pageClick(page, '#addMoreDomain');
            await init.pageWaitForSelector(page, '#createCustomDomainBtn', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageClick(page, '#createCustomDomainBtn');
            await init.pageWaitForSelector(page, '#field-error', {
                visible: true,
                timeout: init.timeout,
            });
            const element = await page.$eval('#field-error', e => {
                return e.innerHTML;
            });
            expect(element).toContain('Domain is required');
            done();
        },
        operationTimeOut
    );

    test(
        'should not add an invalid domain',
        async done => {
            await gotoTheFirstStatusPage(page);
            await init.gotoTab(4, page);
            await init.pageWaitForSelector(page, '#addMoreDomain');
            await init.pageClick(page, '#addMoreDomain');
            await init.pageWaitForSelector(page, '#addMoreDomainModal', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageWaitForSelector(page, '#customDomain');
            await init.pageType(page, '#customDomain', 'fyipeapp');

            await init.pageWaitForSelector(page, '#createCustomDomainBtn');
            await init.pageClick(page, '#createCustomDomainBtn');
            await init.pageWaitForSelector(page, '#field-error', {
                visible: true,
                timeout: init.timeout,
            });
            const element = await page.$eval('#field-error', e => {
                return e.innerHTML;
            });
            expect(element).toContain('Domain is not valid.');
            done();
        },
        operationTimeOut
    );

    // test case is no longer valid
    test.skip(
        'should add multiple domains',
        async done => {
            await gotoTheFirstStatusPage(page);
            await page.waitForNavigation({ waitUntil: 'networkidle2' });
            await init.pageWaitForSelector(page, '#react-tabs-2');
            await init.pageClick(page, '#react-tabs-2');
            await init.pageWaitForSelector(page, '#addMoreDomain');
            await init.pageClick(page, '#addMoreDomain');
            await init.pageWaitForSelector(page, '#domain_1', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageType(page, '#domain_1', 'fyipe.fyipeapp.com');

            await init.pageClick(page, '#addMoreDomain');
            await init.pageWaitForSelector(page, '#domain_2', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageType(page, '#domain_2', 'api.fyipeapp.com');
            await init.pageWaitForSelector(page, '#btnAddDomain');
            await init.pageClick(page, '#btnAddDomain');

            await init.pageWaitForSelector(page, '.ball-beat', { hidden: true });
            const domains = await page.$$eval(
                'fieldset[name="added-domain"]',
                domains => domains.length
            );
            expect(domains).toEqual(4);
            done();
        },
        operationTimeOut
    );

    test(
        'should not add an existing domain',
        async done => {
            await gotoTheFirstStatusPage(page);
            //Removal of repeated function
            await init.gotoTab(4, page);
            await init.pageWaitForSelector(page, '#addMoreDomain');
            await init.pageClick(page, '#addMoreDomain');
            await init.pageWaitForSelector(page, '#addMoreDomainModal', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageWaitForSelector(page, '#customDomain');
            await init.pageType(page, '#customDomain', 'fyipe.fyipeapp.com');
            await init.pageClick(page, '#createCustomDomainBtn');
            const addDomainError = await init.pageWaitForSelector(page, 
                '#addDomainError',
                {
                    visible: true,
                }
            );
            expect(addDomainError).toBeDefined();
            done();
        },
        operationTimeOut
    );
});
