import PostgresDatabase from '../Infrastructure/PostgresDatabase';
import Model from 'Model/Models/Label';
import DatabaseService, { OnCreate } from './DatabaseService';
import CreateBy from '../Types/Database/CreateBy';
import QueryHelper from '../Types/Database/QueryHelper';
import BadDataException from 'Common/Types/Exception/BadDataException';

export class Service extends DatabaseService<Model> {
    public constructor(postgresDatabase?: PostgresDatabase) {
        super(Model, postgresDatabase);
    }

    protected override async onBeforeCreate(
        createBy: CreateBy<Model>
    ): Promise<OnCreate<Model>> {
        let existingProjectWithSameNameCount: number = 0;

        existingProjectWithSameNameCount = (
            await this.countBy({
                query: {
                    name: QueryHelper.findWithSameText(createBy.data.name!),
                    projectId: createBy.props.tenantId!,
                },
                props: {
                    isRoot: true,
                },
            })
        ).toNumber();

        if (existingProjectWithSameNameCount > 0) {
            throw new BadDataException(
                'Label with the same name already exists in this project.'
            );
        }

        return Promise.resolve({ createBy, carryForward: null });
    }
}
export default new Service();
