import PostgresDatabase from '../Infrastructure/PostgresDatabase';
import DatabaseService, { OnCreate, OnDelete } from './DatabaseService';
import MonitorService from './MonitorService';
import BadDataException from 'Common/Types/Exception/BadDataException';
import DeleteBy from '../Types/Database/DeleteBy';
import MonitorStatusTimeline from 'Model/Models/MonitorStatusTimeline';
import ObjectID from 'Common/Types/ObjectID';
import SortOrder from 'Common/Types/Database/SortOrder';
import PositiveNumber from 'Common/Types/PositiveNumber';

export class Service extends DatabaseService<MonitorStatusTimeline> {
    public constructor(postgresDatabase?: PostgresDatabase) {
        super(MonitorStatusTimeline, postgresDatabase);
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

        await MonitorService.updateBy({
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
            const monitorId = onDelete.carryForward as ObjectID;

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
                await MonitorService.updateBy({
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
