
import puppeteer from 'puppeteer';
import utils from '../../test-utils';
import init from '../../test-init';

let browser: $TSFixMe, page: $TSFixMe;
require('should');

// user credentials
const email = utils.generateRandomBusinessEmail();
const password = '1234567890';
const componentName = utils.generateRandomString();


describe('Monitor API', () => {
    
    beforeAll(async () => {
        
        jest.setTimeout(600000);

        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(utils.agent);

        const user = {
            email,
            password,
        };
        await init.registerUser(user, page);
        await init.addComponent(componentName, page);
    });

    
    afterAll(async (done: $TSFixMe) => {
        await browser.close();
        done();
    });

    
    test('should display SSL self-signed status', async (done: $TSFixMe) => {
        const selfSignedMonitorName = utils.generateRandomString();

        // Navigate to Component details
        await init.navigateToComponentDetails(componentName, page);

        
        await init.pageWaitForSelector(page, '#form-new-monitor');
        await init.pageWaitForSelector(page, 'input[id=name]', {
            visible: true,
            timeout: init.timeout,
        });

        
        await init.pageClick(page, 'input[id=name]');
        await page.focus('input[id=name]');
        
        await init.pageType(page, 'input[id=name]', selfSignedMonitorName);
        
        await init.pageClick(page, '[data-testId=type_url]');
        await init.pageWaitForSelector(page, '#url', {
            visible: true,
            timeout: init.timeout,
        });
        
        await init.pageClick(page, '#url');
        
        await init.pageType(page, '#url', 'https://self-signed.badssl.com');

        
        await init.pageClick(page, 'button[type=submit]');

        let sslStatusElement = await init.pageWaitForSelector(
            page,
            `#ssl-status-${selfSignedMonitorName}`,
            { visible: true, timeout: 600000 }
        );
        sslStatusElement = await sslStatusElement.getProperty('innerText');
        sslStatusElement = await sslStatusElement.jsonValue();
        sslStatusElement.should.be.exactly('Self Signed');
        done();
    }, 600000);
});
