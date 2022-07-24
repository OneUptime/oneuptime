import puppeteer from 'puppeteer';
import Email from 'Common/Types/Email';
import utils from '../../test-utils';
import init from '../../test-init';

import 'should';
let browser: $TSFixMe, page: $TSFixMe;
// User credentials
const email: Email = utils.generateRandomBusinessEmail();
const priorityName: string = utils.generateRandomString();
const newPriorityName: string = utils.generateRandomString();
const password = '1234567890';

describe('Incident Priority API', () => {
    const operationTimeOut: $TSFixMe = init.timeout;

    beforeAll(async () => {
        jest.setTimeout(init.timeout);

        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(utils.agent);

        const user: $TSFixMe = {
            email,
            password,
        };
        await init.registerUser(user, page);
    });

    afterAll(async (done: $TSFixMe) => {
        await browser.close();
        done();
    });

    test(
        'Should create incident priority.',
        async (done: $TSFixMe) => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: 'networkidle0',
            });

            await init.pageWaitForSelector(page, '#projectSettings');

            await init.pageClick(page, '#projectSettings');

            await init.pageWaitForSelector(page, '#more');

            await init.pageClick(page, '#more');

            await init.pageWaitForSelector(page, '#incidentSettings');

            await init.pageClick(page, '#incidentSettings');

            await init.pageWaitForSelector(page, '.incident-priority-tab', {
                visible: true,
                timeout: init.timeout,
            });
            await init.page$$Eval(
                page,
                '.incident-priority-tab',
                (elems: $TSFixMe) => {
                    return elems[0].click();
                }
            );

            await init.pageWaitForSelector(page, '#addNewPriority');

            await init.pageClick(page, '#addNewPriority');

            await init.pageWaitForSelector(page, '#CreateIncidentPriority');

            await init.pageType(page, 'input[name=name]', priorityName);

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
                (elems: $TSFixMe) => {
                    return elems[0].click();
                }
            );
            /*
             * Two incident priority is automatically added to a project
             * High incident priority is marked as default
             */
            const lastRowFirstColumnIndentifier = `#priority_${priorityName}_2`;

            await init.pageWaitForSelector(page, lastRowFirstColumnIndentifier);
            const content: $TSFixMe = await init.page$Eval(
                page,
                lastRowFirstColumnIndentifier,
                (e: $TSFixMe) => {
                    return e.textContent;
                }
            );
            expect(content).toEqual(priorityName);
            done();
        },
        operationTimeOut
    );

    test(
        'Should edit incident priority.',
        async (done: $TSFixMe) => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: 'networkidle0',
            });

            await init.pageWaitForSelector(page, '#projectSettings');

            await init.pageClick(page, '#projectSettings');

            await init.pageWaitForSelector(page, '#more');

            await init.pageClick(page, '#more');

            await init.pageWaitForSelector(page, '#incidentSettings');

            await init.pageClick(page, '#incidentSettings');

            await init.pageWaitForSelector(page, '.incident-priority-tab', {
                visible: true,
                timeout: init.timeout,
            });
            await init.page$$Eval(
                page,
                '.incident-priority-tab',
                (elems: $TSFixMe) => {
                    return elems[0].click();
                }
            );
            const editButtonLastRowIndentifier = `#priorityEdit_${priorityName}_2`;

            await init.pageWaitForSelector(page, editButtonLastRowIndentifier);

            await init.pageClick(page, editButtonLastRowIndentifier);

            await init.pageWaitForSelector(page, '#EditIncidentPriority');
            await init.pageClick(page, 'input[name=name]', { clickCount: 3 });
            await page.keyboard.press('Backspace');

            await init.pageType(page, 'input[name=name]', newPriorityName);

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
                (elems: $TSFixMe) => {
                    return elems[0].click();
                }
            );
            const lastRowIndentifier = `#priority_${newPriorityName}_2`;

            await init.pageWaitForSelector(page, lastRowIndentifier);
            const content: $TSFixMe = await init.page$Eval(
                page,
                lastRowIndentifier,
                (e: $TSFixMe) => {
                    return e.textContent;
                }
            );
            expect(content).toEqual(newPriorityName);
            done();
        },
        operationTimeOut
    );

    test(
        'Should delete incident priority.',
        async (done: $TSFixMe) => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: 'networkidle0',
            });

            await init.pageWaitForSelector(page, '#projectSettings');

            await init.pageClick(page, '#projectSettings');

            await init.pageWaitForSelector(page, '#more');

            await init.pageClick(page, '#more');

            await init.pageWaitForSelector(page, '#incidentSettings');

            await init.pageClick(page, '#incidentSettings');

            await init.pageWaitForSelector(page, '.incident-priority-tab', {
                visible: true,
                timeout: init.timeout,
            });
            await init.page$$Eval(
                page,
                '.incident-priority-tab',
                (elems: $TSFixMe) => {
                    return elems[0].click();
                }
            );
            const incidentPrioritiesCount = '#incidentPrioritiesCount';

            await init.pageWaitForSelector(page, incidentPrioritiesCount);
            const incidentsCountBeforeDeletion: $TSFixMe = await init.page$Eval(
                page,
                incidentPrioritiesCount,
                (e: $TSFixMe) => {
                    return e.textContent;
                }
            );
            expect(incidentsCountBeforeDeletion).toEqual(
                'Page 1 of 1 (3 Priorities)'
            );
            const deleteButtonLastRowIndentifier = `#priorityDelete_${newPriorityName}_2`;

            await init.pageClick(page, deleteButtonLastRowIndentifier);

            await init.pageWaitForSelector(page, '#RemoveIncidentPriority');

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
                (elems: $TSFixMe) => {
                    return elems[0].click();
                }
            );

            await init.pageWaitForSelector(page, incidentPrioritiesCount);
            const incidentsCountAfterDeletion: $TSFixMe = await init.page$Eval(
                page,
                incidentPrioritiesCount,
                (e: $TSFixMe) => {
                    return e.textContent;
                }
            );
            expect(incidentsCountAfterDeletion).toEqual(
                'Page 1 of 1 (2 Priorities)'
            );
            done();
        },
        operationTimeOut
    );

    test(
        'Should add multiple incidents and paginate priorities list.',
        async (done: $TSFixMe) => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: 'networkidle0',
            });

            await init.pageWaitForSelector(page, '#projectSettings');

            await init.pageClick(page, '#projectSettings');

            await init.pageWaitForSelector(page, '#more');

            await init.pageClick(page, '#more');

            await init.pageWaitForSelector(page, '#incidentSettings');

            await init.pageClick(page, '#incidentSettings');

            await init.pageWaitForSelector(page, '.incident-priority-tab', {
                visible: true,
                timeout: init.timeout,
            });
            await init.page$$Eval(
                page,
                '.incident-priority-tab',
                (elems: $TSFixMe) => {
                    return elems[0].click();
                }
            );
            // Default priority
            await init.pageWaitForSelector(page, '#priorities', {
                visible: true,
                timeout: init.timeout,
            });
            const incidentPrioritiesCountIdentifier: $TSFixMe =
                '#incidentPrioritiesCount';

            await init.pageWaitForSelector(
                page,
                incidentPrioritiesCountIdentifier
            );
            let incidentPrioritiesCount: $TSFixMe = await init.page$Eval(
                page,
                incidentPrioritiesCountIdentifier,
                (e: $TSFixMe) => {
                    return e.textContent;
                }
            );
            expect(incidentPrioritiesCount).toMatch(
                'Page 1 of 1 (2 Priorities)'
            );

            for (let i: $TSFixMe = 0; i < 11; i++) {
                await init.pageWaitForSelector(page, '#addNewPriority');

                await init.pageClick(page, '#addNewPriority');

                await init.pageWaitForSelector(page, '#CreateIncidentPriority');

                await init.pageType(
                    page,
                    'input[name=name]',
                    utils.generateRandomString()
                );

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
                (elems: $TSFixMe) => {
                    return elems[0].click();
                }
            );

            // Default priority
            await init.pageWaitForSelector(page, '#priorities', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageWaitForSelector(page, '#btnNext');

            await init.pageClick(page, '#btnNext');

            await init.pageWaitForSelector(
                page,
                incidentPrioritiesCountIdentifier
            );
            incidentPrioritiesCount = await init.page$Eval(
                page,
                incidentPrioritiesCountIdentifier,
                (e: $TSFixMe) => {
                    return e.textContent;
                }
            );
            expect(incidentPrioritiesCount).toMatch(
                'Page 2 of 2 (13 Priorities)'
            );

            await init.pageWaitForSelector(page, '#btnPrev');

            await init.pageClick(page, '#btnPrev');

            await init.pageWaitForSelector(
                page,
                incidentPrioritiesCountIdentifier
            );
            incidentPrioritiesCount = await init.page$Eval(
                page,
                incidentPrioritiesCountIdentifier,
                (e: $TSFixMe) => {
                    return e.textContent;
                }
            );
            expect(incidentPrioritiesCount).toMatch(
                'Page 1 of 2 (13 Priorities)'
            );
            done();
        },
        operationTimeOut
    );
});
