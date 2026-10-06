import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import { OnCreate, OnDelete } from "../Types/Database/Hooks";
import QueryHelper from "../Types/Database/QueryHelper";
import ProjectReferencesService from "./ProjectReferencesService";
import AlertStateService from "./AlertStateService";
import UserService from "./UserService";
import CreatedByUser from "../Utils/Database/CreatedByUser";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import OneUptimeDate from "../../Types/Date";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import RelationIdUtil from "../Utils/Database/RelationIdUtil";
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
import AlertEpisodeInternalNote from "../../Models/DatabaseModels/AlertEpisodeInternalNote";
import AlertEpisodeInternalNoteService from "./AlertEpisodeInternalNoteService";
import { JSONObject } from "../../Types/JSON";
import StateChangeNote from "../Utils/StateChangeNote";

export class Service extends ProjectReferencesService<AlertEpisodeStateTimeline> {
  public constructor() {
    super(AlertEpisodeStateTimeline);
    if (IsBillingEnabled) {
      this.hardDeleteItemsOlderThanInDays("createdAt", 3 * 365); // 3 years
    }
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<AlertEpisodeStateTimeline>,
  ): Promise<OnCreate<AlertEpisodeStateTimeline>> {
    await super.onBeforeCreate(createBy);

    if (!createBy.data.alertEpisodeId) {
      throw new BadDataException("alertEpisodeId is null");
    }

    let mutex: SemaphoreMutex | null = null;

    try {
      if (!createBy.data.startsAt) {
        createBy.data.startsAt = OneUptimeDate.getCurrentDate();
      }

      try {
        mutex = await Semaphore.lock({
          key: createBy.data.alertEpisodeId.toString(),
          namespace: "AlertEpisodeStateTimeline.create",
        });
      } catch (err) {
        logger.error(err, {
          projectId: createBy.data.projectId?.toString(),
          alertEpisodeId: createBy.data.alertEpisodeId?.toString(),
        } as LogAttributes);
      }

      /*
       * The private note that comes with the change, if any (a blank one is
       * none). It is posted once the change is saved (onCreateSuccess), as
       * the person changing the state, so that it comes after the change in
       * the episode's feed. Whether they may post it is asked now, before
       * anything is read or written, with the check the note's own create
       * runs: a change whose note they may not post is refused whole, with
       * one plain message, rather than saved and then answered with an
       * error (StateChangeNote).
       */
      const privateNoteToPost: AlertEpisodeInternalNote | undefined =
        StateChangeNote.preparePrivateNote({
          miscDataProps: createBy.miscDataProps as JSONObject | undefined,
          noteModelType: AlertEpisodeInternalNote,
          props: createBy.props,
          fill: (note: AlertEpisodeInternalNote, text: string): void => {
            note.alertEpisodeId = createBy.data.alertEpisodeId!;
            note.note = text;
            note.createdAt = createBy.data.startsAt!;

            const noteProjectId: ObjectID | undefined =
              createBy.data.projectId || createBy.props.tenantId;

            if (noteProjectId) {
              note.projectId = noteProjectId;
            }
          },
        });

      // Who made the change, under either name of it: see CreatedByUser.
      const changedByUserId: ObjectID | null = CreatedByUser.getId(
        createBy.data,
        createBy.props,
      );

      if (changedByUserId && !createBy.data.rootCause) {
        createBy.data.rootCause = `Episode state created by ${await UserService.getUserMarkdownString(
          {
            userId: changedByUserId,
            projectId: createBy.data.projectId || createBy.props.tenantId!,
          },
        )}`;
      }

      // Under either of its names; the two must agree.
      const alertStateId: ObjectID | null = RelationIdUtil.readConsistent(
        createBy.data as unknown as Record<string, unknown>,
        ["alertStateId", "alertState"],
        "Alert State",
      );

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
        if (
          stateBeforeThis.alertStateId.toString() === alertStateId.toString()
        ) {
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
        if (
          stateAfterThis.alertStateId.toString() === alertStateId.toString()
        ) {
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
          privateNoteToPost: privateNoteToPost,
          mutex: mutex,
        },
      };
    } catch (error) {
      // release the mutex if it was acquired.
      if (mutex) {
        try {
          await Semaphore.release(mutex);
        } catch (err) {
          logger.error(err, {
            projectId: createBy.data.projectId?.toString(),
            alertEpisodeId: createBy.data.alertEpisodeId?.toString(),
          } as LogAttributes);
        }
      }

      throw error;
    }
  }

  @CaptureSpan()
  protected override async onCreateSuccess(
    onCreate: OnCreate<AlertEpisodeStateTimeline>,
    createdItem: AlertEpisodeStateTimeline,
  ): Promise<AlertEpisodeStateTimeline> {
    if (!createdItem.alertEpisodeId) {
      throw new BadDataException("alertEpisodeId is null");
    }

    const mutex: SemaphoreMutex | null = onCreate.carryForward.mutex;

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

    if (mutex) {
      try {
        await Semaphore.release(mutex);
      } catch (err) {
        logger.error(err, {
          projectId: createdItem.projectId?.toString(),
          alertEpisodeId: createdItem.alertEpisodeId?.toString(),
        } as LogAttributes);
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

    /*
     * The private note that came with the change, which onBeforeCreate built
     * and made sure may be posted: posted now, after the change, at the time
     * the change was saved with, as the person who changed the state.
     */
    if (onCreate.carryForward.privateNoteToPost) {
      const episodeInternalNote: AlertEpisodeInternalNote =
        onCreate.carryForward.privateNoteToPost;
      episodeInternalNote.createdAt = createdItem.startsAt!;
      episodeInternalNote.projectId = createdItem.projectId!;

      await AlertEpisodeInternalNoteService.create({
        data: episodeInternalNote,
        props: onCreate.createBy.props,
      });
    }

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
