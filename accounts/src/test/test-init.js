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
    registerUser: async function(user, page, checkCard = true) {
        const { email, password } = user;
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
        await page.type('input[name=password]', password);
        await page.click('input[name=confirmPassword]');
        await page.type('input[name=confirmPassword]', password);

        if (checkCard) {
            await Promise.all([
                page.waitForSelector(`form#card-form`),
                page.click('button[type=submit]'),
            ]);
            await page.waitForSelector('.__PrivateStripeElement > iframe', {
                visible: true,
                timeout: 200000,
            });
            const stripeIframeElements = await page.$$(
                '.__PrivateStripeElement > iframe'
            );

            await page.click('input[name=cardName]');
            await page.type('input[name=cardName]', 'Test name');

            elementHandle = stripeIframeElements[0]; // card element
            frame = await elementHandle.contentFrame();
            await frame.waitForSelector('input[name=cardnumber]');
            await frame.type(
                'input[name=cardnumber]',
                cards[Math.floor(Math.random() * cards.length)],
                {
                    delay: 150,
                }
            );

            elementHandle = stripeIframeElements[1]; // cvc element
            frame = await elementHandle.contentFrame();
            await frame.waitForSelector('input[name=cvc]');
            await frame.type('input[name=cvc]', '123', {
                delay: 150,
            });

            elementHandle = stripeIframeElements[2]; // exp element
            frame = await elementHandle.contentFrame();
            await frame.waitForSelector('input[name=exp-date]');
            await frame.type('input[name=exp-date]', '11/23', {
                delay: 150,
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
        }

        await Promise.all([
            // page.waitForSelector('div#success-step'),
            page.waitForTimeout(10000),
            page.click('button[type=submit]'),
            page.waitForNavigation(),
        ]);
    },
    loginUser: async function(
        user,
        page,
        url = utils.ACCOUNTS_URL + '/accounts/login'
    ) {
        const { email, password } = user;
        await page.goto(url, {
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
    logoutUser: async function(page) {
        await page.waitForSelector('button#profile-menu', { visible: true });
        await page.click('button#profile-menu');
        await page.waitForSelector('button#logout-button');
        await page.click('button#logout-button');
        await page.waitForSelector('#login-button', { visible: true });
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
            await Promise.all([
                page.click('button[type=submit]'),
                page.waitForNavigation(),
            ]);
        } else {
            await this.loginUser(masterAdmin, page);
            // await this.createUserFromAdminDashboard(user, page);
        }
    },
};
