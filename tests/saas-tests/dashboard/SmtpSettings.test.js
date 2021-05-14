const puppeteer = require('puppeteer');
const utils = require('../../test-utils');
const init = require('../../test-init');

require('should');
let browser, page;
// user credentials
const email = utils.generateRandomBusinessEmail();
const name = utils.generateRandomString();
const password = '1234567890';
const user = {
    email,
    password,
};
// smtp credential
const smtpData = { ...utils.smtpCredential };

describe('Custom SMTP Settings', () => {
    const operationTimeOut = init.timeout;

    beforeAll(async done => {
        jest.setTimeout(init.timeout);

        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(utils.agent);
        // user
        await init.registerUser(user, page);

        done();
    });

    afterAll(async done => {
        await browser.close();
        done();
    });

    test(
        'should create a custom smtp settings',
        async done => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });
            await page.waitForSelector('#projectSettings', {
                visible: true,
            });
            await init.pageClick(page, '#projectSettings');
            await page.waitForSelector('#more', { visible: true });
            await init.pageClick(page, '#more');
            await page.waitForSelector('#email', { visible: true });
            await init.pageClick(page, '#email');
            await page.waitForSelector('#showsmtpForm', { visible: true });
            await init.pageClick(page, '#showsmtpForm');
            await page.waitForSelector('#user', { visible: true });
            await init.pageClick(page, '#user');
            await init.pageType(page, '#user', smtpData.user);
            await init.pageClick(page, '#pass');
            await init.pageType(page, '#pass', smtpData.pass);
            await init.pageClick(page, '#host');
            await init.pageType(page, '#host', smtpData.host);
            await init.pageClick(page, '#port');
            await init.pageType(page, '#port', smtpData.port);
            await init.pageClick(page, '#from');
            await init.pageType(page, '#from', smtpData.from);
            await init.pageClick(page, '#name');
            await init.pageType(page, '#name', name);
            await page.$eval('#secure', elem => (elem.checked = true));
            await init.pageClick(page, '#saveSmtp');

            await page.waitForSelector('.ball-beat', { hidden: true });
            await page.reload();
            await page.waitForSelector('#host', { visible: true });
            const host = await page.$eval('#host', elem => elem.value);
            expect(host).toEqual(smtpData.host);

            done();
        },
        operationTimeOut
    );

    test(
        'should update a custom smtp settings',
        async done => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });
            await page.waitForSelector('#projectSettings', {
                visible: true,
            });
            await init.pageClick(page, '#projectSettings');
            await page.waitForSelector('#more', { visible: true });
            await init.pageClick(page, '#more');
            await page.waitForSelector('#email', { visible: true });
            await init.pageClick(page, '#email');
            const from = 'test@fyipe.com';
            await page.waitForSelector('#from', { visible: true });
            await init.pageClick(page, '#from', { clickCount: 3 });
            await init.pageType(page, '#from', from);
            await init.pageClick(page, '#saveSmtp');
            await page.waitForSelector('.ball-beat', { visible: true });
            await page.waitForSelector('.ball-beat', { hidden: true });
            await page.reload();
            await page.waitForSelector('#from', { visible: true });
            const fromVal = await page.$eval('#from', elem => elem.value);
            expect(fromVal).toEqual(from);

            done();
        },
        operationTimeOut
    );

    test(
        'should not save a custom smtp settings if one of the input fields is missing',
        async done => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });
            await page.waitForSelector('#projectSettings', {
                visible: true,
            });
            await init.pageClick(page, '#projectSettings');
            await page.waitForSelector('#more', { visible: true });
            await init.pageClick(page, '#more');
            await page.waitForSelector('#email', { visible: true });
            await init.pageClick(page, '#email');
            await page.waitForSelector('#port', { visible: true });
            const port = await page.$('#port');
            await port.click({ clickCount: 3 });
            await port.press('Backspace'); // clear out the input field
            await init.pageClick(page, '#saveSmtp');
            await page.waitForSelector('#field-error', {
                visible: true,
            });
            const errorMessage = await page.$eval(
                '#field-error',
                element => element.textContent
            );
            expect(errorMessage).toEqual(
                'Please input port this cannot be left blank.'
            );

            done();
        },
        operationTimeOut
    );

    test(
        'should delete custom smtp settings',
        async done => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });
            await page.waitForSelector('#projectSettings', {
                visible: true,
            });
            await init.pageClick(page, '#projectSettings');
            await page.waitForSelector('#more', { visible: true });
            await init.pageClick(page, '#more');
            await page.waitForSelector('#email', { visible: true });
            await init.pageClick(page, '#email');
            await page.waitForSelector('label[id=showsmtpForm]', {
                visible: true,
            });
            await page.waitForSelector('label[id=enableSecureTransport]', {
                visible: true,
            });
            await page.waitForSelector('#saveSmtp', { visible: true });
            await init.pageClick(page, 'label[id=enableSecureTransport]');
            await init.pageClick(page, 'label[id=showsmtpForm]');
            await init.pageClick(page, '#saveSmtp');
            await page.reload();
            const username = await page.$('#user');
            expect(username).toBe(null);

            done();
        },
        operationTimeOut
    );

    test(
        'should not display any error message if custom smtp settings is already deleted and user clicks on save',
        async done => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });
            await page.waitForSelector('#projectSettings', {
                visible: true,
            });
            await init.pageClick(page, '#projectSettings');
            await page.waitForSelector('#more', { visible: true });
            await init.pageClick(page, '#more');
            await page.waitForSelector('#email', { visible: true });
            await init.pageClick(page, '#email');
            await page.waitForSelector('#saveSmtp', { visible: true });
            await init.pageClick(page, '#saveSmtp');
            const error = await page.waitForSelector('#errorInfo', {
                hidden: true,
            });
            expect(error).toBeDefined();

            done();
        },
        operationTimeOut
    );
});
