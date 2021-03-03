const ACCOUNTS_URL = 'http://localhost:3003';
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
    headless: false,
};

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

function generateRandomString() {
    return Math.random()
        .toString(36)
        .substring(10);
}

function generateRandomBusinessEmail() {
    return `${Math.random()
        .toString(36)
        .substring(7)}@${Math.random()
        .toString(36)
        .substring(5)}.com`;
}

const smtpCredential = {
    user: process.env.TEST_EMAIL,
    pass: process.env.TEST_EMAIL_PASSWORD,
    host: process.env.TEST_EMAIL_SMTP_SERVER,
    port: process.env.TEST_EMAIL_SMTP_PORT,
    from: process.env.TEST_EMAIL,
    name: process.env.TEST_EMAIL_NAME,
    secure: true,
};

module.exports = {
    ACCOUNTS_URL,
    ADMIN_DASHBOARD_URL,
    smtpCredential,
    puppeteerLaunchConfig,
    generateWrongEmail,
    generateRandomString,
    generateRandomBusinessEmail,
};
