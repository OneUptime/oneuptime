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

module.exports = {
    ACCOUNTS_URL,
    ADMIN_DASHBOARD_URL,
    puppeteerLaunchConfig,
    generateWrongEmail,
    generateRandomString,
    generateRandomBusinessEmail,
};
