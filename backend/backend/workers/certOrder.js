const greenlock = require('../../greenlock');
const ErrorService = require('../services/errorService');
const StatusPageService = require('../services/statusPageService');
const CertificateStoreService = require('../services/certificateStoreService');

async function handleFetchingDomains() {
    const domainsWithoutCert = [];

    const statusPages = await StatusPageService.findBy({
        'domains.enableHttps': { $eq: true },
        'domains.autoProvisioning': { $eq: true },
        'domains.domain': { $type: 'string' },
    });

    for (const statusPage of statusPages) {
        for (const domain of statusPage.domains) {
            if (
                domain.domain &&
                domain.domain.trim() &&
                domain.enableHttps &&
                domain.autoProvisioning
            ) {
                const cert = await CertificateStoreService.findOneBy({
                    subject: domain.domain,
                });
                if (!cert) {
                    domainsWithoutCert.push(domain.domain);
                }
            }
        }
    }

    return domainsWithoutCert;
}

module.exports = async function() {
    try {
        const domains = await handleFetchingDomains();
        for (const domain of domains) {
            await greenlock.add({
                subject: domain,
                altnames: [domain],
            });
        }
    } catch (error) {
        ErrorService.log('certOrder', error);
    }
};
