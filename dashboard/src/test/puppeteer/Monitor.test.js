const puppeteer = require('puppeteer');
const utils = require('./test-utils');
const init = require('./test-init');
const { Cluster } = require('puppeteer-cluster');

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

    let cluster;

    beforeAll(async () => {
        jest.setTimeout(500000);

        cluster = await Cluster.launch({
            concurrency: Cluster.CONCURRENCY_PAGE,
            puppeteerOptions: utils.puppeteerLaunchConfig,
            puppeteer,
            timeout: utils.timeout,
        });

        cluster.on('taskerror', err => {
            throw err;
        });

        return await cluster.execute(null, async ({ page }) => {
            const user = {
                email,
                password,
            };
            await init.registerUser(user, page);                        
            await init.addSchedule(callSchedule, page);
            await init.addMonitorToComponent(componentName, monitorName, page); // This creates a default component and a monitor. The monitor created here will be used by other tests as required
        });
    });

    afterAll(async done => {
        await cluster.idle();
        await cluster.close();
        done();
    });

    test(
        'Should create new monitor with default criteria settings',
        async () => {
            return await cluster.execute(null, async ({ page }) => {
                // Create Component first
                // Redirects automatically component to details page
                //await init.addComponent(componentName, page);

                await init.navigateToComponentDetails(componentName, page);
                const monitorName = utils.generateRandomString();

                await page.waitForSelector('#form-new-monitor');
                await page.click('input[id=name]');
                await page.type('input[id=name]', monitorName);
                await page.click('[data-testId=type_url]');
                await page.waitForSelector('#url');
                await page.click('#url');
                await page.type('#url', 'https://google.com');
                await page.click('button[type=submit]');

                let spanElement = await page.waitForSelector(
                    `#monitor-title-${monitorName}`
                );
                spanElement = await spanElement.getProperty('innerText');
                spanElement = await spanElement.jsonValue();
                spanElement.should.be.exactly(monitorName);
            });
        },
        operationTimeOut
    );

    test(
        'Should create new monitor with edited criteria names',
        async () => {
            return await cluster.execute(null, async ({ page }) => {
                // Create Component first
                // Redirects automatically component to details page
              //  await init.addComponent(componentName, page);

              await init.navigateToComponentDetails(componentName, page);
              const monitorName = utils.generateRandomString();


                await page.waitForSelector('#form-new-monitor');
                await page.click('input[id=name]');
                await page.type('input[id=name]', monitorName);
                await page.click('input[data-testId=type_url]');
                await page.waitForSelector('#url');
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
            });
        },
        operationTimeOut
    );

    test('Should create new monitor with multiple criteria on each category', async () => {
        return await cluster.execute(null, async ({ page }) => {
            // Create Component first
            // Redirects automatically component to details page
          //  await init.addComponent(componentName, page);

          await init.navigateToComponentDetails(componentName, page);
          const monitorName = utils.generateRandomString();


            await page.waitForSelector('#form-new-monitor');
            await page.click('input[id=name]');
            await page.type('input[id=name]', monitorName);
            await page.click('input[data-testId=type_url]');
            await page.waitForSelector('#url');
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
        });
    });

    test(
        'should display lighthouse scores',
        async () => {
            return await cluster.execute(null, async ({ page }) => {
                // Navigate to Component details
                await init.navigateToMonitorDetails(
                    componentName,
                    monitorName,
                    page
                );
                await page.waitForTimeout(25000);
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
            });
        },
        operationTimeOut
    );

    // test(
    //     'should display multiple probes and monitor chart on refresh',
    //     async () => {
    //         return await cluster.execute(null, async ({ page }) => {
    //             // Navigate to Component details
    //             await init.navigateToComponentDetails(componentName, page);

    //             await page.reload({
    //                 waitUntil: ['networkidle0', 'domcontentloaded'],
    //             });

    //             const probe0 = await page.waitForSelector('#probes-btn0');
    //             const probe1 = await page.waitForSelector('#probes-btn1');

    //             expect(probe0).toBeDefined();
    //             expect(probe1).toBeDefined();

    //             const monitorStatus = await page.waitForSelector(
    //                 `#monitor-status-${monitorName}`
    //             );
    //             const sslStatus = await page.waitForSelector(
    //                 `#ssl-status-${monitorName}`
    //             );

    //             expect(monitorStatus).toBeDefined();
    //             expect(sslStatus).toBeDefined();
    //         });
    //     },
    //     operationTimeOut
    // );

    // test(
    //     'Should create new monitor with call schedules',
    //     async () => {
    //         return await cluster.execute(null, async ({ page }) => {
    //             // Create Component first
    //             // Redirects automatically component to details page
    //             await init.addComponent(componentName, page);

    //             await page.waitForSelector('#form-new-monitor');
    //             await page.click('input[id=name]');
    //             await page.type('input[id=name]', monitorName);
    //             await page.click('[data-testId=type_url]');
    //             await page.waitForSelector('#url');
    //             await page.click('#url');
    //             await page.type('#url', 'https://google.com');
    //             // select multiple schedules
    //             await page.$$eval('[data-testId^=callSchedules_]', schedules =>
    //                 schedules.forEach(schedule => schedule.click())
    //             );

    //             await page.click('button[type=submit]');

    //             let spanElement = await page.waitForSelector(
    //                 `#monitor-title-${monitorName}`
    //             );
    //             spanElement = await spanElement.getProperty('innerText');
    //             spanElement = await spanElement.jsonValue();
    //             spanElement.should.be.exactly(monitorName);

    //             await page.click(`#edit_${monitorName}`);

    //             const checkboxValues = await page.$$eval(
    //                 '[data-testId^=callSchedules_]',
    //                 schedules => schedules.map(schedule => schedule.checked)
    //             );

    //             const areAllChecked = checkboxValues.every(
    //                 checked => checked === true
    //             );
    //             expect(areAllChecked).toEqual(true);
    //         });
    //     },
    //     operationTimeOut
    // );

    // test(
    //     'Should not create new monitor when details are incorrect',
    //     async () => {
    //         return await cluster.execute(null, async ({ page }) => {
    //             // Navigate to Component details

    //             await init.addComponent(componentName, page);

    //             await page.waitForSelector('#form-new-monitor');
    //             await page.click('[data-testId=type_url]');
    //             await page.waitForSelector('#url');
    //             await page.click('#url');
    //             await page.type('#url', 'https://google.com');

    //             await page.click('button[type=submit]');

    //             let spanElement = await page.waitForSelector(
    //                 '#form-new-monitor span#field-error'
    //             );
    //             spanElement = await spanElement.getProperty('innerText');
    //             spanElement = await spanElement.jsonValue();
    //             spanElement.should.be.exactly(
    //                 'This field cannot be left blank'
    //             );
    //         });
    //     },
    //     operationTimeOut
    // );

    // test(
    //     'should display SSL enabled status',
    //     async () => {
    //         return await cluster.execute(null, async ({ page }) => {
    //             // Navigate to Component details
    //             await init.navigateToComponentDetails(componentName, page);

    //             // await page.waitForTimeout(10000);

    //             let sslStatusElement = await page.waitForSelector(
    //                 `#ssl-status-${monitorName}`,
    //                 { visible: true, timeout: operationTimeOut }
    //             );
    //             sslStatusElement = await sslStatusElement.getProperty(
    //                 'innerText'
    //             );
    //             sslStatusElement = await sslStatusElement.jsonValue();
    //             sslStatusElement.should.be.exactly('Enabled');
    //         });
    //     },
    //     operationTimeOut
    // );

    // test(
    //     'should display SSL not found status',
    //     async () => {
    //         return await cluster.execute(null, async ({ page }) => {
    //             // Navigate to Component details
    //             await init.navigateToComponentDetails(componentName, page);

    //             await page.waitForSelector('#form-new-monitor');
    //             await page.click('input[id=name]');
    //             await page.type('input[id=name]', testServerMonitorName);
    //             await init.selectByText('#type', 'url', page);
    //             await page.waitForSelector('#url');
    //             await page.click('#url');
    //             await page.type('#url', utils.HTTP_TEST_SERVER_URL);
    //             await page.click('button[type=submit]');

    //             let sslStatusElement = await page.waitForSelector(
    //                 `#ssl-status-${testServerMonitorName}`,
    //                 { visible: true, timeout: operationTimeOut }
    //             );
    //             sslStatusElement = await sslStatusElement.getProperty(
    //                 'innerText'
    //             );
    //             sslStatusElement = await sslStatusElement.jsonValue();
    //             sslStatusElement.should.be.exactly('No SSL Found');
    //         });
    //     },
    //     operationTimeOut
    // );

    // test(
    //     'should display SSL self-signed status',
    //     async () => {
    //         const selfSignedMonitorName = utils.generateRandomString();

    //         return await cluster.execute(null, async ({ page }) => {
    //             // Navigate to Component details
    //             await init.navigateToComponentDetails(componentName, page);

    //             await page.waitForSelector('#form-new-monitor');
    //             await page.click('input[id=name]');
    //             await page.type('input[id=name]', selfSignedMonitorName);
    //             await init.selectByText('#type', 'url', page);
    //             await page.waitForSelector('#url');
    //             await page.click('#url');
    //             await page.type('#url', 'https://self-signed.badssl.com');
    //             await page.click('button[type=submit]');

    //             let sslStatusElement = await page.waitForSelector(
    //                 `#ssl-status-${selfSignedMonitorName}`,
    //                 { visible: true, timeout: operationTimeOut }
    //             );
    //             sslStatusElement = await sslStatusElement.getProperty(
    //                 'innerText'
    //             );
    //             sslStatusElement = await sslStatusElement.jsonValue();
    //             sslStatusElement.should.be.exactly('Self Signed');
    //         });
    //     },
    //     operationTimeOut
    // );

    // test(
    //     'should display monitor status online for monitor with large response header',
    //     async () => {
    //         const bodyText = utils.generateRandomString();

    //         const testServer = async ({ page }) => {
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
    //             await page.waitForSelector('#responseTime');
    //             await page.click('input[name=responseTime]');
    //             await page.type('input[name=responseTime]', '0');
    //             await page.waitForSelector('#statusCode');
    //             await page.click('input[name=statusCode]');
    //             await page.type('input[name=statusCode]', '200');
    //             await page.select('#responseType', 'html');
    //             await page.waitForSelector('#header');
    //             await page.click('textarea[name=header]');
    //             await page.type(
    //                 'textarea[name=header]',
    //                 `{
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
    //                 }`
    //             );
    //             await page.waitForSelector('#body');
    //             await page.click('textarea[name=body]');
    //             await page.type(
    //                 'textarea[name=body]',
    //                 `<h1 id="html"><span>${bodyText}</span></h1>`
    //             );
    //             await page.click('button[type=submit]');
    //             await page.waitForSelector('#save-btn', { visible: true });
    //         };

    //         const dashboard = async ({ page }) => {
    //             // Navigate to Component details
    //             await init.navigateToComponentDetails(componentName, page);
    //             await page.waitForTimeout(120000);

    //             await page.waitForSelector(
    //                 `#more-details-${testServerMonitorName}`
    //             );
    //             await page.click(`#more-details-${testServerMonitorName}`);

    //             let monitorStatusElement = await page.waitForSelector(
    //                 `#monitor-status-${testServerMonitorName}`,
    //                 { visible: true, timeout: operationTimeOut }
    //             );
    //             monitorStatusElement = await monitorStatusElement.getProperty(
    //                 'innerText'
    //             );
    //             monitorStatusElement = await monitorStatusElement.jsonValue();
    //             monitorStatusElement.should.be.exactly('Online');
    //         };

    //         await cluster.execute(null, testServer);
    //         await cluster.execute(null, dashboard);
    //     },
    //     operationTimeOut
    // );

    // test(
    //     'should degrade (not timeout and return status code 408) monitor with response time longer than 60000ms and status code 200',
    //     async () => {
    //         const bodyText = utils.generateRandomString();

    //         const testServer = async ({ page }) => {
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
    //             await page.waitForSelector('#responseTime');
    //             await page.click('input[name=responseTime]');
    //             await page.type('input[name=responseTime]', '60000');
    //             await page.waitForSelector('#statusCode');
    //             await page.click('input[name=statusCode]');
    //             await page.type('input[name=statusCode]', '200');
    //             await page.select('#responseType', 'html');
    //             await page.waitForSelector('#body');
    //             await page.click('textarea[name=body]');
    //             await page.type(
    //                 'textarea[name=body]',
    //                 `<h1 id="html"><span>${bodyText}</span></h1>`
    //             );
    //             await page.click('button[type=submit]');
    //             await page.waitForSelector('#save-btn', { visible: true });
    //         };

    //         const dashboard = async ({ page }) => {
    //             // Navigate to Component details
    //             await init.navigateToComponentDetails(componentName, page);
    //             await page.waitForTimeout(280000);

    //             await page.waitForSelector(
    //                 `#more-details-${testServerMonitorName}`
    //             );
    //             await page.click(`#more-details-${testServerMonitorName}`);

    //             let monitorStatusElement = await page.waitForSelector(
    //                 `#monitor-status-${testServerMonitorName}`,
    //                 { visible: true, timeout: operationTimeOut }
    //             );
    //             monitorStatusElement = await monitorStatusElement.getProperty(
    //                 'innerText'
    //             );
    //             monitorStatusElement = await monitorStatusElement.jsonValue();
    //             monitorStatusElement.should.be.exactly('Degraded');
    //         };

    //         await cluster.execute(null, testServer);
    //         await cluster.execute(null, dashboard);
    //     },
    //     operationTimeOut
    // );
});

