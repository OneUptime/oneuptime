import CreateBy from "../Types/Database/CreateBy";
import IncidentMeasurementValueService from "./IncidentMeasurementValueService";
import DeleteBy from "../Types/Database/DeleteBy";
import { OnCreate, OnDelete, OnUpdate } from "../Types/Database/Hooks";
import QueryHelper from "../Types/Database/QueryHelper";
import UpdateBy from "../Types/Database/UpdateBy";
import ProjectReferencesService from "./ProjectReferencesService";
import IncidentPublicNoteService from "./IncidentPublicNoteService";
import IncidentService from "./IncidentService";
import IncidentSlaService from "./IncidentSlaService";
import IncidentStateService from "./IncidentStateService";
import UserService from "./UserService";
import CreatedByUser from "../Utils/Database/CreatedByUser";
import IncidentMemberService from "./IncidentMemberService";
import IncidentRoleService from "./IncidentRoleService";
import TeamMemberService from "./TeamMemberService";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import OneUptimeDate from "../../Types/Date";
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import PositiveNumber from "../../Types/PositiveNumber";
import StateChangeSubscriberNotification from "../../Types/StatusPage/StateChangeSubscriberNotification";
import Incident from "../../Models/DatabaseModels/Incident";
import IncidentPublicNote from "../../Models/DatabaseModels/IncidentPublicNote";
import IncidentState from "../../Models/DatabaseModels/IncidentState";
import IncidentStateTimeline from "../../Models/DatabaseModels/IncidentStateTimeline";
import IncidentMember from "../../Models/DatabaseModels/IncidentMember";
import IncidentRole from "../../Models/DatabaseModels/IncidentRole";
import { IsBillingEnabled } from "../EnvironmentConfig";
import ProjectScopedReferenceValidator from "../Utils/Database/ProjectScopedReferenceValidator";
import RelationIdUtil from "../Utils/Database/RelationIdUtil";
import logger, { LogAttributes } from "../Utils/Logger";
import IncidentFeedService from "./IncidentFeedService";
import AIIncidentPostmortemRunner from "../Utils/AI/SRE/IncidentPostmortemRunner";
import InvestigationGrader from "../Utils/AI/SRE/InvestigationGrader";
import { IncidentFeedEventType } from "../../Models/DatabaseModels/IncidentFeed";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import SubscriberNotificationResendAccess from "../Utils/StatusPage/SubscriberNotificationResendAccess";
import StateChangePublicNote from "../Utils/StatusPage/StateChangePublicNote";
import { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import WorkspaceNotificationRuleService from "./WorkspaceNotificationRuleService";
import { SemaphoreMutex } from "../Infrastructure/Semaphore";
import StateChangeLock from "../Utils/StateChangeLock";
import StateChangeFollowOn from "../Utils/StateChangeFollowOn";
import Exception from "../../Types/Exception/Exception";
import IncidentAlertService from "./IncidentAlertService";
import ResolvedStateUtil from "../../Utils/ResolvedState";
import AcknowledgedStateUtil from "../../Utils/AcknowledgedState";
import { StateListType } from "../../Utils/StateOrder";
import StateChangeFeedEmoji from "../Utils/StateChangeFeedEmoji";
import FeedMarkdown, { mdText } from "../../Utils/Markdown/FeedMarkdown";

export class Service extends ProjectReferencesService<IncidentStateTimeline> {
  public constructor() {
    super(IncidentStateTimeline);
    if (IsBillingEnabled) {
      this.hardDeleteItemsOlderThanInDays("startsAt", 3 * 365); // 3 years
    }
  }

  /*
   * The project's resolved state, which resolving an incident moves it
   * into: the first from the top flagged resolved.
   */
  @CaptureSpan()
  public async getResolvedStateIdForProject(
    projectId: ObjectID,
  ): Promise<ObjectID> {
    let resolvedState: IncidentState | null = null;

    try {
      resolvedState = await IncidentStateService.getResolvedIncidentState({
        projectId: projectId,
        props: {
          isRoot: true,
        },
      });
    } catch {
      resolvedState = null;
    }

    if (!resolvedState || !resolvedState.id) {
      throw new BadDataException("No resolved state found for the project");
    }

    return resolvedState.id;
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<IncidentStateTimeline>,
  ): Promise<OnCreate<IncidentStateTimeline>> {
    await super.onBeforeCreate(createBy);

    let mutex: SemaphoreMutex | null = null;

    try {
      if (!createBy.data.incidentId) {
        throw new BadDataException("incidentId is null");
      }

      // The incident's lock: given back in onCreateSuccess or onCreateError.
      mutex = await StateChangeLock.take({
        namespace: "IncidentStateTimeline.create",
        eventId: createBy.data.incidentId,
        logAttributes: {
          projectId: createBy.data.projectId?.toString(),
          incidentId: createBy.data.incidentId?.toString(),
        } as LogAttributes,
      });

      if (!createBy.data.startsAt) {
        createBy.data.startsAt = OneUptimeDate.getCurrentDate();
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

      // The public note that comes with the change, if any (a blank one is none).
      const publicNote: string | undefined =
        StateChangeSubscriberNotification.getPublicNote(
          createBy.miscDataProps as JSONObject | undefined,
        );

      /*
       * The note is posted once the change is saved (onCreateSuccess), as
       * the person changing the state, so that it comes after the change in
       * the incident feed and in Slack. With Notify on it is the one message
       * subscribers get about the change, which is recorded as sent by it.
       * So whether they may post it is asked now, before anything is read or
       * written, with the check the note's own create runs: a change whose
       * note they may not post is refused whole, rather than saved with
       * nobody told (StateChangePublicNote).
       *
       * It notifies exactly when the change was asked to: a change that does
       * not say keeps its column defaults and notifies itself, and its note
       * stays quiet - one message, not two.
       */
      let publicNoteToPost: IncidentPublicNote | undefined = undefined;

      if (publicNote) {
        publicNoteToPost = new IncidentPublicNote();
        publicNoteToPost.incidentId = createBy.data.incidentId;
        publicNoteToPost.note = publicNote;
        publicNoteToPost.postedAt = createBy.data.startsAt;
        publicNoteToPost.createdAt = createBy.data.startsAt;

        const noteProjectId: ObjectID | undefined =
          createBy.data.projectId || createBy.props.tenantId;

        if (noteProjectId) {
          publicNoteToPost.projectId = noteProjectId;
        }

        publicNoteToPost.shouldStatusPageSubscribersBeNotifiedOnNoteCreated =
          Boolean(createBy.data.shouldStatusPageSubscribersBeNotified);

        // Its messages name the state the incident moves to.
        StateChangePublicNote.markPostedWith(publicNoteToPost, incidentStateId);

        StateChangePublicNote.assertCallerMayPost({
          noteModelType: IncidentPublicNote,
          note: publicNoteToPost,
          props: createBy.props,
        });
      }

      // Who made the change, under either name of it: see CreatedByUser.
      const changedByUserId: ObjectID | null = CreatedByUser.getId(
        createBy.data,
        createBy.props,
      );

      if (changedByUserId && !createBy.data.rootCause) {
        createBy.data.rootCause =
          mdText`Incident state created by ${await UserService.getUserMarkdownString(
            {
              userId: changedByUserId,
              projectId: createBy.data.projectId || createBy.props.tenantId!,
            },
          )}`.toString();
      }

      /*
       * Same guard, same reason, as MonitorStatusTimelineService: an id that
       * exists nowhere (or belongs to another project) used to reach Postgres
       * and come back as a raw foreign key violation. The ordering check below
       * does look the state up, but only when there IS a preceding row with an
       * order, so the first timeline row for an incident went through unchecked.
       */
      await ProjectScopedReferenceValidator.validateReferencesBelongToProject({
        projectId: createBy.props.tenantId || createBy.data.projectId,
        subject: "incident state timeline",
        references: [
          {
            modelName: "Incident State",
            id: incidentStateId,
            service: IncidentStateService,
          },
        ],
      });

      // Execute queries for before and after states in parallel for better performance
      const [stateBeforeThis, stateAfterThis] = await Promise.all([
        this.findOneBy({
          query: {
            incidentId: createBy.data.incidentId,
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
              _id: true,
              order: true,
              name: true,
            },
            startsAt: true,
            endsAt: true,
          },
        }),
        this.findOneBy({
          query: {
            incidentId: createBy.data.incidentId,
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
        }),
      ]);

      logger.debug("State Before this", {
        projectId: createBy.data.projectId?.toString(),
        incidentId: createBy.data.incidentId?.toString(),
      } as LogAttributes);
      logger.debug(stateBeforeThis, {
        projectId: createBy.data.projectId?.toString(),
        incidentId: createBy.data.incidentId?.toString(),
      } as LogAttributes);

      // If this is the first state, then do not notify the owner.
      if (!stateBeforeThis) {
        // since this is the first status, do not notify the owner.
        createBy.data.isOwnerNotified = true;
      }

      /*
       * check if this new state and the previous state are same.
       * if yes, then throw bad data exception.
       */

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
            "Incident state cannot be same as previous state.",
          );
        }
      }

      if (stateBeforeThis && stateBeforeThis.incidentState?.order) {
        const newIncidentState: IncidentState | null =
          await IncidentStateService.findOneBy({
            query: {
              _id: incidentStateId,
            },
            select: {
              order: true,
              name: true,
            },
            props: {
              isRoot: true,
            },
          });

        if (newIncidentState && newIncidentState.order) {
          // check if the new incident state is in order is greater than the previous state order
          if (
            stateBeforeThis &&
            stateBeforeThis.incidentState &&
            stateBeforeThis.incidentState.order &&
            newIncidentState.order <= stateBeforeThis.incidentState.order
          ) {
            throw new BadDataException(
              `Incident cannot transition to ${newIncidentState.name} state from ${stateBeforeThis.incidentState.name} state because ${newIncidentState.name} is before ${stateBeforeThis.incidentState.name} in the order of incident states.`,
            );
          }
        }
      }

      // compute ends at. It's the start of the next status.
      if (stateAfterThis && stateAfterThis.startsAt) {
        createBy.data.endsAt = stateAfterThis.startsAt;
      }

      /*
       * check if this new state and the previous state are same.
       * if yes, then throw bad data exception.
       */

      if (stateAfterThis && stateAfterThis.incidentStateId && incidentStateId) {
        if (
          stateAfterThis.incidentStateId.toString() ===
          incidentStateId.toString()
        ) {
          throw new BadDataException(
            "Incident state cannot be same as next state.",
          );
        }
      }

      logger.debug("State After this", {
        projectId: createBy.data.projectId?.toString(),
        incidentId: createBy.data.incidentId?.toString(),
      } as LogAttributes);
      logger.debug(stateAfterThis, {
        projectId: createBy.data.projectId?.toString(),
        incidentId: createBy.data.incidentId?.toString(),
      } as LogAttributes);

      /*
       * The change's own notification, decided once: when it notifies
       * subscribers and a note comes with it, the note is the one message
       * they get (StateChangeSubscriberNotification).
       */
      StateChangeSubscriberNotification.applyToStateChange({
        stateChange: createBy.data,
        hasPublicNote: Boolean(publicNote),
        skippedMessage:
          "Notifications skipped as subscribers are not to be notified for this incident state change.",
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
    } catch (err) {
      /*
       * Refused by this hook, once the lock is taken: no create follows
       * to give it back.
       */
      await StateChangeLock.giveBack(mutex, {
        projectId: createBy.data.projectId?.toString(),
        incidentId: createBy.data.incidentId?.toString(),
      } as LogAttributes);

      throw err;
    }
  }

  @CaptureSpan()
  protected override async onCreateSuccess(
    onCreate: OnCreate<IncidentStateTimeline>,
    createdItem: IncidentStateTimeline,
  ): Promise<IncidentStateTimeline> {
    const mutex: SemaphoreMutex | null = onCreate.carryForward.mutex;

    if (!createdItem.incidentId) {
      throw new BadDataException("incidentId is null");
    }

    if (!createdItem.incidentStateId) {
      throw new BadDataException("incidentStateId is null");
    }
    // update the last status as ended.

    logger.debug("Status Timeline Before this", {
      projectId: createdItem.projectId?.toString(),
      incidentId: createdItem.incidentId?.toString(),
    } as LogAttributes);
    logger.debug(onCreate.carryForward.statusTimelineBeforeThisStatus, {
      projectId: createdItem.projectId?.toString(),
      incidentId: createdItem.incidentId?.toString(),
    } as LogAttributes);

    logger.debug("Status Timeline After this", {
      projectId: createdItem.projectId?.toString(),
      incidentId: createdItem.incidentId?.toString(),
    } as LogAttributes);
    logger.debug(onCreate.carryForward.statusTimelineAfterThisStatus, {
      projectId: createdItem.projectId?.toString(),
      incidentId: createdItem.incidentId?.toString(),
    } as LogAttributes);

    logger.debug("Created Item", {
      projectId: createdItem.projectId?.toString(),
      incidentId: createdItem.incidentId?.toString(),
    } as LogAttributes);
    logger.debug(createdItem, {
      projectId: createdItem.projectId?.toString(),
      incidentId: createdItem.incidentId?.toString(),
    } as LogAttributes);

    /*
     * now there are three cases.
     * 1. This is the first status OR there's no status after this.
     */
    if (!onCreate.carryForward.statusTimelineBeforeThisStatus) {
      // This is the first status, no need to update previous status.
      logger.debug("This is the first status.", {
        projectId: createdItem.projectId?.toString(),
        incidentId: createdItem.incidentId?.toString(),
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
        incidentId: createdItem.incidentId?.toString(),
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
        incidentId: createdItem.incidentId?.toString(),
      } as LogAttributes);
    }

    /*
     * The incident's current state follows its timeline, as OneUptime's own
     * write: the permission to create the change is the permission to change
     * the incident's state (StateChangeFollowOn).
     */
    if (!createdItem.endsAt) {
      await IncidentService.updateOneBy({
        query: {
          _id: createdItem.incidentId?.toString(),
        },
        data: {
          currentIncidentStateId: createdItem.incidentStateId,
        },
        props: StateChangeFollowOn.getEventWriteProps(onCreate.createBy.props),
      });
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

    await StateChangeLock.giveBack(mutex, {
      projectId: createdItem.projectId?.toString(),
      incidentId: createdItem.incidentId?.toString(),
    } as LogAttributes);

    /*
     * Carry the incident's new state over to its linked alerts, when the
     * project's linked alert switches say so (acknowledge and/or resolve them
     * with the incident; both are on for new projects). Only for the incident's current state - a back-dated row has
     * an endsAt - and after the mutex is released, since it writes alert
     * timelines. Fire-and-forget: it never fails or delays the state change.
     */
    if (!createdItem.endsAt && createdItem.projectId) {
      IncidentAlertService.cascadeIncidentStateToLinkedAlerts({
        projectId: createdItem.projectId,
        incidentId: createdItem.incidentId,
        incidentStateId: createdItem.incidentStateId,
      }).catch((error: Error) => {
        logger.error(
          `Error while carrying the incident state over to linked alerts: ${error}`,
          {
            projectId: createdItem.projectId?.toString(),
            incidentId: createdItem.incidentId?.toString(),
          } as LogAttributes,
        );
      });
    }

    /*
     * Whether the incident is resolved in this state, and was in the state
     * before it, by the one rule (Common/Utils/ResolvedState): the project's
     * resolved state, or a state placed after it, flagged or not.
     */
    const incidentStates: Array<IncidentState> =
      await IncidentStateService.getAllIncidentStates({
        projectId: createdItem.projectId!,
        props: {
          isRoot: true,
        },
      });

    const isResolved: boolean = ResolvedStateUtil.isResolved({
      list: StateListType.IncidentState,
      states: incidentStates,
      stateId: createdItem.incidentStateId,
    });

    const previousStateWasResolved: boolean = ResolvedStateUtil.isResolved({
      list: StateListType.IncidentState,
      states: incidentStates,
      stateId:
        onCreate.carryForward.statusTimelineBeforeThisStatus?.incidentStateId,
    });

    /*
     * Whether the incident is acknowledged in this state - the project's
     * acknowledged state, a state placed after it, or a resolved one - by
     * the one rule (Common/Utils/AcknowledgedState): what marks the feed
     * line and the SLA as responded.
     */
    const isAcknowledged: boolean = AcknowledgedStateUtil.isAcknowledged({
      list: StateListType.IncidentState,
      states: incidentStates,
      stateId: createdItem.incidentStateId,
    });

    /*
     * This change resolves the incident: it moves the incident's current
     * state - not a row dated before it - from a state that is not resolved,
     * or from none, into one that is. Moving on from one resolved state to
     * another ("Resolved" to "Closed") is no new resolve.
     */
    const resolvesIncident: boolean =
      !createdItem.endsAt && isResolved && !previousStateWasResolved;

    /*
     * The state's name is plain text, placed into the feed item's Markdown
     * (posted to Slack and Teams too) as text (mdText), so it reads as typed.
     */
    const stateName: string = incidentState?.name || "";
    const stateEmoji: string = StateChangeFeedEmoji.get({
      isResolved: isResolved,
      isAcknowledged: isAcknowledged,
      isCreatedState: Boolean(incidentState?.isCreatedState),
    });

    const incidentNumberResult: {
      number: number | null;
      numberWithPrefix: string | null;
    } = await IncidentService.getIncidentNumber({
      incidentId: createdItem.incidentId,
    });
    const incidentNumberDisplay: string =
      incidentNumberResult.numberWithPrefix ||
      "#" + incidentNumberResult.number;

    const projectId: ObjectID = createdItem.projectId!;
    const incidentId: ObjectID = createdItem.incidentId!;

    await IncidentFeedService.createIncidentFeedItem({
      incidentId: createdItem.incidentId!,
      projectId: createdItem.projectId!,
      incidentFeedEventType: IncidentFeedEventType.IncidentStateChanged,
      displayColor: incidentState?.color,
      feedInfoInMarkdown:
        mdText`${stateEmoji} Changed **[Incident ${incidentNumberDisplay}](${(await IncidentService.getIncidentLinkInDashboard(projectId!, incidentId!)).toString()}) State** to **${stateName}**`.toString(),
      moreInformationInMarkdown: mdText`**Cause:**
${FeedMarkdown.asMarkdown(createdItem.rootCause)}`.toString(),
      userId: createdItem.createdByUserId || onCreate.createBy.props.userId,
      workspaceNotification: {
        sendWorkspaceNotification: true,
        notifyUserId:
          createdItem.createdByUserId || onCreate.createBy.props.userId,
      },
    });

    // Auto-assign Incident Commander if not already assigned
    const stateChangeUserId: ObjectID | undefined =
      createdItem.createdByUserId || onCreate.createBy.props.userId;

    if (stateChangeUserId) {
      this.autoAssignIncidentCommander({
        incidentId: createdItem.incidentId!,
        projectId: createdItem.projectId!,
        userId: stateChangeUserId,
      }).catch((error: Error) => {
        logger.error(`Error while auto-assigning incident commander:`, {
          projectId: createdItem.projectId?.toString(),
          incidentId: createdItem.incidentId?.toString(),
        } as LogAttributes);
        logger.error(error, {
          projectId: createdItem.projectId?.toString(),
          incidentId: createdItem.incidentId?.toString(),
        } as LogAttributes);
      });
    }

    if (resolvesIncident) {
      const incident: Incident | null = await IncidentService.findOneBy({
        query: {
          _id: createdItem.incidentId.toString(),
        },
        select: {
          _id: true,
          projectId: true,
          monitors: {
            _id: true,
          },
          holdsMonitors: true,
        },
        props: {
          isRoot: true,
        },
      });

      /*
       * Resolving gives back the monitors the incident holds
       * (Incident.holdsMonitors): their monitoring resumes and their status
       * returns to operational, and from then on it holds nothing. An
       * incident that holds nothing - declared already resolved, or resolved
       * once already and reopened since - gives nothing back, so a status a
       * monitor holds for another reason stays. One from before this was
       * recorded gives its monitors back, as it always did.
       */
      if (incident && incident.holdsMonitors !== false) {
        await IncidentService.markMonitorsActiveForMonitoring(
          incident.projectId!,
          incident.monitors || [],
          createdItem.startsAt || undefined,
        );

        await IncidentService.recordHoldsMonitors({
          incidentId: createdItem.incidentId,
          holdsMonitors: false,
        });
      }

      /*
       * AI: auto-draft a postmortem now that the incident is resolved
       * (gated per project; never overwrites an existing postmortem).
       */
      AIIncidentPostmortemRunner.draftPostmortemOnResolve({
        incidentId: createdItem.incidentId!,
        projectId: createdItem.projectId!,
      }).catch((error: Error) => {
        logger.error(`AI auto-postmortem failed on resolve:`, {
          projectId: createdItem.projectId?.toString(),
          incidentId: createdItem.incidentId?.toString(),
        } as LogAttributes);
        logger.error(error, {
          projectId: createdItem.projectId?.toString(),
          incidentId: createdItem.incidentId?.toString(),
        } as LogAttributes);
      });

      /*
       * AI measurement layer: grade the completed investigation (if
       * any) against the human-recorded root cause. Fire-and-forget like
       * the postmortem draft above — must never block or fail the resolve.
       */
      InvestigationGrader.gradeInvestigationOnResolve({
        incidentId: createdItem.incidentId!,
        projectId: createdItem.projectId!,
      }).catch((error: Error) => {
        logger.error(`AI investigation grading failed on resolve:`, {
          projectId: createdItem.projectId?.toString(),
          incidentId: createdItem.incidentId?.toString(),
        } as LogAttributes);
        logger.error(error, {
          projectId: createdItem.projectId?.toString(),
          incidentId: createdItem.incidentId?.toString(),
        } as LogAttributes);
      });
    }

    /*
     * The note that came with the change, which onBeforeCreate built and
     * made sure may be posted: posted now, after the change, on the incident
     * and at the time the change was saved with, as the person who changed
     * the state.
     */
    if (onCreate.carryForward.publicNoteToPost) {
      const incidentPublicNote: IncidentPublicNote =
        onCreate.carryForward.publicNoteToPost;
      incidentPublicNote.postedAt = createdItem.startsAt!;
      incidentPublicNote.createdAt = createdItem.startsAt!;
      incidentPublicNote.projectId = createdItem.projectId!;

      await IncidentPublicNoteService.create({
        data: incidentPublicNote,
        props: onCreate.createBy.props,
      });
    }

    IncidentService.refreshIncidentMetrics({
      incidentId: createdItem.incidentId,
    }).catch((error: Error) => {
      logger.error(`Error while refreshing incident metrics:`, {
        projectId: createdItem.projectId?.toString(),
        incidentId: createdItem.incidentId?.toString(),
      } as LogAttributes);
      logger.error(error, {
        projectId: createdItem.projectId?.toString(),
        incidentId: createdItem.incidentId?.toString(),
      } as LogAttributes);
    });

    /*
     * A new timeline row moves every anchor that resolves against it, so the
     * derived measurements have to be recomputed. Fire-and-forget: the state
     * change itself is the user-visible write and must not fail because a
     * derived number could not be recalculated.
     */
    IncidentMeasurementValueService.recomputeForIncident({
      incidentId: createdItem.incidentId!,
    }).catch((error: Error) => {
      logger.error(`Error while recomputing incident measurements:`, {
        incidentId: createdItem.incidentId?.toString(),
      } as LogAttributes);
      logger.error(error);
    });

    // Track SLA response/resolution times
    this.trackSlaStateChange({
      incidentId: createdItem.incidentId,
      projectId: createdItem.projectId!,
      isAcknowledged: isAcknowledged,
      isResolved: isResolved,
      stateChangedAt: createdItem.startsAt || OneUptimeDate.getCurrentDate(),
      previousStateWasResolved: previousStateWasResolved,
    }).catch((error: Error) => {
      logger.error(`Error while tracking SLA state change:`, {
        projectId: createdItem.projectId?.toString(),
        incidentId: createdItem.incidentId?.toString(),
      } as LogAttributes);
      logger.error(error, {
        projectId: createdItem.projectId?.toString(),
        incidentId: createdItem.incidentId?.toString(),
      } as LogAttributes);
    });

    const isLastIncidentState: boolean = await this.isLastIncidentState({
      projectId: createdItem.projectId!,
      incidentStateId: createdItem.incidentStateId,
    });

    if (isLastIncidentState) {
      WorkspaceNotificationRuleService.archiveWorkspaceChannels({
        projectId: createdItem.projectId!,
        notificationFor: {
          incidentId: createdItem.incidentId,
        },
        sendMessageBeforeArchiving: {
          _type: "WorkspacePayloadMarkdown",
          text: mdText`**[Incident ${incidentNumberDisplay}](${(
            await IncidentService.getIncidentLinkInDashboard(
              createdItem.projectId!,
              createdItem.incidentId!,
            )
          ).toString()})** is resolved. Archiving channel.`.toString(),
        },
      }).catch((error: Error) => {
        logger.error(`Error while archiving workspace channels:`, {
          projectId: createdItem.projectId?.toString(),
          incidentId: createdItem.incidentId?.toString(),
        } as LogAttributes);
        logger.error(error, {
          projectId: createdItem.projectId?.toString(),
          incidentId: createdItem.incidentId?.toString(),
        } as LogAttributes);
      });
    }

    return createdItem;
  }

  /*
   * A change refused or failed once onBeforeCreate took the incident's lock -
   * by a check DatabaseService.create runs after the hook, at the INSERT,
   * or in onCreateSuccess before it gave the lock back - gives it back
   * here (StateChangeLock). Left held, every later change to the incident
   * would wait out the lock and then go ahead without it.
   */
  @CaptureSpan()
  protected override async onCreateError(
    error: Exception,
    onCreate?: OnCreate<IncidentStateTimeline> | undefined,
  ): Promise<Exception> {
    await StateChangeLock.giveBackFor(onCreate, {
      projectId: onCreate?.createBy.data.projectId?.toString(),
      incidentId: onCreate?.createBy.data.incidentId?.toString(),
    } as LogAttributes);

    return error;
  }

  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<IncidentStateTimeline>,
  ): Promise<OnUpdate<IncidentStateTimeline>> {
    await super.onBeforeUpdate(updateBy);

    /*
     * Retry - a user's Pending - over a state change notification that is
     * being sent would let a second run send it alongside, or be overwritten
     * when the send settles (SubscriberNotificationResendAccess).
     */
    await SubscriberNotificationResendAccess.assertNotQueuedWhileBeingSent({
      modelType: IncidentStateTimeline,
      service: this,
      updateBy: updateBy,
      statusColumns: ["subscriberNotificationStatus"],
    });

    const incidentIds: Array<ObjectID> =
      await this.getIncidentIdsForTimelineQuery(updateBy);

    return {
      updateBy,
      carryForward: incidentIds,
    };
  }

  @CaptureSpan()
  protected override async onUpdateSuccess(
    onUpdate: OnUpdate<IncidentStateTimeline>,
    updatedItemIds: ObjectID[],
  ): Promise<OnUpdate<IncidentStateTimeline>> {
    const incidentIds: Array<ObjectID> = [
      ...(Array.isArray(onUpdate.carryForward)
        ? (onUpdate.carryForward as Array<ObjectID>)
        : []),
    ];

    if (updatedItemIds.length > 0) {
      const updatedTimelines: Array<IncidentStateTimeline> = await this.findBy({
        query: {
          _id: QueryHelper.any(updatedItemIds),
        },
        select: {
          incidentId: true,
        },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        props: {
          isRoot: true,
          ignoreHooks: true,
        },
      });

      incidentIds.push(...this.getIncidentIdsFromTimelines(updatedTimelines));
    }

    this.refreshIncidentMetricsForIncidentIds(incidentIds);
    this.recomputeMeasurementsForIncidentIds(incidentIds);

    return onUpdate;
  }

  private async getIncidentIdsForTimelineQuery(
    updateBy: UpdateBy<IncidentStateTimeline>,
  ): Promise<Array<ObjectID>> {
    const timelines: Array<IncidentStateTimeline> = await this.findBy({
      query: updateBy.query,
      select: {
        incidentId: true,
      },
      skip: updateBy.skip,
      limit: updateBy.limit,
      props: {
        isRoot: true,
        ignoreHooks: true,
      },
    });

    return this.getIncidentIdsFromTimelines(timelines);
  }

  private getIncidentIdsFromTimelines(
    timelines: Array<IncidentStateTimeline>,
  ): Array<ObjectID> {
    const incidentIds: Map<string, ObjectID> = new Map<string, ObjectID>();

    for (const timeline of timelines) {
      if (timeline.incidentId) {
        incidentIds.set(timeline.incidentId.toString(), timeline.incidentId);
      }
    }

    return Array.from(incidentIds.values());
  }

  /*
   * Recomputes measurements for each affected entity exactly once. The
   * caller may hand the same id in twice -- an update can match the same
   * row before and after -- and a recompute is a whole-entity operation.
   */
  private recomputeMeasurementsForIncidentIds(ids: Array<ObjectID>): void {
    const uniqueIds: Map<string, ObjectID> = new Map<string, ObjectID>();

    for (const id of ids) {
      uniqueIds.set(id.toString(), id);
    }

    for (const id of uniqueIds.values()) {
      IncidentMeasurementValueService.recomputeForIncident({
        incidentId: id,
      }).catch((error: Error) => {
        logger.error(`Error while recomputing incident measurements:`, {
          incidentId: id.toString(),
        } as LogAttributes);
        logger.error(error);
      });
    }
  }

  private refreshIncidentMetricsForIncidentIds(
    incidentIds: Array<ObjectID>,
  ): void {
    const uniqueIncidentIds: Map<string, ObjectID> = new Map<
      string,
      ObjectID
    >();

    for (const incidentId of incidentIds) {
      uniqueIncidentIds.set(incidentId.toString(), incidentId);
    }

    for (const incidentId of uniqueIncidentIds.values()) {
      IncidentService.refreshIncidentMetrics({
        incidentId: incidentId,
      }).catch((error: Error) => {
        logger.error(`Error while refreshing incident metrics:`, {
          incidentId: incidentId.toString(),
        } as LogAttributes);
        logger.error(error, {
          incidentId: incidentId.toString(),
        } as LogAttributes);
      });

      /*
       * Deleting a timeline row can move an anchor or remove it entirely, so
       * the derived measurements must be recomputed from what is left.
       */
      IncidentMeasurementValueService.recomputeForIncident({
        incidentId: incidentId,
      }).catch((error: Error) => {
        logger.error(`Error while recomputing incident measurements:`, {
          incidentId: incidentId?.toString(),
        } as LogAttributes);
        logger.error(error);
      });
    }
  }

  private async isLastIncidentState(data: {
    projectId: ObjectID;
    incidentStateId: ObjectID;
  }): Promise<boolean> {
    // find all the states for this project and sort it by order. Then, check if this is the last state.
    const incidentStates: IncidentState[] = await IncidentStateService.findBy({
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

    const incidentState: IncidentState | null =
      incidentStates.find((incidentState: IncidentState) => {
        return incidentState.id?.toString() === data.incidentStateId.toString();
      }) || null;

    if (!incidentState) {
      throw new BadDataException("Incident state not found.");
    }

    const lastIncidentState: IncidentState | undefined =
      incidentStates[incidentStates.length - 1];

    if (lastIncidentState && lastIncidentState.id) {
      return lastIncidentState.id.toString() === incidentState.id?.toString();
    }

    return false;
  }

  @CaptureSpan()
  private async autoAssignIncidentCommander(data: {
    incidentId: ObjectID;
    projectId: ObjectID;
    userId: ObjectID;
  }): Promise<void> {
    // Find the primary role (Incident Commander) for this project
    const primaryRole: IncidentRole | null =
      await IncidentRoleService.findOneBy({
        query: {
          projectId: data.projectId,
          isPrimaryRole: true,
        },
        select: {
          _id: true,
        },
        props: {
          isRoot: true,
        },
      });

    if (!primaryRole || !primaryRole.id) {
      // No primary role found for this project
      return;
    }

    // Check if there's already an Incident Commander assigned to this incident
    const existingCommander: IncidentMember | null =
      await IncidentMemberService.findOneBy({
        query: {
          incidentId: data.incidentId,
          incidentRoleId: primaryRole.id,
        },
        select: {
          _id: true,
        },
        props: {
          isRoot: true,
        },
      });

    if (existingCommander) {
      // Already has an Incident Commander, don't assign another one
      return;
    }

    // Check if this user is already assigned to the incident (with any role)
    const existingMembership: IncidentMember | null =
      await IncidentMemberService.findOneBy({
        query: {
          incidentId: data.incidentId,
          userId: data.userId,
        },
        select: {
          _id: true,
        },
        props: {
          isRoot: true,
        },
      });

    if (existingMembership) {
      // User is already assigned to this incident, don't assign again
      return;
    }

    /*
     * Whoever changed the state is not necessarily a member: a master admin,
     * or someone acting on a link or session from before they left the
     * project. Only a member can be the commander.
     */
    if (
      !(await TeamMemberService.isUserMemberOfProject({
        projectId: data.projectId,
        userId: data.userId,
      }))
    ) {
      return;
    }

    // Assign the user as Incident Commander
    const incidentMember: IncidentMember = new IncidentMember();
    incidentMember.incidentId = data.incidentId;
    incidentMember.projectId = data.projectId;
    incidentMember.userId = data.userId;
    incidentMember.incidentRoleId = primaryRole.id;

    await IncidentMemberService.create({
      data: incidentMember,
      props: {
        isRoot: true,
      },
    });

    logger.debug(
      `Auto-assigned user ${data.userId.toString()} as Incident Commander for incident ${data.incidentId.toString()}`,
      {
        projectId: data.projectId?.toString(),
        incidentId: data.incidentId?.toString(),
      } as LogAttributes,
    );
  }

  @CaptureSpan()
  private async trackSlaStateChange(data: {
    incidentId: ObjectID;
    projectId: ObjectID;
    // The new state counts as acknowledged (Common/Utils/AcknowledgedState).
    isAcknowledged: boolean;
    isResolved: boolean;
    stateChangedAt: Date;
    previousStateWasResolved: boolean;
  }): Promise<void> {
    try {
      /*
       * Reopened: from a resolved state into one that is not (the one rule,
       * Common/Utils/ResolvedState). A state placed after Resolved is no
       * reopen.
       */
      if (data.previousStateWasResolved && !data.isResolved) {
        // Incident is being reopened - create a new SLA record
        const incident: Incident | null = await IncidentService.findOneById({
          id: data.incidentId,
          select: {
            declaredAt: true,
          },
          props: {
            isRoot: true,
          },
        });

        if (incident && incident.declaredAt) {
          // Create a new SLA record starting from the reopen time
          await IncidentSlaService.createSlaForIncident({
            incidentId: data.incidentId,
            projectId: data.projectId,
            declaredAt: data.stateChangedAt, // Use reopen time as SLA start time
          });

          logger.info(
            `Created new SLA record for reopened incident ${data.incidentId}`,
            {
              projectId: data.projectId?.toString(),
              incidentId: data.incidentId?.toString(),
            } as LogAttributes,
          );
        }

        return;
      }

      /*
       * Responded: the incident is acknowledged in its new state - the
       * acknowledged state, a state placed after it ("Investigating") or a
       * resolved one. Only an SLA not marked responded yet takes the time,
       * so moving on through such states keeps the first.
       */
      if (data.isAcknowledged) {
        await IncidentSlaService.markResponded({
          incidentId: data.incidentId,
          respondedAt: data.stateChangedAt,
        });
      }

      /*
       * Track the resolve: the move into a resolved state. Moving on from
       * one resolved state to another closes nothing more.
       */
      if (data.isResolved && !data.previousStateWasResolved) {
        await IncidentSlaService.markResolved({
          incidentId: data.incidentId,
          resolvedAt: data.stateChangedAt,
        });
      }
    } catch (error) {
      logger.error(`Error in trackSlaStateChange: ${error}`, {
        projectId: data.projectId?.toString(),
        incidentId: data.incidentId?.toString(),
      } as LogAttributes);
      throw error;
    }
  }

  @CaptureSpan()
  protected override async onBeforeDelete(
    deleteBy: DeleteBy<IncidentStateTimeline>,
  ): Promise<OnDelete<IncidentStateTimeline>> {
    if (deleteBy.query._id) {
      const incidentStateTimelineToBeDeleted: IncidentStateTimeline | null =
        await this.findOneById({
          id: new ObjectID(deleteBy.query._id as string),
          select: {
            incidentId: true,
            startsAt: true,
            endsAt: true,
          },
          props: {
            isRoot: true,
          },
        });

      const incidentId: ObjectID | undefined =
        incidentStateTimelineToBeDeleted?.incidentId;

      if (incidentId) {
        const incidentStateTimeline: PositiveNumber = await this.countBy({
          query: {
            incidentId: incidentId,
          },
          props: {
            isRoot: true,
          },
        });

        if (!incidentStateTimelineToBeDeleted) {
          throw new BadDataException("Incident state timeline not found.");
        }

        if (incidentStateTimeline.isOne()) {
          throw new BadDataException(
            "Cannot delete the only state timeline. Incident should have at least one state in its timeline.",
          );
        }

        /*
         * There are three cases.
         * 1. This is the first state.
         * 2. This is the last state.
         * 3. This is in the middle.
         */

        const stateBeforeThis: IncidentStateTimeline | null =
          await this.findOneBy({
            query: {
              _id: QueryHelper.notEquals(deleteBy.query._id as string),
              incidentId: incidentId,
              startsAt: QueryHelper.lessThanEqualTo(
                incidentStateTimelineToBeDeleted.startsAt!,
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

        const stateAfterThis: IncidentStateTimeline | null =
          await this.findOneBy({
            query: {
              incidentId: incidentId,
              startsAt: QueryHelper.greaterThan(
                incidentStateTimelineToBeDeleted.startsAt!,
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
            incidentId: incidentId?.toString(),
          } as LogAttributes);
        } else if (!stateAfterThis) {
          /*
           * This is the last state.
           * Update the previous state to end at the end of this state.
           */
          await this.updateOneById({
            id: stateBeforeThis.id!,
            data: {
              endsAt: incidentStateTimelineToBeDeleted.endsAt!,
            },
            props: {
              isRoot: true,
            },
          });
          logger.debug("This is the last state.", {
            incidentId: incidentId?.toString(),
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
              startsAt: incidentStateTimelineToBeDeleted.startsAt!,
            },
            props: {
              isRoot: true,
            },
          });
          logger.debug("This state is in the middle.", {
            incidentId: incidentId?.toString(),
          } as LogAttributes);
        }
      }

      return { deleteBy, carryForward: incidentId };
    }

    return { deleteBy, carryForward: null };
  }

  @CaptureSpan()
  protected override async onDeleteSuccess(
    onDelete: OnDelete<IncidentStateTimeline>,
    _itemIdsBeforeDelete: ObjectID[],
  ): Promise<OnDelete<IncidentStateTimeline>> {
    if (onDelete.carryForward) {
      // this is incidentId.
      const incidentId: ObjectID = onDelete.carryForward as ObjectID;

      // get last status of this incident.
      const incidentStateTimeline: IncidentStateTimeline | null =
        await this.findOneBy({
          query: {
            incidentId: incidentId,
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

      if (incidentStateTimeline && incidentStateTimeline.incidentStateId) {
        await IncidentService.updateOneBy({
          query: {
            _id: incidentId.toString(),
          },
          data: {
            currentIncidentStateId: incidentStateTimeline.incidentStateId,
          },
          props: {
            isRoot: true,
          },
        });
      }

      IncidentService.refreshIncidentMetrics({
        incidentId: incidentId,
      }).catch((error: Error) => {
        logger.error(`Error while refreshing incident metrics:`, {
          incidentId: incidentId?.toString(),
        } as LogAttributes);
        logger.error(error, {
          incidentId: incidentId?.toString(),
        } as LogAttributes);
      });
    }

    return onDelete;
  }
}

export default new Service();
