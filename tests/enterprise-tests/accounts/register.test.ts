
import puppeteer from 'puppeteer';

import should from 'should';
import utils from '../../test-utils';
import init from '../../test-init';

let browser: $TSFixMe, otherBrowser: $TSFixMe;
let page: $TSFixMe, otherPage: $TSFixMe;

const email = 'masteradmin@hackerbay.io';
const password = '1234567890';
const user = {
    email,
    password,
};


describe('Enterprise Registration API', () => {
    
    beforeAll(async () => {
        
        jest.setTimeout(15000);
        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        otherBrowser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        otherPage = await otherBrowser.newPage();
        await page.setUserAgent(utils.agent);
        await otherPage.setUserAgent(utils.agent);
    });

    
    afterAll(async () => {
        await browser.close();
        await otherBrowser.close();
    });

    
    it(
        'Should register Initial User with valid details',
        async () => {
            await init.registerEnterpriseUser(user, page);

            const localStorageData = await page.evaluate(() => {
                const json = {};
                for (let i = 0; i < localStorage.length; i++) {
                    const key = localStorage.key(i);
                    
                    json[key] = localStorage.getItem(key);
                }
                return json;
            });

            localStorageData.should.have.property('access_token');
            localStorageData.should.have.property('email', email);
            page.url().should.containEql(utils.ADMIN_DASHBOARD_URL);
        },
        init.timeout
    );

    
    it(
        'Should redirect to Login Page and hide Sign Up Link for Subsequent Users',
        async () => {
            try {
                await otherPage.goto(utils.ACCOUNTS_URL + '/register', {
                    waitUntil: 'networkidle2',
                });
            } catch (e) {
                //
            }
            await otherPage.waitForTimeout(5000);
            otherPage
                .url()
                .should.containEql(utils.ACCOUNTS_URL + '/accounts/login');

            const signUp = await otherPage.$('#signUpLink');
            should.not.exist(signUp);
        },
        init.timeout
    );

    
    it(
        'Should login Initial User to Admin Dashboard',
        async () => {
            await init.loginAdminUser(user, otherPage);

            const localStorageData = await otherPage.evaluate(() => {
                const json = {};
                for (let i = 0; i < localStorage.length; i++) {
                    const key = localStorage.key(i);
                    
                    json[key] = localStorage.getItem(key);
                }
                return json;
            });

            await otherPage.waitForTimeout(10000);
            localStorageData.should.have.property('access_token');
            localStorageData.should.have.property('email', email);
            otherPage.url().should.containEql(utils.ADMIN_DASHBOARD_URL);
        },
        init.timeout
    );
});
