const puppeteer = require('puppeteer');
const utils = require('./test-utils');
const init = require('./test-init');

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
    const operationTimeOut = 500000;    

    beforeAll(async () => {
        jest.setTimeout(500000);

        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/61.0.3163.100 Safari/537.36'
        );
        
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
        'Should create new monitor with default criteria settings',
        async (done) => {            
                // Component is already created.
                await init.navigateToComponentDetails(componentName, page);
                const monitorName = utils.generateRandomString();

                await page.waitForSelector('#form-new-monitor');
                await page.click('input[id=name]');
                await page.type('input[id=name]', monitorName);
                await page.click('[data-testId=type_url]');
                await page.waitForSelector('#url', { visible: true });
                await page.click('#url');
                await page.type('#url', 'https://google.com');
                await page.click('button[type=submit]');

                let spanElement = await page.waitForSelector(
                    `#monitor-title-${monitorName}`
                );
                spanElement = await spanElement.getProperty('innerText');
                spanElement = await spanElement.jsonValue();
                spanElement.should.be.exactly(monitorName);
            done();
        },
        operationTimeOut
    );

    test(
        'Should create new monitor with edited criteria names',
        async (done) => {            
                // Component is already created.
                await init.navigateToComponentDetails(componentName, page);
                const monitorName = utils.generateRandomString();

                await page.waitForSelector('#form-new-monitor');
                await page.click('input[id=name]');
                await page.type('input[id=name]', monitorName);
                await page.click('input[data-testId=type_url]');
                await page.waitForSelector('#url', { visible: true });
                await page.click('#url');
                await page.type('#url', 'https://google.com');

                // change up criterion's name
                await page.click('#advanceOptions');
                let criterionAdvancedOptions = await page.waitForSelector(
                    '[data-testId=criterionAdvancedOptions_up]'
                );
                await criterionAdvancedOptions.click();
                await page.waitForSelector('input[id^=name_up]');
                await page.focus('input[id^=name_up]');
                await page.keyboard.down('Control');
                await page.keyboard.press('A');
                await page.keyboard.up('Control');
                await page.keyboard.press('Backspace');
                const upCriterionName = 'Monitor Online';
                await page.keyboard.type(upCriterionName);

                await page.click('button[type=submit]');

                let spanElement = await page.waitForSelector(
                    `#monitor-title-${monitorName}`
                );
                spanElement = await spanElement.getProperty('innerText');
                spanElement = await spanElement.jsonValue();
                spanElement.should.be.exactly(monitorName);

                await page.click(`#edit_${monitorName}`);
                await page.click('#advanceOptions');
                criterionAdvancedOptions = await page.waitForSelector(
                    '[data-testId=criterionAdvancedOptions_up]'
                );
                await criterionAdvancedOptions.click();
                await page.waitForSelector('input[id^=name_up]');
                const criterionName = await page.$eval(
                    'input[id^=name_up]',
                    el => el.value
                );
                expect(criterionName).toEqual(upCriterionName);
            done();
        },
        operationTimeOut
    );

    test('Should create new monitor with multiple criteria on each category', async (done) => {        
            // Component is already created.
            await init.navigateToComponentDetails(componentName, page);
            const monitorName = utils.generateRandomString();

            await page.waitForSelector('#form-new-monitor');
            await page.click('input[id=name]');
            await page.type('input[id=name]', monitorName);
            await page.click('input[data-testId=type_url]');
            await page.waitForSelector('#url', { visible: true });
            await page.click('#url');
            await page.type('#url', 'https://google.com');

            await page.click('#advanceOptions');

            // add up criterion
            expect(
                (await page.$$('[data-testId^=single_criterion_up')).length
            ).toEqual(1);

            let criterionAdvancedOption = await page.waitForSelector(
                '[data-testId=criterionAdvancedOptions_up]'
            );
            await criterionAdvancedOption.click();

            await page.click('[data-testId=add_criteria_up]');
            expect(
                (await page.$$('[data-testId^=single_criterion_up')).length
            ).toEqual(2);

            // add degraded criterion
            expect(
                (await page.$$('[data-testId^=single_criterion_degraded]'))
                    .length
            ).toEqual(1);

            criterionAdvancedOption = await page.$(
                '[data-testId=criterionAdvancedOptions_degraded]'
            );
            await criterionAdvancedOption.click();

            await page.click('[data-testId=add_criteria_degraded]');
            expect(
                (await page.$$('[data-testId^=single_criterion_degraded]'))
                    .length
            ).toEqual(2);

            // add down criterion
            criterionAdvancedOption = await page.$(
                '[data-testId=criterionAdvancedOptions_down]'
            );
            await criterionAdvancedOption.click();

            expect(
                (await page.$$('[data-testId^=single_criterion_down]')).length
            ).toEqual(1);

            await page.click('[data-testId=add_criteria_down]');
            expect(
                (await page.$$('[data-testId^=single_criterion_down]')).length
            ).toEqual(2);

            // add the monitor and check if the criteria are persisted
            await page.click('button[type=submit]');

            let spanElement = await page.waitForSelector(
                `#monitor-title-${monitorName}`
            );
            spanElement = await spanElement.getProperty('innerText');
            spanElement = await spanElement.jsonValue();
            spanElement.should.be.exactly(monitorName);

            await page.click(`#edit_${monitorName}`);
            await page.click('#advanceOptions');
            // for up criteria
            await page.waitForSelector('[data-testId^=single_criterion_up]');
            expect(
                (await page.$$('[data-testId^=single_criterion_up')).length
            ).toEqual(2);

            // for degraded criteria
            await page.waitForSelector(
                '[data-testId^=single_criterion_degraded]'
            );
            expect(
                (await page.$$('[data-testId^=single_criterion_degraded]'))
                    .length
            ).toEqual(2);
            // for down criteria
            await page.waitForSelector('[data-testId^=single_criterion_down]');
            expect(
                (await page.$$('[data-testId^=single_criterion_down]')).length
            ).toEqual(2);
        done();
    });

    test(
        'should display lighthouse scores',
        async (done) => {            
                // Navigate to Component details
                // This navigates to the monitor created alongside the created component
                await init.navigateToMonitorDetails(
                    componentName,
                    monitorName,
                    page
                );
                await page.waitForTimeout(25000); // This is needed for '-' to turn to '%' as '%' is a coming of the probe server else shouldRender could have been used to pass id.
                await page.waitForSelector(`#lighthouseLogs_${monitorName}_0`, {
                    visible: true,
                    timeout: operationTimeOut,
                });

                let lighthousePerformanceElement = await page.waitForSelector(
                    `#lighthouse-performance-${monitorName}`,
                    { visible: true, timeout: operationTimeOut }
                );
                lighthousePerformanceElement = await lighthousePerformanceElement.getProperty(
                    'innerText'
                );
                lighthousePerformanceElement = await lighthousePerformanceElement.jsonValue();
                lighthousePerformanceElement.should.endWith('%');

                let lighthouseAccessibilityElement = await page.waitForSelector(
                    `#lighthouse-accessibility-${monitorName}`,
                    { visible: true, timeout: operationTimeOut }
                );
                lighthouseAccessibilityElement = await lighthouseAccessibilityElement.getProperty(
                    'innerText'
                );
                lighthouseAccessibilityElement = await lighthouseAccessibilityElement.jsonValue();
                lighthouseAccessibilityElement.should.endWith('%');

                let lighthouseBestPracticesElement = await page.waitForSelector(
                    `#lighthouse-bestPractices-${monitorName}`,
                    { visible: true, timeout: operationTimeOut }
                );
                lighthouseBestPracticesElement = await lighthouseBestPracticesElement.getProperty(
                    'innerText'
                );
                lighthouseBestPracticesElement = await lighthouseBestPracticesElement.jsonValue();
                lighthouseBestPracticesElement.should.endWith('%');

                let lighthouseSeoElement = await page.waitForSelector(
                    `#lighthouse-seo-${monitorName}`,
                    { visible: true, timeout: operationTimeOut }
                );
                lighthouseSeoElement = await lighthouseSeoElement.getProperty(
                    'innerText'
                );
                lighthouseSeoElement = await lighthouseSeoElement.jsonValue();
                lighthouseSeoElement.should.endWith('%');

                let lighthousePwaElement = await page.waitForSelector(
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
        async (done) => {            
                // Navigate to Component details
                // This navigates to the monitor created alongside the created component
                await init.navigateToMonitorDetails(
                    componentName,
                    monitorName,
                    page
                );

                const probe0 = await page.waitForSelector('#probes-btn0');
                const probe1 = await page.waitForSelector('#probes-btn1');

                expect(probe0).toBeDefined();
                expect(probe1).toBeDefined();

                const monitorStatus = await page.waitForSelector(
                    `#monitor-status-${monitorName}`
                );
                const sslStatus = await page.waitForSelector(
                    `#ssl-status-${monitorName}`
                );

                expect(monitorStatus).toBeDefined();
                expect(sslStatus).toBeDefined();
            done();
        },
        operationTimeOut
    );

    test(
        'Should create new monitor with call schedules',
        async (done) => {            
                // Create Component first
                // Redirects automatically component to details page
                await init.navigateToComponentDetails(componentName, page);
                const monitorName = utils.generateRandomString();
                await page.waitForSelector('#form-new-monitor');
                await page.click('input[id=name]');
                await page.type('input[id=name]', monitorName);
                await page.click('[data-testId=type_url]');
                await page.waitForSelector('#url', { visible: true });
                await page.click('#url');
                await page.type('#url', 'https://google.com');
                // select multiple schedules
                await page.$$eval('[data-testId^=callSchedules_]', schedules =>
                    schedules.forEach(schedule => schedule.click())
                );

                await page.click('button[type=submit]');

                let spanElement = await page.waitForSelector(
                    `#monitor-title-${monitorName}`
                );
                spanElement = await spanElement.getProperty('innerText');
                spanElement = await spanElement.jsonValue();
                spanElement.should.be.exactly(monitorName);

                await page.click(`#edit_${monitorName}`);

                const checkboxValues = await page.$$eval(
                    '[data-testId^=callSchedules_]',
                    schedules => schedules.map(schedule => schedule.checked)
                );

                const areAllChecked = checkboxValues.every(
                    checked => checked === true
                );
                expect(areAllChecked).toEqual(true);
            done();
        },
        operationTimeOut
    );

    test(
        'Should not create new monitor when details are incorrect',
        async (done) => {            
                // Navigate to Component details
                await init.navigateToComponentDetails(componentName, page);

                await page.waitForSelector('#form-new-monitor');
                await page.click('[data-testId=type_url]');
                await page.waitForSelector('#url', { visible: true });
                await page.click('#url');
                await page.type('#url', 'https://google.com');

                await page.click('button[type=submit]');

                let spanElement = await page.waitForSelector(
                    '#form-new-monitor span#field-error'
                );
                spanElement = await spanElement.getProperty('innerText');
                spanElement = await spanElement.jsonValue();
                spanElement.should.be.exactly(
                    'This field cannot be left blank'
                );
            done();
        },
        operationTimeOut
    );

    test(
        'should display SSL enabled status',
        async (done) => {            
                // Navigate to Component details
                await init.navigateToComponentDetails(componentName, page);

                let sslStatusElement = await page.waitForSelector(
                    `#ssl-status-${monitorName}`,
                    { visible: true, timeout: operationTimeOut }
                );
                sslStatusElement = await sslStatusElement.getProperty(
                    'innerText'
                );
                sslStatusElement = await sslStatusElement.jsonValue();
                sslStatusElement.should.be.exactly('Enabled');
            done();
        },
        operationTimeOut
    );

    test(
        'should display SSL not found status',
        async (done) => {            
                // Navigate to Component details
                await init.navigateToComponentDetails(componentName, page);

                await page.waitForSelector('#form-new-monitor');
                await page.click('input[id=name]');
                await page.type('input[id=name]', testServerMonitorName);
                await page.click('[data-testId=type_url]');
                await page.waitForSelector('#url', { visible: true });
                await page.click('#url');
                await page.type('#url', utils.HTTP_TEST_SERVER_URL);
                await page.click('button[type=submit]');

                let sslStatusElement = await page.waitForSelector(
                    `#ssl-status-${testServerMonitorName}`,
                    { visible: true, timeout: operationTimeOut }
                );
                sslStatusElement = await sslStatusElement.getProperty(
                    'innerText'
                );
                sslStatusElement = await sslStatusElement.jsonValue();
                sslStatusElement.should.be.exactly('No SSL Found');
            done();
        },
        operationTimeOut
    );

    test(
        'should display SSL self-signed status',
        async (done) => {
            const selfSignedMonitorName = utils.generateRandomString();
            
                // Navigate to Component details
                await init.navigateToComponentDetails(componentName, page);

                await page.waitForSelector('#form-new-monitor');
                await page.click('input[id=name]');
                await page.type('input[id=name]', selfSignedMonitorName);
                await init.selectByText('#type', 'url', page);
                await page.waitForSelector('#url', { visible: true });
                await page.click('#url');
                await page.type('#url', 'https://self-signed.badssl.com');
                await page.click('button[type=submit]');

                let sslStatusElement = await page.waitForSelector(
                    `#ssl-status-${selfSignedMonitorName}`,
                    { visible: true, timeout: operationTimeOut }
                );
                sslStatusElement = await sslStatusElement.getProperty(
                    'innerText'
                );
                sslStatusElement = await sslStatusElement.jsonValue();
                sslStatusElement.should.be.exactly('Self Signed');
            done();
        },
        operationTimeOut
    );

    test(
        'should display monitor status online for monitor with large response header',
        async (done) => {
            const bodyText = utils.generateRandomString();
            // This navigates to hhtp-test server and create the settings for the test suite
                await page.goto(utils.HTTP_TEST_SERVER_URL + '/settings');
                await page.evaluate(
                    () => (document.getElementById('responseTime').value = '')
                );
                await page.evaluate(
                    () => (document.getElementById('statusCode').value = '')
                );
                await page.evaluate(
                    () => (document.getElementById('header').value = '')
                );
                await page.evaluate(
                    () => (document.getElementById('body').value = '')
                );
                await page.waitForSelector('#responseTime');
                await page.click('input[name=responseTime]');
                await page.type('input[name=responseTime]', '0');
                await page.waitForSelector('#statusCode');
                await page.click('input[name=statusCode]');
                await page.type('input[name=statusCode]', '200');
                await page.select('#responseType', 'html');
                await page.waitForSelector('#header');
                await page.click('textarea[name=header]');
                await page.type(
                    'textarea[name=header]',
                    `{
                        "Connection": "keep-alive",
                        "Content-Security-Policy": "script-src 'self' https://www.gstatic.cn *.acceleratoradmin.com *.adpclientappreciation.com *.lincolnelectricdigitalrewards.com *.boschappliancedigitalrewards.com *.prepaiddigitalsolutions.com *.purestoragedigitalrewards.com *.prepaiddigitalsolutions.com *.purestoragedigitalrewards.com *.thermadorappliancedigitalrewards.com *.tranedigitalrewards.com *.americanstandardairdigitalrewards.com *.myacuvuedigitalrewards.com *.attrecognition.com *.coopervisiondigitalrewards.com *.allglobalcircle-rewards.com *.habcard.com *.minimotoringredemption.com *.minimotoringrewardsredemption.com *.ultimaterewardsredemption.com *.mystarzrewards.com *.e-rewardsmedicalrewards.com *.recognizingyourewards.com *.kelloggsdigitalrewards.ca *.valvolinedigitalrewards.com *.goodyeardigitalrewards.com *.alconchoicepayments.com *.geappliancesdigitalrewards.com *.topcashbackdigitalsolutions.com *.topcashbackdigitalsolutions.co.uk *.prosper2card.co.uk *.ppdslab.com *.cooperdigitalrewards.com *.tranedigitalrewards.com https://cdn.datatables.net https://www.google-analytics.com https://www.recaptcha.net https://ajax.aspnetcdn.com https://stackpath.bootstrapcdn.com https://cdnjs.cloudflare.com https://maxcdn.bootstrapcdn.com *.google.com *.googletagmanager.com https://www.gstatic.com https://ajax.googleapis.com https://*.msecnd.net *.acceleratoradmin.com *.mxpnl.com *.greencompasspay.com *.360digitalpayments.com *.adpclientappreciation.com *.alconchoicepayments.com *.allglobalcircle-rewards.com *.americanstandardairdigitalrewards.com *.attrecognition.com *.bittyadvancecard.com *.bmwrebateredemption.com *.bmwultimaterewardsredemption.com *.boschappliancedigitalrewards.com *.cbdatsbypay.com *.ceomovementpay.com *.cooperdigitalrewards.com *.coopervisiondigitalrewards.com *.digitalwalletdemo.com *.emrispay.com *.e-rewardsmedicalrewards.com *.expectationsrewards.co.uk *.ferrerorecognition.com *.fundkitecard.com *.geappliancesdigitalrewards.com *.gettogether-pjlibraryrewards.org *.goodyeardigitalrewards.com *.greencompasspay.com *.guustodigitalrewards.com *.habcard.com *.healthyhempfarmspay.com *.honey20pay.com *.hoolalifepay.com *.kelloggsdigitalrewards.ca *.leafywellpay.com *.lincolnelectricdigitalrewards.com *.minimotoringredemption.com *.minimotoringrewardsredemption.com *.minirebateredemption.com *.myacuvuedigitalrewards.com *.mygocardspay.com *.myrevealpay.com *.my-rewardcard.com *.mystarzrewards.com *.natureancepay.com *.NNAPartsDigitalRewards.com *.noble8pay.com *.onelogicmoney.com *.perksatworkcard.com *.ppdslab.com *.ppdslabautomation.com *.prepaiddigitalsolutions.com *.prosper2card.co.uk *.purestoragedigitalrewards.com *.pyurlifepay.com *.recognizingyourewards.com *.redgagedirect.com *.sanctuarygirlpay.com *.swiftimplementations.com *.thermadorappliancedigitalrewards.com *.tirestorerewards.com *.topcashbackdigitalsolutions.co.uk *.topcashbackdigitalsolutions.com *.tranedigitalrewards.com *.ultimaterewardsredemption.com *.uulalacard.com *.valvolinedigitalrewards.com *.vsponeprepaidcard.com *.wealthbuilderpay.com *.worldpaymerchantrewards.com *.yourrewardpass.com topcashbackdigitalsolutions.co.uk https://cdn.highimpactpayments.com 'unsafe-inline';style-src 'self' cdn.highimpactpayments.com *.acceleratoradmin.com *.adpclientappreciation.com *.lincolnelectricdigitalrewards.com *.boschappliancedigitalrewards.com *.prepaiddigitalsolutions.com *.purestoragedigitalrewards.com *.prepaiddigitalsolutions.com *.purestoragedigitalrewards.com *.thermadorappliancedigitalrewards.com *.tranedigitalrewards.com *.americanstandardairdigitalrewards.com *.myacuvuedigitalrewards.com *.attrecognition.com *.coopervisiondigitalrewards.com *.allglobalcircle-rewards.com *.habcard.com *.minimotoringredemption.com *.minimotoringrewardsredemption.com *.ultimaterewardsredemption.com *.mystarzrewards.com *.e-rewardsmedicalrewards.com *.recognizingyourewards.com *.kelloggsdigitalrewards.ca *.valvolinedigitalrewards.com *.goodyeardigitalrewards.com *.alconchoicepayments.com *.geappliancesdigitalrewards.com *.topcashbackdigitalsolutions.com *.topcashbackdigitalsolutions.co.uk *.prosper2card.co.uk *.ppdslab.com *.cooperdigitalrewards.com *.tranedigitalrewards.com https://cdn.datatables.net https://ajax.aspnetcdn.com https://maxcdn.bootstrapcdn.com https://cdnjs.cloudflare.com https://stackpath.bootstrapcdn.com *.greencompasspay.com *.360digitalpayments.com *.adpclientappreciation.com *.alconchoicepayments.com *.allglobalcircle-rewards.com *.americanstandardairdigitalrewards.com *.attrecognition.com *.bittyadvancecard.com *.bmwrebateredemption.com *.bmwultimaterewardsredemption.com *.boschappliancedigitalrewards.com *.cbdatsbypay.com *.ceomovementpay.com *.cooperdigitalrewards.com *.coopervisiondigitalrewards.com *.digitalwalletdemo.com *.emrispay.com *.e-rewardsmedicalrewards.com *.expectationsrewards.co.uk *.ferrerorecognition.com *.fundkitecard.com *.geappliancesdigitalrewards.com *.gettogether-pjlibraryrewards.org *.goodyeardigitalrewards.com *.greencompasspay.com *.guustodigitalrewards.com *.habcard.com *.healthyhempfarmspay.com *.honey20pay.com *.hoolalifepay.com *.kelloggsdigitalrewards.ca *.leafywellpay.com *.lincolnelectricdigitalrewards.com *.minimotoringredemption.com *.minimotoringrewardsredemption.com *.minirebateredemption.com *.myacuvuedigitalrewards.com *.mygocardspay.com *.myrevealpay.com *.my-rewardcard.com *.mystarzrewards.com *.natureancepay.com *.NNAPartsDigitalRewards.com *.noble8pay.com *.onelogicmoney.com *.perksatworkcard.com *.ppdslab.com *.ppdslabautomation.com *.prepaiddigitalsolutions.com *.prosper2card.co.uk *.purestoragedigitalrewards.com *.pyurlifepay.com *.recognizingyourewards.com *.redgagedirect.com *.sanctuarygirlpay.com *.swiftimplementations.com *.thermadorappliancedigitalrewards.com *.tirestorerewards.com *.topcashbackdigitalsolutions.co.uk *.topcashbackdigitalsolutions.com *.tranedigitalrewards.com *.ultimaterewardsredemption.com *.uulalacard.com *.valvolinedigitalrewards.com *.vsponeprepaidcard.com *.wealthbuilderpay.com *.worldpaymerchantrewards.com *.yourrewardpass.com topcashbackdigitalsolutions.co.uk https://cdn.highimpactpayments.com 'unsafe-inline';connect-src 'self' *.acceleratoradmin.com *.adpclientappreciation.com *.lincolnelectricdigitalrewards.com *.boschappliancedigitalrewards.com *.prepaiddigitalsolutions.com *.purestoragedigitalrewards.com *.prepaiddigitalsolutions.com *.purestoragedigitalrewards.com *.thermadorappliancedigitalrewards.com *.tranedigitalrewards.com *.americanstandardairdigitalrewards.com *.myacuvuedigitalrewards.com *.attrecognition.com *.coopervisiondigitalrewards.com *.allglobalcircle-rewards.com *.habcard.com *.minimotoringredemption.com *.minimotoringrewardsredemption.com *.ultimaterewardsredemption.com *.mystarzrewards.com *.e-rewardsmedicalrewards.com *.recognizingyourewards.com *.kelloggsdigitalrewards.ca *.valvolinedigitalrewards.com *.goodyeardigitalrewards.com *.alconchoicepayments.com *.geappliancesdigitalrewards.com *.topcashbackdigitalsolutions.com *.topcashbackdigitalsolutions.co.uk *.prosper2card.co.uk *.ppdslab.com *.cooperdigitalrewards.com https://www.google-analytics.com *.visualstudio.com *.acceleratoradmin.com api.mixpanel.com *.greencompasspay.com *.360digitalpayments.com *.adpclientappreciation.com *.alconchoicepayments.com *.allglobalcircle-rewards.com *.americanstandardairdigitalrewards.com *.attrecognition.com *.bittyadvancecard.com *.bmwrebateredemption.com *.bmwultimaterewardsredemption.com *.boschappliancedigitalrewards.com *.cbdatsbypay.com *.ceomovementpay.com *.cooperdigitalrewards.com *.coopervisiondigitalrewards.com *.digitalwalletdemo.com *.emrispay.com *.e-rewardsmedicalrewards.com *.expectationsrewards.co.uk *.ferrerorecognition.com *.fundkitecard.com *.geappliancesdigitalrewards.com *.gettogether-pjlibraryrewards.org *.goodyeardigitalrewards.com *.greencompasspay.com *.guustodigitalrewards.com *.habcard.com *.healthyhempfarmspay.com *.honey20pay.com *.hoolalifepay.com *.kelloggsdigitalrewards.ca *.leafywellpay.com *.lincolnelectricdigitalrewards.com *.minimotoringredemption.com *.minimotoringrewardsredemption.com *.minirebateredemption.com *.myacuvuedigitalrewards.com *.mygocardspay.com *.myrevealpay.com *.my-rewardcard.com *.mystarzrewards.com *.natureancepay.com *.NNAPartsDigitalRewards.com *.noble8pay.com *.onelogicmoney.com *.perksatworkcard.com *.ppdslab.com *.ppdslabautomation.com *.prepaiddigitalsolutions.com *.prosper2card.co.uk *.purestoragedigitalrewards.com *.pyurlifepay.com *.recognizingyourewards.com *.redgagedirect.com *.sanctuarygirlpay.com *.swiftimplementations.com *.thermadorappliancedigitalrewards.com *.tirestorerewards.com *.topcashbackdigitalsolutions.co.uk *.topcashbackdigitalsolutions.com *.tranedigitalrewards.com *.ultimaterewardsredemption.com *.uulalacard.com *.valvolinedigitalrewards.com *.vsponeprepaidcard.com *.wealthbuilderpay.com *.worldpaymerchantrewards.com *.yourrewardpass.com topcashbackdigitalsolutions.co.uk https://api-js.mixpanel.com api-js.mixpanel.com api-js.mixpanel.com https://cdn.highimpactpayments.com;font-src 'self' cdn.highimpactpayments.com https://ajax.aspnetcdn.com *.tranedigitalrewards.com maxcdn.bootstrapcdn.com cdnjs.cloudflare.com *.acceleratoradmin.com https://cdn.highimpactpayments.com;img-src 'self' cdn.highimpactpayments.com https://cdnjs.cloudflare.com https://www.google-analytics.com *.acceleratoradmin.com data: data: https://cdn.highimpactpayments.com;frame-src 'self' https://www.recaptcha.net/ https://www.google.com *.acceleratoradmin.com *.adpclientappreciation.com *.lincolnelectricdigitalrewards.com *.boschappliancedigitalrewards.com *.prepaiddigitalsolutions.com *.purestoragedigitalrewards.com *.prepaiddigitalsolutions.com *.purestoragedigitalrewards.com *.thermadorappliancedigitalrewards.com *.tranedigitalrewards.com *.americanstandardairdigitalrewards.com *.myacuvuedigitalrewards.com *.attrecognition.com *.coopervisiondigitalrewards.com *.allglobalcircle-rewards.com *.habcard.com *.minimotoringredemption.com *.minimotoringrewardsredemption.com *.ultimaterewardsredemption.com *.mystarzrewards.com *.e-rewardsmedicalrewards.com *.recognizingyourewards.com *.kelloggsdigitalrewards.ca *.valvolinedigitalrewards.com *.goodyeardigitalrewards.com *.alconchoicepayments.com *.geappliancesdigitalrewards.com *.topcashbackdigitalsolutions.com *.topcashbackdigitalsolutions.co.uk *.prosper2card.co.uk *.ppdslab.com *.cooperdigitalrewards.com *.youtube.com https://youtu.be https://testcommon.swiftprepaid.com https://common.swiftprepaid.com *.greencompasspay.com *.360digitalpayments.com *.adpclientappreciation.com *.alconchoicepayments.com *.allglobalcircle-rewards.com *.americanstandardairdigitalrewards.com *.attrecognition.com *.bittyadvancecard.com *.bmwrebateredemption.com *.bmwultimaterewardsredemption.com *.boschappliancedigitalrewards.com *.cbdatsbypay.com *.ceomovementpay.com *.cooperdigitalrewards.com *.coopervisiondigitalrewards.com *.digitalwalletdemo.com *.emrispay.com *.e-rewardsmedicalrewards.com *.expectationsrewards.co.uk *.ferrerorecognition.com *.fundkitecard.com *.geappliancesdigitalrewards.com *.gettogether-pjlibraryrewards.org *.goodyeardigitalrewards.com *.greencompasspay.com *.guustodigitalrewards.com *.habcard.com *.healthyhempfarmspay.com *.honey20pay.com *.hoolalifepay.com *.kelloggsdigitalrewards.ca *.leafywellpay.com *.lincolnelectricdigitalrewards.com *.minimotoringredemption.com *.minimotoringrewardsredemption.com *.minirebateredemption.com *.myacuvuedigitalrewards.com *.mygocardspay.com *.myrevealpay.com *.my-rewardcard.com *.mystarzrewards.com *.natureancepay.com *.NNAPartsDigitalRewards.com *.noble8pay.com *.onelogicmoney.com *.perksatworkcard.com *.ppdslab.com *.ppdslabautomation.com *.prepaiddigitalsolutions.com *.prosper2card.co.uk *.purestoragedigitalrewards.com *.pyurlifepay.com *.recognizingyourewards.com *.redgagedirect.com *.sanctuarygirlpay.com *.swiftimplementations.com *.thermadorappliancedigitalrewards.com *.tirestorerewards.com *.topcashbackdigitalsolutions.co.uk *.topcashbackdigitalsolutions.com *.tranedigitalrewards.com *.ultimaterewardsredemption.com *.uulalacard.com *.valvolinedigitalrewards.com *.vsponeprepaidcard.com *.wealthbuilderpay.com *.worldpaymerchantrewards.com *.yourrewardpass.com topcashbackdigitalsolutions.co.uk https://cdn.highimpactpayments.com",
                        "Pragma": "no-cache",
                        "Referrer-Policy": "strict-origin",
                        "Request-Context": "appId=cid-v1:f6c2aaf9-503c-4efd-b90b-010255daaa8d",
                        "Server": "Kestrel",
                        "Set-Cookie": ".AspNetCore.Mvc.CookieTempDataProvider=CfDJ8PriW8VpBIRPo51qMDgzq4Zj6vj_43mJxcKilJDLtxRtiYklbJPut5ndVVaj-W2WxhDuIe_2Dkx7sOkynLl3nnpF6DKN4pag_TA6YEUVrZaCML2yvy6tF_W0x9IDY0gt6ng3DIaVEKo3M0FICa3tw_oeDMlxOjYNmfoj06IHR0kK; path=/; samesite=lax; httponly",
                        "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
                        "Vary": "Accept-Encoding",
                        "X-Content-Type-Options": "nosniff",
                        "X-Frame-Options": "SAMEORIGIN",
                        "X-Permitted-Cross-Domain-Policies": "None",
                        "X-XSS-Protection": "1; mode=block"
                    }`
                );
                await page.waitForSelector('#body');
                await page.click('textarea[name=body]');
                await page.type(
                    'textarea[name=body]',
                    `<h1 id="html"><span>${bodyText}</span></h1>`
                );
                await page.click('button[type=submit]');
                await page.waitForSelector('#save-btn', { visible: true });            
            
                // Component and Monitor are already created. This is code refactoring
                await init.navigateToMonitorDetails(
                    componentName,
                    testServerMonitorName,
                    page
                );

                let monitorStatusElement = await page.waitForSelector(
                    `#monitor-status-${testServerMonitorName}`,
                    { visible: true, timeout: operationTimeOut }
                );
                monitorStatusElement = await monitorStatusElement.getProperty(
                    'innerText'
                );
                monitorStatusElement = await monitorStatusElement.jsonValue();
                monitorStatusElement.should.be.exactly('Online');

            done();
        },
        operationTimeOut
    );

    test(
        'should degrade (not timeout and return status code 408) monitor with response time longer than 60000ms and status code 200',
        async (done) => {
            const bodyText = utils.generateRandomString();
            // This navigates to hhtp-test server and create the settings for the test suite
                await page.goto(utils.HTTP_TEST_SERVER_URL + '/settings');
                await page.evaluate(
                    () => (document.getElementById('responseTime').value = '')
                );
                await page.evaluate(
                    () => (document.getElementById('statusCode').value = '')
                );
                await page.evaluate(
                    () => (document.getElementById('header').value = '{}')
                );
                await page.evaluate(
                    () => (document.getElementById('body').value = '')
                );
                await page.waitForSelector('#responseTime');
                await page.click('input[name=responseTime]');
                await page.type('input[name=responseTime]', '60000');
                await page.waitForSelector('#statusCode');
                await page.click('input[name=statusCode]');
                await page.type('input[name=statusCode]', '200');
                await page.select('#responseType', 'html');
                await page.waitForSelector('#body');
                await page.click('textarea[name=body]');
                await page.type(
                    'textarea[name=body]',
                    `<h1 id="html"><span>${bodyText}</span></h1>`
                );
                await page.click('button[type=submit]');
                await page.waitForSelector('#save-btn', { visible: true });            

            
                // Component and Monitor are already created. This is code refactoring
                await init.navigateToMonitorDetails(
                    componentName,
                    testServerMonitorName,
                    page
                );
                await page.waitForSelector('#notificationscroll', {
                    visbile: true,
                    timeout: 280000,
                });

                let monitorStatusElement = await page.waitForSelector(
                    `#monitor-status-${testServerMonitorName}`,
                    { visible: true, timeout: operationTimeOut }
                );
                monitorStatusElement = await monitorStatusElement.getProperty(
                    'innerText'
                );
                monitorStatusElement = await monitorStatusElement.jsonValue();
                monitorStatusElement.should.be.exactly('Degraded');
            

            done();
        },
        operationTimeOut
    );
});

