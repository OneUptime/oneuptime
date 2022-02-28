
import puppeteer from 'puppeteer';

import should from 'should';
import utils from '../../test-utils';
import init from '../../test-init';
let browser: $TSFixMe;
let page: $TSFixMe;


describe('Resend Verification API', () => {
    
    beforeAll(async () => {
        
        jest.setTimeout(init.timeout);

        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(utils.agent);
    });

    
    afterAll(async () => {
        await browser.close();
    });

    
    it(
        'Should not resend verification token if a user associated with the email does not exist',
        async () => {
            await page.goto(utils.ACCOUNTS_URL + '/user-verify/resend', {
                waitUntil: 'networkidle2',
            });
            
            await init.pageWaitForSelector(page, '#email');
            
            await init.pageClick(page, 'input[name=email]');
            
            await init.pageType(page, 'input[name=email]', 'invalid@email.com');
            
            await init.pageClick(page, 'button[type=submit]');
            
            await init.pageWaitForSelector(page, '#error-msg');
            const html = await init.page$Eval(
                page,
                '#error-msg',
                (e: $TSFixMe) => {
                    return e.innerHTML;
                }
            );
            should.exist(html);
            html.should.containEql('No user associated with this account');
        },
        init.timeout
    );
});
