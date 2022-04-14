import puppeteer from 'puppeteer';
import Email from 'Common/Types/Email';
import utils from '../../test-utils';
import init from '../../test-init';

import 'should';

// user credentials
const email: Email = utils.generateRandomBusinessEmail();
const password: string = '1234567890';
const componentName: string = 'hackerbay';
const monitorName: string = 'oneuptime';
const monitorName1: string = 'testoneuptime';
const customDomain: string = utils.generateRandomString();

let browser: $TSFixMe, page: $TSFixMe;
const gotoTheFirstStatusPage: Function = async (page: $TSFixMe): void => {
    await page.goto(utils.DASHBOARD_URL, {
        waitUntil: ['networkidle2'],
        timeout: init.timeout,
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
        const user: $TSFixMe = {
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

    test(
        'should add more than one monitor.',
        async (done: $TSFixMe) => {
            await gotoTheFirstStatusPage(page);
            await init.pageWaitForSelector(page, '#addMoreMonitors', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#addMoreMonitors');

            await init.pageWaitForSelector(page, '#monitor-0');
            await init.selectDropdownValue(
                '#monitor-0 .db-select-nw',
                `${componentName} / ${monitorName}`,
                page
            );

            await init.pageClick(page, '#addMoreMonitors');

            await init.pageWaitForSelector(page, '#monitor-1');
            await init.selectDropdownValue(
                '#monitor-1 .db-select-nw',
                `${componentName} / ${monitorName1}`,
                page
            );

            await init.pageClick(page, '#btnAddStatusPageMonitors');

            await page.reload({ waitUntil: 'networkidle2' });
            const firstMonitorContainer = await init.pageWaitForSelector(
                page,
                '#monitor-0',
                {
                    visible: true,
                }
            );
            expect(firstMonitorContainer).toBeDefined();
            const secondMonitorContainer = await init.pageWaitForSelector(
                page,
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

    test('Should change StatusPage theme to Classic theme', async (done: $TSFixMe) => {
        await gotoTheFirstStatusPage(page);
        await init.themeNavigationAndConfirmation(page, 'Classic');

        let link: $TSFixMe = await init.page$(
            page,
            '#publicStatusPageUrl > span > a'
        );
        link = await link.getProperty('href');
        link = await link.jsonValue();
        await page.goto(link);

        const classicTheme = await init.pageWaitForSelector(
            page,
            '.uptime-stat-name'
        );
        expect(classicTheme).toBeDefined();
        done();
    });
    // The test below depends on Classic team

    test(
        'Status page should render monitors in the same order as in the form.',
        async (done: $TSFixMe) => {
            await gotoTheFirstStatusPage(page);

            await init.pageWaitForSelector(page, '#publicStatusPageUrl');

            let link: $TSFixMe = await init.page$(
                page,
                '#publicStatusPageUrl > span > a'
            );
            link = await link.getProperty('href');
            link = await link.jsonValue();
            await page.goto(link);

            await init.pageWaitForSelector(page, '#monitor0');
            const firstMonitorBeforeSwap = await init.page$Eval(
                page,
                '#monitor0 .uptime-stat-name',
                (e: $TSFixMe) => e.textContent
            );
            const secondMonitorBeforeSwap = await init.page$Eval(
                page,
                '#monitor1 .uptime-stat-name',
                (e: $TSFixMe) => e.textContent
            );
            expect(firstMonitorBeforeSwap).toEqual(monitorName);
            expect(secondMonitorBeforeSwap).toEqual(monitorName1);

            // We delete the first monitor in the status page, and we insert it again
            await gotoTheFirstStatusPage(page);

            await init.pageWaitForSelector(page, '#delete-monitor-0');

            await init.pageClick(page, '#delete-monitor-0');

            await init.pageClick(page, '#addMoreMonitors');

            await init.pageWaitForSelector(page, '#monitor-1');
            await init.selectDropdownValue(
                '#monitor-1 .db-select-nw',
                `${componentName} / ${monitorName}`,
                page
            );

            await init.pageClick(page, '#btnAddStatusPageMonitors');

            await page.reload({ waitUntil: 'networkidle2' });
            // We check if the monitors are added
            const firstMonitorContainer = await init.pageWaitForSelector(
                page,
                '#monitor-0',
                {
                    visible: true,
                }
            );
            expect(firstMonitorContainer).toBeDefined();
            const secondMonitorContainer = await init.pageWaitForSelector(
                page,
                '#monitor-1',
                {
                    visible: true,
                }
            );
            expect(secondMonitorContainer).toBeDefined();

            await page.goto(link);

            await init.pageWaitForSelector(page, '#monitor0');
            const firstMonitorAfterSwap = await init.page$Eval(
                page,
                '#monitor0 .uptime-stat-name',
                (e: $TSFixMe) => e.textContent
            );
            const secondMonitorAfterSwap = await init.page$Eval(
                page,
                '#monitor1 .uptime-stat-name',
                (e: $TSFixMe) => e.textContent
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
        async (done: $TSFixMe) => {
            await gotoTheFirstStatusPage(page);

            await init.pageClick(page, '.custom-domains-tab');
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
        async (done: $TSFixMe) => {
            await gotoTheFirstStatusPage(page);

            await init.pageClick(page, '.custom-domains-tab');

            await init.pageWaitForSelector(page, '#addMoreDomain');

            await init.pageClick(page, '#addMoreDomain');

            await init.pageWaitForSelector(page, '#addMoreDomainModal', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageType(page, '#customDomain', `${customDomain}.com`);

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
        'should update a domain',
        async (done: $TSFixMe) => {
            const finalValue: string = `status.${customDomain}.com`;

            await gotoTheFirstStatusPage(page);

            await init.pageClick(page, '.custom-domains-tab');

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

            const input = await init.page$(page, '#customDomain');
            await input.click({ clickCount: 3 });
            await input.type(finalValue);

            await init.pageClick(page, '#updateCustomDomainBtn');

            await init.pageWaitForSelector(page, '#editMoreDomainModal', {
                hidden: true,
            });
            await page.reload({
                waitUntil: 'networkidle2',
                timeout: init.timeout,
            });

            await init.pageClick(page, '.custom-domains-tab');
            let finalInputValue;
            finalInputValue = await init.pageWaitForSelector(
                page,
                '#domain-name',
                {
                    visible: true,
                    timeout: init.timeout,
                }
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
        async (done: $TSFixMe) => {
            await gotoTheFirstStatusPage(page);

            await init.pageClick(page, '.custom-domains-tab');

            await init.pageWaitForSelector(page, '#btnVerifyDomain_0');

            await init.pageClick(page, '#btnVerifyDomain_0');

            await init.pageWaitForSelector(page, '#confirmVerifyDomain');

            await init.pageClick(page, '#confirmVerifyDomain');
            // element will be visible once the domain was not verified
            const elem = await init.pageWaitForSelector(
                page,
                '#verifyDomainError',
                {
                    visible: true,
                    timeout: init.timeout,
                }
            );
            expect(elem).toBeDefined();
            done();
        },
        operationTimeOut
    );

    test(
        'should delete a domain in a status page',
        async (done: $TSFixMe) => {
            await gotoTheFirstStatusPage(page);

            await init.pageClick(page, '.custom-domains-tab');
            await init.pageWaitForSelector(
                page,
                'fieldset[name="added-domain"]',
                {
                    visible: true,
                    timeout: init.timeout,
                }
            );

            //Get the initial length of domains
            const initialLength = await init.page$$Eval(
                page,
                'fieldset[name="added-domain"]',
                (domains: $TSFixMe) => domains.length
            );

            // create one more domain on the status page

            await init.pageWaitForSelector(page, '#addMoreDomain');

            await init.pageClick(page, '#addMoreDomain');
            await init.pageWaitForSelector(page, '#addMoreDomainModal', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageType(
                page,
                '#customDomain',
                `app.${customDomain}.com`
            );

            await init.pageClick(page, '#createCustomDomainBtn');
            await init.pageWaitForSelector(page, '#addMoreDomainModal', {
                hidden: true,
            });
            await page.reload({ waitUntil: 'networkidle2' });

            await init.pageClick(page, '.custom-domains-tab');

            await init.pageWaitForSelector(page, '#btnDeleteDomain_0');
            await init.page$Eval(page, '#btnDeleteDomain_0', (elem: $TSFixMe) =>
                elem.click()
            );
            await init.pageWaitForSelector(page, '#confirmDomainDelete', {
                visible: true,
                timeout: init.timeout,
            });
            await init.page$Eval(
                page,
                '#confirmDomainDelete',
                (elem: $TSFixMe) => elem.click()
            );
            await init.pageWaitForSelector(page, '#confirmDomainDelete', {
                hidden: true,
            });

            await page.reload({ waitUntil: 'networkidle2' });
            // get the final length of domains after deleting

            await init.pageClick(page, '.custom-domains-tab');

            await init.pageWaitForSelector(
                page,
                'fieldset[name="added-domain"]'
            );
            const finalLength = await init.page$$Eval(
                page,
                'fieldset[name="added-domain"]',
                (domains: $TSFixMe) => domains.length
            );

            expect(finalLength).toEqual(initialLength);
            done();
        },
        operationTimeOut
    );

    test(
        'should cancel deleting of a domain in a status page',
        async (done: $TSFixMe) => {
            await gotoTheFirstStatusPage(page);

            await init.pageClick(page, '.custom-domains-tab');

            await init.pageWaitForSelector(
                page,
                'fieldset[name="added-domain"]',
                {
                    visible: true,
                    timeout: init.timeout,
                }
            );
            //Get the initial length of domains
            const initialLength = await init.page$$Eval(
                page,
                'fieldset[name="added-domain"]',
                (domains: $TSFixMe) => domains.length
            );

            // create one more domain on the status page

            await init.pageWaitForSelector(page, '#addMoreDomain');

            await init.pageClick(page, '#addMoreDomain');
            await init.pageWaitForSelector(page, '#addMoreDomainModal', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageType(
                page,
                '#customDomain',
                `server.${customDomain}.com`
            );

            await init.pageClick(page, '#createCustomDomainBtn');
            await init.pageWaitForSelector(page, '#addMoreDomainModal', {
                hidden: true,
            });
            await page.reload({ waitUntil: 'networkidle2' });

            await init.pageClick(page, '.custom-domains-tab');

            await init.pageWaitForSelector(page, '#btnDeleteDomain_0');
            await init.page$Eval(page, '#btnDeleteDomain_0', (elem: $TSFixMe) =>
                elem.click()
            );
            await init.page$Eval(
                page,
                '#cancelDomainDelete',
                (elem: $TSFixMe) => elem.click()
            );

            await page.reload({ waitUntil: 'networkidle2' });

            await init.pageClick(page, '.custom-domains-tab');

            await init.pageWaitForSelector(
                page,
                'fieldset[name="added-domain"]'
            );
            // get the final length of domains after cancelling
            const finalLength = await init.page$$Eval(
                page,
                'fieldset[name="added-domain"]',
                (domains: $TSFixMe) => domains.length
            );

            expect(finalLength).toBeGreaterThan(initialLength);
            done();
        },
        operationTimeOut
    );
    // Test Split
});
