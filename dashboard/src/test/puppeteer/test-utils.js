const faker = require('faker');

const ACCOUNTS_URL = 'http://localhost:3003';
const DASHBOARD_URL = 'http://localhost:3000';

const puppeteerLaunchConfig = {
    args: [
        '--proxy-server=',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
        '--window-size=1920x1080',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        '--disable-web-security'
    ],
};

const user = faker.helpers.createCard();
const cvv = '542';
const expiryDate = '09/2020';


function generateWrongEmail() {
    return Math.random().toString(36).substring(8) + '@' + Math.random().toString(24).substring(8) + '.com';
}

function generateRandomWebsite() {
    return 'http://' + Math.random().toString(36).substring(10) + '.com';
}

function generateRandomString() {
    return Math.random().toString(36).substring(10)
}

function generateRandomBusinessEmail() {
    return `${Math.random().toString(36).substring(7)}@${Math.random().toString(36).substring(5)}.com`;
}


const cardNumber = '4111111111111111';

const monitorCategoryName = 'e2e_monitor_category';

const monitorName = 'e2e_monitor';

const monitorUrl = 'https://www.test.com';

const scheduledEventDescription = 'event description';

const scheduledEventName = 'event name';

const updatedScheduledEventDescription = 'event description updated';

const updatedScheduledEventName = 'event name updated';

module.exports = {
    ACCOUNTS_URL,
    DASHBOARD_URL,
    puppeteerLaunchConfig,
    user,
    cvv,
    expiryDate,
    cardNumber,
    generateWrongEmail,
    monitorCategoryName,
    monitorName,
    monitorUrl,
    scheduledEventName,
    scheduledEventDescription,
    updatedScheduledEventName,
    updatedScheduledEventDescription,
    generateRandomString,
    generateRandomBusinessEmail,
    generateRandomWebsite
};
