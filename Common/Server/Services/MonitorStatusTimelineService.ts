import Semaphore, { SemaphoreMutex } from "../Infrastructure/Semaphore";
import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import { OnCreate, OnDelete } from "../Types/Database/Hooks";
import QueryHelper from "../Types/Database/QueryHelper";
import logger from "../Utils/Logger";
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

export class Service extends DatabaseService<MonitorStatusTimeline> {
  public constructor() {
    super(MonitorStatusTimeline);
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<MonitorStatusTimeline>,
  ): Promise<OnCreate<MonitorStatusTimeline>> {
    if (!createBy.data.monitorId) {
      throw new BadDataException("monitorId is null");
    }

    let mutex: SemaphoreMutex | null = null;

    try {
      mutex = await Semaphore.lock({
        key: createBy.data.monitorId.toString(),
        namespace: "MonitorStatusTimeline.create",
      });
    } catch (e) {
      logger.error(e);
    }

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
        monitorId: createBy.data.monitorId,
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

    logger.debug("State Before this");
    logger.debug(stateBeforeThis);

    // If this is the first state, then do not notify the owner.
    if (!stateBeforeThis) {
      // since this is the first status, do not notify the owner.
      createBy.data.isOwnerNotified = true;
    }

    // check if this new state and the previous state are same.
    // if yes, then throw bad data exception.

    if (stateBeforeThis && stateBeforeThis.monitorStatusId && monitorStatusId) {
      if (
        stateBeforeThis.monitorStatusId.toString() ===
        monitorStatusId.toString()
      ) {
        throw new BadDataException(
          "Monitor Status cannot be same as previous status.",
        );
      }
    }

    const stateAfterThis: MonitorStatusTimeline | null = await this.findOneBy({
      query: {
        monitorId: createBy.data.monitorId,
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

    // check if this new state and the previous state are same.
    // if yes, then throw bad data exception.

    if (stateAfterThis && stateAfterThis.monitorStatusId && monitorStatusId) {
      if (
        stateAfterThis.monitorStatusId.toString() === monitorStatusId.toString()
      ) {
        throw new BadDataException(
          "Monitor Status cannot be same as next status.",
        );
      }
    }

    logger.debug("State After this");
    logger.debug(stateAfterThis);

    return {
      createBy,
      carryForward: {
        statusTimelineBeforeThisStatus: stateBeforeThis || null,
        statusTimelineAfterThisStatus: stateAfterThis || null,
        mutex: mutex,
      },
    };
  }

  @CaptureSpan()
  protected override async onCreateSuccess(
    onCreate: OnCreate<MonitorStatusTimeline>,
    createdItem: MonitorStatusTimeline,
  ): Promise<MonitorStatusTimeline> {
    if (!createdItem.monitorId) {
      throw new BadDataException("monitorId is null");
    }

    if (!createdItem.monitorStatusId) {
      throw new BadDataException("monitorStatusId is null");
    }

    // update the last status as ended.

    logger.debug("Status Timeline Before this");
    logger.debug(onCreate.carryForward.statusTimelineBeforeThisStatus);

    logger.debug("Status Timeline After this");
    logger.debug(onCreate.carryForward.statusTimelineAfterThisStatus);

    logger.debug("Created Item");
    logger.debug(createdItem);

    // now there are three cases.
    // 1. This is the first status OR there's no status after this.
    if (!onCreate.carryForward.statusTimelineBeforeThisStatus) {
      // This is the first status, no need to update previous status.
      logger.debug("This is the first status.");
    } else if (!onCreate.carryForward.statusTimelineAfterThisStatus) {
      // 2. This is the last status.
      // Update the previous status to end at the start of this status.
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
      // 3. This is in the middle.
      // Update the previous status to end at the start of this status.
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

    if (onCreate.carryForward.mutex) {
      const mutex: SemaphoreMutex = onCreate.carryForward.mutex;
      await Semaphore.release(mutex);
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
      userId: createdItem.createdByUserId || onCreate.createBy.props.userId,
      workspaceNotification: {
        sendWorkspaceNotification: true,
        notifyUserId:
          createdItem.createdByUserId ||
          onCreate.createBy.props.userId ||
          undefined,
      },
    });

    return createdItem;
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

        // There are three cases.
        // 1. This is the first status.
        // 2. This is the last status.
        // 3. This is in the middle.

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
          logger.debug("This is the first status.");
        } else if (!stateAfterThis) {
          // This is the last status.
          // Update the previous status to end at the start of this status.
          await this.updateOneById({
            id: stateBeforeThis.id!,
            data: {
              endsAt: monitorStatusTimelineToBeDeleted.endsAt!,
            },
            props: {
              isRoot: true,
            },
          });
          logger.debug("This is the last status.");
        } else {
          // This status is in the middle.
          // Update the previous status to end at the start of this status.
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
          logger.debug("This status is in the middle.");
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
