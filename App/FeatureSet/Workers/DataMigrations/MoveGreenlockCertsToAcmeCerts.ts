import GreenlockCertificateService from 'CommonServer/Services/GreenlockCertificateService';
import DataMigrationBase from './DataMigrationBase';
import LIMIT_MAX from 'Common/Types/Database/LimitMax';
import StatusPageDomainService from 'CommonServer/Services/StatusPageDomainService';
import logger from 'CommonServer/Utils/Logger';
import GreenlockCertificate from 'Model/Models/GreenlockCertificate';
import StatusPageDomain from 'Model/Models/StatusPageDomain';

export default class MoveGreenlockCertsToAcmeCerts extends DataMigrationBase {
    public constructor() {
        super('MoveGreenlockCertsToAcmeCerts');
    }

    public override async migrate(): Promise<void> {
        const allDomains: Array<string> = [];

        // get all domains in greenlock certs.
        const greenlockCerts: GreenlockCertificate[] =
            await GreenlockCertificateService.findBy({
                query: {},
                select: {
                    key: true,
                },
                skip: 0,
                limit: LIMIT_MAX,
                props: {
                    isRoot: true,
                },
            });

        for (const greenlockCert of greenlockCerts) {
            if (!greenlockCert.key) {
                continue;
            }

            if (allDomains.includes(greenlockCert.key!)) {
                // this domain already exists in acme certs.
                continue;
            }

            allDomains.push(greenlockCert.key!);
        }

        // now order these domains

        for (const domain of allDomains) {
            // get status page domain.

            const statusPageDomain: StatusPageDomain | null =
                await StatusPageDomainService.findOneBy({
                    query: {
                        fullDomain: domain,
                    },
                    props: {
                        isRoot: true,
                    },
                    select: {
                        _id: true,
                    },
                });

            if (!statusPageDomain) {
                continue;
            }

            try {
                await StatusPageDomainService.orderCert(statusPageDomain);
            } catch (e) {
                logger.error(e);
            }
        }
    }

    public override async rollback(): Promise<void> {
        return;
    }
}
