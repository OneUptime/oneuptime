import type PostgresDatabase from '../Infrastructure/PostgresDatabase';
import File from 'Model/Models/File';
import type { OnDelete, OnFind, OnUpdate } from './DatabaseService';
import DatabaseService from './DatabaseService';
import type FindBy from '../Types/Database/FindBy';
import type DeleteBy from '../Types/Database/DeleteBy';
import NotAuthorizedException from 'Common/Types/Exception/NotAuthorizedException';
import type UpdateBy from '../Types/Database/UpdateBy';

export class Service extends DatabaseService<File> {
    public constructor(postgresDatabase?: PostgresDatabase) {
        super(File, postgresDatabase);
    }

    protected override async onBeforeUpdate(
        updateBy: UpdateBy<File>
    ): Promise<OnUpdate<File>> {
        if (!updateBy.props.isRoot) {
            throw new NotAuthorizedException(
                'Not authorized to update a file.'
            );
        }

        return { updateBy, carryForward: null };
    }

    protected override async onBeforeDelete(
        deleteBy: DeleteBy<File>
    ): Promise<OnDelete<File>> {
        if (!deleteBy.props.isRoot) {
            throw new NotAuthorizedException(
                'Not authorized to delete a file.'
            );
        }

        return { deleteBy, carryForward: null };
    }

    protected override async onBeforeFind(
        findBy: FindBy<File>
    ): Promise<OnFind<File>> {
        if (!findBy.props.isRoot) {
            findBy.query = {
                ...findBy.query,
                isPublic: true,
            };
        }

        return { findBy, carryForward: null };
    }
}
export default new Service();
