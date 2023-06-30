import PostgresDatabase from '../Infrastructure/PostgresDatabase';
import Model from 'Model/Models/OnCallDutyPolicy';
import DatabaseService from './DatabaseService';
import ObjectID from 'Common/Types/ObjectID';

export class Service extends DatabaseService<Model> {
    public constructor(postgresDatabase?: PostgresDatabase) {
        super(Model, postgresDatabase);
    }

    public async executePolicy(policyId: ObjectID, options: {
        triggeredByIncidentId: ObjectID
    }): Promise<void> {
        
        // execute this policy

         
    }
}
export default new Service();
