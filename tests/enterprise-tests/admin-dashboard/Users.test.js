const puppeteer = require('puppeteer');
const { Cluster } = require('puppeteer-cluster');
const utils = require('./test-utils');
const init = require('./test-init');

require('should');

const email = utils.generateRandomBusinessEmail();
const password = '1234567890';

describe('Users Component (IS_SAAS_SERVICE=false)', () => {
    const operationTimeOut = 1000000;

    let cluster;

    beforeAll(async done => {
        jest.setTimeout(2000000);

        cluster = await Cluster.launch({
            concurrency: Cluster.CONCURRENCY_PAGE,
            puppeteerOptions: utils.puppeteerLaunchConfig,
            puppeteer,
            timeout: 1200000,
        });

        cluster.on('taskerror', err => {
            throw err;
        });

        await cluster.execute({ email, password }, async ({ page, data }) => {
            const user = {
                email: data.email,
                password: data.password,
            };
            await init.registerEnterpriseUser(user, page, false);
        });

        done();
    });

    afterAll(async done => {
        await cluster.idle();
        await cluster.close();
        done();
    });

    test(
        'should show a button to add more users to fyipe from admin dashboard',
        async done => {
            await cluster.execute(null, async ({ page }) => {
                // navigating to dashboard url
                // automatically redirects to users route
                await page.goto(utils.ADMIN_DASHBOARD_URL, {
                    waitUntil: 'networkidle0',
                });

                // if element does not exist it will timeout and throw
                const elem = await page.waitForSelector('#add_user', {
                    visible: true,
                });
                expect(elem).toBeTruthy();
            });
            done();
        },
        operationTimeOut
    );

    test(
        'should logout and get redirected to the login page if the user deletes his account',
        async done => {
            await cluster.execute(null, async ({ page }) => {
                // navigating to dashboard url
                // automatically redirects to users route
                await page.goto(utils.ADMIN_DASHBOARD_URL, {
                    waitUntil: 'networkidle0',
                });

                const userSelector = '#masteradmin';
                await page.waitForSelector(userSelector);
                await page.click(userSelector);
                await page.waitForTimeout(1000); // wait for the contents to load in the background
                await page.waitForSelector('#delete');
                await page.click('#delete');
                await page.waitForSelector('#confirmDelete');
                await page.click('#confirmDelete');
                await page.waitForSelector('#confirmDelete', { hidden: true });
                await page.waitForSelector('#users');
                await page.click('#users');
                const loginBtn = await page.waitForSelector('#login-button', {
                    visible: true,
                });
                expect(loginBtn).toBeDefined();
            });
            done();
        },
        operationTimeOut
    );
});
