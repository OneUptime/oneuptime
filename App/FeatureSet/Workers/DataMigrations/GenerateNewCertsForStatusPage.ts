import DataMigrationBase from './DataMigrationBase';
import LIMIT_MAX from 'Common/Types/Database/LimitMax';
import StatusPageDomainService from 'CommonServer/Services/StatusPageDomainService';
import logger from 'CommonServer/Utils/Logger';
import StatusPageDomain from 'Model/Models/StatusPageDomain';

export default class GenerateNewCertsForStatusPage extends DataMigrationBase {
    public constructor() {
        super('GenerateNewCertsForStatusPage');
    }

    public override async migrate(): Promise<void> {
        // get all domains in greenlock certs.
        const statusPageDomains: Array<StatusPageDomain> =
            await StatusPageDomainService.findBy({
                query: {},
                props: {
                    isRoot: true,
                },
                limit: LIMIT_MAX,
                skip: 0,
                select: {
                    _id: true,
                },
            });

        // now order these domains

        for (const statusPageDomain of statusPageDomains) {
            // get status page domain.

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
