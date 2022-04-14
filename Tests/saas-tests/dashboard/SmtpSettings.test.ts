import puppeteer from 'puppeteer';
import Email from 'Common/Types/Email';
import utils from '../../test-utils';
import init from '../../test-init';

import 'should';
let browser: $TSFixMe, page: $TSFixMe;
// user credentials
const email: Email = utils.generateRandomBusinessEmail();
const name: string = utils.generateRandomString();
const password: string = '1234567890';
const user: $TSFixMe = {
    email,
    password,
};
// smtp credential
const smtpData: $TSFixMe = { ...utils.smtpCredential };

describe('Custom SMTP Settings', () => {
    const operationTimeOut: $TSFixMe = init.timeout;

    beforeAll(async (done: $TSFixMe) => {
        jest.setTimeout(init.timeout);

        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(utils.agent);
        // user
        await init.registerUser(user, page);

        done();
    });

    afterAll(async (done: $TSFixMe) => {
        await browser.close();
        done();
    });

    test(
        'should create a custom smtp settings',
        async (done: $TSFixMe) => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });
            await init.pageWaitForSelector(page, '#projectSettings', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#projectSettings');
            await init.pageWaitForSelector(page, '#more', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#more');
            await init.pageWaitForSelector(page, '#email', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#email');
            await init.pageWaitForSelector(page, '#showsmtpForm', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#showsmtpForm');
            await init.pageWaitForSelector(page, '#user', {
                visible: true,
                timeout: init.timeout,
            });

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
            await init.page$Eval(
                page,
                '#secure',
                (elem: $TSFixMe) => (elem.checked = true)
            );

            await init.pageClick(page, '#saveSmtp');

            await init.pageWaitForSelector(page, '.ball-beat', {
                hidden: true,
            });
            await init.navigateToSmtp(page);
            await init.pageWaitForSelector(page, '#host', {
                visible: true,
                timeout: init.timeout,
            });
            const host: $TSFixMe = await init.page$Eval(
                page,
                '#host',
                (elem: $TSFixMe) => elem.value
            );
            expect(host).toEqual(smtpData.host);

            done();
        },
        operationTimeOut
    );

    test(
        'should update a custom smtp settings',
        async (done: $TSFixMe) => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });
            await init.pageWaitForSelector(page, '#projectSettings', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#projectSettings');
            await init.pageWaitForSelector(page, '#more', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#more');
            await init.pageWaitForSelector(page, '#email', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#email');
            const from: string = 'test@oneuptime.com';
            await init.pageWaitForSelector(page, '#from', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageClick(page, '#from', { clickCount: 3 });

            await init.pageType(page, '#from', from);

            await init.pageClick(page, '#saveSmtp');

            await init.pageWaitForSelector(page, '#saveSmtpLoading');
            await init.pageWaitForSelector(page, '#saveSmtpLoading', {
                hidden: true, // This confirms that the request has been fulfilled
            });

            await init.navigateToSmtp(page);
            await init.pageWaitForSelector(page, '#from', {
                visible: true,
                timeout: init.timeout,
            });
            const fromVal: $TSFixMe = await init.page$Eval(
                page,
                '#from',
                (elem: $TSFixMe) => elem.value
            );
            expect(fromVal).toEqual(from);

            done();
        },
        operationTimeOut
    );

    test(
        'should not save a custom smtp settings if one of the input fields is missing',
        async (done: $TSFixMe) => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });
            await init.pageWaitForSelector(page, '#projectSettings', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#projectSettings');
            await init.pageWaitForSelector(page, '#more', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#more');
            await init.pageWaitForSelector(page, '#email', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#email');
            await init.pageWaitForSelector(page, '#port', {
                visible: true,
                timeout: init.timeout,
            });

            const port: $TSFixMe = await init.page$(page, '#port');
            await port.click({ clickCount: 3 });
            await port.press('Backspace'); // clear out the input field

            await init.pageClick(page, '#saveSmtp');

            await init.pageWaitForSelector(page, '#port');
            const emptyMessage: $TSFixMe = await init.page$Eval(
                page,
                '#port',
                (element: $TSFixMe) => element.textContent
            );
            // This confirms that the port is empty, hence could not be saved
            expect(emptyMessage).toEqual('');

            done();
        },
        operationTimeOut
    );

    test(
        'should delete custom smtp settings',
        async (done: $TSFixMe) => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });
            await init.pageWaitForSelector(page, '#projectSettings', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#projectSettings');
            await init.pageWaitForSelector(page, '#more', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#more');
            await init.pageWaitForSelector(page, '#email', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#email');
            await init.pageWaitForSelector(page, 'label[id=showsmtpForm]', {
                visible: true,
                timeout: init.timeout,
            });
            await init.pageWaitForSelector(
                page,
                'label[id=enableSecureTransport]',
                {
                    visible: true,
                    timeout: init.timeout,
                }
            );
            await init.pageWaitForSelector(page, '#saveSmtp', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, 'label[id=enableSecureTransport]');

            await init.pageClick(page, 'label[id=showsmtpForm]');

            await init.pageClick(page, '#saveSmtp');
            await init.navigateToSmtp(page);
            const username: $TSFixMe = await init.page$(page, '#user', {
                hidden: true,
            });
            expect(username).toBe(null);

            done();
        },
        operationTimeOut
    );

    test(
        'should not display any error message if custom smtp settings is already deleted and user clicks on save',
        async (done: $TSFixMe) => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });
            await init.pageWaitForSelector(page, '#projectSettings', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#projectSettings');
            await init.pageWaitForSelector(page, '#more', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#more');
            await init.pageWaitForSelector(page, '#email', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#email');
            await init.pageWaitForSelector(page, '#saveSmtp', {
                visible: true,
                timeout: init.timeout,
            });

            await init.pageClick(page, '#saveSmtp');
            const error: $TSFixMe = await init.pageWaitForSelector(
                page,
                '#errorInfo',
                {
                    hidden: true,
                }
            );
            expect(error).toBeDefined();

            done();
        },
        operationTimeOut
    );
});
