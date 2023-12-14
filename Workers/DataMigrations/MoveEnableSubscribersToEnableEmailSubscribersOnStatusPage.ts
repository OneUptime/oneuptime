import DataMigrationBase from './DataMigrationBase';
import LIMIT_MAX from 'Common/Types/Database/LimitMax';
import StatusPage from 'Model/Models/StatusPage';
import StatusPageService from 'CommonServer/Services/StatusPageService';

export default class MoveEnableSubscribersToEnableEmailSubscribersOnStatusPage extends DataMigrationBase {
    public constructor() {
        super('AddPostedAtToPublicNotes');
    }

    public override async migrate(): Promise<void> {
        // get all the users with email isVerified true.

        const tempStatusPage = new StatusPage();

        if(!tempStatusPage.getTableColumnMetadata("enableSubscribers")){
            // this column does not exist, so we can skip this migration.
            return; 
        }

        const statusPages: Array<StatusPage> =
            await StatusPageService.findBy({
                query: {},
                select: {
                    _id: true,
                    enableSubscribers: true,
                },
                skip: 0,
                limit: LIMIT_MAX,
                props: {
                    isRoot: true,
                },
            });

        for (const statusPage of statusPages) {
            await StatusPageService.updateOneById({
                id: statusPage.id!,
                data: {
                    enableEmailSubscribers: statusPage.enableSubscribers!,
                },
                props: {
                    isRoot: true,
                },
            });
        }

    }

    public override async rollback(): Promise<void> {
        return;
    }
}
