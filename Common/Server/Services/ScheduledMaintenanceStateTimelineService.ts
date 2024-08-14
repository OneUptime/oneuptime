import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import { OnCreate, OnDelete } from "../Types/Database/Hooks";
import QueryHelper from "../Types/Database/QueryHelper";
import DatabaseService from "./DatabaseService";
import MonitorService from "./MonitorService";
import MonitorStatusService from "./MonitorStatusService";
import MonitorStatusTimelineService from "./MonitorStatusTimelineService";
import ScheduledMaintenancePublicNoteService from "./ScheduledMaintenancePublicNoteService";
import ScheduledMaintenanceService from "./ScheduledMaintenanceService";
import ScheduledMaintenanceStateService from "./ScheduledMaintenanceStateService";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import OneUptimeDate from "../../Types/Date";
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import PositiveNumber from "../../Types/PositiveNumber";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import MonitorStatus from "Common/Models/DatabaseModels/MonitorStatus";
import MonitorStatusTimeline from "Common/Models/DatabaseModels/MonitorStatusTimeline";
import ScheduledMaintenance from "Common/Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenancePublicNote from "Common/Models/DatabaseModels/ScheduledMaintenancePublicNote";
import ScheduledMaintenanceState from "Common/Models/DatabaseModels/ScheduledMaintenanceState";
import ScheduledMaintenanceStateTimeline from "Common/Models/DatabaseModels/ScheduledMaintenanceStateTimeline";

export class Service extends DatabaseService<ScheduledMaintenanceStateTimeline> {
  public constructor() {
    super(ScheduledMaintenanceStateTimeline);
    this.hardDeleteItemsOlderThanInDays("createdAt", 120);
  }

  protected override async onBeforeCreate(
    createBy: CreateBy<ScheduledMaintenanceStateTimeline>,
  ): Promise<OnCreate<ScheduledMaintenanceStateTimeline>> {
    if (!createBy.data.scheduledMaintenanceId) {
      throw new BadDataException("scheduledMaintenanceId is null");
    }

    if (!createBy.data.startsAt) {
      createBy.data.startsAt = OneUptimeDate.getCurrentDate();
    }

    const lastScheduledMaintenanceStateTimeline: ScheduledMaintenanceStateTimeline | null =
      await this.findOneBy({
        query: {
          scheduledMaintenanceId: createBy.data.scheduledMaintenanceId,
        },
        sort: {
          createdAt: SortOrder.Descending,
        },
        props: {
          isRoot: true,
        },
        select: {
          _id: true,
        },
      });

    const publicNote: string | undefined = (
      createBy.miscDataProps as JSONObject | undefined
    )?.["publicNote"] as string | undefined;

    if (publicNote) {
      const scheduledMaintenancePublicNote: ScheduledMaintenancePublicNote =
        new ScheduledMaintenancePublicNote();
      scheduledMaintenancePublicNote.scheduledMaintenanceId =
        createBy.data.scheduledMaintenanceId;
      scheduledMaintenancePublicNote.note = publicNote;
      scheduledMaintenancePublicNote.postedAt = createBy.data.startsAt;
      scheduledMaintenancePublicNote.createdAt = createBy.data.startsAt;
      scheduledMaintenancePublicNote.projectId = createBy.data.projectId!;
      scheduledMaintenancePublicNote.shouldStatusPageSubscribersBeNotifiedOnNoteCreated =
        Boolean(createBy.data.shouldStatusPageSubscribersBeNotified);

      // mark status page subscribers as notified for this state change because we dont want to send duplicate (two) emails one for public note and one for state change.
      if (
        scheduledMaintenancePublicNote.shouldStatusPageSubscribersBeNotifiedOnNoteCreated
      ) {
        createBy.data.isStatusPageSubscribersNotified = true;
      }

      await ScheduledMaintenancePublicNoteService.create({
        data: scheduledMaintenancePublicNote,
        props: createBy.props,
      });
    }

    return {
      createBy,
      carryForward: {
        lastScheduledMaintenanceStateTimelineId:
          lastScheduledMaintenanceStateTimeline?.id || null,
      },
    };
  }