// describe('API Monitor API', () => {
//     const operationTimeOut = 500000;

//     let cluster;

//     const componentName = utils.generateRandomString();
//     const monitorName = utils.generateRandomString();
//     const testMonitorName = utils.generateRandomString();

//     beforeAll(async () => {
//         jest.setTimeout(500000);

//         cluster = await Cluster.launch({
//             concurrency: Cluster.CONCURRENCY_PAGE,
//             puppeteerOptions: utils.puppeteerLaunchConfig,
//             puppeteer,
//             timeout: utils.timeout,
//         });

//         cluster.on('taskerror', err => {
//             throw err;
//         });

//         const testServer = async ({ page }) => {
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
//             await page.waitForSelector('#responseTime');
//             await page.click('input[name=responseTime]');
//             await page.type('input[name=responseTime]', '0');
//             await page.waitForSelector('#statusCode');
//             await page.click('input[name=statusCode]');
//             await page.type('input[name=statusCode]', '200');
//             await page.select('#responseType', 'json');
//             await page.waitForSelector('#header');
//             await page.click('textarea[name=header]');
//             await page.type(
//                 'textarea[name=header]',
//                 '{"Content-Type":"application/json"}'
//             );
//             await page.waitForSelector('#body');
//             await page.click('textarea[name=body]');
//             await page.type('textarea[name=body]', '{"status":"ok"}');
//             await page.click('button[type=submit]');
//             await page.waitForSelector('#save-btn');
//             await page.waitForSelector('#save-btn', { visible: true });
//         };

