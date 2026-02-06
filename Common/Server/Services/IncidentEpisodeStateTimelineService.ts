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
import ObjectID from "../../Types/ObjectID";
import PositiveNumber from "../../Types/PositiveNumber";
import IncidentState from "../../Models/DatabaseModels/IncidentState";
import IncidentEpisode from "../../Models/DatabaseModels/IncidentEpisode";
import IncidentEpisodeStateTimeline from "../../Models/DatabaseModels/IncidentEpisodeStateTimeline";
import { IsBillingEnabled } from "../EnvironmentConfig";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import logger from "../Utils/Logger";
import IncidentEpisodeFeedService from "./IncidentEpisodeFeedService";
import { IncidentEpisodeFeedEventType } from "../../Models/DatabaseModels/IncidentEpisodeFeed";
import Semaphore, { SemaphoreMutex } from "../Infrastructure/Semaphore";
import IncidentEpisodeService from "./IncidentEpisodeService";

export class Service extends DatabaseService<IncidentEpisodeStateTimeline> {
  public constructor() {
    super(IncidentEpisodeStateTimeline);
    if (IsBillingEnabled) {
      this.hardDeleteItemsOlderThanInDays("createdAt", 3 * 365); // 3 years
    }
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<IncidentEpisodeStateTimeline>,
  ): Promise<OnCreate<IncidentEpisodeStateTimeline>> {
    if (!createBy.data.incidentEpisodeId) {
      throw new BadDataException("incidentEpisodeId is null");
    }

    let mutex: SemaphoreMutex | null = null;

    try {
      if (!createBy.data.startsAt) {
        createBy.data.startsAt = OneUptimeDate.getCurrentDate();
      }

      try {
        mutex = await Semaphore.lock({
          key: createBy.data.incidentEpisodeId.toString(),
          namespace: "IncidentEpisodeStateTimeline.create",
        });
      } catch (err) {
        logger.error(err);
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

      logger.debug("State Before this");
      logger.debug(stateBeforeThis);

      // If this is the first state, then do not notify the owner.
      if (!stateBeforeThis) {
        // since this is the first status, do not notify the owner.
        createBy.data.isOwnerNotified = true;
      }

      // Check if this new state and the previous state are same.
      if (
        stateBeforeThis &&
        stateBeforeThis.incidentStateId &&
        incidentStateId
      ) {
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
          stateAfterThis.incidentStateId.toString() ===
          incidentStateId.toString()
        ) {
          throw new BadDataException(
            "Episode state cannot be same as next state.",
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
    onCreate: OnCreate<IncidentEpisodeStateTimeline>,
    createdItem: IncidentEpisodeStateTimeline,
  ): Promise<IncidentEpisodeStateTimeline> {
    if (!createdItem.incidentEpisodeId) {
      throw new BadDataException("incidentEpisodeId is null");
    }

    const mutex: SemaphoreMutex | null = onCreate.carryForward.mutex;

    if (!createdItem.incidentStateId) {
      throw new BadDataException("incidentStateId is null");
    }

    logger.debug("Status Timeline Before this");
    logger.debug(onCreate.carryForward.statusTimelineBeforeThisStatus);

    logger.debug("Status Timeline After this");
    logger.debug(onCreate.carryForward.statusTimelineAfterThisStatus);

    logger.debug("Created Item");
    logger.debug(createdItem);

    // Handle timeline updates
    if (!onCreate.carryForward.statusTimelineBeforeThisStatus) {
      // This is the first status, no need to update previous status.
      logger.debug("This is the first status.");
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
      logger.debug("This is the last status.");
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
      logger.debug("This status is in the middle.");
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
          );
        }
      }
    }

    if (mutex) {
      try {
        await Semaphore.release(mutex);
      } catch (err) {
        logger.error(err);
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

    const episodeDisplayNumber: string = episode?.episodeNumberWithPrefix || '#' + (episode?.episodeNumber || 0);

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
          logger.debug("This is the first state.");
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
          logger.debug("This is the last state.");
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
          logger.debug("This state is in the middle.");
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
