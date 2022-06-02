import URL from 'Common/Types/API/URL';

type VP = {
    width: number;
    height: number;
};

type PO = {
    headless: boolean;
};

export const OPERATION_TIMEOUT: number = 180000;
export const PUPPETEER_OPTIONS: PO = { headless: false };
export const VIEW_PORT: VP = { width: 1366, height: 768 };
export const HOME_URL: URL = URL.fromString('http://localhost:1444');
