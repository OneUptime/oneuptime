import type PostgresDatabase from '../Infrastructure/PostgresDatabase';
import Model from 'Model/Models/IncidentState';
import type { OnCreate, OnDelete, OnUpdate } from './DatabaseService';
import DatabaseService from './DatabaseService';
import type CreateBy from '../Types/Database/CreateBy';
import LIMIT_MAX from 'Common/Types/Database/LimitMax';
import type ObjectID from 'Common/Types/ObjectID';
import BadDataException from 'Common/Types/Exception/BadDataException';
import QueryHelper from '../Types/Database/QueryHelper';
import SortOrder from 'Common/Types/Database/SortOrder';
import type UpdateBy from '../Types/Database/UpdateBy';
import type DeleteBy from '../Types/Database/DeleteBy';

export class Service extends DatabaseService<Model> {
    public constructor(postgresDatabase?: PostgresDatabase) {
        super(Model, postgresDatabase);
    }

    protected override async onBeforeCreate(
        createBy: CreateBy<Model>
    ): Promise<OnCreate<Model>> {
        if (!createBy.data.order) {
            throw new BadDataException('Incient State order is required');
        }

        if (!createBy.data.projectId) {
            throw new BadDataException('Incient State projectId is required');
        }

        await this.rearrangeOrder(
            createBy.data.order,
            createBy.data.projectId,
            true
        );

        return {
            createBy: createBy,
            carryForward: null,
        };
    }

    protected override async onBeforeDelete(
        deleteBy: DeleteBy<Model>
    ): Promise<OnDelete<Model>> {
        if (!deleteBy.query._id && !deleteBy.props.isRoot) {
            throw new BadDataException(
                '_id should be present when deleting incident states. Please try the delete with objectId'
            );
        }

        let incidentState: Model | null = null;

        if (!deleteBy.props.isRoot) {
            incidentState = await this.findOneBy({
                query: deleteBy.query,
                props: {
                    isRoot: true,
                },
                select: {
                    order: true,
                    projectId: true,
                },
            });
        }

        return {
            deleteBy,
            carryForward: incidentState,
        };
    }

    protected override async onDeleteSuccess(
        onDelete: OnDelete<Model>,
        _itemIdsBeforeDelete: ObjectID[]
    ): Promise<OnDelete<Model>> {
        const deleteBy: DeleteBy<Model> = onDelete.deleteBy;
        const incidentState: Model | null = onDelete.carryForward;

        if (!deleteBy.props.isRoot && incidentState) {
            if (
                incidentState &&
                incidentState.order &&
                incidentState.projectId
            ) {
                await this.rearrangeOrder(
                    incidentState.order,
                    incidentState.projectId,
                    false
                );
            }
        }

        return {
            deleteBy: deleteBy,
            carryForward: null,
        };
    }

    protected override async onBeforeUpdate(
        updateBy: UpdateBy<Model>
    ): Promise<OnUpdate<Model>> {
        if (updateBy.data.order && !updateBy.props.isRoot) {
            throw new BadDataException(
                'Incident State order should not be updated. Delete this incident state and create a new state with the right order.'
            );
        }

        return { updateBy, carryForward: null };
    }

    private async rearrangeOrder(
        currentOrder: number,
        projectId: ObjectID,
        increaseOrder: boolean = true
    ): Promise<void> {
        // get incident with this order.
        const incidentStates: Array<Model> = await this.findBy({
            query: {
                order: QueryHelper.greaterThanEqualTo(currentOrder),
                projectId: projectId,
            },
            limit: LIMIT_MAX,
            skip: 0,
            props: {
                isRoot: true,
            },
            select: {
                _id: true,
                order: true,
            },
            sort: {
                order: SortOrder.Ascending,
            },
        });

        let newOrder: number = currentOrder;

        for (const incidentState of incidentStates) {
            if (increaseOrder) {
                newOrder = incidentState.order! + 1;
            } else {
                newOrder = incidentState.order! - 1;
            }

            await this.updateBy({
                query: {
                    _id: incidentState._id!,
                },
                data: {
                    order: newOrder,
                },
                props: {
                    isRoot: true,
                },
            });
        }
    }
}
export default new Service();
