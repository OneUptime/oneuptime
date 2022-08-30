import PostgresDatabase from '../Infrastructure/PostgresDatabase';
import Model from 'Model/Models/MonitorStatus';
import DatabaseService, { OnCreate, OnDelete, OnUpdate } from './DatabaseService';
import CreateBy from '../Types/Database/CreateBy';
import BadDataException from 'Common/Types/Exception/BadDataException';
import DeleteBy from '../Types/Database/DeleteBy';
import ObjectID from 'Common/Types/ObjectID';
import UpdateBy from '../Types/Database/UpdateBy';
import QueryHelper from '../Types/Database/QueryHelper';
import LIMIT_MAX from 'Common/Types/Database/LimitMax';
import SortOrder from 'Common/Types/Database/SortOrder';

export class Service extends DatabaseService<Model> {
    public constructor(postgresDatabase?: PostgresDatabase) {
        super(Model, postgresDatabase);
    }


    protected override async onBeforeCreate(
        createBy: CreateBy<Model>
    ): Promise<OnCreate<Model>> {
        if (!createBy.data.priority) {
            throw new BadDataException('Monitor Status priority is required');
        }

        if (!createBy.data.projectId) {
            throw new BadDataException('Monitor Status projectId is required');
        }

        await this.rearrangePriority(
            createBy.data.priority,
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
                '_id should be present when deleting Monitor Statuss. Please try the delete with objectId'
            );
        }

        let monitorStatus: Model | null = null;

        if (!deleteBy.props.isRoot) {
            monitorStatus = await this.findOneBy({
                query: deleteBy.query,
                props: {
                    isRoot: true,
                },
                select: {
                    priority: true,
                    projectId: true,
                },
            });
        }

        return {
            deleteBy,
            carryForward: monitorStatus,
        };
    }

    protected override async onDeleteSuccess(
        onDelete: OnDelete<Model>,
        _itemIdsBeforeDelete: ObjectID[]
    ): Promise<OnDelete<Model>> {
        const deleteBy: DeleteBy<Model> = onDelete.deleteBy;
        const monitorStatus: Model | null = onDelete.carryForward;

        if (!deleteBy.props.isRoot && monitorStatus) {
            if (
                monitorStatus &&
                monitorStatus.priority &&
                monitorStatus.projectId
            ) {
                await this.rearrangePriority(
                    monitorStatus.priority,
                    monitorStatus.projectId,
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
        if (updateBy.data.priority && !updateBy.props.isRoot) {
            throw new BadDataException(
                'Monitor Status priority should not be updated. Delete this monitor status and create a new state with the right priority.'
            );
        }

        return { updateBy, carryForward: null };
    }

    private async rearrangePriority(
        currentPriority: number,
        projectId: ObjectID,
        increasePriority: boolean = true
    ): Promise<void> {
        // get monitor status with this priority.
        const monitorStatuses: Array<Model> = await this.findBy({
            query: {
                priority: QueryHelper.greaterThanEqualTo(currentPriority),
                projectId: projectId,
            },
            limit: LIMIT_MAX,
            skip: 0,
            props: {
                isRoot: true,
            },
            select: {
                _id: true,
                priority: true,
            },
            sort: {
                priority: SortOrder.Ascending,
            },
        });

        let newPriority: number = currentPriority;

        for (const monitorStatus of monitorStatuses) {
            if (increasePriority) {
                newPriority = monitorStatus.priority! + 1;
            } else {
                newPriority = monitorStatus.priority! - 1;
            }

            await this.updateBy({
                query: {
                    _id: monitorStatus._id!,
                },
                data: {
                    priority: newPriority,
                },
                props: {
                    isRoot: true,
                },
            });
        }
    }
}
export default new Service();
