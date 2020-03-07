const puppeteer = require('puppeteer');
const utils = require('./test-utils');
const init = require('./test-init');

require('should');

let browser;
let page;

const email = utils.generateRandomBusinessEmail();
const password = utils.generateRandomString();
const user = {
    email,
    password,
};

describe('Enterprise Registration API', () => {
    beforeAll(async () => {
        jest.setTimeout(15000);
        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/61.0.3163.100 Safari/537.36'
        );
    });

    afterAll(async () => {
        await browser.close();
    });

    it('Should register Initial User with valid details as `master-admin`', async () => {
        await init.registerEnterpriseUser(user, page);
        await page.waitFor(15000);
        const html = await page.$eval('#main-body', e => {
            return e.innerHTML;
        });
        html.should.containEql('Activate your Fyipe account');
    }, 160000);
});