  protected override async onCreateSuccess(
    onCreate: OnCreate<ScheduledMaintenanceStateTimeline>,
    createdItem: ScheduledMaintenanceStateTimeline,
  ): Promise<ScheduledMaintenanceStateTimeline> {
    if (!createdItem.scheduledMaintenanceId) {
      throw new BadDataException("scheduledMaintenanceId is null");
    }

    if (!createdItem.scheduledMaintenanceStateId) {
      throw new BadDataException("scheduledMaintenanceStateId is null");
    }

    // update the last status as ended.

    if (onCreate.carryForward.lastScheduledMaintenanceStateTimelineId) {
      await this.updateOneById({
        id: onCreate.carryForward.lastScheduledMaintenanceStateTimelineId!,
        data: {
          endsAt: createdItem.createdAt || OneUptimeDate.getCurrentDate(),
        },
        props: {
          isRoot: true,
        },
      });
    }

    await ScheduledMaintenanceService.updateOneBy({
      query: {
        _id: createdItem.scheduledMaintenanceId?.toString(),
      },
      data: {
        currentScheduledMaintenanceStateId:
          createdItem.scheduledMaintenanceStateId,
      },
      props: {
        isRoot: true,
      },
    });

    // TODO: DELETE THIS WHEN WORKFLOW IS IMPLEMENMTED.
    // check if this is resolved state, and if it is then resolve all the monitors.

    const isResolvedState: ScheduledMaintenanceState | null =
      await ScheduledMaintenanceStateService.findOneBy({
        query: {
          _id: createdItem.scheduledMaintenanceStateId.toString()!,
          isResolvedState: true,
        },
        props: {
          isRoot: true,
        },
        select: {
          _id: true,
        },
      });

    const isEndedState: ScheduledMaintenanceState | null =
      await ScheduledMaintenanceStateService.findOneBy({
        query: {
          _id: createdItem.scheduledMaintenanceStateId.toString()!,
          isEndedState: true,
        },
        props: {
          isRoot: true,
        },
        select: {
          _id: true,
        },
      });

    const isOngoingState: ScheduledMaintenanceState | null =
      await ScheduledMaintenanceStateService.findOneBy({
        query: {
          _id: createdItem.scheduledMaintenanceStateId.toString()!,
          isOngoingState: true,
        },
        props: {
          isRoot: true,
        },
        select: {
          _id: true,
        },
      });

    const scheduledMaintenanceEvent: ScheduledMaintenance | null =
      await ScheduledMaintenanceService.findOneBy({
        query: {
          _id: createdItem.scheduledMaintenanceId?.toString(),
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

    if (isOngoingState) {
      if (
        scheduledMaintenanceEvent &&
        scheduledMaintenanceEvent.monitors &&
        scheduledMaintenanceEvent.monitors.length > 0
      ) {
        for (const monitor of scheduledMaintenanceEvent.monitors) {
          await MonitorService.updateOneById({
            id: monitor.id!,
            data: {
              disableActiveMonitoringBecauseOfScheduledMaintenanceEvent: true, /// This will stop active monitoring.
            },
            props: {
              isRoot: true,
            },
          });
        }
      }
    }

    if (isResolvedState || isEndedState) {
      // resolve all the monitors.
      await this.enableActiveMonitoringForMonitors(scheduledMaintenanceEvent!);
    }

    return createdItem;
  }

  public async enableActiveMonitoringForMonitors(
    scheduledMaintenanceEvent: ScheduledMaintenance,
  ): Promise<void> {
    if (
      scheduledMaintenanceEvent &&
      scheduledMaintenanceEvent.monitors &&
      scheduledMaintenanceEvent.monitors.length > 0
    ) {
      // get resolved monitor state.
      const resolvedMonitorState: MonitorStatus | null =
        await MonitorStatusService.findOneBy({
          query: {
            projectId: scheduledMaintenanceEvent.projectId!,
            isOperationalState: true,
          },
          props: {
            isRoot: true,
          },
          select: {
            _id: true,
          },
        });

      // check if this monitor is not in this status already.

      if (resolvedMonitorState) {
        for (const monitor of scheduledMaintenanceEvent.monitors) {
          // check if the monitor is not in this status already.

          const dbMonitor: Monitor | null = await MonitorService.findOneById({
            id: monitor.id!,
            select: {
              currentMonitorStatusId: true,
            },
            props: {
              isRoot: true,
            },
          });

          const hasMoreOngoingScheduledMaintenanceEvents: boolean =
            await this.hasThisMonitorMoreOngoingScheduledMaintenanceEvents(
              monitor.id!,
            );

          if (hasMoreOngoingScheduledMaintenanceEvents) {
            // dont do anything because other events are active at the same time.
            continue;
          }

          await MonitorService.updateOneById({
            id: monitor.id!,
            data: {
              disableActiveMonitoringBecauseOfScheduledMaintenanceEvent: false, /// This will start active monitoring again.
            },
            props: {
              isRoot: true,
            },
          });

          if (
            dbMonitor?.currentMonitorStatusId?.toString() ===
            resolvedMonitorState.id?.toString()
          ) {
            // if already in resolved state then skip.
            continue;
          }

          const monitorStatusTimeline: MonitorStatusTimeline =
            new MonitorStatusTimeline();
          monitorStatusTimeline.monitorId = monitor.id!;
          monitorStatusTimeline.projectId =
            scheduledMaintenanceEvent.projectId!;
          monitorStatusTimeline.monitorStatusId = resolvedMonitorState.id!;

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

  public async hasThisMonitorMoreOngoingScheduledMaintenanceEvents(
    id: ObjectID,
  ): Promise<boolean> {
    const count: PositiveNumber = await ScheduledMaintenanceService.countBy({
      query: {
        monitors: QueryHelper.inRelationArray([id]),
        currentScheduledMaintenanceState: {
          isOngoingState: true,
        },
      },
      props: {
        isRoot: true,
      },
    });

    if (count.toNumber() > 0) {
      return true;
    }

    return false;
  }

  protected override async onBeforeDelete(
    deleteBy: DeleteBy<ScheduledMaintenanceStateTimeline>,
  ): Promise<OnDelete<ScheduledMaintenanceStateTimeline>> {
    if (deleteBy.query._id) {
      const scheduledMaintenanceStateTimelineToBeDeleted: ScheduledMaintenanceStateTimeline | null =
        await this.findOneById({
          id: new ObjectID(deleteBy.query._id as string),
          select: {
            scheduledMaintenanceId: true,
            startsAt: true,
          },
          props: {
            isRoot: true,
          },
        });

      const scheduledMaintenanceId: ObjectID | undefined =
        scheduledMaintenanceStateTimelineToBeDeleted?.scheduledMaintenanceId;

      if (scheduledMaintenanceId) {
        const scheduledMaintenanceStateTimeline: PositiveNumber =
          await this.countBy({
            query: {
              scheduledMaintenanceId: scheduledMaintenanceId,
            },
            props: {
              isRoot: true,
            },
          });

        if (scheduledMaintenanceStateTimeline.isOne()) {
          throw new BadDataException(
            "Cannot delete the only state timeline. Scheduled Maintenance should have at least one state in its timeline.",
          );
        }

        if (scheduledMaintenanceStateTimelineToBeDeleted?.startsAt) {
          const beforeState: ScheduledMaintenanceStateTimeline | null =
            await this.findOneBy({
              query: {
                scheduledMaintenanceId: scheduledMaintenanceId,
                startsAt: QueryHelper.lessThan(
                  scheduledMaintenanceStateTimelineToBeDeleted?.startsAt,
                ),
              },
              sort: {
                createdAt: SortOrder.Descending,
              },
              props: {
                isRoot: true,
              },
              select: {
                _id: true,
                startsAt: true,
              },
            });

          if (beforeState) {
            const afterState: ScheduledMaintenanceStateTimeline | null =
              await this.findOneBy({
                query: {
                  scheduledMaintenanceId: scheduledMaintenanceId,
                  startsAt: QueryHelper.greaterThan(
                    scheduledMaintenanceStateTimelineToBeDeleted?.startsAt,
                  ),
                },
                sort: {
                  createdAt: SortOrder.Ascending,
                },
                props: {
                  isRoot: true,
                },
                select: {
                  _id: true,
                  startsAt: true,
                },
              });

            if (!afterState) {
              // if there's nothing after then end date of before state is null.

              await this.updateOneById({
                id: beforeState.id!,
                data: {
                  endsAt: null as any,
                },
                props: {
                  isRoot: true,
                },
              });
            } else {
              // if there's something after then end date of before state is start date of after state.

              await this.updateOneById({
                id: beforeState.id!,
                data: {
                  endsAt: afterState.startsAt!,
                },
                props: {
                  isRoot: true,
                },
              });
            }
          }
        }
      }

      return { deleteBy, carryForward: scheduledMaintenanceId };
    }

    return { deleteBy, carryForward: null };
  }

  protected override async onDeleteSuccess(
    onDelete: OnDelete<ScheduledMaintenanceStateTimeline>,
    _itemIdsBeforeDelete: ObjectID[],
  ): Promise<OnDelete<ScheduledMaintenanceStateTimeline>> {
    if (onDelete.carryForward) {
      // this is scheduledMaintenanceId.
      const scheduledMaintenanceId: ObjectID =
        onDelete.carryForward as ObjectID;

      // get last status of this monitor.
      const scheduledMaintenanceStateTimeline: ScheduledMaintenanceStateTimeline | null =
        await this.findOneBy({
          query: {
            scheduledMaintenanceId: scheduledMaintenanceId,
          },
          sort: {
            createdAt: SortOrder.Descending,
          },
          props: {
            isRoot: true,
          },
          select: {
            _id: true,
            scheduledMaintenanceStateId: true,
          },
        });

      if (
        scheduledMaintenanceStateTimeline &&
        scheduledMaintenanceStateTimeline.scheduledMaintenanceStateId
      ) {
        await ScheduledMaintenanceService.updateOneBy({
          query: {
            _id: scheduledMaintenanceId.toString(),
          },
          data: {
            currentScheduledMaintenanceStateId:
              scheduledMaintenanceStateTimeline.scheduledMaintenanceStateId,
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
