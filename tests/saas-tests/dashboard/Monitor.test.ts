
import puppeteer from 'puppeteer';
import utils from '../../test-utils';
import init from '../../test-init';

let browser: $TSFixMe, page: $TSFixMe;
require('should');

// user credentials
const email = utils.generateRandomBusinessEmail();
const password = '1234567890';
const componentName = utils.generateRandomString();
const monitorName = utils.generateRandomString();


describe('Monitor API', () => {
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
        await init.registerUser(user, page);
        await init.addMonitorToComponent(componentName, monitorName, page); // This creates a default component and a monitor. The monitor created here will be used by other tests as required
    });

    
    afterAll(async (done: $TSFixMe) => {
        await browser.close();
        done();
    });

    
    test(
        'Should create new monitor with default criteria settings',
        async (done: $TSFixMe) => {
            // Component is already created.
            await init.navigateToComponentDetails(componentName, page);
            const monitorName = utils.generateRandomString();

            
            await init.pageWaitForSelector(page, '#cbMonitors');
            
            await init.pageClick(page, '#newFormId');
            await init.pageWaitForSelector(page, '#form-new-monitor', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageWaitForSelector(page, 'input[id=name]', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageWaitForSelector(page, 'input[id=name]', {
                visible: true,
                timeout: init.timeout,
            });
            
            await init.pageClick(page, 'input[id=name]');
            await page.focus('input[id=name]');
            
            await init.pageType(page, 'input[id=name]', monitorName);
            
            await init.pageClick(page, '[data-testId=type_url]');
            await init.pageWaitForSelector(page, '#url', {
                visible: true,
                timeout: init.timeout,
            });
            
            await init.pageClick(page, '#url');
            
            await init.pageType(page, '#url', 'https://google.com');
            
            await init.pageClick(page, 'button[type=submit]');

            
            let spanElement = await init.pageWaitForSelector(
                page,
                `#monitor-title-${monitorName}`
            );
            spanElement = await spanElement.getProperty('innerText');
            spanElement = await spanElement.jsonValue();
            spanElement.should.be.exactly(monitorName);
            done();
        },
        operationTimeOut
    );

    
    test(
        'Should create new monitor with edited criteria names',
        async (done: $TSFixMe) => {
            // Component is already created.
            await init.navigateToComponentDetails(componentName, page);
            const monitorName = utils.generateRandomString();

            
            await init.pageWaitForSelector(page, '#cbMonitors');
            
            await init.pageClick(page, '#newFormId');
            
            await init.pageWaitForSelector(page, '#form-new-monitor');
            await init.pageWaitForSelector(page, 'input[id=name]', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageWaitForSelector(page, 'input[id=name]', {
                visible: true,
                timeout: init.timeout,
            });
            
            await init.pageClick(page, 'input[id=name]');
            await page.focus('input[id=name]');
            
            await init.pageType(page, 'input[id=name]', monitorName);
            
            await init.pageClick(page, 'input[data-testId=type_url]');
            await init.pageWaitForSelector(page, '#url', {
                visible: true,
                timeout: init.timeout,
            });
            
            await init.pageClick(page, '#url');
            
            await init.pageType(page, '#url', 'https://google.com');

            // change up criterion's name
            
            await init.pageClick(page, '#advanceOptions');
            
            let criterionAdvancedOptions = await init.pageWaitForSelector(
                page,
                '[data-testId=criterionAdvancedOptions_up]'
            );
            await criterionAdvancedOptions.click();
            
            await init.pageWaitForSelector(page, 'input[id^=name_up]');
            await init.pageClick(page, 'input[id^=name_up]', { clickCount: 3 });
            const upCriterionName = 'Monitor Online';
            await page.keyboard.type(upCriterionName);

            
            await init.pageClick(page, 'button[type=submit]');

            
            let spanElement = await init.pageWaitForSelector(
                page,
                `#monitor-title-${monitorName}`
            );
            spanElement = await spanElement.getProperty('innerText');
            spanElement = await spanElement.jsonValue();
            spanElement.should.be.exactly(monitorName);

            
            await init.pageClick(page, `#edit_${monitorName}`);
            
            await init.pageClick(page, '#advanceOptions');
            
            criterionAdvancedOptions = await init.pageWaitForSelector(
                page,
                '[data-testId=criterionAdvancedOptions_up]'
            );
            await criterionAdvancedOptions.click();
            
            await init.pageWaitForSelector(page, 'input[id^=name_up]');
            const criterionName = await init.page$Eval(
                page,
                'input[id^=name_up]',
                (el: $TSFixMe) => el.value
            );
            expect(criterionName).toEqual(upCriterionName);
            done();
        },
        operationTimeOut
    );

    
    test('Should create new monitor with multiple criteria on each category', async (done: $TSFixMe) => {
        // Component is already created.
        await init.navigateToComponentDetails(componentName, page);
        const monitorName = utils.generateRandomString();

        
        await init.pageWaitForSelector(page, '#cbMonitors');
        
        await init.pageClick(page, '#newFormId');
        
        await init.pageWaitForSelector(page, '#form-new-monitor');
        await init.pageWaitForSelector(page, 'input[id=name]', {
            visible: true,
            timeout: init.timeout,
        });
        await init.pageWaitForSelector(page, 'input[id=name]', {
            visible: true,
            timeout: init.timeout,
        });
        
        await init.pageClick(page, 'input[id=name]');
        await page.focus('input[id=name]');
        
        await init.pageType(page, 'input[id=name]', monitorName);
        
        await init.pageClick(page, 'input[data-testId=type_url]');
        await init.pageWaitForSelector(page, '#url', {
            visible: true,
            timeout: init.timeout,
        });
        
        await init.pageClick(page, '#url');
        
        await init.pageType(page, '#url', 'https://google.com');

        
        await init.pageClick(page, '#advanceOptions');

        // add up criterion
        expect(
            
            (await init.page$$(page, '[data-testId^=single_criterion_up'))
                .length
        ).toEqual(1);

        
        let criterionAdvancedOption = await init.pageWaitForSelector(
            page,
            '[data-testId=criterionAdvancedOptions_up]'
        );
        await criterionAdvancedOption.click();

        
        await init.pageClick(page, '[data-testId=add_criteria_up]');
        expect(
            
            (await init.page$$(page, '[data-testId^=single_criterion_up'))
                .length
        ).toEqual(2);

        // add degraded criterion
        expect(
            
            (
                await init.page$$(
                    page,
                    '[data-testId^=single_criterion_degraded]'
                )
            ).length
        ).toEqual(1);

        
        criterionAdvancedOption = await init.page$(
            page,
            '[data-testId=criterionAdvancedOptions_degraded]'
        );
        await criterionAdvancedOption.click();

        
        await init.pageClick(page, '[data-testId=add_criteria_degraded]');
        expect(
            
            (
                await init.page$$(
                    page,
                    '[data-testId^=single_criterion_degraded]'
                )
            ).length
        ).toEqual(2);

        // add down criterion
        
        criterionAdvancedOption = await init.page$(
            page,
            '[data-testId=criterionAdvancedOptions_down]'
        );
        await criterionAdvancedOption.click();

        expect(
            
            (await init.page$$(page, '[data-testId^=single_criterion_down]'))
                .length
        ).toEqual(1);

        
        await init.pageClick(page, '[data-testId=add_criteria_down]');
        expect(
            
            (await init.page$$(page, '[data-testId^=single_criterion_down]'))
                .length
        ).toEqual(2);

        // add the monitor and check if the criteria are persisted
        
        await init.pageClick(page, 'button[type=submit]');

        
        let spanElement = await init.pageWaitForSelector(
            page,
            `#monitor-title-${monitorName}`
        );
        spanElement = await spanElement.getProperty('innerText');
        spanElement = await spanElement.jsonValue();
        spanElement.should.be.exactly(monitorName);

        
        await init.pageClick(page, `#edit_${monitorName}`);
        
        await init.pageClick(page, '#advanceOptions');
        // for up criteria
        
        await init.pageWaitForSelector(
            page,
            '[data-testId^=single_criterion_up]'
        );
        expect(
            
            (await init.page$$(page, '[data-testId^=single_criterion_up'))
                .length
        ).toEqual(2);

        // for degraded criteria
        
        await init.pageWaitForSelector(
            page,
            '[data-testId^=single_criterion_degraded]'
        );
        expect(
            
            (
                await init.page$$(
                    page,
                    '[data-testId^=single_criterion_degraded]'
                )
            ).length
        ).toEqual(2);
        // for down criteria
        
        await init.pageWaitForSelector(
            page,
            '[data-testId^=single_criterion_down]'
        );
        expect(
            
            (await init.page$$(page, '[data-testId^=single_criterion_down]'))
                .length
        ).toEqual(2);
        done();
    });
});
