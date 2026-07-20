import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import { OnCreate, OnDelete } from "../Types/Database/Hooks";
import QueryHelper from "../Types/Database/QueryHelper";
import DatabaseService from "./DatabaseService";
import AlertStateService from "./AlertStateService";
import UserService from "./UserService";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import OneUptimeDate from "../../Types/Date";
import BadDataException from "../../Types/Exception/BadDataException";
import ServerException from "../../Types/Exception/ServerException";
import ObjectID from "../../Types/ObjectID";
import PositiveNumber from "../../Types/PositiveNumber";
import AlertState from "../../Models/DatabaseModels/AlertState";
import AlertEpisode from "../../Models/DatabaseModels/AlertEpisode";
import AlertEpisodeStateTimeline from "../../Models/DatabaseModels/AlertEpisodeStateTimeline";
import { IsBillingEnabled } from "../EnvironmentConfig";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import logger, { LogAttributes } from "../Utils/Logger";
import AlertEpisodeFeedService from "./AlertEpisodeFeedService";
import { AlertEpisodeFeedEventType } from "../../Models/DatabaseModels/AlertEpisodeFeed";
import Semaphore, { SemaphoreMutex } from "../Infrastructure/Semaphore";
import AlertEpisodeService from "./AlertEpisodeService";

/*
 * Thrown by create() when the per-entity mutex cannot be acquired. The write is
 * refused rather than performed unlocked. Ingest/caller sites that already swallow
 * the same-as-previous BadDataException match on this to log and skip.
 */
export const ALERT_EPISODE_STATE_TIMELINE_LOCK_ERROR_MESSAGE: string =
  "Could not acquire the alert episode state timeline lock for this episode.";

export class Service extends DatabaseService<AlertEpisodeStateTimeline> {
  public constructor() {
    super(AlertEpisodeStateTimeline);
    if (IsBillingEnabled) {
      this.hardDeleteItemsOlderThanInDays("createdAt", 3 * 365); // 3 years
    }
  }

  @CaptureSpan()
  public override async create(
    createBy: CreateBy<AlertEpisodeStateTimeline>,
  ): Promise<AlertEpisodeStateTimeline> {
    /*
     * The per-entity mutex is owned here, around the whole create, rather than
     * inside onBeforeCreate. DatabaseService.create() invokes onBeforeCreate and
     * then runs validation, permission checks and the INSERT before it ever
     * reaches onCreateSuccess, all OUTSIDE any try/catch this service can hook
     * (onCreateError never fires for a throw raised before the INSERT). So a
     * mutex acquired in onBeforeCreate and released in onCreateSuccess leaks on
     * any throw in between, and a leaked redis-semaphore mutex never expires - it
     * keeps refreshing its own Redis key for the life of the process. Holding it
     * in a try/finally here releases it on every path.
     */
    if (createBy.props.ignoreHooks || !createBy.data.alertEpisodeId) {
      // No predecessor bookkeeping runs on these paths, so no serialization is needed.
      return await super.create(createBy);
    }

    const logAttributes: LogAttributes = {
      projectId: createBy.data.projectId?.toString(),
      alertEpisodeId: createBy.data.alertEpisodeId?.toString(),
    } as LogAttributes;

    let mutex: SemaphoreMutex | null = null;

    try {
      mutex = await Semaphore.lock({
        key: createBy.data.alertEpisodeId.toString(),
        namespace: "AlertEpisodeStateTimeline.create",
      });
    } catch (e) {
      /*
       * Fail closed. This used to fall through and INSERT UNLOCKED, which let two
       * concurrent writers resolve the same predecessor and both INSERT a state
       * row milliseconds apart; only the later one is ever closed, so the earlier
       * is orphaned with endsAt = NULL forever and read back as unbounded
       * downtime. Refusing the write is strictly safer: the next write for this
       * entity re-evaluates and recreates the state change.
       */
      logger.error(e, logAttributes);
      throw new ServerException(
        ALERT_EPISODE_STATE_TIMELINE_LOCK_ERROR_MESSAGE,
      );
    }

    try {
      return await super.create(createBy);
    } finally {
      await this.releaseMutex(mutex, logAttributes);
    }
  }

