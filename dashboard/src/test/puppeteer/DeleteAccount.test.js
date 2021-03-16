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
const user1 = {
    email: utils.generateRandomBusinessEmail(),
    password: '1234567890',
};

describe('Profile -> Delete Account Component test', () => {
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

        // Register user
        return await cluster.execute(null, async ({ page }) => {
            await init.registerUser(user, page);
            //await init.loginUser(user, page);
        });
    });

    afterAll(async () => {
        await cluster.idle();
        await cluster.close();
    });

    test(
        'Should not delete account with single project -> multiple users -> single owner',
        async () => {
            const projectName = 'Project1';
            const role = 'Member';
            return await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.DASHBOARD_URL);
                // Rename project
                await page.waitForSelector('#projectSettings');
                await page.click('#projectSettings');
                await page.waitForSelector('input[name=project_name]');
                await page.click('input[name=project_name]', { clickCount: 3 });
                await page.type('input[name=project_name]', projectName);
                await page.waitForSelector('button[id=btnCreateProject]');
                await page.click('button[id=btnCreateProject]');
                await page.waitForSelector(`#cb${projectName}`, {
                    visible: true,
                });

                // Invite member on the project
                await page.waitForSelector('#teamMembers');
                await page.click('#teamMembers');
                await page.waitForSelector(`#btn_${projectName}`);
                await page.click(`#btn_${projectName}`);
                await page.waitForSelector('input[name=emails]');
                await page.click('input[name=emails]');
                await page.type('input[name=emails]', user1.email);
                await page.waitForSelector(`#${role}_${projectName}`);
                await page.click(`#${role}_${projectName}`);
                await page.waitForSelector('button[type=submit]');
                await page.click('button[type=submit]');
                await page.waitForSelector(`#btn_modal_${projectName}`, {
                    hidden: true,
                });

                // Navigate to profile page and delete account
                await page.waitForSelector('#profile-menu');
                await page.click('#profile-menu');
                await page.waitForSelector('#userProfile');
                await page.click('#userProfile');
                await page.waitForSelector('#advanced');
                await page.$eval('#advanced', elem => elem.click());
                await page.waitForSelector('#btn_delete_account');
                await page.click('#btn_delete_account');
                await page.waitForSelector('#btn_confirm_delete');
                await page.click('#btn_confirm_delete');
                
                let spanElement = await page.waitForSelector(
                    `span#projectDeletion`
                );
                spanElement = await spanElement.getProperty('innerText');
                spanElement = await spanElement.jsonValue();
                expect(spanElement).startWith(" Deleting your account will delete all the projects owned by you.");
            });
        },
        operationTimeOut
    );

    test(
        'Should not delete account with multiple projects -> multiple users -> single owner',
        async () => {
            const projectName = 'Project2';
            const role = 'Member';
            return await cluster.execute(null, async ({ page }) => {
                await page.goto(utils.DASHBOARD_URL);
                await init.addProject(page, projectName);

                // Invite member on the project
                await page.waitForSelector('#teamMembers');
                await page.click('#teamMembers');
                await page.waitForSelector(`#btn_${projectName}`);
                await page.click(`#btn_${projectName}`);
                await page.waitForSelector('input[name=emails]');
                await page.click('input[name=emails]');
                await page.type('input[name=emails]', user1.email);
                await page.waitForSelector(`#${role}_${projectName}`);
                await page.click(`#${role}_${projectName}`);
                await page.waitForSelector('button[type=submit]');
                await page.click('button[type=submit]');
                await page.waitForSelector(`#btn_modal_${projectName}`, {
                    hidden: true,
                });

                // Navigate to profile page and delete account
                await page.waitForSelector('#profile-menu');
                await page.click('#profile-menu');
                await page.waitForSelector('#userProfile');
                await page.click('#userProfile');
                await page.waitForSelector('#advanced');
                await page.$eval('#advanced', elem => elem.click());
                await page.waitForSelector('#btn_delete_account');
                await page.click('#btn_delete_account');
                await page.waitForSelector('#btn_confirm_delete');
                await page.click('#btn_confirm_delete');                

                let spanElement = await page.waitForSelector(
                    `span#projectOwnership`
                );
                spanElement = await spanElement.getProperty('innerText');
                spanElement = await spanElement.jsonValue();
                expect(spanElement).startWith("You are the owner of the following project");
            });
        },
        operationTimeOut
    );

    // test(
    //     'Should not delete account without confirmation',
    //     async () => {
    //         const role = 'Owner';
    //         const projectName = 'Project1';
    //         return await cluster.execute(null, async ({ page }) => {
    //             await page.goto(utils.DASHBOARD_URL);

    //             // Change member role -> Owner
    //             await page.waitForSelector('#teamMembers');
    //             await page.click('#teamMembers');
    //             await page.waitForSelector('button[title="Change Role"]');
    //             await page.click('button[title="Change Role"]');
    //             await page.waitForSelector(`div[title="${role}"]`);
    //             await page.click(`div[title="${role}"]`);
    //             await page.waitForTimeout(2000);

    //             // Switch projects and change member role -> Owner
    //             await init.switchProject(projectName, page);
    //             await page.waitForSelector('#teamMembers');
    //             await page.click('#teamMembers');
    //             await page.waitForSelector('button[title="Change Role"]');
    //             await page.click('button[title="Change Role"]');
    //             await page.waitForSelector(`div[title="${role}"]`);
    //             await page.click(`div[title="${role}"]`);
    //             await page.waitForTimeout(2000);

    //             // Navigate to profile page and delete account
    //             await page.waitForSelector('#profile-menu');
    //             await page.click('#profile-menu');
    //             await page.waitForSelector('#userProfile');
    //             await page.click('#userProfile');
    //             await page.waitForSelector('#advanced');
    //             await page.$eval('#advanced', elem => elem.click());
    //             await page.waitForSelector('#btn_delete_account');
    //             await page.click('#btn_delete_account');
    //             await page.waitForSelector('#btn_confirm_delete');
    //             await page.click('#btn_confirm_delete');
    //             const deleteButton = await page.$('#btn_confirm_delete');
    //             expect(deleteButton).toEqual(null);
    //         });
    //     },
    //     operationTimeOut
    // );

    // test(
    //     'Should delete account with multiple projects -> multiple users -> multiple owners',
    //     async () => {
    //         return await cluster.execute(null, async ({ page }) => {
    //             await page.goto(utils.DASHBOARD_URL);

    //             // Navigate to profile page and delete account
    //             await page.waitForSelector('#profile-menu');
    //             await page.click('#profile-menu');
    //             await page.waitForSelector('#userProfile');
    //             await page.click('#userProfile');
    //             await page.waitForSelector('#advanced');
    //             await page.$eval('#advanced', elem => elem.click());
    //             await page.waitForSelector('#btn_delete_account');
    //             await page.click('#btn_delete_account');
    //             await page.waitForSelector('#btn_confirm_delete');
    //             await page.click('#btn_confirm_delete');
    //             await page.waitForSelector('#deleteMyAccount');
    //             await page.type('#deleteMyAccount', 'delete my account');
    //             await page.click('#btn_confirm_delete');
    //             await page.waitForSelector(
    //                 "button[class='bs-Button btn__modal']"
    //             );
    //             await page.click("button[class='bs-Button btn__modal']");
    //             await page.waitForNavigation();
    //             const url = await page.url();
    //             expect(url).toEqual(`${utils.ACCOUNTS_URL}/accounts/login`);
    //         });
    //     },
    //     operationTimeOut
    // );
});
