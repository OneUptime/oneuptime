import faker from 'faker';

const HTTP_TEST_SERVER_URL: string = 'http://localhost:3010';

const puppeteerLaunchConfig: $TSFixMe = {
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
    ],
};

const user: $TSFixMe = faker.helpers.createCard();

function generateRandomString(): void {
    return Math.random().toString(36).substring(10);
}

export default {
    user,
    puppeteerLaunchConfig,
    generateRandomString,
    HTTP_TEST_SERVER_URL,
};
