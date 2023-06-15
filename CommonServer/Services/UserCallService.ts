import PostgresDatabase from '../Infrastructure/PostgresDatabase';
import Model from 'Model/Models/UserCall';
import DatabaseService, { OnCreate } from './DatabaseService';
import CreateBy from '../Types/Database/CreateBy';
import ProjectService from './ProjectService';
import Project from 'Model/Models/Project';
import BadDataException from 'Common/Types/Exception/BadDataException';

export class Service extends DatabaseService<Model> {
    public constructor(postgresDatabase?: PostgresDatabase) {
        super(Model, postgresDatabase);
    }

    protected override async onBeforeCreate(
        createBy: CreateBy<Model>
    ): Promise<OnCreate<Model>> {
        // check if this project has SMS and Call mEnabled.

        const project: Project | null = await ProjectService.findOneById({
            id: createBy.data.projectId!,
            props: {
                isRoot: true,
            },
            select: {
                enableCallNotifications: true,
            },
        });

        if (!project) {
            throw new BadDataException('Project not found');
        }

        if (!project.enableSmsNotifications) {
            throw new BadDataException(
                'Call notifications are disabled for this project. Please enable them in Project Settings > Notification Settings.'
            );
        }

        return { carryForward: null, createBy };
    }
}
export default new Service();
