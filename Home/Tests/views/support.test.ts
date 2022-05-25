import puppeteer from 'puppeteer';

let browser: any, page: any;
const url: string = 'http://localhost:1444/support';

describe('My First Puppeteer Test', () => {
    const operationTimeOut: number = 180000;

    beforeAll(async () => {
        jest.setTimeout(operationTimeOut);
        browser = await puppeteer.launch({ headless: false });
        page = await browser.newPage();
        await page.setViewport({ width: 1366, height: 768 });
    });

    // afterAll(async () => {
    //     await browser.close();
    // });

    test(
        'Title of the page',
        async () => {
            await page.goto(url, {
                waitUntil: 'networkidle0',
                timeout: operationTimeOut,
            });
            const title = await page.title();
            expect(title).toBe('OneUptime | Help and Support');
        },
        operationTimeOut
    );

    // test(
    //     'Header of the page',
    //     async () => {
    //         // await page.goto(url);
    //         // const h1Handle: any = await page.$('h1');
    //         // const html: any = await page.evaluate(
    //         //     (h1Handle: any) => h1Handle.innerHTML,
    //         //     h1Handle
    //         // );
    //         // console.log({ html });
    //         // expect(html).toBe();
    //     },
    //     operationTimeOut
    // );

    test(
        'Take a page screenshot',
        async () => {
            await page.goto(url, {
                waitUntil: 'networkidle0',
                timeout: operationTimeOut,
            });
            await page.screenshot({
                path: './Tests/views/screenshots/support.png',
                fullPage: true,
            });
        },
        operationTimeOut
    );
});

// await init.pageWaitForSelector(page, '#settings');

// await init.pageClick(page, '#settings a');

// await init.pageWaitForSelector(page, '#twilio');

// await init.pageClick(page, '#twilio a');

// await init.pageWaitForSelector(page, '#twilio-form');
