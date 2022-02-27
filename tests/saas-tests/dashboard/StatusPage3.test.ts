// @ts-expect-error ts-migrate(2307) FIXME: Cannot find module 'puppeteer' or its correspondin... Remove this comment to see the full error message
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
    // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
    await init.pageWaitForSelector(page, '#statusPages');
    await init.page$Eval(page, '#statusPages', (e: $TSFixMe) => e.click());
    const rowItem = await init.pageWaitForSelector(
        page,
        '#statusPagesListContainer > tr',
        { visible: true, timeout: init.timeout }
    );
    rowItem.click();
};

// @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'describe'. Do you need to instal... Remove this comment to see the full error message
describe('Status Page', () => {
    const operationTimeOut = init.timeout;

    // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'beforeAll'.
    beforeAll(async () => {
        // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'jest'.
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

    // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'afterAll'.
    afterAll(async (done: $TSFixMe) => {
        await browser.close();
        done();
    });

    //Custom HTML,CSS and JS are now in branding-tab
    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test(
        'should create custom HTML and CSS',
        async (done: $TSFixMe) => {
            await gotoTheFirstStatusPage(page);
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '.branding-tab');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await init.pageType(page, '#headerHTML textarea', '<div>My header'); // Ace editor completes the div tag
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#btnAddCustomStyles');

            await init.pageWaitForSelector(page, '.ball-beat', {
                hidden: true,
            });

            await page.reload({
                waitUntil: 'networkidle2',
                timeout: init.timeout,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#publicStatusPageUrl');

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            let link = await init.page$(
                page,
                '#publicStatusPageUrl > span > a'
            );
            link = await link.getProperty('href');
            link = await link.jsonValue();
            await page.goto(link);
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#customHeaderHTML > div');

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            let spanElement = await init.page$(page, '#customHeaderHTML > div');
            spanElement = await spanElement.getProperty('innerText');
            spanElement = await spanElement.jsonValue();
            spanElement.should.be.exactly('My header');
            done();
        },
        operationTimeOut
    );

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test(
        'should create custom Javascript',
        async (done: $TSFixMe) => {
            const javascript = `console.log('this is a js code');`;
            await gotoTheFirstStatusPage(page);
            await page.waitForNavigation({ waitUntil: 'load' });

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '.branding-tab');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#customJS textarea');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await init.pageType(
                page,
                '#customJS textarea',
                `<script id='js'>${javascript}`
            );
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#btnAddCustomStyles');

            await init.pageWaitForSelector(page, '.ball-beat', {
                hidden: true,
            });

            await page.reload({
                waitUntil: 'networkidle2',
                timeout: init.timeout,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#publicStatusPageUrl');

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
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
                // @ts-expect-error ts-migrate(2345) FIXME: Argument of type '{ hidden: boolean; }' is not ass... Remove this comment to see the full error message
                { hidden: true }
            );
            expect(code).toEqual(javascript);
            done();
        },
        operationTimeOut
    );

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test(
        'should not add a domain when the field is empty',
        async (done: $TSFixMe) => {
            await gotoTheFirstStatusPage(page);
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '.custom-domains-tab');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#addMoreDomain');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#addMoreDomain');
            await init.pageWaitForSelector(page, '#createCustomDomainBtn', {
                visible: true,
                timeout: init.timeout,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
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

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test(
        'should not add an invalid domain',
        async (done: $TSFixMe) => {
            await gotoTheFirstStatusPage(page);
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '.custom-domains-tab');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#addMoreDomain');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#addMoreDomain');
            await init.pageWaitForSelector(page, '#addMoreDomainModal', {
                visible: true,
                timeout: init.timeout,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#customDomain');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await init.pageType(page, '#customDomain', 'oneuptimeapp');

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#createCustomDomainBtn');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
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
    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test(
        'should create a domain',
        async (done: $TSFixMe) => {
            await gotoTheFirstStatusPage(page);
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '.custom-domains-tab');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#addMoreDomain');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#addMoreDomain');

            await init.pageWaitForSelector(page, '#addMoreDomainModal', {
                visible: true,
                timeout: init.timeout,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await init.pageType(page, '#customDomain', customDomain);
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
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
    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test(
        'should not add an existing domain',
        async (done: $TSFixMe) => {
            await gotoTheFirstStatusPage(page);
            //Removal of repeated function
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '.custom-domains-tab');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#addMoreDomain');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#addMoreDomain');
            await init.pageWaitForSelector(page, '#addMoreDomainModal', {
                visible: true,
                timeout: init.timeout,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#customDomain');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await init.pageType(page, '#customDomain', customDomain);
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
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
