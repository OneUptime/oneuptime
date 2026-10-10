import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import UpdateBy from "../Types/Database/UpdateBy";
import { OnCreate, OnDelete, OnUpdate } from "../Types/Database/Hooks";
import QueryHelper from "../Types/Database/QueryHelper";
import ProjectReferencesService from "./ProjectReferencesService";
import MonitorService from "./MonitorService";
import MonitorStatusService from "./MonitorStatusService";
import MonitorStatusTimelineService from "./MonitorStatusTimelineService";
import ScheduledMaintenancePublicNoteService from "./ScheduledMaintenancePublicNoteService";
import ScheduledMaintenanceService from "./ScheduledMaintenanceService";
import ScheduledMaintenanceStateService from "./ScheduledMaintenanceStateService";
import ScheduledMaintenanceMeasurementValueService from "./ScheduledMaintenanceMeasurementValueService";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import OneUptimeDate from "../../Types/Date";
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import NetworkSite from "../../Models/DatabaseModels/NetworkSite";
import NetworkSiteService from "./NetworkSiteService";
import PositiveNumber from "../../Types/PositiveNumber";
import StateChangeSubscriberNotification from "../../Types/StatusPage/StateChangeSubscriberNotification";
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
import ProjectScopedReferenceValidator from "../Utils/Database/ProjectScopedReferenceValidator";
import RelationIdUtil from "../Utils/Database/RelationIdUtil";
import StateChangePublicNote from "../Utils/StatusPage/StateChangePublicNote";
import logger, { LogAttributes } from "../Utils/Logger";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import LIMIT_MAX, { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import WorkspaceNotificationRuleService from "./WorkspaceNotificationRuleService";
import { SemaphoreMutex } from "../Infrastructure/Semaphore";
import StateChangeLock from "../Utils/StateChangeLock";
import StateChangeFollowOn from "../Utils/StateChangeFollowOn";
import Exception from "../../Types/Exception/Exception";
import Select from "../Types/Database/Select";
import ScheduledMaintenanceStartUtil from "../../Utils/ScheduledMaintenanceStart";
import { mdText } from "../../Utils/Markdown/FeedMarkdown";

/*
 * Enough of a state to tell which kind it is. A project can add its own
 * states between the built-in ones, and those are none of the four kinds.
 */
const STATE_KIND_SELECT: Select<ScheduledMaintenanceState> = {
  _id: true,
  isScheduledState: true,
  isOngoingState: true,
  isEndedState: true,
  isResolvedState: true,
};

/*
 * How many events' timelines one read replays when asking whether any of
 * them holds a monitor. An event's timeline is a handful of rows, so a batch
 * this size stays far inside LIMIT_MAX: a read cut short at the limit would
 * drop the latest rows of some events and misjudge them.
 */
const TIMELINE_REPLAY_BATCH_SIZE: number = 100;

export class Service extends ProjectReferencesService<ScheduledMaintenanceStateTimeline> {
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
    await super.onBeforeCreate(createBy);

    if (!createBy.data.scheduledMaintenanceId) {
      throw new BadDataException("scheduledMaintenanceId is null");
    }

    // Under either of its names; the two must agree.
    const scheduledMaintenanceStateId: ObjectID | null =
      RelationIdUtil.readConsistent(
        createBy.data as unknown as Record<string, unknown>,
        ["scheduledMaintenanceStateId", "scheduledMaintenanceState"],
        "Scheduled Maintenance State",
      );

    if (!scheduledMaintenanceStateId) {
      throw new BadDataException("scheduledMaintenanceStateId is null");
    }

    // The public note that comes with the change, if any (a blank one is none).
    const publicNote: string | undefined =
      StateChangeSubscriberNotification.getPublicNote(
        createBy.miscDataProps as JSONObject | undefined,
      );

    /*
     * The note is posted once the change is saved (onCreateSuccess), as the
     * person changing the state: after the change in the event's feed and in
     * its Slack and Microsoft Teams channels, and never for a change that is
     * refused or fails to save. With Notify on it is the one message
     * subscribers get about the change, which is recorded as sent by it. So
     * whether they may post it is asked now, before the change takes the
     * event's lock or reads anything, with the check the note's own create
     * runs: a change whose note they may not post is refused whole, with one
     * plain message (StateChangePublicNote).
     *
     * It notifies exactly when the change was asked to: a change that does
     * not say keeps its column defaults and notifies itself, and its note
     * stays quiet - one message, not two.
     */
    let publicNoteToPost: ScheduledMaintenancePublicNote | undefined =
      undefined;

    if (publicNote) {
      publicNoteToPost = new ScheduledMaintenancePublicNote();
      publicNoteToPost.scheduledMaintenanceId =
        createBy.data.scheduledMaintenanceId;
      publicNoteToPost.note = publicNote;

      /*
       * At the change's time: as it was sent, or now when it names none.
       * The saved change has the last word on it (onCreateSuccess).
       */
      const postedAt: Date =
        createBy.data.startsAt || OneUptimeDate.getCurrentDate();
      publicNoteToPost.postedAt = postedAt;
      publicNoteToPost.createdAt = postedAt;

      const noteProjectId: ObjectID | undefined =
        createBy.data.projectId || createBy.props.tenantId;

      if (noteProjectId) {
        publicNoteToPost.projectId = noteProjectId;
      }

      publicNoteToPost.shouldStatusPageSubscribersBeNotifiedOnNoteCreated =
        Boolean(createBy.data.shouldStatusPageSubscribersBeNotified);

      // Its messages name the state the event moves to.
      StateChangePublicNote.markPostedWith(
        publicNoteToPost,
        scheduledMaintenanceStateId,
      );

      StateChangePublicNote.assertCallerMayPost({
        noteModelType: ScheduledMaintenancePublicNote,
        note: publicNoteToPost,
        props: createBy.props,
      });
    }

    let mutex: SemaphoreMutex | null = null;

    try {
      // The event's lock: given back in onCreateSuccess or onCreateError.
      mutex = await StateChangeLock.take({
        namespace: "ScheduledMaintenanceStateTimeline.create",
        eventId: createBy.data.scheduledMaintenanceId,
        logAttributes: {
          projectId: createBy.data.projectId?.toString(),
          scheduledMaintenanceId:
            createBy.data.scheduledMaintenanceId?.toString(),
        } as LogAttributes,
      });

      /*
       * Taken once the lock is held, so that changes made to the event at
       * the same moment are timed - and ordered - as they get it.
       */
      if (!createBy.data.startsAt) {
        createBy.data.startsAt = OneUptimeDate.getCurrentDate();
      }

      /*
       * Same guard, same reason, as MonitorStatusTimelineService: an id that
       * exists nowhere (or belongs to another project) used to reach Postgres
       * and come back as a raw foreign key violation. The ordering check below
       * does look the state up, but only when there IS a preceding row with an
       * order, so the first timeline row for a scheduled maintenance event went
       * through unchecked.
       */
      await ProjectScopedReferenceValidator.validateReferencesBelongToProject({
        projectId: createBy.props.tenantId || createBy.data.projectId,
        subject: "scheduled maintenance state timeline",
        references: [
          {
            modelName: "Scheduled Maintenance State",
            id: scheduledMaintenanceStateId,
            service: ScheduledMaintenanceStateService,
          },
        ],
      });

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

      /*
       * The change's own notification, decided once: when it notifies
       * subscribers and a note came with it, the note is the one message
       * they get (StateChangeSubscriberNotification).
       */
      StateChangeSubscriberNotification.applyToStateChange({
        stateChange: createBy.data,
        hasPublicNote: Boolean(publicNote),
        skippedMessage:
          "Notifications skipped as subscribers are not to be notified for this scheduled maintenance state change.",
      });

      return {
        createBy,
        carryForward: {
          statusTimelineBeforeThisStatus: stateBeforeThis || null,
          statusTimelineAfterThisStatus: stateAfterThis || null,
          publicNote: publicNote,
          publicNoteToPost: publicNoteToPost,
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
        scheduledMaintenanceId:
          createBy.data.scheduledMaintenanceId?.toString(),
      } as LogAttributes);

      throw error;
    }
  }

  @CaptureSpan()
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

    logger.debug("Status Timeline Before this", {
      projectId: createdItem.projectId?.toString(),
      scheduledMaintenanceId: createdItem.scheduledMaintenanceId?.toString(),
    } as LogAttributes);
    logger.debug(onCreate.carryForward.statusTimelineBeforeThisStatus, {
      projectId: createdItem.projectId?.toString(),
      scheduledMaintenanceId: createdItem.scheduledMaintenanceId?.toString(),
    } as LogAttributes);

    logger.debug("Status Timeline After this", {
      projectId: createdItem.projectId?.toString(),
      scheduledMaintenanceId: createdItem.scheduledMaintenanceId?.toString(),
    } as LogAttributes);
    logger.debug(onCreate.carryForward.statusTimelineAfterThisStatus, {
      projectId: createdItem.projectId?.toString(),
      scheduledMaintenanceId: createdItem.scheduledMaintenanceId?.toString(),
    } as LogAttributes);

    logger.debug("Created Item", {
      projectId: createdItem.projectId?.toString(),
      scheduledMaintenanceId: createdItem.scheduledMaintenanceId?.toString(),
    } as LogAttributes);
    logger.debug(createdItem, {
      projectId: createdItem.projectId?.toString(),
      scheduledMaintenanceId: createdItem.scheduledMaintenanceId?.toString(),
    } as LogAttributes);

    /*
     * now there are three cases.
     * 1. This is the first status OR there's no status after this.
     */
    if (!onCreate.carryForward.statusTimelineBeforeThisStatus) {
      // This is the first status, no need to update previous status.
      logger.debug("This is the first status.", {
        projectId: createdItem.projectId?.toString(),
        scheduledMaintenanceId: createdItem.scheduledMaintenanceId?.toString(),
      } as LogAttributes);
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
      logger.debug("This is the last status.", {
        projectId: createdItem.projectId?.toString(),
        scheduledMaintenanceId: createdItem.scheduledMaintenanceId?.toString(),
      } as LogAttributes);
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
      logger.debug("This status is in the middle.", {
        projectId: createdItem.projectId?.toString(),
        scheduledMaintenanceId: createdItem.scheduledMaintenanceId?.toString(),
      } as LogAttributes);
    }

    /*
     * The event's current state follows its timeline, as OneUptime's own
     * write: the permission to create the change is the permission to change
     * the event's state (StateChangeFollowOn).
     */
    if (!createdItem.endsAt) {
      await ScheduledMaintenanceService.updateOneBy({
        query: {
          _id: createdItem.scheduledMaintenanceId?.toString(),
        },
        data: {
          currentScheduledMaintenanceStateId:
            createdItem.scheduledMaintenanceStateId,
        },
        props: StateChangeFollowOn.getEventWriteProps(onCreate.createBy.props),
      });
    }

    await StateChangeLock.giveBackFor(onCreate, {
      projectId: createdItem.projectId?.toString(),
      scheduledMaintenanceId: createdItem.scheduledMaintenanceId?.toString(),
    } as LogAttributes);

    const scheduledMaintenanceState: ScheduledMaintenanceState | null =
      await ScheduledMaintenanceStateService.findOneBy({
        query: {
          _id: createdItem.scheduledMaintenanceStateId.toString()!,
        },
        props: {
          isRoot: true,
        },
        select: {
          ...STATE_KIND_SELECT,
          order: true,
          color: true,
          name: true,
        },
      });

    /*
     * The project's states, with their place: read once, and only when a
     * state of the project's own needs placing. Whether an event is in
     * progress in one (placed between Ongoing and Ended) or over (placed
     * after Ended) only its place can tell (ScheduledMaintenanceStartUtil).
     */
    const getProjectStates: () => Promise<Array<ScheduledMaintenanceState>> =
      createdItem.projectId
        ? this.getProjectStatesReader(createdItem.projectId)
        : async (): Promise<Array<ScheduledMaintenanceState>> => {
            return [];
          };

    // Whether the event is in progress in the state it moves into.
    const isMovingIntoProgress: boolean = await this.isStateInProgress({
      state: scheduledMaintenanceState,
      getStates: getProjectStates,
    });

    /*
     * The state's name is plain text, placed into the feed item's Markdown
     * (posted to Slack and Teams too) as text (mdText), so it reads as typed.
     */
    const stateName: string = scheduledMaintenanceState?.name || "";
    let stateEmoji: string = "➡️";

    // if resolved state then change emoji to ✅.

    if (scheduledMaintenanceState?.isResolvedState) {
      stateEmoji = "✅";
    } else if (isMovingIntoProgress) {
      /*
       * In progress: the ongoing state, or a state of the project's own
       * placed between Ongoing and Ended, such as "Verifying".
       */
      stateEmoji = "⏳";
    } else if (scheduledMaintenanceState?.isScheduledState) {
      stateEmoji = "🕒";
    }

    const scheduledMaintenanceNumberResult: {
      number: number | null;
      numberWithPrefix: string | null;
    } = await ScheduledMaintenanceService.getScheduledMaintenanceNumber({
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
        mdText`${stateEmoji} Changed **[Scheduled Maintenance ${scheduledMaintenanceNumberResult.numberWithPrefix || "#" + scheduledMaintenanceNumberResult.number}](${(await ScheduledMaintenanceService.getScheduledMaintenanceLinkInDashboard(projectId!, scheduledMaintenanceId!)).toString()}) State** to **${stateName}**`.toString(),
      userId: createdItem.createdByUserId || onCreate.createBy.props.userId,
      workspaceNotification: {
        sendWorkspaceNotification: true,
        notifyUserId:
          createdItem.createdByUserId || onCreate.createBy.props.userId,
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
          // As it is stored now: the status the event starts with (below).
          changeMonitorStatusToId: true,
          monitors: {
            _id: true,
          },
          networkSites: {
            _id: true,
          },
          nextSubscriberNotificationBeforeTheEventAt: true,
        },
        props: {
          isRoot: true,
        },
      });

    const hasProgressedBeyondScheduledState: boolean = Boolean(
      scheduledMaintenanceState && !scheduledMaintenanceState.isScheduledState,
    );

    if (
      hasProgressedBeyondScheduledState &&
      scheduledMaintenanceEvent?.nextSubscriberNotificationBeforeTheEventAt
    ) {
      // Derived from the change too, so written the same way.
      await ScheduledMaintenanceService.updateOneById({
        id: createdItem.scheduledMaintenanceId!,
        data: {
          nextSubscriberNotificationBeforeTheEventAt: null,
        },
        props: StateChangeFollowOn.getEventWriteProps(onCreate.createBy.props),
      });
    }

    /*
     * The built-in kind of the state moved into, if it is one: in progress
     * (Ongoing), or not (Scheduled, Ended, Completed). Null for a state of
     * the project's own, which its place decides.
     */
    const inProgressByFlags: boolean | null =
      ScheduledMaintenanceStartUtil.isInProgressByFlags(
        scheduledMaintenanceState,
      );

    /*
     * The event starts here when it moves into its ongoing state - or,
     * from a state where it was not in progress, into a state of the
     * project's own placed between Ongoing and Ended ("Verifying"), which
     * is in progress just the same (ScheduledMaintenanceStartUtil). Both
     * starts do the same: probing of the event's monitors stops, and they
     * change to its Change Monitor Status to.
     */
    const isStart: boolean =
      inProgressByFlags === true ||
      (inProgressByFlags === null &&
        isMovingIntoProgress &&
        (await this.isStartIntoStateOfItsOwn({
          scheduledMaintenanceStateId: createdItem.scheduledMaintenanceStateId,
          stateIdBeforeThis:
            onCreate.carryForward.statusTimelineBeforeThisStatus
              ?.scheduledMaintenanceStateId,
          isCurrentState: !createdItem.endsAt,
          getStates: getProjectStates,
        })));

    /*
     * And it ends here when it moves into its ended or completed state, as
     * before - or, while it holds its monitors, into a state of the
     * project's own placed after Ended ("Reviewing"), where it is over just
     * the same: it lets go of them, as the move into Ended does. Without
     * this, an event moved from Ongoing straight into such a state kept its
     * monitors paused in its status for good.
     */
    const isEnd: boolean =
      ScheduledMaintenanceStartUtil.hasEndedByFlags(
        scheduledMaintenanceState,
      ) === true ||
      (inProgressByFlags === null &&
        !isMovingIntoProgress &&
        (await this.isEndIntoStateOfItsOwn({
          createdItem: createdItem,
          isCurrentState: !createdItem.endsAt,
          getStates: getProjectStates,
        })));

    if (isStart) {
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

        await this.applyMonitorStatusWhenStarting({
          scheduledMaintenanceEvent: scheduledMaintenanceEvent,
          isCurrentState: !createdItem.endsAt,
        });
      }
    }

    if (isEnd) {
      // resolve all the monitors.
      await this.enableActiveMonitoringForMonitors(scheduledMaintenanceEvent!);
    }

    /*
     * Network sites are suppressed by the LIVE state of the event, not by a
     * flag written onto them, so both edges of the window have to re-roll the
     * chains above the attached sites: the start takes the planned outage
     * out of every ancestor's rollup, and the end puts whatever is genuinely
     * wrong back in - whichever state, built-in or the project's own, either
     * edge moves into. Without this the change would still land, but only
     * whenever the five-minute stale sweep next reached those sites.
     *
     * Awaited rather than fired and forgotten: the state transition is
     * already inside a hook, and a rollup that ran after the response would
     * race the very sweep it is trying to pre-empt. The call swallows
     * per-site failures itself.
     */
    if (isStart || isEnd) {
      await this.recomputeNetworkSiteRollups(scheduledMaintenanceEvent);
    }

    /*
     * The note that came with the change, which onBeforeCreate built and
     * made sure may be posted: posted now that the change is saved - after
     * it in the event's feed and its Slack and Microsoft Teams channels, and
     * before a completed event's channels are archived - on the event, at
     * the time and in the project the change was saved with, as the person
     * who changed the state.
     */
    const publicNoteToPost: ScheduledMaintenancePublicNote | undefined =
      onCreate.carryForward.publicNoteToPost;

    if (publicNoteToPost) {
      if (createdItem.startsAt) {
        publicNoteToPost.postedAt = createdItem.startsAt;
        publicNoteToPost.createdAt = createdItem.startsAt;
      }

      if (createdItem.projectId) {
        publicNoteToPost.projectId = createdItem.projectId;
      }

      await ScheduledMaintenancePublicNoteService.create({
        data: publicNoteToPost,
        props: onCreate.createBy.props,
      });
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
          text: mdText`**[Scheduled Event ${scheduledMaintenanceNumberResult.numberWithPrefix || "#" + scheduledMaintenanceNumberResult.number}](${(
            await ScheduledMaintenanceService.getScheduledMaintenanceLinkInDashboard(
              createdItem.projectId!,
              createdItem.scheduledMaintenanceId!,
            )
          ).toString()})** is complete. Archiving channel.`.toString(),
        },
      }).catch((error: Error) => {
        logger.error(`Error while archiving workspace channels:`, {
          projectId: createdItem.projectId?.toString(),
          scheduledMaintenanceId:
            createdItem.scheduledMaintenanceId?.toString(),
        } as LogAttributes);
        logger.error(error, {
          projectId: createdItem.projectId?.toString(),
          scheduledMaintenanceId:
            createdItem.scheduledMaintenanceId?.toString(),
        } as LogAttributes);
      });
    }

    /*
     * A new timeline row moves every anchor that resolves against it, so the
     * derived measurements have to be recomputed. Fire-and-forget: the state
     * change itself is the user-visible write and must not fail because a
     * derived number could not be recalculated.
     */
    ScheduledMaintenanceMeasurementValueService.recomputeForScheduledMaintenance(
      {
        scheduledMaintenanceId: createdItem.scheduledMaintenanceId,
      },
    ).catch((error: Error) => {
      logger.error(
        `Error while recomputing scheduled maintenance measurements:`,
        {
          projectId: createdItem.projectId?.toString(),
          scheduledMaintenanceId:
            createdItem.scheduledMaintenanceId?.toString(),
        } as LogAttributes,
      );
      logger.error(error, {
        projectId: createdItem.projectId?.toString(),
        scheduledMaintenanceId: createdItem.scheduledMaintenanceId?.toString(),
      } as LogAttributes);
    });

    return createdItem;
  }

  /*
   * A change refused or failed once onBeforeCreate took the event's lock -
   * by a check DatabaseService.create runs after the hook, at the INSERT,
   * or in onCreateSuccess before it gave the lock back - gives it back
   * here (StateChangeLock). Left held, every later change to the event
   * would wait out the lock and then go ahead without it.
   */
  @CaptureSpan()
  protected override async onCreateError(
    error: Exception,
    onCreate?: OnCreate<ScheduledMaintenanceStateTimeline> | undefined,
  ): Promise<Exception> {
    await StateChangeLock.giveBackFor(onCreate, {
      projectId: onCreate?.createBy.data.projectId?.toString(),
      scheduledMaintenanceId:
        onCreate?.createBy.data.scheduledMaintenanceId?.toString(),
    } as LogAttributes);

    return error;
  }

  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<ScheduledMaintenanceStateTimeline>,
  ): Promise<OnUpdate<ScheduledMaintenanceStateTimeline>> {
    await super.onBeforeUpdate(updateBy);

    /*
     * Resolved before the update runs, because the update may narrow or move
     * the rows the query matches -- and because a row can be repointed at a
     * different event, in which case the event it LEFT also has to be
     * recomputed. onUpdateSuccess unions this with the after-state.
     */
    const scheduledMaintenanceIds: Array<ObjectID> =
      await this.getScheduledMaintenanceIdsForTimelineQuery(updateBy);

    return {
      updateBy,
      carryForward: scheduledMaintenanceIds,
    };
  }

  @CaptureSpan()
  protected override async onUpdateSuccess(
    onUpdate: OnUpdate<ScheduledMaintenanceStateTimeline>,
    updatedItemIds: ObjectID[],
  ): Promise<OnUpdate<ScheduledMaintenanceStateTimeline>> {
    const scheduledMaintenanceIds: Array<ObjectID> = [
      ...(Array.isArray(onUpdate.carryForward)
        ? (onUpdate.carryForward as Array<ObjectID>)
        : []),
    ];

    if (updatedItemIds.length > 0) {
      const updatedTimelines: Array<ScheduledMaintenanceStateTimeline> =
        await this.findBy({
          query: {
            _id: QueryHelper.any(updatedItemIds),
          },
          select: {
            scheduledMaintenanceId: true,
          },
          skip: 0,
          limit: LIMIT_PER_PROJECT,
          props: {
            isRoot: true,
            ignoreHooks: true,
          },
        });

      scheduledMaintenanceIds.push(
        ...this.getScheduledMaintenanceIdsFromTimelines(updatedTimelines),
      );
    }

    this.recomputeMeasurementsForScheduledMaintenanceIds(
      scheduledMaintenanceIds,
    );

    return onUpdate;
  }

  private async getScheduledMaintenanceIdsForTimelineQuery(
    updateBy: UpdateBy<ScheduledMaintenanceStateTimeline>,
  ): Promise<Array<ObjectID>> {
    const timelines: Array<ScheduledMaintenanceStateTimeline> =
      await this.findRowsAndHoldUpdateToThem(updateBy, {
        scheduledMaintenanceId: true,
      });

    return this.getScheduledMaintenanceIdsFromTimelines(timelines);
  }

  private getScheduledMaintenanceIdsFromTimelines(
    timelines: Array<ScheduledMaintenanceStateTimeline>,
  ): Array<ObjectID> {
    const scheduledMaintenanceIds: Map<string, ObjectID> = new Map<
      string,
      ObjectID
    >();

    for (const timeline of timelines) {
      if (timeline.scheduledMaintenanceId) {
        scheduledMaintenanceIds.set(
          timeline.scheduledMaintenanceId.toString(),
          timeline.scheduledMaintenanceId,
        );
      }
    }

    return Array.from(scheduledMaintenanceIds.values());
  }

  /*
   * `startsAt` on a timeline row is editable so an operator can correct a
   * wrong timestamp. Every measurement anchored on that row is derived from
   * it, so the stored values must move with the correction -- otherwise the
   * page shows a number computed from a timestamp that no longer exists.
   */
  private recomputeMeasurementsForScheduledMaintenanceIds(
    scheduledMaintenanceIds: Array<ObjectID>,
  ): void {
    const uniqueScheduledMaintenanceIds: Map<string, ObjectID> = new Map<
      string,
      ObjectID
    >();

    for (const scheduledMaintenanceId of scheduledMaintenanceIds) {
      uniqueScheduledMaintenanceIds.set(
        scheduledMaintenanceId.toString(),
        scheduledMaintenanceId,
      );
    }

    for (const scheduledMaintenanceId of uniqueScheduledMaintenanceIds.values()) {
      ScheduledMaintenanceMeasurementValueService.recomputeForScheduledMaintenance(
        {
          scheduledMaintenanceId: scheduledMaintenanceId,
        },
      ).catch((error: Error) => {
        logger.error(
          `Error while recomputing scheduled maintenance measurements:`,
          {
            scheduledMaintenanceId: scheduledMaintenanceId.toString(),
          } as LogAttributes,
        );
        logger.error(error, {
          scheduledMaintenanceId: scheduledMaintenanceId.toString(),
        } as LogAttributes);
      });
    }
  }

  /*
   * Re-rolls the health of every network site chain this event covers.
   * A no-op for the overwhelming majority of events, which have no sites
   * attached at all.
   *
   * Public for ScheduledMaintenanceService, which passes the sites an edit
   * attached to or detached from an ongoing event.
   */
  @CaptureSpan()
  public async recomputeNetworkSiteRollups(
    scheduledMaintenanceEvent: ScheduledMaintenance | null,
  ): Promise<void> {
    if (
      !scheduledMaintenanceEvent ||
      !scheduledMaintenanceEvent.projectId ||
      !scheduledMaintenanceEvent.networkSites ||
      scheduledMaintenanceEvent.networkSites.length === 0
    ) {
      return;
    }

    const siteIds: Array<ObjectID> = scheduledMaintenanceEvent.networkSites
      .filter((site: NetworkSite) => {
        return Boolean(site._id);
      })
      .map((site: NetworkSite) => {
        return new ObjectID(String(site._id));
      });

    try {
      await NetworkSiteService.recomputeRollupsAfterMaintenanceChange({
        projectId: scheduledMaintenanceEvent.projectId,
        siteIds: siteIds,
      });
    } catch (error) {
      logger.error(
        "Error while recomputing network site rollups after a scheduled maintenance state change:",
      );
      logger.error(error);
    }
  }

  /*
   * Whether the event is in progress in `state`
   * (ScheduledMaintenanceStartUtil): a built-in state answers by its flag;
   * a state of the project's own by its place in the project's list, read
   * only then (getStates).
   */
  private async isStateInProgress(data: {
    state: ScheduledMaintenanceState | null | undefined;
    getStates: () => Promise<Array<ScheduledMaintenanceState>>;
  }): Promise<boolean> {
    const byFlags: boolean | null =
      ScheduledMaintenanceStartUtil.isInProgressByFlags(data.state);

    if (byFlags !== null) {
      return byFlags;
    }

    if (!data.state) {
      return false;
    }

    return ScheduledMaintenanceStartUtil.isInProgress({
      states: await data.getStates(),
      state: data.state,
    });
  }

  // The state of the project's list with this id, if any.
  private findStateOf(
    states: Array<ScheduledMaintenanceState>,
    stateId: ObjectID | undefined,
  ): ScheduledMaintenanceState | undefined {
    const key: string = stateId?.toString().trim().toLowerCase() || "";

    return key
      ? states.find((state: ScheduledMaintenanceState): boolean => {
          return state.id?.toString().trim().toLowerCase() === key;
        })
      : undefined;
  }

  /*
   * Whether a move into a state of the project's own - none of the four
   * built-in kinds - is the event's start: the state is placed between
   * Ongoing and Ended (ScheduledMaintenanceStartUtil.isInProgress), and the
   * state the event moves from is not in progress (none, Scheduled, a state
   * of the project's own placed before Ongoing - or one where the event was
   * over, reopened). A move from Ongoing into such a state is not a start:
   * the event already holds its monitors.
   *
   * Only for the event's current state (isCurrentState): a row filled in
   * between two others, back in its timeline, starts nothing. The project's
   * states are read once (getStates), and only for such a move.
   */
  private async isStartIntoStateOfItsOwn(data: {
    scheduledMaintenanceStateId: ObjectID;
    stateIdBeforeThis: ObjectID | undefined;
    isCurrentState: boolean;
    getStates: () => Promise<Array<ScheduledMaintenanceState>>;
  }): Promise<boolean> {
    if (!data.isCurrentState) {
      return false;
    }

    const states: Array<ScheduledMaintenanceState> = await data.getStates();

    const state: ScheduledMaintenanceState | undefined = this.findStateOf(
      states,
      data.scheduledMaintenanceStateId,
    );

    if (
      !state ||
      ScheduledMaintenanceStartUtil.isInProgressByFlags(state) !== null ||
      !ScheduledMaintenanceStartUtil.isInProgress({
        states: states,
        state: state,
      })
    ) {
      return false;
    }

    const stateBeforeThis: ScheduledMaintenanceState | undefined =
      this.findStateOf(states, data.stateIdBeforeThis);

    return !(
      stateBeforeThis &&
      ScheduledMaintenanceStartUtil.isInProgress({
        states: states,
        state: stateBeforeThis,
      })
    );
  }

  /*
   * Whether a move into a state of the project's own placed after Ended
   * ("Reviewing") is the event's end: it is over in that state
   * (ScheduledMaintenanceStartUtil.hasEnded), and it held its monitors until
   * now - its timeline before this row, replayed the way the transitions
   * applied it (isHoldingAfterTimeline). Moved on from Ended, it let go of
   * them already; moved there straight from Scheduled, it never held them -
   * and releasing them again would put a monitor that went down since back
   * to operational.
   *
   * Only for the event's current state (isCurrentState), as the start. The
   * timeline is read only for such a move.
   */
  private async isEndIntoStateOfItsOwn(data: {
    createdItem: ScheduledMaintenanceStateTimeline;
    isCurrentState: boolean;
    getStates: () => Promise<Array<ScheduledMaintenanceState>>;
  }): Promise<boolean> {
    const createdItem: ScheduledMaintenanceStateTimeline = data.createdItem;

    if (
      !data.isCurrentState ||
      !createdItem.projectId ||
      !createdItem.scheduledMaintenanceId
    ) {
      return false;
    }

    const states: Array<ScheduledMaintenanceState> = await data.getStates();

    const state: ScheduledMaintenanceState | undefined = this.findStateOf(
      states,
      createdItem.scheduledMaintenanceStateId,
    );

    if (
      !state ||
      ScheduledMaintenanceStartUtil.hasEndedByFlags(state) !== null ||
      !ScheduledMaintenanceStartUtil.hasEnded({
        states: states,
        state: state,
      })
    ) {
      return false;
    }

    const timeline: Array<ScheduledMaintenanceStateTimeline> =
      await this.findBy({
        query: {
          scheduledMaintenanceId: createdItem.scheduledMaintenanceId,
          projectId: createdItem.projectId,
        },
        select: {
          _id: true,
          scheduledMaintenanceState: STATE_KIND_SELECT,
        },
        sort: {
          startsAt: SortOrder.Ascending,
        },
        limit: LIMIT_MAX,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

    const createdItemId: string = createdItem.id?.toString() || "";

    return await this.isHoldingAfterTimeline({
      timeline: timeline.filter(
        (timelineItem: ScheduledMaintenanceStateTimeline): boolean => {
          return (
            !createdItemId || timelineItem.id?.toString() !== createdItemId
          );
        },
      ),
      getStates: data.getStates,
    });
  }

  /*
   * WHEN AN EVENT STARTS, ITS MONITORS CHANGE TO ITS CHANGE MONITOR STATUS
   * TO - THE ONE IT HOLDS AT THAT MOMENT.
   *
   * Every way an event starts comes through here, as the move into its
   * ongoing state - or straight into a state of the project's own after
   * Ongoing (isStartIntoStateOfItsOwn): the ChangeStateToOngoing job at its
   * start time, Mark as Ongoing on its page, the Slack and Microsoft Teams
   * actions, a state change through the API, Terraform or a workflow. The
   * status is read
   * from the event as it is stored now (the read above), so a status
   * changed after the event was scheduled - it can be, until the event
   * starts - is the one applied. The job used to apply the status it had
   * read up to a minute before, and a start by hand applied none.
   *
   * Only when this row is the event's current state (isCurrentState): a row
   * filled in between two others, back in its timeline, starts nothing.
   *
   * The state change has committed: a failure here is logged, never turned
   * into an error. Each monitor already in the status is left as it is
   * (MonitorService.changeMonitorStatus).
   */
  private async applyMonitorStatusWhenStarting(data: {
    scheduledMaintenanceEvent: ScheduledMaintenance;
    isCurrentState: boolean;
  }): Promise<void> {
    const scheduledMaintenanceEvent: ScheduledMaintenance =
      data.scheduledMaintenanceEvent;

    if (
      !data.isCurrentState ||
      !scheduledMaintenanceEvent.changeMonitorStatusToId ||
      !scheduledMaintenanceEvent.projectId ||
      !scheduledMaintenanceEvent.id
    ) {
      return;
    }

    try {
      await ScheduledMaintenanceService.changeAttachedMonitorStates(
        scheduledMaintenanceEvent,
        {
          isRoot: true,
        },
      );
    } catch (err) {
      const logAttributes: LogAttributes = {
        projectId: scheduledMaintenanceEvent.projectId.toString(),
        scheduledMaintenanceId: scheduledMaintenanceEvent.id.toString(),
      } as LogAttributes;

      logger.error(
        `ScheduledMaintenanceStateTimelineService.applyMonitorStatusWhenStarting: could not change the monitors of scheduled maintenance ${scheduledMaintenanceEvent.id.toString()} to the status it starts with; the state change itself is saved.`,
        logAttributes,
      );
      logger.error(err, logAttributes);
    }
  }

  /*
   * Releases the monitors of an event that has let go of them - it ended or
   * was resolved, it was deleted, or an edit detached them - clearing the
   * flag that stopped probing and putting each back in the operational
   * status. A monitor another event still holds is left as it is (see
   * isMonitorHeldInMaintenanceByAnyEvent).
   */
  @CaptureSpan()
  public async enableActiveMonitoringForMonitors(
    scheduledMaintenanceEvent: ScheduledMaintenance,
  ): Promise<void> {
    if (
      scheduledMaintenanceEvent &&
      scheduledMaintenanceEvent.monitors &&
      scheduledMaintenanceEvent.monitors.length > 0
    ) {
      /*
       * Resolve monitors back to the project's operational status once
       * maintenance ends. A project can hold more than one operational state,
       * so this lookup MUST be deterministic: without an explicit sort
       * findOneBy falls back to `createdAt DESC` and would resolve monitors
       * into whichever operational status was created most recently rather
       * than the seeded default. Order by priority ascending (seeded default
       * operational status is priority 0), tie-broken by the oldest row,
       * matching MonitorService.onBeforeCreate so a monitor's operational
       * status stays the same canonical one across its lifecycle.
       */
      const resolvedMonitorState: MonitorStatus | null =
        await MonitorStatusService.findOneBy({
          query: {
            projectId: scheduledMaintenanceEvent.projectId!,
            isOperationalState: true,
          },
          sort: {
            priority: SortOrder.Ascending,
            createdAt: SortOrder.Ascending,
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
        /*
         * Whether each event in a state of its project's own holds its
         * monitors, once worked out, for the rest of this release. Such an
         * event is usually attached to many of the monitors let go here (a
         * "Cancelled" state reached from Scheduled leaves one behind on every
         * monitor it had), and without this its timeline was replayed again
         * for each of them. Kept to this one call, so a later release reads
         * afresh.
         */
        const holdingByEventId: Map<string, boolean> = new Map<
          string,
          boolean
        >();

        for (const monitor of scheduledMaintenanceEvent.monitors) {
          /*
           * Per-monitor isolation, as in
           * IncidentService.markMonitorsActiveForMonitoring: one monitor
           * failing here (the fail-closed status timeline lock, a "same as
           * previous" rejection after a concurrent writer, a transient DB
           * error) must not abort the loop and strand the REMAINING monitors
           * with disableActiveMonitoringBecauseOfScheduledMaintenanceEvent
           * still set. A monitor left that way is never probed again, and
           * nothing else clears the flag once the event has let go of it.
           */
          try {
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

            const isHeldByAnotherEvent: boolean =
              await this.isMonitorHeldInMaintenanceByAnyEvent(
                monitor.id!,
                holdingByEventId,
              );

            if (isHeldByAnotherEvent) {
              // dont do anything because other events are active at the same time.
              continue;
            }

            await MonitorService.updateOneById({
              id: monitor.id!,
              data: {
                disableActiveMonitoringBecauseOfScheduledMaintenanceEvent:
                  false, /// This will start active monitoring again.
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
          } catch (err) {
            const logAttributes: LogAttributes = {
              projectId: scheduledMaintenanceEvent.projectId?.toString(),
              scheduledMaintenanceId: scheduledMaintenanceEvent.id?.toString(),
              monitorId: monitor.id?.toString(),
            } as LogAttributes;

            logger.error(
              `ScheduledMaintenanceStateTimelineService.enableActiveMonitoringForMonitors: failed for monitor ${monitor.id?.toString()}; continuing with the remaining monitors.`,
              logAttributes,
            );
            logger.error(err, logAttributes);
            continue;
          }
        }
      }
    }
  }

  /*
   * Whether any scheduled maintenance event still holds this monitor in
   * maintenance (see isScheduledMaintenanceHoldingMonitors), so an event
   * letting go of it must leave it disabled. Asked once the releasing event
   * has let go - it has moved to ended or resolved, been deleted, or had the
   * monitor detached - so that event does not count itself.
   *
   * This used to count only events in an ongoing state, while an edit to an
   * event treats one in a state of the project's own past ongoing (say
   * "Verifying") as still holding its monitors. A monitor attached to both
   * such an event and another one was re-enabled when the other ended,
   * while the first still held it.
   *
   * Only events in a state that can hold are read (scheduled, ended and
   * resolved never do), and none past that when an ongoing event holds the
   * monitor. The rest are each in a state of their project's own and are
   * replayed from their timelines, all of them in one read rather than one
   * read each (see replayWhetherScheduledMaintenancesHoldMonitors).
   *
   * holdingByEventId carries the answers for such events across the
   * monitors of one release (enableActiveMonitoringForMonitors): an event
   * already replayed is not read again, and whatever is replayed here is
   * added to it.
   */
  @CaptureSpan()
  public async isMonitorHeldInMaintenanceByAnyEvent(
    monitorId: ObjectID,
    holdingByEventId?: Map<string, boolean>,
  ): Promise<boolean> {
    const scheduledMaintenanceEvents: Array<ScheduledMaintenance> =
      await ScheduledMaintenanceService.findBy({
        query: {
          monitors: QueryHelper.inRelationArray([monitorId]),
          currentScheduledMaintenanceState: {
            isScheduledState: false,
            isEndedState: false,
            isResolvedState: false,
          },
        },
        select: {
          _id: true,
          projectId: true,
          currentScheduledMaintenanceState: STATE_KIND_SELECT,
        },
        limit: LIMIT_MAX,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

    const isHeldByOngoingEvent: boolean = scheduledMaintenanceEvents.some(
      (scheduledMaintenanceEvent: ScheduledMaintenance): boolean => {
        return (
          ScheduledMaintenanceStartUtil.isInProgressByFlags(
            scheduledMaintenanceEvent.currentScheduledMaintenanceState,
          ) === true
        );
      },
    );

    if (isHeldByOngoingEvent) {
      return true;
    }

    const scheduledMaintenanceEventsToReplay: Array<ScheduledMaintenance> = [];

    for (const scheduledMaintenanceEvent of scheduledMaintenanceEvents) {
      if (
        !scheduledMaintenanceEvent.id ||
        !scheduledMaintenanceEvent.projectId
      ) {
        continue;
      }

      const knownHolding: boolean | undefined = holdingByEventId?.get(
        scheduledMaintenanceEvent.id.toString(),
      );

      if (knownHolding === true) {
        return true;
      }

      if (knownHolding === undefined) {
        scheduledMaintenanceEventsToReplay.push(scheduledMaintenanceEvent);
      }
    }

    return await this.replayWhetherScheduledMaintenancesHoldMonitors({
      scheduledMaintenanceEvents: scheduledMaintenanceEventsToReplay,
      holdingByEventId: holdingByEventId || new Map<string, boolean>(),
    });
  }

  /*
   * Replays the timelines of events in a state of their project's own and
   * tells whether any of them holds its monitors, recording each answer in
   * holdingByEventId. One read covers a whole batch of events (kept per
   * project, as the timeline of a single event is read), and it stops at the
   * first batch with an event that holds.
   */
  private async replayWhetherScheduledMaintenancesHoldMonitors(data: {
    scheduledMaintenanceEvents: Array<ScheduledMaintenance>;
    holdingByEventId: Map<string, boolean>;
  }): Promise<boolean> {
    const eventsByProjectId: Map<
      string,
      { projectId: ObjectID; scheduledMaintenanceIds: Array<ObjectID> }
    > = new Map<
      string,
      { projectId: ObjectID; scheduledMaintenanceIds: Array<ObjectID> }
    >();

    for (const scheduledMaintenanceEvent of data.scheduledMaintenanceEvents) {
      if (
        !scheduledMaintenanceEvent.id ||
        !scheduledMaintenanceEvent.projectId
      ) {
        continue;
      }

      const projectKey: string = scheduledMaintenanceEvent.projectId.toString();

      if (!eventsByProjectId.has(projectKey)) {
        eventsByProjectId.set(projectKey, {
          projectId: scheduledMaintenanceEvent.projectId,
          scheduledMaintenanceIds: [],
        });
      }

      eventsByProjectId
        .get(projectKey)!
        .scheduledMaintenanceIds.push(scheduledMaintenanceEvent.id);
    }

    for (const projectEvents of eventsByProjectId.values()) {
      // The project's states, read at most once, and only if a replay needs them.
      const getStates: () => Promise<Array<ScheduledMaintenanceState>> =
        this.getProjectStatesReader(projectEvents.projectId);

      for (
        let batchStart: number = 0;
        batchStart < projectEvents.scheduledMaintenanceIds.length;
        batchStart += TIMELINE_REPLAY_BATCH_SIZE
      ) {
        const scheduledMaintenanceIds: Array<ObjectID> =
          projectEvents.scheduledMaintenanceIds.slice(
            batchStart,
            batchStart + TIMELINE_REPLAY_BATCH_SIZE,
          );

        const timeline: Array<ScheduledMaintenanceStateTimeline> =
          await this.findBy({
            query: {
              scheduledMaintenanceId: QueryHelper.any(scheduledMaintenanceIds),
              projectId: projectEvents.projectId,
            },
            select: {
              _id: true,
              scheduledMaintenanceId: true,
              scheduledMaintenanceState: STATE_KIND_SELECT,
            },
            sort: {
              startsAt: SortOrder.Ascending,
            },
            limit: LIMIT_MAX,
            skip: 0,
            props: {
              isRoot: true,
            },
          });

        // The rows of every event in the batch, interleaved; split them up.
        const timelineByEventId: Map<
          string,
          Array<ScheduledMaintenanceStateTimeline>
        > = new Map<string, Array<ScheduledMaintenanceStateTimeline>>();

        for (const timelineItem of timeline) {
          const eventKey: string | undefined =
            timelineItem.scheduledMaintenanceId?.toString();

          if (!eventKey) {
            continue;
          }

          if (!timelineByEventId.has(eventKey)) {
            timelineByEventId.set(eventKey, []);
          }

          timelineByEventId.get(eventKey)!.push(timelineItem);
        }

        let isAnyHolding: boolean = false;

        for (const scheduledMaintenanceId of scheduledMaintenanceIds) {
          const eventKey: string = scheduledMaintenanceId.toString();

          const isHolding: boolean = await this.isHoldingAfterTimeline({
            timeline: timelineByEventId.get(eventKey) || [],
            getStates: getStates,
          });

          data.holdingByEventId.set(eventKey, isHolding);

          if (isHolding) {
            isAnyHolding = true;
          }
        }

        if (isAnyHolding) {
          return true;
        }
      }
    }

    return false;
  }

  /*
   * An event's state timeline, oldest first, replayed the way the
   * transitions applied it: entering a state where the event is in progress
   * holds the monitors - Ongoing, or a state of the project's own placed
   * between Ongoing and Ended (isStartIntoStateOfItsOwn) - and entering one
   * where it is over lets go of them: Ended, Completed, or a state of the
   * project's own placed after Ended (isEndIntoStateOfItsOwn). A state where
   * it has not started - Scheduled, or one of the project's own before
   * Ongoing - does neither (states only ever move forward).
   */
  private async isHoldingAfterTimeline(data: {
    timeline: Array<ScheduledMaintenanceStateTimeline>;
    // The event's project's states, read only if a state of its own needs them.
    getStates: () => Promise<Array<ScheduledMaintenanceState>>;
  }): Promise<boolean> {
    let isHolding: boolean = false;

    for (const timelineItem of data.timeline) {
      const timelineState: ScheduledMaintenanceState | undefined =
        timelineItem.scheduledMaintenanceState;

      if (!timelineState) {
        continue;
      }

      const inProgressByFlags: boolean | null =
        ScheduledMaintenanceStartUtil.isInProgressByFlags(timelineState);

      if (inProgressByFlags === true) {
        isHolding = true;
        continue;
      }

      if (inProgressByFlags === false) {
        if (ScheduledMaintenanceStartUtil.hasEndedByFlags(timelineState)) {
          isHolding = false;
        }
        continue;
      }

      // A state of the project's own: only its place can tell.
      const states: Array<ScheduledMaintenanceState> = await data.getStates();

      if (
        ScheduledMaintenanceStartUtil.isInProgress({
          states: states,
          state: timelineState,
        })
      ) {
        isHolding = true;
      } else if (
        ScheduledMaintenanceStartUtil.hasEnded({
          states: states,
          state: timelineState,
        })
      ) {
        isHolding = false;
      }
    }

    return isHolding;
  }

  /*
   * Reads a project's states - with their place and flags - the first time
   * it is called, and answers the same list after that.
   */
  private getProjectStatesReader(
    projectId: ObjectID,
  ): () => Promise<Array<ScheduledMaintenanceState>> {
    let states: Promise<Array<ScheduledMaintenanceState>> | null = null;

    return (): Promise<Array<ScheduledMaintenanceState>> => {
      if (!states) {
        states =
          ScheduledMaintenanceStateService.getAllScheduledMaintenanceStates({
            projectId: projectId,
            props: {
              isRoot: true,
            },
          });
      }

      return states;
    };
  }

  /*
   * Whether the event is holding its monitors in maintenance: it has moved
   * into a state where it is in progress and not since into one where it is
   * over. That is what the state transitions leave behind - the start
   * (Ongoing, or a state of the project's own between Ongoing and Ended,
   * say "Verifying") disables the attached monitors, the end (Ended,
   * Completed, or a state of the project's own after Ended, say
   * "Reviewing") restores them (both in onCreateSuccess), and a state where
   * the event has not started does neither. Asking the ongoing flag alone
   * would treat an event in "Verifying" like a scheduled one.
   *
   * The one definition of holding, for both questions asked of it: whether
   * an edit to an event's monitors puts them into or out of maintenance
   * (ScheduledMaintenanceService), and whether another event still holds a
   * monitor one is letting go of (isMonitorHeldInMaintenanceByAnyEvent,
   * which applies the same rules to many events at once).
   *
   * The built-in kinds answer from the state itself. Only a project's own
   * state costs a read: the event's timeline, replayed in order the way the
   * transitions applied it (isHoldingAfterTimeline).
   */
  @CaptureSpan()
  public async isScheduledMaintenanceHoldingMonitors(data: {
    scheduledMaintenanceId: ObjectID;
    projectId: ObjectID | undefined;
    currentState: ScheduledMaintenanceState | undefined;
  }): Promise<boolean> {
    const currentState: ScheduledMaintenanceState | undefined =
      data.currentState;

    if (!currentState || !data.projectId) {
      return false;
    }

    // Ongoing holds; Scheduled, Ended and Completed do not.
    const inProgressByFlags: boolean | null =
      ScheduledMaintenanceStartUtil.isInProgressByFlags(currentState);

    if (inProgressByFlags !== null) {
      return inProgressByFlags;
    }

    const timeline: Array<ScheduledMaintenanceStateTimeline> =
      await this.findBy({
        query: {
          scheduledMaintenanceId: data.scheduledMaintenanceId,
          projectId: data.projectId,
        },
        select: {
          _id: true,
          scheduledMaintenanceState: STATE_KIND_SELECT,
        },
        sort: {
          startsAt: SortOrder.Ascending,
        },
        limit: LIMIT_MAX,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

    return await this.isHoldingAfterTimeline({
      timeline: timeline,
      getStates: this.getProjectStatesReader(data.projectId),
    });
  }

  @CaptureSpan()
  protected override async onBeforeDelete(
    deleteBy: DeleteBy<ScheduledMaintenanceStateTimeline>,
  ): Promise<OnDelete<ScheduledMaintenanceStateTimeline>> {
    /*
     * OneUptime's own deletes of entries - a retention purge, a cleanup -
     * move no neighbour unless they name one entry by its id.
     */
    if (deleteBy.props.isRoot && !Service.getOneRowIdNamedBy(deleteBy.query)) {
      return { deleteBy, carryForward: null };
    }

    /*
     * The one entry the delete removes, and the delete held to it: its
     * neighbours close the gap it leaves. A delete of several entries - a
     * workflow's delete of many, say - has no one gap to close: it is left
     * as it is, and moves no neighbour.
     */
    const toBeDeleted: {
      row: ScheduledMaintenanceStateTimeline | null;
      deletesMore: boolean;
    } = await this.findOneRowAndHoldDeleteToIt(deleteBy, {
      scheduledMaintenanceId: true,
      startsAt: true,
      endsAt: true,
    });

    if (toBeDeleted.deletesMore) {
      return { deleteBy, carryForward: null };
    }

    if (toBeDeleted.row) {
      const scheduledMaintenanceStateTimelineToBeDeleted: ScheduledMaintenanceStateTimeline | null =
        toBeDeleted.row;

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
              _id: QueryHelper.notEquals(
                scheduledMaintenanceStateTimelineToBeDeleted.id!.toString(),
              ),
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
          logger.debug("This is the first state.", {
            scheduledMaintenanceId: scheduledMaintenanceId?.toString(),
          } as LogAttributes);
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
          logger.debug("This is the last state.", {
            scheduledMaintenanceId: scheduledMaintenanceId?.toString(),
          } as LogAttributes);
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
          logger.debug("This state is in the middle.", {
            scheduledMaintenanceId: scheduledMaintenanceId?.toString(),
          } as LogAttributes);
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

      /*
       * A deleted timeline row removes the point some anchors resolved to.
       * The recompute is a total function of what is left, so it converges
       * without any per-case repair -- but it has to be triggered.
       */
      ScheduledMaintenanceMeasurementValueService.recomputeForScheduledMaintenance(
        {
          scheduledMaintenanceId: scheduledMaintenanceId,
        },
      ).catch((error: Error) => {
        logger.error(
          `Error while recomputing scheduled maintenance measurements:`,
          {
            scheduledMaintenanceId: scheduledMaintenanceId?.toString(),
          } as LogAttributes,
        );
        logger.error(error, {
          scheduledMaintenanceId: scheduledMaintenanceId?.toString(),
        } as LogAttributes);
      });
    }

    return onDelete;
  }
}

export default new Service();
