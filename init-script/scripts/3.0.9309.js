const { find, save } = require('../util/db');

const statusPageCollection = 'statuspages';
const siteManagerCollection = 'sitemanagers';

// run this script once
async function run() {
    const statusPages = await find(statusPageCollection, {
        deleted: false,
        'domains.enableHttps': true,
        'domains.autoProvisioning': true,
    });

    for (const statusPage of statusPages) {
        const domains = statusPage.domains
            .filter(
                domainObj => domainObj.enableHttps && domainObj.autoProvisioning
            )
            .map(domainObj => domainObj.domain);

        for (const domain of domains) {
            // default renewAt to 1
            // cert should be renewed within 24 hours
            await save(siteManagerCollection, {
                subject: domain,
                altnames: [domain],
                renewAt: 1,
            });
        }
    }

    return `Script ran for ${statusPages.length} status pages`;
}

module.exports = run;
