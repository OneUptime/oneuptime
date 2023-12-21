import PostgresDatabase from '../Infrastructure/PostgresDatabase';
import Model, { ProductType } from 'Model/Models/UsageBilling';
import DatabaseService from './DatabaseService';
import ObjectID from 'Common/Types/ObjectID';
import { LIMIT_PER_PROJECT } from 'Common/Types/Database/LimitMax';

export class Service extends DatabaseService<Model> {
    

    public constructor(postgresDatabase?: PostgresDatabase) {
        super(Model, postgresDatabase);
    }

    public async getUnreportedUsageBilling(data: { projectId: ObjectID; productType: ProductType; }): Promise<Model[]> {
        return await this.findBy({
            query: {
                projectId: data.projectId,
                productType: data.productType,
                isReportedToBillingProvider: false
            },
            skip: 0, 
            limit: LIMIT_PER_PROJECT,
            select: {
                _id: true,
                usageCount: true,
            },
            props: {
                isRoot: true,
            },
        });
    }
}

export default new Service();