//         await cluster.execute(null, testServer);

//         await cluster.execute(null, async ({ page }) => {
//             const user = {
//                 email: utils.generateRandomBusinessEmail(),
//                 password,
//             };
//             await init.registerUser(user, page);            
//         });

//         await cluster.execute(null, async ({ page }) => {
//             await init.addComponent(componentName, page);
//         });
//     });

//     afterAll(async done => {
//         await cluster.idle();
//         await cluster.close();
//         done();
//     });

//     test(
//         'should not add API monitor with invalid url',
//         async () => {
//             return await cluster.execute(null, async ({ page }) => {
//                 // Create Component first
//                 // Redirects automatically component to details page
//                 await init.navigateToComponentDetails(componentName, page);
//                 await page.waitForSelector('#form-new-monitor');
//                 await page.click('input[id=name]');
//                 await page.type('input[id=name]', monitorName);
//                 await page.click('input[data-testId=type_api]');
//                 await page.waitForSelector('#url');
//                 await page.click('#url');
//                 await page.type('#url', 'https://google.com');
//                 await init.selectByText('#method', 'get', page);

//                 await page.click('button[type=submit]');

//                 let spanElement = await page.waitForSelector(
//                     '#formNewMonitorError'
//                 );
//                 spanElement = await spanElement.getProperty('innerText');
//                 spanElement = await spanElement.jsonValue();
//                 spanElement.should.be.exactly(
//                     'API Monitor URL should not be a HTML page.'
//                 );
//             });
//         },
//         operationTimeOut
//     );

