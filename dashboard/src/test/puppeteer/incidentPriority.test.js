const puppeteer = require('puppeteer');
const utils = require('./test-utils');
const init = require('./test-init');
const { Cluster } = require('puppeteer-cluster');

require('should');

// user credentials
const email = utils.generateRandomBusinessEmail();
const priorityName = utils.generateRandomString();
const newPriorityName = utils.generateRandomString();
const password = '1234567890';

describe('Incident Priority API', () => {
    const operationTimeOut = 500000;

    let cluster;

    beforeAll(async () => {
        jest.setTimeout(500000);

        cluster = await Cluster.launch({
            concurrency: Cluster.CONCURRENCY_PAGE,
            puppeteerOptions: utils.puppeteerLaunchConfig,
            puppeteer,
            timeout: utils.timeout,
        });

        cluster.on('taskerror', err => {
            throw err;
        });

        return await cluster.execute(null, async ({ page }) => {
            const user = {
                email,
                password,
            };
            await init.registerUser(user, page);            
        });
    });

    afterAll(async done => {
        await cluster.idle();
        await cluster.close();
        done();
    });

    test(
        'Should not remove the incident priority used by default.',
        async () => {
            return await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.DASHBOARD_URL, {
                    waitUntil: 'networkidle0',
                });
                await page.waitForSelector('#projectSettings');
                await page.click('#projectSettings');
                await page.waitForSelector('#more');
                await page.click('#more');
                await page.waitForSelector('#incidentSettings');
                await page.click('#incidentSettings');

                await page.waitForSelector('ul#customTabList > li', {
                    visible: true,
                });
                await page.$$eval('ul#customTabList > li', elems =>
                    elems[1].click()
                );

                const deleteButtonFirstRowIndentifier =
                    '#priorityDelete_High_0';
                await page.waitForSelector(deleteButtonFirstRowIndentifier);
                await page.click(deleteButtonFirstRowIndentifier);
                await page.waitForSelector('#message-modal-message');
                const warningMessage = await page.$eval(
                    '#message-modal-message',
                    e => e.textContent
                );
                expect(warningMessage).toEqual(
                    'This incident priority is marked as default and cannot be deleted.'
                );
            });
        },
        operationTimeOut
    );

    test(
        'Should create incident priority.',
        async () => {
            return await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.DASHBOARD_URL, {
                    waitUntil: 'networkidle0',
                });
                await page.waitForSelector('#projectSettings');
                await page.click('#projectSettings');
                await page.waitForSelector('#more');
                await page.click('#more');
                await page.waitForSelector('#incidentSettings');
                await page.click('#incidentSettings');

                await page.waitForSelector('ul#customTabList > li', {
                    visible: true,
                });
                await page.$$eval('ul#customTabList > li', elems =>
                    elems[1].click()
                );

                await page.waitForSelector('#addNewPriority');
                await page.click('#addNewPriority');
                await page.waitForSelector('#CreateIncidentPriority');
                await page.type('input[name=name]', priorityName);
                await page.click('#CreateIncidentPriority');
                await page.waitForSelector('#CreateIncidentPriority', {
                    hidden: true,
                });
                await page.reload({
                    waitUntil: 'networkidle0',
                });
                await page.waitForSelector('ul#customTabList > li', {
                    visible: true,
                });
                await page.$$eval('ul#customTabList > li', elems =>
                    elems[1].click()
                );
                // two incident priority is automatically added to a project
                // High incident priority is marked as default
                const lastRowFirstColumnIndentifier = `#priority_${priorityName}_2`;
                await page.waitForSelector(lastRowFirstColumnIndentifier);
                const content = await page.$eval(
                    lastRowFirstColumnIndentifier,
                    e => e.textContent
                );
                expect(content).toEqual(priorityName);
            });
        },
        operationTimeOut
    );

    test(
        'Should edit incident priority.',
        async () => {
            return await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.DASHBOARD_URL, {
                    waitUntil: 'networkidle0',
                });
                await page.waitForSelector('#projectSettings');
                await page.click('#projectSettings');
                await page.waitForSelector('#more');
                await page.click('#more');
                await page.waitForSelector('#incidentSettings');
                await page.click('#incidentSettings');

                await page.waitForSelector('ul#customTabList > li', {
                    visible: true,
                });
                await page.$$eval('ul#customTabList > li', elems =>
                    elems[1].click()
                );
                const editButtonLastRowIndentifier = `#priorityEdit_${priorityName}_2`;
                await page.waitForSelector(editButtonLastRowIndentifier);
                await page.click(editButtonLastRowIndentifier);
                await page.waitForSelector('#EditIncidentPriority');
                await page.click('input[name=name]', { clickCount: 3 });
                await page.keyboard.press('Backspace');
                await page.type('input[name=name]', newPriorityName);
                await page.click('#EditIncidentPriority');
                await page.waitForSelector('#EditIncidentPriority', {
                    hidden: true,
                });
                await page.reload({
                    waitUntil: 'networkidle0',
                });

                await page.waitForSelector('ul#customTabList > li', {
                    visible: true,
                });
                await page.$$eval('ul#customTabList > li', elems =>
                    elems[1].click()
                );
                const lastRowIndentifier = `#priority_${newPriorityName}_2`;
                await page.waitForSelector(lastRowIndentifier);
                const content = await page.$eval(
                    lastRowIndentifier,
                    e => e.textContent
                );
                expect(content).toEqual(newPriorityName);
            });
        },
        operationTimeOut
    );

    test(
        'Should delete incident priority.',
        async () => {
            return await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.DASHBOARD_URL, {
                    waitUntil: 'networkidle0',
                });
                await page.waitForSelector('#projectSettings');
                await page.click('#projectSettings');
                await page.waitForSelector('#more');
                await page.click('#more');
                await page.waitForSelector('#incidentSettings');
                await page.click('#incidentSettings');

                await page.waitForSelector('ul#customTabList > li', {
                    visible: true,
                });
                await page.$$eval('ul#customTabList > li', elems =>
                    elems[1].click()
                );

                const incidentPrioritiesCount = '#incidentPrioritiesCount';
                await page.waitForSelector(incidentPrioritiesCount);
                const incidentsCountBeforeDeletion = await page.$eval(
                    incidentPrioritiesCount,
                    e => e.textContent
                );
                expect(incidentsCountBeforeDeletion).toEqual('Page 1 of 1 (3 Priorities)');
                const deleteButtonLastRowIndentifier = `#priorityDelete_${newPriorityName}_2`;
                await page.click(deleteButtonLastRowIndentifier);
                await page.waitForSelector('#RemoveIncidentPriority');
                await page.click('#RemoveIncidentPriority');
                await page.waitForSelector('#RemoveIncidentPriority', {
                    hidden: true,
                });
                await page.reload({
                    waitUntil: 'networkidle0',
                });

                await page.waitForSelector('ul#customTabList > li', {
                    visible: true,
                });
                await page.$$eval('ul#customTabList > li', elems =>
                    elems[1].click()
                );
                await page.waitForSelector(incidentPrioritiesCount);
                const incidentsCountAfterDeletion = await page.$eval(
                    incidentPrioritiesCount,
                    e => e.textContent
                );
                expect(incidentsCountAfterDeletion).toEqual('Page 1 of 1 (2 Priorities)');
            });
        },
        operationTimeOut
    );

    test(
        'Should add multiple incidents and paginate priorities list.',
        async () => {
            return await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.DASHBOARD_URL, {
                    waitUntil: 'networkidle0',
                });
                await page.waitForSelector('#projectSettings');
                await page.click('#projectSettings');
                await page.waitForSelector('#more');
                await page.click('#more');
                await page.waitForSelector('#incidentSettings');
                await page.click('#incidentSettings');

                await page.waitForSelector('ul#customTabList > li', {
                    visible: true,
                });
                await page.$$eval('ul#customTabList > li', elems =>
                    elems[1].click()
                );
                // default priority
                await page.waitForSelector('#priority_High_0', {
                    visible: true,
                });
                const incidentPrioritiesCountIdentifier =
                    '#incidentPrioritiesCount';
                await page.waitForSelector(incidentPrioritiesCountIdentifier);
                let incidentPrioritiesCount = await page.$eval(
                    incidentPrioritiesCountIdentifier,
                    e => e.textContent
                );
                expect(incidentPrioritiesCount).toMatch('Page 1 of 1 (2 Priorities');

                for (let i = 0; i < 11; i++) {
                    await page.waitForSelector('#addNewPriority');
                    await page.click('#addNewPriority');
                    await page.waitForSelector('#CreateIncidentPriority');
                    await page.type(
                        'input[name=name]',
                        utils.generateRandomString()
                    );
                    await page.click('#CreateIncidentPriority');
                    await page.waitForSelector('#CreateIncidentPriority', {
                        hidden: true,
                    });
                }

                await page.reload({
                    waitUntil: 'networkidle0',
                });

                await page.waitForSelector('ul#customTabList > li', {
                    visible: true,
                });
                await page.$$eval('ul#customTabList > li', elems =>
                    elems[1].click()
                );

                // default priority
                await page.waitForSelector('#priority_High_0', {
                    visible: true,
                });

                await page.waitForSelector('#btnNext');
                await page.click('#btnNext');
                await page.waitForSelector(incidentPrioritiesCountIdentifier);                
                incidentPrioritiesCount = await page.$eval(
                    incidentPrioritiesCountIdentifier,
                    e => e.textContent
                );
                expect(incidentPrioritiesCount).toMatch('Page 2 of 2 (13 Priorities)');

                await page.waitForSelector('#btnPrev');
                await page.click('#btnPrev');
                await page.waitForSelector(incidentPrioritiesCountIdentifier);                
                incidentPrioritiesCount = await page.$eval(
                    incidentPrioritiesCountIdentifier,
                    e => e.textContent
                );
                expect(incidentPrioritiesCount).toMatch('Page 1 of 2 (13 Priorities)');
            });
        },
        operationTimeOut
    );
});
