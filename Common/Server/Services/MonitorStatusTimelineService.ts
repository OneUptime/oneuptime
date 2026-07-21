import Semaphore, { SemaphoreMutex } from "../Infrastructure/Semaphore";
import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import { OnCreate, OnDelete } from "../Types/Database/Hooks";
import QueryHelper from "../Types/Database/QueryHelper";
import logger, { LogAttributes } from "../Utils/Logger";
import DatabaseService from "./DatabaseService";
import MonitorService from "./MonitorService";
import UserService from "./UserService";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import OneUptimeDate from "../../Types/Date";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import PositiveNumber from "../../Types/PositiveNumber";
import MonitorStatusTimeline from "../../Models/DatabaseModels/MonitorStatusTimeline";
import MonitorFeedService from "./MonitorFeedService";
import { MonitorFeedEventType } from "../../Models/DatabaseModels/MonitorFeed";
import MonitorStatus from "../../Models/DatabaseModels/MonitorStatus";
import MonitorStatusService from "./MonitorStatusService";
import ServerException from "../../Types/Exception/ServerException";

/*
 * Thrown by onBeforeCreate when the incoming status is the same as the status of
 * the row immediately before it. Probe ingest call sites (Utils/Monitor/MonitorStatusTimeline
 * and Utils/Monitor/MonitorResource) match on this exact message to treat the
 * duplicate as an idempotent no-op, so the text must not change.
 */
export const MONITOR_STATUS_SAME_AS_PREVIOUS_ERROR_MESSAGE: string =
  "Monitor Status cannot be same as previous status.";

/*
 * Thrown by create() when the per-monitor mutex cannot be acquired. The timeline
 * write is refused rather than performed unlocked - see the comment on the lock
 * acquisition below. Probe ingest call sites match on this to log and skip
 * instead of failing the whole ingest run.
 */
export const MONITOR_STATUS_TIMELINE_LOCK_ERROR_MESSAGE: string =
  "Could not acquire the monitor status timeline lock for this monitor.";

export class Service extends DatabaseService<MonitorStatusTimeline> {
  public constructor() {
    super(MonitorStatusTimeline);
  }

