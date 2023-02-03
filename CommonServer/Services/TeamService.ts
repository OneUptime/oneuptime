import type PostgresDatabase from '../Infrastructure/PostgresDatabase';
import Model from 'Model/Models/Team';
import type { OnDelete, OnUpdate } from './DatabaseService';
import DatabaseService from './DatabaseService';
import type UpdateBy from '../Types/Database/UpdateBy';
import LIMIT_MAX from 'Common/Types/Database/LimitMax';
import BadDataException from 'Common/Types/Exception/BadDataException';
import type DeleteBy from '../Types/Database/DeleteBy';

export class Service extends DatabaseService<Model> {
    public constructor(postgresDatabase?: PostgresDatabase) {
        super(Model, postgresDatabase);
    }

    protected override async onBeforeUpdate(
        updateBy: UpdateBy<Model>
    ): Promise<OnUpdate<Model>> {
        // get teams by query.

        const teams: Array<Model> = await this.findBy({
            query: updateBy.query,
            limit: LIMIT_MAX,
            skip: 0,
            select: {
                name: true,
                isTeamEditable: true,
            },
            populate: {},
            props: updateBy.props,
        });

        for (const team of teams) {
            if (!team.isTeamEditable) {
                throw new BadDataException(
                    `${
                        team.name || 'This'
                    } team cannot be updated because its a critical team for this project.`
                );
            }
        }

        return { updateBy, carryForward: null };
    }

    protected override async onBeforeDelete(
        deleteBy: DeleteBy<Model>
    ): Promise<OnDelete<Model>> {
        const teams: Array<Model> = await this.findBy({
            query: deleteBy.query,
            limit: LIMIT_MAX,
            skip: 0,
            select: {
                name: true,
                isTeamDeleteable: true,
            },
            populate: {},
            props: deleteBy.props,
        });

        for (const team of teams) {
            if (!team.isTeamDeleteable) {
                throw new BadDataException(
                    `${
                        team.name || 'This'
                    } team cannot be deleted its a critical team for this project.`
                );
            }
        }

        return { deleteBy, carryForward: null };
    }
}
export default new Service();
