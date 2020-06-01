const lighthouse = require('lighthouse');
const chromeLauncher = require('chrome-launcher');
const ErrorService = require('./errorService');

function launchChromeAndRunLighthouse(
    url,
    options = { chromeFlags: ['--headless', '--disable-gpu', '--no-sandbox'] },
    config = null
) {
    return chromeLauncher.launch(options).then(chrome => {
        options.port = chrome.port;
        return lighthouse(url, options, config).then(results => {
            return chrome.kill().then(() => results.lhr);
        });
    });
}

process.on('message', url => {
    launchChromeAndRunLighthouse(url)
        .then(results => {
            const scores = {
                performance: Math.ceil(
                    results.categories.performance.score * 100
                ),
                accessibility: Math.ceil(
                    results.categories.accessibility.score * 100
                ),
                bestPractices: Math.ceil(
                    results.categories['best-practices'].score * 100
                ),
                seo: Math.ceil(results.categories.seo.score * 100),
                pwa: Math.ceil(results.categories.pwa.score * 100),
            };
            process.send(scores);
        })
        .catch(error => {
            ErrorService.log('launchChromeAndRunLighthouse', error);
        });
});
