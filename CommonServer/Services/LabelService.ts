import PostgresDatabase from '../Infrastructure/PostgresDatabase';
import Model from 'Common/Models/Label';
import DatabaseService from './DatabaseService';
import CreateBy from '../Types/Database/CreateBy';

export class Service extends DatabaseService<Model> {
    public constructor(postgresDatabase?: PostgresDatabase) {
        super(Model, postgresDatabase);
    }


    protected override async onBeforeCreate(createBy: CreateBy<Model>): Promise<CreateBy<Model>> {
        if (createBy.props.projectId) {
            createBy.data.projectId = createBy.props.projectId;
        }

        return createBy;
    }
}
export default new Service();
