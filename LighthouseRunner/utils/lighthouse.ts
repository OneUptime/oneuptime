import lighthouse from 'lighthouse';
import chromeLauncher from 'chrome-launcher';

function launchChromeAndRunLighthouse(
    url: URL,
    options = { chromeFlags: ['--headless', '--disable-gpu', '--no-sandbox'] },
    config = null
): void {
    return chromeLauncher.launch(options).then((chrome: $TSFixMe) => {
        options.port = chrome.port;
        return lighthouse(url, options, config).then((results: $TSFixMe) => {
            return chrome.kill().then(() => {
                return results.lhr;
            });
        });
    });
}

process.on('message', (url: $TSFixMe) => {
    launchChromeAndRunLighthouse(url)
        .then((results: $TSFixMe) => {
            const issues: $TSFixMe = {};
            const categories: $TSFixMe = results.categories;
            const audits: $TSFixMe = results.audits;
            for (const category in categories) {
                const ids: $TSFixMe = categories[category].auditRefs.map(
                    (auditRef: $TSFixMe) => {
                        return auditRef.id;
                    }
                );

                issues[category] = ids
                    .map((id: $TSFixMe) => {
                        return audits[id] &&
                            audits[id].score !== null &&
                            audits[id].score < 1
                            ? audits[id]
                            : id;
                    })
                    .filter((id: $TSFixMe) => {
                        return typeof id !== 'string';
                    });
            }

            const result: $TSFixMe = {
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
        .catch((error: Error) => {
            process.send({ data: { url }, error });
        });
});
