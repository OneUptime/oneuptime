const utils = require('./test-utils');
const cards = [
    '4000056655665556',
    '4242424242424242',
    '5555555555554444',
    '2223003122003222',
    '5200828282828210',
    '5105105105105100',
];
module.exports = {
    /**
     *
     * @param { ObjectConstructor } user
     * @param { string } page
     * @description Registers a new user.
     * @returns { void }
     */
    registerUser: async function(user, page) {
        const { email } = user;
        let frame, elementHandle;
        try {
            await page.goto(utils.ACCOUNTS_URL + '/register', {
                waitUntil: 'networkidle2',
            });
        } catch (e) {
            //
        }
        await page.waitForSelector('#email');
        await page.click('input[name=email]');
        await page.type('input[name=email]', email);
        await page.click('input[name=name]');
        await page.type('input[name=name]', 'Test Name');
        await page.click('input[name=companyName]');
        await page.type('input[name=companyName]', 'Test Name');
        await page.click('input[name=companyPhoneNumber]');
        await page.type('input[name=companyPhoneNumber]', '99105688');
        await page.click('input[name=password]');
        await page.type('input[name=password]', '1234567890');
        await page.click('input[name=confirmPassword]');
        await page.type('input[name=confirmPassword]', '1234567890');
        await page.click('button[type=submit]');
        await page.waitForSelector('iframe[name=__privateStripeFrame5]');
        await page.waitForSelector('iframe[name=__privateStripeFrame6]');
        await page.waitForSelector('iframe[name=__privateStripeFrame7]');
        await page.waitFor(5000);
        await page.click('input[name=cardName]');
        await page.type('input[name=cardName]', 'Test name');

        elementHandle = await page.$('iframe[name=__privateStripeFrame5]');
        frame = await elementHandle.contentFrame();
        await frame.waitForSelector('input[name=cardnumber]');
        await frame.type(
            'input[name=cardnumber]',
            cards[Math.floor(Math.random() * cards.length)],
            {
                delay: 50,
            }
        );

        elementHandle = await page.$('iframe[name=__privateStripeFrame6]');
        frame = await elementHandle.contentFrame();
        await frame.waitForSelector('input[name=cvc]');
        await frame.type('input[name=cvc]', '123', {
            delay: 50,
        });

        elementHandle = await page.$('iframe[name=__privateStripeFrame7]');
        frame = await elementHandle.contentFrame();
        await frame.waitForSelector('input[name=exp-date]');
        await frame.type('input[name=exp-date]', '11/23', {
            delay: 50,
        });
        await page.click('input[name=address1]');
        await page.type('input[name=address1]', utils.user.address.streetA);
        await page.click('input[name=address2]');
        await page.type('input[name=address2]', utils.user.address.streetB);
        await page.click('input[name=city]');
        await page.type('input[name=city]', utils.user.address.city);
        await page.click('input[name=state]');
        await page.type('input[name=state]', utils.user.address.state);
        await page.click('input[name=zipCode]');
        await page.type('input[name=zipCode]', utils.user.address.zipcode);
        await page.select('#country', 'India');
        await page.waitFor(60000); //wait for a second because of stripe rate limits.
        await page.click('button[type=submit]');
        await page.waitForSelector('.request-reset-step', {
            timeout: 60000,
        });
    },
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
            await page.type('input[name=email]', user.email);
            await page.click('input[name=name]');
            await page.type('input[name=name]', 'Test Name');
            await page.click('input[name=companyName]');
            await page.type('input[name=companyName]', 'Test Name');
            await page.click('input[name=companyPhoneNumber]');
            await page.type('input[name=companyPhoneNumber]', '99105688');
            await page.click('input[name=password]');
            await page.type('input[name=password]', '1234567890');
            await page.click('input[name=confirmPassword]');
            await page.type('input[name=confirmPassword]', '1234567890');
            await Promise.all([
                page.click('button[type=submit]'),
                page.waitForNavigation(),
            ]);
        } else {
            await this.loginUser(user, page);
            // await this.createUserFromAdminDashboard(user, page);
        }
    },
};
