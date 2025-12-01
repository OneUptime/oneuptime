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
import StatusPageSubscriberNotificationStatus from "../../Types/StatusPage/StatusPageSubscriberNotificationStatus";
import Monitor from "../../Models/DatabaseModels/Monitor";
import MonitorStatus from "../../Models/DatabaseModels/MonitorStatus";
import MonitorStatusTimeline from "../../Models/DatabaseModels/MonitorStatusTimeline";
import ScheduledMaintenance from "../../Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenancePublicNote from "../../Models/DatabaseModels/ScheduledMaintenancePublicNote";
import ScheduledMaintenanceState from "../../Models/DatabaseModels/ScheduledMaintenanceState";
import ScheduledMaintenanceStateTimeline from "../../Models/DatabaseModels/ScheduledMaintenanceStateTimeline";
import { IsBillingEnabled } from "../EnvironmentConfig";
import ScheduledMaintenanceFeedService from "./ScheduledMaintenanceFeedService";
import { ScheduledMaintenanceFeedEventType } from "../../Models/DatabaseModels/ScheduledMaintenanceFeed";
import logger from "../Utils/Logger";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import WorkspaceNotificationRuleService from "./WorkspaceNotificationRuleService";
import Semaphore, { SemaphoreMutex } from "../Infrastructure/Semaphore";

export class Service extends DatabaseService<ScheduledMaintenanceStateTimeline> {
  public constructor() {
    super(ScheduledMaintenanceStateTimeline);
    if (IsBillingEnabled) {
      this.hardDeleteItemsOlderThanInDays("createdAt", 3 * 365); // 3 years
    }
  }

