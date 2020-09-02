const puppeteer = require('puppeteer');
const utils = require('./test-utils');
const init = require('./test-init');
const { Cluster } = require('puppeteer-cluster');

require('should');

// user credentials
const email = utils.generateRandomBusinessEmail();
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
            await init.loginUser(user, page);
        });
    });

    afterAll(async () => {
        await cluster.idle();
        await cluster.close();
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
                await page.waitForSelector('#incidentSettings');
                await page.click('#incidentSettings');
                const deleteButtonFirstRowIndentifier =
                    '#incidentPrioritiesList>div>div>div>div.bs-ObjectList-row:first-of-type>div:nth-child(2)>div>div:nth-child(2)>button';
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
                const priorityName = utils.generateRandomString();
                await page.goto(utils.DASHBOARD_URL, {
                    waitUntil: 'networkidle0',
                });
                await page.waitForSelector('#projectSettings');
                await page.click('#projectSettings');
                await page.waitForSelector('#incidentSettings');
                await page.click('#incidentSettings');
                await page.waitForSelector('#addNewPriority');
                await page.click('#addNewPriority');
                await page.waitForSelector('#CreateIncidentPriority');
                await page.type('input[name=name]', priorityName);
                await page.click('#CreateIncidentPriority');
                await page.waitFor(3000);
                await page.reload({
                    waitUntil: 'networkidle0',
                });
                const lastRowFirstColumnIndentifier =
                    '#incidentPrioritiesList>div>div>div>div.bs-ObjectList-row:last-of-type>div:first-child';
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
                const newPriorityName = utils.generateRandomString();
                await page.goto(utils.DASHBOARD_URL, {
                    waitUntil: 'networkidle0',
                });
                await page.waitForSelector('#projectSettings');
                await page.click('#projectSettings');
                await page.waitForSelector('#incidentSettings');
                await page.click('#incidentSettings');
                const editButtonLastRowIndentifier =
                    '#incidentPrioritiesList>div>div>div>div.bs-ObjectList-row:last-of-type>div:nth-child(2)>div>div:first-child>button';
                await page.waitForSelector(editButtonLastRowIndentifier);
                await page.click(editButtonLastRowIndentifier);
                await page.waitForSelector('#EditIncidentPriority');
                await page.click('input[name=name]', { clickCount: 3 });
                await page.keyboard.press('Backspace');
                await page.type('input[name=name]', newPriorityName);
                await page.click('#EditIncidentPriority');
                await page.waitFor(3000);
                await page.reload({
                    waitUntil: 'networkidle0',
                });
                const lastRowIndentifier =
                    '#incidentPrioritiesList>div>div>div>div.bs-ObjectList-row:last-of-type>div:first-child';
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
                await page.waitForSelector('#incidentSettings');
                await page.click('#incidentSettings');
                await page.waitFor(3000);
                const incidentPrioritiesCount = '#incidentPrioritiesCount';
                await page.waitForSelector(incidentPrioritiesCount);
                const incidentsCountBeforeDeletion = await page.$eval(
                    incidentPrioritiesCount,
                    e => e.textContent
                );
                expect(incidentsCountBeforeDeletion).toEqual('3 Priorities');
                const deleteButtonLastRowIndentifier =
                    '#incidentPrioritiesList>div>div>div>div.bs-ObjectList-row:last-of-type>div:nth-child(2)>div>div:nth-child(2)>button';
                await page.click(deleteButtonLastRowIndentifier);
                await page.waitForSelector('#RemoveIncidentPriority');
                await page.click('#RemoveIncidentPriority');
                await page.waitFor(3000);
                await page.reload({
                    waitUntil: 'networkidle0',
                });
                await page.waitFor(3000);
                const incidentsCountAfterDeletion = await page.$eval(
                    incidentPrioritiesCount,
                    e => e.textContent
                );
                expect(incidentsCountAfterDeletion).toEqual('2 Priorities');
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
                await page.waitForSelector('#incidentSettings');
                await page.click('#incidentSettings');
                const incidentPrioritiesCountIdentifier =
                    '#incidentPrioritiesCount';
                await page.waitForSelector(incidentPrioritiesCountIdentifier);
                let incidentPrioritiesCount = await page.$eval(
                    incidentPrioritiesCountIdentifier,
                    e => e.textContent
                );
                expect(incidentPrioritiesCount).toEqual('2 Priorities');

                for (let i = 0; i < 11; i++) {
                    await page.waitForSelector('#addNewPriority');
                    await page.click('#addNewPriority');
                    await page.waitForSelector('#CreateIncidentPriority');
                    await page.type(
                        'input[name=name]',
                        utils.generateRandomString()
                    );
                    await page.click('#CreateIncidentPriority');
                }

                await page.reload({
                    waitUntil: 'networkidle0',
                });
                await page.waitFor(3000);

                await page.waitForSelector('#btnNext');
                await page.click('#btnNext');
                await page.waitFor(3000);
                incidentPrioritiesCount = await page.$eval(
                    incidentPrioritiesCountIdentifier,
                    e => e.textContent
                );
                expect(incidentPrioritiesCount).toEqual('3 Priorities');

                await page.waitForSelector('#btnPrev');
                await page.click('#btnPrev');
                await page.waitFor(3000);
                incidentPrioritiesCount = await page.$eval(
                    incidentPrioritiesCountIdentifier,
                    e => e.textContent
                );
                expect(incidentPrioritiesCount).toEqual('10 Priorities');
            });
        },
        operationTimeOut
    );
});
