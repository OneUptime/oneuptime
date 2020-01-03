const puppeteer = require('puppeteer');
var should = require('should');
var utils = require('./test-utils');
var init = require('./test-init');
const { Cluster } = require('puppeteer-cluster');

// user credentials
let email = utils.generateRandomBusinessEmail();
let password = utils.generateRandomString();
let monitorName = utils.generateRandomString();
let projectName = utils.generateRandomString();

let userCredentials;

describe('Monitor Detail API', () => {
    const operationTimeOut = 50000;

    beforeAll(async (done) => {
        jest.setTimeout(200000);

        const cluster = await Cluster.launch({
            concurrency: Cluster.CONCURRENCY_PAGE,
            puppeteerOptions: utils.puppeteerLaunchConfig,
            puppeteer,
            timeout: 120000
        });

        cluster.on('taskerror', (err) => {
            throw err;
        });

        // Register user 
        await cluster.task(async ({ page, data }) => {
            const user = {
                email: data.email,
                password: data.password
            };

            // intercept request and mock response for login
            await page.setRequestInterception(true);
            await page.on('request', async (request) => {
                const signInResponse = userCredentials;

                if ((await request.url()).match(/user\/login/)) {
                    request.respond({
                        status: 200,
                        contentType: 'application/json',
                        body: JSON.stringify(signInResponse)
                    });
                } else {
                    request.continue();
                }
            });
            await page.on('response', async (response) => {
                try {
                    const res = await response.json();
                    if (res && res.tokens) {
                        userCredentials = res;
                    }
                } catch (error) { }
            });

            // user
            await init.registerUser(user, page);
            await init.loginUser(user, page);

            // rename default project
            await init.renameProject(data.projectName, page);
            // add new monitor to parent project
            await init.addMonitorToProject(data.monitorName, page);
        });

        await cluster.queue({ email, password, monitorName, projectName });
        await cluster.idle();
        await cluster.close();
        done();
    });

    afterAll(async (done) => {
        done();
    });

    test('Should navigate to monitor details with monitor created with correct details', async (done) => {
        const cluster = await Cluster.launch({
            concurrency: Cluster.CONCURRENCY_PAGE,
            puppeteerOptions: utils.puppeteerLaunchConfig,
            puppeteer,
            timeout: 45000
        });

        cluster.on('taskerror', (err) => {
            throw err;
        });

        await cluster.task(async ({ page, data }) => {
            const user = {
                email: data.email,
                password: data.password
            };
            const signInResponse = data.userCredentials;

            // intercept request and mock response for login
            await page.setRequestInterception(true);
            await page.on('request', async (request) => await init.filterRequest(request, signInResponse));

            await init.loginUser(user, page);
            await page.waitFor(2000);

            const moreButtonSelector = `#more_details_${data.monitorName}`;
            await page.click(moreButtonSelector);
            await page.waitFor(2000);

            let spanElement;

            spanElement = await page.$('span.ContentHeader-title.Text-color--dark.Text-display--inline.Text-fontSize--20.Text-fontWeight--regular.Text-lineHeight--28.Text-typeface--base.Text-wrap--wrap');
            spanElement = await spanElement.getProperty('innerText');
            spanElement = await spanElement.jsonValue();

            spanElement.should.be.exactly(data.monitorName);
        });

        cluster.queue({ email, password, monitorName, userCredentials });
        await cluster.idle();
        await cluster.close();
        done();
    }, operationTimeOut);

    test('Should navigate to monitor details and create an incident', async (done) => {
        expect.assertions(1);

        const cluster = await Cluster.launch({
            concurrency: Cluster.CONCURRENCY_PAGE,
            puppeteerOptions: utils.puppeteerLaunchConfig,
            puppeteer,
            timeout: 45000
        });

        cluster.on('taskerror', (err) => {
            throw err;
        });

        await cluster.task(async ({ page, data }) => {
            const user = {
                email: data.email,
                password: data.password
            };
            const signInResponse = data.userCredentials;

            // intercept request and mock response for login
            await page.setRequestInterception(true);
            await page.on('request', async (request) => await init.filterRequest(request, signInResponse));

            await init.loginUser(user, page);
            await page.waitFor(2000);

            const moreButtonSelector = `#more_details_${data.monitorName}`;
            await page.click(moreButtonSelector);
            await page.waitFor(2000);

            await page.waitForSelector(`#createIncident_${data.monitorName}`);
            await page.click(`#createIncident_${data.monitorName}`);
            await page.waitForSelector('#createIncident');
            await init.selectByText('#incidentType', 'Offline', page);
            await page.click('#createIncident');
            await page.waitFor(2000);

            let incidentRows = await page.$$('tr.incidentListItem');
            let countIncidents = incidentRows.length;

            expect(countIncidents).toEqual(1);
        });

        cluster.queue({ email, password, monitorName, userCredentials });
        await cluster.idle();
        await cluster.close();
        done();
    }, operationTimeOut);

    test('Should navigate to monitor details and get list of incidents and paginate incidents', async (done) => {
        expect.assertions(2);

        const cluster = await Cluster.launch({
            concurrency: Cluster.CONCURRENCY_PAGE,
            puppeteerOptions: utils.puppeteerLaunchConfig,
            puppeteer,
            timeout: 140000,
        });

        cluster.on('taskerror', (err) => {
            throw err;
        });

        const paginate = async ({ page, data }) => {
            const user = {
                email: data.email,
                password: data.password
            };
            const signInResponse = data.userCredentials;

            // intercept request and mock response for login
            await page.setRequestInterception(true);
            await page.on('request', async (request) => await init.filterRequest(request, signInResponse));

            await init.loginUser(user, page);
            await page.waitFor(2000);

            const moreButtonSelector = `#more_details_${data.monitorName}`;
            await page.click(moreButtonSelector);
            await page.waitFor(2000);

            for (let i = 0; i < 5; i++) {
                await page.waitForSelector(`#createIncident_${data.monitorName}`);
                await page.click(`#createIncident_${data.monitorName}`);
                await page.waitForSelector('#createIncident');
                await init.selectByText('#incidentType', 'Offline', page);
                await page.click('#createIncident');
                await page.waitFor(2000);
            }

            const nextSelector = await page.$('#btnNext');

            await nextSelector.click();
            await page.waitFor(5000);

            let incidentRows = await page.$$('tr.incidentListItem');
            let countIncidents = incidentRows.length;

            expect(countIncidents).toEqual(1);

            const prevSelector = await page.$('#btnPrev');

            await prevSelector.click();
            await page.waitFor(5000);

            incidentRows = await page.$$('tr.incidentListItem');
            countIncidents = incidentRows.length;

            expect(countIncidents).toEqual(5);
        };

        cluster.queue({ email, password, monitorName, projectName, userCredentials, counter: 0, limit: 5 }, paginate);
        await cluster.idle();
        await cluster.close();
        done();
    }, 200000);

    test('Should navigate to monitor details and create a scheduled event', async (done) => {
        expect.assertions(1);

        const cluster = await Cluster.launch({
            concurrency: Cluster.CONCURRENCY_PAGE,
            puppeteerOptions: utils.puppeteerLaunchConfig,
            puppeteer,
            timeout: 45000
        });

        cluster.on('taskerror', (err) => {
            throw err;
        });

        await cluster.task(async ({ page, data }) => {
            const user = {
                email: data.email,
                password: data.password
            }
            const signInResponse = data.userCredentials;

            // intercept request and mock response for login
            await page.setRequestInterception(true);
            await page.on('request', async (request) => await init.filterRequest(request, signInResponse));

            await init.loginUser(user, page);
            await page.waitFor(2000);

            const moreButtonSelector = `#more_details_${data.monitorName}`;
            await page.click(moreButtonSelector);
            await page.waitFor(2000);

            const addButtonSelector = '#addScheduledEventButton';
            await page.click(addButtonSelector);
            await page.waitFor(1000);

            await page.type('input[name=name]', utils.scheduledEventName);
            await page.type('textarea[name=description]', utils.scheduledEventDescription);

            await page.evaluate(() => {
                document.querySelector('input[name=showEventOnStatusPage]').click();
            });

            await page.click('#createScheduledEventButton');

            createdScheduledEventSelector = '#scheduledEventsList > div > div.bs-ObjectList-cell.bs-u-v-middle.bs-ActionsParent.db-ListViewItem--hasLink > div.Text-color--cyan.Text-display--inline.Text-fontSize--14.Text-fontWeight--medium.Text-lineHeight--20.Text-typeface--base.Text-wrap--wrap';
            await page.waitFor(1000);

            var createdScheduledEventName = await page.$eval(createdScheduledEventSelector, el => el.textContent);

            expect(createdScheduledEventName).toEqual(utils.scheduledEventName);
        });

        cluster.queue({ email, password, monitorName, userCredentials });
        await cluster.idle();
        await cluster.close();
        done();
    }, operationTimeOut);

    // test('Should navigate to monitor details and create a new subscriber', async (done) => {
    //     expect.assertions(1);

    //     const cluster = await Cluster.launch({
    //         concurrency: Cluster.CONCURRENCY_PAGE,
    //         puppeteerOptions: utils.puppeteerLaunchConfig,
    //         puppeteer,
    //         timeout: 45000
    //     });

    //     cluster.on('taskerror', (err) => {
    //         throw err;
    //     });

    //     await cluster.task(async ({ page, data }) => {
    //         const user = {
    //             email: data.email,
    //             password: data.password
    //         }
    //         const signInResponse = data.userCredentials;

    //         // intercept request and mock response for login
    //         await page.setRequestInterception(true);
    //         await page.on('request', async (request) => await init.filterRequest(request, signInResponse));

    //         await init.loginUser(user, page);
    //         await page.waitFor(2000);

    //         const moreButtonSelector = `#more_details_${data.monitorName}`;
    //         await page.click(moreButtonSelector);
    //         await page.waitFor(2000);
    //     });

    //     cluster.queue({ email, password, monitorName, userCredentials });
    //     await cluster.idle();
    //     await cluster.close();
    //     done();
    // }, operationTimeOut);

    // test('Should navigate to monitor details and create a webhook', async (done) => {
    //     expect.assertions(1);

    //     const cluster = await Cluster.launch({
    //         concurrency: Cluster.CONCURRENCY_PAGE,
    //         puppeteerOptions: utils.puppeteerLaunchConfig,
    //         puppeteer,
    //         timeout: 45000
    //     });

    //     cluster.on('taskerror', (err) => {
    //         throw err;
    //     });

    //     await cluster.task(async ({ page, data }) => {
    //         const user = {
    //             email: data.email,
    //             password: data.password
    //         }
    //         const signInResponse = data.userCredentials;

    //         // intercept request and mock response for login
    //         await page.setRequestInterception(true);
    //         await page.on('request', async (request) => await init.filterRequest(request, signInResponse));

    //         await init.loginUser(user, page);
    //         await page.waitFor(2000);

    //         const moreButtonSelector = `#more_details_${data.monitorName}`;
    //         await page.click(moreButtonSelector);
    //         await page.waitFor(2000);
    //     });

    //     cluster.queue({ email, password, monitorName, userCredentials });
    //     await cluster.idle();
    //     await cluster.close();
    //     done();
    // }, operationTimeOut);

    // test('Should navigate to monitor details and delete monitor', async (done) => {
    //     expect.assertions(1);

    //     const cluster = await Cluster.launch({
    //         concurrency: Cluster.CONCURRENCY_PAGE,
    //         puppeteerOptions: utils.puppeteerLaunchConfig,
    //         puppeteer,
    //         timeout: 45000
    //     });

    //     cluster.on('taskerror', (err) => {
    //         throw err;
    //     });

    //     await cluster.task(async ({ page, data }) => {
    //         const user = {
    //             email: data.email,
    //             password: data.password
    //         }
    //         const signInResponse = data.userCredentials;

    //         // intercept request and mock response for login
    //         await page.setRequestInterception(true);
    //         await page.on('request', async (request) => await init.filterRequest(request, signInResponse));

    //         await init.loginUser(user, page);
    //         await page.waitFor(2000);

    //         const moreButtonSelector = `#more_details_${data.monitorName}`;
    //         await page.click(moreButtonSelector);
    //         await page.waitFor(2000);
    //     });

    //     cluster.queue({ email, password, monitorName, userCredentials });
    //     await cluster.idle();
    //     await cluster.close();
    //     done();
    // }, operationTimeOut);
});