const puppeteer = require('puppeteer');
const utils = require('../../test-utils');
const init = require('../../test-init');

let browser, page;
require('should');

// user credentials
const email = utils.generateRandomBusinessEmail();
const password = '1234567890';
const callSchedule = utils.generateRandomString();
const componentName = utils.generateRandomString();
const monitorName = utils.generateRandomString();
const testServerMonitorName = utils.generateRandomString();

describe('Monitor API', () => {
    const operationTimeOut = init.timeout;

    beforeAll(async () => {
        jest.setTimeout(init.timeout);

        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(utils.agent);

        const user = {
            email,
            password,
        };
        await init.registerUser(user, page);
        await init.addSchedule(callSchedule, page);
        await init.addMonitorToComponent(componentName, monitorName, page); // This creates a default component and a monitor. The monitor created here will be used by other tests as required
    });

    afterAll(async done => {
        await browser.close();
        done();
    });

    test(
        'should display lighthouse scores',
        async done => {
            // Navigate to Component details
            // This navigates to the monitor created alongside the created component
            await init.navigateToMonitorDetails(
                componentName,
                monitorName,
                page
            );
            
            await init.pageWaitForSelector(page, '#website_scanning');
            await init.pageWaitForSelector(page, '#website_postscan');
            
            await init.pageWaitForSelector(
                page,
                `#lighthouseLogs_${monitorName}_0`,
                {
                    visible: true,
                    timeout: operationTimeOut,
                }
            );

            let lighthousePerformanceElement = await init.pageWaitForSelector(
                page,
                `#lighthouse-performance-${monitorName}`,
                { visible: true, timeout: operationTimeOut }
            );
            lighthousePerformanceElement = await lighthousePerformanceElement.getProperty(
                'innerText'
            );
            lighthousePerformanceElement = await lighthousePerformanceElement.jsonValue();
            lighthousePerformanceElement.should.endWith('%');

            let lighthouseAccessibilityElement = await init.pageWaitForSelector(
                page,
                `#lighthouse-accessibility-${monitorName}`,
                { visible: true, timeout: operationTimeOut }
            );
            lighthouseAccessibilityElement = await lighthouseAccessibilityElement.getProperty(
                'innerText'
            );
            lighthouseAccessibilityElement = await lighthouseAccessibilityElement.jsonValue();
            lighthouseAccessibilityElement.should.endWith('%');

            let lighthouseBestPracticesElement = await init.pageWaitForSelector(
                page,
                `#lighthouse-bestPractices-${monitorName}`,
                { visible: true, timeout: operationTimeOut }
            );
            lighthouseBestPracticesElement = await lighthouseBestPracticesElement.getProperty(
                'innerText'
            );
            lighthouseBestPracticesElement = await lighthouseBestPracticesElement.jsonValue();
            lighthouseBestPracticesElement.should.endWith('%');

            let lighthouseSeoElement = await init.pageWaitForSelector(
                page,
                `#lighthouse-seo-${monitorName}`,
                { visible: true, timeout: operationTimeOut }
            );
            lighthouseSeoElement = await lighthouseSeoElement.getProperty(
                'innerText'
            );
            lighthouseSeoElement = await lighthouseSeoElement.jsonValue();
            lighthouseSeoElement.should.endWith('%');

            let lighthousePwaElement = await init.pageWaitForSelector(
                page,
                `#lighthouse-pwa-${monitorName}`,
                { visible: true, timeout: operationTimeOut }
            );
            lighthousePwaElement = await lighthousePwaElement.getProperty(
                'innerText'
            );
            lighthousePwaElement = await lighthousePwaElement.jsonValue();
            lighthousePwaElement.should.endWith('%');
            done();
        },
        operationTimeOut
    );

    test(
        'should display multiple probes and monitor chart on refresh',
        async done => {
            // Navigate to Component details
            // This navigates to the monitor created alongside the created component
            await init.navigateToMonitorDetails(
                componentName,
                monitorName,
                page
            );

            const probe0 = await init.pageWaitForSelector(page, '#probes-btn0');
            const probe1 = await init.pageWaitForSelector(page, '#probes-btn1');

            expect(probe0).toBeDefined();
            expect(probe1).toBeDefined();

            const monitorStatus = await init.pageWaitForSelector(
                page,
                `#monitor-status-${monitorName}`
            );
            const sslStatus = await init.pageWaitForSelector(
                page,
                `#ssl-status-${monitorName}`
            );

            expect(monitorStatus).toBeDefined();
            expect(sslStatus).toBeDefined();
            done();
        },
        operationTimeOut
    );

//     test(
//         'Should create new monitor with call schedules',
//         async done => {
//             // Create Component first
//             // Redirects automatically component to details page
//             await init.navigateToComponentDetails(componentName, page);
//             const monitorName = utils.generateRandomString();
//             await init.pageWaitForSelector(page, '#form-new-monitor');
//             await init.pageWaitForSelector(page, 'input[id=name]', {
//                 visible: true,
//                 timeout: init.timeout,
//             });
//             await init.pageWaitForSelector(page, 'input[id=name]', {
//                 visible: true,
//                 timeout: init.timeout,
//             });
//             await init.pageClick(page, 'input[id=name]');
//             await page.focus('input[id=name]');
//             await init.pageType(page, 'input[id=name]', monitorName);
//             await init.pageClick(page, '[data-testId=type_url]');
//             await init.pageWaitForSelector(page, '#url', {
//                 visible: true,
//                 timeout: init.timeout,
//             });
//             await init.pageClick(page, '#url');
//             await init.pageType(page, '#url', 'https://google.com');
//             // select multiple schedules
//             await init.page$$Eval(
//                 page,
//                 '[data-testId^=callSchedules_]',
//                 schedules => schedules.forEach(schedule => schedule.click())
//             );

//             await init.pageClick(page, 'button[type=submit]');

//             let spanElement = await init.pageWaitForSelector(
//                 page,
//                 `#monitor-title-${monitorName}`
//             );
//             spanElement = await spanElement.getProperty('innerText');
//             spanElement = await spanElement.jsonValue();
//             spanElement.should.be.exactly(monitorName);

//             await init.pageClick(page, `#edit_${monitorName}`);

//             const checkboxValues = await init.page$$Eval(
//                 page,
//                 '[data-testId^=callSchedules_]',
//                 schedules => schedules.map(schedule => schedule.checked)
//             );

//             const areAllChecked = checkboxValues.every(
//                 checked => checked === true
//             );
//             expect(areAllChecked).toEqual(true);
//             done();
//         },
//         operationTimeOut
//     );

//     test(
//         'Should not create new monitor when details are incorrect',
//         async done => {
//             // Navigate to Component details
//             await init.navigateToComponentDetails(componentName, page);

//             await init.pageWaitForSelector(page, '#form-new-monitor');
//             await init.pageClick(page, '[data-testId=type_url]');
//             await init.pageWaitForSelector(page, '#url', {
//                 visible: true,
//                 timeout: init.timeout,
//             });
//             await init.pageClick(page, '#url');
//             await init.pageType(page, '#url', 'https://google.com');

//             await init.pageClick(page, 'button[type=submit]');

//             let spanElement = await init.pageWaitForSelector(
//                 page,
//                 '#form-new-monitor span#field-error'
//             );
//             spanElement = await spanElement.getProperty('innerText');
//             spanElement = await spanElement.jsonValue();
//             spanElement.should.be.exactly('This field cannot be left blank');
//             done();
//         },
//         operationTimeOut
//     );

//     test(
//         'should display SSL enabled status',
//         async done => {
//             // Navigate to Component details
//             await init.navigateToComponentDetails(componentName, page);

//             let sslStatusElement = await init.pageWaitForSelector(
//                 page,
//                 `#ssl-status-${monitorName}`,
//                 { visible: true, timeout: operationTimeOut }
//             );
//             sslStatusElement = await sslStatusElement.getProperty('innerText');
//             sslStatusElement = await sslStatusElement.jsonValue();
//             sslStatusElement.should.be.exactly('Enabled');
//             done();
//         },
//         operationTimeOut
//     );

//     test(
//         'should display SSL not found status',
//         async done => {
//             // Navigate to Component details
//             await init.navigateToComponentDetails(componentName, page);

//             await init.pageWaitForSelector(page, '#form-new-monitor');
//             await init.pageWaitForSelector(page, 'input[id=name]', {
//                 visible: true,
//                 timeout: init.timeout,
//             });
//             await init.pageWaitForSelector(page, 'input[id=name]', {
//                 visible: true,
//                 timeout: init.timeout,
//             });
//             await init.pageClick(page, 'input[id=name]');
//             await page.focus('input[id=name]');
//             await init.pageType(page, 'input[id=name]', testServerMonitorName);
//             await init.pageClick(page, '[data-testId=type_url]');
//             await init.pageWaitForSelector(page, '#url', {
//                 visible: true,
//                 timeout: init.timeout,
//             });
//             await init.pageClick(page, '#url');
//             await init.pageType(page, '#url', utils.HTTP_TEST_SERVER_URL);
//             await init.pageClick(page, 'button[type=submit]');

//             let sslStatusElement = await init.pageWaitForSelector(
//                 page,
//                 `#ssl-status-${testServerMonitorName}`,
//                 { visible: true, timeout: operationTimeOut }
//             );
//             sslStatusElement = await sslStatusElement.getProperty('innerText');
//             sslStatusElement = await sslStatusElement.jsonValue();
//             sslStatusElement.should.be.exactly('No SSL Found');
//             done();
//         },
//         operationTimeOut
//     );

//     test(
//         'should display SSL self-signed status',
//         async done => {
//             const selfSignedMonitorName = utils.generateRandomString();

//             // Navigate to Component details
//             await init.navigateToComponentDetails(componentName, page);

//             await init.pageWaitForSelector(page, '#form-new-monitor');
//             await init.pageWaitForSelector(page, 'input[id=name]', {
//                 visible: true,
//                 timeout: init.timeout,
//             });
//             await init.pageWaitForSelector(page, 'input[id=name]', {
//                 visible: true,
//                 timeout: init.timeout,
//             });
//             await init.pageClick(page, 'input[id=name]');
//             await page.focus('input[id=name]');
//             await init.pageType(page, 'input[id=name]', selfSignedMonitorName);
//             await init.selectDropdownValue('#type', 'url', page);
//             await init.pageWaitForSelector(page, '#url', {
//                 visible: true,
//                 timeout: init.timeout,
//             });
//             await init.pageClick(page, '#url');
//             await init.pageType(page, '#url', 'https://self-signed.badssl.com');
//             await init.pageClick(page, 'button[type=submit]');

//             let sslStatusElement = await init.pageWaitForSelector(
//                 page,
//                 `#ssl-status-${selfSignedMonitorName}`,
//                 { visible: true, timeout: operationTimeOut }
//             );
//             sslStatusElement = await sslStatusElement.getProperty('innerText');
//             sslStatusElement = await sslStatusElement.jsonValue();
//             sslStatusElement.should.be.exactly('Self Signed');
//             done();
//         },
//         operationTimeOut
//     );

//     test(
//         'should display monitor status online for monitor with large response header',
//         async done => {
//             const bodyText = utils.generateRandomString();
//             // This navigates to hhtp-test server and create the settings for the test suite
//             await page.goto(utils.HTTP_TEST_SERVER_URL + '/settings');
//             await page.evaluate(
//                 () => (document.getElementById('responseTime').value = '')
//             );
//             await page.evaluate(
//                 () => (document.getElementById('statusCode').value = '')
//             );
//             await page.evaluate(
//                 () => (document.getElementById('header').value = '')
//             );
//             await page.evaluate(
//                 () => (document.getElementById('body').value = '')
//             );
//             await init.pageWaitForSelector(page, '#responseTime');
//             await init.pageClick(page, 'input[name=responseTime]');
//             await init.pageType(page, 'input[name=responseTime]', '0');
//             await init.pageWaitForSelector(page, '#statusCode');
//             await init.pageClick(page, 'input[name=statusCode]');
//             await init.pageType(page, 'input[name=statusCode]', '200');
//             await page.select('#responseType', 'html');
//             await init.pageWaitForSelector(page, '#header');
//             await init.pageClick(page, 'textarea[name=header]');
//             //paste a large text.
//             await page.evaluate(() => {
//                 return (document.querySelector(
//                     'textarea[name=header]'
//                 ).value = `{
//                     "Connection": "keep-alive",
//                     "Content-Security-Policy": "script-src 'self' https://www.gstatic.cn *.acceleratoradmin.com *.adpclientappreciation.com *.lincolnelectricdigitalrewards.com *.boschappliancedigitalrewards.com *.prepaiddigitalsolutions.com *.purestoragedigitalrewards.com *.prepaiddigitalsolutions.com *.purestoragedigitalrewards.com *.thermadorappliancedigitalrewards.com *.tranedigitalrewards.com *.americanstandardairdigitalrewards.com *.myacuvuedigitalrewards.com *.attrecognition.com *.coopervisiondigitalrewards.com *.allglobalcircle-rewards.com *.habcard.com *.minimotoringredemption.com *.minimotoringrewardsredemption.com *.ultimaterewardsredemption.com *.mystarzrewards.com *.e-rewardsmedicalrewards.com *.recognizingyourewards.com *.kelloggsdigitalrewards.ca *.valvolinedigitalrewards.com *.goodyeardigitalrewards.com *.alconchoicepayments.com *.geappliancesdigitalrewards.com *.topcashbackdigitalsolutions.com *.topcashbackdigitalsolutions.co.uk *.prosper2card.co.uk *.ppdslab.com *.cooperdigitalrewards.com *.tranedigitalrewards.com https://cdn.datatables.net https://www.google-analytics.com https://www.recaptcha.net https://ajax.aspnetcdn.com https://stackpath.bootstrapcdn.com https://cdnjs.cloudflare.com https://maxcdn.bootstrapcdn.com *.google.com *.googletagmanager.com https://www.gstatic.com https://ajax.googleapis.com https://*.msecnd.net *.acceleratoradmin.com *.mxpnl.com *.greencompasspay.com *.360digitalpayments.com *.adpclientappreciation.com *.alconchoicepayments.com *.allglobalcircle-rewards.com *.americanstandardairdigitalrewards.com *.attrecognition.com *.bittyadvancecard.com *.bmwrebateredemption.com *.bmwultimaterewardsredemption.com *.boschappliancedigitalrewards.com *.cbdatsbypay.com *.ceomovementpay.com *.cooperdigitalrewards.com *.coopervisiondigitalrewards.com *.digitalwalletdemo.com *.emrispay.com *.e-rewardsmedicalrewards.com *.expectationsrewards.co.uk *.ferrerorecognition.com *.fundkitecard.com *.geappliancesdigitalrewards.com *.gettogether-pjlibraryrewards.org *.goodyeardigitalrewards.com *.greencompasspay.com *.guustodigitalrewards.com *.habcard.com *.healthyhempfarmspay.com *.honey20pay.com *.hoolalifepay.com *.kelloggsdigitalrewards.ca *.leafywellpay.com *.lincolnelectricdigitalrewards.com *.minimotoringredemption.com *.minimotoringrewardsredemption.com *.minirebateredemption.com *.myacuvuedigitalrewards.com *.mygocardspay.com *.myrevealpay.com *.my-rewardcard.com *.mystarzrewards.com *.natureancepay.com *.NNAPartsDigitalRewards.com *.noble8pay.com *.onelogicmoney.com *.perksatworkcard.com *.ppdslab.com *.ppdslabautomation.com *.prepaiddigitalsolutions.com *.prosper2card.co.uk *.purestoragedigitalrewards.com *.pyurlifepay.com *.recognizingyourewards.com *.redgagedirect.com *.sanctuarygirlpay.com *.swiftimplementations.com *.thermadorappliancedigitalrewards.com *.tirestorerewards.com *.topcashbackdigitalsolutions.co.uk *.topcashbackdigitalsolutions.com *.tranedigitalrewards.com *.ultimaterewardsredemption.com *.uulalacard.com *.valvolinedigitalrewards.com *.vsponeprepaidcard.com *.wealthbuilderpay.com *.worldpaymerchantrewards.com *.yourrewardpass.com topcashbackdigitalsolutions.co.uk https://cdn.highimpactpayments.com 'unsafe-inline';style-src 'self' cdn.highimpactpayments.com *.acceleratoradmin.com *.adpclientappreciation.com *.lincolnelectricdigitalrewards.com *.boschappliancedigitalrewards.com *.prepaiddigitalsolutions.com *.purestoragedigitalrewards.com *.prepaiddigitalsolutions.com *.purestoragedigitalrewards.com *.thermadorappliancedigitalrewards.com *.tranedigitalrewards.com *.americanstandardairdigitalrewards.com *.myacuvuedigitalrewards.com *.attrecognition.com *.coopervisiondigitalrewards.com *.allglobalcircle-rewards.com *.habcard.com *.minimotoringredemption.com *.minimotoringrewardsredemption.com *.ultimaterewardsredemption.com *.mystarzrewards.com *.e-rewardsmedicalrewards.com *.recognizingyourewards.com *.kelloggsdigitalrewards.ca *.valvolinedigitalrewards.com *.goodyeardigitalrewards.com *.alconchoicepayments.com *.geappliancesdigitalrewards.com *.topcashbackdigitalsolutions.com *.topcashbackdigitalsolutions.co.uk *.prosper2card.co.uk *.ppdslab.com *.cooperdigitalrewards.com *.tranedigitalrewards.com https://cdn.datatables.net https://ajax.aspnetcdn.com https://maxcdn.bootstrapcdn.com https://cdnjs.cloudflare.com https://stackpath.bootstrapcdn.com *.greencompasspay.com *.360digitalpayments.com *.adpclientappreciation.com *.alconchoicepayments.com *.allglobalcircle-rewards.com *.americanstandardairdigitalrewards.com *.attrecognition.com *.bittyadvancecard.com *.bmwrebateredemption.com *.bmwultimaterewardsredemption.com *.boschappliancedigitalrewards.com *.cbdatsbypay.com *.ceomovementpay.com *.cooperdigitalrewards.com *.coopervisiondigitalrewards.com *.digitalwalletdemo.com *.emrispay.com *.e-rewardsmedicalrewards.com *.expectationsrewards.co.uk *.ferrerorecognition.com *.fundkitecard.com *.geappliancesdigitalrewards.com *.gettogether-pjlibraryrewards.org *.goodyeardigitalrewards.com *.greencompasspay.com *.guustodigitalrewards.com *.habcard.com *.healthyhempfarmspay.com *.honey20pay.com *.hoolalifepay.com *.kelloggsdigitalrewards.ca *.leafywellpay.com *.lincolnelectricdigitalrewards.com *.minimotoringredemption.com *.minimotoringrewardsredemption.com *.minirebateredemption.com *.myacuvuedigitalrewards.com *.mygocardspay.com *.myrevealpay.com *.my-rewardcard.com *.mystarzrewards.com *.natureancepay.com *.NNAPartsDigitalRewards.com *.noble8pay.com *.onelogicmoney.com *.perksatworkcard.com *.ppdslab.com *.ppdslabautomation.com *.prepaiddigitalsolutions.com *.prosper2card.co.uk *.purestoragedigitalrewards.com *.pyurlifepay.com *.recognizingyourewards.com *.redgagedirect.com *.sanctuarygirlpay.com *.swiftimplementations.com *.thermadorappliancedigitalrewards.com *.tirestorerewards.com *.topcashbackdigitalsolutions.co.uk *.topcashbackdigitalsolutions.com *.tranedigitalrewards.com *.ultimaterewardsredemption.com *.uulalacard.com *.valvolinedigitalrewards.com *.vsponeprepaidcard.com *.wealthbuilderpay.com *.worldpaymerchantrewards.com *.yourrewardpass.com topcashbackdigitalsolutions.co.uk https://cdn.highimpactpayments.com 'unsafe-inline';connect-src 'self' *.acceleratoradmin.com *.adpclientappreciation.com *.lincolnelectricdigitalrewards.com *.boschappliancedigitalrewards.com *.prepaiddigitalsolutions.com *.purestoragedigitalrewards.com *.prepaiddigitalsolutions.com *.purestoragedigitalrewards.com *.thermadorappliancedigitalrewards.com *.tranedigitalrewards.com *.americanstandardairdigitalrewards.com *.myacuvuedigitalrewards.com *.attrecognition.com *.coopervisiondigitalrewards.com *.allglobalcircle-rewards.com *.habcard.com *.minimotoringredemption.com *.minimotoringrewardsredemption.com *.ultimaterewardsredemption.com *.mystarzrewards.com *.e-rewardsmedicalrewards.com *.recognizingyourewards.com *.kelloggsdigitalrewards.ca *.valvolinedigitalrewards.com *.goodyeardigitalrewards.com *.alconchoicepayments.com *.geappliancesdigitalrewards.com *.topcashbackdigitalsolutions.com *.topcashbackdigitalsolutions.co.uk *.prosper2card.co.uk *.ppdslab.com *.cooperdigitalrewards.com https://www.google-analytics.com *.visualstudio.com *.acceleratoradmin.com api.mixpanel.com *.greencompasspay.com *.360digitalpayments.com *.adpclientappreciation.com *.alconchoicepayments.com *.allglobalcircle-rewards.com *.americanstandardairdigitalrewards.com *.attrecognition.com *.bittyadvancecard.com *.bmwrebateredemption.com *.bmwultimaterewardsredemption.com *.boschappliancedigitalrewards.com *.cbdatsbypay.com *.ceomovementpay.com *.cooperdigitalrewards.com *.coopervisiondigitalrewards.com *.digitalwalletdemo.com *.emrispay.com *.e-rewardsmedicalrewards.com *.expectationsrewards.co.uk *.ferrerorecognition.com *.fundkitecard.com *.geappliancesdigitalrewards.com *.gettogether-pjlibraryrewards.org *.goodyeardigitalrewards.com *.greencompasspay.com *.guustodigitalrewards.com *.habcard.com *.healthyhempfarmspay.com *.honey20pay.com *.hoolalifepay.com *.kelloggsdigitalrewards.ca *.leafywellpay.com *.lincolnelectricdigitalrewards.com *.minimotoringredemption.com *.minimotoringrewardsredemption.com *.minirebateredemption.com *.myacuvuedigitalrewards.com *.mygocardspay.com *.myrevealpay.com *.my-rewardcard.com *.mystarzrewards.com *.natureancepay.com *.NNAPartsDigitalRewards.com *.noble8pay.com *.onelogicmoney.com *.perksatworkcard.com *.ppdslab.com *.ppdslabautomation.com *.prepaiddigitalsolutions.com *.prosper2card.co.uk *.purestoragedigitalrewards.com *.pyurlifepay.com *.recognizingyourewards.com *.redgagedirect.com *.sanctuarygirlpay.com *.swiftimplementations.com *.thermadorappliancedigitalrewards.com *.tirestorerewards.com *.topcashbackdigitalsolutions.co.uk *.topcashbackdigitalsolutions.com *.tranedigitalrewards.com *.ultimaterewardsredemption.com *.uulalacard.com *.valvolinedigitalrewards.com *.vsponeprepaidcard.com *.wealthbuilderpay.com *.worldpaymerchantrewards.com *.yourrewardpass.com topcashbackdigitalsolutions.co.uk https://api-js.mixpanel.com api-js.mixpanel.com api-js.mixpanel.com https://cdn.highimpactpayments.com;font-src 'self' cdn.highimpactpayments.com https://ajax.aspnetcdn.com *.tranedigitalrewards.com maxcdn.bootstrapcdn.com cdnjs.cloudflare.com *.acceleratoradmin.com https://cdn.highimpactpayments.com;img-src 'self' cdn.highimpactpayments.com https://cdnjs.cloudflare.com https://www.google-analytics.com *.acceleratoradmin.com data: data: https://cdn.highimpactpayments.com;frame-src 'self' https://www.recaptcha.net/ https://www.google.com *.acceleratoradmin.com *.adpclientappreciation.com *.lincolnelectricdigitalrewards.com *.boschappliancedigitalrewards.com *.prepaiddigitalsolutions.com *.purestoragedigitalrewards.com *.prepaiddigitalsolutions.com *.purestoragedigitalrewards.com *.thermadorappliancedigitalrewards.com *.tranedigitalrewards.com *.americanstandardairdigitalrewards.com *.myacuvuedigitalrewards.com *.attrecognition.com *.coopervisiondigitalrewards.com *.allglobalcircle-rewards.com *.habcard.com *.minimotoringredemption.com *.minimotoringrewardsredemption.com *.ultimaterewardsredemption.com *.mystarzrewards.com *.e-rewardsmedicalrewards.com *.recognizingyourewards.com *.kelloggsdigitalrewards.ca *.valvolinedigitalrewards.com *.goodyeardigitalrewards.com *.alconchoicepayments.com *.geappliancesdigitalrewards.com *.topcashbackdigitalsolutions.com *.topcashbackdigitalsolutions.co.uk *.prosper2card.co.uk *.ppdslab.com *.cooperdigitalrewards.com *.youtube.com https://youtu.be https://testcommon.swiftprepaid.com https://common.swiftprepaid.com *.greencompasspay.com *.360digitalpayments.com *.adpclientappreciation.com *.alconchoicepayments.com *.allglobalcircle-rewards.com *.americanstandardairdigitalrewards.com *.attrecognition.com *.bittyadvancecard.com *.bmwrebateredemption.com *.bmwultimaterewardsredemption.com *.boschappliancedigitalrewards.com *.cbdatsbypay.com *.ceomovementpay.com *.cooperdigitalrewards.com *.coopervisiondigitalrewards.com *.digitalwalletdemo.com *.emrispay.com *.e-rewardsmedicalrewards.com *.expectationsrewards.co.uk *.ferrerorecognition.com *.fundkitecard.com *.geappliancesdigitalrewards.com *.gettogether-pjlibraryrewards.org *.goodyeardigitalrewards.com *.greencompasspay.com *.guustodigitalrewards.com *.habcard.com *.healthyhempfarmspay.com *.honey20pay.com *.hoolalifepay.com *.kelloggsdigitalrewards.ca *.leafywellpay.com *.lincolnelectricdigitalrewards.com *.minimotoringredemption.com *.minimotoringrewardsredemption.com *.minirebateredemption.com *.myacuvuedigitalrewards.com *.mygocardspay.com *.myrevealpay.com *.my-rewardcard.com *.mystarzrewards.com *.natureancepay.com *.NNAPartsDigitalRewards.com *.noble8pay.com *.onelogicmoney.com *.perksatworkcard.com *.ppdslab.com *.ppdslabautomation.com *.prepaiddigitalsolutions.com *.prosper2card.co.uk *.purestoragedigitalrewards.com *.pyurlifepay.com *.recognizingyourewards.com *.redgagedirect.com *.sanctuarygirlpay.com *.swiftimplementations.com *.thermadorappliancedigitalrewards.com *.tirestorerewards.com *.topcashbackdigitalsolutions.co.uk *.topcashbackdigitalsolutions.com *.tranedigitalrewards.com *.ultimaterewardsredemption.com *.uulalacard.com *.valvolinedigitalrewards.com *.vsponeprepaidcard.com *.wealthbuilderpay.com *.worldpaymerchantrewards.com *.yourrewardpass.com topcashbackdigitalsolutions.co.uk https://cdn.highimpactpayments.com",
//                     "Pragma": "no-cache",
//                     "Referrer-Policy": "strict-origin",
//                     "Request-Context": "appId=cid-v1:f6c2aaf9-503c-4efd-b90b-010255daaa8d",
//                     "Server": "Kestrel",
//                     "Set-Cookie": ".AspNetCore.Mvc.CookieTempDataProvider=CfDJ8PriW8VpBIRPo51qMDgzq4Zj6vj_43mJxcKilJDLtxRtiYklbJPut5ndVVaj-W2WxhDuIe_2Dkx7sOkynLl3nnpF6DKN4pag_TA6YEUVrZaCML2yvy6tF_W0x9IDY0gt6ng3DIaVEKo3M0FICa3tw_oeDMlxOjYNmfoj06IHR0kK; path=/; samesite=lax; httponly",
//                     "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
//                     "Vary": "Accept-Encoding",
//                     "X-Content-Type-Options": "nosniff",
//                     "X-Frame-Options": "SAMEORIGIN",
//                     "X-Permitted-Cross-Domain-Policies": "None",
//                     "X-XSS-Protection": "1; mode=block"
//                 }`);
//             });

//             await init.pageWaitForSelector(page, '#body');
//             await init.pageClick(page, 'textarea[name=body]');
//             await init.pageType(
//                 page,
//                 'textarea[name=body]',
//                 `<h1 id="html"><span>${bodyText}</span></h1>`
//             );
//             await init.pageClick(page, 'button[type=submit]');
//             await init.pageWaitForSelector(page, '#save-btn', {
//                 visible: true,
//                 timeout: init.timeout,
//             });

//             // Component and Monitor are already created. This is code refactoring
//             await init.navigateToMonitorDetails(
//                 componentName,
//                 testServerMonitorName,
//                 page
//             );

//             let monitorStatusElement = await init.pageWaitForSelector(
//                 page,
//                 `#monitor-status-${testServerMonitorName}`,
//                 { visible: true, timeout: operationTimeOut }
//             );
//             monitorStatusElement = await monitorStatusElement.getProperty(
//                 'innerText'
//             );
//             monitorStatusElement = await monitorStatusElement.jsonValue();
//             monitorStatusElement.should.be.exactly('Online');

//             done();
//         },
//         operationTimeOut
//     );

//     test(
//         'should degrade (not timeout and return status code 408) monitor with response time longer than init.timeoutms and status code 200',
//         async done => {
//             const bodyText = utils.generateRandomString();
//             // This navigates to hhtp-test server and create the settings for the test suite
//             await page.goto(utils.HTTP_TEST_SERVER_URL + '/settings');
//             await page.evaluate(
//                 () => (document.getElementById('responseTime').value = '')
//             );
//             await page.evaluate(
//                 () => (document.getElementById('statusCode').value = '')
//             );
//             await page.evaluate(
//                 () => (document.getElementById('header').value = '{}')
//             );
//             await page.evaluate(
//                 () => (document.getElementById('body').value = '')
//             );
//             await init.pageWaitForSelector(page, '#responseTime');
//             await init.pageClick(page, 'input[name=responseTime]');
//             await init.pageType(
//                 page,
//                 'input[name=responseTime]',
//                 'init.timeout'
//             );
//             await init.pageWaitForSelector(page, '#statusCode');
//             await init.pageClick(page, 'input[name=statusCode]');
//             await init.pageType(page, 'input[name=statusCode]', '200');
//             await page.select('#responseType', 'html');
//             await init.pageWaitForSelector(page, '#body');
//             await init.pageClick(page, 'textarea[name=body]');
//             await init.pageType(
//                 page,
//                 'textarea[name=body]',
//                 `<h1 id="html"><span>${bodyText}</span></h1>`
//             );
//             await init.pageClick(page, 'button[type=submit]');
//             await init.pageWaitForSelector(page, '#save-btn', {
//                 visible: true,
//                 timeout: init.timeout,
//             });

//             // Component and Monitor are already created. This is code refactoring
//             await init.navigateToMonitorDetails(
//                 componentName,
//                 testServerMonitorName,
//                 page
//             );
//             await init.pageWaitForSelector(page, '#notificationscroll', {
//                 visbile: true,
//                 timeout: 280000,
//             });

//             let monitorStatusElement = await init.pageWaitForSelector(
//                 page,
//                 `#monitor-status-${testServerMonitorName}`,
//                 { visible: true, timeout: operationTimeOut }
//             );
//             monitorStatusElement = await monitorStatusElement.getProperty(
//                 'innerText'
//             );
//             monitorStatusElement = await monitorStatusElement.jsonValue();
//             monitorStatusElement.should.be.exactly('Degraded');

//             done();
//         },
//         operationTimeOut
//     );
// });

// describe('API Monitor API', () => {
//     const operationTimeOut = init.timeout;

//     const componentName = utils.generateRandomString();
//     const monitorName = utils.generateRandomString();
//     const testMonitorName = utils.generateRandomString();

//     beforeAll(async () => {
//         jest.setTimeout(init.timeout);

//         browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
//         page = await browser.newPage();
//         await page.setUserAgent(utils.agent);

//         await page.goto(utils.HTTP_TEST_SERVER_URL + '/settings');
//         await page.evaluate(
//             () => (document.getElementById('responseTime').value = '')
//         );
//         await page.evaluate(
//             () => (document.getElementById('statusCode').value = '')
//         );
//         await page.evaluate(
//             () => (document.getElementById('header').value = '')
//         );
//         await page.evaluate(() => (document.getElementById('body').value = ''));
//         await init.pageWaitForSelector(page, '#responseTime');
//         await init.pageClick(page, 'input[name=responseTime]');
//         await init.pageType(page, 'input[name=responseTime]', '0');
//         await init.pageWaitForSelector(page, '#statusCode');
//         await init.pageClick(page, 'input[name=statusCode]');
//         await init.pageType(page, 'input[name=statusCode]', '200');
//         await page.select('#responseType', 'json');
//         await init.pageWaitForSelector(page, '#header');
//         await init.pageClick(page, 'textarea[name=header]');
//         await init.pageType(
//             page,
//             'textarea[name=header]',
//             '{"Content-Type":"application/json"}'
//         );
//         await init.pageWaitForSelector(page, '#body');
//         await init.pageClick(page, 'textarea[name=body]');
//         await init.pageType(page, 'textarea[name=body]', '{"status":"ok"}');
//         await init.pageClick(page, 'button[type=submit]');
//         await init.pageWaitForSelector(page, '#save-btn');
//         await init.pageWaitForSelector(page, '#save-btn', {
//             visible: true,
//             timeout: init.timeout,
//         });

//         const user = {
//             email: utils.generateRandomBusinessEmail(),
//             password,
//         };
//         await init.registerUser(user, page);

//         await init.addComponent(componentName, page);
//     });

//     afterAll(async done => {
//         await browser.close();
//         done();
//     });

//     test(
//         'should not add API monitor with invalid url',
//         async done => {
//             // Create Component first
//             // Redirects automatically component to details page
//             await init.navigateToComponentDetails(componentName, page);
//             await init.pageWaitForSelector(page, '#form-new-monitor');
//             await init.pageWaitForSelector(page, 'input[id=name]', {
//                 visible: true,
//                 timeout: init.timeout,
//             });
//             await init.pageWaitForSelector(page, 'input[id=name]', {
//                 visible: true,
//                 timeout: init.timeout,
//             });
//             await init.pageClick(page, 'input[id=name]');
//             await page.focus('input[id=name]');
//             await init.pageType(page, 'input[id=name]', monitorName);
//             await init.pageClick(page, 'input[data-testId=type_api]');
//             await init.pageWaitForSelector(page, '#url', {
//                 visible: true,
//                 timeout: init.timeout,
//             });
//             await init.pageClick(page, '#url');
//             await init.pageType(page, '#url', 'https://google.com');
//             await init.selectDropdownValue('#method', 'get', page);

//             await init.pageClick(page, 'button[type=submit]');

//             let spanElement = await init.pageWaitForSelector(
//                 page,
//                 '#formNewMonitorError'
//             );
//             spanElement = await spanElement.getProperty('innerText');
//             spanElement = await spanElement.jsonValue();
//             spanElement.should.be.exactly(
//                 'API Monitor URL should not be a HTML page.'
//             );
//             done();
//         },
//         operationTimeOut
//     );

//     test(
//         'should not add API monitor with invalid payload',
//         async done => {
//             // Navigate to Component details
//             await init.navigateToComponentDetails(componentName, page);

//             await init.pageWaitForSelector(page, '#form-new-monitor');
//             await init.pageWaitForSelector(page, 'input[id=name]', {
//                 visible: true,
//                 timeout: init.timeout,
//             });
//             await init.pageWaitForSelector(page, 'input[id=name]', {
//                 visible: true,
//                 timeout: init.timeout,
//             });
//             await init.pageClick(page, 'input[id=name]');
//             await page.focus('input[id=name]');
//             await init.pageType(page, 'input[id=name]', monitorName);
//             await init.pageClick(page, 'input[data-testId=type_api]');
//             await init.pageWaitForSelector(page, '#url', {
//                 visible: true,
//                 timeout: init.timeout,
//             });
//             await init.pageClick(page, '#url');
//             await init.pageType(
//                 page,
//                 '#url',
//                 'https://fyipe.com/api/monitor/valid-project-id'
//             );
//             await init.selectDropdownValue('#method', 'post', page);

//             await init.pageClick(page, 'button[type=submit]');

//             const spanElement = await init.pageWaitForSelector(
//                 page,
//                 '#formNewMonitorError'
//             );
//             expect(spanElement).toBeDefined();
//             done();
//         },
//         operationTimeOut
//     );

//     test(
//         'should not add API monitor with invalid payload in advance options',
//         async done => {
//             // Navigate to Component details
//             await init.navigateToComponentDetails(componentName, page);

//             await init.pageWaitForSelector(page, '#form-new-monitor');
//             await init.pageWaitForSelector(page, 'input[id=name]', {
//                 visible: true,
//                 timeout: init.timeout,
//             });
//             await init.pageWaitForSelector(page, 'input[id=name]', {
//                 visible: true,
//                 timeout: init.timeout,
//             });
//             await init.pageClick(page, 'input[id=name]');
//             await page.focus('input[id=name]');
//             await init.pageType(page, 'input[id=name]', monitorName);
//             await init.pageClick(page, 'input[data-testId=type_api]');
//             await init.selectDropdownValue('#method', 'post', page);
//             await init.pageWaitForSelector(page, '#url', {
//                 visible: true,
//                 timeout: init.timeout,
//             });
//             await init.pageClick(page, '#url');
//             await init.pageType(
//                 page,
//                 '#url',
//                 'https://fyipe.com/api/monitor/valid-project-id'
//             );
//             await init.pageWaitForSelector(page, '#advanceOptions');
//             await init.pageClick(page, '#advanceOptions');

//             await init.pageWaitForSelector(page, '#addApiHeaders');
//             await init.pageClick(page, '#addApiHeaders');
//             await init.pageWaitForSelector(
//                 page,
//                 'input[id=headers_1000_0_key]'
//             );
//             await init.pageClick(page, 'input[id=headers_1000_0_key]');
//             await init.pageType(
//                 page,
//                 'input[id=headers_1000_0_key]',
//                 'Authorization'
//             );
//             await init.pageClick(page, 'input[id=headers_1000_0_value]');
//             await init.pageType(
//                 page,
//                 'input[id=headers_1000_0_value]',
//                 'Basic valid-token'
//             );
//             await init.selectDropdownValue('#bodyType', 'text/plain', page);
//             await init.pageClick(page, '#feedback-textarea');
//             await init.pageType(page, '#feedback-textarea', 'BAD');
//             await init.pageClick(page, 'button[type=submit]');

//             const spanElement = await init.pageWaitForSelector(
//                 page,
//                 '#formNewMonitorError'
//             );
//             expect(spanElement).toBeDefined();
//             done();
//         },
//         operationTimeOut
//     );

//     test(
//         'should add API monitor with valid url and payload',
//         async done => {
//             // Navigate to Component details
//             await init.navigateToComponentDetails(componentName, page);

//             await init.pageWaitForSelector(page, '#form-new-monitor');
//             await init.pageWaitForSelector(page, 'input[id=name]', {
//                 visible: true,
//                 timeout: init.timeout,
//             });
//             await init.pageWaitForSelector(page, 'input[id=name]', {
//                 visible: true,
//                 timeout: init.timeout,
//             });
//             await init.pageClick(page, 'input[id=name]');
//             await page.focus('input[id=name]');
//             await init.pageType(page, 'input[id=name]', monitorName);
//             await init.pageClick(page, 'input[data-testId=type_api]');
//             await init.selectDropdownValue('#method', 'get', page);
//             await init.pageWaitForSelector(page, '#url', {
//                 visible: true,
//                 timeout: init.timeout,
//             });
//             await init.pageClick(page, '#url');
//             await init.pageType(page, '#url', 'http://localhost:3002');
//             await init.pageClick(page, 'button[type=submit]');

//             let spanElement = await init.pageWaitForSelector(
//                 page,
//                 `#monitor-title-${monitorName}`
//             );
//             spanElement = await spanElement.getProperty('innerText');
//             spanElement = await spanElement.jsonValue();
//             spanElement.should.be.exactly(monitorName);
//             done();
//         },
//         operationTimeOut
//     );

//     test(
//         'should add API monitor with valid url and evaluate response (online criteria) in advance options',
//         async done => {
//             // Navigate to Component details
//             await init.navigateToComponentDetails(componentName, page);

//             //const newMonitorName = utils.generateRandomString();
//             await init.addAPIMonitorWithJSExpression(page, testMonitorName);

//             let spanElement = await init.pageWaitForSelector(
//                 page,
//                 `#monitor-title-${testMonitorName}`
//             );
//             spanElement = await spanElement.getProperty('innerText');
//             spanElement = await spanElement.jsonValue();
//             spanElement.should.be.exactly(testMonitorName);

//             const probeTabs = await init.page$$(page, 'button[id^=probes-btn]');
//             for (const probeTab of probeTabs) {
//                 await probeTab.click();

//                 let monitorStatusElement = await init.page$(
//                     page,
//                     `#monitor-status-${testMonitorName}`
//                 );
//                 if (monitorStatusElement) {
//                     monitorStatusElement = await monitorStatusElement.getProperty(
//                         'innerText'
//                     );
//                     monitorStatusElement = await monitorStatusElement.jsonValue();
//                     monitorStatusElement.should.be.exactly('Online');
//                 }
//             }
//             done();
//         },
//         operationTimeOut
//     );
//     // Second Monitor has been created an will be used in most of the remaining tests.
//     test(
//         'should strip trailing semicolons from evaluate response js expressions',
//         async done => {
//             // Navigate to Monitor details
//             await init.navigateToMonitorDetails(
//                 componentName,
//                 testMonitorName,
//                 page
//             );

//             const editButtonSelector = `#edit_${testMonitorName}`;
//             await init.pageWaitForSelector(page, editButtonSelector, {
//                 visible: true,
//                 timeout: init.timeout,
//             });
//             await init.page$Eval(page, editButtonSelector, e => e.click());

//             await init.pageWaitForSelector(page, '#form-new-monitor');
//             await init.pageWaitForSelector(page, '#advanceOptions');
//             await init.pageClick(page, '#advanceOptions');

//             // for online criteria
//             const upFields = await init.page$$(
//                 page,
//                 `input[name*="up_"][name*=".field1"]`
//             );
//             const lastUpField = upFields[upFields.length - 1];
//             const upExpression = await (
//                 await lastUpField.getProperty('value')
//             ).jsonValue();

//             expect(upExpression).toEqual("response.body.status === 'ok'");

//             // for degraded criteria
//             const degradedFields = await init.page$$(
//                 page,
//                 `input[name*="degraded_"][name*=".field1"]`
//             );
//             const lastDegradedField = degradedFields[degradedFields.length - 1];
//             const degradedExpression = await (
//                 await lastDegradedField.getProperty('value')
//             ).jsonValue();
//             expect(degradedExpression).toEqual(
//                 "response.body.message === 'draining'"
//             );
//             done();
//         },
//         operationTimeOut
//     );

//     test(
//         'should evaluate response (degraded criteria) in advance options',
//         async done => {
//             await page.goto(utils.HTTP_TEST_SERVER_URL + '/settings');
//             await page.evaluate(
//                 () => (document.getElementById('responseTime').value = '')
//             );
//             await page.evaluate(
//                 () => (document.getElementById('body').value = '')
//             );
//             await init.pageWaitForSelector(page, '#responseTime');
//             await init.pageClick(page, 'input[name=responseTime]');
//             await init.pageType(page, 'input[name=responseTime]', '5000');
//             await init.pageWaitForSelector(page, '#body');
//             await init.pageClick(page, 'textarea[name=body]');
//             await init.pageType(
//                 page,
//                 'textarea[name=body]',
//                 '{"message":"draining"}'
//             );
//             await init.pageClick(page, 'button[type=submit]');
//             await init.pageWaitForSelector(page, '#save-btn');
//             await init.pageWaitForSelector(page, '#save-btn', {
//                 visible: true,
//                 timeout: init.timeout,
//             });

//             await page.goto(utils.DASHBOARD_URL, {
//                 waitUntil: ['networkidle2'],
//             });

//             // Navigate to Monitor details
//             await init.navigateToMonitorDetails(
//                 componentName,
//                 testMonitorName,
//                 page
//             );
//             const probeTabs = await init.page$$(page, 'button[id^=probes-btn]');
//             for (const probeTab of probeTabs) {
//                 await probeTab.click();

//                 let monitorStatusElement = await init.page$(
//                     page,
//                     `#monitor-status-${testMonitorName}`
//                 );
//                 if (monitorStatusElement) {
//                     monitorStatusElement = await monitorStatusElement.getProperty(
//                         'innerText'
//                     );
//                     monitorStatusElement = await monitorStatusElement.jsonValue();
//                     monitorStatusElement.should.be.exactly('Degraded');
//                 }
//             }
//             done();
//         },
//         operationTimeOut
//     );

//     test(
//         'should evaluate response (offline criteria) in advance options',
//         async done => {
//             // This navigates to http-server and creates the appropriate settings before dashboard page.
//             await page.goto(utils.HTTP_TEST_SERVER_URL + '/settings');
//             await page.evaluate(
//                 () => (document.getElementById('statusCode').value = '')
//             );
//             await page.evaluate(
//                 () => (document.getElementById('body').value = '')
//             );
//             await init.pageWaitForSelector(page, '#statusCode');
//             await init.pageClick(page, 'input[name=statusCode]');
//             await init.pageType(page, 'input[name=statusCode]', '400');
//             await init.pageWaitForSelector(page, '#body');
//             await init.pageClick(page, 'textarea[name=body]');
//             await init.pageType(
//                 page,
//                 'textarea[name=body]',
//                 '{"message":"offline"}'
//             );
//             await init.pageClick(page, 'button[type=submit]');
//             await init.pageWaitForSelector(page, '#save-btn');
//             await init.pageWaitForSelector(page, '#save-btn', {
//                 visible: true,
//                 timeout: init.timeout,
//             });

//             // Dashboard Page
//             await page.goto(utils.DASHBOARD_URL, {
//                 waitUntil: ['networkidle2'],
//             });

//             // Navigate to Monitor details
//             await init.navigateToMonitorDetails(
//                 componentName,
//                 testMonitorName,
//                 page
//             );

//             const probeTabs = await init.page$$(page, 'button[id^=probes-btn]');
//             for (const probeTab of probeTabs) {
//                 await probeTab.click();

//                 let monitorStatusElement = await init.page$(
//                     page,
//                     `#monitor-status-${testMonitorName}`
//                 );
//                 if (monitorStatusElement) {
//                     monitorStatusElement = await monitorStatusElement.getProperty(
//                         'innerText'
//                     );
//                     monitorStatusElement = await monitorStatusElement.jsonValue();
//                     monitorStatusElement.should.be.exactly('Offline');
//                 }
//             }
//             done();
//         },
//         operationTimeOut
//     );

//     test('should display offline status if evaluate response does not match in criteria', async done => {
//         // This navigates to http-server and creates the appropriate settings before dashboard page.
//         await page.goto(utils.HTTP_TEST_SERVER_URL + '/settings');
//         await page.evaluate(
//             () => (document.getElementById('responseTime').value = '')
//         );
//         await page.evaluate(
//             () => (document.getElementById('statusCode').value = '')
//         );
//         await page.evaluate(() => (document.getElementById('body').value = ''));
//         await init.pageWaitForSelector(page, '#responseTime');
//         await init.pageClick(page, 'input[name=responseTime]');
//         await init.pageType(page, 'input[name=responseTime]', '0');
//         await init.pageWaitForSelector(page, '#statusCode');
//         await init.pageClick(page, 'input[name=statusCode]');
//         await init.pageType(page, 'input[name=statusCode]', '200');
//         await init.pageWaitForSelector(page, '#body');
//         await init.pageClick(page, 'textarea[name=body]');
//         await init.pageType(page, 'textarea[name=body]', '{"status":"not ok"}');
//         await init.pageClick(page, 'button[type=submit]');
//         await init.pageWaitForSelector(page, '#save-btn');
//         await init.pageWaitForSelector(page, '#save-btn', {
//             visible: true,
//             timeout: init.timeout,
//         });

//         await page.goto(utils.DASHBOARD_URL, {
//             waitUntil: ['networkidle2'],
//         });

//         // Navigate to Monitor details
//         await init.navigateToMonitorDetails(
//             componentName,
//             testMonitorName,
//             page
//         );

//         const probeTabs = await init.page$$(page, 'button[id^=probes-btn]');
//         for (const probeTab of probeTabs) {
//             await probeTab.click();

//             let monitorStatusElement = await init.page$(
//                 page,
//                 `#monitor-status-${testMonitorName}`
//             );
//             if (monitorStatusElement) {
//                 monitorStatusElement = await monitorStatusElement.getProperty(
//                     'innerText'
//                 );
//                 monitorStatusElement = await monitorStatusElement.jsonValue();
//                 monitorStatusElement.should.be.exactly('Offline');
//             }
//         }
//         done();

//         operationTimeOut;
//     });

//     test(
//         'should show specific property, button and modal for evaluate response',
//         async done => {
//             // Navigate to Component details
//             await init.navigateToComponentDetails(componentName, page);

//             const newMonitorName = utils.generateRandomString();
//             await init.addAPIMonitorWithJSExpression(page, newMonitorName, {
//                 createAlertForOnline: true,
//             });

//             // wait for a new incident is created
//             await init.pageWaitForSelector(
//                 page,
//                 `#incident_${newMonitorName}_0`,
//                 {
//                     timeout: 120 * 1000,
//                 }
//             );
//             await Promise.all([
//                 page.$eval(`#incident_${newMonitorName}_0`, element =>
//                     element.click()
//                 ),
//                 page.waitForNavigation(),
//             ]);

//             let monitorIncidentReportElement = await init.pageWaitForSelector(
//                 page,
//                 `#${newMonitorName}_IncidentReport_0`
//             );
//             monitorIncidentReportElement = await monitorIncidentReportElement.getProperty(
//                 'innerText'
//             );
//             monitorIncidentReportElement = await monitorIncidentReportElement.jsonValue();
//             monitorIncidentReportElement.should.match(
//                 /.*Response {"status":"ok"} Did evaluate response.body.status === 'ok'.*/
//             );

//             await init.pageWaitForSelector(
//                 page,
//                 `#${newMonitorName}_ShowResponse_0`
//             );
//             await init.pageClick(page, `#${newMonitorName}_ShowResponse_0`);

//             let monitorIncidentModalElement = await init.pageWaitForSelector(
//                 page,
//                 '#API_Response'
//             );
//             monitorIncidentModalElement = await monitorIncidentModalElement.getProperty(
//                 'innerText'
//             );
//             monitorIncidentModalElement = await monitorIncidentModalElement.jsonValue();
//             monitorIncidentModalElement.should.be.exactly('API Response');
//             done();
//         },
//         operationTimeOut
//     );

//     test(
//         'should delete API monitors',
//         async done => {
//             // Navigate to Monitor details
//             await init.navigateToMonitorDetails(
//                 componentName,
//                 testMonitorName,
//                 page
//             );
//             const deleteButtonSelector = `#delete_${testMonitorName}`;
//             await init.pageWaitForSelector(page, deleteButtonSelector);
//             await init.page$Eval(page, deleteButtonSelector, e => e.click());

//             const confirmDeleteButtonSelector = '#deleteMonitor';
//             await init.pageWaitForSelector(page, confirmDeleteButtonSelector);
//             await init.pageClick(page, confirmDeleteButtonSelector);
//             await init.pageWaitForSelector(page, confirmDeleteButtonSelector, {
//                 hidden: true,
//             });

//             const selector = `span#monitor-title-${testMonitorName}`;
//             const spanElement = await init.page$(page, selector);
//             expect(spanElement).toBeNull();
//             done();
//         },
//         operationTimeOut
//     );
});