  /*
   * Releases the per-entity mutex. Never throws: a failed release must not mask an
   * error we are already unwinding, nor fail an otherwise successful create.
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

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<AlertEpisodeStateTimeline>,
  ): Promise<OnCreate<AlertEpisodeStateTimeline>> {
    if (!createBy.data.alertEpisodeId) {
      throw new BadDataException("alertEpisodeId is null");
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
        createBy.data.rootCause = `Episode state created by ${await UserService.getUserMarkdownString(
          {
            userId: userId!,
            projectId: createBy.data.projectId || createBy.props.tenantId!,
          },
        )}`;
      }
    }

    const alertStateId: ObjectID | undefined | null =
      createBy.data.alertStateId || createBy.data.alertState?.id;

    if (!alertStateId) {
      throw new BadDataException("alertStateId is null");
    }

    const stateBeforeThis: AlertEpisodeStateTimeline | null =
      await this.findOneBy({
        query: {
          alertEpisodeId: createBy.data.alertEpisodeId,
          startsAt: QueryHelper.lessThanEqualTo(createBy.data.startsAt),
        },
        sort: {
          startsAt: SortOrder.Descending,
        },
        props: {
          isRoot: true,
        },
        select: {
          alertStateId: true,
          alertState: {
            order: true,
            name: true,
          },
          startsAt: true,
          endsAt: true,
        },
      });

    logger.debug("State Before this", {
      projectId: createBy.data.projectId?.toString(),
      alertEpisodeId: createBy.data.alertEpisodeId?.toString(),
    } as LogAttributes);
    logger.debug(stateBeforeThis, {
      projectId: createBy.data.projectId?.toString(),
      alertEpisodeId: createBy.data.alertEpisodeId?.toString(),
    } as LogAttributes);

    // If this is the first state, then do not notify the owner.
    if (!stateBeforeThis) {
      // since this is the first status, do not notify the owner.
      createBy.data.isOwnerNotified = true;
    }

    // Check if this new state and the previous state are same.
    if (stateBeforeThis && stateBeforeThis.alertStateId && alertStateId) {
      if (stateBeforeThis.alertStateId.toString() === alertStateId.toString()) {
        throw new BadDataException(
          "Episode state cannot be same as previous state.",
        );
      }
    }

    const stateAfterThis: AlertEpisodeStateTimeline | null =
      await this.findOneBy({
        query: {
          alertEpisodeId: createBy.data.alertEpisodeId,
          startsAt: QueryHelper.greaterThan(createBy.data.startsAt),
        },
        sort: {
          startsAt: SortOrder.Ascending,
        },
        props: {
          isRoot: true,
        },
        select: {
          alertStateId: true,
          startsAt: true,
          endsAt: true,
        },
      });

    // compute ends at. It's the start of the next status.
    if (stateAfterThis && stateAfterThis.startsAt) {
      createBy.data.endsAt = stateAfterThis.startsAt;
    }

    // Check if this new state and the next state are same.
    if (stateAfterThis && stateAfterThis.alertStateId && alertStateId) {
      if (stateAfterThis.alertStateId.toString() === alertStateId.toString()) {
        throw new BadDataException(
          "Episode state cannot be same as next state.",
        );
      }
    }

    logger.debug("State After this", {
      projectId: createBy.data.projectId?.toString(),
      alertEpisodeId: createBy.data.alertEpisodeId?.toString(),
    } as LogAttributes);
    logger.debug(stateAfterThis, {
      projectId: createBy.data.projectId?.toString(),
      alertEpisodeId: createBy.data.alertEpisodeId?.toString(),
    } as LogAttributes);

    return {
      createBy,
      carryForward: {
        statusTimelineBeforeThisStatus: stateBeforeThis || null,
        statusTimelineAfterThisStatus: stateAfterThis || null,
      },
    };
  }

  @CaptureSpan()
  protected override async onCreateSuccess(
    onCreate: OnCreate<AlertEpisodeStateTimeline>,
    createdItem: AlertEpisodeStateTimeline,
  ): Promise<AlertEpisodeStateTimeline> {
    if (!createdItem.alertEpisodeId) {
      throw new BadDataException("alertEpisodeId is null");
    }

    if (!createdItem.alertStateId) {
      throw new BadDataException("alertStateId is null");
    }

    logger.debug("Status Timeline Before this", {
      projectId: createdItem.projectId?.toString(),
      alertEpisodeId: createdItem.alertEpisodeId?.toString(),
    } as LogAttributes);
    logger.debug(onCreate.carryForward.statusTimelineBeforeThisStatus, {
      projectId: createdItem.projectId?.toString(),
      alertEpisodeId: createdItem.alertEpisodeId?.toString(),
    } as LogAttributes);

    logger.debug("Status Timeline After this", {
      projectId: createdItem.projectId?.toString(),
      alertEpisodeId: createdItem.alertEpisodeId?.toString(),
    } as LogAttributes);
    logger.debug(onCreate.carryForward.statusTimelineAfterThisStatus, {
      projectId: createdItem.projectId?.toString(),
      alertEpisodeId: createdItem.alertEpisodeId?.toString(),
    } as LogAttributes);

    logger.debug("Created Item", {
      projectId: createdItem.projectId?.toString(),
      alertEpisodeId: createdItem.alertEpisodeId?.toString(),
    } as LogAttributes);
    logger.debug(createdItem, {
      projectId: createdItem.projectId?.toString(),
      alertEpisodeId: createdItem.alertEpisodeId?.toString(),
    } as LogAttributes);

    // Handle timeline updates
    if (!onCreate.carryForward.statusTimelineBeforeThisStatus) {
      // This is the first status, no need to update previous status.
      logger.debug("This is the first status.", {
        projectId: createdItem.projectId?.toString(),
        alertEpisodeId: createdItem.alertEpisodeId?.toString(),
      } as LogAttributes);
    } else if (!onCreate.carryForward.statusTimelineAfterThisStatus) {
      // This is the last status. Update the previous status to end at the start of this status.
      await this.updateOneById({
        id: onCreate.carryForward.statusTimelineBeforeThisStatus.id!,
        data: {
          endsAt: createdItem.startsAt!,
        },
        props: {
          isRoot: true,
        },
      });
      logger.debug("This is the last status.", {
        projectId: createdItem.projectId?.toString(),
        alertEpisodeId: createdItem.alertEpisodeId?.toString(),
      } as LogAttributes);
    } else {
      // This is in the middle. Update the previous status to end at the start of this status.
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
      logger.debug("This status is in the middle.", {
        projectId: createdItem.projectId?.toString(),
        alertEpisodeId: createdItem.alertEpisodeId?.toString(),
      } as LogAttributes);
    }

    // Update episode's current state if this is the latest timeline entry
    if (!createdItem.endsAt) {
      const updateData: {
        currentAlertStateId: ObjectID;
        resolvedAt?: Date | null;
      } = {
        currentAlertStateId: createdItem.alertStateId,
      };

      // Check if the new state is a resolved state and update resolvedAt accordingly
      const newAlertState: AlertState | null =
        await AlertStateService.findOneById({
          id: createdItem.alertStateId,
          select: {
            isResolvedState: true,
          },
          props: {
            isRoot: true,
          },
        });

      if (newAlertState?.isResolvedState) {
        // Set resolvedAt when transitioning to resolved state
        updateData.resolvedAt = OneUptimeDate.getCurrentDate();
      } else {
        // Clear resolvedAt when transitioning away from resolved state
        updateData.resolvedAt = null;
      }

      await AlertEpisodeService.updateOneBy({
        query: {
          _id: createdItem.alertEpisodeId?.toString(),
        },
        data: updateData,
        props: onCreate.createBy.props,
      });

      // Cascade state change to all member alerts
      if (createdItem.projectId) {
        try {
          await AlertEpisodeService.cascadeStateToMemberAlerts({
            projectId: createdItem.projectId,
            episodeId: createdItem.alertEpisodeId,
            alertStateId: createdItem.alertStateId,
            props: {
              isRoot: true,
            },
          });
        } catch (error) {
          logger.error(
            `Failed to cascade state change to member alerts: ${error}`,
            {
              projectId: createdItem.projectId?.toString(),
              alertEpisodeId: createdItem.alertEpisodeId?.toString(),
            } as LogAttributes,
          );
        }
      }
    }

    const alertState: AlertState | null = await AlertStateService.findOneBy({
      query: {
        _id: createdItem.alertStateId.toString()!,
      },
      props: {
        isRoot: true,
      },
      select: {
        _id: true,
        isResolvedState: true,
        isAcknowledgedState: true,
        isCreatedState: true,
        color: true,
        name: true,
      },
    });

    const stateName: string = alertState?.name || "";
    let stateEmoji: string = "➡️";

    if (alertState?.isResolvedState) {
      stateEmoji = "✅";
    } else if (alertState?.isAcknowledgedState) {
      stateEmoji = "👀";
    } else if (alertState?.isCreatedState) {
      stateEmoji = "🔴";
    }

    const episode: AlertEpisode | null = await AlertEpisodeService.findOneById({
      id: createdItem.alertEpisodeId,
      select: {
        episodeNumber: true,
        episodeNumberWithPrefix: true,
      },
      props: {
        isRoot: true,
      },
    });

    const episodeDisplayNumber: string =
      episode?.episodeNumberWithPrefix || "#" + (episode?.episodeNumber || 0);

    await AlertEpisodeFeedService.createAlertEpisodeFeedItem({
      alertEpisodeId: createdItem.alertEpisodeId!,
      projectId: createdItem.projectId!,
      alertEpisodeFeedEventType: AlertEpisodeFeedEventType.EpisodeStateChanged,
      displayColor: alertState?.color,
      feedInfoInMarkdown:
        stateEmoji +
        ` Changed **Episode ${episodeDisplayNumber} State** to **` +
        stateName +
        "**",
      moreInformationInMarkdown: createdItem.rootCause
        ? `**Cause:** \n${createdItem.rootCause}`
        : undefined,
      userId: createdItem.createdByUserId || onCreate.createBy.props.userId,
      workspaceNotification: {
        sendWorkspaceNotification: true,
        notifyUserId:
          createdItem.createdByUserId || onCreate.createBy.props.userId,
      },
    });

    return createdItem;
  }

  @CaptureSpan()
  protected override async onBeforeDelete(
    deleteBy: DeleteBy<AlertEpisodeStateTimeline>,
  ): Promise<OnDelete<AlertEpisodeStateTimeline>> {
    if (deleteBy.query._id) {
      const episodeStateTimelineToBeDeleted: AlertEpisodeStateTimeline | null =
        await this.findOneById({
          id: new ObjectID(deleteBy.query._id as string),
          select: {
            alertEpisodeId: true,
            startsAt: true,
            endsAt: true,
          },
          props: {
            isRoot: true,
          },
        });

      const episodeId: ObjectID | undefined =
        episodeStateTimelineToBeDeleted?.alertEpisodeId;

      if (episodeId) {
        const episodeStateTimeline: PositiveNumber = await this.countBy({
          query: {
            alertEpisodeId: episodeId,
          },
          props: {
            isRoot: true,
          },
        });

        if (!episodeStateTimelineToBeDeleted) {
          throw new BadDataException("Episode state timeline not found.");
        }

        if (episodeStateTimeline.isOne()) {
          throw new BadDataException(
            "Cannot delete the only state timeline. Episode should have at least one state in its timeline.",
          );
        }

        // Handle timeline adjustments
        const stateBeforeThis: AlertEpisodeStateTimeline | null =
          await this.findOneBy({
            query: {
              _id: QueryHelper.notEquals(deleteBy.query._id as string),
              alertEpisodeId: episodeId,
              startsAt: QueryHelper.lessThanEqualTo(
                episodeStateTimelineToBeDeleted.startsAt!,
              ),
            },
            sort: {
              startsAt: SortOrder.Descending,
            },
            props: {
              isRoot: true,
            },
            select: {
              alertStateId: true,
              startsAt: true,
              endsAt: true,
            },
          });

        const stateAfterThis: AlertEpisodeStateTimeline | null =
          await this.findOneBy({
            query: {
              alertEpisodeId: episodeId,
              startsAt: QueryHelper.greaterThan(
                episodeStateTimelineToBeDeleted.startsAt!,
              ),
            },
            sort: {
              startsAt: SortOrder.Ascending,
            },
            props: {
              isRoot: true,
            },
            select: {
              alertStateId: true,
              startsAt: true,
              endsAt: true,
            },
          });

        if (!stateBeforeThis) {
          // This is the first state, no need to update previous state.
          logger.debug("This is the first state.", {
            alertEpisodeId: episodeId?.toString(),
          } as LogAttributes);
        } else if (!stateAfterThis) {
          // This is the last state. Update the previous state to end at the end of this state.
          await this.updateOneById({
            id: stateBeforeThis.id!,
            data: {
              endsAt: episodeStateTimelineToBeDeleted.endsAt!,
            },
            props: {
              isRoot: true,
            },
          });
          logger.debug("This is the last state.", {
            alertEpisodeId: episodeId?.toString(),
          } as LogAttributes);
        } else {
          // This state is in the middle. Update the previous state to end at the start of the next state.
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
              startsAt: episodeStateTimelineToBeDeleted.startsAt!,
            },
            props: {
              isRoot: true,
            },
          });
          logger.debug("This state is in the middle.", {
            alertEpisodeId: episodeId?.toString(),
          } as LogAttributes);
        }
      }

      return { deleteBy, carryForward: episodeId };
    }

    return { deleteBy, carryForward: null };
  }

  @CaptureSpan()
  protected override async onDeleteSuccess(
    onDelete: OnDelete<AlertEpisodeStateTimeline>,
    _itemIdsBeforeDelete: ObjectID[],
  ): Promise<OnDelete<AlertEpisodeStateTimeline>> {
    if (onDelete.carryForward) {
      const episodeId: ObjectID = onDelete.carryForward as ObjectID;

      // Get last status of this episode.
      const episodeStateTimeline: AlertEpisodeStateTimeline | null =
        await this.findOneBy({
          query: {
            alertEpisodeId: episodeId,
          },
          sort: {
            startsAt: SortOrder.Descending,
          },
          props: {
            isRoot: true,
          },
          select: {
            _id: true,
            alertStateId: true,
          },
        });

      if (episodeStateTimeline && episodeStateTimeline.alertStateId) {
        await AlertEpisodeService.updateOneBy({
          query: {
            _id: episodeId.toString(),
          },
          data: {
            currentAlertStateId: episodeStateTimeline.alertStateId,
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
