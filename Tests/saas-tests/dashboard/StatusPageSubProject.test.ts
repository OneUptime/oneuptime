import puppeteer from 'puppeteer';
import utils from '../../test-utils';
import init from '../../test-init';
let browser: $TSFixMe, page: $TSFixMe;
// parent user credentials
const email = utils.generateRandomBusinessEmail();
const  password: string = '1234567890';
const projectName = utils.generateRandomString();
const subProjectMonitorName = utils.generateRandomString();
// sub-project user credentials
const newEmail = utils.generateRandomBusinessEmail();
const  newPassword: string = '1234567890';
const subProjectName = utils.generateRandomString();
const componentName = utils.generateRandomString();

describe('StatusPage API With SubProjects', () => {
    const operationTimeOut = init.timeout;

    beforeAll(async (done: $TSFixMe) => {
        jest.setTimeout(init.timeout);

        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(utils.agent);

        // Register user
        const user = {
            email,
            password,
        };

        // user
        await init.registerUser(user, page);

        await init.renameProject(projectName, page);
        await init.growthPlanUpgrade(page);

        // add sub-project
        await init.addSubProject(subProjectName, page);

        await init.pageClick(page, '#projectFilterToggle');

        await init.pageClick(page, `#project-${subProjectName}`);
        // Create Component
        await init.addComponent(componentName, page);
        await page.goto(utils.DASHBOARD_URL, {
            waitUntil: ['networkidle2'],
        });

        // add new user to sub-project
        await init.addUserToProject(
            {
                email: newEmail,
                role: 'Member',
                subProjectName,
            },
            page
        );
        // Navigate to details page of component created
        await init.addNewMonitorToComponent(
            page,
            componentName,
            subProjectMonitorName
        );

        done();
    });

    afterAll(async (done: $TSFixMe) => {
        await browser.close();
        done();
    });

    test(
        'should not display create status page button for subproject `member` role.',
        async (done: $TSFixMe) => {
            const user = {
                email: newEmail,
                password: newPassword,
            };

            await init.saasLogout(page); // Needed for subproject team member to login
            await init.registerAndLoggingTeamMember(user, page);

            await init.pageWaitForSelector(page, '#statusPages');

            await init.pageClick(page, '#statusPages');

            const createButton = await init.page$(
                page,
                `#btnCreateStatusPage_${subProjectName}`,
                { hidden: true }
            );

            expect(createButton).toBeNull();

            done();
        },
        operationTimeOut
    );

    test(
        'should create a status page in sub-project for sub-project `admin`',
        async (done: $TSFixMe) => {
            const statuspageName = utils.generateRandomString();

            const user = {
                email: email,
                password: password,
            };
            await init.saasLogout(page);
            await init.loginUser(user, page);
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });

            await init.pageClick(page, '#projectFilterToggle');

            await init.pageClick(page, `#project-${subProjectName}`);
            await init.addStatusPageToProject(
                statuspageName,
                subProjectName,
                page
            );

            await init.pageWaitForSelector(
                page,
                `#status_page_count_${subProjectName}`
            );

            const statusPageCountSelector = await init.page$(
                page,
                `#status_page_count_${subProjectName}`
            );
            let textContent = await statusPageCountSelector.getProperty(
                'innerText'
            );

            textContent = await textContent.jsonValue();
            expect(textContent).toMatch('1'); //UI changed to Page 1 of 1 (1 Log)

            done();
        },
        operationTimeOut
    );

    test(
        'should navigate to status page when view button is clicked on the status page table view',
        async (done: $TSFixMe) => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });
            const statuspageName = utils.generateRandomString();
            await init.addStatusPageToProject(
                statuspageName,
                subProjectName,
                page
            );

            await init.pageWaitForSelector(page, 'tr.statusPageListItem');

            await init.page$$(page, 'tr.statusPageListItem');

            await init.pageWaitForSelector(page, '#viewStatusPage');

            await init.pageClick(page, `#viewStatusPage_${statuspageName}`);
            await page.reload({ waitUntil: 'networkidle2' });

            let statusPageNameOnStatusPage = await init.pageWaitForSelector(
                page,
                `#cb${statuspageName}`,
                { visible: true, timeout: init.timeout }
            );
            statusPageNameOnStatusPage =
                await statusPageNameOnStatusPage.getProperty('innerText');
            statusPageNameOnStatusPage =
                await statusPageNameOnStatusPage.jsonValue();
            expect(statuspageName).toMatch(statusPageNameOnStatusPage);

            done();
        },
        init.timeout
    );

    test(
        'should get list of status pages in sub-projects and paginate status pages in sub-project',
        async (done: $TSFixMe) => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });
            for (let i = 0; i < 10; i++) {
                const statuspageName = utils.generateRandomString();
                await init.addStatusPageToProject(
                    statuspageName,
                    subProjectName,
                    page
                );
            }

            await page.reload({ waitUntil: 'networkidle2' });

            await init.pageWaitForSelector(page, 'tr.statusPageListItem');

            let statusPageRows = await init.page$$(
                page,
                'tr.statusPageListItem'
            );
            let countStatusPages = statusPageRows.length;

            expect(countStatusPages).toEqual(10);

            await init.pageWaitForSelector(page, `#btnNext-${subProjectName}`);

            await init.pageClick(page, `#btnNext-${subProjectName}`);

            statusPageRows = await init.page$$(page, 'tr.statusPageListItem');
            countStatusPages = statusPageRows.length;
            expect(countStatusPages).toEqual(2);

            await init.pageWaitForSelector(page, `#btnPrev-${subProjectName}`);

            await init.pageClick(page, `#btnPrev-${subProjectName}`);

            statusPageRows = await init.page$$(page, 'tr.statusPageListItem');
            countStatusPages = statusPageRows.length;

            expect(countStatusPages).toEqual(10);

            done();
        },
        init.timeout
    );

    test(
        'should update sub-project status page settings',
        async (done: $TSFixMe) => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });

            await init.pageWaitForSelector(page, '#statusPages');

            await init.pageClick(page, '#statusPages');

            await init.pageWaitForSelector(page, 'tr.statusPageListItem');

            await init.pageClick(page, 'tr.statusPageListItem');

            await init.pageClick(page, '.branding-tab');

            const  pageTitle: string = 'MyCompany';
            const  pageDescription: string = 'MyCompany description';

            await init.pageWaitForSelector(page, '#title');

            await init.pageType(page, '#title', pageTitle);

            await init.pageType(
                page,
                '#account_app_product_description',
                pageDescription
            );

            await init.pageClick(page, '#saveBranding');
            await init.pageWaitForSelector(page, '.ball-beat', {
                hidden: true,
            });

            await page.reload({ waitUntil: 'networkidle2' });

            await init.pageClick(page, '.branding-tab');

            await init.pageWaitForSelector(page, '#title');
            const title = await init.page$Eval(
                page,
                '#title',
                (elem: $TSFixMe) => elem.value
            );

            expect(title).toMatch(pageTitle);

            done();
        },
        operationTimeOut
    );

    test(
        'should delete sub-project status page',
        async (done: $TSFixMe) => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });

            await init.pageWaitForSelector(page, '#statusPages');

            await init.pageClick(page, '#statusPages');

            await init.pageWaitForSelector(page, 'tr.statusPageListItem');

            await init.pageClick(page, 'tr.statusPageListItem');

            await init.pageClick(page, '.advanced-options-tab');

            await init.pageWaitForSelector(page, '#delete');

            await init.pageClick(page, '#delete');

            await init.pageWaitForSelector(page, '#confirmDelete');

            await init.pageClick(page, '#confirmDelete');
            await init.pageWaitForSelector(page, '#confirmDelete', {
                hidden: true,
            });

            await init.pageWaitForSelector(page, '#statusPages');

            await init.pageClick(page, '#statusPages');

            await init.pageWaitForSelector(page, 'tr.statusPageListItem');

            const statusPageRows = await init.page$$(
                page,
                'tr.statusPageListItem'
            );
            const countStatusPages = statusPageRows.length;

            expect(countStatusPages).toEqual(10);
            done();
        },
        operationTimeOut
    );
});