//     test(
//         'should not add API monitor with invalid payload',
//         async () => {
//             return await cluster.execute(null, async ({ page }) => {
//                 // Navigate to Component details
//                 await init.navigateToComponentDetails(componentName, page);

//                 await page.waitForSelector('#form-new-monitor');
//                 await page.click('input[id=name]');
//                 await page.type('input[id=name]', monitorName);
//                 await page.click('input[data-testId=type_api]');
//                 await page.waitForSelector('#url');
//                 await page.click('#url');
//                 await page.type(
//                     '#url',
//                     'https://fyipe.com/api/monitor/valid-project-id'
//                 );
//                 await init.selectByText('#method', 'post', page);

//                 await page.click('button[type=submit]');

//                 const spanElement = await page.waitForSelector(
//                     '#formNewMonitorError'
//                 );
//                 expect(spanElement).toBeDefined();
//             });
//         },
//         operationTimeOut
//     );

//     test(
//         'should not add API monitor with invalid payload in advance options',
//         async () => {
//             return await cluster.execute(null, async ({ page }) => {
//                 // Navigate to Component details
//                 await init.navigateToComponentDetails(componentName, page);

//                 await page.waitForSelector('#form-new-monitor');
//                 await page.click('input[id=name]');
//                 await page.type('input[id=name]', monitorName);
//                 await page.click('input[data-testId=type_api]');
//                 await init.selectByText('#method', 'post', page);
//                 await page.waitForSelector('#url');
//                 await page.click('#url');
//                 await page.type(
//                     '#url',
//                     'https://fyipe.com/api/monitor/valid-project-id'
//                 );
//                 await page.waitForSelector('#advanceOptions');
//                 await page.click('#advanceOptions');

