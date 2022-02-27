// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'ligh... Remove this comment to see the full error message
import lighthouse from 'lighthouse';
import chromeLauncher from 'chrome-launcher';
import ErrorService from './errorService';

function launchChromeAndRunLighthouse(
    url: $TSFixMe,
    options = { chromeFlags: ['--headless', '--disable-gpu', '--no-sandbox'] },
    config = null
) {
    return chromeLauncher.launch(options).then(chrome => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'port' does not exist on type '{ chromeFl... Remove this comment to see the full error message
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
                // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
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
            // @ts-expect-error ts-migrate(2722) FIXME: Cannot invoke an object which is possibly 'undefin... Remove this comment to see the full error message
            process.send(result);
        })
        .catch(error => {
            // @ts-expect-error ts-migrate(2722) FIXME: Cannot invoke an object which is possibly 'undefin... Remove this comment to see the full error message
            process.send({ data: { url }, error });
            ErrorService.log('launchChromeAndRunLighthouse', error);
        });
});
