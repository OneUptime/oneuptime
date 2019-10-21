var faker = require('faker');

var ACCOUNTS_URL = 'http://localhost:3003';
var DASHBOARD_URL = 'http://localhost:3000';

var puppeteerLaunchConfig = {
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
    '--disable-renderer-backgrounding'
    ],
  };

var user = faker.helpers.createCard();
var cvv = '542';
var expiryDate = '09/2020';


function generateWrongEmail() {
    return Math.random().toString(36).substring(8) + '@' + Math.random().toString(24).substring(8) + '.com';
}

function generateRandomString(){
    return faker.lorem.word();
}

function generateRandomBusinessEmail(){
    return `${Math.random().toString(36).substring(7)}@${Math.random().toString(36).substring(5)}.com`;
}


var cardNumber = '4111111111111111';

var monitorCategoryName = 'e2e_monitor_category';
 
var monitorName = 'e2e_monitor';

var monitorUrl = 'https://www.test.com';

var scheduledEventDescription = 'event description';

var scheduledEventName = 'event name';

var updatedScheduledEventDescription = 'event description updated';

var updatedScheduledEventName = 'event name updated';

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
    generateRandomBusinessEmail
};
