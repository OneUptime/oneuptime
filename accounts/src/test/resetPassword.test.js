const puppeteer = require('puppeteer');
var should = require('should');
var utils = require('./test-utils');
var init = require('./test-init');

let browser;
let page, userCredentials;

let email = utils.generateRandomBusinessEmail();
let password = utils.generateRandomString();
const user = {
    email,
    password
};

describe('Reset Password API', () => {

   beforeAll(async () => {

      jest.setTimeout(15000);
      browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
      page = await browser.newPage();
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/61.0.3163.100 Safari/537.36');
  });

   afterAll(async () => {
      await browser.close();
   });

   it('Should reset password successfully', async () => {
      await init.registerUser(user, page)
      await page.goto(utils.ACCOUNTS_URL + '/forgot-password', { waitUntil: 'networkidle2' });
      await page.waitForSelector('#email');
      await page.click('input[name=email]');
      await page.type('input[name=email]', email);
      await page.click('button[type=submit]');
      await page.waitForSelector('#reset-password-success');
      const html = await page.$eval('#reset-password-success', (e) => {
         return e.innerHTML;
      });
      should.exist(html);
      html.should.containEql(" An email is on its way to you. Follow the instructions to reset your password. Please don't forget to check spam. ");
   }, 160000);

   it('User cannot reset password with non-existing email', async () => {
      await page.goto(utils.ACCOUNTS_URL + '/forgot-password', { waitUntil: 'networkidle2' });
      await page.waitForSelector('#email');
      await page.click('input[name=email]');
      await page.type('input[name=email]', utils.generateWrongEmail());
      await page.click('button[type=submit]');
      await page.waitForSelector('#error-msg');
      const html = await page.$eval('#error-msg', (e) => {
         return e.innerHTML;
     });
      should.exist(html);
      html.should.containEql('User does not exist.');
   }, 160000);
});