  private async isLastScheduledMaintenanceState(data: {
    projectId: ObjectID;
    scheduledMaintenanceStateId: ObjectID;
  }): Promise<boolean> {
    // find all the states for this project and sort it by order. Then, check if this is the last state.
    const scheduledMaintenanceStates: ScheduledMaintenanceState[] =
      await ScheduledMaintenanceStateService.findBy({
        query: {
          projectId: data.projectId,
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        sort: {
          order: SortOrder.Ascending,
        },
        props: {
          isRoot: true,
        },
      });

    const scheduledMaintenanceState: ScheduledMaintenanceState | null =
      scheduledMaintenanceStates.find(
        (scheduledMaintenanceState: ScheduledMaintenanceState) => {
          return (
            scheduledMaintenanceState.id?.toString() ===
            data.scheduledMaintenanceStateId.toString()
          );
        },
      ) || null;

    if (!scheduledMaintenanceState) {
      throw new BadDataException("ScheduledMaintenance state not found.");
    }

    const lastScheduledMaintenanceState: ScheduledMaintenanceState | undefined =
      scheduledMaintenanceStates[scheduledMaintenanceStates.length - 1];

    if (lastScheduledMaintenanceState && lastScheduledMaintenanceState.id) {
      return (
        lastScheduledMaintenanceState.id.toString() ===
        scheduledMaintenanceState.id?.toString()
      );
    }

    return false;
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<ScheduledMaintenanceStateTimeline>,
  ): Promise<OnCreate<ScheduledMaintenanceStateTimeline>> {
    if (!createBy.data.scheduledMaintenanceId) {
      throw new BadDataException("scheduledMaintenanceId is null");
    }

    let mutex: SemaphoreMutex | null = null;

    try {
      try {
        mutex = await Semaphore.lock({
          key: createBy.data.scheduledMaintenanceId.toString(),
          namespace: "ScheduledMaintenanceStateTimeline.create",
        });
      } catch (err) {
        logger.error(err);
      }

      if (!createBy.data.startsAt) {
        createBy.data.startsAt = OneUptimeDate.getCurrentDate();
      }

      const scheduledMaintenanceStateId: ObjectID | undefined | null =
        createBy.data.scheduledMaintenanceStateId ||
        createBy.data.scheduledMaintenanceState?.id;

      if (!scheduledMaintenanceStateId) {
        throw new BadDataException("scheduledMaintenanceStateId is null");
      }

      const stateBeforeThis: ScheduledMaintenanceStateTimeline | null =
        await this.findOneBy({
          query: {
            scheduledMaintenanceId: createBy.data.scheduledMaintenanceId,
            startsAt: QueryHelper.lessThanEqualTo(createBy.data.startsAt),
          },
          sort: {
            startsAt: SortOrder.Descending,
          },
          props: {
            isRoot: true,
          },
          select: {
            scheduledMaintenanceStateId: true,
            scheduledMaintenanceState: {
              order: true,
              name: true,
            },
            startsAt: true,
            endsAt: true,
          },
        });

      // If this is the first state, then do not notify the owner.
      if (!stateBeforeThis) {
        // since this is the first status, do not notify the owner.
        createBy.data.isOwnerNotified = true;
      }

      if (
        stateBeforeThis &&
        stateBeforeThis.scheduledMaintenanceStateId &&
        scheduledMaintenanceStateId
      ) {
        if (
          stateBeforeThis.scheduledMaintenanceStateId.toString() ===
          scheduledMaintenanceStateId.toString()
        ) {
          throw new BadDataException(
            "Scheduled Maintenance state cannot be same as previous state.",
          );
        }
      }

      if (stateBeforeThis && stateBeforeThis.scheduledMaintenanceState?.order) {
        const newScheduledMaintenanceState: ScheduledMaintenanceState | null =
          await ScheduledMaintenanceStateService.findOneBy({
            query: {
              _id: scheduledMaintenanceStateId,
            },
            select: {
              order: true,
              name: true,
            },
            props: {
              isRoot: true,
            },
          });

        if (
          newScheduledMaintenanceState &&
          newScheduledMaintenanceState.order
        ) {
          // check if the new scheduledMaintenance state is in order is greater than the previous state order
          if (
            stateBeforeThis &&
            stateBeforeThis.scheduledMaintenanceState &&
            stateBeforeThis.scheduledMaintenanceState.order &&
            newScheduledMaintenanceState.order <=
              stateBeforeThis.scheduledMaintenanceState.order
          ) {
            throw new BadDataException(
              `ScheduledMaintenance cannot transition to ${newScheduledMaintenanceState.name} state from ${stateBeforeThis.scheduledMaintenanceState.name} state because ${newScheduledMaintenanceState.name} is before ${stateBeforeThis.scheduledMaintenanceState.name} in the order of scheduledMaintenance states.`,
            );
          }
        }
      }

      const stateAfterThis: ScheduledMaintenanceStateTimeline | null =
        await this.findOneBy({
          query: {
            scheduledMaintenanceId: createBy.data.scheduledMaintenanceId,
            startsAt: QueryHelper.greaterThan(createBy.data.startsAt),
          },
          sort: {
            startsAt: SortOrder.Ascending,
          },
          props: {
            isRoot: true,
          },
          select: {
            scheduledMaintenanceStateId: true,
            startsAt: true,
            endsAt: true,
          },
        });

      // compute ends at. It's the start of the next status.
      if (stateAfterThis && stateAfterThis.startsAt) {
        createBy.data.endsAt = stateAfterThis.startsAt;
      }

      if (
        stateAfterThis &&
        stateAfterThis.scheduledMaintenanceStateId &&
        scheduledMaintenanceStateId
      ) {
        if (
          stateAfterThis.scheduledMaintenanceStateId.toString() ===
          scheduledMaintenanceStateId.toString()
        ) {
          throw new BadDataException(
            "Scheduled Maintenance state cannot be same as next state.",
          );
        }
      }

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
          createBy.data.subscriberNotificationStatus =
            StatusPageSubscriberNotificationStatus.Success;
        }

        await ScheduledMaintenancePublicNoteService.create({
          data: scheduledMaintenancePublicNote,
          props: createBy.props,
        });
      }

      // Set notification status based on shouldStatusPageSubscribersBeNotified
      if (createBy.data.shouldStatusPageSubscribersBeNotified === false) {
        createBy.data.subscriberNotificationStatus =
          StatusPageSubscriberNotificationStatus.Skipped;
        createBy.data.subscriberNotificationStatusMessage =
          "Notifications skipped as subscribers are not to be notified for this scheduled maintenance state change.";
      } else if (createBy.data.shouldStatusPageSubscribersBeNotified === true) {
        createBy.data.subscriberNotificationStatus =
          StatusPageSubscriberNotificationStatus.Pending;
      }

      return {
        createBy,
        carryForward: {
          statusTimelineBeforeThisStatus: stateBeforeThis || null,
          statusTimelineAfterThisStatus: stateAfterThis || null,
          publicNote: publicNote,
          mutex: mutex,
        },
      };
    } catch (error) {
      // release the mutex if it was acquired.
      if (mutex) {
        try {
          await Semaphore.release(mutex);
        } catch (err) {
          logger.error(err);
        }
      }

      throw error;
    }
  }

  @CaptureSpan()
  protected override async onCreateSuccess(
    onCreate: OnCreate<ScheduledMaintenanceStateTimeline>,
    createdItem: ScheduledMaintenanceStateTimeline,
  ): Promise<ScheduledMaintenanceStateTimeline> {
    const mutex: SemaphoreMutex | null = onCreate.carryForward.mutex;

    if (!createdItem.scheduledMaintenanceId) {
      throw new BadDataException("scheduledMaintenanceId is null");
    }

    if (!createdItem.scheduledMaintenanceStateId) {
      throw new BadDataException("scheduledMaintenanceStateId is null");
    }

    // update the last status as ended.

    logger.debug("Status Timeline Before this");
    logger.debug(onCreate.carryForward.statusTimelineBeforeThisStatus);

    logger.debug("Status Timeline After this");
    logger.debug(onCreate.carryForward.statusTimelineAfterThisStatus);

    logger.debug("Created Item");
    logger.debug(createdItem);

    /*
     * now there are three cases.
     * 1. This is the first status OR there's no status after this.
     */
    if (!onCreate.carryForward.statusTimelineBeforeThisStatus) {
      // This is the first status, no need to update previous status.
      logger.debug("This is the first status.");
    } else if (!onCreate.carryForward.statusTimelineAfterThisStatus) {
      /*
       * 2. This is the last status.
       * Update the previous status to end at the start of this status.
       */
      await this.updateOneById({
        id: onCreate.carryForward.statusTimelineBeforeThisStatus.id!,
        data: {
          endsAt: createdItem.startsAt!,
        },
        props: {
          isRoot: true,
        },
      });
      logger.debug("This is the last status.");
    } else {
      /*
       * 3. This is in the middle.
       * Update the previous status to end at the start of this status.
       */
      await this.updateOneById({
        id: onCreate.carryForward.statusTimelineBeforeThisStatus.id!,
        data: {
          endsAt: createdItem.startsAt!,
        },
        props: {
          isRoot: true,
        },
      });

      // Update the next status to start at the end of this status.
      await this.updateOneById({
        id: onCreate.carryForward.statusTimelineAfterThisStatus.id!,
        data: {
          startsAt: createdItem.endsAt!,
        },
        props: {
          isRoot: true,
        },
      });
      logger.debug("This status is in the middle.");
    }

    if (!createdItem.endsAt) {
      await ScheduledMaintenanceService.updateOneBy({
        query: {
          _id: createdItem.scheduledMaintenanceId?.toString(),
        },
        data: {
          currentScheduledMaintenanceStateId:
            createdItem.scheduledMaintenanceStateId,
        },
        props: onCreate.createBy.props,
      });
    }

    if (mutex) {
      try {
        await Semaphore.release(mutex);
      } catch (err) {
        logger.error(err);
      }
    }

    const scheduledMaintenanceState: ScheduledMaintenanceState | null =
      await ScheduledMaintenanceStateService.findOneBy({
        query: {
          _id: createdItem.scheduledMaintenanceStateId.toString()!,
        },
        props: {
          isRoot: true,
        },
        select: {
          _id: true,
          isResolvedState: true,
          isOngoingState: true,
          isScheduledState: true,
          color: true,
          name: true,
        },
      });

    const stateName: string = scheduledMaintenanceState?.name || "";
    let stateEmoji: string = "➡️";

    // if resolved state then change emoji to ✅.

    if (scheduledMaintenanceState?.isResolvedState) {
      stateEmoji = "✅";
    } else if (scheduledMaintenanceState?.isOngoingState) {
      // eyes emoji for acknowledged state.
      stateEmoji = "⏳";
    } else if (scheduledMaintenanceState?.isScheduledState) {
      stateEmoji = "🕒";
    }

    const scheduledMaintenanceNumber: number | null =
      await ScheduledMaintenanceService.getScheduledMaintenanceNumber({
        scheduledMaintenanceId: createdItem.scheduledMaintenanceId,
      });

    const projectId: ObjectID = createdItem.projectId!;
    const scheduledMaintenanceId: ObjectID =
      createdItem.scheduledMaintenanceId!;

    await ScheduledMaintenanceFeedService.createScheduledMaintenanceFeedItem({
      scheduledMaintenanceId: createdItem.scheduledMaintenanceId!,
      projectId: createdItem.projectId!,
      scheduledMaintenanceFeedEventType:
        ScheduledMaintenanceFeedEventType.ScheduledMaintenanceStateChanged,
      displayColor: scheduledMaintenanceState?.color,
      feedInfoInMarkdown:
        stateEmoji +
        ` Changed **[Scheduled Maintenance ${scheduledMaintenanceNumber}](${(await ScheduledMaintenanceService.getScheduledMaintenanceLinkInDashboard(projectId!, scheduledMaintenanceId!)).toString()}) State** to **` +
        stateName +
        "**",
      userId: createdItem.createdByUserId || onCreate.createBy.props.userId,
      workspaceNotification: {
        sendWorkspaceNotification: true,
        notifyUserId:
          createdItem.createdByUserId || onCreate.createBy.props.userId,
      },
    });

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
          nextSubscriberNotificationBeforeTheEventAt: true,
        },
        props: {
          isRoot: true,
        },
      });

    const hasProgressedBeyondScheduledState: boolean = Boolean(
      scheduledMaintenanceState &&
        !scheduledMaintenanceState.isScheduledState,
    );

    if (
      hasProgressedBeyondScheduledState &&
      scheduledMaintenanceEvent?.nextSubscriberNotificationBeforeTheEventAt
    ) {
      await ScheduledMaintenanceService.updateOneById({
        id: createdItem.scheduledMaintenanceId!,
        data: {
          nextSubscriberNotificationBeforeTheEventAt: null,
        },
        props: onCreate.createBy.props,
      });
    }

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

    const isLastScheduledMaintenanceState: boolean =
      await this.isLastScheduledMaintenanceState({
        projectId: createdItem.projectId!,
        scheduledMaintenanceStateId: createdItem.scheduledMaintenanceStateId,
      });

    if (isLastScheduledMaintenanceState) {
      WorkspaceNotificationRuleService.archiveWorkspaceChannels({
        projectId: createdItem.projectId!,
        notificationFor: {
          scheduledMaintenanceId: createdItem.scheduledMaintenanceId,
        },
        sendMessageBeforeArchiving: {
          _type: "WorkspacePayloadMarkdown",
          text: `**[Scheduled Event ${scheduledMaintenanceNumber}](${(
            await ScheduledMaintenanceService.getScheduledMaintenanceLinkInDashboard(
              createdItem.projectId!,
              createdItem.scheduledMaintenanceId!,
            )
          ).toString()})** is complete. Archiving channel.`,
        },
      }).catch((error: Error) => {
        logger.error(`Error while archiving workspace channels:`);
        logger.error(error);
      });
    }

    return createdItem;
  }

  @CaptureSpan()
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

  @CaptureSpan()
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

  @CaptureSpan()
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
            endsAt: true,
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

        if (!scheduledMaintenanceStateTimelineToBeDeleted) {
          throw new BadDataException(
            "Scheduled maintenance state timeline not found.",
          );
        }

        if (scheduledMaintenanceStateTimeline.isOne()) {
          throw new BadDataException(
            "Cannot delete the only state timeline. Scheduled Maintenance should have at least one state in its timeline.",
          );
        }

        /*
         * There are three cases.
         * 1. This is the first state.
         * 2. This is the last state.
         * 3. This is in the middle.
         */

        const stateBeforeThis: ScheduledMaintenanceStateTimeline | null =
          await this.findOneBy({
            query: {
              _id: QueryHelper.notEquals(deleteBy.query._id as string),
              scheduledMaintenanceId: scheduledMaintenanceId,
              startsAt: QueryHelper.lessThanEqualTo(
                scheduledMaintenanceStateTimelineToBeDeleted.startsAt!,
              ),
            },
            sort: {
              startsAt: SortOrder.Descending,
            },
            props: {
              isRoot: true,
            },
            select: {
              scheduledMaintenanceStateId: true,
              startsAt: true,
              endsAt: true,
            },
          });

        const stateAfterThis: ScheduledMaintenanceStateTimeline | null =
          await this.findOneBy({
            query: {
              scheduledMaintenanceId: scheduledMaintenanceId,
              startsAt: QueryHelper.greaterThan(
                scheduledMaintenanceStateTimelineToBeDeleted.startsAt!,
              ),
            },
            sort: {
              startsAt: SortOrder.Ascending,
            },
            props: {
              isRoot: true,
            },
            select: {
              scheduledMaintenanceStateId: true,
              startsAt: true,
              endsAt: true,
            },
          });

        if (!stateBeforeThis) {
          // This is the first state, no need to update previous state.
          logger.debug("This is the first state.");
        } else if (!stateAfterThis) {
          /*
           * This is the last state.
           * Update the previous state to end at the end of this state.
           */
          await this.updateOneById({
            id: stateBeforeThis.id!,
            data: {
              endsAt: scheduledMaintenanceStateTimelineToBeDeleted.endsAt!,
            },
            props: {
              isRoot: true,
            },
          });
          logger.debug("This is the last state.");
        } else {
          /*
           * This state is in the middle.
           * Update the previous state to end at the start of the next state.
           */
          await this.updateOneById({
            id: stateBeforeThis.id!,
            data: {
              endsAt: stateAfterThis.startsAt!,
            },
            props: {
              isRoot: true,
            },
          });

          // Update the next state to start at the start of this state.
          await this.updateOneById({
            id: stateAfterThis.id!,
            data: {
              startsAt: scheduledMaintenanceStateTimelineToBeDeleted.startsAt!,
            },
            props: {
              isRoot: true,
            },
          });
          logger.debug("This state is in the middle.");
        }
      }

      return { deleteBy, carryForward: scheduledMaintenanceId };
    }

    return { deleteBy, carryForward: null };
  }

  @CaptureSpan()
  protected override async onDeleteSuccess(
    onDelete: OnDelete<ScheduledMaintenanceStateTimeline>,
    _itemIdsBeforeDelete: ObjectID[],
  ): Promise<OnDelete<ScheduledMaintenanceStateTimeline>> {
    if (onDelete.carryForward) {
      // this is scheduledMaintenanceId.
      const scheduledMaintenanceId: ObjectID =
        onDelete.carryForward as ObjectID;

      // get last status of this scheduled maintenance.
      const scheduledMaintenanceStateTimeline: ScheduledMaintenanceStateTimeline | null =
        await this.findOneBy({
          query: {
            scheduledMaintenanceId: scheduledMaintenanceId,
          },
          sort: {
            startsAt: SortOrder.Descending,
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
