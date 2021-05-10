const puppeteer = require('puppeteer');
const utils = require('../../../test-utils');
const init = require('../../../test-init');
let browser, page;
// parent user credentials
const email = utils.generateRandomBusinessEmail();
const password = '1234567890';
const projectName = utils.generateRandomString();
const subProjectMonitorName = utils.generateRandomString();
// sub-project user credentials
const newEmail = utils.generateRandomBusinessEmail();
const newPassword = '1234567890';
const subProjectName = utils.generateRandomString();
const componentName = utils.generateRandomString();

describe('StatusPage API With SubProjects', () => {
    const operationTimeOut = 500000;

    beforeAll(async done => {
        jest.setTimeout(200000);

        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/61.0.3163.100 Safari/537.36'
        );

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
        // Create Component
        await init.addComponent(componentName, page, subProjectName);
        await page.goto(utils.DASHBOARD_URL);
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

    afterAll(async done => {
        await browser.close();
        done();
    });

    test(
        'should not display create status page button for subproject `member` role.',
        async done => {
            const user = {
                email: newEmail,
                password: newPassword,
            };

            await init.logout(page); // Needed for subproject team member to login
            await init.registerAndLoggingTeamMember(user, page);

            await page.waitForSelector('#statusPages');
            await page.click('#statusPages');

            const createButton = await page.$(
                `#btnCreateStatusPage_${subProjectName}`
            );

            expect(createButton).toBeNull();

            done();
        },
        operationTimeOut
    );

    test(
        'should create a status page in sub-project for sub-project `admin`',
        async done => {
            const statuspageName = utils.generateRandomString();

            const user = {
                email: email,
                password: password,
            };
            await init.logout(page);
            await init.loginUser(user, page);
            await page.goto(utils.DASHBOARD_URL);
            await init.addStatusPageToProject(
                statuspageName,
                subProjectName,
                page
            );
            await page.waitForSelector(`#status_page_count_${subProjectName}`);

            const statusPageCountSelector = await page.$(
                `#status_page_count_${subProjectName}`
            );
            let textContent = await statusPageCountSelector.getProperty(
                'innerText'
            );

            textContent = await textContent.jsonValue();
            expect(textContent).toMatch('Page 1 of 1 (1 Status Page');

            done();
        },
        operationTimeOut
    );

    test('should navigate to status page when view button is clicked on the status page table view', async done => {
        await page.goto(utils.DASHBOARD_URL);
        const statuspageName = utils.generateRandomString();
        await init.addStatusPageToProject(statuspageName, subProjectName, page);
        await page.waitForSelector('tr.statusPageListItem');
        await page.$$('tr.statusPageListItem');
        await page.waitForSelector('#viewStatusPage');
        await page.click('#viewStatusPage');
        await page.reload({ waitUntil: 'networkidle0' });

        let statusPageNameOnStatusPage = await page.waitForSelector(
            `#cb${statuspageName}`,
            { visible: true }
        );
        statusPageNameOnStatusPage = await statusPageNameOnStatusPage.getProperty(
            'innerText'
        );
        statusPageNameOnStatusPage = await statusPageNameOnStatusPage.jsonValue();
        expect(statuspageName).toMatch(statusPageNameOnStatusPage);

        done();
    }, 50000);

    test('should get list of status pages in sub-projects and paginate status pages in sub-project', async done => {
        await page.goto(utils.DASHBOARD_URL);
        for (let i = 0; i < 10; i++) {
            const statuspageName = utils.generateRandomString();
            await init.addStatusPageToProject(
                statuspageName,
                subProjectName,
                page
            );
        }

        await page.reload({ waitUntil: 'networkidle0' });
        await page.waitForSelector('tr.statusPageListItem');

        let statusPageRows = await page.$$('tr.statusPageListItem');
        let countStatusPages = statusPageRows.length;

        expect(countStatusPages).toEqual(10);

        await page.waitForSelector(`#btnNext-${subProjectName}`);
        await page.click(`#btnNext-${subProjectName}`);

        await page.waitForTimeout(5000);
        statusPageRows = await page.$$('tr.statusPageListItem');
        countStatusPages = statusPageRows.length;
        expect(countStatusPages).toEqual(2);

        await page.waitForSelector(`#btnPrev-${subProjectName}`);
        await page.click(`#btnPrev-${subProjectName}`);

        await page.waitForTimeout(5000);
        statusPageRows = await page.$$('tr.statusPageListItem');
        countStatusPages = statusPageRows.length;

        expect(countStatusPages).toEqual(10);

        done();
    }, 500000);

    test(
        'should update sub-project status page settings',
        async done => {
            await page.goto(utils.DASHBOARD_URL);
            await page.waitForSelector('#statusPages');
            await page.click('#statusPages');
            await page.waitForSelector('tr.statusPageListItem');
            await page.click('tr.statusPageListItem');

            await page.waitForSelector('#customTabList > li');
            // navigate to branding tab
            await page.$$eval(
                '#customTabList > li',
                elem => elem[3].click() //Branding is in fourth tab
            );
            const pageTitle = 'MyCompany';
            const pageDescription = 'MyCompany description';
            await page.waitForSelector('#title');
            await page.type('#title', pageTitle);
            await page.type(
                '#account_app_product_description',
                pageDescription
            );
            await page.click('#saveBranding');
            await page.waitForSelector('.ball-beat', { hidden: true });

            await page.reload({ waitUntil: 'networkidle0' });
            await page.waitForSelector('#customTabList > li');
            // navigate to branding tab
            await page.$$eval('#customTabList > li', elem => elem[3].click());
            await page.waitForSelector('#title');
            const title = await page.$eval('#title', elem => elem.value);

            expect(title).toMatch(pageTitle);

            done();
        },
        operationTimeOut
    );

    test(
        'should delete sub-project status page',
        async done => {
            await page.goto(utils.DASHBOARD_URL);
            await page.waitForSelector('#statusPages');
            await page.click('#statusPages');
            await page.waitForSelector('tr.statusPageListItem');
            await page.click('tr.statusPageListItem');
            await page.waitForSelector('#customTabList > li');
            // navigate to advanced options
            await page.$$eval(
                '#customTabList > li',
                elem => elem[5].click() // Advanced is in sixth tab
            );
            await page.waitForSelector('#delete');
            await page.click('#delete');
            await page.waitForSelector('#confirmDelete');
            await page.click('#confirmDelete');
            await page.waitForSelector('#confirmDelete', {
                hidden: true,
            });
            await page.waitForSelector('#statusPages');
            await page.click('#statusPages');

            await page.waitForSelector('tr.statusPageListItem');
            const statusPageRows = await page.$$('tr.statusPageListItem');
            const countStatusPages = statusPageRows.length;

            expect(countStatusPages).toEqual(10);
            done();
        },
        operationTimeOut
    );
});