//                 await page.waitForSelector('#addApiHeaders');
//                 await page.click('#addApiHeaders');
//                 await page.waitForSelector('input[id=headers_1000_0_key]');
//                 await page.click('input[id=headers_1000_0_key]');
//                 await page.type(
//                     'input[id=headers_1000_0_key]',
//                     'Authorization'
//                 );
//                 await page.click('input[id=headers_1000_0_value]');
//                 await page.type(
//                     'input[id=headers_1000_0_value]',
//                     'Basic valid-token'
//                 );
//                 await init.selectByText('#bodyType', 'text/plain', page);
//                 await page.click('#feedback-textarea');
//                 await page.type('#feedback-textarea', 'BAD');
//                 await page.click('button[type=submit]');

//                 const spanElement = await page.waitForSelector(
//                     '#formNewMonitorError'
//                 );
//                 expect(spanElement).toBeDefined();
//             });
//         },
//         operationTimeOut
//     );

//     test(
//         'should add API monitor with valid url and payload',
//         async () => {
//             return await cluster.execute(null, async ({ page }) => {
//                 // Navigate to Component details
//                 await init.navigateToComponentDetails(componentName, page);

//                 await page.waitForSelector('#form-new-monitor');
//                 await page.click('input[id=name]');
//                 await page.type('input[id=name]', monitorName);
//                 await page.click('input[data-testId=type_api]');
//                 await init.selectByText('#method', 'get', page);
//                 await page.waitForSelector('#url');
//                 await page.click('#url');                
//                 await page.type('#url', 'http://localhost:3002');
//                 await page.click('button[type=submit]');

