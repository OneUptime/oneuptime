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

export class Service extends DatabaseService<IncidentStateTimeline> {
    public constructor(postgresDatabase?: PostgresDatabase) {
        super(IncidentStateTimeline, postgresDatabase);
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

        await IncidentService.updateBy({
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
                },
                populate: {
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
                        const monitorStausTimeline: MonitorStatusTimeline =
                            new MonitorStatusTimeline();
                        monitorStausTimeline.monitorId = monitor.id!;
                        monitorStausTimeline.projectId = incident.projectId!;
                        monitorStausTimeline.monitorStatusId =
                            resolvedMonitorState.id!;

                        await MonitorStatusTimelineService.create({
                            data: monitorStausTimeline,
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
                await IncidentService.updateBy({
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
