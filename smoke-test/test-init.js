const utils = require('./test-utils');

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
        await page.goto(utils.ACCOUNTS_URL + '/register', {
            waitUntil: 'networkidle2',
        });
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
        await page.waitFor(15000);

        await page.waitForSelector('iframe[name=__privateStripeFrame5]');
        await page.waitForSelector('iframe[name=__privateStripeFrame6]');
        await page.waitForSelector('iframe[name=__privateStripeFrame7]');
        await page.click('input[name=cardName]');
        await page.type('input[name=cardName]', 'Test name');

        elementHandle = await page.$('iframe[name=__privateStripeFrame5]');
        frame = await elementHandle.contentFrame();
        await frame.waitForSelector('input[name=cardnumber]');
        await frame.type('input[name=cardnumber]', '42424242424242424242', {
            delay: 50,
        });

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
        await page.click('button[type=submit]');
        await page.waitFor(25000);
    },
    loginUser: async function(user, page) {
        const { email, password } = user;
        await page.goto(utils.ACCOUNTS_URL + '/login', {
            waitUntil: 'networkidle2',
        });
        await page.waitForSelector('#login-button');
        await page.click('input[name=email]');
        await page.type('input[name=email]', email);
        await page.click('input[name=password]');
        await page.type('input[name=password]', password);
        await page.click('button[type=submit]');
        await page.waitFor(15000);
    },
    registerEnterpriseUser: async function(user, page) {
        const masterAdmin = {
            email: 'masteradmin@hackerbay.io',
            password: '1234567890',
        };
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
            await page.type('input[name=email]', masterAdmin.email);
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
        } else {
            await this.loginUser(masterAdmin, page);
        }
        await page.waitFor(20000);
        // create the user from admin dashboard
        const { email } = user;
        await page.waitForSelector('#add_user');
        await page.click('#add_user');
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
        await page.waitFor(15000);
    },
    selectByText: async function(selector, text, page) {
        await page.click(selector);
        await page.keyboard.type(text);
        const noOption = await page.$('div.css-1gl4k7y');
        if (!noOption) {
            await page.keyboard.type(String.fromCharCode(13));
        }
    },
};
