const faker = require('faker');

const user = faker.helpers.createCard();
user.email = generateRandomBusinessEmail();
user.password = generatePassword();
user.card = '4111111111111111';
user.cvv = '100';
user.expiryDate = '12/23';
user.message = 'Test message';

const agent =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/61.0.3163.100 Safari/537.36';

let slomo = 20;

if (
    process.env.SLOMO &&
    parseInt(process.env.SLOMO) &&
    parseInt(process.env.SLOMO) > 20
) {
    slomo = parseInt(process.env.SLOMO);
}

const puppeteerLaunchConfig = {
    headless: false,//process.env.HEADLESS === 'false' ? false : true,
    defaultViewport: null,
    slowMo: slomo,
    args: [
        '--start-maximized',
        '--disable-web-security',
        '--disable-features=IsolateOrigins,site-per-process',
        '--proxy-server=',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
    ],
};

const HOME_URL = process.env.HOME_URL || 'http://localhost:1444';
const ACCOUNTS_URL = process.env.ACCOUNTS_URL || 'http://localhost:3003';
const ADMIN_DASHBOARD_URL =
    process.env.ADMIN_DASHBOARD_URL || 'http://localhost:3100';
const DASHBOARD_URL = process.env.DASHBOARD_URL || 'http://localhost:3000';
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3002';
const STATUSPAGE_URL = process.env.STATUSPAGE_URL || 'http://localhost:3006';
const APIDOCS_URL = process.env.APIDOCS_URL || 'http://localhost:1445';
const HTTP_TEST_SERVER_URL =
    process.env.HTTP_TEST_SERVER_URL || 'http://localhost:3010';
const INIT_SCRIPT_URL =
    process.env.INIT_SCRIPT_URL || 'http://localhost:1447';

function generateRandomBusinessEmail() {
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
function generatePassword() {
    return Math.random()
        .toString(36)
        .substring(7);
}
function generateRandomString() {
    return Math.random()
        .toString(36)
        .substring(8);
}
// These are other required functions, variables present in other test-utils dashboard folder.
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

function capitalize(words) {
    if (!words || !words.trim()) return '';

    words = words.split(' ');
    words = words.map(
        word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
    );

    return words.join(' ').trim();
}

const resourceCategoryName = 'e2e_monitor_category';

const monitorName = 'newMonitor';

const monitorUrl = 'https://www.test.com';

const scheduledEventDescription = 'event description';

const scheduledEventName = 'event name';

const updatedScheduledEventDescription = 'event description updated';

const updatedScheduledEventName = 'event name updated';

const dockerCredential = {
    dockerUsername: process.env.DOCKER_UNMASKED_USERNAME || 'fyipetest',
    dockerPassword: process.env.DOCKER_UNMASKED_PASSWORD || '4G76c2aavPHa',
    dockerRegistryUrl:
        process.env.DOCKER_SECURITY_SCAN_REGISTRY_URL ||
        'https://registry.hub.docker.com',
    imagePath:
        process.env.DOCKER_SECURITY_SCAN_IMAGE_PATH || 'fyipeproject/home',
    imageTags: process.env.DOCKER_SECURITY_SCAN_IMAGE_TAGS || 'latest',
};

const gitCredential = {
    gitUsername: process.env.GITHUB_UNMASKED_USERNAME || 'fyipetest',
    gitPassword:
        process.env.GITHUB_UNMASKED_PASSWORD || 'FzUHPgxBGrqCuf68aaHjPqaFZH',
    gitRepositoryUrl:
        process.env.GITHUB_SECURITY_SCAN_REPOSITORY_URL ||
        'https://github.com/twbs/bootstrap',
};

const smtpCredential = {
    user: process.env.TEST_EMAIL || 'noreply@fyipe.com',
    pass:
        process.env.TEST_EMAIL_PASSWORD || 'qZzsbeYJAxJccf9FwgdZvip3nr9mhmofD',
    host: process.env.TEST_EMAIL_SMTP_SERVER || 'smtp.gmail.com',
    port: process.env.TEST_EMAIL_SMTP_PORT || '465',
    from: process.env.TEST_EMAIL || 'noreply@fyipe.com',
    secure: true,
};

const twilioCredentials = {
    accountSid:
        process.env.TEST_TWILIO_ACCOUNT_SID ||
        'AC4b957669470069d68cd5a09d7f91d7c6',
    authToken:
        process.env.TEST_TWILIO_ACCOUNT_AUTH_TOKEN ||
        '79a35156d9967f0f6d8cc0761ef7d48d',
    phoneNumber: process.env.TEST_TWILIO_PHONE || '+15005550006',
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
    ADVANCE: 6, // Now in react-tab-6 id
};
const scheduleEventTabIndexes = {
    BASIC: 0,
    NOTES: 2,
    ADVANCE: 4,
};

module.exports = {
    HOME_URL,
    ACCOUNTS_URL,
    ADMIN_DASHBOARD_URL,
    DASHBOARD_URL,
    BACKEND_URL,
    STATUSPAGE_URL,
    APIDOCS_URL,
    HTTP_TEST_SERVER_URL,
    INIT_SCRIPT_URL,
    user,
    puppeteerLaunchConfig,
    generateRandomString,
    generateRandomBusinessEmail,
    generateWrongEmail,
    resourceCategoryName,
    monitorName,
    monitorUrl,
    scheduledEventName,
    scheduledEventDescription,
    updatedScheduledEventName,
    updatedScheduledEventDescription,
    generateRandomWebsite,
    parseBoolean,
    dockerCredential,
    gitCredential,
    smtpCredential,
    twilioCredentials,
    capitalize,
    monitorTabIndexes,
    incidentTabIndexes,
    scheduleEventTabIndexes,
    agent,
};