//                 let spanElement = await page.waitForSelector(
//                     `#monitor-title-${monitorName}`
//                 );
//                 spanElement = await spanElement.getProperty('innerText');
//                 spanElement = await spanElement.jsonValue();
//                 spanElement.should.be.exactly(monitorName);
//             });
//         },
//         operationTimeOut
//     );

//     test(
//         'should add API monitor with valid url and evaluate response (online criteria) in advance options',
//         async () => {
//             return await cluster.execute(null, async ({ page }) => {
//                 // Navigate to Component details
//                 await init.navigateToComponentDetails(componentName, page);

//                 //const newMonitorName = utils.generateRandomString();
//                 await init.addAPIMonitorWithJSExpression(page, testMonitorName);                

//                 let spanElement = await page.waitForSelector(
//                     `#monitor-title-${testMonitorName}`
//                 );
//                 spanElement = await spanElement.getProperty('innerText');
//                 spanElement = await spanElement.jsonValue();
//                 spanElement.should.be.exactly(testMonitorName);

//                 const probeTabs = await page.$$('button[id^=probes-btn]');
//                 for (const probeTab of probeTabs) {
//                     await probeTab.click();

//                     let monitorStatusElement = await page.$(
//                         `#monitor-status-${testMonitorName}`
//                     );
//                     if (monitorStatusElement) {
//                         monitorStatusElement = await monitorStatusElement.getProperty(
//                             'innerText'
//                         );
//                         monitorStatusElement = await monitorStatusElement.jsonValue();
//                         monitorStatusElement.should.be.exactly('Online');
//                     }
//                 }
//             });
//         },
//         operationTimeOut
//     );
//         // Second Monitor has been created an will be used in most of the remaining tests.
//     test(
//         'should strip trailing semicolons from evaluate response js expressions',
//         async () => {
//             return await cluster.execute(null, async ({ page }) => {
//                 // Navigate to Monitor details
//                 await init.navigateToMonitorDetails(
//                     componentName,
//                     testMonitorName,
//                     page
//                 );

//                 const editButtonSelector = `#edit_${testMonitorName}`;
//                 await page.waitForSelector(editButtonSelector, {
//                     visible: true,
//                 });
//                 await page.$eval(editButtonSelector, e => e.click());

//                 await page.waitForSelector('#form-new-monitor');
//                 await page.waitForSelector('#advanceOptions');
//                 await page.click('#advanceOptions');

//                 // for online criteria
//                 const upFields = await page.$$(
//                     `input[name*="up_"][name*=".field1"]`
//                 );
//                 const lastUpField = upFields[upFields.length - 1];
//                 const upExpression = await (
//                     await lastUpField.getProperty('value')
//                 ).jsonValue();

//                 expect(upExpression).toEqual("response.body.status === 'ok'");

//                 // for degraded criteria
//                 const degradedFields = await page.$$(
//                     `input[name*="degraded_"][name*=".field1"]`
//                 );
//                 const lastDegradedField =
//                     degradedFields[degradedFields.length - 1];
//                 const degradedExpression = await (
//                     await lastDegradedField.getProperty('value')
//                 ).jsonValue();
//                 expect(degradedExpression).toEqual(
//                     "response.body.message === 'draining'"
//                 );
//             });
//         },
//         operationTimeOut
//     );

//     test(
//         'should evaluate response (degraded criteria) in advance options',
//         async () => {
//             const testServer = async ({ page }) => {
//                 await page.goto(utils.HTTP_TEST_SERVER_URL + '/settings');
//                 await page.evaluate(
//                     () => (document.getElementById('responseTime').value = '')
//                 );
//                 await page.evaluate(
//                     () => (document.getElementById('body').value = '')
//                 );
//                 await page.waitForSelector('#responseTime');
//                 await page.click('input[name=responseTime]');
//                 await page.type('input[name=responseTime]', '5000');
//                 await page.waitForSelector('#body');
//                 await page.click('textarea[name=body]');
//                 await page.type(
//                     'textarea[name=body]',
//                     '{"message":"draining"}'
//                 );
//                 await page.click('button[type=submit]');
//                 await page.waitForSelector('#save-btn');
//                 await page.waitForSelector('#save-btn', { visible: true });
//             };

