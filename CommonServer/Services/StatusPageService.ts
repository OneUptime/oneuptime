import PostgresDatabase from '../Infrastructure/PostgresDatabase';
import Model from 'Model/Models/StatusPage';
import DatabaseService from './DatabaseService';
import DatabaseCommonInteractionProps from 'Common/Types/Database/DatabaseCommonInteractionProps';
import ObjectID from 'Common/Types/ObjectID';

export class Service extends DatabaseService<Model> {
    public constructor(postgresDatabase?: PostgresDatabase) {
        super(Model, postgresDatabase);
    }

    public async hasReadAccess(statusPageId: ObjectID, props: DatabaseCommonInteractionProps): Promise<boolean> {


        const count = await this.countBy({
            query: {
                _id: statusPageId.toString(),
                isPublicStatusPage: true,
            },
            skip: 0,
            limit: 1,
            props: {
                isRoot: true
            }

        })

        if (count.positiveNumber > 0) {
            return true;
        }

        // if it does not have public access, check if this user has access. 

        const items = await this.findBy({
            query: {
                _id: statusPageId.toString(),
            },
            select: {
                _id: true,
            },
            skip: 0, limit: 1, props: props
        });

        if (items.length > 0) {
            return true;
        }

        return false;

    }
}
export default new Service();
