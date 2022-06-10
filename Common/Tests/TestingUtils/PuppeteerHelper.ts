export default class PuppeteerHelper {
    public static async getTextContent(page: any, selector: string) {
        await page.waitForSelector(selector);
        return await page.$eval(selector, (e: Element) => {
            return e.textContent;
        });
    }
}
