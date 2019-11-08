const faker = require('faker')

var user = faker.helpers.createCard();
user.email = generateRandomBusinessEmail();
user.password = generatePassword();
user.card = '4111111111111111';
user.cvv = '100';
user.expiryDate = '12/23';
user.message = 'Test message'

const puppeteerLaunchConfig = {
    headless: true,
    args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
    ]
}

const HOME_URL = process.env.HOME_URL || 'http://localhost:1444';
const ACCOUNTS_URL = process.env.ACCOUNTS_URL || 'http://localhost:3003';
const DASHBOARD_URL = process.env.DASHBOARD_URL || 'http://localhost:3000';
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3002';
const STATUSPAGE_URL = process.env.STATUSPAGE_URL || 'http://localhost:3006';
const APIDOCS_URL = process.env.APIDOCS_URL || 'http://localhost:1445';


function generateRandomBusinessEmail() {
    return Math.random().toString(36).substring(8) + '@' + Math.random().toString(24).substring(8) + '.com'
}
function generatePassword() {
    return Math.random().toString(36).substring(7);
}
function generateRandomString() {
    return faker.lorem.word();
}

module.exports = {
    HOME_URL,
    ACCOUNTS_URL,
    DASHBOARD_URL,
    BACKEND_URL,
    STATUSPAGE_URL,
    APIDOCS_URL,
    user,
    puppeteerLaunchConfig,
    generateRandomString,
    generateRandomBusinessEmail
}