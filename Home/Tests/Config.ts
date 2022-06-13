import 'reflect-metadata';
import URL from 'Common/Types/API/URL';
import { ElementHandle } from 'puppeteer';

type ViewPortOptions = {
    width: number;
    height: number;
};

type PuppeteerOptions = {
    headless: boolean;
};

export const OPERATION_TIMEOUT: number = 180000;
export const PUPPETEER_OPTIONS: PuppeteerOptions = { headless: false };
export const VIEW_PORT_OPTIONS: ViewPortOptions = { width: 1366, height: 768 };
export const HOME_URL: URL = URL.fromString('http://localhost:1444');
export type VALUE_TYPE = ElementHandle | string | null;
