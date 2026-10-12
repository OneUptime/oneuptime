import CountBy from "../Types/Database/CountBy";
import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import FindBy from "../Types/Database/FindBy";
import UpdateBy from "../Types/Database/UpdateBy";
import { OnCreate, OnDelete, OnFind, OnUpdate } from "../Types/Database/Hooks";
import { applyIncidentEpisodeSelfPrivacyFilter } from "../Utils/IncidentEpisode/IncidentEpisodePrivacyFilter";
import ProjectReferencesService from "./ProjectReferencesService";
import IncidentStateService from "./IncidentStateService";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import PositiveNumber from "../../Types/PositiveNumber";
import Model from "../../Models/DatabaseModels/IncidentEpisode";
import IncidentState from "../../Models/DatabaseModels/IncidentState";
import IncidentSeverity from "../../Models/DatabaseModels/IncidentSeverity";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import NumberPrefixUtil from "../../Utils/Project/NumberPrefix";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import SubscriberNotificationResendAccess from "../Utils/StatusPage/SubscriberNotificationResendAccess";
import logger, { LogAttributes } from "../Utils/Logger";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import IncidentEpisodeStateTimeline from "../../Models/DatabaseModels/IncidentEpisodeStateTimeline";
import IncidentEpisodeStateTimelineService from "./IncidentEpisodeStateTimelineService";
import StatusPageSubscriberNotificationStatus from "../../Types/StatusPage/StatusPageSubscriberNotificationStatus";
import { IsBillingEnabled } from "../EnvironmentConfig";
import OneUptimeDate from "../../Types/Date";
import IncidentEpisodeFeedService from "./IncidentEpisodeFeedService";
import { IncidentEpisodeFeedEventType } from "../../Models/DatabaseModels/IncidentEpisodeFeed";
import { Red500, Yellow500, Purple500 } from "../../Types/BrandColors";
import URL from "../../Types/API/URL";
import DatabaseConfig from "../DatabaseConfig";
import IncidentSeverityService from "./IncidentSeverityService";
import ProjectScopedReferenceValidator, {
  getWrittenRelationReferences,
} from "../Utils/Database/ProjectScopedReferenceValidator";
import RelationIdUtil from "../Utils/Database/RelationIdUtil";
import IncidentEpisodeMemberService from "./IncidentEpisodeMemberService";
import IncidentEpisodeOwnerUserService from "./IncidentEpisodeOwnerUserService";
import IncidentEpisodeOwnerTeamService from "./IncidentEpisodeOwnerTeamService";
import TeamMemberService from "./TeamMemberService";
import IncidentEpisodeOwnerUser from "../../Models/DatabaseModels/IncidentEpisodeOwnerUser";
import IncidentEpisodeOwnerTeam from "../../Models/DatabaseModels/IncidentEpisodeOwnerTeam";
import IncidentEpisodeMember from "../../Models/DatabaseModels/IncidentEpisodeMember";
import User from "../../Models/DatabaseModels/User";
import { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import StatusPageVisibility from "../../Types/StatusPage/StatusPageVisibility";
import StatusPageVisibilityQuery from "../Utils/StatusPage/StatusPageVisibilityQuery";
import Dictionary from "../../Types/Dictionary";
import PartialEntity from "../../Types/Database/PartialEntity";
import NotificationRuleWorkspaceChannel from "../../Types/Workspace/NotificationRules/NotificationRuleWorkspaceChannel";
import WorkspaceType from "../../Types/Workspace/WorkspaceType";
import IncidentEpisodeWorkspaceMessages from "../Utils/Workspace/WorkspaceMessages/IncidentEpisode";
import OwnerRuleAssignment from "../Utils/Rules/OwnerRuleAssignment";
import { MessageBlocksByWorkspaceType } from "./WorkspaceNotificationRuleService";
import IncidentService from "./IncidentService";
import OnCallDutyPolicyService from "./OnCallDutyPolicyService";
import OnCallDutyPolicy from "../../Models/DatabaseModels/OnCallDutyPolicy";
import UserNotificationEventType from "../../Types/UserNotification/UserNotificationEventType";
import IncidentGroupingRuleService from "./IncidentGroupingRuleService";
import ProjectService from "./ProjectService";
import IncidentGroupingRule from "../../Models/DatabaseModels/IncidentGroupingRule";
import IncidentEpisodeLabelRuleEngineService from "./IncidentEpisodeLabelRuleEngineService";
import IncidentEpisodeOnCallRuleEngineService from "./IncidentEpisodeOnCallRuleEngineService";
import IncidentEpisodeOwnerRuleEngineService from "./IncidentEpisodeOwnerRuleEngineService";
import IncidentEpisodePrivacyRuleEngineService from "./IncidentEpisodePrivacyRuleEngineService";
import OnCallNotRunOnCreate from "../Utils/OnCall/OnCallNotRunOnCreate";
import StartingStageUtil, {
  StartingStage,
  StartingStageCarryForward,
  StartingState,
} from "../../Utils/StartingStage";
import AcknowledgedStateUtil from "../../Utils/AcknowledgedState";
import { StateListType } from "../../Utils/StateOrder";
import FeedMarkdown, { mdText } from "../../Utils/Markdown/FeedMarkdown";
import QueryHelper from "../Types/Database/QueryHelper";
import Select from "../Types/Database/Select";
import Incident from "../../Models/DatabaseModels/Incident";
import StateMoveCheck from "../Utils/StateMoveCheck";
import StateMoveUtil, { StateMoveRecord } from "../../Utils/StateMove";

/*
 * The two names of each reference this service reads off a write itself, ID
 * column first. A write may name a reference under either, and the two must
 * agree (RelationIdUtil.readConsistent), so what the service acts on is what
 * is stored.
 */
const INCIDENT_STATE_KEYS: Array<string> = [
  "currentIncidentStateId",
  "currentIncidentState",
];
const GROUPING_RULE_KEYS: Array<string> = [
  "incidentGroupingRuleId",
  "incidentGroupingRule",
];

/*
 * Why an episode's first timeline row sends status page subscribers
 * nothing: the episode's created notification is the one message about it.
 */
export const EPISODE_FIRST_STATE_SUBSCRIBER_MESSAGE: string =
  "The episode's first state is part of its created notification, so it is not sent to subscribers on its own.";

export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
    if (IsBillingEnabled) {
      this.hardDeleteItemsOlderThanInDays("createdAt", 3 * 365); // 3 years
    }
  }

  /*
   * The severity is checked by this service's own hooks below. Everything
   * else an episode names - its state, its assignee, its on-call policies and
   * labels, the grouping rule that opened it - is checked by
   * ProjectReferencesService.
   */
  protected override getRelationsCheckedByService(): Array<string> {
    return ["incidentSeverity"];
  }

  @CaptureSpan()
  protected override async onBeforeFind(
    findBy: FindBy<Model>,
  ): Promise<OnFind<Model>> {
    findBy.query = applyIncidentEpisodeSelfPrivacyFilter(
      findBy.query,
      findBy.props,
    );
    return { findBy, carryForward: null };
  }

  @CaptureSpan()
  public override async countBy(
    countBy: CountBy<Model>,
  ): Promise<PositiveNumber> {
    countBy.query = applyIncidentEpisodeSelfPrivacyFilter(
      countBy.query,
      countBy.props,
    );
    return super.countBy(countBy);
  }

  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    await super.onBeforeUpdate(updateBy);

    updateBy.query = applyIncidentEpisodeSelfPrivacyFilter(
      updateBy.query,
      updateBy.props,
    );

    /*
     * Visible on Status Page and Private as they are stored, and a private
     * episode hidden from status pages (StatusPageVisibility): making an
     * episode private switches Visible on Status Page off with it, whoever
     * writes it - a privacy rule, the API, Terraform, a workflow.
     */
    StatusPageVisibility.normalizeWrite(
      updateBy.data as unknown as Record<string, unknown>,
    );

    /*
     * Sending the episode's created notification again while it is being
     * sent would let a second run send it alongside, or be overwritten when
     * the send settles (SubscriberNotificationResendAccess). No user role may
     * write its status (update: []), so this only ever stops a master admin;
     * it is here so the rule holds for every notification the same way.
     */
    await SubscriberNotificationResendAccess.assertNotQueuedWhileBeingSent({
      modelType: Model,
      service: this,
      updateBy: updateBy,
      statusColumns: ["subscriberNotificationStatusOnEpisodeCreated"],
    });

    /*
     * An episode carries the same project-scoped state and severity an
     * incident does, on FKs that are equally ON DELETE NO ACTION, so an id
     * from another project here leaves that project undeletable in exactly
     * the same way. onBeforeCreate checks both on a create, and an update
     * can write either. Each by both of its names: every name that holds an
     * id is checked, and two that disagree are refused - against the project
     * of every episode the update changes, the request's or, for an update
     * with none on it, each episode's own (where an id the episodes already
     * hold is left alone).
     */
    await ProjectScopedReferenceValidator.validateUpdateReferences({
      service: this,
      updateBy: updateBy,
      subject: "incident episode",
      relations: [
        {
          idColumn: "currentIncidentStateId",
          relation: "currentIncidentState",
          modelName: "Incident State",
          service: IncidentStateService,
        },
        {
          idColumn: "incidentSeverityId",
          relation: "incidentSeverity",
          modelName: "Incident Severity",
          service: IncidentSeverityService,
        },
      ],
    });

    /*
     * An update that writes the episode's state moves it, by the rule its
     * state timeline holds every move to (Common/Utils/StateMove): never
     * back up the project's list of incident states. Refused before
     * anything is written, with the timeline's own sentence.
     */
    await StateMoveCheck.assertUpdateMovesAllowed({
      record: StateMoveRecord.IncidentEpisode,
      updateBy: updateBy,
      stateKeys: INCIDENT_STATE_KEYS,
      stateModelName: "Incident State",
      findRowsAndHold: (select: Select<Model>): Promise<Array<Model>> => {
        return this.findRowsAndHoldUpdateToThem(updateBy, select);
      },
      getProjectStates: (
        projectId: ObjectID,
      ): Promise<Array<IncidentState>> => {
        return IncidentStateService.getAllIncidentStates({
          projectId: projectId,
          props: {
            isRoot: true,
          },
        });
      },
    });

    return { updateBy, carryForward: null };
  }

  /*
   * A state an update wrote is a change of the episode's state, recorded on
   * its state timeline like any other - as an alert episode's, an
   * incident's and an alert's are - so the episode's feed, its owners and
   * its incidents hear of it, and its header and its timeline agree.
   * onBeforeUpdate held the move to the state move rule; writing the state
   * an episode is in already records nothing (changeEpisodeState). The
   * episode's own state follow-ons - OneUptime's writes that carry the
   * timeline over, with no project on them - record nothing either.
   */
  @CaptureSpan()
  protected override async onUpdateSuccess(
    onUpdate: OnUpdate<Model>,
    updatedItemIds: Array<ObjectID>,
  ): Promise<OnUpdate<Model>> {
    const updatedIncidentStateId: ObjectID | null =
      RelationIdUtil.readConsistent(
        onUpdate.updateBy.data as unknown as Record<string, unknown>,
        INCIDENT_STATE_KEYS,
        "Incident State",
      );

    if (updatedIncidentStateId && onUpdate.updateBy.props.tenantId) {
      for (const itemId of updatedItemIds) {
        await this.changeEpisodeState({
          projectId: onUpdate.updateBy.props.tenantId as ObjectID,
          episodeId: itemId,
          incidentStateId: updatedIncidentStateId,
          notifyOwners: true,
          rootCause: "State was changed when the episode was updated.",
          props: {
            isRoot: true,
          },
        });
      }
    }

    return onUpdate;
  }

  /*
   * A private episode is hidden from every status page (StatusPageVisibility),
   * so an update that turns Visible on Status Page on and leaves Private as
   * it is - the episode's Status Pages switch, the API, Terraform, a
   * workflow - shows only the episodes that are not private.
   *
   * Each episode is decided by itself, by the database, in its own row's
   * write (DatabaseService.getRowWriteSql): the switch is stored on only
   * while the episode is not private as it is then, so no privacy write
   * landing at the same moment leaves both on. What the write stored is
   * what the workflow trigger, the realtime event and the audit log are
   * told. No earlier read, and no other episode, decides it.
   */
  protected override getRowWriteSql(
    data: PartialEntity<Model>,
  ): Dictionary<string> {
    return StatusPageVisibilityQuery.getRowWriteSql(
      data as unknown as Record<string, unknown>,
    );
  }

  @CaptureSpan()
  protected override async onBeforeDelete(
    deleteBy: DeleteBy<Model>,
  ): Promise<OnDelete<Model>> {
    deleteBy.query = applyIncidentEpisodeSelfPrivacyFilter(
      deleteBy.query,
      deleteBy.props,
    );
    return { deleteBy, carryForward: null };
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    await super.onBeforeCreate(createBy);

    if (!createBy.props.tenantId && !createBy.props.isRoot) {
      throw new BadDataException(
        "ProjectId required to create incident episode.",
      );
    }

    const projectId: ObjectID =
      createBy.props.tenantId || createBy.data.projectId!;

    const createData: Record<string, unknown> =
      createBy.data as unknown as Record<string, unknown>;

    /*
     * The state the episode starts in, when the write picks one: the Create
     * Incident Episode form's Initial State sends the relation, the API,
     * Terraform and workflows the ID column. Either name, and the two must
     * agree. With none picked, the episode starts in the project's created
     * state, where every episode a grouping rule opens starts.
     */
    const pickedIncidentStateId: ObjectID | null =
      RelationIdUtil.readConsistent(
        createData,
        INCIDENT_STATE_KEYS,
        "Incident State",
      );

    /*
     * Where it starts (StartingStage), read once, here, and handed to
     * onCreateSuccess, which decides on it what the create sets off: an
     * episode recorded already acknowledged pages nobody, and one recorded
     * resolved opens no channel either. The read holds only the project's
     * own states, so it also checks the state picked. With none picked the
     * episode starts in the created state - open, as every episode a
     * grouping rule opens - and there is nothing to read.
     */
    const pickedStart: StartingState | null = pickedIncidentStateId
      ? await IncidentStateService.getStartingState({
          projectId: projectId,
          incidentStateId: pickedIncidentStateId,
        })
      : null;

    const startingStage: StartingStage =
      pickedStart?.stage || StartingStage.Open;

    /*
     * The state picked, unless the read above found it, and the severity: a
     * state or a severity of another project is refused, with the same
     * words as one that does not exist, before a number is used.
     */
    await ProjectScopedReferenceValidator.validateReferencesBelongToProject({
      projectId: projectId,
      subject: "incident episode",
      references: [
        ...(pickedStart
          ? []
          : getWrittenRelationReferences({
              payload: createBy.data,
              idColumn: "currentIncidentStateId",
              relation: "currentIncidentState",
              modelName: "Incident State",
              service: IncidentStateService,
            })),
        ...getWrittenRelationReferences({
          payload: createBy.data,
          idColumn: "incidentSeverityId",
          relation: "incidentSeverity",
          modelName: "Incident Severity",
          service: IncidentSeverityService,
        }),
      ],
    });

    /*
     * The state it starts in, under the ID column alone: stamp leaves no
     * other name of it to be stored instead, so the state checked above is
     * the state stored - and the state onCreateSuccess writes the episode's
     * first timeline row in. The created state is looked up only when the
     * write picked none.
     */
    RelationIdUtil.stamp(
      createData,
      INCIDENT_STATE_KEYS,
      pickedIncidentStateId ||
        (await IncidentStateService.getCreatedIncidentStateId(projectId)),
    );

    /*
     * resolvedAt follows the state the episode starts in, by the one rule
     * (Common/Utils/ResolvedState) its first timeline row reads too
     * (IncidentEpisodeStateTimelineService): set for a state that counts as
     * resolved - the project's resolved state, or one placed after it. One
     * recorded as already resolved is resolved from the moment it exists:
     * grouping, auto-resolve and the Active episode lists read resolvedAt,
     * which the first timeline row would otherwise set only once
     * onCreateSuccess reaches it, after the workspace channels; that row
     * keeps it. Any other episode has none yet, whatever the write sent: the
     * first timeline row would clear it anyway.
     */
    if (pickedStart?.stage === StartingStage.Resolved) {
      createBy.data.resolvedAt = OneUptimeDate.getCurrentDate();
    } else {
      delete createData["resolvedAt"];
    }

    // Auto-generate episode number
    const episodeCounterResult: {
      counter: number;
      prefix: string | undefined;
    } = await ProjectService.incrementAndGetIncidentEpisodeCounter(projectId);

    createBy.data.episodeNumber = episodeCounterResult.counter;
    createBy.data.episodeNumberWithPrefix = NumberPrefixUtil.formatNumber(
      episodeCounterResult.prefix,
      episodeCounterResult.counter,
    );

    // Set initial lastIncidentAddedAt
    if (!createBy.data.lastIncidentAddedAt) {
      createBy.data.lastIncidentAddedAt = OneUptimeDate.getCurrentDate();
    }

    // Set declaredAt if not provided
    if (!createBy.data.declaredAt) {
      createBy.data.declaredAt = OneUptimeDate.getCurrentDate();
    }

    /*
     * Copy showEpisodeOnStatusPage from the grouping rule that opened it, named
     * under either of its names (the two must agree).
     */
    const incidentGroupingRuleId: ObjectID | null =
      RelationIdUtil.readConsistent(
        createBy.data as unknown as Record<string, unknown>,
        GROUPING_RULE_KEYS,
        "Incident Grouping Rule",
      );

    if (incidentGroupingRuleId) {
      const groupingRule: IncidentGroupingRule | null =
        await IncidentGroupingRuleService.findOneById({
          id: incidentGroupingRuleId,
          select: {
            showEpisodeOnStatusPage: true,
          },
          props: {
            isRoot: true,
          },
        });

      if (groupingRule) {
        createBy.data.isVisibleOnStatusPage =
          groupingRule.showEpisodeOnStatusPage ?? true;
      }
    }

    /*
     * A private episode is hidden from every status page
     * (StatusPageVisibility): created private, it is created with Visible on
     * Status Page off, whatever the request or the grouping rule says for it,
     * and nobody is told it was created - as an incident created private.
     * Last, after everything above that sets the switch.
     */
    StatusPageVisibility.normalizeWrite(createData);

    if (StatusPageVisibility.isPrivate(createBy.data)) {
      createBy.data.shouldStatusPageSubscribersBeNotifiedOnEpisodeCreated =
        false;
    }

    const carryForward: StartingStageCarryForward = {
      startingStage: startingStage,
    };

    return { createBy, carryForward: carryForward };
  }

  @CaptureSpan()
  protected override async onCreateSuccess(
    onCreate: OnCreate<Model>,
    createdItem: Model,
  ): Promise<Model> {
    if (!createdItem.projectId) {
      throw new BadDataException("projectId is required");
    }

    if (!createdItem.id) {
      throw new BadDataException("id is required");
    }

    if (!createdItem.currentIncidentStateId) {
      throw new BadDataException("currentIncidentStateId is required");
    }

    /*
     * How far along the episode starts, as onBeforeCreate read it
     * (StartingStage). Created already acknowledged, no on-call policy runs;
     * created resolved, no channel is opened for it either. Its rules, its
     * feed and its first state still happen.
     */
    const startingStage: StartingStage = StartingStageUtil.fromCarryForward(
      onCreate.carryForward,
    );

    // Create initial state timeline entry
    Promise.resolve()
      .then(async () => {
        /*
         * Apply privacy rules BEFORE workspace operations so the workspace
         * channel is created with the correct privacy setting. This may set
         * createdItem.isPrivate=true in memory.
         */
        try {
          await IncidentEpisodePrivacyRuleEngineService.applyRulesToEpisode(
            createdItem,
          );
        } catch (error) {
          logger.error(
            `Apply incident episode privacy rules failed in IncidentEpisodeService.onCreateSuccess: ${error}`,
            {
              projectId: createdItem.projectId?.toString(),
              incidentEpisodeId: createdItem.id?.toString(),
            } as LogAttributes,
          );
        }
      })
      .then(async () => {
        /*
         * No channel is opened for an episode created resolved. Its created
         * feed entry still goes to the channels the workspace rules name.
         */
        try {
          if (
            createdItem.projectId &&
            createdItem.id &&
            StartingStageUtil.isOngoing(startingStage)
          ) {
            await this.handleEpisodeWorkspaceOperationsAsync(createdItem);
          }
        } catch (error) {
          logger.error(
            `Workspace operations failed in IncidentEpisodeService.onCreateSuccess: ${error}`,
            {
              projectId: createdItem.projectId?.toString(),
              incidentEpisodeId: createdItem.id?.toString(),
            } as LogAttributes,
          );
        }
      })
      .then(async () => {
        try {
          await this.changeEpisodeState({
            projectId: createdItem.projectId!,
            episodeId: createdItem.id!,
            incidentStateId: createdItem.currentIncidentStateId!,
            notifyOwners: false,
            rootCause: undefined,
            // Told with the episode's created notification, if at all.
            isFirstState: true,
            props: {
              isRoot: true,
            },
          });
        } catch (error) {
          logger.error(
            `Handle episode state change failed in IncidentEpisodeService.onCreateSuccess: ${error}`,
            {
              projectId: createdItem.projectId?.toString(),
              incidentEpisodeId: createdItem.id?.toString(),
            } as LogAttributes,
          );
        }
      })
      .then(async () => {
        try {
          await this.createEpisodeCreatedFeed(createdItem);
        } catch (error) {
          logger.error(
            `Create episode feed failed in IncidentEpisodeService.onCreateSuccess: ${error}`,
            {
              projectId: createdItem.projectId?.toString(),
              incidentEpisodeId: createdItem.id?.toString(),
            } as LogAttributes,
          );
        }
      })
      .then(async () => {
        // Apply owner rules: add matched owner users/teams to the episode.
        try {
          await IncidentEpisodeOwnerRuleEngineService.applyRulesToEpisode(
            createdItem,
          );
        } catch (error) {
          logger.error(
            `Apply incident episode owner rules failed in IncidentEpisodeService.onCreateSuccess: ${error}`,
            {
              projectId: createdItem.projectId?.toString(),
              incidentEpisodeId: createdItem.id?.toString(),
            } as LogAttributes,
          );
        }
      })
      .then(async () => {
        // Apply label rules: attach matched labels to the episode.
        try {
          await IncidentEpisodeLabelRuleEngineService.applyRulesToEpisode(
            createdItem,
          );
        } catch (error) {
          logger.error(
            `Apply incident episode label rules failed in IncidentEpisodeService.onCreateSuccess: ${error}`,
            {
              projectId: createdItem.projectId?.toString(),
              incidentEpisodeId: createdItem.id?.toString(),
            } as LogAttributes,
          );
        }
      })
      .then(async () => {
        /*
         * Apply on-call rules: merge matched policies into the episode's
         * onCallDutyPolicies before the fan-out below picks them up.
         */
        try {
          await IncidentEpisodeOnCallRuleEngineService.applyRulesToEpisode(
            createdItem,
          );
        } catch (error) {
          logger.error(
            `Apply incident episode on-call rules failed in IncidentEpisodeService.onCreateSuccess: ${error}`,
            {
              projectId: createdItem.projectId?.toString(),
              incidentEpisodeId: createdItem.id?.toString(),
            } as LogAttributes,
          );
        }
      })
      .then(async () => {
        // Execute on-call duty policies
        try {
          await this.executeEpisodeOnCallDutyPoliciesAsync(
            createdItem,
            startingStage,
          );
        } catch (error) {
          logger.error(
            `On-call duty policy execution failed in IncidentEpisodeService.onCreateSuccess: ${error}`,
            {
              projectId: createdItem.projectId?.toString(),
              incidentEpisodeId: createdItem.id?.toString(),
            } as LogAttributes,
          );
        }
      })
      .catch((error: Error) => {
        logger.error(
          `Critical error in IncidentEpisodeService.onCreateSuccess: ${error}`,
          {
            projectId: createdItem.projectId?.toString(),
            incidentEpisodeId: createdItem.id?.toString(),
          } as LogAttributes,
        );
      });

    return createdItem;
  }

  @CaptureSpan()
  private async handleEpisodeWorkspaceOperationsAsync(
    createdItem: Model,
  ): Promise<void> {
    try {
      if (!createdItem.projectId || !createdItem.id) {
        throw new BadDataException(
          "projectId and id are required for workspace operations",
        );
      }

      const workspaceResult: {
        channelsCreated: Array<NotificationRuleWorkspaceChannel>;
      } | null =
        await IncidentEpisodeWorkspaceMessages.createChannelsAndInviteUsersToChannels(
          {
            projectId: createdItem.projectId,
            incidentEpisodeId: createdItem.id,
            episodeNumber: createdItem.episodeNumber || 0,
            ...(createdItem.episodeNumberWithPrefix
              ? {
                  episodeNumberWithPrefix: createdItem.episodeNumberWithPrefix,
                }
              : {}),
            isPrivate: createdItem.isPrivate === true,
          },
        );

      if (workspaceResult && workspaceResult.channelsCreated?.length > 0) {
        await this.updateOneById({
          id: createdItem.id,
          data: {
            postUpdatesToWorkspaceChannels:
              workspaceResult.channelsCreated || [],
          },
          props: {
            isRoot: true,
          },
        });
      }
    } catch (error) {
      logger.error(`Error in handleEpisodeWorkspaceOperationsAsync: ${error}`, {
        projectId: createdItem.projectId?.toString(),
        incidentEpisodeId: createdItem.id?.toString(),
      } as LogAttributes);
      throw error;
    }
  }

  @CaptureSpan()
  private async createEpisodeCreatedFeed(episode: Model): Promise<void> {
    if (!episode.id || !episode.projectId) {
      return;
    }

    /*
     * The title is plain text, often copied from the episode's first
     * incident - whose title anyone holding an incident form's link may
     * have typed - placed into Markdown the dashboard renders without its
     * safe mode and posts to Slack and Teams. Escaped as MarkdownEscape
     * says a title must be, so it cannot become an image, raw HTML or a
     * link that hides where it goes. The description stays Markdown.
     */
    let feedInfoInMarkdown: string =
      mdText`#### Episode ${episode.episodeNumberWithPrefix || "#" + episode.episodeNumber?.toString()} Created

**${episode.title || "No title provided."}**

`.toString();

    if (episode.description) {
      feedInfoInMarkdown += mdText`${FeedMarkdown.asMarkdown(episode.description)}\n\n`;
    }

    if (episode.isManuallyCreated) {
      feedInfoInMarkdown += `This episode was manually created.\n\n`;
    }

    const episodeCreateMessageBlocks: Array<MessageBlocksByWorkspaceType> =
      await IncidentEpisodeWorkspaceMessages.getIncidentEpisodeCreateMessageBlocks(
        {
          incidentEpisodeId: episode.id,
          projectId: episode.projectId,
        },
      );

    await IncidentEpisodeFeedService.createIncidentEpisodeFeedItem({
      incidentEpisodeId: episode.id,
      projectId: episode.projectId,
      incidentEpisodeFeedEventType: IncidentEpisodeFeedEventType.EpisodeCreated,
      displayColor: Red500,
      feedInfoInMarkdown: feedInfoInMarkdown,
      userId: episode.createdByUserId || undefined,
      workspaceNotification: {
        appendMessageBlocks: episodeCreateMessageBlocks,
        sendWorkspaceNotification: true,
      },
    });
  }

  /*
   * Runs the episode's on-call policies - the ones its create named and the
   * ones its on-call rules added - when it starts open. Created already
   * acknowledged or resolved, somebody is on it or it is over: none of them
   * runs, and its feed says so instead, naming them (OnCallNotRunOnCreate).
   */
  @CaptureSpan()
  private async executeEpisodeOnCallDutyPoliciesAsync(
    createdItem: Model,
    startingStage: StartingStage,
  ): Promise<void> {
    if (!createdItem.id || !createdItem.projectId) {
      return;
    }

    try {
      // Fetch the episode with on-call duty policies since they may not be loaded
      const episodeWithPolicies: Model | null = await this.findOneById({
        id: createdItem.id,
        select: {
          onCallDutyPolicies: {
            _id: true,
            name: true,
          },
        },
        props: {
          isRoot: true,
        },
      });

      if (
        !episodeWithPolicies?.onCallDutyPolicies?.length ||
        episodeWithPolicies.onCallDutyPolicies.length === 0
      ) {
        return;
      }

      if (!StartingStageUtil.pagesOnCall(startingStage)) {
        await OnCallNotRunOnCreate.createFeedItem({
          record: { incidentEpisodeId: createdItem.id },
          projectId: createdItem.projectId,
          stage: startingStage,
          policies: episodeWithPolicies.onCallDutyPolicies,
        });
        return;
      }

      // Execute all on-call policies in parallel
      const policyPromises: Promise<void>[] =
        episodeWithPolicies.onCallDutyPolicies.map(
          (policy: OnCallDutyPolicy) => {
            return OnCallDutyPolicyService.executePolicy(
              new ObjectID(policy._id as string),
              {
                triggeredByIncidentEpisodeId: createdItem.id!,
                userNotificationEventType:
                  UserNotificationEventType.IncidentEpisodeCreated,
              },
            );
          },
        );

      await Promise.allSettled(policyPromises);

      // Update the flag to indicate on-call policy has been executed
      await this.updateOneById({
        id: createdItem.id,
        data: {
          isOnCallPolicyExecuted: true,
        },
        props: {
          isRoot: true,
        },
      });

      // Create feed entry for on-call policy execution
      const policyNames: string[] = episodeWithPolicies.onCallDutyPolicies
        .map((policy: OnCallDutyPolicy) => {
          return policy.name || "Unnamed Policy";
        })
        .filter((name: string) => {
          return Boolean(name);
        });

      let feedInfoInMarkdown: string = `#### On-Call Policy Executed\n\n`;
      feedInfoInMarkdown += mdText`The following on-call ${policyNames.length === 1 ? "policy has" : "policies have"} been executed for this episode:\n\n`;

      // Each policy name is plain text.
      for (const policyName of policyNames) {
        feedInfoInMarkdown += mdText`- ${policyName}\n`;
      }

      await IncidentEpisodeFeedService.createIncidentEpisodeFeedItem({
        incidentEpisodeId: createdItem.id,
        projectId: createdItem.projectId,
        incidentEpisodeFeedEventType: IncidentEpisodeFeedEventType.OnCallPolicy,
        displayColor: Purple500,
        feedInfoInMarkdown: feedInfoInMarkdown,
      });
    } catch (error) {
      logger.error(`Error in executeEpisodeOnCallDutyPoliciesAsync: ${error}`, {
        projectId: createdItem.projectId?.toString(),
        incidentEpisodeId: createdItem.id?.toString(),
      } as LogAttributes);
      throw error;
    }
  }

  @CaptureSpan()
  public async changeEpisodeState(data: {
    projectId: ObjectID;
    episodeId: ObjectID;
    incidentStateId: ObjectID;
    notifyOwners: boolean;
    rootCause: string | undefined;
    props: DatabaseCommonInteractionProps;
    cascadeToIncidents?: boolean;
    /*
     * The episode's first state, written when it is created. It is part of
     * the episode's created notification - which tells subscribers about the
     * episode, or skips it - and is never sent to them on its own, whichever
     * state the episode starts in: the row is written as Skipped, saying
     * why, instead of being queued. Left out, the row is queued for
     * subscribers like any state change.
     */
    isFirstState?: boolean | undefined;
    /*
     * OneUptime's reopen of a recently resolved episode for its grouping
     * rule's reopen window (reopenEpisode): the one move back up the list of
     * states the state move rule allows, written through the timeline's own
     * reopen (IncidentEpisodeStateTimelineService.createReopen).
     */
    isGroupingRuleReopen?: boolean | undefined;
  }): Promise<void> {
    const {
      projectId,
      episodeId,
      incidentStateId,
      notifyOwners,
      rootCause,
      props,
      cascadeToIncidents,
      isFirstState,
      isGroupingRuleReopen,
    } = data;

    // Get last episode state timeline
    const lastEpisodeStateTimeline: IncidentEpisodeStateTimeline | null =
      await IncidentEpisodeStateTimelineService.findOneBy({
        query: {
          incidentEpisodeId: episodeId,
          projectId: projectId,
        },
        select: {
          _id: true,
          incidentStateId: true,
        },
        sort: {
          createdAt: SortOrder.Descending,
        },
        props: {
          isRoot: true,
        },
      });

    if (
      lastEpisodeStateTimeline &&
      lastEpisodeStateTimeline.incidentStateId &&
      lastEpisodeStateTimeline.incidentStateId.toString() ===
        incidentStateId.toString()
    ) {
      return;
    }

    const stateTimeline: IncidentEpisodeStateTimeline =
      new IncidentEpisodeStateTimeline();

    stateTimeline.incidentEpisodeId = episodeId;
    stateTimeline.incidentStateId = incidentStateId;
    stateTimeline.projectId = projectId;
    stateTimeline.isOwnerNotified = !notifyOwners;

    if (isFirstState) {
      stateTimeline.shouldStatusPageSubscribersBeNotified = false;
      stateTimeline.subscriberNotificationStatus =
        StatusPageSubscriberNotificationStatus.Skipped;
      stateTimeline.subscriberNotificationStatusMessage =
        EPISODE_FIRST_STATE_SUBSCRIBER_MESSAGE;
    }

    if (rootCause) {
      stateTimeline.rootCause = rootCause;
    }

    if (isGroupingRuleReopen) {
      await IncidentEpisodeStateTimelineService.createReopen({
        data: stateTimeline,
        props: props || {},
      });
    } else {
      await IncidentEpisodeStateTimelineService.create({
        data: stateTimeline,
        props: props || {},
      });
    }

    /*
     * Note: resolvedAt is updated by IncidentEpisodeStateTimelineService.onCreateSuccess()
     * to avoid duplicate updates.
     */

    // Cascade state change to all member incidents if requested
    if (cascadeToIncidents) {
      await this.cascadeStateToMemberIncidents({
        projectId,
        episodeId,
        incidentStateId,
        props,
      });
    }
  }

  /*
   * Moves the episode's incidents into the state the episode moved into,
   * each by the rule its own state timeline holds it to
   * (Common/Utils/StateMove): an incident in that state already, or past it
   * in the project's list of incident states - one resolved on its own, or
   * a resolved incident of an episode its grouping rule reopened - is left
   * where it is, rather than sent a move its timeline would refuse. An
   * episode never reopens its incidents. Each move that is made is a row of
   * the incident's timeline, written with `props`; one that still fails is
   * logged, and the others go on.
   */
  @CaptureSpan()
  public async cascadeStateToMemberIncidents(data: {
    projectId: ObjectID;
    episodeId: ObjectID;
    incidentStateId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<void> {
    const { projectId, episodeId, incidentStateId, props } = data;

    // Get all member incidents for this episode
    const members: Array<IncidentEpisodeMember> =
      await IncidentEpisodeMemberService.findBy({
        query: {
          incidentEpisodeId: episodeId,
          projectId: projectId,
        },
        select: {
          incidentId: true,
        },
        props: {
          isRoot: true,
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
      });

    if (members.length === 0) {
      return;
    }

    const memberIncidentIds: Array<ObjectID> = members
      .map((member: IncidentEpisodeMember): ObjectID | undefined => {
        return member.incidentId;
      })
      .filter((incidentId: ObjectID | undefined): incidentId is ObjectID => {
        return Boolean(incidentId);
      });

    if (memberIncidentIds.length === 0) {
      return;
    }

    // Where each incident is now, and the project's list it walks down.
    const [memberIncidents, incidentStates] = await Promise.all([
      IncidentService.findBy({
        query: {
          _id: QueryHelper.any(memberIncidentIds),
          projectId: projectId,
        },
        select: {
          _id: true,
          currentIncidentStateId: true,
        },
        props: {
          isRoot: true,
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
      }),
      IncidentStateService.getAllIncidentStates({
        projectId: projectId,
        props: {
          isRoot: true,
        },
      }),
    ]);

    // Update state for each member incident its own rule lets move there.
    for (const memberIncident of memberIncidents as Array<Incident>) {
      if (!memberIncident.id) {
        continue;
      }

      if (
        !StateMoveUtil.isMoveAllowed({
          list: StateMoveUtil.getList(StateMoveRecord.Incident),
          states: incidentStates,
          fromStateId: memberIncident.currentIncidentStateId,
          toStateId: incidentStateId,
        })
      ) {
        logger.debug(
          `Incident ${memberIncident.id.toString()} of episode ${episodeId.toString()} is in that state or past it already, so the episode leaves it where it is.`,
          {
            projectId: projectId.toString(),
            incidentEpisodeId: episodeId.toString(),
            incidentId: memberIncident.id.toString(),
          } as LogAttributes,
        );
        continue;
      }

      const member: { incidentId: ObjectID } = {
        incidentId: memberIncident.id,
      };

      try {
        await IncidentService.changeIncidentState({
          projectId: projectId,
          incidentId: member.incidentId,
          incidentStateId: incidentStateId,
          shouldNotifyStatusPageSubscribers: false,
          isSubscribersNotified: false,
          notifyOwners: false, // Don't send notifications for cascaded state changes
          rootCause: "State changed by episode state cascade.",
          stateChangeLog: undefined,
          props: props,
        });
      } catch (error) {
        logger.error(
          `Failed to cascade state change to incident ${member.incidentId.toString()}: ${error}`,
          {
            projectId: projectId.toString(),
            incidentEpisodeId: episodeId.toString(),
            incidentId: member.incidentId.toString(),
          } as LogAttributes,
        );
      }
    }
  }

  /*
   * Acknowledges the episode - and, unless told not to, the incidents in it -
   * as the user: moves it into its project's acknowledged state, the first
   * from the top flagged acknowledged. One that is acknowledged already, or
   * further along, is refused with a sentence that says which
   * (Common/Utils/AcknowledgedState) rather than moved back up its list, or
   * logged as acknowledged a second time.
   */
  @CaptureSpan()
  public async acknowledgeEpisode(
    episodeId: ObjectID,
    acknowledgedByUserId?: ObjectID,
    cascadeToIncidents: boolean = true,
  ): Promise<void> {
    const episode: Model | null = await this.findOneById({
      id: episodeId,
      select: {
        projectId: true,
        currentIncidentStateId: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!episode || !episode.projectId) {
      throw new BadDataException("Episode not found.");
    }

    const incidentStates: Array<IncidentState> =
      await IncidentStateService.getAllIncidentStates({
        projectId: episode.projectId,
        props: {
          isRoot: true,
        },
      });

    const refusal: string | null = AcknowledgedStateUtil.getAcknowledgeRefusal({
      list: StateListType.IncidentState,
      states: incidentStates,
      stateId: episode.currentIncidentStateId,
      subject: "Episode",
    });

    if (refusal) {
      throw new BadDataException(refusal);
    }

    const incidentState: IncidentState | null =
      AcknowledgedStateUtil.getAcknowledgedState({
        list: StateListType.IncidentState,
        states: incidentStates,
      });

    if (!incidentState || !incidentState.id) {
      throw new BadDataException(
        "Acknowledged incident state not found for this project.",
      );
    }

    await this.changeEpisodeState({
      projectId: episode.projectId,
      episodeId: episodeId,
      incidentStateId: incidentState.id,
      notifyOwners: true,
      rootCause: acknowledgedByUserId
        ? `Acknowledged by user.`
        : "Acknowledged via API.",
      props: {
        isRoot: true,
        userId: acknowledgedByUserId,
      },
      cascadeToIncidents: cascadeToIncidents,
    });
  }

  @CaptureSpan()
  public async resolveEpisode(
    episodeId: ObjectID,
    resolvedByUserId?: ObjectID,
    cascadeToIncidents: boolean = true,
  ): Promise<void> {
    const episode: Model | null = await this.findOneById({
      id: episodeId,
      select: {
        projectId: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!episode || !episode.projectId) {
      throw new BadDataException("Episode not found.");
    }

    // The project's resolved state: the first from the top flagged resolved.
    const incidentState: IncidentState =
      await IncidentStateService.getResolvedIncidentState({
        projectId: episode.projectId,
        props: {
          isRoot: true,
        },
      });

    if (!incidentState.id) {
      throw new BadDataException(
        "Resolved incident state not found for this project.",
      );
    }

    await this.changeEpisodeState({
      projectId: episode.projectId,
      episodeId: episodeId,
      incidentStateId: incidentState.id,
      notifyOwners: true,
      rootCause: resolvedByUserId ? `Resolved by user.` : "Resolved via API.",
      props: {
        isRoot: true,
        userId: resolvedByUserId,
      },
      cascadeToIncidents: cascadeToIncidents,
    });
  }

  @CaptureSpan()
  public async reopenEpisode(
    episodeId: ObjectID,
    reopenedByUserId?: ObjectID,
    cascadeToIncidents: boolean = true,
  ): Promise<void> {
    const episode: Model | null = await this.findOneById({
      id: episodeId,
      select: {
        projectId: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!episode || !episode.projectId) {
      throw new BadDataException("Episode not found.");
    }

    const incidentState: IncidentState | null =
      await IncidentStateService.findOneBy({
        query: {
          projectId: episode.projectId,
          isCreatedState: true,
        },
        select: {
          _id: true,
        },
        props: {
          isRoot: true,
        },
      });

    if (!incidentState || !incidentState.id) {
      throw new BadDataException(
        "Created incident state not found for this project.",
      );
    }

    await this.changeEpisodeState({
      projectId: episode.projectId,
      episodeId: episodeId,
      incidentStateId: incidentState.id,
      notifyOwners: true,
      rootCause: reopenedByUserId ? `Reopened by user.` : "Reopened via API.",
      props: {
        isRoot: true,
        userId: reopenedByUserId,
      },
      cascadeToIncidents: cascadeToIncidents,
      isGroupingRuleReopen: true,
    });

    // Clear resolved timestamp and allIncidentsResolvedAt when episode is reopened
    await this.updateOneById({
      id: episodeId,
      data: {
        resolvedAt: null,
        allIncidentsResolvedAt: null,
      },
      props: {
        isRoot: true,
      },
    });
  }

  @CaptureSpan()
  public async updateEpisodeSeverity(
    episodeId: ObjectID,
    severityId: ObjectID,
    onlyIfHigher: boolean = false,
  ): Promise<void> {
    const episode: Model | null = await this.findOneById({
      id: episodeId,
      select: {
        projectId: true,
        incidentSeverityId: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!episode || !episode.projectId) {
      throw new BadDataException("Episode not found.");
    }

    // If onlyIfHigher is true, check if the new severity is higher than the current
    if (onlyIfHigher && episode.incidentSeverityId) {
      const currentSeverity: IncidentSeverity | null =
        await IncidentSeverityService.findOneById({
          id: episode.incidentSeverityId,
          select: {
            order: true,
          },
          props: {
            isRoot: true,
          },
        });

      const newSeverity: IncidentSeverity | null =
        await IncidentSeverityService.findOneById({
          id: severityId,
          select: {
            order: true,
          },
          props: {
            isRoot: true,
          },
        });

      // Lower order number means higher severity
      if (
        currentSeverity?.order !== undefined &&
        newSeverity?.order !== undefined &&
        newSeverity.order >= currentSeverity.order
      ) {
        return; // New severity is not higher, don't update
      }
    }

    await this.updateOneById({
      id: episodeId,
      data: {
        incidentSeverityId: severityId,
      },
      props: {
        isRoot: true,
      },
    });

    // Create feed entry for severity change
    const newSeverity: IncidentSeverity | null =
      await IncidentSeverityService.findOneById({
        id: severityId,
        select: {
          name: true,
          color: true,
        },
        props: {
          isRoot: true,
        },
      });

    if (newSeverity && episode.projectId) {
      await IncidentEpisodeFeedService.createIncidentEpisodeFeedItem({
        incidentEpisodeId: episodeId,
        projectId: episode.projectId,
        incidentEpisodeFeedEventType:
          IncidentEpisodeFeedEventType.SeverityChanged,
        displayColor: newSeverity.color || Yellow500,
        feedInfoInMarkdown:
          mdText`Episode severity changed to **${newSeverity.name || "Unknown"}**`.toString(),
      });
    }
  }

  @CaptureSpan()
  public async updateIncidentCount(episodeId: ObjectID): Promise<void> {
    const count: PositiveNumber = await IncidentEpisodeMemberService.countBy({
      query: {
        incidentEpisodeId: episodeId,
      },
      props: {
        isRoot: true,
      },
    });

    const incidentCount: number = count.toNumber();

    // Get the episode to check for templates
    const episode: Model | null = await this.findOneById({
      id: episodeId,
      select: {
        titleTemplate: true,
        descriptionTemplate: true,
        title: true,
        description: true,
      },
      props: {
        isRoot: true,
      },
    });

    const updateData: {
      incidentCount: number;
      title?: string;
      description?: string;
    } = {
      incidentCount: incidentCount,
    };

    /*
     * Update title with dynamic variables if template exists - named as the
     * grouping engine names an episode whose title template comes out empty
     */
    if (episode?.titleTemplate) {
      updateData.title =
        this.renderTemplateWithDynamicValues(
          episode.titleTemplate,
          incidentCount,
        ) || "Untitled Episode";
    }

    // Update description with dynamic variables if template exists
    if (episode?.descriptionTemplate) {
      updateData.description = this.renderTemplateWithDynamicValues(
        episode.descriptionTemplate,
        incidentCount,
      );
    }

    await this.updateOneById({
      id: episodeId,
      data: updateData,
      props: {
        isRoot: true,
      },
    });
  }

  private renderTemplateWithDynamicValues(
    template: string,
    incidentCount: number,
  ): string {
    let result: string = template;

    // Replace dynamic variables
    result = result.replace(/\{\{incidentCount\}\}/g, incidentCount.toString());

    /*
     * Clear anything else left in braces, as the grouping engine does when it
     * first writes the title and description. The engine now stores only
     * the count as a placeholder, but an episode opened before then can
     * still hold "{{monitorName}}" and the like for a value its first
     * incident did not have - which came back into its title each time
     * another incident joined.
     */
    result = result.replace(/\{\{[^}]+\}\}/g, "");

    return result;
  }

  @CaptureSpan()
  public async updateLastIncidentAddedAt(episodeId: ObjectID): Promise<void> {
    await this.updateOneById({
      id: episodeId,
      data: {
        lastIncidentAddedAt: OneUptimeDate.getCurrentDate(),
      },
      props: {
        isRoot: true,
      },
    });
  }

  @CaptureSpan()
  public async findOwners(episodeId: ObjectID): Promise<Array<User>> {
    // Get direct user owners
    const userOwners: Array<IncidentEpisodeOwnerUser> =
      await IncidentEpisodeOwnerUserService.findBy({
        query: {
          incidentEpisodeId: episodeId,
        },
        select: {
          projectId: true,
          userId: true,
          user: {
            _id: true,
            email: true,
            name: true,
          },
        },
        props: {
          isRoot: true,
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
      });

    // Get team owners
    const teamOwners: Array<IncidentEpisodeOwnerTeam> =
      await IncidentEpisodeOwnerTeamService.findBy({
        query: {
          incidentEpisodeId: episodeId,
        },
        select: {
          projectId: true,
          teamId: true,
        },
        props: {
          isRoot: true,
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
      });

    // Collect all unique users
    const usersMap: Map<string, User> = new Map();

    // Add direct user owners
    for (const owner of userOwners) {
      if (owner.user && owner.userId) {
        usersMap.set(owner.userId.toString(), owner.user);
      }
    }

    // Add users from teams
    for (const teamOwner of teamOwners) {
      if (teamOwner.teamId) {
        const teamMembers: Array<User> = await TeamMemberService.getUsersInTeam(
          teamOwner.teamId,
        );
        for (const user of teamMembers) {
          if (user.id) {
            usersMap.set(user.id.toString(), user);
          }
        }
      }
    }

    const projectId: ObjectID | undefined =
      userOwners[0]?.projectId || teamOwners[0]?.projectId;

    if (!projectId) {
      return [];
    }

    // Owners who left the project are not notified, nor listed as notified.
    return await TeamMemberService.filterUsersToProjectMembers({
      projectId: projectId,
      users: Array.from(usersMap.values()),
    });
  }

  @CaptureSpan()
  public async addOwners(data: {
    episodeId: ObjectID;
    projectId: ObjectID;
    userIds?: Array<ObjectID>;
    teamIds?: Array<ObjectID>;
    createdByUserId?: ObjectID;
  }): Promise<void> {
    const { episodeId, projectId, userIds, teamIds, createdByUserId } = data;

    // Owners already on the episode are skipped, not added a second time.
    await OwnerRuleAssignment.addOwners({
      ownerUserService: IncidentEpisodeOwnerUserService,
      ownerTeamService: IncidentEpisodeOwnerTeamService,
      resourceIdColumn: "incidentEpisodeId",
      resourceId: episodeId,
      projectId: projectId,
      userIds: userIds || [],
      teamIds: teamIds || [],
      createdByUserId: createdByUserId,
      props: {
        isRoot: true,
      },
    });
  }

  @CaptureSpan()
  public async getWorkspaceChannelForEpisode(data: {
    episodeId: ObjectID;
    workspaceType?: WorkspaceType | null;
  }): Promise<Array<NotificationRuleWorkspaceChannel>> {
    const episode: Model | null = await this.findOneById({
      id: data.episodeId,
      select: {
        postUpdatesToWorkspaceChannels: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!episode) {
      throw new BadDataException("Incident Episode not found.");
    }

    return (episode.postUpdatesToWorkspaceChannels || []).filter(
      (channel: NotificationRuleWorkspaceChannel) => {
        if (!data.workspaceType) {
          return true;
        }
        return channel.workspaceType === data.workspaceType;
      },
    );
  }

  /*
   * Whether the episode is acknowledged or further along - resolved
   * included: what stops its on-call escalation and takes Acknowledge away
   * (Common/Utils/AcknowledgedState).
   */
  @CaptureSpan()
  public async isEpisodeAcknowledged(data: {
    episodeId: ObjectID;
  }): Promise<boolean> {
    const episode: Model = await this.getEpisodeWithState(data.episodeId);

    if (!episode.currentIncidentStateId) {
      return false;
    }

    return await IncidentStateService.isAcknowledgedIncidentState({
      projectId: episode.projectId!,
      incidentStateId: episode.currentIncidentStateId,
    });
  }

  // The episode's project and current state, as OneUptime.
  private async getEpisodeWithState(episodeId: ObjectID): Promise<Model> {
    const episode: Model | null = await this.findOneById({
      id: episodeId,
      select: {
        projectId: true,
        currentIncidentStateId: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!episode || !episode.projectId) {
      throw new BadDataException("Episode not found.");
    }

    return episode;
  }

  @CaptureSpan()
  public async getEpisodeLinkInDashboard(
    projectId: ObjectID,
    episodeId: ObjectID,
  ): Promise<URL> {
    const dashboardUrl: URL = await DatabaseConfig.getDashboardUrl();

    return URL.fromString(dashboardUrl.toString()).addRoute(
      `/${projectId.toString()}/incidents/episodes/${episodeId.toString()}`,
    );
  }

  @CaptureSpan()
  public async getEpisodeNumber(data: { episodeId: ObjectID }): Promise<{
    number: number | null;
    numberWithPrefix: string | null;
  }> {
    const episode: Model | null = await this.findOneById({
      id: data.episodeId,
      select: {
        episodeNumber: true,
        episodeNumberWithPrefix: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!episode) {
      throw new BadDataException("Episode not found.");
    }

    return {
      number: episode.episodeNumber ? Number(episode.episodeNumber) : null,
      numberWithPrefix: episode.episodeNumberWithPrefix || null,
    };
  }
}

export default new Service();
