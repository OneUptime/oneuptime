import PostgresDatabase from '../Infrastructure/PostgresDatabase';
import Model from 'Common/Models/Label';
import DatabaseService from './DatabaseService';
import CreateBy from '../Types/Database/CreateBy';
import QueryHelper from '../Types/Database/QueryHelper';
import BadDataException from 'Common/Types/Exception/BadDataException';
import ObjectID from 'Common/Types/ObjectID';

export class Service extends DatabaseService<Model> {
    public constructor(postgresDatabase?: PostgresDatabase) {
        super(Model, postgresDatabase);
    }

    protected override async onBeforeCreate(
        createBy: CreateBy<Model>
    ): Promise<CreateBy<Model>> {
        let existingProjectWithSameNameCount: number = 0;

        existingProjectWithSameNameCount = (
            await this.countBy({
                query: {
                    _id:
                        createBy.props.userGlobalAccessPermission?.projectIds.map(
                            (item: ObjectID) => {
                                return item.toString();
                            }
                        ) || [],
                    name: QueryHelper.findWithSameName(createBy.data.name!),
                    projectId: createBy.props.projectId!,
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

        return Promise.resolve(createBy);
    }
}
export default new Service();
