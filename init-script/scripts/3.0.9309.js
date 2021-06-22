const { find, save } = require('../util/db');
const moment = require('moment');

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
        const currentDate = new Date(moment().format());
        const domainsToSave = statusPage.domains
            .filter(
                domainObj =>
                    domainObj.enableHttps &&
                    domainObj.autoProvisioning &&
                    domainObj.domain
            )
            .map(domainObj => ({
                subject: domainObj.domain,
                altnames: [domainObj.domain],
                renewAt: 1,
                createdAt: currentDate,
                updatedAt: currentDate,
            }));

        // default renewAt to 1
        // cert should be renewed within 24 hours
        await save(siteManagerCollection, domainsToSave);
    }

    return `Script ran for ${statusPages.length} status pages`;
}

module.exports = run;