  @CaptureSpan()
  public override async create(
    createBy: CreateBy<MonitorStatusTimeline>,
  ): Promise<MonitorStatusTimeline> {
    /*
     * The per-monitor mutex is owned here, around the whole create, rather than
     * inside onBeforeCreate. DatabaseService.create() invokes onBeforeCreate and
     * then runs validation, permission checks and the INSERT before it ever
     * reaches onCreateSuccess, all OUTSIDE any try/catch this service can hook
     * (onCreateError never fires for a throw raised before the INSERT). So a
     * mutex acquired in onBeforeCreate and released in onCreateSuccess leaks on
     * any throw in between, and a leaked redis-semaphore mutex never expires - it
     * keeps refreshing its own Redis key for the life of the process, which would
     * block every later create for that monitor until acquireTimeout. Holding it
     * in a try/finally here releases it on every path.
     *
     * The critical section that must be serialized per monitor spans reading the
     * predecessor row (onBeforeCreate) through closing it (onCreateSuccess), so
     * the lock is held across the entire super.create(), not just one hook.
     */
    if (createBy.props.ignoreHooks || !createBy.data.monitorId) {
      // No predecessor bookkeeping runs on these paths, so no serialization is needed.
      return await super.create(createBy);
    }

    const logAttributes: LogAttributes = {
      projectId: createBy.data.projectId?.toString(),
      monitorId: createBy.data.monitorId?.toString(),
    } as LogAttributes;

    let mutex: SemaphoreMutex | null = null;

    try {
      mutex = await Semaphore.lock({
        key: createBy.data.monitorId.toString(),
        namespace: "MonitorStatusTimeline.create",
      });
    } catch (e) {
      /*
       * Fail closed. This used to fall through and INSERT UNLOCKED, which let two
       * concurrent writers resolve the same predecessor row, both pass the
       * same-as-previous check, and both INSERT a status row milliseconds apart.
       * Only the later row is ever closed (the next writer resolves its
       * predecessor with ORDER BY startsAt DESC LIMIT 1), so the earlier row is
       * orphaned with endsAt = NULL permanently and is read back as unbounded
       * downtime. Refusing the write is strictly safer: the monitor keeps its
       * current status and the next probe result for the same monitor
       * re-evaluates the same criteria and recreates the status change.
       */
      logger.error(e, logAttributes);
      throw new ServerException(MONITOR_STATUS_TIMELINE_LOCK_ERROR_MESSAGE);
    }

    let createdItem: MonitorStatusTimeline;

    try {
      createdItem = await super.create(createBy);
    } finally {
      await this.releaseMutex(mutex, logAttributes);
    }

    /*
     * The feed item and its workspace notification run AFTER the mutex is
     * released: they can involve third-party HTTP (Slack/Teams) with unbounded
     * latency, and holding the per-monitor lock across them would block every
     * concurrent status write for this monitor until acquireTimeout - turning
     * one slow webhook into refused status transitions. Only the predecessor
     * read -> INSERT -> predecessor close needs the lock, and all of that has
     * completed by this point. (The pre-fail-closed code released the lock at
     * this same boundary, before the feed block.)
     */
    await this.createStatusChangeFeedItem(createdItem, createBy);

    return createdItem;
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<MonitorStatusTimeline>,
  ): Promise<OnCreate<MonitorStatusTimeline>> {
    if (!createBy.data.monitorId) {
      throw new BadDataException("monitorId is null");
    }

    const logAttributes: LogAttributes = {
      projectId: createBy.data.projectId?.toString(),
      monitorId: createBy.data.monitorId?.toString(),
    } as LogAttributes;

    /*
     * The per-monitor mutex that serializes this read-modify-write is acquired
     * and released in create() (see the comment there); it is held for the whole
     * duration of this hook.
     */
    return await this.buildOnCreate(
      createBy,
      createBy.data.monitorId,
      logAttributes,
    );
  }

  /*
   * Body of onBeforeCreate, split out to keep the null-narrowing of monitorId in
   * one place: it is passed in already narrowed so it can never reach a query as
   * undefined, which would widen the query to every monitor.
   */
  private async buildOnCreate(
    createBy: CreateBy<MonitorStatusTimeline>,
    monitorId: ObjectID,
    logAttributes: LogAttributes,
  ): Promise<OnCreate<MonitorStatusTimeline>> {
    if (!createBy.data.startsAt) {
      createBy.data.startsAt = OneUptimeDate.getCurrentDate();
    }

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

      if (userId) {
        createBy.data.rootCause = `Monitor status created by ${await UserService.getUserMarkdownString(
          {
            userId: userId!,
            projectId: createBy.data.projectId || createBy.props.tenantId!,
          },
        )}`;
      }
    }

    const monitorStatusId: ObjectID | undefined | null =
      createBy.data.monitorStatusId || createBy.data.monitorStatus?.id;

    if (!monitorStatusId) {
      throw new BadDataException("monitorStatusId is null");
    }

    const stateBeforeThis: MonitorStatusTimeline | null = await this.findOneBy({
      query: {
        monitorId: monitorId,
        startsAt: QueryHelper.lessThanEqualTo(createBy.data.startsAt),
      },
      sort: {
        startsAt: SortOrder.Descending,
      },
      props: {
        isRoot: true,
      },
      select: {
        monitorStatusId: true,
        startsAt: true,
        endsAt: true,
      },
    });

    logger.debug("State Before this", logAttributes);
    logger.debug(stateBeforeThis, logAttributes);

    // If this is the first state, then do not notify the owner.
    if (!stateBeforeThis) {
      // since this is the first status, do not notify the owner.
      createBy.data.isOwnerNotified = true;
    }

