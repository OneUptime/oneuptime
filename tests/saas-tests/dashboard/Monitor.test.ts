// @ts-expect-error ts-migrate(2307) FIXME: Cannot find module 'puppeteer' or its correspondin... Remove this comment to see the full error message
import puppeteer from 'puppeteer'
import utils from '../../test-utils'
import init from '../../test-init'

let browser: $TSFixMe, page: $TSFixMe;
require('should');

// user credentials
const email = utils.generateRandomBusinessEmail();
const password = '1234567890';
const componentName = utils.generateRandomString();
const monitorName = utils.generateRandomString();

// @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'describe'. Do you need to instal... Remove this comment to see the full error message
describe('Monitor API', () => {
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
        await init.registerUser(user, page);
        await init.addMonitorToComponent(componentName, monitorName, page); // This creates a default component and a monitor. The monitor created here will be used by other tests as required
    });

    // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'afterAll'.
    afterAll(async (done: $TSFixMe) => {
        await browser.close();
        done();
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test(
        'Should create new monitor with default criteria settings',
        async (done: $TSFixMe) => {
            // Component is already created.
            await init.navigateToComponentDetails(componentName, page);
            const monitorName = utils.generateRandomString();

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#cbMonitors');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
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
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, 'input[id=name]');
            await page.focus('input[id=name]');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await init.pageType(page, 'input[id=name]', monitorName);
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '[data-testId=type_url]');
            await init.pageWaitForSelector(page, '#url', {
                visible: true,
                timeout: init.timeout,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#url');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await init.pageType(page, '#url', 'https://google.com');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, 'button[type=submit]');

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
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

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test(
        'Should create new monitor with edited criteria names',
        async (done: $TSFixMe) => {
            // Component is already created.
            await init.navigateToComponentDetails(componentName, page);
            const monitorName = utils.generateRandomString();

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#cbMonitors');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#newFormId');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#form-new-monitor');
            await init.pageWaitForSelector(page, 'input[id=name]', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageWaitForSelector(page, 'input[id=name]', {
                visible: true,
                timeout: init.timeout,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, 'input[id=name]');
            await page.focus('input[id=name]');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await init.pageType(page, 'input[id=name]', monitorName);
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, 'input[data-testId=type_url]');
            await init.pageWaitForSelector(page, '#url', {
                visible: true,
                timeout: init.timeout,
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#url');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await init.pageType(page, '#url', 'https://google.com');

            // change up criterion's name
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#advanceOptions');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            let criterionAdvancedOptions = await init.pageWaitForSelector(
                page,
                '[data-testId=criterionAdvancedOptions_up]'
            );
            await criterionAdvancedOptions.click();
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, 'input[id^=name_up]');
            await init.pageClick(page, 'input[id^=name_up]', { clickCount: 3 });
            const upCriterionName = 'Monitor Online';
            await page.keyboard.type(upCriterionName);

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, 'button[type=submit]');

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            let spanElement = await init.pageWaitForSelector(
                page,
                `#monitor-title-${monitorName}`
            );
            spanElement = await spanElement.getProperty('innerText');
            spanElement = await spanElement.jsonValue();
            spanElement.should.be.exactly(monitorName);

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, `#edit_${monitorName}`);
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#advanceOptions');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            criterionAdvancedOptions = await init.pageWaitForSelector(
                page,
                '[data-testId=criterionAdvancedOptions_up]'
            );
            await criterionAdvancedOptions.click();
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
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

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test('Should create new monitor with multiple criteria on each category', async (done: $TSFixMe) => {
        // Component is already created.
        await init.navigateToComponentDetails(componentName, page);
        const monitorName = utils.generateRandomString();

        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await init.pageWaitForSelector(page, '#cbMonitors');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await init.pageClick(page, '#newFormId');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await init.pageWaitForSelector(page, '#form-new-monitor');
        await init.pageWaitForSelector(page, 'input[id=name]', {
            visible: true,
            timeout: init.timeout,
        });
        await init.pageWaitForSelector(page, 'input[id=name]', {
            visible: true,
            timeout: init.timeout,
        });
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await init.pageClick(page, 'input[id=name]');
        await page.focus('input[id=name]');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
        await init.pageType(page, 'input[id=name]', monitorName);
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await init.pageClick(page, 'input[data-testId=type_url]');
        await init.pageWaitForSelector(page, '#url', {
            visible: true,
            timeout: init.timeout,
        });
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await init.pageClick(page, '#url');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
        await init.pageType(page, '#url', 'https://google.com');

        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await init.pageClick(page, '#advanceOptions');

        // add up criterion
        expect(
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            (await init.page$$(page, '[data-testId^=single_criterion_up'))
                .length
        ).toEqual(1);

        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        let criterionAdvancedOption = await init.pageWaitForSelector(
            page,
            '[data-testId=criterionAdvancedOptions_up]'
        );
        await criterionAdvancedOption.click();

        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await init.pageClick(page, '[data-testId=add_criteria_up]');
        expect(
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            (await init.page$$(page, '[data-testId^=single_criterion_up'))
                .length
        ).toEqual(2);

        // add degraded criterion
        expect(
            (
                // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
                await init.page$$(
                    page,
                    '[data-testId^=single_criterion_degraded]'
                )
            ).length
        ).toEqual(1);

        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        criterionAdvancedOption = await init.page$(
            page,
            '[data-testId=criterionAdvancedOptions_degraded]'
        );
        await criterionAdvancedOption.click();

        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await init.pageClick(page, '[data-testId=add_criteria_degraded]');
        expect(
            (
                // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
                await init.page$$(
                    page,
                    '[data-testId^=single_criterion_degraded]'
                )
            ).length
        ).toEqual(2);

        // add down criterion
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        criterionAdvancedOption = await init.page$(
            page,
            '[data-testId=criterionAdvancedOptions_down]'
        );
        await criterionAdvancedOption.click();

        expect(
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            (await init.page$$(page, '[data-testId^=single_criterion_down]'))
                .length
        ).toEqual(1);

        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await init.pageClick(page, '[data-testId=add_criteria_down]');
        expect(
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            (await init.page$$(page, '[data-testId^=single_criterion_down]'))
                .length
        ).toEqual(2);

        // add the monitor and check if the criteria are persisted
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await init.pageClick(page, 'button[type=submit]');

        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        let spanElement = await init.pageWaitForSelector(
            page,
            `#monitor-title-${monitorName}`
        );
        spanElement = await spanElement.getProperty('innerText');
        spanElement = await spanElement.jsonValue();
        spanElement.should.be.exactly(monitorName);

        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await init.pageClick(page, `#edit_${monitorName}`);
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await init.pageClick(page, '#advanceOptions');
        // for up criteria
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await init.pageWaitForSelector(
            page,
            '[data-testId^=single_criterion_up]'
        );
        expect(
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            (await init.page$$(page, '[data-testId^=single_criterion_up'))
                .length
        ).toEqual(2);

        // for degraded criteria
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await init.pageWaitForSelector(
            page,
            '[data-testId^=single_criterion_degraded]'
        );
        expect(
            (
                // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
                await init.page$$(
                    page,
                    '[data-testId^=single_criterion_degraded]'
                )
            ).length
        ).toEqual(2);
        // for down criteria
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await init.pageWaitForSelector(
            page,
            '[data-testId^=single_criterion_down]'
        );
        expect(
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            (await init.page$$(page, '[data-testId^=single_criterion_down]'))
                .length
        ).toEqual(2);
        done();
    });
});
