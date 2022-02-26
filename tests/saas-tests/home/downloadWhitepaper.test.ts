// @ts-expect-error ts-migrate(2307) FIXME: Cannot find module 'puppeteer' or its correspondin... Remove this comment to see the full error message
import puppeteer from 'puppeteer'
import utils from '../../test-utils'
import init from '../../test-init'
// @ts-expect-error ts-migrate(2307) FIXME: Cannot find module 'axios' or its corresponding ty... Remove this comment to see the full error message
import axios from 'axios'

let page, browser: $TSFixMe;

// user credentials
const email = utils.generateRandomBusinessEmail();
const queryString = '?utm_source=runningtest&good=thankyou&kill=love&ion=pure';
let queryObj = {};

// @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'describe'. Do you need to instal... Remove this comment to see the full error message
describe('Download Whitepaper form', () => {
    // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'beforeAll'.
    beforeAll(async (done: $TSFixMe) => {
        // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'jest'.
        jest.setTimeout(init.timeout);

        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(utils.agent);
        await page.goto(`${utils.HOME_URL}${queryString}`, {
            waitUntil: 'networkidle2',
        });
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await init.pageClick(page, '#accept-cookies');
        await page.goto(`${utils.HOME_URL}/enterprise/resources`, {
            waitUntil: 'networkidle2',
        });
        await page.goto(
            `${utils.HOME_URL}/enterprise/download-resource/website-monitoring`,
            {
                waitUntil: 'networkidle2',
            }
        );
        await page.goto(`${utils.HOME_URL}/enterprise/resources`);
        await init.pageWaitForSelector(page, '#website-monitoring', {
            visible: true,
            timeout: init.timeout,
        });
        await Promise.all([
            page.waitForNavigation(),
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
            init.pageClick(page, '#website-monitoring'),
        ]);
        await init.pageWaitForSelector(page, '#form-section', {
            visible: true,
            timeout: init.timeout,
        });
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
        await init.pageType(page, '#fullname', utils.user.name);
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
        await init.pageType(page, '#email', email);
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
        await init.pageType(page, '#phone', utils.user.phone);
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 4 arguments, but got 3.
        await init.pageType(page, '#website', utils.user.website);
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await init.pageClick(page, '#country');
        await page.keyboard.press('ArrowDown');
        await page.keyboard.down('Enter');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await init.pageClick(page, '#volume');
        await page.keyboard.press('ArrowDown');
        await page.keyboard.down('Enter');
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
        await init.pageClick(page, '#request-resource-btn');

        const params = new URLSearchParams(queryString);
        // formating query string to an object
        for (const param of params) {
            queryObj = { ...queryObj, [`${param[0]}`]: param[1] };
        }
        done();
    });

    // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'afterAll'.
    afterAll(async (done: $TSFixMe) => {
        await browser.close();
        done();
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'test'. Do you need to install ty... Remove this comment to see the full error message
    test(
        'redirected query string should be save as source in the leads schema',
        async (done: $TSFixMe) => {
            const data = {
                collection: 'leads',
                query: { email: email },
            };
            const config = {
                method: 'post',
                url: utils.INIT_SCRIPT_URL + '/find',
                headers: {
                    'Content-Type': 'application/json',
                },
                data: data,
            };
            const res = await axios(config);
            const sourceObj = res.data[0].source;
            for (const key in sourceObj) {
                // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
                expect(sourceObj[key]).toEqual(queryObj[key]);
            }
            done();
        },
        init.timeout
    );
});
