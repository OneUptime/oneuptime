const utils = require('./test-utils');

module.exports = {
    loginUser: async function(user, page) {
        const { email, password } = user;
        await page.goto(utils.ACCOUNTS_URL + '/accounts/login', {
            waitUntil: 'networkidle2',
        });
        await page.waitForSelector('#login-button');
        await page.click('input[name=email]');
        await page.type('input[name=email]', email);
        await page.click('input[name=password]');
        await page.type('input[name=password]', password);
        await Promise.all([
            page.click('button[type=submit]'),
            page.waitForNavigation(),
        ]);
    },
    registerEnterpriseUser: async function(user, page) {
        const { email } = user;
        await page.goto(utils.ACCOUNTS_URL + '/login', {
            waitUntil: 'networkidle2',
        });
        const signUp = await page.$('#signUpLink');
        if (signUp) {
            await page.goto(utils.ACCOUNTS_URL + '/register', {
                waitUntil: 'networkidle2',
            });
            await page.waitForSelector('#email');
            await page.click('input[name=email]');
            await page.type('input[name=email]', email);
            await page.click('input[name=name]');
            await page.type('input[name=name]', 'Master Admin');
            await page.click('input[name=companyName]');
            await page.type('input[name=companyName]', 'Master');
            await page.click('input[name=companyPhoneNumber]');
            await page.type('input[name=companyPhoneNumber]', '99105688');
            await page.click('input[name=password]');
            await page.type('input[name=password]', '1234567890');
            await page.click('input[name=confirmPassword]');
            await page.type('input[name=confirmPassword]', '1234567890');
            await page.click('button[type=submit]');
            await page.waitFor(5000);
        }
    },
};
