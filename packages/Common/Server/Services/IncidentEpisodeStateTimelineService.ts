import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import { OnCreate, OnDelete, OnUpdate } from "../Types/Database/Hooks";
import UpdateBy from "../Types/Database/UpdateBy";
import QueryHelper from "../Types/Database/QueryHelper";
import ProjectReferencesService from "./ProjectReferencesService";
import IncidentStateService from "./IncidentStateService";
import UserService from "./UserService";
import CreatedByUser from "../Utils/Database/CreatedByUser";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import OneUptimeDate from "../../Types/Date";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import { escapeMarkdownValue } from "../../Utils/Markdown/MarkdownEscape";
import RelationIdUtil from "../Utils/Database/RelationIdUtil";
import PositiveNumber from "../../Types/PositiveNumber";
import IncidentState from "../../Models/DatabaseModels/IncidentState";
import IncidentEpisode from "../../Models/DatabaseModels/IncidentEpisode";
import IncidentEpisodeStateTimeline from "../../Models/DatabaseModels/IncidentEpisodeStateTimeline";
import { IsBillingEnabled } from "../EnvironmentConfig";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import SubscriberNotificationResendAccess from "../Utils/StatusPage/SubscriberNotificationResendAccess";
import logger, { LogAttributes } from "../Utils/Logger";
import IncidentEpisodeFeedService from "./IncidentEpisodeFeedService";
import { IncidentEpisodeFeedEventType } from "../../Models/DatabaseModels/IncidentEpisodeFeed";
import Semaphore, { SemaphoreMutex } from "../Infrastructure/Semaphore";
import IncidentEpisodeService from "./IncidentEpisodeService";
import IncidentEpisodeInternalNote from "../../Models/DatabaseModels/IncidentEpisodeInternalNote";
import IncidentEpisodeInternalNoteService from "./IncidentEpisodeInternalNoteService";
import { JSONObject } from "../../Types/JSON";
import StateChangeNote from "../Utils/StateChangeNote";
import StateChangeFeedEmoji from "../Utils/StateChangeFeedEmoji";

export class Service extends ProjectReferencesService<IncidentEpisodeStateTimeline> {
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
    await super.onBeforeCreate(createBy);

    if (!createBy.data.incidentEpisodeId) {
      throw new BadDataException("incidentEpisodeId is null");
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
      const privateNotesToPost: Array<IncidentEpisodeInternalNote> =
        StateChangeNote.preparePrivateNotes({
          noteModelType: IncidentEpisodeInternalNote,
          stateChange: createBy.data,
          eventColumn: "incidentEpisodeId",
          miscDataProps: createBy.miscDataProps as JSONObject | undefined,
          props: createBy.props,
        });

      try {
        mutex = await Semaphore.lock({
          key: createBy.data.incidentEpisodeId.toString(),
          namespace: "IncidentEpisodeStateTimeline.create",
        });
      } catch (err) {
        logger.error(err, {
          projectId: createBy.data.projectId?.toString(),
          incidentEpisodeId: createBy.data.incidentEpisodeId?.toString(),
        } as LogAttributes);
      }

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
      const incidentStateId: ObjectID | null = RelationIdUtil.readConsistent(
        createBy.data as unknown as Record<string, unknown>,
        ["incidentStateId", "incidentState"],
        "Incident State",
      );

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
          privateNotesToPost: privateNotesToPost,
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
            incidentEpisodeId: createBy.data.incidentEpisodeId?.toString(),
          } as LogAttributes);
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

    /*
     * Whether the episode is resolved in this state, by the one rule
     * (Common/Utils/ResolvedState): the project's resolved state, or a state
     * placed after it, flagged or not.
     */
    const isResolvedState: boolean =
      await IncidentStateService.isResolvedIncidentState({
        projectId: createdItem.projectId!,
        incidentStateId: createdItem.incidentStateId,
      });

    // Update episode's current state if this is the latest timeline entry
    if (!createdItem.endsAt) {
      const updateData: {
        currentIncidentStateId: ObjectID;
        resolvedAt?: Date | null;
      } = {
        currentIncidentStateId: createdItem.incidentStateId,
      };

      /*
       * resolvedAt is when the episode was resolved: stamped when it moves
       * into a resolved state, kept while it moves on from one resolved
       * state to another ("Resolved" to "Closed"), and cleared when it is
       * reopened into one that is not. The Active episode lists, grouping
       * and auto-resolve read it.
       */
      if (isResolvedState) {
        const episode: IncidentEpisode | null =
          await IncidentEpisodeService.findOneById({
            id: createdItem.incidentEpisodeId,
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

    if (mutex) {
      try {
        await Semaphore.release(mutex);
      } catch (err) {
        logger.error(err, {
          projectId: createdItem.projectId?.toString(),
          incidentEpisodeId: createdItem.incidentEpisodeId?.toString(),
        } as LogAttributes);
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
      await IncidentStateService.isAcknowledgedIncidentState({
        projectId: createdItem.projectId!,
        incidentStateId: createdItem.incidentStateId,
      });

    /*
     * The state's name is plain text, placed into the feed item's Markdown
     * (posted to Slack and Teams too): escaped, so it reads as typed.
     */
    const stateName: string = escapeMarkdownValue(incidentState?.name || "");
    const stateEmoji: string = StateChangeFeedEmoji.get({
      isResolved: isResolvedState,
      isAcknowledged: isAcknowledged,
      isCreatedState: Boolean(incidentState?.isCreatedState),
    });

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

    /*
     * The private notes that came with the change, which onBeforeCreate built
     * and made sure may be posted: posted now, after the change, at the time
     * the change was saved with, as the person who changed the state.
     */
    await StateChangeNote.postPrivateNotes({
      notes: onCreate.carryForward.privateNotesToPost,
      noteService: IncidentEpisodeInternalNoteService,
      savedStateChange: createdItem,
      props: onCreate.createBy.props,
    });

    return createdItem;
  }

  /*
   * Sending a state change notification again while it is being sent would
   * let a second run send it alongside, or be overwritten when the send
   * settles (SubscriberNotificationResendAccess). No user role may write its
   * status (update: []), so this only ever stops a master admin; it is here
   * so the rule holds for every notification the same way.
   */
  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<IncidentEpisodeStateTimeline>,
  ): Promise<OnUpdate<IncidentEpisodeStateTimeline>> {
    await super.onBeforeUpdate(updateBy);

    await SubscriberNotificationResendAccess.assertNotQueuedWhileBeingSent({
      modelType: IncidentEpisodeStateTimeline,
      service: this,
      updateBy: updateBy,
      statusColumns: ["subscriberNotificationStatus"],
    });

    return {
      updateBy: updateBy,
      carryForward: null,
    };
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
