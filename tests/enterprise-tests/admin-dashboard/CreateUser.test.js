const puppeteer = require('puppeteer');
const utils = require('../../test-utils');
const init = require('../../test-init');


require('should');

// user credentials
const email = 'masteradmin@hackerbay.io';
const userEmail = utils.generateRandomBusinessEmail();
const password = '1234567890';

describe('Enterprise User API', () => {
    const operationTimeOut = init.timeout;

    beforeAll(async done => {
        jest.setTimeout(init.timeout);

        const cluster = await Cluster.launch({
            concurrency: Cluster.CONCURRENCY_PAGE,
            puppeteerOptions: utils.puppeteerLaunchConfig,
            puppeteer,
            timeout: 120000,
        });

        cluster.on('taskerror', err => {
            throw err;
        });

        // Register user
        await cluster.task(async ({ page, data }) => {
            const user = {
                email: data.userEmail,
                password: data.password,
            };
            // user
            await init.registerEnterpriseUser(user, page, false);
        });

        await cluster.queue({ email, password, userEmail });

        await cluster.idle();
        await cluster.close();
        done();
    });

    afterAll(async done => {
        done();
    });

    test(
        'Should create a new user with correct details',
        async done => {
            expect.assertions(1);

            const cluster = await Cluster.launch({
                concurrency: Cluster.CONCURRENCY_PAGE,
                puppeteerOptions: utils.puppeteerLaunchConfig,
                puppeteer,
                timeout: 100000,
            });

            cluster.on('taskerror', err => {
                throw err;
            });

            const newEmail = utils.generateRandomBusinessEmail();

            await cluster.task(async ({ page, data }) => {
                const user = {
                    email: data.email,
                    password: data.password,
                };

                await init.loginUser(user, page);

                await page.waitForSelector('#add_user');
                await init.pageClick(page, '#add_user');

                await page.waitForSelector('#email');
                await init.pageClick(page, 'input[name=email]');
                await init.pageType(page, 'input[name=email]', data.newEmail);
                await init.pageClick(page, 'input[name=name]');
                await init.pageType(page, 'input[name=name]', 'Test Name');
                await init.pageClick(page, 'input[name=companyName]');
                await init.pageType(page, 'input[name=companyName]', 'Test Name');
                await init.pageClick(page, 'input[name=companyPhoneNumber]');
                await init.pageType(page, 'input[name=companyPhoneNumber]', '99105688');
                await init.pageClick(page, 'input[name=password]');
                await init.pageType(page, 'input[name=password]', '1234567890');
                await init.pageClick(page, 'input[name=confirmPassword]');
                await init.pageType(page, 'input[name=confirmPassword]', '1234567890');
                await init.pageClick(page, 'button[type=submit]');
                await page.WaitForSelector('a.db-UserListRow');

                const userRows = await page.$$('a.db-UserListRow');
                const countUsers = userRows.length;

                expect(countUsers).toBeGreaterThanOrEqual(2);
            });

            cluster.queue({ email, password, newEmail });
            await cluster.idle();
            await cluster.close();
            done();
        },
        operationTimeOut
    );

    test('Should get list of users and paginate for users', async done => {
        expect.assertions(3);

        const cluster = await Cluster.launch({
            concurrency: Cluster.CONCURRENCY_PAGE,
            puppeteerOptions: utils.puppeteerLaunchConfig,
            puppeteer,
            timeout: 360000,
        });

        cluster.on('taskerror', err => {
            throw err;
        });

        await cluster.task(async ({ page, data }) => {
            const user = {
                email: data.email,
                password: data.password,
            };

            await init.loginUser(user, page);

            for (let i = 0; i < 10; i++) {
                // add new user
                await page.waitForSelector('#add_user');
                await init.pageClick(page, '#add_user');

                await page.waitForSelector('#email');
                await init.pageClick(page, 'input[name=email]');
                await init.pageType(page, 
                    'input[name=email]',
                    utils.generateRandomBusinessEmail()
                );
                await init.pageClick(page, 'input[name=name]');
                await init.pageType(page, 'input[name=name]', 'Test Name');
                await init.pageClick(page, 'input[name=companyName]');
                await init.pageType(page, 'input[name=companyName]', 'Test Name');
                await init.pageClick(page, 'input[name=companyPhoneNumber]');
                await init.pageType(page, 'input[name=companyPhoneNumber]', '99105688');
                await init.pageClick(page, 'input[name=password]');
                await init.pageType(page, 'input[name=password]', '1234567890');
                await init.pageClick(page, 'input[name=confirmPassword]');
                await init.pageType(page, 'input[name=confirmPassword]', '1234567890');
                await init.pageClick(page, 'button[type=submit]');
                
            }

            let userRows = await page.$$('a.db-UserListRow');
            let countUsers = userRows.length;

            expect(countUsers).toEqual(10);

            const nextSelector = await page.$('#btnNext');

            await nextSelector.click();
            
            userRows = await page.$$('a.db-UserListRow');
            countUsers = userRows.length;
            expect(countUsers).toBeGreaterThanOrEqual(2);

            const prevSelector = await page.$('#btnPrev');

            await prevSelector.click();
            
            userRows = await page.$$('a.db-UserListRow');
            countUsers = userRows.length;
            expect(countUsers).toEqual(10);
        });

        cluster.queue({ email, password });
        await cluster.idle();
        await cluster.close();
        done();
    }, init.timeout);

    test(
        'Should not create a user with incorrect details',
        async done => {
            const cluster = await Cluster.launch({
                concurrency: Cluster.CONCURRENCY_PAGE,
                puppeteerOptions: utils.puppeteerLaunchConfig,
                puppeteer,
                timeout: 100000,
            });

            cluster.on('taskerror', err => {
                throw err;
            });

            await cluster.task(async ({ page, data }) => {
                const user = {
                    email: data.email,
                    password: data.password,
                };

                await init.loginUser(user, page);

                await page.waitForSelector('#add_user');
                await init.pageClick(page, '#add_user');

                // user with non-business email
                await page.waitForSelector('#email');
                await init.pageClick(page, 'input[name=email]');
                await init.pageType(page, 'input[name=email]', 'fyipe@gmail.com');
                await init.pageClick(page, 'input[name=name]');
                await init.pageType(page, 'input[name=name]', 'Test Name');
                await init.pageClick(page, 'input[name=companyName]');
                await init.pageType(page, 'input[name=companyName]', 'Test Name');
                await init.pageClick(page, 'input[name=companyPhoneNumber]');
                await init.pageType(page, 'input[name=companyPhoneNumber]', '99105688');
                await init.pageClick(page, 'input[name=password]');
                await init.pageType(page, 'input[name=password]', '1234567890');
                await init.pageClick(page, 'input[name=confirmPassword]');
                await init.pageType(page, 'input[name=confirmPassword]', '1234567890');
                await init.pageClick(page, 'button[type=submit]');
                

                const html = await page.$eval('#frmUser', e => {
                    return e.innerHTML;
                });
                html.should.containEql(
                    'Please enter a business email address.'
                );
            });

            cluster.queue({ email, password });
            await cluster.idle();
            await cluster.close();
            done();
        },
        operationTimeOut
    );
});
