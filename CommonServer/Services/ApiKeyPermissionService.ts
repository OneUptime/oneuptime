import PostgresDatabase from '../Infrastructure/PostgresDatabase';
import CreateBy from '../Types/Database/CreateBy';
import { OnCreate } from '../Types/Database/Hooks';
import DatabaseService from './DatabaseService';
import BadDataException from 'Common/Types/Exception/BadDataException';
import Model from 'Model/Models/ApiKeyPermission';

export class Service extends DatabaseService<Model> {
    public constructor(postgresDatabase?: PostgresDatabase) {
        super(Model, postgresDatabase);
    }

    protected override async onBeforeCreate(
        createBy: CreateBy<Model>
    ): Promise<OnCreate<Model>> {
        if (!createBy.data.apiKeyId) {
            throw new BadDataException(
                'API Key ID is required to create permission'
            );
        }

        if (!createBy.data.projectId) {
            throw new BadDataException(
                'Project Id is required to create permission'
            );
        }

        if (!createBy.data.permission) {
            throw new BadDataException(
                'Permission is required to create permission'
            );
        }

        // check if this permission is already assigned to this team and if yes then throw error.

        const existingPermission: Model | null = await this.findOneBy({
            query: {
                apiKeyId: createBy.data.apiKeyId,
                projectId: createBy.data.projectId,
                permission: createBy.data.permission,
            },
            select: {
                _id: true,
            },
            props: {
                isRoot: true,
            },
        });

        if (existingPermission) {
            throw new BadDataException(
                'This permission is already assigned to this API Key'
            );
        }

        return { createBy, carryForward: null };
    }
}

export default new Service();
