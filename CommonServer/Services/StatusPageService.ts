import PostgresDatabase from '../Infrastructure/PostgresDatabase';
import DatabaseService from './DatabaseService';
import DatabaseCommonInteractionProps from 'Common/Types/Database/DatabaseCommonInteractionProps';
import ObjectID from 'Common/Types/ObjectID';
import PositiveNumber from 'Common/Types/PositiveNumber';
import StatusPage from 'Model/Models/StatusPage';

export class Service extends DatabaseService<StatusPage> {
    public constructor(postgresDatabase?: PostgresDatabase) {
        super(StatusPage, postgresDatabase);
    }

    public async hasReadAccess(
        statusPageId: ObjectID,
        props: DatabaseCommonInteractionProps
    ): Promise<boolean> {
        const count: PositiveNumber = await this.countBy({
            query: {
                _id: statusPageId.toString(),
                isPublicStatusPage: true,
            },
            skip: 0,
            limit: 1,
            props: {
                isRoot: true,
            },
        });

        if (count.positiveNumber > 0) {
            return true;
        }

        // if it does not have public access, check if this user has access.

        const items: Array<StatusPage> = await this.findBy({
            query: {
                _id: statusPageId.toString(),
            },
            select: {
                _id: true,
            },
            skip: 0,
            limit: 1,
            props: props,
        });

        if (items.length > 0) {
            return true;
        }

        return false;
    }
}
export default new Service();
