const puppeteer = require('puppeteer');
const utils = require('./test-utils');
const init = require('./test-init');
const { Cluster } = require('puppeteer-cluster');

// user credentials
const email = utils.generateRandomBusinessEmail();
const password = '1234567890';
const subProjectName = utils.generateRandomString();
const newProjectName = utils.generateRandomString();
const statusPageName = utils.generateRandomString();
const projectViewer = {
    email: utils.generateRandomBusinessEmail(),
    password: '1234567890',
};
const role = 'Viewer';

describe('Sub-Project API', () => {
    const operationTimeOut = 50000;

    let cluster;

    beforeAll(async done => {
        jest.setTimeout(200000);

        cluster = await Cluster.launch({
            concurrency: Cluster.CONCURRENCY_PAGE,
            puppeteerOptions: utils.puppeteerLaunchConfig,
            puppeteer,
            timeout: 120000,
        });

        cluster.on('taskerror', err => {
            throw err;
        });

        // Register user
        await cluster.task(async ({ page }) => {
            const user = {
                email,
                password,
            };

            // user
            await init.registerEnterpriseUser(user, page);
            await init.createUserFromAdminDashboard(projectViewer, page);
        });

        await cluster.queue({ email, password });
        done();
    });

    afterAll(async done => {
        await cluster.idle();
        await cluster.close();
        done();
    });

    test(
        'should create a new sub-project',
        async done => {
            await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.DASHBOARD_URL, {
                    waitUntil: 'networkidle0',
                });

                await page.waitForSelector('#projectSettings');
                await page.click('#projectSettings');
                await page.waitForSelector('#name');
                await page.click('#name', { clickCount: 3 });
                await page.type('#name', newProjectName);
                await page.click('#btnCreateProject');
                await page.waitForTimeout(2000);
                await page.waitForSelector('#btn_Add_SubProjects');
                await page.click('#btn_Add_SubProjects');
                await page.waitForSelector('#title');
                await page.type('#title', subProjectName);
                await page.click('#btnAddSubProjects');
                await page.waitForSelector('#title', { hidden: true });
                const subProjectSelector = await page.waitForSelector(
                    `#sub_project_name_${subProjectName}`,
                    { visible: true }
                );

                expect(
                    await (
                        await subProjectSelector.getProperty('textContent')
                    ).jsonValue()
                ).toEqual(subProjectName);
            });
            done();
        },
        operationTimeOut
    );

    test('should invite viewer to a subproject', async () => {
        return await cluster.execute(null, async ({ page }) => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: 'networkidle0',
            });
            await page.waitForSelector('#teamMembers');
            await page.click('#teamMembers');
            let prevMemberCount = await page.$eval(
                `#count_${subProjectName}`,
                elem => elem.textContent
            );
            prevMemberCount = Number(prevMemberCount.split(' ')[0]);
            await page.waitForSelector(`button[id=btn_${subProjectName}]`);
            await page.click(`button[id=btn_${subProjectName}]`);
            await page.waitForSelector(`#frm_${subProjectName}`);
            await page.type('input[name=emails]', email);
            await page.click(`#${role}_${subProjectName}`);
            await page.waitForSelector(`#btn_modal_${subProjectName}`);
            await page.click(`#btn_modal_${subProjectName}`);
            await page.waitForSelector(`#btn_modal_${subProjectName}`, {
                hidden: true,
            });
            await page.waitForSelector(`#count_${subProjectName}`);
            let memberCount = await page.$eval(
                `#count_${subProjectName}`,
                elem => elem.textContent
            );
            memberCount = Number(memberCount.split(' ')[0]);
            expect(memberCount).toEqual(prevMemberCount + 1);
        });
    });

    test('should invite viewer to a project', async () => {
        return await cluster.execute(null, async ({ page }) => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: 'networkidle0',
            });
            await page.waitForSelector('#teamMembers');
            await page.click('#teamMembers');
            await page.waitForSelector(`#count_${newProjectName}`);
            let prevMemberCount = await page.$eval(
                `#count_${newProjectName}`,
                elem => elem.textContent
            );
            prevMemberCount = Number(prevMemberCount.split(' ')[0]);

            await page.waitForSelector(`button[id=btn_${newProjectName}]`);
            await page.click(`button[id=btn_${newProjectName}]`);
            await page.waitForSelector(`#frm_${newProjectName}`);
            await page.type('input[name=emails]', projectViewer.email);
            await page.click(`#${role}_${newProjectName}`);
            await page.waitForSelector(`#btn_modal_${newProjectName}`);
            await page.click(`#btn_modal_${newProjectName}`);
            const elem = await page.$('button[id=btnConfirmInvite]');
            elem.click();
            await page.waitForSelector(`#btn_modal_${newProjectName}`, {
                hidden: true,
            });
            await page.waitForSelector(`#count_${newProjectName}`);
            let memberCount = await page.$eval(
                `#count_${newProjectName}`,
                elem => elem.textContent
            );
            memberCount = Number(memberCount.split(' ')[0]);
            expect(memberCount).toEqual(prevMemberCount + 1);
        });
    });

    test('should create a status page', async () => {
        return await cluster.execute(null, async ({ page }) => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: 'networkidle0',
            });
            await page.waitForSelector('#statusPages');
            await page.click('#statusPages');
            await page.waitForSelector(`#status_page_count_${newProjectName}`);
            let oldStatusPageCounter = await page.$eval(
                `#status_page_count_${newProjectName}`,
                elem => elem.textContent
            );
            oldStatusPageCounter = Number(oldStatusPageCounter.split(' ')[0]);
            await init.addStatusPageToProject(
                statusPageName,
                newProjectName,
                page
            );
            await page.waitForSelector(`#status_page_count_${newProjectName}`);
            let statusPageCounter = await page.$eval(
                `#status_page_count_${newProjectName}`,
                elem => elem.textContent
            );
            statusPageCounter = Number(statusPageCounter.split(' ')[0]);
            expect(statusPageCounter).toEqual(oldStatusPageCounter + 1);
        });
    });

    test(
        'should display subproject status pages to a subproject viewer',
        async () => {
            return await cluster.execute(null, async ({ page }) => {
                // Login as viewer
                await init.logout(page);
                await init.loginUser({ email, password }, page);
                await page.waitForSelector('#AccountSwitcherId');
                await page.click('#AccountSwitcherId');
                await page.waitForSelector('#accountSwitcher');
                const element = await page.$(
                    `#accountSwitcher > div[title=${newProjectName}]`
                );
                element.click();
                await page.waitForTimeout(3000);
                const projectStatusPages = await page.$('#statusPageTable');
                expect(projectStatusPages).toEqual(null);

                const subProjectStatusPages = await page.$(
                    '#statusPageTable_0'
                );
                expect(subProjectStatusPages).not.toEqual(null);
            });
        },
        operationTimeOut
    );

    test(
        'should display project and subproject status pages to project viewers',
        async () => {
            return await cluster.execute(null, async ({ page }) => {
                await init.logout(page);
                await init.loginUser(projectViewer, page);
                await page.waitForSelector('#AccountSwitcherId');
                await page.click('#AccountSwitcherId');
                await page.waitForSelector('#accountSwitcher');
                const element = await page.$(
                    `#accountSwitcher > div[title=${newProjectName}]`
                );
                element.click();
                await page.waitForTimeout(3000);
                const projectStatusPages = await page.$('#statusPageTable');
                expect(projectStatusPages).not.toEqual(null);

                const subProjectStatusPages = await page.$(
                    '#statusPageTable_0'
                );
                expect(subProjectStatusPages).not.toEqual(null);
            });
        },
        operationTimeOut
    );

    test('should redirect viewer to external status page', async () => {
        return await cluster.execute(null, async ({ page }) => {
            await init.logout(page);
            await init.loginUser(projectViewer, page);
            await page.waitForSelector('#AccountSwitcherId');
            await page.click('#AccountSwitcherId');
            await page.waitForSelector('#accountSwitcher');
            const element = await page.$(
                `#accountSwitcher > div[title=${newProjectName}]`
            );
            element.click();
            await page.waitForTimeout(3000);
            const rowItem = await page.waitForSelector(
                '#statusPagesListContainer > tr',
                { visible: true }
            );
            rowItem.click();
            const statusPage = await page.$(`#cb${statusPageName}`);
            expect(statusPage).toEqual(null);
        });
    });
});