    /*
     * check if this new state and the previous state are same.
     * if yes, then throw bad data exception.
     */

    if (stateBeforeThis && stateBeforeThis.monitorStatusId && monitorStatusId) {
      if (
        stateBeforeThis.monitorStatusId.toString() ===
        monitorStatusId.toString()
      ) {
        /*
         * Logged above debug on purpose. This is the exact point at which an
         * orphaned (endsAt = NULL) row would have been created had the mutex
         * fallen through unlocked, so it is the signal to alert on: a sustained
         * rate here means two writers are racing for the same monitor.
         */
        logger.warn(
          `MonitorStatusTimeline: rejecting duplicate status ${monitorStatusId.toString()} for monitor ${monitorId.toString()}. The preceding status starting at ${stateBeforeThis.startsAt?.toString()} is already this status.`,
          logAttributes,
        );

        throw new BadDataException(
          MONITOR_STATUS_SAME_AS_PREVIOUS_ERROR_MESSAGE,
        );
      }
    }

    const stateAfterThis: MonitorStatusTimeline | null = await this.findOneBy({
      query: {
        monitorId: monitorId,
        startsAt: QueryHelper.greaterThan(createBy.data.startsAt),
      },
      sort: {
        startsAt: SortOrder.Ascending,
      },
      props: {
        isRoot: true,
      },
      select: {
        monitorStatusId: true,
        startsAt: true,
        endsAt: true,
      },
    });

    // compute ends at. It's the start of the next status.
    if (stateAfterThis && stateAfterThis.startsAt) {
      createBy.data.endsAt = stateAfterThis.startsAt;
    }

    /*
     * check if this new state and the previous state are same.
     * if yes, then throw bad data exception.
     */

    if (stateAfterThis && stateAfterThis.monitorStatusId && monitorStatusId) {
      if (
        stateAfterThis.monitorStatusId.toString() === monitorStatusId.toString()
      ) {
        throw new BadDataException(
          "Monitor Status cannot be same as next status.",
        );
      }
    }

    logger.debug("State After this", logAttributes);
    logger.debug(stateAfterThis, logAttributes);

