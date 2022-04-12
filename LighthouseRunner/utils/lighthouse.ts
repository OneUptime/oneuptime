import lighthouse from 'lighthouse';
import chromeLauncher from 'chrome-launcher';

function launchChromeAndRunLighthouse(
    url: URL,
    options = { chromeFlags: ['--headless', '--disable-gpu', '--no-sandbox'] },
    config = null
): void {
    return chromeLauncher.launch(options).then(chrome => {
        options.port = chrome.port;
        return lighthouse(url, options, config).then((results: $TSFixMe) => {
            return chrome.kill().then(() => results.lhr);
        });
    });
}

process.on('message', url => {
    launchChromeAndRunLighthouse(url)
        .then(results => {
            const issues = {};
            const categories = results.categories;
            const audits = results.audits;
            for (const category in categories) {
                const ids = categories[category].auditRefs.map(
                    (auditRef: $TSFixMe) => auditRef.id
                );

                issues[category] = ids
                    .map((id: $TSFixMe) =>
                        audits[id] &&
                        audits[id].score !== null &&
                        audits[id].score < 1
                            ? audits[id]
                            : id
                    )
                    .filter((id: $TSFixMe) => typeof id !== 'string');
            }

            const result = {
                lighthouseData: { url, issues },
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

            process.send(result);
        })
        .catch(error => {
            process.send({ data: { url }, error });
        });
});