describe('API Monitor API', () => {
    const operationTimeOut = 500000;    

    const componentName = utils.generateRandomString();
    const monitorName = utils.generateRandomString();
    const testMonitorName = utils.generateRandomString();

    beforeAll(async () => {
        jest.setTimeout(500000);

        browser = await puppeteer.launch(utils.puppeteerLaunchConfig);
        page = await browser.newPage();
        await page.setUserAgent(
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/61.0.3163.100 Safari/537.36'
        );
        
            await page.goto(utils.HTTP_TEST_SERVER_URL + '/settings');
            await page.evaluate(
                () => (document.getElementById('responseTime').value = '')
            );
            await page.evaluate(
                () => (document.getElementById('statusCode').value = '')
            );
            await page.evaluate(
                () => (document.getElementById('header').value = '')
            );
            await page.evaluate(
                () => (document.getElementById('body').value = '')
            );
            await page.waitForSelector('#responseTime');
            await page.click('input[name=responseTime]');
            await page.type('input[name=responseTime]', '0');
            await page.waitForSelector('#statusCode');
            await page.click('input[name=statusCode]');
            await page.type('input[name=statusCode]', '200');
            await page.select('#responseType', 'json');
            await page.waitForSelector('#header');
            await page.click('textarea[name=header]');
            await page.type(
                'textarea[name=header]',
                '{"Content-Type":"application/json"}'
            );
            await page.waitForSelector('#body');
            await page.click('textarea[name=body]');
            await page.type('textarea[name=body]', '{"status":"ok"}');
            await page.click('button[type=submit]');
            await page.waitForSelector('#save-btn');
            await page.waitForSelector('#save-btn', { visible: true });       
      
        
            const user = {
                email: utils.generateRandomBusinessEmail(),
                password,
            };
            await init.registerUser(user, page);       
       
            await init.addComponent(componentName, page);
       
    });

    afterAll(async done => {        
        await browser.close();
        done();
    });

    test(
        'should not add API monitor with invalid url',
        async (done) => {            
                // Create Component first
                // Redirects automatically component to details page
                await init.navigateToComponentDetails(componentName, page);
                await page.waitForSelector('#form-new-monitor');
                await page.click('input[id=name]');
                await page.type('input[id=name]', monitorName);
                await page.click('input[data-testId=type_api]');
                await page.waitForSelector('#url', { visible: true });
                await page.click('#url');
                await page.type('#url', 'https://google.com');
                await init.selectByText('#method', 'get', page);

                await page.click('button[type=submit]');

                let spanElement = await page.waitForSelector(
                    '#formNewMonitorError'
                );
                spanElement = await spanElement.getProperty('innerText');
                spanElement = await spanElement.jsonValue();
                spanElement.should.be.exactly(
                    'API Monitor URL should not be a HTML page.'
                );
            done();
        },
        operationTimeOut
    );

    test(
        'should not add API monitor with invalid payload',
        async (done) => {            
                // Navigate to Component details
                await init.navigateToComponentDetails(componentName, page);

                await page.waitForSelector('#form-new-monitor');
                await page.click('input[id=name]');
                await page.type('input[id=name]', monitorName);
                await page.click('input[data-testId=type_api]');
                await page.waitForSelector('#url', { visible: true });
                await page.click('#url');
                await page.type(
                    '#url',
                    'https://fyipe.com/api/monitor/valid-project-id'
                );
                await init.selectByText('#method', 'post', page);

                await page.click('button[type=submit]');

                const spanElement = await page.waitForSelector(
                    '#formNewMonitorError'
                );
                expect(spanElement).toBeDefined();
            done();
        },
        operationTimeOut
    );

    test(
        'should not add API monitor with invalid payload in advance options',
        async (done) => {            
                // Navigate to Component details
                await init.navigateToComponentDetails(componentName, page);

                await page.waitForSelector('#form-new-monitor');
                await page.click('input[id=name]');
                await page.type('input[id=name]', monitorName);
                await page.click('input[data-testId=type_api]');
                await init.selectByText('#method', 'post', page);
                await page.waitForSelector('#url', { visible: true });
                await page.click('#url');
                await page.type(
                    '#url',
                    'https://fyipe.com/api/monitor/valid-project-id'
                );
                await page.waitForSelector('#advanceOptions');
                await page.click('#advanceOptions');

                await page.waitForSelector('#addApiHeaders');
                await page.click('#addApiHeaders');
                await page.waitForSelector('input[id=headers_1000_0_key]');
                await page.click('input[id=headers_1000_0_key]');
                await page.type(
                    'input[id=headers_1000_0_key]',
                    'Authorization'
                );
                await page.click('input[id=headers_1000_0_value]');
                await page.type(
                    'input[id=headers_1000_0_value]',
                    'Basic valid-token'
                );
                await init.selectByText('#bodyType', 'text/plain', page);
                await page.click('#feedback-textarea');
                await page.type('#feedback-textarea', 'BAD');
                await page.click('button[type=submit]');

                const spanElement = await page.waitForSelector(
                    '#formNewMonitorError'
                );
                expect(spanElement).toBeDefined();
            done();
        },
        operationTimeOut
    );

    test(
        'should add API monitor with valid url and payload',
        async (done) => {            
                // Navigate to Component details
                await init.navigateToComponentDetails(componentName, page);

                await page.waitForSelector('#form-new-monitor');
                await page.click('input[id=name]');
                await page.type('input[id=name]', monitorName);
                await page.click('input[data-testId=type_api]');
                await init.selectByText('#method', 'get', page);
                await page.waitForSelector('#url', { visible: true });
                await page.click('#url');
                await page.type('#url', 'http://localhost:3002');
                await page.click('button[type=submit]');

                let spanElement = await page.waitForSelector(
                    `#monitor-title-${monitorName}`
                );
                spanElement = await spanElement.getProperty('innerText');
                spanElement = await spanElement.jsonValue();
                spanElement.should.be.exactly(monitorName);
            done();
        },
        operationTimeOut
    );

    test(
        'should add API monitor with valid url and evaluate response (online criteria) in advance options',
        async (done) => {            
                // Navigate to Component details
                await init.navigateToComponentDetails(componentName, page);

                //const newMonitorName = utils.generateRandomString();
                await init.addAPIMonitorWithJSExpression(page, testMonitorName);

                let spanElement = await page.waitForSelector(
                    `#monitor-title-${testMonitorName}`
                );
                spanElement = await spanElement.getProperty('innerText');
                spanElement = await spanElement.jsonValue();
                spanElement.should.be.exactly(testMonitorName);

                const probeTabs = await page.$$('button[id^=probes-btn]');
                for (const probeTab of probeTabs) {
                    await probeTab.click();

                    let monitorStatusElement = await page.$(
                        `#monitor-status-${testMonitorName}`
                    );
                    if (monitorStatusElement) {
                        monitorStatusElement = await monitorStatusElement.getProperty(
                            'innerText'
                        );
                        monitorStatusElement = await monitorStatusElement.jsonValue();
                        monitorStatusElement.should.be.exactly('Online');
                    }
                }
            done();
        },
        operationTimeOut
    );
    // Second Monitor has been created an will be used in most of the remaining tests.
    test(
        'should strip trailing semicolons from evaluate response js expressions',
        async (done) => {            
                // Navigate to Monitor details
                await init.navigateToMonitorDetails(
                    componentName,
                    testMonitorName,
                    page
                );

                const editButtonSelector = `#edit_${testMonitorName}`;
                await page.waitForSelector(editButtonSelector, {
                    visible: true,
                });
                await page.$eval(editButtonSelector, e => e.click());

                await page.waitForSelector('#form-new-monitor');
                await page.waitForSelector('#advanceOptions');
                await page.click('#advanceOptions');

                // for online criteria
                const upFields = await page.$$(
                    `input[name*="up_"][name*=".field1"]`
                );
                const lastUpField = upFields[upFields.length - 1];
                const upExpression = await (
                    await lastUpField.getProperty('value')
                ).jsonValue();

                expect(upExpression).toEqual("response.body.status === 'ok'");

                // for degraded criteria
                const degradedFields = await page.$$(
                    `input[name*="degraded_"][name*=".field1"]`
                );
                const lastDegradedField =
                    degradedFields[degradedFields.length - 1];
                const degradedExpression = await (
                    await lastDegradedField.getProperty('value')
                ).jsonValue();
                expect(degradedExpression).toEqual(
                    "response.body.message === 'draining'"
                );
            done();
        },
        operationTimeOut
    );  

    test(
        'should evaluate response (degraded criteria) in advance options',
        async (done) => {            
                await page.goto(utils.HTTP_TEST_SERVER_URL + '/settings');
                await page.evaluate(
                    () => (document.getElementById('responseTime').value = '')
                );
                await page.evaluate(
                    () => (document.getElementById('body').value = '')
                );
                await page.waitForSelector('#responseTime');
                await page.click('input[name=responseTime]');
                await page.type('input[name=responseTime]', '5000');
                await page.waitForSelector('#body');
                await page.click('textarea[name=body]');
                await page.type(
                    'textarea[name=body]',
                    '{"message":"draining"}'
                );
                await page.click('button[type=submit]');
                await page.waitForSelector('#save-btn');
                await page.waitForSelector('#save-btn', { visible: true });
                        
            
                await page.goto(utils.DASHBOARD_URL);

                // Navigate to Monitor details
                await init.navigateToMonitorDetails(
                    componentName,
                    testMonitorName,
                    page
                );                
                const probeTabs = await page.$$('button[id^=probes-btn]');
                for (const probeTab of probeTabs) {
                    await probeTab.click();

                    let monitorStatusElement = await page.$(
                        `#monitor-status-${testMonitorName}`
                    );
                    if (monitorStatusElement) {
                        monitorStatusElement = await monitorStatusElement.getProperty(
                            'innerText'
                        );
                        monitorStatusElement = await monitorStatusElement.jsonValue();
                        monitorStatusElement.should.be.exactly('Degraded');
                    }
                }
            done();
        },
        operationTimeOut
    );

    test(
        'should evaluate response (offline criteria) in advance options',
        async (done) => {   
                // This navigates to http-server and creates the appropriate settings before dashboard page.      
                await page.goto(utils.HTTP_TEST_SERVER_URL + '/settings');
                await page.evaluate(
                    () => (document.getElementById('statusCode').value = '')
                );
                await page.evaluate(
                    () => (document.getElementById('body').value = '')
                );
                await page.waitForSelector('#statusCode');
                await page.click('input[name=statusCode]');
                await page.type('input[name=statusCode]', '400');
                await page.waitForSelector('#body');
                await page.click('textarea[name=body]');
                await page.type('textarea[name=body]', '{"message":"offline"}');
                await page.click('button[type=submit]');
                await page.waitForSelector('#save-btn');
                await page.waitForSelector('#save-btn', { visible: true });            
            
                // Dashboard Page
                await page.goto(utils.DASHBOARD_URL);

                // Navigate to Monitor details
                await init.navigateToMonitorDetails(
                    componentName,
                    testMonitorName,
                    page
                );

                const probeTabs = await page.$$('button[id^=probes-btn]');
                for (const probeTab of probeTabs) {
                    await probeTab.click();

                    let monitorStatusElement = await page.$(
                        `#monitor-status-${testMonitorName}`
                    );
                    if (monitorStatusElement) {
                        monitorStatusElement = await monitorStatusElement.getProperty(
                            'innerText'
                        );
                        monitorStatusElement = await monitorStatusElement.jsonValue();
                        monitorStatusElement.should.be.exactly('Offline');
                    }
                }
            done();
        },
        operationTimeOut
    );

    test('should display offline status if evaluate response does not match in criteria', async (done) => {        
            // This navigates to http-server and creates the appropriate settings before dashboard page.    
            await page.goto(utils.HTTP_TEST_SERVER_URL + '/settings');
            await page.evaluate(
                () => (document.getElementById('responseTime').value = '')
            );
            await page.evaluate(
                () => (document.getElementById('statusCode').value = '')
            );
            await page.evaluate(
                () => (document.getElementById('body').value = '')
            );
            await page.waitForSelector('#responseTime');
            await page.click('input[name=responseTime]');
            await page.type('input[name=responseTime]', '0');
            await page.waitForSelector('#statusCode');
            await page.click('input[name=statusCode]');
            await page.type('input[name=statusCode]', '200');
            await page.waitForSelector('#body');
            await page.click('textarea[name=body]');
            await page.type('textarea[name=body]', '{"status":"not ok"}');
            await page.click('button[type=submit]');
            await page.waitForSelector('#save-btn');
            await page.waitForSelector('#save-btn', { visible: true });
                        
                await page.goto(utils.DASHBOARD_URL);

                // Navigate to Monitor details
                await init.navigateToMonitorDetails(
                    componentName,
                    testMonitorName,
                    page
                );

                const probeTabs = await page.$$('button[id^=probes-btn]');
                for (const probeTab of probeTabs) {
                    await probeTab.click();

                    let monitorStatusElement = await page.$(
                        `#monitor-status-${testMonitorName}`
                    );
                    if (monitorStatusElement) {
                        monitorStatusElement = await monitorStatusElement.getProperty(
                            'innerText'
                        );
                        monitorStatusElement = await monitorStatusElement.jsonValue();
                        monitorStatusElement.should.be.exactly('Offline');
                    }
                }
                done();
            
            operationTimeOut        
    });

    test(
        'should show specific property, button and modal for evaluate response',
        async (done) => {            
                // Navigate to Component details
                await init.navigateToComponentDetails(componentName, page);

                const newMonitorName = utils.generateRandomString();
                await init.addAPIMonitorWithJSExpression(page, newMonitorName, {
                    createAlertForOnline: true,
                });

                // wait for a new incident is created
                await page.waitForSelector(`#incident_${newMonitorName}_0`, {
                    timeout: 120 * 1000,
                });
                await Promise.all([
                    page.$eval(`#incident_${newMonitorName}_0`, element =>
                        element.click()
                    ),
                    page.waitForNavigation(),
                ]);

                let monitorIncidentReportElement = await page.waitForSelector(
                    `#${newMonitorName}_IncidentReport_0`
                );
                monitorIncidentReportElement = await monitorIncidentReportElement.getProperty(
                    'innerText'
                );
                monitorIncidentReportElement = await monitorIncidentReportElement.jsonValue();
                monitorIncidentReportElement.should.match(
                    /.*Response {"status":"ok"} Did evaluate response.body.status === 'ok'.*/
                );

                await page.waitForSelector(`#${newMonitorName}_ShowResponse_0`);
                await page.click(`#${newMonitorName}_ShowResponse_0`);

                let monitorIncidentModalElement = await page.waitForSelector(
                    '#API_Response'
                );
                monitorIncidentModalElement = await monitorIncidentModalElement.getProperty(
                    'innerText'
                );
                monitorIncidentModalElement = await monitorIncidentModalElement.jsonValue();
                monitorIncidentModalElement.should.be.exactly('API Response');
            done();
        },
        operationTimeOut
    );

    test(
        'should delete API monitors',
        async (done) => {
            expect.assertions(1);            
                // Navigate to Monitor details
                await init.navigateToMonitorDetails(
                    componentName,
                    testMonitorName,
                    page
                );
                const deleteButtonSelector = `#delete_${testMonitorName}`;
                await page.waitForSelector(deleteButtonSelector);
                await page.$eval(deleteButtonSelector, e => e.click());

                const confirmDeleteButtonSelector = '#deleteMonitor';
                await page.waitForSelector(confirmDeleteButtonSelector);
                await page.click(confirmDeleteButtonSelector);
                await page.waitForSelector(confirmDeleteButtonSelector, {
                    hidden: true,
                });

                const selector = `span#monitor-title-${testMonitorName}`;
                const spanElement = await page.$(selector);
                expect(spanElement).toBeNull();
            done();
        },
        operationTimeOut
    );
});
