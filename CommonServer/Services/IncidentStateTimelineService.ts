import PostgresDatabase from '../Infrastructure/PostgresDatabase';
import IncidentStateTimeline from 'Model/Models/IncidentStateTimeline';
import DatabaseService, { OnCreate, OnDelete } from './DatabaseService';
import BadDataException from 'Common/Types/Exception/BadDataException';
import IncidentService from './IncidentService';
import DeleteBy from '../Types/Database/DeleteBy';
import ObjectID from 'Common/Types/ObjectID';
import PositiveNumber from 'Common/Types/PositiveNumber';
import SortOrder from 'Common/Types/Database/SortOrder';
import IncidentState from 'Model/Models/IncidentState';
import IncidentStateService from './IncidentStateService';
import Incident from 'Model/Models/Incident';
import MonitorStatusService from './MonitorStatusService';
import MonitorStatus from 'Model/Models/MonitorStatus';
import MonitorStatusTimeline from 'Model/Models/MonitorStatusTimeline';
import MonitorStatusTimelineService from './MonitorStatusTimelineService';
import CreateBy from '../Types/Database/CreateBy';
import UserService from './UserService';
import User from 'Model/Models/User';

export class Service extends DatabaseService<IncidentStateTimeline> {
    public constructor(postgresDatabase?: PostgresDatabase) {
        super(IncidentStateTimeline, postgresDatabase);
    }

    public async getResolvedStateIdForProject(projectId: ObjectID): Promise<ObjectID> {
        const resolvedState: IncidentState | null =
            await IncidentStateService.findOneBy({
                query: {
                    projectId: projectId,
                    isResolvedState: true,
                },
                props: {
                    isRoot: true,
                },
                select: {
                    _id: true,
                },
            });

        if (!resolvedState) {
            throw new BadDataException(
                'No resolved state found for the project'
            );
        }

        return resolvedState.id!;
    }

    protected override async onBeforeCreate(
        createBy: CreateBy<MonitorStatusTimeline>
    ): Promise<OnCreate<MonitorStatusTimeline>> {
        if (
            (createBy.data.createdByUserId ||
                createBy.data.createdByUser ||
                createBy.props.userId) &&
            !createBy.data.rootCause
        ) {
            let userId: ObjectID | undefined = createBy.data.createdByUserId;

            if (createBy.props.userId) {
                userId = createBy.props.userId;
            }

            if (createBy.data.createdByUser && createBy.data.createdByUser.id) {
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
                createBy.data.rootCause = `Incident state created by ${user.name} (${user.email})`;
            }
        }

        return { createBy, carryForward: null };
    }

    protected override async onCreateSuccess(
        onCreate: OnCreate<IncidentStateTimeline>,
        createdItem: IncidentStateTimeline
    ): Promise<IncidentStateTimeline> {
        if (!createdItem.incidentId) {
            throw new BadDataException('incidentId is null');
        }

        if (!createdItem.incidentStateId) {
            throw new BadDataException('incidentStateId is null');
        }

        await IncidentService.updateOneBy({
            query: {
                _id: createdItem.incidentId?.toString(),
            },
            data: {
                currentIncidentStateId: createdItem.incidentStateId,
            },
            props: onCreate.createBy.props,
        });

        // TODO: DELETE THIS WHEN WORKFLOW IS IMPLEMENMTED.
        // check if this is resolved state, and if it is then resolve all the monitors.

        const isResolvedState: IncidentState | null =
            await IncidentStateService.findOneBy({
                query: {
                    _id: createdItem.incidentStateId.toString()!,
                    isResolvedState: true,
                },
                props: {
                    isRoot: true,
                },
                select: {
                    _id: true,
                },
            });

        if (isResolvedState) {
            // resolve all the monitors.
            const incident: Incident | null = await IncidentService.findOneBy({
                query: {
                    _id: createdItem.incidentId?.toString(),
                },
                select: {
                    _id: true,
                    projectId: true,
                    monitors: {
                        _id: true,
                    },
                },
                props: {
                    isRoot: true,
                },
            });

            if (incident && incident.monitors && incident.monitors.length > 0) {
                // get resolved monitor state.
                const resolvedMonitorState: MonitorStatus | null =
                    await MonitorStatusService.findOneBy({
                        query: {
                            projectId: incident.projectId!,
                            isOperationalState: true,
                        },
                        props: {
                            isRoot: true,
                        },
                        select: {
                            _id: true,
                        },
                    });

                if (resolvedMonitorState) {
                    for (const monitor of incident.monitors) {
                        const monitorStatusTimeline: MonitorStatusTimeline =
                            new MonitorStatusTimeline();
                        monitorStatusTimeline.monitorId = monitor.id!;
                        monitorStatusTimeline.projectId = incident.projectId!;
                        monitorStatusTimeline.monitorStatusId =
                            resolvedMonitorState.id!;

                        await MonitorStatusTimelineService.create({
                            data: monitorStatusTimeline,
                            props: {
                                isRoot: true,
                            },
                        });
                    }
                }
            }
        }

        return createdItem;
    }

    protected override async onBeforeDelete(
        deleteBy: DeleteBy<IncidentStateTimeline>
    ): Promise<OnDelete<IncidentStateTimeline>> {
        if (deleteBy.query._id) {
            const incidentStateTimeline: IncidentStateTimeline | null =
                await this.findOneById({
                    id: new ObjectID(deleteBy.query._id as string),
                    select: {
                        incidentId: true,
                    },
                    props: {
                        isRoot: true,
                    },
                });

            const incidentId: ObjectID | undefined =
                incidentStateTimeline?.incidentId;

            if (incidentId) {
                const incidentStateTimeline: PositiveNumber =
                    await this.countBy({
                        query: {
                            incidentId: incidentId,
                        },
                        props: {
                            isRoot: true,
                        },
                    });

                if (incidentStateTimeline.isOne()) {
                    throw new BadDataException(
                        'Cannot delete the only state timeline. Incident should have atleast one state in its timeline.'
                    );
                }
            }

            return { deleteBy, carryForward: incidentId };
        }

        return { deleteBy, carryForward: null };
    }

    protected override async onDeleteSuccess(
        onDelete: OnDelete<IncidentStateTimeline>,
        _itemIdsBeforeDelete: ObjectID[]
    ): Promise<OnDelete<IncidentStateTimeline>> {
        if (onDelete.carryForward) {
            // this is incidentId.
            const incidentId: ObjectID = onDelete.carryForward as ObjectID;

            // get last status of this monitor.
            const incidentStateTimeline: IncidentStateTimeline | null =
                await this.findOneBy({
                    query: {
                        incidentId: incidentId,
                    },
                    sort: {
                        createdAt: SortOrder.Descending,
                    },
                    props: {
                        isRoot: true,
                    },
                    select: {
                        _id: true,
                        incidentStateId: true,
                    },
                });

            if (
                incidentStateTimeline &&
                incidentStateTimeline.incidentStateId
            ) {
                await IncidentService.updateOneBy({
                    query: {
                        _id: incidentId.toString(),
                    },
                    data: {
                        currentIncidentStateId:
                            incidentStateTimeline.incidentStateId,
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
