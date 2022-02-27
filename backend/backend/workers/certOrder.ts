import ErrorService from 'common-server/utils/error';
import StatusPageService from '../services/statusPageService';
import CertificateStoreService from '../services/certificateStoreService';

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

    // @ts-expect-error ts-migrate(2488) FIXME: Type '{}' must have a '[Symbol.iterator]()' method... Remove this comment to see the full error message
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

export default async function() {
    try {
        const domains = await handleFetchingDomains();
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'greenlock' does not exist on type 'Globa... Remove this comment to see the full error message
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
}
