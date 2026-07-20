import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import { OnCreate, OnDelete } from "../Types/Database/Hooks";
import QueryHelper from "../Types/Database/QueryHelper";
import DatabaseService from "./DatabaseService";
import IncidentStateService from "./IncidentStateService";
import UserService from "./UserService";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import OneUptimeDate from "../../Types/Date";
import BadDataException from "../../Types/Exception/BadDataException";
import ServerException from "../../Types/Exception/ServerException";
import ObjectID from "../../Types/ObjectID";
import PositiveNumber from "../../Types/PositiveNumber";
import IncidentState from "../../Models/DatabaseModels/IncidentState";
import IncidentEpisode from "../../Models/DatabaseModels/IncidentEpisode";
import IncidentEpisodeStateTimeline from "../../Models/DatabaseModels/IncidentEpisodeStateTimeline";
import { IsBillingEnabled } from "../EnvironmentConfig";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import logger, { LogAttributes } from "../Utils/Logger";
import IncidentEpisodeFeedService from "./IncidentEpisodeFeedService";
import { IncidentEpisodeFeedEventType } from "../../Models/DatabaseModels/IncidentEpisodeFeed";
import Semaphore, { SemaphoreMutex } from "../Infrastructure/Semaphore";
import IncidentEpisodeService from "./IncidentEpisodeService";

/*
 * Thrown by create() when the per-entity mutex cannot be acquired. The write is
 * refused rather than performed unlocked. Ingest/caller sites that already swallow
 * the same-as-previous BadDataException match on this to log and skip.
 */
export const INCIDENT_EPISODE_STATE_TIMELINE_LOCK_ERROR_MESSAGE: string =
  "Could not acquire the incident episode state timeline lock for this episode.";

export class Service extends DatabaseService<IncidentEpisodeStateTimeline> {
  public constructor() {
    super(IncidentEpisodeStateTimeline);
    if (IsBillingEnabled) {
      this.hardDeleteItemsOlderThanInDays("createdAt", 3 * 365); // 3 years
    }
  }