//             await cluster.execute(null, testServer);

//             return await cluster.execute(null, async ({ page }) => {
//                 await page.goto(utils.DASHBOARD_URL);                

//                  // Navigate to Monitor details
//                  await init.navigateToMonitorDetails(
//                     componentName,
//                     testMonitorName,
//                     page
//                 );                                           

//                 const probeTabs = await page.$$('button[id^=probes-btn]');
//                 for (const probeTab of probeTabs) {
//                     await probeTab.click();

//                     let monitorStatusElement = await page.$(
//                         `#monitor-status-${testMonitorName}`
//                     );
//                     if (monitorStatusElement) {
//                         monitorStatusElement = await monitorStatusElement.getProperty(
//                             'innerText'
//                         );
//                         monitorStatusElement = await monitorStatusElement.jsonValue();
//                         monitorStatusElement.should.be.exactly('Degraded');
//                     }
//                 }
//             });
//         },
//         operationTimeOut
//     );

//     test(
//         'should evaluate response (offline criteria) in advance options',
//         async () => {
//             const testServer = async ({ page }) => {
//                 await page.goto(utils.HTTP_TEST_SERVER_URL + '/settings');
//                 await page.evaluate(
//                     () => (document.getElementById('statusCode').value = '')
//                 );
//                 await page.evaluate(
//                     () => (document.getElementById('body').value = '')
//                 );
//                 await page.waitForSelector('#statusCode');
//                 await page.click('input[name=statusCode]');
//                 await page.type('input[name=statusCode]', '400');
//                 await page.waitForSelector('#body');
//                 await page.click('textarea[name=body]');
//                 await page.type('textarea[name=body]', '{"message":"offline"}');
//                 await page.click('button[type=submit]');
//                 await page.waitForSelector('#save-btn');
//                 await page.waitForSelector('#save-btn', { visible: true });
//             };

//             await cluster.execute(null, testServer);

//             return await cluster.execute(null, async ({ page }) => {
//                 await page.goto(utils.DASHBOARD_URL);
                
//                 // Navigate to Monitor details
//                 await init.navigateToMonitorDetails(
//                     componentName,
//                     testMonitorName,
//                     page
//                 );

//                 const probeTabs = await page.$$('button[id^=probes-btn]');
//                 for (const probeTab of probeTabs) {
//                     await probeTab.click();

//                     let monitorStatusElement = await page.$(
//                         `#monitor-status-${testMonitorName}`
//                     );
//                     if (monitorStatusElement) {
//                         monitorStatusElement = await monitorStatusElement.getProperty(
//                             'innerText'
//                         );
//                         monitorStatusElement = await monitorStatusElement.jsonValue();
//                         monitorStatusElement.should.be.exactly('Offline');
//                     }
//                 }
//             });
//         },
//         operationTimeOut
//     );

//     test('should display offline status if evaluate response does not match in criteria', async () => {
//         const testServer = async ({ page }) => {
//             await page.goto(utils.HTTP_TEST_SERVER_URL + '/settings');
//             await page.evaluate(
//                 () => (document.getElementById('responseTime').value = '')
//             );
//             await page.evaluate(
//                 () => (document.getElementById('statusCode').value = '')
//             );
//             await page.evaluate(
//                 () => (document.getElementById('body').value = '')
//             );
//             await page.waitForSelector('#responseTime');
//             await page.click('input[name=responseTime]');
//             await page.type('input[name=responseTime]', '0');
//             await page.waitForSelector('#statusCode');
//             await page.click('input[name=statusCode]');
//             await page.type('input[name=statusCode]', '200');
//             await page.waitForSelector('#body');
//             await page.click('textarea[name=body]');
//             await page.type('textarea[name=body]', '{"status":"not ok"}');
//             await page.click('button[type=submit]');
//             await page.waitForSelector('#save-btn');
//             await page.waitForSelector('#save-btn', { visible: true });
//         };

