const puppeteer = require('puppeteer');
const utils = require('./test-utils');
const init = require('./test-init');

require('should');

// user credentials
const email = utils.generateRandomBusinessEmail();
const password = '1234567890';
const componentName = 'hackerbay';
const monitorName = 'fyipe';
const monitorName1 = 'testFyipe';

let browser, page;
const gotoTheFirstStatusPage = async page => {
    await page.goto(utils.DASHBOARD_URL);
    await page.waitForSelector('#statusPages');
    await page.$eval('#statusPages', e => e.click());
    const rowItem = await page.waitForSelector(
        '#statusPagesListContainer > tr',
        { visible: true }
    );
    rowItem.click();
};

describe('Status Page', () => {
    const operationTimeOut = 500000;
    
    beforeAll(async () => {
        jest.setTimeout(360000);

        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/61.0.3163.100 Safari/537.36'
        );            
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
                await init.addNewMonitorToComponent(
                    page,
                    componentName,
                    monitorName,
                                      
                );
                // Creates the second monitor
                await init.addNewMonitorToComponent(
                    page,
                    componentName,
                    monitorName1,                                      
                );
        
    });

    afterAll(async done => {        
        await browser.close();
        done();
    });

    test(
        'should indicate that no monitor is set yet for a status page',
        async (done) => {            
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
                done();
        },
        operationTimeOut
    );

    test(
        'should show error message and not submit the form if no monitor is selected and user clicks on save.',
        async (done) => {            
                await gotoTheFirstStatusPage(page);
                await page.waitForSelector('#addMoreMonitors');
                await page.click('#addMoreMonitors');
                await page.waitForSelector('#monitor-0');
                await page.click('#btnAddStatusPageMonitors');
                await page.waitForSelector('#monitor-0', { visible: true });
                const textContent = await page.$eval(
                    '#monitor-0',
                    e => e.textContent
                );
                expect(
                    textContent.includes('A monitor must be selected.')
                ).toEqual(true);
                await page.reload({ waitUntil: 'networkidle0' });
                const monitor = await page.waitForSelector('#monitor-0', {
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
        async (done) => {            
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
                    'You must select at least one chart type'
                );
                await page.click('#btnAddStatusPageMonitors');    
                await page.reload({ waitUntil: 'networkidle0' });
                const monitor = await page.waitForSelector('#monitor-0', {
                    hidden: true,
                });
                expect(monitor).toBeNull();
            done();
        },
        operationTimeOut
    );

    test(
        'should show an error message and not submit the form if the users select the same monitor twice.',
        async (done) => {            
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
                    `${componentName} / ${monitorName}`,
                    page
                );
                await page.click('#btnAddStatusPageMonitors');
                await page.waitForSelector('#monitor-1', { visible: true });
                const textContent = await page.$eval(
                    '#monitor-1',
                    e => e.textContent
                );
                expect(
                    textContent.includes('This monitor is already selected.')
                ).toEqual(true);
                await page.reload({ waitUntil: 'networkidle0' });

                const monitor = await page.waitForSelector('#monitor-0', {
                    hidden: true,
                });
                expect(monitor).toBeNull();
                const monitor1 = await page.waitForSelector('#montior-1', {
                    hidden: true,
                });
                expect(monitor1).toBeNull();
            done();
        },
        operationTimeOut
    );

    test(
        'should add a new monitor.',
        async (done) => {            
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
                await page.waitForSelector('.ball-beat', { visible: true });
                await page.waitForSelector('.ball-beat', { hidden: true });

                await page.reload({ waitUntil: 'networkidle0' });
                const elem = await page.waitForSelector('#monitor-0', {
                    visible: true,
                });
                expect(elem).toBeDefined();
            done();
        },
        operationTimeOut
    );

    test(
        'should remove monitor.',
        async (done) => {            
                await gotoTheFirstStatusPage(page);
                await page.waitForSelector('#monitor-0');
                await page.click('#delete-monitor-0');
                await page.click('#btnAddStatusPageMonitors');
                await page.waitForSelector('.ball-beat', { visible: true });
                await page.waitForSelector('.ball-beat', { hidden: true });
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
            done();
        },
        operationTimeOut
    );

    test(
        'should add more than one monitor.',
        async (done) => {            
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
                await page.waitForSelector('.ball-beat', { visible: true });
                await page.waitForSelector('.ball-beat', { hidden: true });
                await page.reload({ waitUntil: 'networkidle0' });
                const firstMonitorContainer = await page.waitForSelector(
                    '#monitor-0',
                    {
                        visible: true,
                    }
                );
                expect(firstMonitorContainer).toBeDefined();
                const secondMonitorContainer = await page.waitForSelector(
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
    test('Should change status-page theme to Classic theme',
        async done =>{
            await gotoTheFirstStatusPage(page);
            await init.themeNavigationAndConfirmation(page,'Classic');
            let link = await page.$('#publicStatusPageUrl > span > a');
                link = await link.getProperty('href');
                link = await link.jsonValue();
                await page.goto(link);
            let classicTheme = await page.waitForSelector('.uptime-stat-name');
            expect(classicTheme).toBeDefined();
            done();
        })
        // The test below depends on Classic team
    test(
        'Status page should render monitors in the same order as in the form.',
        async (done) => {            
                await gotoTheFirstStatusPage(page);
                await page.waitForSelector('#publicStatusPageUrl');

                let link = await page.$('#publicStatusPageUrl > span > a');
                link = await link.getProperty('href');
                link = await link.jsonValue();
                await page.goto(link);
                await page.waitForSelector('#monitor0');
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
                await page.waitForSelector('#delete-monitor-0');
                await page.click('#delete-monitor-0');
                await page.click('#addMoreMonitors');
                await page.waitForSelector('#monitor-1');
                await init.selectByText(
                    '#monitor-1 .db-select-nw',
                    `${componentName} / ${monitorName}`,
                    page
                );
                await page.click('#btnAddStatusPageMonitors');
                await page.waitForSelector('.ball-beat', { visible: true });
                await page.waitForSelector('.ball-beat', { hidden: true });
                await page.reload({ waitUntil: 'networkidle0' });
                // We check if the monitors are added
                const firstMonitorContainer = await page.waitForSelector(
                    '#monitor-0',
                    {
                        visible: true,
                    }
                );
                expect(firstMonitorContainer).toBeDefined();
                const secondMonitorContainer = await page.waitForSelector(
                    '#monitor-1',
                    {
                        visible: true,
                    }
                );
                expect(secondMonitorContainer).toBeDefined();

                await page.goto(link);
                await page.waitForSelector('#monitor0');
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
        async (done) => {            
                await gotoTheFirstStatusPage(page);
                await init.gotoTab(4, page); 
                const elem = await page.waitForSelector('#domainNotSet', {
                    visible: true,
                });
                expect(elem).toBeDefined();
            done();
        },
        operationTimeOut
    );

    test(
        'should create a domain',
        async (done) => {            
                await gotoTheFirstStatusPage(page);
                await init.gotoTab(4, page);
                await page.waitForSelector('#addMoreDomain');
                await page.click('#addMoreDomain');

                await page.waitForSelector('#addMoreDomainModal', {
                    visible: true,
                });
                await page.type('#customDomain', 'fyipeapp.com');
                await page.click('#createCustomDomainBtn');
                await page.waitForSelector('#addMoreDomainModal', {
                    hidden: true,
                });
                const elem = await page.waitForSelector('#domainNotSet', {
                    hidden: true,
                });
                expect(elem).toBeNull();

                // if domain was not added sucessfully, list will be undefined
                // it will timeout
                const list = await page.waitForSelector(
                    'fieldset[name="added-domain"]',
                    { visible: true }
                );
                expect(list).toBeDefined();
            done();
        },
        operationTimeOut
    );

    // this test case is no longer viable for custom domains
    test.skip(
        'should indicate if domain(s) is set on a status page',
        async (done) => {            
                await page.goto(utils.DASHBOARD_URL);
                await page.$eval('#statusPages', elem => elem.click());

                const elem = await page.waitForSelector('#domainSet', {
                    visible: true,
                });
                expect(elem).toBeDefined();
            done();
        },
        operationTimeOut
    );

    test(
        'should update a domain',
        async (done) => {            
            const finalValue = 'status.fyipeapp.com';

            await gotoTheFirstStatusPage(page);
            await init.gotoTab(4, page);

            await page.waitForSelector('#editDomain_0', { visible: true });
            await page.click('#editDomain_0');
            await page.waitForSelector('#editMoreDomainModal', {
                visible: true,
            });
            await page.waitForSelector('#customDomain');
            const input = await page.$('#customDomain');
            await input.click({ clickCount: 3 });
            await input.type(finalValue);

            await page.click('#updateCustomDomainBtn');
            await page.waitForSelector('.ball-beat', { visible: true });
            await page.waitForSelector('.ball-beat', { hidden: true });
            await page.waitForSelector('#editMoreDomainModal', {
                hidden: true,
            });
            await page.reload({ waitUntil: 'networkidle0' });

            await init.gotoTab(4, page);
            let finalInputValue;
            finalInputValue = await page.waitForSelector(
                '#domain-name', { visible: true }
            );
            finalInputValue = await finalInputValue.getProperty('innerText');
            finalInputValue = await finalInputValue.jsonValue();

            expect(finalInputValue).toMatch(finalValue);
            done();
        },
        operationTimeOut
    );

    test(
        'should not verify a domain when txt record does not match token',
        async (done) => {            
                await gotoTheFirstStatusPage(page);
                await init.gotoTab(4, page);
                await page.waitForSelector('#btnVerifyDomain_0');
                await page.click('#btnVerifyDomain_0');

                await page.waitForSelector('#confirmVerifyDomain');
                await page.click('#confirmVerifyDomain');
                // element will be visible once the domain was not verified
                const elem = await page.waitForSelector('#verifyDomainError', {
                    visible: true,
                });
                expect(elem).toBeDefined();
            done();
        },
        operationTimeOut
    );

    test(
        'should delete a domain in a status page',
        async (done) => {            
                await gotoTheFirstStatusPage(page);
                await init.gotoTab(4, page);
                await page.waitForSelector('fieldset[name="added-domain"]', {
                    visible: true,
                });

                //Get the initial length of domains
                const initialLength = await page.$$eval(
                    'fieldset[name="added-domain"]',
                    domains => domains.length
                );

                // create one more domain on the status page
                await page.waitForSelector('#addMoreDomain');
                await page.click('#addMoreDomain');
                await page.waitForSelector('#addMoreDomainModal', {
                    visible: true,
                });
                await page.type('#customDomain', 'app.fyipeapp.com');
                await page.click('#createCustomDomainBtn');
                await page.waitForSelector('#addMoreDomainModal', {
                    hidden: true,
                });
                await page.reload({ waitUntil: 'networkidle0' });

                await init.gotoTab(4, page);
                await page.waitForSelector('#btnDeleteDomain_0');
                await page.$eval('#btnDeleteDomain_0', elem => elem.click());
                await page.waitForSelector('#confirmDomainDelete', {
                    visible: true,
                });
                await page.$eval('#confirmDomainDelete', elem => elem.click());
                await page.waitForSelector('#confirmDomainDelete', {
                    hidden: true,
                });

                await page.reload({ waitUntil: 'networkidle0' });
                // get the final length of domains after deleting
                await init.gotoTab(4, page);
                await page.waitForSelector('fieldset[name="added-domain"]');
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
        async (done) => {            
                await gotoTheFirstStatusPage(page);
                await init.gotoTab(4, page);

                await page.waitForSelector('fieldset[name="added-domain"]', {
                    visible: true,
                });
                //Get the initial length of domains
                const initialLength = await page.$$eval(
                    'fieldset[name="added-domain"]',
                    domains => domains.length
                );

                // create one more domain on the status page
                await page.waitForSelector('#addMoreDomain');
                await page.click('#addMoreDomain');
                await page.waitForSelector('#addMoreDomainModal', {
                    visible: true,
                });
                await page.type('#customDomain', 'server.fyipeapp.com');
                await page.click('#createCustomDomainBtn');
                await page.waitForSelector('#addMoreDomainModal', {
                    hidden: true,
                });
                await page.reload({ waitUntil: 'networkidle0' });

                await init.gotoTab(4, page);

                await page.waitForSelector('#btnDeleteDomain_0');
                await page.$eval('#btnDeleteDomain_0', elem => elem.click());
                await page.$eval('#cancelDomainDelete', elem => elem.click());

                await page.reload({ waitUntil: 'networkidle0' });
                await init.gotoTab(4, page);
                await page.waitForSelector('fieldset[name="added-domain"]');
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
        async (done) => {            
                await gotoTheFirstStatusPage(page);

                await page.waitForSelector('#react-tabs-6');
                await page.click('#react-tabs-6');
                await page.type('#headerHTML textarea', '<div>My header'); // Ace editor completes the div tag
                await page.click('#btnAddCustomStyles');
                await page.waitForTimeout(2000);
                await page.waitForSelector('.ball-beat', { hidden: true });

                await page.waitForSelector('#react-tabs-2');
                await page.click('#react-tabs-2');
                await page.waitForSelector('#publicStatusPageUrl');

                let link = await page.$('#publicStatusPageUrl > span > a');
                link = await link.getProperty('href');
                link = await link.jsonValue();
                await page.goto(link);
                await page.waitForSelector('#customHeaderHTML > div');

                let spanElement = await page.$('#customHeaderHTML > div');
                spanElement = await spanElement.getProperty('innerText');
                spanElement = await spanElement.jsonValue();
                spanElement.should.be.exactly('My header');
            done()
        },
        operationTimeOut
    );

    test(
        'should create custom Javascript',
        async (done) => {            
                const javascript = `console.log('this is a js code');`;
                await gotoTheFirstStatusPage(page);
                await page.waitForNavigation({ waitUntil: 'load' });

                await page.waitForSelector('#react-tabs-6');
                await page.click('#react-tabs-6');
                await page.waitForSelector('#customJS textarea');
                await page.type(
                    '#customJS textarea',
                    `<script id='js'>${javascript}`
                );
                await page.click('#btnAddCustomStyles');
                await page.waitForTimeout(2000);
                await page.waitForSelector('.ball-beat', { hidden: true });

                await page.waitForSelector('#react-tabs-2');
                await page.click('#react-tabs-2');
                await page.waitForSelector('#publicStatusPageUrl');

                let link = await page.$('#publicStatusPageUrl > span > a');
                link = await link.getProperty('href');
                link = await link.jsonValue();
                await page.goto(link);
                await page.waitForSelector('#js');

                const code = await page.$eval(
                    '#js',
                    script => script.innerHTML
                );
                expect(code).toEqual(javascript);
            done();
        },
        operationTimeOut
    );

    test(
        'should show incidents in the top of status page',
        async (done) => {            
                await gotoTheFirstStatusPage(page);
                await page.waitForSelector('#publicStatusPageUrl');

                await page.waitForSelector('#react-tabs-10'); // Advanced tab
                await page.click('#react-tabs-10');

                await page.waitForSelector('#moreAdvancedOptions', {
                    visible: true,
                });
                await page.$eval('#moreAdvancedOptions', elem => elem.click());
                await page.waitForSelector('#statuspage_moveIncidentToTheTop', {
                    visible: true,
                });
                await page.$eval('#statuspage_moveIncidentToTheTop', elem =>
                    elem.click()
                );
                await page.click('#saveAdvancedOptions');
                await page.waitForTimeout(2000);
                await page.waitForSelector('.ball-beat', { hidden: true });

                await page.waitForSelector('#statuspage_moveIncidentToTheTop', {
                    visible: true,
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
        async (done) => {            
                await gotoTheFirstStatusPage(page);
                await init.gotoTab(4, page);
                await page.waitForSelector('#addMoreDomain');
                await page.click('#addMoreDomain');
                await page.waitForSelector('#createCustomDomainBtn', {
                    visible: true,
                });
                await page.click('#createCustomDomainBtn');
                await page.waitForSelector('#field-error', { visible: true });
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
        async (done) => {            
                await gotoTheFirstStatusPage(page);
                await init.gotoTab(4, page);
                await page.waitForSelector('#addMoreDomain');
                await page.click('#addMoreDomain');
                await page.waitForSelector('#addMoreDomainModal', {
                    visible: true,
                });
                await page.waitForSelector('#customDomain');
                await page.type('#customDomain', 'fyipeapp');

                await page.waitForSelector('#createCustomDomainBtn');
                await page.click('#createCustomDomainBtn');
                await page.waitForSelector('#field-error', { visible: true });
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
        async (done) => {            
                await gotoTheFirstStatusPage(page);
                await page.waitForNavigation({ waitUntil: 'networkidle0' });
                await page.waitForSelector('#react-tabs-2');
                await page.click('#react-tabs-2');
                await page.waitForSelector('#addMoreDomain');
                await page.click('#addMoreDomain');
                await page.waitForSelector('#domain_1', { visible: true });
                await page.type('#domain_1', 'fyipe.fyipeapp.com');

                await page.click('#addMoreDomain');
                await page.waitForSelector('#domain_2', { visible: true });
                await page.type('#domain_2', 'api.fyipeapp.com');
                await page.waitForSelector('#btnAddDomain');
                await page.click('#btnAddDomain');
                await page.waitForTimeout(2000);
                await page.waitForSelector('.ball-beat', { hidden: true });
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
        async (done) => {            
                await gotoTheFirstStatusPage(page);                
                //Removal of repeated function
                await init.gotoTab(4, page);
                await page.waitForSelector('#addMoreDomain');
                await page.click('#addMoreDomain');
                await page.waitForSelector('#addMoreDomainModal', {
                    visible: true,
                });
                await page.waitForSelector('#customDomain');
                await page.type('#customDomain', 'fyipe.fyipeapp.com');
                await page.click('#createCustomDomainBtn');
                const addDomainError = await page.waitForSelector(
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