  @CaptureSpan()
  public override async create(
    createBy: CreateBy<IncidentEpisodeStateTimeline>,
  ): Promise<IncidentEpisodeStateTimeline> {
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
    if (createBy.props.ignoreHooks || !createBy.data.incidentEpisodeId) {
      // No predecessor bookkeeping runs on these paths, so no serialization is needed.
      return await super.create(createBy);
    }

    const logAttributes: LogAttributes = {
      projectId: createBy.data.projectId?.toString(),
      incidentEpisodeId: createBy.data.incidentEpisodeId?.toString(),
    } as LogAttributes;

    let mutex: SemaphoreMutex | null = null;

    try {
      mutex = await Semaphore.lock({
        key: createBy.data.incidentEpisodeId.toString(),
        namespace: "IncidentEpisodeStateTimeline.create",
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
        INCIDENT_EPISODE_STATE_TIMELINE_LOCK_ERROR_MESSAGE,
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
    createBy: CreateBy<IncidentEpisodeStateTimeline>,
  ): Promise<OnCreate<IncidentEpisodeStateTimeline>> {
    if (!createBy.data.incidentEpisodeId) {
      throw new BadDataException("incidentEpisodeId is null");
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

    const incidentStateId: ObjectID | undefined | null =
      createBy.data.incidentStateId || createBy.data.incidentState?.id;

    if (!incidentStateId) {
      throw new BadDataException("incidentStateId is null");
    }

    const stateBeforeThis: IncidentEpisodeStateTimeline | null =
      await this.findOneBy({
        query: {
          incidentEpisodeId: createBy.data.incidentEpisodeId,
          startsAt: QueryHelper.lessThanEqualTo(createBy.data.startsAt),
        },
        sort: {
          startsAt: SortOrder.Descending,
        },
        props: {
          isRoot: true,
        },
        select: {
          incidentStateId: true,
          incidentState: {
            order: true,
            name: true,
          },
          startsAt: true,
          endsAt: true,
        },
      });

    logger.debug("State Before this", {
      projectId: createBy.data.projectId?.toString(),
      incidentEpisodeId: createBy.data.incidentEpisodeId?.toString(),
    } as LogAttributes);
    logger.debug(stateBeforeThis, {
      projectId: createBy.data.projectId?.toString(),
      incidentEpisodeId: createBy.data.incidentEpisodeId?.toString(),
    } as LogAttributes);

    // If this is the first state, then do not notify the owner.
    if (!stateBeforeThis) {
      // since this is the first status, do not notify the owner.
      createBy.data.isOwnerNotified = true;
    }

    // Check if this new state and the previous state are same.
    if (stateBeforeThis && stateBeforeThis.incidentStateId && incidentStateId) {
      if (
        stateBeforeThis.incidentStateId.toString() ===
        incidentStateId.toString()
      ) {
        throw new BadDataException(
          "Episode state cannot be same as previous state.",
        );
      }
    }

    const stateAfterThis: IncidentEpisodeStateTimeline | null =
      await this.findOneBy({
        query: {
          incidentEpisodeId: createBy.data.incidentEpisodeId,
          startsAt: QueryHelper.greaterThan(createBy.data.startsAt),
        },
        sort: {
          startsAt: SortOrder.Ascending,
        },
        props: {
          isRoot: true,
        },
        select: {
          incidentStateId: true,
          startsAt: true,
          endsAt: true,
        },
      });

    // compute ends at. It's the start of the next status.
    if (stateAfterThis && stateAfterThis.startsAt) {
      createBy.data.endsAt = stateAfterThis.startsAt;
    }

    // Check if this new state and the next state are same.
    if (stateAfterThis && stateAfterThis.incidentStateId && incidentStateId) {
      if (
        stateAfterThis.incidentStateId.toString() === incidentStateId.toString()
      ) {
        throw new BadDataException(
          "Episode state cannot be same as next state.",
        );
      }
    }

    logger.debug("State After this", {
      projectId: createBy.data.projectId?.toString(),
      incidentEpisodeId: createBy.data.incidentEpisodeId?.toString(),
    } as LogAttributes);
    logger.debug(stateAfterThis, {
      projectId: createBy.data.projectId?.toString(),
      incidentEpisodeId: createBy.data.incidentEpisodeId?.toString(),
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
    onCreate: OnCreate<IncidentEpisodeStateTimeline>,
    createdItem: IncidentEpisodeStateTimeline,
  ): Promise<IncidentEpisodeStateTimeline> {
    if (!createdItem.incidentEpisodeId) {
      throw new BadDataException("incidentEpisodeId is null");
    }

    if (!createdItem.incidentStateId) {
      throw new BadDataException("incidentStateId is null");
    }

    logger.debug("Status Timeline Before this", {
      projectId: createdItem.projectId?.toString(),
      incidentEpisodeId: createdItem.incidentEpisodeId?.toString(),
    } as LogAttributes);
    logger.debug(onCreate.carryForward.statusTimelineBeforeThisStatus, {
      projectId: createdItem.projectId?.toString(),
      incidentEpisodeId: createdItem.incidentEpisodeId?.toString(),
    } as LogAttributes);

    logger.debug("Status Timeline After this", {
      projectId: createdItem.projectId?.toString(),
      incidentEpisodeId: createdItem.incidentEpisodeId?.toString(),
    } as LogAttributes);
    logger.debug(onCreate.carryForward.statusTimelineAfterThisStatus, {
      projectId: createdItem.projectId?.toString(),
      incidentEpisodeId: createdItem.incidentEpisodeId?.toString(),
    } as LogAttributes);

    logger.debug("Created Item", {
      projectId: createdItem.projectId?.toString(),
      incidentEpisodeId: createdItem.incidentEpisodeId?.toString(),
    } as LogAttributes);
    logger.debug(createdItem, {
      projectId: createdItem.projectId?.toString(),
      incidentEpisodeId: createdItem.incidentEpisodeId?.toString(),
    } as LogAttributes);

    // Handle timeline updates
    if (!onCreate.carryForward.statusTimelineBeforeThisStatus) {
      // This is the first status, no need to update previous status.
      logger.debug("This is the first status.", {
        projectId: createdItem.projectId?.toString(),
        incidentEpisodeId: createdItem.incidentEpisodeId?.toString(),
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
        incidentEpisodeId: createdItem.incidentEpisodeId?.toString(),
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
        incidentEpisodeId: createdItem.incidentEpisodeId?.toString(),
      } as LogAttributes);
    }

    // Update episode's current state if this is the latest timeline entry
    if (!createdItem.endsAt) {
      const updateData: {
        currentIncidentStateId: ObjectID;
        resolvedAt?: Date | null;
      } = {
        currentIncidentStateId: createdItem.incidentStateId,
      };

      // Check if the new state is a resolved state and update resolvedAt accordingly
      const newIncidentState: IncidentState | null =
        await IncidentStateService.findOneById({
          id: createdItem.incidentStateId,
          select: {
            isResolvedState: true,
          },
          props: {
            isRoot: true,
          },
        });

      if (newIncidentState?.isResolvedState) {
        // Set resolvedAt when transitioning to resolved state
        updateData.resolvedAt = OneUptimeDate.getCurrentDate();
      } else {
        // Clear resolvedAt when transitioning away from resolved state
        updateData.resolvedAt = null;
      }

      await IncidentEpisodeService.updateOneBy({
        query: {
          _id: createdItem.incidentEpisodeId?.toString(),
        },
        data: updateData,
        props: onCreate.createBy.props,
      });

      // Cascade state change to all member incidents
      if (createdItem.projectId) {
        try {
          await IncidentEpisodeService.cascadeStateToMemberIncidents({
            projectId: createdItem.projectId,
            episodeId: createdItem.incidentEpisodeId,
            incidentStateId: createdItem.incidentStateId,
            props: {
              isRoot: true,
            },
          });
        } catch (error) {
          logger.error(
            `Failed to cascade state change to member incidents: ${error}`,
            {
              projectId: createdItem.projectId?.toString(),
              incidentEpisodeId: createdItem.incidentEpisodeId?.toString(),
            } as LogAttributes,
          );
        }
      }
    }

    const incidentState: IncidentState | null =
      await IncidentStateService.findOneBy({
        query: {
          _id: createdItem.incidentStateId.toString()!,
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

    const stateName: string = incidentState?.name || "";
    let stateEmoji: string = "➡️";

    if (incidentState?.isResolvedState) {
      stateEmoji = "✅";
    } else if (incidentState?.isAcknowledgedState) {
      stateEmoji = "👀";
    } else if (incidentState?.isCreatedState) {
      stateEmoji = "🔴";
    }

    const episode: IncidentEpisode | null =
      await IncidentEpisodeService.findOneById({
        id: createdItem.incidentEpisodeId,
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

    await IncidentEpisodeFeedService.createIncidentEpisodeFeedItem({
      incidentEpisodeId: createdItem.incidentEpisodeId!,
      projectId: createdItem.projectId!,
      incidentEpisodeFeedEventType:
        IncidentEpisodeFeedEventType.EpisodeStateChanged,
      displayColor: incidentState?.color,
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
    deleteBy: DeleteBy<IncidentEpisodeStateTimeline>,
  ): Promise<OnDelete<IncidentEpisodeStateTimeline>> {
    if (deleteBy.query._id) {
      const episodeStateTimelineToBeDeleted: IncidentEpisodeStateTimeline | null =
        await this.findOneById({
          id: new ObjectID(deleteBy.query._id as string),
          select: {
            incidentEpisodeId: true,
            startsAt: true,
            endsAt: true,
          },
          props: {
            isRoot: true,
          },
        });

      const episodeId: ObjectID | undefined =
        episodeStateTimelineToBeDeleted?.incidentEpisodeId;

      if (episodeId) {
        const episodeStateTimeline: PositiveNumber = await this.countBy({
          query: {
            incidentEpisodeId: episodeId,
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
        const stateBeforeThis: IncidentEpisodeStateTimeline | null =
          await this.findOneBy({
            query: {
              _id: QueryHelper.notEquals(deleteBy.query._id as string),
              incidentEpisodeId: episodeId,
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
              incidentStateId: true,
              startsAt: true,
              endsAt: true,
            },
          });

        const stateAfterThis: IncidentEpisodeStateTimeline | null =
          await this.findOneBy({
            query: {
              incidentEpisodeId: episodeId,
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
              incidentStateId: true,
              startsAt: true,
              endsAt: true,
            },
          });

        if (!stateBeforeThis) {
          // This is the first state, no need to update previous state.
          logger.debug("This is the first state.", {
            incidentEpisodeId: episodeId?.toString(),
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
            incidentEpisodeId: episodeId?.toString(),
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
            incidentEpisodeId: episodeId?.toString(),
          } as LogAttributes);
        }
      }

      return { deleteBy, carryForward: episodeId };
    }

    return { deleteBy, carryForward: null };
  }

  @CaptureSpan()
  protected override async onDeleteSuccess(
    onDelete: OnDelete<IncidentEpisodeStateTimeline>,
    _itemIdsBeforeDelete: ObjectID[],
  ): Promise<OnDelete<IncidentEpisodeStateTimeline>> {
    if (onDelete.carryForward) {
      const episodeId: ObjectID = onDelete.carryForward as ObjectID;

      // Get last status of this episode.
      const episodeStateTimeline: IncidentEpisodeStateTimeline | null =
        await this.findOneBy({
          query: {
            incidentEpisodeId: episodeId,
          },
          sort: {
            startsAt: SortOrder.Descending,
          },
          props: {
            isRoot: true,
          },
          select: {
            _id: true,
            incidentStateId: true,
          },
        });

      if (episodeStateTimeline && episodeStateTimeline.incidentStateId) {
        await IncidentEpisodeService.updateOneBy({
          query: {
            _id: episodeId.toString(),
          },
          data: {
            currentIncidentStateId: episodeStateTimeline.incidentStateId,
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
