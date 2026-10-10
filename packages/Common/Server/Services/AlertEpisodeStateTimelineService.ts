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
import { SemaphoreMutex } from "../Infrastructure/Semaphore";
import StateChangeLock from "../Utils/StateChangeLock";
import StateChangeFollowOn from "../Utils/StateChangeFollowOn";
import Exception from "../../Types/Exception/Exception";
import AlertEpisodeService from "./AlertEpisodeService";
import AlertEpisodeInternalNote from "../../Models/DatabaseModels/AlertEpisodeInternalNote";
import AlertEpisodeInternalNoteService from "./AlertEpisodeInternalNoteService";
import { JSONObject } from "../../Types/JSON";
import StateChangeNote from "../Utils/StateChangeNote";
import StateChangeFeedEmoji from "../Utils/StateChangeFeedEmoji";
import FeedMarkdown, { mdText } from "../../Utils/Markdown/FeedMarkdown";

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

      /*
       * The private note that comes with the change, if any (a blank one is
       * none). It is posted once the change is saved (onCreateSuccess), as
       * the person changing the state, so that it comes after the change in
       * the episode's feed and a change that fails leaves no note behind.
       * Whether they may post it is asked now, before the change takes its
       * lock or reads the timeline, with the check the note's own create
       * runs: a change whose note they may not post is refused whole, with
       * one plain message, rather than saved and then answered with an
       * error (StateChangeNote).
       */
      const privateNotesToPost: Array<AlertEpisodeInternalNote> =
        StateChangeNote.preparePrivateNotes({
          noteModelType: AlertEpisodeInternalNote,
          stateChange: createBy.data,
          eventColumn: "alertEpisodeId",
          miscDataProps: createBy.miscDataProps as JSONObject | undefined,
          props: createBy.props,
        });

      // The episode's lock: given back in onCreateSuccess or onCreateError.
      mutex = await StateChangeLock.take({
        namespace: "AlertEpisodeStateTimeline.create",
        eventId: createBy.data.alertEpisodeId,
        logAttributes: {
          projectId: createBy.data.projectId?.toString(),
          alertEpisodeId: createBy.data.alertEpisodeId?.toString(),
        } as LogAttributes,
      });

      // Who made the change, under either name of it: see CreatedByUser.
      const changedByUserId: ObjectID | null = CreatedByUser.getId(
        createBy.data,
        createBy.props,
      );

      if (changedByUserId && !createBy.data.rootCause) {
        createBy.data.rootCause =
          mdText`Episode state created by ${await UserService.getUserMarkdownString(
            {
              userId: changedByUserId,
              projectId: createBy.data.projectId || createBy.props.tenantId!,
            },
          )}`.toString();
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
          privateNotesToPost: privateNotesToPost,
          mutex: mutex,
        },
      };
    } catch (error) {
      /*
       * Refused by this hook, once the lock is taken: no create follows
       * to give it back.
       */
      await StateChangeLock.giveBack(mutex, {
        projectId: createBy.data.projectId?.toString(),
        alertEpisodeId: createBy.data.alertEpisodeId?.toString(),
      } as LogAttributes);

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

    /*
     * Whether the episode is resolved in this state, by the one rule
     * (Common/Utils/ResolvedState): the project's resolved state, or a state
     * placed after it, flagged or not.
     */
    const isResolvedState: boolean =
      await AlertStateService.isResolvedAlertState({
        projectId: createdItem.projectId!,
        alertStateId: createdItem.alertStateId,
      });

    // Update episode's current state if this is the latest timeline entry
    if (!createdItem.endsAt) {
      const updateData: {
        currentAlertStateId: ObjectID;
        resolvedAt?: Date | null;
      } = {
        currentAlertStateId: createdItem.alertStateId,
      };

      /*
       * resolvedAt is when the episode was resolved: stamped when it moves
       * into a resolved state, kept while it moves on from one resolved
       * state to another ("Resolved" to "Closed"), and cleared when it is
       * reopened into one that is not. The Active episode lists, grouping
       * and auto-resolve read it.
       */
      if (isResolvedState) {
        const episode: AlertEpisode | null =
          await AlertEpisodeService.findOneById({
            id: createdItem.alertEpisodeId,
            select: {
              resolvedAt: true,
            },
            props: {
              isRoot: true,
            },
          });

        if (!episode?.resolvedAt) {
          updateData.resolvedAt = OneUptimeDate.getCurrentDate();
        }
      } else {
        updateData.resolvedAt = null;
      }

      /*
       * As OneUptime's own write, derived from the timeline: the permission
       * to create the change is the permission to change the episode's state
       * (StateChangeFollowOn).
       */
      await AlertEpisodeService.updateOneBy({
        query: {
          _id: createdItem.alertEpisodeId?.toString(),
        },
        data: updateData,
        props: StateChangeFollowOn.getEventWriteProps(onCreate.createBy.props),
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

    await StateChangeLock.giveBackFor(onCreate, {
      projectId: createdItem.projectId?.toString(),
      alertEpisodeId: createdItem.alertEpisodeId?.toString(),
    } as LogAttributes);

    const alertState: AlertState | null = await AlertStateService.findOneBy({
      query: {
        _id: createdItem.alertStateId.toString()!,
      },
      props: {
        isRoot: true,
      },
      select: {
        _id: true,
        isCreatedState: true,
        color: true,
        name: true,
      },
    });

    /*
     * Acknowledged by the one rule (Common/Utils/AcknowledgedState): the
     * acknowledged state, a state placed after it, or a resolved one.
     */
    const isAcknowledged: boolean =
      await AlertStateService.isAcknowledgedAlertState({
        projectId: createdItem.projectId!,
        alertStateId: createdItem.alertStateId,
      });

    /*
     * The state's name is plain text, placed into the feed item's Markdown
     * (posted to Slack and Teams too) as text (mdText), so it reads as typed.
     */
    const stateName: string = alertState?.name || "";
    const stateEmoji: string = StateChangeFeedEmoji.get({
      isResolved: isResolvedState,
      isAcknowledged: isAcknowledged,
      isCreatedState: Boolean(alertState?.isCreatedState),
    });

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
        mdText`${stateEmoji} Changed **Episode ${episodeDisplayNumber} State** to **${stateName}**`.toString(),
      moreInformationInMarkdown: createdItem.rootCause
        ? mdText`**Cause:** \n${FeedMarkdown.asMarkdown(createdItem.rootCause)}`.toString()
        : undefined,
      userId: createdItem.createdByUserId || onCreate.createBy.props.userId,
      workspaceNotification: {
        sendWorkspaceNotification: true,
        notifyUserId:
          createdItem.createdByUserId || onCreate.createBy.props.userId,
      },
    });

    /*
     * The private notes that came with the change, which onBeforeCreate built
     * and made sure may be posted: posted now, after the change, at the time
     * the change was saved with, as the person who changed the state.
     */
    await StateChangeNote.postPrivateNotes({
      notes: onCreate.carryForward.privateNotesToPost,
      noteService: AlertEpisodeInternalNoteService,
      savedStateChange: createdItem,
      props: onCreate.createBy.props,
    });

    return createdItem;
  }

  /*
   * A change refused or failed once onBeforeCreate took the episode's lock -
   * by a check DatabaseService.create runs after the hook, at the INSERT,
   * or in onCreateSuccess before it gave the lock back - gives it back
   * here (StateChangeLock). Left held, every later change to the episode
   * would wait out the lock and then go ahead without it.
   */
  @CaptureSpan()
  protected override async onCreateError(
    error: Exception,
    onCreate?: OnCreate<AlertEpisodeStateTimeline> | undefined,
  ): Promise<Exception> {
    await StateChangeLock.giveBackFor(onCreate, {
      projectId: onCreate?.createBy.data.projectId?.toString(),
      alertEpisodeId: onCreate?.createBy.data.alertEpisodeId?.toString(),
    } as LogAttributes);

    return error;
  }

  @CaptureSpan()
  protected override async onBeforeDelete(
    deleteBy: DeleteBy<AlertEpisodeStateTimeline>,
  ): Promise<OnDelete<AlertEpisodeStateTimeline>> {
    /*
     * OneUptime's own deletes of entries - a retention purge, a cleanup -
     * move no neighbour unless they name one entry by its id.
     */
    if (deleteBy.props.isRoot && !Service.getOneRowIdNamedBy(deleteBy.query)) {
      return { deleteBy, carryForward: null };
    }

    /*
     * The one entry the delete removes, and the delete held to it: its
     * neighbours close the gap it leaves, so entries go one at a time.
     */
    const toBeDeleted: {
      row: AlertEpisodeStateTimeline | null;
      deletesMore: boolean;
    } = await this.findOneRowAndHoldDeleteToIt(deleteBy, {
      alertEpisodeId: true,
      startsAt: true,
      endsAt: true,
    });

    if (toBeDeleted.deletesMore) {
      throw new BadDataException(
        "Delete one episode state timeline entry at a time.",
      );
    }

    if (toBeDeleted.row) {
      const episodeStateTimelineToBeDeleted: AlertEpisodeStateTimeline | null =
        toBeDeleted.row;

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
              _id: QueryHelper.notEquals(
                episodeStateTimelineToBeDeleted.id!.toString(),
              ),
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
