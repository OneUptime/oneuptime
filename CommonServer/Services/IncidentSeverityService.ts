import PostgresDatabase from '../Infrastructure/PostgresDatabase';
import Model from 'Model/Models/IncidentSeverity';
import DatabaseService, {
    OnCreate,
    OnDelete,
    OnUpdate,
} from './DatabaseService';
import CreateBy from '../Types/Database/CreateBy';
import LIMIT_MAX from 'Common/Types/Database/LimitMax';
import ObjectID from 'Common/Types/ObjectID';
import BadDataException from 'Common/Types/Exception/BadDataException';
import QueryHelper from '../Types/Database/QueryHelper';
import SortOrder from 'Common/Types/Database/SortOrder';
import UpdateBy from '../Types/Database/UpdateBy';
import DeleteBy from '../Types/Database/DeleteBy';

export class Service extends DatabaseService<Model> {
    public constructor(postgresDatabase?: PostgresDatabase) {
        super(Model, postgresDatabase);
    }

    protected override async onBeforeCreate(
        createBy: CreateBy<Model>
    ): Promise<OnCreate<Model>> {
        if (!createBy.data.order) {
            throw new BadDataException('Incident severity order is required');
        }

        if (!createBy.data.projectId) {
            throw new BadDataException(
                'Incident severity projectId is required'
            );
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

        let incidentSeverity: Model | null = null;

        if (!deleteBy.props.isRoot) {
            incidentSeverity = await this.findOneBy({
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
            carryForward: incidentSeverity,
        };
    }

    protected override async onDeleteSuccess(
        onDelete: OnDelete<Model>,
        _itemIdsBeforeDelete: ObjectID[]
    ): Promise<OnDelete<Model>> {
        const deleteBy: DeleteBy<Model> = onDelete.deleteBy;
        const incidentSeverity: Model | null = onDelete.carryForward;

        if (!deleteBy.props.isRoot && incidentSeverity) {
            if (
                incidentSeverity &&
                incidentSeverity.order &&
                incidentSeverity.projectId
            ) {
                await this.rearrangeOrder(
                    incidentSeverity.order,
                    incidentSeverity.projectId,
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
                'Incident Severity order should not be updated. Delete this incident state and create a new state with the right order.'
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
        const incidentSeverities: Array<Model> = await this.findBy({
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

        for (const incidentSeverity of incidentSeverities) {
            if (increaseOrder) {
                newOrder = incidentSeverity.order! + 1;
            } else {
                newOrder = incidentSeverity.order! - 1;
            }

            await this.updateOneBy({
                query: {
                    _id: incidentSeverity._id!,
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
