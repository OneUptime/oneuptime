
import puppeteer from 'puppeteer';
import utils from '../../test-utils';
import init from '../../test-init';

let browser: $TSFixMe, page: $TSFixMe;
const user = {
    email: utils.generateRandomBusinessEmail(),
    password: '1234567890',
};

const resourceCategory = utils.generateRandomString();

/** This is a test to check:
 * No errors on page reload
 * It stays on the same page on reload
 */


describe('OneUptime Page Reload', () => {
    const operationTimeOut = init.timeout;

    
    beforeAll(async (done: $TSFixMe) => {
        
        jest.setTimeout(init.timeout);

        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(utils.agent);
        await init.registerUser(user, page); // This automatically routes to dashboard page
        done();
    });

    
    afterAll(async (done: $TSFixMe) => {
        await browser.close();
        done();
    });

    
    test.skip(
        'Should reload the resource category page and confirm there are no errors',
        async (done: $TSFixMe) => {
            await page.goto(utils.DASHBOARD_URL, {
                waitUntil: ['networkidle2'],
            });
            
            await init.pageClick(page, '#projectSettings');
            
            await init.pageClick(page, '#more');
            
            await init.pageClick(page, '#resources');
            
            await init.pageClick(page, '#createResourceCategoryButton');
            
            await init.pageType(
                page,
                '#resourceCategoryName',
                resourceCategory
            );
            
            await init.pageClick(page, '#addResourceCategoryButton');
            await init.pageWaitForSelector(page, '#addResourceCategoryButton', {
                hidden: true,
            });
            await init.pageWaitForSelector(page, '#resource-category-name', {
                visible: true,
                timeout: init.timeout,
            });
            //To confirm no errors and stays on the same page on reload
            await page.reload({ waitUntil: 'networkidle2' });
            await init.pageWaitForSelector(page, '#cbResources', {
                visible: true,
                timeout: init.timeout,
            });
            const spanElement = await init.pageWaitForSelector(
                page,
                '#resource-category-name',
                { visible: true, timeout: init.timeout }
            );
            expect(spanElement).toBeDefined();
            done();
        },
        operationTimeOut
    );
});
