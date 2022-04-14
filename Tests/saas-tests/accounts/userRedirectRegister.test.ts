import puppeteer from 'puppeteer';
import Email from 'Common/Types/Email';
import utils from '../../test-utils';
import init from '../../test-init';

import axios from 'axios';

let page, browser: $TSFixMe;

// user credentials
const email: $TSFixMe: Email = utils.generateRandomBusinessEmail();
const password: string = '1234567890';
const queryString: string =
    '?utm_source=runningtest&good=thankyou&kill=love&ion=pure';
let queryObj = {};

describe('Home redirect', () => {
    beforeAll(async (done: $TSFixMe) => {
        jest.setTimeout(init.timeout);

        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(utils.agent);
        await page.goto(`${utils.HOME_URL}${queryString}`, {
            waitUntil: 'networkidle2',
        });
        await page.goto(`${utils.ACCOUNTS_URL}/accounts/register`, {
            waitUntil: 'networkidle2',
        });
        // Register user
        const user: $TSFixMe = {
            email,
            password,
        };
        // user
        await init.registerUser(user, page);

        const params: $TSFixMe = new URLSearchParams(queryString);
        // formating query string to an object
        for (const param of params) {
            queryObj = { ...queryObj, [`${param[0]}`]: param[1] };
        }
        done();
    });

    afterAll(async (done: $TSFixMe) => {
        await browser.close();
        done();
    });

    test(
        'redirected query string should be save as source in the user schema',
        async () => {
            const data: $TSFixMe = {
                collection: 'users',
                query: { email: email },
            };
            const config: $TSFixMe = {
                method: 'post',
                url: utils.INIT_SCRIPT_URL + '/find',
                headers: {
                    'Content-Type': 'application/json',
                },
                data: data,
            };
            const res: $TSFixMe = await axios(config);
            const sourceObj: $TSFixMe = res.data[0].source;
            for (const key in sourceObj) {
                expect(sourceObj[key]).toEqual(queryObj[key]);
            }
        },
        init.timeout
    );
});
