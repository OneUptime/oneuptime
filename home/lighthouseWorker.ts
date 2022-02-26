// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'ligh... Remove this comment to see the full error message
import lighthouse from 'lighthouse'
import chromeLauncher from 'chrome-launcher'
import ora from 'ora'

/**
 * Adjustments needed for DevTools network throttling to simulate
 * more realistic network conditions.
 * @see https://crbug.com/721112
 * @see https://docs.google.com/document/d/10lfVdS1iDWCRKQXPfbxEn4Or99D64mvNlugP1AQuFlE/edit
 */
const DEVTOOLS_THROUGHPUT_ADJUSTMENT_FACTOR = 0.9;

const config = {
    extends: 'lighthouse:default',
    settings: {
        maxWaitForFcp: 15 * 1000,
        maxWaitForLoad: 35 * 1000,
        throttling: {
            rttMs: 40,
            throughputKbps: 10 * 1024,
            cpuSlowdownMultiplier: 1,
            requestLatencyMs: 0, // 0 means unset
            downloadThroughputKbps:
                1.6 * 1024 * DEVTOOLS_THROUGHPUT_ADJUSTMENT_FACTOR,
            uploadThroughputKbps: 750 * DEVTOOLS_THROUGHPUT_ADJUSTMENT_FACTOR,
        },
        skipAudits: ['uses-http2', 'is-on-https', 'largest-contentful-paint'],
        onlyCategories: [
            'performance',
            'accessibility',
            'best-practices',
            'seo',
        ],
    },
};

function launchChromeAndRunLighthouse(url: $TSFixMe, flags = {}, config = null) {
    return chromeLauncher.launch(flags).then(chrome => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'port' does not exist on type '{}'.
        flags.port = chrome.port;
        return lighthouse(url, flags, config).then((results: $TSFixMe) => {
            return chrome.kill().then(() => results);
        });
    });
}

const flags = {
    chromeFlags: ['--headless', '--no-sandbox'],
    emulatedFormFactor: 'desktop',
};

process.on('message', function(data) {
    if (data.mobile) flags.emulatedFormFactor = 'mobile';
    const scores = {};
    const spinner = ora(`Running lighthouse on ${data.url}`).start();
    spinner.color = 'green';
    // @ts-expect-error ts-migrate(2345) FIXME: Argument of type '{ extends: string; settings: { m... Remove this comment to see the full error message
    launchChromeAndRunLighthouse(data.url, flags, config)
        .then(results => {
            results.artifacts = 'ignore';
            results.reportGroups = 'ignore';
            results.timing = 'ignore';
            results.userAgent = 'ignore';
            results.lighthouseVersion = 'ignore';
            results.runWarnings = 'runWarnings';
            results.report = 'ignore';
            results.runtimeConfig = 'ignore';

            results.lhr.userAgent = 'ignore';
            results.lhr.environment = 'ignore';
            results.lhr.configSettings = 'ignore';
            results.lhr.metrics = 'ignore';
            results.lhr.audits = 'ignore';
            results.lhr.categoryGroups = 'ignore';

            // @ts-expect-error ts-migrate(2339) FIXME: Property 'performance' does not exist on type '{}'... Remove this comment to see the full error message
            scores.performance = Math.ceil(
                results.lhr.categories.performance.score * 100
            );
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'accessibility' does not exist on type '{... Remove this comment to see the full error message
            scores.accessibility = Math.ceil(
                results.lhr.categories.accessibility.score * 100
            );
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'bestPractices' does not exist on type '{... Remove this comment to see the full error message
            scores.bestPractices = Math.ceil(
                results.lhr.categories['best-practices'].score * 100
            );
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'seo' does not exist on type '{}'.
            scores.seo = Math.ceil(results.lhr.categories.seo.score * 100);
            if (
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'performance' does not exist on type '{}'... Remove this comment to see the full error message
                scores.performance < 50 ||
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'accessibility' does not exist on type '{... Remove this comment to see the full error message
                scores.accessibility < 70 ||
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'bestPractices' does not exist on type '{... Remove this comment to see the full error message
                scores.bestPractices < 70 ||
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'seo' does not exist on type '{}'.
                scores.seo < 80
            ) {
                spinner.fail();
            } else {
                spinner.succeed();
            }
            // @ts-expect-error ts-migrate(2722) FIXME: Cannot invoke an object which is possibly 'undefin... Remove this comment to see the full error message
            process.send(scores);
            return scores;
        })
        .catch(err => {
            // eslint-disable-next-line no-console
            console.log(err);
            process.exit(1);
        });
});
