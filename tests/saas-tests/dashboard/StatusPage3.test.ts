import puppeteer from 'puppeteer';
import utils from '../../test-utils';
import init from '../../test-init';

require('should');

// user credentials
const email = utils.generateRandomBusinessEmail();
const password = '1234567890';
const componentName = 'hackerbay';
const monitorName = 'oneuptime';
const monitorName1 = 'testoneuptime';
const customDomain = `${utils.generateRandomString()}.com`;

let browser: $TSFixMe, page: $TSFixMe;
const gotoTheFirstStatusPage = async (page: $TSFixMe) => {
    await page.goto(utils.DASHBOARD_URL, {
        waitUntil: ['networkidle2'],
    });

    await init.pageWaitForSelector(page, '#statusPages');
    await init.page$Eval(page, '#statusPages', (e: $TSFixMe) => e.click());
    const rowItem = await init.pageWaitForSelector(
        page,
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
        await init.addAdditionalMonitorToComponent(
            page,
            componentName,
            monitorName1
        );
    });

    afterAll(async (done: $TSFixMe) => {
        await browser.close();
        done();
    });

    //Custom HTML,CSS and JS are now in branding-tab

    test(
        'should create custom HTML and CSS',
        async (done: $TSFixMe) => {
            await gotoTheFirstStatusPage(page);

            await init.pageClick(page, '.branding-tab');

            await init.pageType(page, '#headerHTML textarea', '<div>My header'); // Ace editor completes the div tag

            await init.pageClick(page, '#btnAddCustomStyles');

            await init.pageWaitForSelector(page, '.ball-beat', {
                hidden: true,
            });

            await page.reload({
                waitUntil: 'networkidle2',
                timeout: init.timeout,
            });

            await init.pageWaitForSelector(page, '#publicStatusPageUrl');

            let link = await init.page$(
                page,
                '#publicStatusPageUrl > span > a'
            );
            link = await link.getProperty('href');
            link = await link.jsonValue();
            await page.goto(link);

            await init.pageWaitForSelector(page, '#customHeaderHTML > div');

            let spanElement = await init.page$(page, '#customHeaderHTML > div');
            spanElement = await spanElement.getProperty('innerText');
            spanElement = await spanElement.jsonValue();
            spanElement.should.be.exactly('My header');
            done();
        },
        operationTimeOut
    );

    test(
        'should create custom Javascript',
        async (done: $TSFixMe) => {
            const javascript = `logger.info('this is a js code');`;
            await gotoTheFirstStatusPage(page);
            await page.waitForNavigation({ waitUntil: 'load' });

            await init.pageClick(page, '.branding-tab');

            await init.pageWaitForSelector(page, '#customJS textarea');

            await init.pageType(
                page,
                '#customJS textarea',
                `<script id='js'>${javascript}`
            );

            await init.pageClick(page, '#btnAddCustomStyles');

            await init.pageWaitForSelector(page, '.ball-beat', {
                hidden: true,
            });

            await page.reload({
                waitUntil: 'networkidle2',
                timeout: init.timeout,
            });

            await init.pageWaitForSelector(page, '#publicStatusPageUrl');

            let link = await init.page$(
                page,
                '#publicStatusPageUrl > span > a'
            );
            link = await link.getProperty('href');
            link = await link.jsonValue();
            await page.goto(link);
            await init.pageWaitForSelector(page, '#js', { hidden: true });

            const code = await init.page$Eval(
                page,
                '#js',
                (script: $TSFixMe) => script.innerHTML,

                { hidden: true }
            );
            expect(code).toEqual(javascript);
            done();
        },
        operationTimeOut
    );

    test(
        'should not add a domain when the field is empty',
        async (done: $TSFixMe) => {
            await gotoTheFirstStatusPage(page);

            await init.pageClick(page, '.custom-domains-tab');

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
            const element = await init.page$Eval(
                page,
                '#field-error',
                (e: $TSFixMe) => {
                    return e.innerHTML;
                }
            );
            expect(element).toContain('Domain is required');
            done();
        },
        operationTimeOut
    );

    test(
        'should not add an invalid domain',
        async (done: $TSFixMe) => {
            await gotoTheFirstStatusPage(page);

            await init.pageClick(page, '.custom-domains-tab');

            await init.pageWaitForSelector(page, '#addMoreDomain');

            await init.pageClick(page, '#addMoreDomain');
            await init.pageWaitForSelector(page, '#addMoreDomainModal', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageWaitForSelector(page, '#customDomain');

            await init.pageType(page, '#customDomain', 'oneuptimeapp');

            await init.pageWaitForSelector(page, '#createCustomDomainBtn');

            await init.pageClick(page, '#createCustomDomainBtn');
            await init.pageWaitForSelector(page, '#field-error', {
                visible: true,
                timeout: init.timeout,
            });
            const element = await init.page$Eval(
                page,
                '#field-error',
                (e: $TSFixMe) => {
                    return e.innerHTML;
                }
            );
            expect(element).toContain('Domain is not valid.');
            done();
        },
        operationTimeOut
    );

    // This test is added again as the next test depends on it.

    test(
        'should create a domain',
        async (done: $TSFixMe) => {
            await gotoTheFirstStatusPage(page);

            await init.pageClick(page, '.custom-domains-tab');

            await init.pageWaitForSelector(page, '#addMoreDomain');

            await init.pageClick(page, '#addMoreDomain');

            await init.pageWaitForSelector(page, '#addMoreDomainModal', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageType(page, '#customDomain', customDomain);

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
            const list = await init.pageWaitForSelector(
                page,
                'fieldset[name="added-domain"]',
                { visible: true, timeout: init.timeout }
            );
            expect(list).toBeDefined();
            done();
        },
        operationTimeOut
    );

    test(
        'should not add an existing domain',
        async (done: $TSFixMe) => {
            await gotoTheFirstStatusPage(page);
            //Removal of repeated function

            await init.pageClick(page, '.custom-domains-tab');

            await init.pageWaitForSelector(page, '#addMoreDomain');

            await init.pageClick(page, '#addMoreDomain');
            await init.pageWaitForSelector(page, '#addMoreDomainModal', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageWaitForSelector(page, '#customDomain');

            await init.pageType(page, '#customDomain', customDomain);

            await init.pageClick(page, '#createCustomDomainBtn');
            const addDomainError = await init.pageWaitForSelector(
                page,
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
