const puppeteer = require('puppeteer');
const utils = require('./test-utils');
const init = require('./test-init');
const { Cluster } = require('puppeteer-cluster');

require('should');

// user credentials
const user = {
    email: utils.generateRandomBusinessEmail(),
    password: '1234567890',
};
const newUser = {
    email: utils.generateRandomBusinessEmail(),
    password: '1234567890',
};

describe('Enterprise Team SubProject API', () => {
    const operationTimeOut = 500000;
    let cluster;

    beforeAll(async () => {
        jest.setTimeout(500000);

        cluster = await Cluster.launch({
            concurrency: Cluster.CONCURRENCY_PAGE,
            puppeteerOptions: utils.puppeteerLaunchConfig,
            puppeteer,
            timeout: 500000,
        });

        cluster.on('taskerror', err => {
            throw err;
        });

        // Register users
        return await cluster.execute(null, async ({ page }) => {
            await init.registerEnterpriseUser(user, page);
            await init.createUserFromAdminDashboard(newUser, page);
            await init.adminLogout(page);
        });
    });

    afterAll(async done => {
        await cluster.idle();
        await cluster.close();
        done();
    });

    test(
        'Should add a new user to sub-project (role -> `Member`)',
        async () => {
            return await cluster.execute(null, async ({ page }) => {
                const subProjectName = utils.generateRandomString();

                await init.loginUser(user, page);
                await init.addSubProject(subProjectName, page);
                const role = 'Member';

                await page.waitForSelector('#teamMembers');
                await page.click('#teamMembers');
                await page.waitForSelector(`#btn_${subProjectName}`);
                await page.click(`#btn_${subProjectName}`);
                await page.waitForSelector(`#frm_${subProjectName}`);
                await page.click(`#emails_${subProjectName}`);
                await page.type(`#emails_${subProjectName}`, newUser.email);
                await page.click(`#${role}_${subProjectName}`);
                await page.click(`#btn_modal_${subProjectName}`);
                await page.waitFor(5000);
            });
        },
        operationTimeOut
    );
});
