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

function generateWrongEmail() {
    return Math.random().toString(36).substring(8) + '@' + Math.random().toString(24).substring(8) + '.com';
}

function generateRandomString(){
    return Math.random().toString(36).substring(10) 
}

function generateRandomBusinessEmail(){
    return `${Math.random().toString(36).substring(7)}@${Math.random().toString(36).substring(5)}.com`;
}



module.exports = {
    ACCOUNTS_URL,
    DASHBOARD_URL,
    puppeteerLaunchConfig,
    user,
    generateWrongEmail,
    generateRandomString,
    generateRandomBusinessEmail
};