//         await cluster.execute(null, testServer);

//         return await cluster.execute(
//             null,
//             async ({ page }) => {
//                 await page.goto(utils.DASHBOARD_URL);
                
//                 // Navigate to Monitor details
//                 await init.navigateToMonitorDetails(
//                     componentName,
//                     testMonitorName,
//                     page
//                 );

//                 const probeTabs = await page.$$('button[id^=probes-btn]');
//                 for (const probeTab of probeTabs) {
//                     await probeTab.click();

//                     let monitorStatusElement = await page.$(
//                         `#monitor-status-${testMonitorName}`
//                     );
//                     if (monitorStatusElement) {
//                         monitorStatusElement = await monitorStatusElement.getProperty(
//                             'innerText'
//                         );
//                         monitorStatusElement = await monitorStatusElement.jsonValue();
//                         monitorStatusElement.should.be.exactly('Offline');
//                     }
//                 }
//             },
//             operationTimeOut
//         );
//     });

//     test(
//         'should show specific property, button and modal for evaluate response',
//         async () => {
//             return await cluster.execute(null, async ({ page }) => {
//                 // Navigate to Component details
//                 await init.navigateToComponentDetails(componentName, page);

//                 const newMonitorName = utils.generateRandomString();
//                 await init.addAPIMonitorWithJSExpression(page, newMonitorName, {
//                     createAlertForOnline: true,
//                 });

//                 // wait for a new incident is created
//                 await page.waitForSelector(`#incident_${newMonitorName}_0`, {
//                     timeout: 120 * 1000,
//                 });
//                 await Promise.all([
//                     page.$eval(`#incident_${newMonitorName}_0`, element =>
//                         element.click()
//                     ),
//                     page.waitForNavigation(),
//                 ]);

//                 let monitorIncidentReportElement = await page.waitForSelector(
//                     `#${newMonitorName}_IncidentReport_0`
//                 );
//                 monitorIncidentReportElement = await monitorIncidentReportElement.getProperty(
//                     'innerText'
//                 );
//                 monitorIncidentReportElement = await monitorIncidentReportElement.jsonValue();
//                 monitorIncidentReportElement.should.match(
//                     /.*Response {"status":"ok"} Did evaluate response.body.status === 'ok'.*/
//                 );

//                 await page.waitForSelector(`#${newMonitorName}_ShowResponse_0`);
//                 await page.click(`#${newMonitorName}_ShowResponse_0`);

//                 let monitorIncidentModalElement = await page.waitForSelector(
//                     '#API_Response'
//                 );
//                 monitorIncidentModalElement = await monitorIncidentModalElement.getProperty(
//                     'innerText'
//                 );
//                 monitorIncidentModalElement = await monitorIncidentModalElement.jsonValue();
//                 monitorIncidentModalElement.should.be.exactly('API Response');
//             });
//         },
//         operationTimeOut
//     );

//     test(
//         'should delete API monitors',
//         async () => {
//             expect.assertions(1);
//             return await cluster.execute(null, async ({ page }) => {

//                 // Navigate to Monitor details
//                 await init.navigateToMonitorDetails(
//                     componentName,
//                     testMonitorName,
//                     page
//                 );
//                 const deleteButtonSelector = `#delete_${testMonitorName}`;
//                 await page.waitForSelector(deleteButtonSelector);
//                 await page.$eval(deleteButtonSelector, e => e.click());

//                 const confirmDeleteButtonSelector = '#deleteMonitor';
//                 await page.waitForSelector(confirmDeleteButtonSelector);
//                 await page.click(confirmDeleteButtonSelector);
//                 await page.waitForSelector(confirmDeleteButtonSelector, {
//                     hidden: true,
//                 });

//                 const selector = `span#monitor-title-${testMonitorName}`;
//                 const spanElement = await page.$(selector);
//                 expect(spanElement).toBeNull();
//             });
//         },
//         operationTimeOut
//     );
// });