    return {
      createBy,
      carryForward: {
        statusTimelineBeforeThisStatus: stateBeforeThis || null,
        statusTimelineAfterThisStatus: stateAfterThis || null,
      },
    };
  }

  /*
   * Releases the per-monitor mutex. Never throws: a failed release must not mask
   * the error we are already unwinding, and must not fail an otherwise successful
   * create. Semaphore.release stops the refresh interval before it talks to
   * Redis, so even if the Redis call fails the key expires on its own lockTimeout.
   */
  private async releaseMutex(
    mutex: SemaphoreMutex | null | undefined,
    logAttributes: LogAttributes,
  ): Promise<void> {
    if (!mutex) {
      return;
    }

    try {
      await Semaphore.release(mutex);
    } catch (err) {
      logger.error(err, logAttributes);
    }
  }

  /*
   * Closes the status timeline row that precedes the row we just created.
   *
   * The update is conditional instead of a blind updateOneById: it only touches
   * the row if it starts at or before the new row (startsAt <= endsAt) and is
   * either still open or currently closed at or after the new row's startsAt
   * (endsAt >= :endsAt OR endsAt IS NULL). That keeps a concurrent or
   * out-of-order writer from extending a row forward over a gap it does not own,
   * and keeps a backfilled row from being closed at a time earlier than the row
   * that actually follows it.
   *
   * startsAt uses <= and not <: on an exact startsAt tie (a backfill inserted at
   * the same timestamp as the open predecessor) the predecessor must still be
   * closed - at zero duration, which is harmless. With a strict < the tie would
   * leave BOTH rows open forever: the reconciler deliberately never closes
   * startsAt ties (its successor predicate is strictly later), so nothing would
   * ever repair it, and the pair would read back as unbounded downtime.
   *
   * Note this closes only the single immediately-preceding row. If a monitor has
   * more than one open row (the orphans this bug produced), the older ones are
   * deliberately left alone: closing them here at the new row's startsAt would
   * turn a near-zero-duration orphan into months of recorded downtime, which is
   * worse than the current state and not repairable from the read path. Those
   * rows must be closed at the startsAt of the row that actually follows each of
   * them, which is the reconciler job's responsibility, not this write path's.
   */
  private async closePrecedingStatusTimeline(data: {
    precedingStatusTimelineId: ObjectID;
    endsAt: Date;
    logAttributes: LogAttributes;
  }): Promise<void> {
    const updatedCount: number = await this.updateOneBy({
      query: {
        _id: data.precedingStatusTimelineId.toString(),
        startsAt: QueryHelper.lessThanEqualTo(data.endsAt),
        endsAt: QueryHelper.greaterThanEqualToOrNull(data.endsAt),
      },
      data: {
        endsAt: data.endsAt,
      },
      props: {
        isRoot: true,
      },
    });

    if (updatedCount === 0) {
      /*
       * The preceding row moved under us between onBeforeCreate reading it and
       * this update - it was already closed at an earlier time, or it no longer
       * starts before the new row. Leaving it as-is is correct; surface it so the
       * reconciler has a signal to look at this monitor.
       */
      logger.warn(
        `MonitorStatusTimeline: did not close preceding status timeline ${data.precedingStatusTimelineId.toString()} at ${data.endsAt.toString()}; it is no longer open and older than the new status.`,
        data.logAttributes,
      );
    }
  }

  @CaptureSpan()
  protected override async onCreateSuccess(
    onCreate: OnCreate<MonitorStatusTimeline>,
    createdItem: MonitorStatusTimeline,
  ): Promise<MonitorStatusTimeline> {
    const logAttributes: LogAttributes = {
      projectId: createdItem.projectId?.toString(),
      monitorId: createdItem.monitorId?.toString(),
    } as LogAttributes;

    if (!createdItem.monitorId) {
      throw new BadDataException("monitorId is null");
    }

    if (!createdItem.monitorStatusId) {
      throw new BadDataException("monitorStatusId is null");
    }

    /*
     * Everything below runs while the per-monitor mutex acquired in create() is
     * still held, so the read of the predecessor in onBeforeCreate and the close
     * of it here cannot interleave with another writer for the same monitor.
     */

    // update the last status as ended.

    logger.debug("Status Timeline Before this", logAttributes);
    logger.debug(
      onCreate.carryForward.statusTimelineBeforeThisStatus,
      logAttributes,
    );

    logger.debug("Status Timeline After this", logAttributes);
    logger.debug(
      onCreate.carryForward.statusTimelineAfterThisStatus,
      logAttributes,
    );

    logger.debug("Created Item", logAttributes);
    logger.debug(createdItem, logAttributes);

    /*
     * now there are three cases.
     * 1. This is the first status OR there's no status after this.
     */
    if (!onCreate.carryForward.statusTimelineBeforeThisStatus) {
      // This is the first status, no need to update previous status.
      logger.debug("This is the first status.", logAttributes);
    } else if (!onCreate.carryForward.statusTimelineAfterThisStatus) {
      /*
       * 2. This is the last status.
       * Update the previous status to end at the start of this status.
       */
      await this.closePrecedingStatusTimeline({
        precedingStatusTimelineId:
          onCreate.carryForward.statusTimelineBeforeThisStatus.id!,
        endsAt: createdItem.startsAt!,
        logAttributes: logAttributes,
      });
      logger.debug("This is the last status.", logAttributes);
    } else {
      /*
       * 3. This is in the middle.
       * Update the previous status to end at the start of this status.
       */
      await this.closePrecedingStatusTimeline({
        precedingStatusTimelineId:
          onCreate.carryForward.statusTimelineBeforeThisStatus.id!,
        endsAt: createdItem.startsAt!,
        logAttributes: logAttributes,
      });

      /*
       * Update the next status to start at the end of this status. endsAt was
       * set to the next row's startsAt in onBeforeCreate, so this is normally a
       * no-op; it is guarded because writing an empty startsAt onto the next row
       * would corrupt it.
       */
      if (createdItem.endsAt) {
        await this.updateOneById({
          id: onCreate.carryForward.statusTimelineAfterThisStatus.id!,
          data: {
            startsAt: createdItem.endsAt,
          },
          props: {
            isRoot: true,
          },
        });
      }
      logger.debug("This status is in the middle.", logAttributes);
    }

    if (!createdItem.endsAt) {
      // if this is the last status, then update the monitor status.

      await MonitorService.updateOneBy({
        query: {
          _id: createdItem.monitorId?.toString(),
        },
        data: {
          currentMonitorStatusId: createdItem.monitorStatusId,
        },
        props: onCreate.createBy.props,
      });
    }
    return createdItem;
  }

  /*
   * Writes the monitor feed item (and its workspace notification, which can be
   * third-party HTTP to Slack/Teams) for a status change. Called from create()
   * AFTER the per-monitor mutex has been released - see the comment there. Kept
   * out of onCreateSuccess on purpose: everything in onCreateSuccess runs while
   * the mutex is held.
   */
  private async createStatusChangeFeedItem(
    createdItem: MonitorStatusTimeline,
    createBy: CreateBy<MonitorStatusTimeline>,
  ): Promise<void> {
    if (!createdItem.monitorId || !createdItem.monitorStatusId) {
      return;
    }

    const monitorStatus: MonitorStatus | null =
      await MonitorStatusService.findOneBy({
        query: {
          _id: createdItem.monitorStatusId.toString()!,
        },
        props: {
          isRoot: true,
        },
        select: {
          _id: true,
          isOfflineState: true,
          isOperationalState: true,
          color: true,
          name: true,
        },
      });

    const stateName: string = monitorStatus?.name || "";
    let stateEmoji: string = "➡️";

    // if resolved state then change emoji to 🟢.

    if (monitorStatus?.isOperationalState) {
      stateEmoji = "🟢";
    } else if (monitorStatus?.isOfflineState) {
      stateEmoji = "🔴";
    }

    const monitorName: string | null = await MonitorService.getMonitorName({
      monitorId: createdItem.monitorId,
    });

    const projectId: ObjectID = createdItem.projectId!;
    const monitorId: ObjectID = createdItem.monitorId!;

    await MonitorFeedService.createMonitorFeedItem({
      monitorId: createdItem.monitorId!,
      projectId: createdItem.projectId!,
      monitorFeedEventType: MonitorFeedEventType.MonitorStatusChanged,
      displayColor: monitorStatus?.color,
      feedInfoInMarkdown:
        stateEmoji +
        ` Changed Monitor **[${monitorName}](${(await MonitorService.getMonitorLinkInDashboard(projectId!, monitorId!)).toString()}) State** to **` +
        stateName +
        "**",
      moreInformationInMarkdown: `**Cause:**
    ${createdItem.rootCause}`,
      userId: createdItem.createdByUserId || createBy.props.userId,
      workspaceNotification: {
        sendWorkspaceNotification: true,
        notifyUserId:
          createdItem.createdByUserId || createBy.props.userId || undefined,
      },
    });
  }

  @CaptureSpan()
  protected override async onBeforeDelete(
    deleteBy: DeleteBy<MonitorStatusTimeline>,
  ): Promise<OnDelete<MonitorStatusTimeline>> {
    if (deleteBy.query._id) {
      const monitorStatusTimelineToBeDeleted: MonitorStatusTimeline | null =
        await this.findOneById({
          id: new ObjectID(deleteBy.query._id as string),
          select: {
            monitorId: true,
            startsAt: true,
            endsAt: true,
          },
          props: {
            isRoot: true,
          },
        });

      const monitorId: ObjectID | undefined =
        monitorStatusTimelineToBeDeleted?.monitorId;

      if (monitorId) {
        const monitorStatusTimeline: PositiveNumber = await this.countBy({
          query: {
            monitorId: monitorId,
          },
          props: {
            isRoot: true,
          },
        });

        if (!monitorStatusTimelineToBeDeleted) {
          throw new BadDataException("Monitor status timeline not found.");
        }

        if (monitorStatusTimeline.isOne()) {
          throw new BadDataException(
            "Cannot delete the only status timeline. Monitor should have at least one status timeline.",
          );
        }

        /*
         * There are three cases.
         * 1. This is the first status.
         * 2. This is the last status.
         * 3. This is in the middle.
         */

        const stateBeforeThis: MonitorStatusTimeline | null =
          await this.findOneBy({
            query: {
              _id: QueryHelper.notEquals(deleteBy.query._id as string),
              monitorId: monitorId,
              startsAt: QueryHelper.lessThanEqualTo(
                monitorStatusTimelineToBeDeleted.startsAt!,
              ),
            },
            sort: {
              startsAt: SortOrder.Descending,
            },
            props: {
              isRoot: true,
            },
            select: {
              monitorStatusId: true,
              startsAt: true,
              endsAt: true,
            },
          });

        const stateAfterThis: MonitorStatusTimeline | null =
          await this.findOneBy({
            query: {
              monitorId: monitorId,
              startsAt: QueryHelper.greaterThan(
                monitorStatusTimelineToBeDeleted.startsAt!,
              ),
            },
            sort: {
              startsAt: SortOrder.Ascending,
            },
            props: {
              isRoot: true,
            },
            select: {
              monitorStatusId: true,
              startsAt: true,
              endsAt: true,
            },
          });

        if (!stateBeforeThis) {
          // This is the first status, no need to update previous status.
          logger.debug("This is the first status.", {
            monitorId: monitorId?.toString(),
          } as LogAttributes);
        } else if (!stateAfterThis) {
          /*
           * This is the last status.
           * Update the previous status to end at the start of this status.
           */
          await this.updateOneById({
            id: stateBeforeThis.id!,
            data: {
              endsAt: monitorStatusTimelineToBeDeleted.endsAt!,
            },
            props: {
              isRoot: true,
            },
          });
          logger.debug("This is the last status.", {
            monitorId: monitorId?.toString(),
          } as LogAttributes);
        } else {
          /*
           * This status is in the middle.
           * Update the previous status to end at the start of this status.
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

          // Update the next status to start at the end of this status.
          await this.updateOneById({
            id: stateAfterThis.id!,
            data: {
              startsAt: monitorStatusTimelineToBeDeleted.startsAt!,
            },
            props: {
              isRoot: true,
            },
          });
          logger.debug("This status is in the middle.", {
            monitorId: monitorId?.toString(),
          } as LogAttributes);
        }
      }

      return { deleteBy, carryForward: monitorId };
    }

    return { deleteBy, carryForward: null };
  }

  @CaptureSpan()
  protected override async onDeleteSuccess(
    onDelete: OnDelete<MonitorStatusTimeline>,
    _itemIdsBeforeDelete: ObjectID[],
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
            startsAt: SortOrder.Descending,
          },
          props: {
            isRoot: true,
          },
          select: {
            _id: true,
            monitorStatusId: true,
          },
        });

      if (monitorStatusTimeline && monitorStatusTimeline.monitorStatusId) {
        await MonitorService.updateOneBy({
          query: {
            _id: monitorId.toString(),
          },
          data: {
            currentMonitorStatusId: monitorStatusTimeline.monitorStatusId,
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
