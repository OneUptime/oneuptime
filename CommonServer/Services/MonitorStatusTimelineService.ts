import PostgresDatabase from '../Infrastructure/PostgresDatabase';
import DatabaseService, { OnCreate, OnDelete } from './DatabaseService';
import MonitorService from './MonitorService';
import BadDataException from 'Common/Types/Exception/BadDataException';
import DeleteBy from '../Types/Database/DeleteBy';
import MonitorStatusTimeline from 'Model/Models/MonitorStatusTimeline';
import ObjectID from 'Common/Types/ObjectID';
import SortOrder from 'Common/Types/Database/SortOrder';
import PositiveNumber from 'Common/Types/PositiveNumber';
import CreateBy from '../Types/Database/CreateBy';
import UserService from './UserService';
import User from 'Model/Models/User';

export class Service extends DatabaseService<MonitorStatusTimeline> {
    public constructor(postgresDatabase?: PostgresDatabase) {
        super(MonitorStatusTimeline, postgresDatabase);
    }

    protected override async onBeforeCreate(createBy: CreateBy<MonitorStatusTimeline>): Promise<OnCreate<MonitorStatusTimeline>> {
        if (
            (createBy.data.createdByUserId || createBy.data.createdByUser || createBy.props.userId) &&
            !createBy.data.rootCause
        ) {

            let userId = createBy.data.createdByUserId;

            if(createBy.props.userId){
                userId = createBy.props.userId;
            }

            if(createBy.data.createdByUser && createBy.data.createdByUser.id){
                userId = createBy.data.createdByUser.id;
            }

            const user: User | null = await UserService.findOneBy({
                query: {
                    _id: userId?.toString()!,
                },
                select: {
                    _id: true,
                    name: true,
                    email: true,
                },
                props: {
                    isRoot: true,
                },
            });

            if (user) {
                createBy.data.rootCause = `Monitor status created by ${user.name} (${user.email})`;
            }
        }

        return {createBy, carryForward: null};
    }

    protected override async onCreateSuccess(
        onCreate: OnCreate<MonitorStatusTimeline>,
        createdItem: MonitorStatusTimeline
    ): Promise<MonitorStatusTimeline> {
        if (!createdItem.monitorId) {
            throw new BadDataException('monitorId is null');
        }

        if (!createdItem.monitorStatusId) {
            throw new BadDataException('monitorStatusId is null');
        }

        await MonitorService.updateOneBy({
            query: {
                _id: createdItem.monitorId?.toString(),
            },
            data: {
                currentMonitorStatusId: createdItem.monitorStatusId,
            },
            props: onCreate.createBy.props,
        });

        return createdItem;
    }

    protected override async onBeforeDelete(
        deleteBy: DeleteBy<MonitorStatusTimeline>
    ): Promise<OnDelete<MonitorStatusTimeline>> {
        if (deleteBy.query._id) {
            const monitorStatusTimeline: MonitorStatusTimeline | null =
                await this.findOneById({
                    id: new ObjectID(deleteBy.query._id as string),
                    select: {
                        monitorId: true,
                    },
                    props: {
                        isRoot: true,
                    },
                });

            const monitorId: ObjectID | undefined =
                monitorStatusTimeline?.monitorId;

            if (monitorId) {
                const monitorStatusTimeline: PositiveNumber =
                    await this.countBy({
                        query: {
                            monitorId: monitorId,
                        },
                        props: {
                            isRoot: true,
                        },
                    });

                if (monitorStatusTimeline.isOne()) {
                    throw new BadDataException(
                        'Cannot delete the only status timeline. Monitor should have atleast one status timeline.'
                    );
                }
            }

            return { deleteBy, carryForward: monitorId };
        }

        return { deleteBy, carryForward: null };
    }

    protected override async onDeleteSuccess(
        onDelete: OnDelete<MonitorStatusTimeline>,
        _itemIdsBeforeDelete: ObjectID[]
    ): Promise<OnDelete<MonitorStatusTimeline>> {
        if (onDelete.carryForward) {
            // this is monitorId.
            const monitorId: ObjectID = onDelete.carryForward as ObjectID;

            // get last status of this monitor.
            const monitorStatusTimeline: MonitorStatusTimeline | null =
                await this.findOneBy({
                    query: {
                        monitorId: monitorId,
                    },
                    sort: {
                        createdAt: SortOrder.Descending,
                    },
                    props: {
                        isRoot: true,
                    },
                    select: {
                        _id: true,
                        monitorStatusId: true,
                    },
                });

            if (
                monitorStatusTimeline &&
                monitorStatusTimeline.monitorStatusId
            ) {
                await MonitorService.updateOneBy({
                    query: {
                        _id: monitorId.toString(),
                    },
                    data: {
                        currentMonitorStatusId:
                            monitorStatusTimeline.monitorStatusId,
                    },
                    props: {
                        isRoot: true,
                    },
                });
            }
        }

        return onDelete;
    }
}

export default new Service();
