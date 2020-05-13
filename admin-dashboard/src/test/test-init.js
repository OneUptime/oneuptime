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

            try {
                await Promise.all([
                    page.waitForSelector(`form#card-form`),
                    page.click('button[type=submit]'),
                ]);
    
                await page.waitForSelector('iframe[name=__privateStripeFrame5]');
                await page.waitForSelector('iframe[name=__privateStripeFrame6]');
                await page.waitForSelector('iframe[name=__privateStripeFrame7]');
    
                await page.click('input[name=cardName]');
                await page.type('input[name=cardName]', 'Test name');
    
                elementHandle = await page.$('iframe[name=__privateStripeFrame5]');
                frame = await elementHandle.contentFrame();
                await frame.waitForSelector('input[name=cardnumber]');
                await frame.type('input[name=cardnumber]', '42424242424242424242', {
                    delay: 150,
                });
    
                elementHandle = await page.$('iframe[name=__privateStripeFrame6]');
                frame = await elementHandle.contentFrame();
                await frame.waitForSelector('input[name=cvc]');
                await frame.type('input[name=cvc]', '123', {
                    delay: 150,
                });
    
                elementHandle = await page.$('iframe[name=__privateStripeFrame7]');
                frame = await elementHandle.contentFrame();
                await frame.waitForSelector('input[name=exp-date]');
                await frame.type('input[name=exp-date]', '11/23', {
                    delay: 150,
                });
                await page.click('input[name=address1]');
                await page.type('input[name=address1]', "Enugu, Nigeria");
                await page.click('input[name=address2]');
                await page.type('input[name=address2]', "Enugu, Nigeria");
                await page.click('input[name=city]');
                await page.type('input[name=city]', "Awka");
                await page.click('input[name=state]');
                await page.type('input[name=state]', "Delta");
                await page.click('input[name=zipCode]');
                await page.type('input[name=zipCode]', "11011");
                await page.select('#country', 'India');
    
                await Promise.all([
                    page.waitForSelector('div#success-step'),
                    page.click('button[type=submit]'),
                ]);
            } catch (error) {
                return;
            }
            
            
        }
    },
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
            await page.waitForSelector('iframe[name=__privateStripeFrame5]');
            await page.waitForSelector('iframe[name=__privateStripeFrame6]');
            await page.waitForSelector('iframe[name=__privateStripeFrame7]');

            await page.click('input[name=cardName]');
            await page.type('input[name=cardName]', 'Test name');

            elementHandle = await page.$('iframe[name=__privateStripeFrame5]');
            frame = await elementHandle.contentFrame();
            await frame.waitForSelector('input[name=cardnumber]');
            await frame.type('input[name=cardnumber]', '42424242424242424242', {
                delay: 150,
            });

            elementHandle = await page.$('iframe[name=__privateStripeFrame6]');
            frame = await elementHandle.contentFrame();
            await frame.waitForSelector('input[name=cvc]');
            await frame.type('input[name=cvc]', '123', {
                delay: 150,
            });

            elementHandle = await page.$('iframe[name=__privateStripeFrame7]');
            frame = await elementHandle.contentFrame();
            await frame.waitForSelector('input[name=exp-date]');
            await frame.type('input[name=exp-date]', '11/23', {
                delay: 150,
            });
            await page.click('input[name=address1]');
            await page.type('input[name=address1]', "Enugu, Nigeria");
            await page.click('input[name=address2]');
            await page.type('input[name=address2]', "Enugu, Nigeria");
            await page.click('input[name=city]');
            await page.type('input[name=city]', "Centenary City");
            await page.click('input[name=state]');
            await page.type('input[name=state]', "Enugu");
            await page.click('input[name=zipCode]');
            await page.type('input[name=zipCode]', "11011");
            await page.select('#country', 'India');
        }

        await Promise.all([
            page.waitForSelector('div#success-step'),
            page.click('button[type=submit]'),
        ]);
    },
};
