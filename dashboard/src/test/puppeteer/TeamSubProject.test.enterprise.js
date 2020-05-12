const puppeteer = require('puppeteer');
const utils = require('./test-utils');
const init = require('./test-init');
const { Cluster } = require('puppeteer-cluster');

require('should');

// user credentials
const email = utils.generateRandomBusinessEmail();
const newEmail = utils.generateRandomBusinessEmail();
const password = '1234567890';

describe('Enterprise Team SubProject API', () => {
    const operationTimeOut = 200000;

    beforeAll(async done => {
        jest.setTimeout(200000);

        const cluster = await Cluster.launch({
            concurrency: Cluster.CONCURRENCY_PAGE,
            puppeteerOptions: utils.puppeteerLaunchConfig,
            maxConcurrency: 2,
            puppeteer,
            timeout: 120000,
        });

        cluster.on('taskerror', err => {
            throw err;
        });

        // Register user
        await cluster.task(async ({ page, data }) => {
            const user = {
                email: data.email,
                password: data.password,
            };
            // user
            await init.registerUser(user, page);
        });

        await cluster.queue({ email, password });
        await cluster.queue({ email: newEmail, password });

        await cluster.idle();
        await cluster.close();
        done();
    });

    afterAll(async done => {
        done();
    });

    test(
        'Should add a new user to sub-project (role -> `Member`)',
        async done => {
            expect.assertions(1);

            const cluster = await Cluster.launch({
                concurrency: Cluster.CONCURRENCY_PAGE,
                puppeteerOptions: utils.puppeteerLaunchConfig,
                maxConcurrency: 2,
                puppeteer,
                timeout: 200000,
            });

            cluster.on('taskerror', err => {
                throw err;
            });

            const projectName = utils.generateRandomString();
            const subProjectName = utils.generateRandomString();

            await cluster.task(async ({ page, data }) => {
                const user = {
                    email: data.email,
                    password: data.password,
                };

                await init.loginUser(user, page);

                if (data.isParentUser) {
                    // rename default project
                    await init.renameProject(data.projectName, page);
                    // add sub-project
                    await init.addSubProject(data.subProjectName, page);
                }

                if (data.isParentUser) {
                    const role = 'Member';

                    await page.waitForSelector('#teamMembers');
                    await page.click('#teamMembers');
                    await page.waitForSelector(`#btn_${data.subProjectName}`);
                    await page.click(`#btn_${data.subProjectName}`);
                    await page.waitForSelector(`#frm_${data.subProjectName}`);
                    await page.click(`#emails_${data.subProjectName}`);
                    await page.type(
                        `#emails_${data.subProjectName}`,
                        data.newEmail
                    );
                    await page.click(`#${role}_${data.subProjectName}`);
                    await page.click(`#btn_modal_${data.subProjectName}`);
                    await page.waitFor(5000);
                } else {
                    await cluster.waitForOne();
                    await page.reload({ waitUntil: 'networkidle2' });
                    await page.waitForSelector('#AccountSwitcherId');
                    await page.click('#AccountSwitcherId');
                    await page.waitForSelector('#accountSwitcher');

                    const projectSpanSelector = await page.$(
                        `#span_${projectName}`
                    );
                    let textContent = await projectSpanSelector.getProperty(
                        'innerText'
                    );

                    textContent = await textContent.jsonValue();
                    expect(textContent).toEqual(projectName);

                    const element = await page.$(
                        `#accountSwitcher > div[title="${projectName}"]`
                    );

                    await element.click();
                    await page.waitFor(5000);
                }
            });

            cluster.queue({
                email,
                newEmail,
                password,
                projectName,
                subProjectName,
                isParentUser: true,
            });
            cluster.queue({
                email,
                newEmail,
                password,
                projectName,
                subProjectName,
                isParentUser: false,
            });
            await cluster.idle();
            await cluster.close();
            done();
        },
        operationTimeOut
    );
});
