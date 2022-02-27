// @ts-expect-error ts-migrate(2307) FIXME: Cannot find module 'puppeteer' or its correspondin... Remove this comment to see the full error message
import puppeteer from 'puppeteer';
import utils from '../../test-utils';
import init from '../../test-init';

require('should');
let browser: $TSFixMe, page: $TSFixMe;
// user credentials
const email = utils.generateRandomBusinessEmail();
const priorityName = utils.generateRandomString();
const newPriorityName = utils.generateRandomString();
const password = '1234567890';

// @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'describe'. Do you need to instal... Remove this comment to see the full error message
describe('Incident Priority API', () => {
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
    });

    // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'afterAll'.
    afterAll(async (done: $TSFixMe) => {
        await browser.close();
        done();
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test(
        'Should create incident priority.',
        async (done: $TSFixMe) => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: 'networkidle0',
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#projectSettings');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#projectSettings');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#more');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#more');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#incidentSettings');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#incidentSettings');

            await init.pageWaitForSelector(page, '.incident-priority-tab', {
                visible: true,
                timeout: init.timeout,
            });
            await init.page$$Eval(
                page,
                '.incident-priority-tab',
                (elems: $TSFixMe) => elems[0].click()
            );

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#addNewPriority');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#addNewPriority');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#CreateIncidentPriority');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await init.pageType(page, 'input[name=name]', priorityName);
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#CreateIncidentPriority');
            await init.pageWaitForSelector(page, '#CreateIncidentPriority', {
                hidden: true,
            });
            await page.reload({
                waitUntil: 'networkidle0',
            });
            await init.pageWaitForSelector(page, '.incident-priority-tab', {
                visible: true,
                timeout: init.timeout,
            });
            await init.page$$Eval(
                page,
                '.incident-priority-tab',
                (elems: $TSFixMe) => elems[0].click()
            );
            // two incident priority is automatically added to a project
            // High incident priority is marked as default
            const lastRowFirstColumnIndentifier = `#priority_${priorityName}_2`;
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, lastRowFirstColumnIndentifier);
            const content = await init.page$Eval(
                page,
                lastRowFirstColumnIndentifier,
                (e: $TSFixMe) => e.textContent
            );
            expect(content).toEqual(priorityName);
            done();
        },
        operationTimeOut
    );

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test(
        'Should edit incident priority.',
        async (done: $TSFixMe) => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: 'networkidle0',
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#projectSettings');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#projectSettings');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#more');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#more');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#incidentSettings');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#incidentSettings');

            await init.pageWaitForSelector(page, '.incident-priority-tab', {
                visible: true,
                timeout: init.timeout,
            });
            await init.page$$Eval(
                page,
                '.incident-priority-tab',
                (elems: $TSFixMe) => elems[0].click()
            );
            const editButtonLastRowIndentifier = `#priorityEdit_${priorityName}_2`;
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, editButtonLastRowIndentifier);
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, editButtonLastRowIndentifier);
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#EditIncidentPriority');
            await init.pageClick(page, 'input[name=name]', { clickCount: 3 });
            await page.keyboard.press('Backspace');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
            await init.pageType(page, 'input[name=name]', newPriorityName);
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#EditIncidentPriority');
            await init.pageWaitForSelector(page, '#EditIncidentPriority', {
                hidden: true,
            });
            await page.reload({
                waitUntil: 'networkidle0',
            });

            await init.pageWaitForSelector(page, '.incident-priority-tab', {
                visible: true,
                timeout: init.timeout,
            });
            await init.page$$Eval(
                page,
                '.incident-priority-tab',
                (elems: $TSFixMe) => elems[0].click()
            );
            const lastRowIndentifier = `#priority_${newPriorityName}_2`;
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, lastRowIndentifier);
            const content = await init.page$Eval(
                page,
                lastRowIndentifier,
                (e: $TSFixMe) => e.textContent
            );
            expect(content).toEqual(newPriorityName);
            done();
        },
        operationTimeOut
    );

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test(
        'Should delete incident priority.',
        async (done: $TSFixMe) => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: 'networkidle0',
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#projectSettings');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#projectSettings');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#more');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#more');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#incidentSettings');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#incidentSettings');

            await init.pageWaitForSelector(page, '.incident-priority-tab', {
                visible: true,
                timeout: init.timeout,
            });
            await init.page$$Eval(
                page,
                '.incident-priority-tab',
                (elems: $TSFixMe) => elems[0].click()
            );
            const incidentPrioritiesCount = '#incidentPrioritiesCount';
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, incidentPrioritiesCount);
            const incidentsCountBeforeDeletion = await init.page$Eval(
                page,
                incidentPrioritiesCount,
                (e: $TSFixMe) => e.textContent
            );
            expect(incidentsCountBeforeDeletion).toEqual(
                'Page 1 of 1 (3 Priorities)'
            );
            const deleteButtonLastRowIndentifier = `#priorityDelete_${newPriorityName}_2`;
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, deleteButtonLastRowIndentifier);
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#RemoveIncidentPriority');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#RemoveIncidentPriority');
            await init.pageWaitForSelector(page, '#RemoveIncidentPriority', {
                hidden: true,
            });
            await page.reload({
                waitUntil: 'networkidle0',
            });

            await init.pageWaitForSelector(page, '.incident-priority-tab', {
                visible: true,
                timeout: init.timeout,
            });
            await init.page$$Eval(
                page,
                '.incident-priority-tab',
                (elems: $TSFixMe) => elems[0].click()
            );
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, incidentPrioritiesCount);
            const incidentsCountAfterDeletion = await init.page$Eval(
                page,
                incidentPrioritiesCount,
                (e: $TSFixMe) => e.textContent
            );
            expect(incidentsCountAfterDeletion).toEqual(
                'Page 1 of 1 (2 Priorities)'
            );
            done();
        },
        operationTimeOut
    );

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test(
        'Should add multiple incidents and paginate priorities list.',
        async (done: $TSFixMe) => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: 'networkidle0',
            });
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#projectSettings');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#projectSettings');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#more');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#more');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#incidentSettings');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#incidentSettings');

            await init.pageWaitForSelector(page, '.incident-priority-tab', {
                visible: true,
                timeout: init.timeout,
            });
            await init.page$$Eval(
                page,
                '.incident-priority-tab',
                (elems: $TSFixMe) => elems[0].click()
            );
            // default priority
            await init.pageWaitForSelector(page, '#priorities', {
                visible: true,
                timeout: init.timeout,
            });
            const incidentPrioritiesCountIdentifier =
                '#incidentPrioritiesCount';
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(
                page,
                incidentPrioritiesCountIdentifier
            );
            let incidentPrioritiesCount = await init.page$Eval(
                page,
                incidentPrioritiesCountIdentifier,
                (e: $TSFixMe) => e.textContent
            );
            expect(incidentPrioritiesCount).toMatch(
                'Page 1 of 1 (2 Priorities)'
            );

            for (let i = 0; i < 11; i++) {
                // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
                await init.pageWaitForSelector(page, '#addNewPriority');
                // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
                await init.pageClick(page, '#addNewPriority');
                // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
                await init.pageWaitForSelector(page, '#CreateIncidentPriority');
                // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
                await init.pageType(
                    page,
                    'input[name=name]',
                    utils.generateRandomString()
                );
                // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
                await init.pageClick(page, '#CreateIncidentPriority');
                await init.pageWaitForSelector(
                    page,
                    '#CreateIncidentPriority',
                    {
                        hidden: true,
                    }
                );
            }

            await page.reload({
                waitUntil: 'networkidle0',
            });

            await init.pageWaitForSelector(page, '.incident-priority-tab', {
                visible: true,
                timeout: init.timeout,
            });
            await init.page$$Eval(
                page,
                '.incident-priority-tab',
                (elems: $TSFixMe) => elems[0].click()
            );

            // default priority
            await init.pageWaitForSelector(page, '#priorities', {
                visible: true,
                timeout: init.timeout,
            });

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#btnNext');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#btnNext');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(
                page,
                incidentPrioritiesCountIdentifier
            );
            incidentPrioritiesCount = await init.page$Eval(
                page,
                incidentPrioritiesCountIdentifier,
                (e: $TSFixMe) => e.textContent
            );
            expect(incidentPrioritiesCount).toMatch(
                'Page 2 of 2 (13 Priorities)'
            );

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(page, '#btnPrev');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageClick(page, '#btnPrev');
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            await init.pageWaitForSelector(
                page,
                incidentPrioritiesCountIdentifier
            );
            incidentPrioritiesCount = await init.page$Eval(
                page,
                incidentPrioritiesCountIdentifier,
                (e: $TSFixMe) => e.textContent
            );
            expect(incidentPrioritiesCount).toMatch(
                'Page 1 of 2 (13 Priorities)'
            );
            done();
        },
        operationTimeOut
    );
});
