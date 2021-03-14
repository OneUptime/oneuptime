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
        '--window-size=1920,1080',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        '--disable-web-security',
        '--disable-features=IsolateOrigins,site-per-process', // fix issue with cross origin policy
    ],
    defaultViewport: null,
    headless: false, //change this to `false` debug locally.
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

function capitalize(words) {
    if (!words || !words.trim()) return '';

    words = words.split(' ');
    words = words.map(
        word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
    );

    return words.join(' ').trim();
}

const cardNumber = '4111111111111111';

const resourceCategoryName = 'e2e_monitor_category';

const monitorName = 'newMonitor';

const monitorUrl = 'https://www.test.com';

const scheduledEventDescription = 'event description';

const scheduledEventName = 'event name';

const updatedScheduledEventDescription = 'event description updated';

const updatedScheduledEventName = 'event name updated';

const dockerCredential = {
    dockerUsername: process.env.DOCKER_UNMASKED_USERNAME,
    dockerPassword: process.env.DOCKER_UNMASKED_PASSWORD,
    dockerRegistryUrl: process.env.DOCKER_SECURITY_SCAN_REGISTRY_URL,
    imagePath: process.env.DOCKER_SECURITY_SCAN_IMAGE_PATH,
    imageTags: process.env.DOCKER_SECURITY_SCAN_IMAGE_TAGS,
};

const gitCredential = {
    gitUsername: process.env.GITHUB_UNMASKED_USERNAME,
    gitPassword: process.env.GITHUB_UNMASKED_PASSWORD,
    gitRepositoryUrl: process.env.GITHUB_SECURITY_SCAN_REPOSITORY_URL,
};

const smtpCredential = {
    user: 'noreply@fyipe.com',
    pass: 'qZzsbeYJAxJccf9FwgdZvip3nr9mhmofD',
    host: 'smtp.gmail.com',
    port: '465',
    from: 'noreply@fyipe.com',
    secure: true,
};

const twilioCredentials = {
    accountSid: 'AC4b957669470069d68cd5a09d7f91d7c6',
    authToken: '79a35156d9967f0f6d8cc0761ef7d48d',
    phoneNumber: '+15005550006',
};

const monitorTabIndexes = {
    BASIC: 0,
    SUBSCRIBERS: 2,
    INTEGRATION: 4,
    ADVANCE: 6,
};
const incidentTabIndexes = {
    BASIC: 0,
    MONITOR_LOGS: 2,
    ALERT_LOGS: 4,
    INCIDENT_TIMELINE: 6,
    INCIDENT_NOTES: 8,
    ADVANCE: 10,
};
const scheduleEventTabIndexes = {
    BASIC: 0,
    NOTES: 2,
    ADVANCE: 4,
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
    resourceCategoryName,
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
    smtpCredential,
    twilioCredentials,
    capitalize,
    monitorTabIndexes,
    incidentTabIndexes,
    scheduleEventTabIndexes,
};
