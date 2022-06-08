import { Page } from '../../../Home/node_modules/puppeteer';

export default class PuppeteerHelper {
    public static async getTextContent(page: Page, selector: string) {
        await page.waitForSelector(selector);
        return await page.$eval(selector, (e: Element) => {
            return e.textContent;
        });
    }
}
