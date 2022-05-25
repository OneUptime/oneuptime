import puppeteer from 'puppeteer';

let browser: any, page: any;
const url: string = 'http://localhost:1444';

describe('My First Puppeteer Test', () => {
    const operationTimeOut: number = 180000;

    beforeAll(async () => {
        jest.setTimeout(operationTimeOut);
        browser = await puppeteer.launch({ headless: false });
        page = await browser.newPage();
        await page.setViewport({ width: 1366, height: 768 });
    });

    afterAll(async () => {
        await browser.close();
    });

    test(
        'Title of the page',
        async () => {
            await page.goto(url, {
                waitUntil: 'networkidle0',
                timeout: operationTimeOut,
            });
            const title = await page.title();
            expect(title).toBe(
                'OneUptime | One Complete SRE and DevOps platform.'
            );
        },
        operationTimeOut
    );

    test(
        'Take a page screenshot',
        async () => {
            await page.goto(url, {
                waitUntil: 'networkidle0',
                timeout: operationTimeOut,
            });
            await page.screenshot({
                path: './Tests/views/screenshots/home.png',
                fullPage: true,
            });
        },
        operationTimeOut
    );

    test(
        'Confirm headings and text on page',
        async () => {
            await page.goto(url, {
                waitUntil: 'networkidle0',
                timeout: operationTimeOut,
            });

            const h1Tags = await page.evaluate(() =>
                Array.from(
                    document.querySelectorAll('h1'),
                    element => element.innerText
                )
            );

            const h2Tags = await page.evaluate(() =>
                Array.from(
                    document.querySelectorAll('h2'),
                    element => element.innerText
                )
            );

            const h3Tags = await page.evaluate(() =>
                Array.from(
                    document.querySelectorAll('h3'),
                    element => element.innerText
                )
            );

            const text = await page.evaluate(() =>
                Array.from(
                    document.querySelectorAll('p'),
                    element => element.innerText
                )
            );

            expect(h1Tags[0]).toContain(
                'One Complete SRE\nand DevOps platform.'
            );
            expect(h1Tags[1]).toContain(
                'One Complete Platform for all your DevOps and SRE needs.'
            );

            expect(h2Tags[0]).toContain('Menu');
            expect(h2Tags[1]).toContain(
                'All your SRE and DevOps needs in one place.'
            );
            expect(h2Tags[2]).toContain(`...and we've got more.`);
            expect(h2Tags[3]).toContain('Uptime Monitoring');
            expect(h2Tags[4]).toContain('Public and Private Status Pages');
            expect(h2Tags[5]).toContain('On-Call Management');
            expect(h2Tags[6]).toContain('ONEUPTIME FOR ENTERPRISES');
            expect(h2Tags[7]).toContain('EXPLORE RESOURCES & WHITEPAPERS');

            expect(h3Tags[0]).toContain('OVERVIEW');
            expect(h3Tags[1]).toContain('REQUEST DEMO');
            expect(h3Tags[2]).toContain('RESOURCES & WHITEPAPERS');
            expect(h3Tags[3]).toContain('CUSTOMERS');
            expect(h3Tags[4]).toContain('CONSULTING');
            expect(h3Tags[5]).toContain('ABOUT SEVEN SUMMITS STUDIO');
            expect(h3Tags[6]).toContain('SUPPORT');
            expect(h3Tags[7]).toContain("WE'RE ON SLACK");
            expect(h3Tags[8]).toContain('JOBS');
            expect(h3Tags[9]).toContain('FROM THE BLOG');
            expect(h3Tags[10]).toContain(
                'At 10% the cost, saves you thousands as you grow.'
            );
            expect(h3Tags[11]).toContain('OneUptime');
            expect(h3Tags[12]).toContain('$22/month per user.');
            expect(h3Tags[13]).toContain('PagerDuty: Incident Notifications');
            expect(h3Tags[14]).toContain('Pingdom: Website Monitoring');
            expect(h3Tags[15]).toContain('Statuspageio: Status Page Tool');
            expect(h3Tags[16]).toContain('Newrelic: Application Monitoring');
            expect(h3Tags[17]).toContain('$218.95/month per user.');
            expect(h3Tags[18]).toContain('Monitor Anything.');
            expect(h3Tags[19]).toContain('Detailed Metrics');
            expect(h3Tags[20]).toContain('Every second check.');
            expect(h3Tags[21]).toContain('Realtime Status');
            expect(h3Tags[22]).toContain('Cut Support Costs');
            expect(h3Tags[23]).toContain('Showcase Reliability');
            expect(h3Tags[24]).toContain('Duty Rotations');
            expect(h3Tags[25]).toContain('Have Global Teams');
            expect(h3Tags[26]).toContain('Any Alert Channel');

            expect(text[0]).toContain(
                "OneUptime monitors your website, dashboards, API's, and more and alerts your team when downtime happens. We also give you a Status Page which keeps your customers looped in and improves transparency."
            );
            expect(text[2]).toContain(
                "With OneUptime, you get a complete SRE toolchain out-of-the-box. One interface. One conversation. One permission model. Thousands of features. You'll be amazed at everything OneUptime can do today. And we're just getting started."
            );
            expect(text[4]).toContain('Monitoring');
            expect(text[5]).toContain('We currently have:');
            expect(text[6]).toContain('API Monitoring.');
            expect(text[7]).toContain('Website Monitoring.');
            expect(text[8]).toContain('IoT Device Monitoring.');
            expect(text[9]).toContain('Server Monitoring.');
            expect(text[10]).toContain('Kubernetes Cluster Monitoring.');
            expect(text[11]).toContain('Application Monitoring.');
            expect(text[12]).toContain('Container Monitoring.');
            expect(text[13]).toContain('On Call');
            expect(text[14]).toContain('We currently have:');
            expect(text[15]).toContain('On-call rotation.');
            expect(text[16]).toContain('Escalation Policy.');
            expect(text[17]).toContain('On-call reporting.');
            expect(text[18]).toContain('Alerts for incidents.');
            expect(text[19]).toContain('Call, SMS Global alerts.');
            expect(text[20]).toContain('Support for distributed teams.');
            expect(text[21]).toContain('Coming soon:');
            expect(text[22]).toContain('Native On-call apps.');
            expect(text[23]).toContain('Intelligent On-call alerts.');
            expect(text[24]).toContain('Status Page');
            expect(text[25]).toContain('We currently have:');
            expect(text[26]).toContain('Custom branding.');
            expect(text[27]).toContain('Realtime Status.');
            expect(text[28]).toContain('Custom Subdomain.');
            expect(text[29]).toContain('Investigation Notes.');
            expect(text[30]).toContain('Private Status Pages.');
            expect(text[31]).toContain('Multiple status pages.');
            expect(text[32]).toContain('SLA alerts.');
            expect(text[33]).toContain('Coming soon:');
            expect(text[34]).toContain('Show status of third party services.');
            expect(text[35]).toContain('Performance Monitoring');
            expect(text[36]).toContain('We currently have:');
            expect(text[37]).toContain(
                'Browser App / Website Performance Monitoring.'
            );
            expect(text[38]).toContain(
                'Performance Monitoring of your server-side apps.'
            );
            expect(text[39]).toContain('Backend Performance Monitoring.');
            expect(text[40]).toContain('Coming soon:');
            expect(text[41]).toContain('Database Performance Monitoring.');
            expect(text[42]).toContain('Mobile App Performance Monitoring.');
        },
        operationTimeOut
    );
});
