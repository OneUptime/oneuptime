
import puppeteer from 'puppeteer';

import should from 'should';
import utils from '../../test-utils';
import init from '../../test-init';

let browser: $TSFixMe;
let page: $TSFixMe;

const email = utils.generateRandomBusinessEmail();
const password = '1234567890';
const user = {
    email,
    password,
};


describe('Change Password API', () => {
    
    beforeAll(async () => {
        
        jest.setTimeout(15000);
        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(utils.agent);
    });

    
    afterAll(async () => {
        await browser.close();
    });

    
    it(
        'Should not allow change of password if password and confirm password do not math',
        async () => {
            await page.goto(
                utils.ACCOUNTS_URL + '/change-password/thisisaWrongRestToken',
                { waitUntil: 'networkidle2' }
            );
            
            await init.pageWaitForSelector(page, '#password');
            
            await init.pageClick(page, 'input[name=password]');
            
            await init.pageType(page, 'input[name=password]', user.password);
            
            await init.pageWaitForSelector(page, '#confirmPassword');
            
            await init.pageClick(page, 'input[name=confirmPassword]');
            
            await init.pageType(
                page,
                'input[name=confirmPassword]',
                'unmatchingPassword'
            );
            
            await init.pageClick(page, 'button[type=submit]');
            
            await init.pageWaitForSelector(
                page,
                '#confirmPasswordField > span > span:nth-child(2)'
            );
            const html = await init.page$Eval(
                page,
                '#confirmPasswordField > span > span:nth-child(2)',
                (e: $TSFixMe) => {
                    return e.innerHTML;
                }
            );
            should.exist(html);
            html.should.containEql(
                'Password and confirm password should match.'
            );
        },
        init.timeout
    );

    
    it(
        'Should submit if password is less than 8 characters',
        async () => {
            await page.goto(
                utils.ACCOUNTS_URL + '/change-password/thisisaWrongRestToken',
                { waitUntil: 'networkidle2' }
            );
            
            await init.pageWaitForSelector(page, '#password');
            
            await init.pageClick(page, 'input[name=password]');
            
            await init.pageType(page, 'input[name=password]', '123456');
            
            await init.pageWaitForSelector(page, '#confirmPassword');
            
            await init.pageClick(page, 'input[name=confirmPassword]');
            
            await init.pageType(page, 'input[name=confirmPassword]', '123456');
            
            await init.pageClick(page, 'button[type=submit]');
            
            await init.pageWaitForSelector(
                page,
                '#passwordField > span > span:nth-child(1)'
            );
            const html = await init.page$Eval(
                page,
                '#passwordField > span > span:nth-child(2)',
                (e: $TSFixMe) => {
                    return e.innerHTML;
                }
            );
            should.exist(html);
            html.should.containEql(
                'Password should be atleast 8 characters long'
            );
        },
        init.timeout
    );

    
    it(
        'Should submit if password is missing',
        async () => {
            await page.goto(
                utils.ACCOUNTS_URL + '/change-password/thisisaWrongRestToken',
                { waitUntil: 'networkidle2' }
            );
            
            await init.pageWaitForSelector(page, '#password');
            
            await init.pageClick(page, 'input[name=password]');
            
            await init.pageType(page, 'input[name=password]', '');
            
            await init.pageWaitForSelector(page, '#confirmPassword');
            
            await init.pageClick(page, 'input[name=confirmPassword]');
            
            await init.pageType(page, 'input[name=confirmPassword]', '123456');
            
            await init.pageClick(page, 'button[type=submit]');
            
            await init.pageWaitForSelector(
                page,
                '#passwordField > span > span:nth-child(1)'
            );
            const html = await init.page$Eval(
                page,
                '#passwordField > span > span:nth-child(2)',
                (e: $TSFixMe) => {
                    return e.innerHTML;
                }
            );
            should.exist(html);
            html.should.containEql('Password is required.');
        },
        init.timeout
    );
});
