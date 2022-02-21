const ErrorService = require('../../../common-server/utils/error');
const StatusPageService = require('../services/statusPageService');
const CertificateStoreService = require('../services/certificateStoreService');

async function handleFetchingDomains() {
    const domainsWithoutCert = [];

    const statusPages = await StatusPageService.findBy({
        query: {
            'domains.enableHttps': { $eq: true },
            'domains.autoProvisioning': { $eq: true },
            'domains.domain': { $type: 'string' },
        },
        skip: 0,
        limit: 99999,
        select: 'domains',
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
                    query: { subject: domain.domain },
                    select: 'id',
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
        const greenlock = global.greenlock;
        if (greenlock) {
            for (const domain of domains) {
                await greenlock.add({
                    subject: domain,
                    altnames: [domain],
                });
            }
        }
    } catch (error) {
        ErrorService.log('certOrder', error);
    }
};
