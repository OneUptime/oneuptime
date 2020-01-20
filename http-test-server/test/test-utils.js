var faker = require('faker');

var HTTP_TEST_SERVER_URL = 'http://localhost:3010';

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
        '--disable-renderer-backgrounding',
        '--disable-web-security'
    ],
};

var user = faker.helpers.createCard();

function generateRandomString(){
    return Math.random().toString(36).substring(10); 
}

module.exports = {
    user,
    puppeteerLaunchConfig,
    generateRandomString,
    HTTP_TEST_SERVER_URL
};
