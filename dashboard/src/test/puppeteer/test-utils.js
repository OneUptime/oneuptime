const faker = require('faker');

const ACCOUNTS_URL = 'http://localhost:3003';
const DASHBOARD_URL = 'http://localhost:3000';
const HTTP_TEST_SERVER_URL = 'http://localhost:3010';
const ADMIN_DASHBOARD_URL = 'http://localhost:3100';

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
        '--disable-web-security',
        '--disable-features=IsolateOrigins,site-per-process', // fix issue with cross origin policy
    ],
    headless: true, //change this to `false` debug locally.
};

const user = faker.helpers.createCard();
const cvv = '542';
const expiryDate = '09/2020';

/**
 * @param {string} val : The value to be parsed.
 * @description Resolves or Parses any value to boolean value.
 * @returns Boolean true or false
 */
function parseBoolean(val) {
    const falsy = /^(?:f(?:alse)?|no?|0+)$/i;
    return !falsy.test(val) && !!val;
}

function generateWrongEmail() {
    return (
        Math.random()
            .toString(36)
            .substring(8) +
        '@' +
        Math.random()
            .toString(24)
            .substring(8) +
        '.com'
    );
}

function generateRandomWebsite() {
    return (
        'http://' +
        Math.random()
            .toString(36)
            .substring(10) +
        '.com'
    );
}

function generateRandomString() {
    return (
        'str' + // Prevent strings starting with numbers
        Math.random()
            .toString(36)
            .substring(10)
    );
}

function generateRandomBusinessEmail() {
    return `${Math.random()
        .toString(36)
        .substring(7)}@${Math.random()
        .toString(36)
        .substring(5)}.com`;
}

const cardNumber = '4111111111111111';

const monitorCategoryName = 'e2e_monitor_category';

const monitorName = 'e2e_monitor';

const monitorUrl = 'https://www.test.com';

const scheduledEventDescription = 'event description';

const scheduledEventName = 'event name';

const updatedScheduledEventDescription = 'event description updated';

const updatedScheduledEventName = 'event name updated';

const dockerCredential = {
    dockerUsername: process.env.DOCKERUSERNAME,
    dockerPassword: process.env.DOCKERPASSWORD,
    dockerRegistryUrl: process.env.DOCKER_SECURITY_SCAN_REGISTRY_URL,
    imagePath: process.env.DOCKER_SECURITY_SCAN_IMAGE_PATH,
    imageTags: process.env.DOCKER_SECURITY_SCAN_IMAGE_TAGS,
};

const gitCredential = {
    gitUsername: process.env.GITHUB_USERNAME,
    gitPassword: process.env.GITHUB_PASSWORD,
    gitRepositoryUrl: process.env.GITHUB_SECURITY_SCAN_REPOSITORY_URL,
};

module.exports = {
    ACCOUNTS_URL,
    DASHBOARD_URL,
    HTTP_TEST_SERVER_URL,
    ADMIN_DASHBOARD_URL,
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
    generateRandomWebsite,
    timeout: 500000,
    parseBoolean,
    dockerCredential,
    gitCredential,
};
