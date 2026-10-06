import DatabaseConfig from "../DatabaseConfig";
import MeasurementMetricWriter from "../Utils/Measurement/MeasurementMetricWriter";
import NumberPrefixUtil from "../../Utils/Project/NumberPrefix";
import IncidentMeasurementService from "./IncidentMeasurementService";
import CountBy from "../Types/Database/CountBy";
import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import FindBy from "../Types/Database/FindBy";
import { OnCreate, OnDelete, OnFind, OnUpdate } from "../Types/Database/Hooks";
import QueryHelper from "../Types/Database/QueryHelper";
import DatabaseService from "./DatabaseService";
import ProjectReferencesService from "./ProjectReferencesService";
import IncidentCustomField from "../../Models/DatabaseModels/IncidentCustomField";
import CustomFieldMappingService from "./CustomFieldMappingService";
import IncidentCustomFieldService from "./IncidentCustomFieldService";
import { CustomFieldDefinition } from "../../Types/CustomField/CustomFieldDefinition";
import { mergeTemplateCustomFields } from "../../Types/CustomField/CustomFieldTemplateMerge";
import {
  CustomFieldValueValidationError,
  formatCustomFieldValueValidationErrors,
  validateCustomFieldValues,
} from "../../Types/CustomField/CustomFieldValueValidator";
import AIRunService from "./AIRunService";
import AIRunType from "../../Types/AI/AIRunType";
import AIRunStatus from "../../Types/AI/AIRunStatus";
import IncidentOwnerTeamService from "./IncidentOwnerTeamService";
import IncidentOwnerUserService from "./IncidentOwnerUserService";
import IncidentStateService from "./IncidentStateService";
import IncidentStateTimelineService, {
  INCIDENT_NEVER_HELD_ITS_MONITORS_KEY,
} from "./IncidentStateTimelineService";
import IncidentMeasurementValueService from "./IncidentMeasurementValueService";
import MonitorService from "./MonitorService";
import MonitorStatusService from "./MonitorStatusService";
import OnCallDutyPolicyService from "./OnCallDutyPolicyService";
import TeamMemberService from "./TeamMemberService";
import UserService from "./UserService";
import URL from "../../Types/API/URL";
import LinkedAffectedResources, {
  LinkedAffectedResource,
} from "../Utils/AffectedResources/LinkedAffectedResources";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import LIMIT_MAX, { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import PositiveNumber from "../../Types/PositiveNumber";
import { applyIncidentSelfPrivacyFilter } from "../Utils/Incident/IncidentPrivacyFilter";
import ProjectScopedReferenceValidator, {
  getWrittenRelationReferences,
  HeldRelationIds,
  ProjectScopedReference,
  ProjectScopedRelation,
  resolveReferenceIds,
} from "../Utils/Database/ProjectScopedReferenceValidator";
import RelationIdUtil from "../Utils/Database/RelationIdUtil";
import ReferenceChange from "../Utils/Database/ReferenceChange";
import CreatedByUser from "../Utils/Database/CreatedByUser";
import EpisodeMembershipReference, {
  INCIDENT_EPISODE_REFERENCE,
} from "../Utils/Episode/EpisodeMembershipReference";
import {
  getAffectedResourceColumns,
  getAffectedResourceRelations,
} from "../Utils/Database/AffectedResourceRelations";
import Query from "../Types/Database/Query";
import DatabaseBaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import SloRecordReferenceValidator from "../Utils/Slo/SloRecordReferenceValidator";
import UserNotificationEventType from "../../Types/UserNotification/UserNotificationEventType";
import StatusPageSubscriberNotificationStatus from "../../Types/StatusPage/StatusPageSubscriberNotificationStatus";
import IncidentCreatedRenotify from "../../Types/StatusPage/IncidentCreatedRenotify";
import IncidentCreatedResend from "../../Types/StatusPage/IncidentCreatedResend";
import IncidentPostmortemPublication, {
  IncidentPostmortemStoredState,
  PostmortemNotificationAction,
} from "../../Types/StatusPage/IncidentPostmortemPublication";
import IncidentScopeAddedPagesNotification, {
  IncidentScopeAddedPagesNotificationAction,
  StatusPageScopeChange,
} from "../../Types/StatusPage/IncidentScopeAddedPagesNotification";
import NotAuthorizedException from "../../Types/Exception/NotAuthorizedException";
import StatusPage from "../../Models/DatabaseModels/StatusPage";
import StatusPageService from "./StatusPageService";
import StatusPageReadAccess from "../Utils/StatusPage/StatusPageReadAccess";
import SubscriberNotificationResendAccess from "../Utils/StatusPage/SubscriberNotificationResendAccess";
import Select from "../Types/Database/Select";
import PartialEntity from "../../Types/Database/PartialEntity";
import DockerHost from "../../Models/DatabaseModels/DockerHost";
import PodmanHost from "../../Models/DatabaseModels/PodmanHost";
import Host from "../../Models/DatabaseModels/Host";
import KubernetesCluster from "../../Models/DatabaseModels/KubernetesCluster";
import ServiceModel from "../../Models/DatabaseModels/Service";
import Model from "../../Models/DatabaseModels/Incident";
import IncidentOwnerTeam from "../../Models/DatabaseModels/IncidentOwnerTeam";
import IncidentOwnerUser from "../../Models/DatabaseModels/IncidentOwnerUser";
import IncidentState from "../../Models/DatabaseModels/IncidentState";
import IncidentStateTimeline from "../../Models/DatabaseModels/IncidentStateTimeline";
import Monitor from "../../Models/DatabaseModels/Monitor";
import ServiceLevelObjective from "../../Models/DatabaseModels/ServiceLevelObjective";
import MonitorStatus from "../../Models/DatabaseModels/MonitorStatus";
import User from "../../Models/DatabaseModels/User";
import { IsBillingEnabled } from "../EnvironmentConfig";
import MutableMetricService from "./MutableMetricService";
import GlobalConfigService from "./GlobalConfigService";
import GlobalConfig from "../../Models/DatabaseModels/GlobalConfig";
import IncidentMetricType from "../../Types/Incident/IncidentMetricType";
import MutableMetric from "../../Models/AnalyticsModels/MutableMetric";
import { MetricPointType } from "../../Models/AnalyticsModels/Metric";
import ServiceType from "../../Types/Telemetry/ServiceType";
import OneUptimeDate from "../../Types/Date";
import TelemetryUtil from "../Utils/Telemetry/Telemetry";
import MetricResourceAttributeUtil from "../../Utils/Metrics/MetricResourceAttributeUtil";
import {
  escapeMarkdownInline,
  escapeMarkdownValue,
} from "../../Utils/Markdown/MarkdownEscape";
import logger, { LogAttributes } from "../Utils/Logger";
import ProductAnalytics from "../Utils/ProductAnalytics";
import Semaphore, { SemaphoreMutex } from "../Infrastructure/Semaphore";
import IncidentFeedService from "./IncidentFeedService";
import IncidentSlaService from "./IncidentSlaService";
import IncidentReminderRuleService from "./IncidentReminderRuleService";
import IncidentReminderRule from "../../Models/DatabaseModels/IncidentReminderRule";
import { IncidentFeedEventType } from "../../Models/DatabaseModels/IncidentFeed";
import IncidentGroupingEngineService from "./IncidentGroupingEngineService";
import IncidentLabelRuleEngineService from "./IncidentLabelRuleEngineService";
import IncidentOnCallRuleEngineService from "./IncidentOnCallRuleEngineService";
import IncidentOwnerRuleEngineService from "./IncidentOwnerRuleEngineService";
import IncidentPrivacyRuleEngineService from "./IncidentPrivacyRuleEngineService";
import RunbookRuleEngineService from "./RunbookRuleEngineService";
import AutoRemediationRuleEngineService from "./AutoRemediationRuleEngineService";
import { Blue500, Gray500, Red500 } from "../../Types/BrandColors";
import Label from "../../Models/DatabaseModels/Label";
import LabelService from "./LabelService";
import IncidentSeverity from "../../Models/DatabaseModels/IncidentSeverity";
import IncidentSeverityService from "./IncidentSeverityService";
import IncidentWorkspaceMessages from "../Utils/Workspace/WorkspaceMessages/Incident";
import WorkspaceType from "../../Types/Workspace/WorkspaceType";
import { MessageBlocksByWorkspaceType } from "./WorkspaceNotificationRuleService";
import NotificationRuleWorkspaceChannel from "../../Types/Workspace/NotificationRules/NotificationRuleWorkspaceChannel";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import MetricType from "../../Models/DatabaseModels/MetricType";
import UpdateBy from "../Types/Database/UpdateBy";
import OnCallDutyPolicy from "../../Models/DatabaseModels/OnCallDutyPolicy";
import Dictionary from "../../Types/Dictionary";
import ProjectService from "./ProjectService";
import IncidentTemplateService from "./IncidentTemplateService";
import IncidentTemplate from "../../Models/DatabaseModels/IncidentTemplate";
import AIService, { AILogResponse } from "./AIService";
import AIIncidentInvestigationRunner from "../Utils/AI/SRE/IncidentInvestigationRunner";
import OwnerRuleAssignment from "../Utils/Rules/OwnerRuleAssignment";
import IncidentAIContextBuilder, {
  AIGenerationContext,
  IncidentContextData,
} from "../Utils/AI/IncidentAIContextBuilder";
import IncidentAlertService, {
  AcknowledgeDeclaredAlertsResult,
  AlertsToAcknowledgeOnDeclare,
  LinkAlertsToIncidentResult,
} from "./IncidentAlertService";
import {
  INCIDENT_ACKNOWLEDGE_ALERTS_TO_LINK_KEY,
  INCIDENT_ALERT_IDS_TO_LINK_KEY,
} from "../../Types/Incident/IncidentAlertLink";
import OnCallNotRunOnCreate from "../Utils/OnCall/OnCallNotRunOnCreate";
import StartingStageUtil, {
  StartingStage,
  StartingStageCarryForward,
  StartingState,
} from "../../Utils/StartingStage";

/*
 * How an update changed an incident's status page scope, for its feed item.
 * notificationQueued: the update also queued the 'created' notification for
 * the added pages (IncidentScopeAddedPagesNotification).
 * notificationAlreadyQueued: that notification was Pending or being sent, so
 * the update left it alone; onUpdateSuccess checks it did not finish without
 * the added pages in the meantime.
 */
type StatusPageScopeCarryForward = StatusPageScopeChange & {
  isScoped: boolean;
  notificationQueued: boolean;
  notificationAlreadyQueued?: boolean | undefined;
};

/*
 * What adding status pages does to one matched incident's 'created'
 * notification, and the record of told pages to write if it is queued with
 * none (IncidentScopeAddedPagesNotification.getRecordToSeedOnQueue).
 */
interface AddedStatusPagesDecision {
  incidentId: string;
  action: IncidentScopeAddedPagesNotificationAction;
  recordToSeed: Array<string> | undefined;
}

// key is incidentId for this dictionary.
type UpdateCarryForward = Dictionary<{
  /*
   * The monitors the update takes off and puts on the incident. Both are
   * empty unless the update sends the monitor list.
   */
  monitorsRemoved: Array<Monitor>;
  monitorsAdded: Array<Monitor>;
  /*
   * Whether the incident was resolved before the update, which decides if
   * the monitors taken off it are restored. Read before the write, since the
   * same update may resolve or reopen it, and only when a monitor is taken
   * off (undefined otherwise).
   */
  isResolvedBeforeUpdate?: boolean | undefined;
  // The monitor status the incident put its monitors in before the update.
  oldChangeMonitorStatusIdTo: ObjectID | undefined;
  // The monitor status the update writes; undefined when it writes none.
  newMonitorChangeStatusIdTo: ObjectID | undefined;
  /*
   * The update sets the incident's monitor status to nothing, so the
   * incident no longer puts its monitors, old or added, in any status.
   */
  isChangeMonitorStatusToCleared?: boolean | undefined;
  statusPageScopeChange?: StatusPageScopeCarryForward | undefined;
  /*
   * The severity the incident held before the update (null: none), read only
   * when the update writes one, so onUpdateSuccess runs the severity's side
   * effects for a real change only (recordStoredValuesBeforeUpdate).
   */
  severityIdBeforeUpdate?: string | null | undefined;
  /*
   * The incident's postmortem before the update - whether it was switched on
   * for the status page, its note, and where its subscriber notification
   * stood - read only when the update writes the note or the switch, so
   * onUpdateSuccess tells subscribers once, when the update publishes it,
   * and records a note that really changed (recordStoredValuesBeforeUpdate).
   */
  postmortemBeforeUpdate?: IncidentPostmortemStoredState | undefined;
}>;

/*
 * What onBeforeCreate hands to onCreateSuccess: how far along the incident
 * starts (StartingStage), which decides what its create sets off, and the
 * alerts it is being declared from, if any. Null only for a success hook run
 * without one, which then sets off what a new incident always did.
 */
type IncidentCreateCarryForward =
  | (StartingStageCarryForward & {
      /*
       * Validated, deduplicated alert ids to link once the incident exists.
       * Empty unless the incident is being declared from alerts.
       */
      alertIdsToLink: Array<ObjectID>;
      /*
       * Acknowledge alerts once they are linked, as the declaring user
       * (INCIDENT_ACKNOWLEDGE_ALERTS_TO_LINK_KEY) - what stops their
       * escalation. When asked to: the project's Acknowledged alert state,
       * and the alerts not acknowledged yet, which the caller was checked
       * for. Null otherwise.
       */
      acknowledgedAlertStateId: ObjectID | null;
      alertIdsToAcknowledge: Array<ObjectID>;
    })
  | null;

/*
 * The two names of each reference this service reads off a write itself, ID
 * column first. A write may name a reference under either, and the two must
 * agree (RelationIdUtil.readConsistent), so what the service checks and acts
 * on is what is stored.
 */
const CURRENT_STATE_KEYS: Array<string> = [
  "currentIncidentStateId",
  "currentIncidentState",
];
const SEVERITY_KEYS: Array<string> = ["incidentSeverityId", "incidentSeverity"];
const CHANGE_MONITOR_STATUS_KEYS: Array<string> = [
  "changeMonitorStatusToId",
  "changeMonitorStatusTo",
];
const TEMPLATE_KEYS: Array<string> = [
  "createdIncidentTemplateId",
  "createdIncidentTemplate",
];

// Where an incident's postmortem notification stands, as read.
type PostmortemNotificationStatusRead = {
  status: StatusPageSubscriberNotificationStatus | null;
};

type IncidentUpdatePayload = {
  postmortemNote?: string | null;
  title?: string | null;
  rootCause?: string | null;
  description?: string | null;
  remediationNotes?: string | null;
  labels?: unknown;
  incidentSeverity?: unknown;
  [key: string]: unknown;
};

export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
    if (IsBillingEnabled) {
      this.hardDeleteItemsOlderThanInDays("createdAt", 3 * 365); // 3 years
    }
  }

  /*
   * The severity and the monitor status to switch to, the monitors, the
   * labels, the on-call policies, the status pages, the SLOs and the
   * affected-resource lists are checked by this service's own hooks below, with
   * ProjectScopedReferenceValidator and its own words. Everything else an
   * incident names - its episode, its state, the probe that opened it - is
   * checked by ProjectReferencesService.
   */
  protected override getRelationsCheckedByService(): Array<string> {
    return ["incidentSeverity", "changeMonitorStatusTo"];
  }

  protected override getListsCheckedByService(): Array<string> {
    return [
      "monitors",
      "labels",
      "onCallDutyPolicies",
      "statusPages",
      "serviceLevelObjectives",
      ...getAffectedResourceColumns(this.getModel()),
    ];
  }

  @CaptureSpan()
  protected override async onBeforeFind(
    findBy: FindBy<Model>,
  ): Promise<OnFind<Model>> {
    findBy.query = applyIncidentSelfPrivacyFilter(findBy.query, findBy.props);
    return { findBy, carryForward: null };
  }

  @CaptureSpan()
  public override async countBy(
    countBy: CountBy<Model>,
  ): Promise<PositiveNumber> {
    countBy.query = applyIncidentSelfPrivacyFilter(
      countBy.query,
      countBy.props,
    );
    return super.countBy(countBy);
  }

  @CaptureSpan()
  public async isIncidentResolved(data: {
    incidentId: ObjectID;
  }): Promise<boolean> {
    const incident: Model | null = await this.findOneBy({
      query: {
        _id: data.incidentId,
      },
      select: {
        projectId: true,
        currentIncidentState: {
          order: true,
        },
      },
      props: {
        isRoot: true,
      },
    });

    if (!incident) {
      throw new BadDataException("Incident not found");
    }

    if (!incident.projectId) {
      throw new BadDataException("Incident Project ID not found");
    }

    const resolvedIncidentState: IncidentState =
      await IncidentStateService.getResolvedIncidentState({
        projectId: incident.projectId,
        props: {
          isRoot: true,
        },
      });

    const currentIncidentStateOrder: number =
      incident.currentIncidentState!.order!;
    const resolvedIncidentStateOrder: number = resolvedIncidentState.order!;

    if (currentIncidentStateOrder >= resolvedIncidentStateOrder) {
      return true;
    }

    return false;
  }

  @CaptureSpan()
  public async isIncidentAcknowledged(data: {
    incidentId: ObjectID;
  }): Promise<boolean> {
    const incident: Model | null = await this.findOneBy({
      query: {
        _id: data.incidentId,
      },
      select: {
        projectId: true,
        currentIncidentState: {
          order: true,
        },
      },
      props: {
        isRoot: true,
      },
    });

    if (!incident) {
      throw new BadDataException("Incident not found");
    }

    if (!incident.projectId) {
      throw new BadDataException("Incident Project ID not found");
    }

    const ackIncidentState: IncidentState =
      await IncidentStateService.getAcknowledgedIncidentState({
        projectId: incident.projectId,
        props: {
          isRoot: true,
        },
      });

    const currentIncidentStateOrder: number =
      incident.currentIncidentState!.order!;
    const ackIncidentStateOrder: number = ackIncidentState.order!;

    if (currentIncidentStateOrder >= ackIncidentStateOrder) {
      return true;
    }

    return false;
  }

  @CaptureSpan()
  public async refreshReminderSchedule(data: {
    incidentId: ObjectID;
    projectId: ObjectID;
  }): Promise<void> {
    const incident: Model | null = await this.findOneById({
      id: data.incidentId,
      select: {
        enableReminders: true,
        incidentSeverityId: true,
        labels: {
          _id: true,
        },
      },
      props: {
        isRoot: true,
      },
    });

    if (!incident) {
      return;
    }

    let nextReminderNotificationAt: Date | null = null;

    if (incident.enableReminders !== false) {
      const matchingRule: IncidentReminderRule | null =
        await IncidentReminderRuleService.findMatchingRule({
          projectId: data.projectId,
          incidentSeverityId: incident.incidentSeverityId,
          labelIds: incident.labels?.map((label: Label) => {
            return label.id!;
          }),
        });

      if (
        matchingRule &&
        matchingRule.reminderIntervalInMinutes &&
        !(await this.isIncidentResolved({ incidentId: data.incidentId }))
      ) {
        nextReminderNotificationAt = OneUptimeDate.addRemoveMinutes(
          OneUptimeDate.getCurrentDate(),
          matchingRule.reminderIntervalInMinutes,
        );
      }
    }

    await this.updateOneById({
      id: data.incidentId,
      data: {
        nextReminderNotificationAt: nextReminderNotificationAt,
      },
      props: {
        isRoot: true,
      },
    });
  }

  @CaptureSpan()
  public async resolveIncident(
    incidentId: ObjectID,
    resolvedByUserId: ObjectID,
  ): Promise<Model> {
    // check if the incident is already resolved.
    const isIncidentResolved: boolean = await this.isIncidentResolved({
      incidentId: incidentId,
    });

    if (isIncidentResolved) {
      throw new BadDataException("Incident is already resolved.");
    }

    const incident: Model | null = await this.findOneById({
      id: incidentId,
      select: {
        projectId: true,
        incidentNumber: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!incident || !incident.projectId) {
      throw new BadDataException("Incident not found.");
    }

    const incidentState: IncidentState | null =
      await IncidentStateService.findOneBy({
        query: {
          projectId: incident.projectId,
          isResolvedState: true,
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
        "Acknowledged state not found for this project. Please add acknowledged state from settings.",
      );
    }

    const incidentStateTimeline: IncidentStateTimeline =
      new IncidentStateTimeline();
    incidentStateTimeline.projectId = incident.projectId;
    incidentStateTimeline.incidentId = incidentId;
    incidentStateTimeline.incidentStateId = incidentState.id;
    incidentStateTimeline.createdByUserId = resolvedByUserId;

    await IncidentStateTimelineService.create({
      data: incidentStateTimeline,
      props: {
        isRoot: true,
      },
    });

    // store incident metric

    return incident;
  }

  @CaptureSpan()
  public async acknowledgeIncident(
    incidentId: ObjectID,
    acknowledgedByUserId: ObjectID,
  ): Promise<Model> {
    // check if the incident is already acknowledged.
    const isIncidentAcknowledged: boolean = await this.isIncidentAcknowledged({
      incidentId: incidentId,
    });

    if (isIncidentAcknowledged) {
      throw new BadDataException("Incident is already acknowledged.");
    }

    const incident: Model | null = await this.findOneById({
      id: incidentId,
      select: {
        projectId: true,
        incidentNumber: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!incident || !incident.projectId) {
      throw new BadDataException("Incident not found.");
    }

    const incidentState: IncidentState | null =
      await IncidentStateService.findOneBy({
        query: {
          projectId: incident.projectId,
          isAcknowledgedState: true,
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
        "Acknowledged state not found for this project. Please add acknowledged state from settings.",
      );
    }

    const incidentStateTimeline: IncidentStateTimeline =
      new IncidentStateTimeline();
    incidentStateTimeline.projectId = incident.projectId;
    incidentStateTimeline.incidentId = incidentId;
    incidentStateTimeline.incidentStateId = incidentState.id;
    incidentStateTimeline.createdByUserId = acknowledgedByUserId;

    await IncidentStateTimelineService.create({
      data: incidentStateTimeline,
      props: {
        isRoot: true,
      },
    });

    // store incident metric

    return incident;
  }

  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    await super.onBeforeUpdate(updateBy);

    /*
     * The incident's episode follows its episode membership: only
     * IncidentEpisodeMemberService moves it (EpisodeMembershipReference).
     */
    EpisodeMembershipReference.refuseWriteMadeInProject({
      payload: updateBy.data,
      props: updateBy.props,
      reference: INCIDENT_EPISODE_REFERENCE,
    });

    /*
     * Records which monitors the update takes off and puts on each incident,
     * the monitor status it writes, and whether the incident was resolved
     * before it, for onUpdateSuccess to decide what that does to the
     * monitors (updateMonitorsForIncidentEdit).
     */

    updateBy.query = applyIncidentSelfPrivacyFilter(
      updateBy.query,
      updateBy.props,
    );

    if (updateBy.data.isPrivate === true) {
      updateBy.data.isVisibleOnStatusPage = false;
    }

    this.stripServiceOwnedScopeColumns(updateBy);

    /*
     * Before anything below adds values of its own to customFields (the
     * mapped values copied from monitors), so only what the caller wrote is
     * checked.
     */
    await this.validateCustomFieldValuesOnUpdate(updateBy);

    // Before the hooks below add a Pending of their own.
    const isCreatedNotificationResendRequested: boolean =
      this.isCreatedNotificationResendRequested(updateBy);

    await this.validateProjectScopedReferences(updateBy);

    const carryForward: UpdateCarryForward = {};

    const data: Dictionary<unknown> = updateBy.data as Dictionary<unknown>;

    /*
     * Only an update that sends the monitor list changes which monitors the
     * incident holds. One that sends just the monitor status (the API, the
     * CLI or a workflow) takes no monitor off: reading the missing list as
     * empty would restore every monitor, and walking it threw. A list set to
     * null is sent: TypeORM clears a many-to-many set to null, like [].
     */
    const isMonitorListUpdated: boolean = data["monitors"] !== undefined;

    if (
      isMonitorListUpdated ||
      updateBy.data.changeMonitorStatusTo ||
      updateBy.data.changeMonitorStatusToId
    ) {
      const incidentsToUpdate: Array<Model> = await this.findBy({
        query: updateBy.query,
        select: {
          monitors: {
            _id: true,
          },
          projectId: true,
          changeMonitorStatusToId: true,
        },
        limit: LIMIT_MAX,
        skip: 0,
        props: updateBy.props,
      });

      /*
       * The monitor status the update writes, in any shape the API accepts
       * (an id, a bare uuid string or a relation object), so the status an
       * update writes is never mistaken for one it leaves alone. Read under
       * both of its names, which must agree, so the status put on the
       * monitors is the one stored on the incident.
       */
      const newMonitorChangeStatusIdTo: ObjectID | undefined =
        RelationIdUtil.readConsistent(
          data,
          CHANGE_MONITOR_STATUS_KEYS,
          "Monitor Status",
        ) || undefined;

      const isChangeMonitorStatusToCleared: boolean =
        !newMonitorChangeStatusIdTo &&
        RelationIdUtil.isPresent(data, CHANGE_MONITOR_STATUS_KEYS);

      const monitorIdsAfterUpdate: Array<string> = isMonitorListUpdated
        ? this.getMonitorIdsInUpdate(data["monitors"])
        : [];

      for (const incident of incidentsToUpdate) {
        const storedMonitors: Array<Monitor> = incident.monitors || [];

        const storedMonitorIds: Array<string> = storedMonitors.map(
          (monitor: Monitor): string => {
            return this.getMonitorIdForComparison(monitor);
          },
        );

        const monitorsRemoved: Array<Monitor> = isMonitorListUpdated
          ? storedMonitors.filter((monitor: Monitor): boolean => {
              return !monitorIdsAfterUpdate.includes(
                this.getMonitorIdForComparison(monitor),
              );
            })
          : [];

        carryForward[incident.id!.toString()] = {
          monitorsRemoved: monitorsRemoved,
          /*
           * Read now, before the write: an update that resolves the incident
           * and takes a monitor off must still restore that monitor, and one
           * that reopens a resolved incident must not restore it twice.
           * After the write, the state no longer tells these cases apart.
           */
          isResolvedBeforeUpdate:
            monitorsRemoved.length > 0
              ? await this.isIncidentResolved({ incidentId: incident.id! })
              : undefined,
          monitorsAdded: monitorIdsAfterUpdate
            .filter((monitorId: string): boolean => {
              return !storedMonitorIds.includes(monitorId);
            })
            .map((monitorId: string): Monitor => {
              return new Monitor(new ObjectID(monitorId));
            }),
          oldChangeMonitorStatusIdTo: incident.changeMonitorStatusToId,
          newMonitorChangeStatusIdTo: newMonitorChangeStatusIdTo,
          isChangeMonitorStatusToCleared: isChangeMonitorStatusToCleared,
        };
      }
    }

    await this.recordStoredValuesBeforeUpdate(updateBy, carryForward);

    /*
     * Notifying subscribers that the incident was created
     * (shouldStatusPageSubscribersBeNotifiedOnIncidentCreated) is decided
     * when it is declared. An update that writes it - only root and master
     * admins can - leaves the 'created' message alone: re-sending the value
     * the incident holds used to send that message to every status page
     * again, and turning it on does not send a message the incident was
     * declared without. Turned off, a message still queued is skipped by
     * the job that would send it, which reads the flag. Retry, Resend and
     * the API's Pending are how the message is sent again.
     */

    await this.queueCreatedNotificationResendToAllStatusPagesIfRequested(
      updateBy,
    );

    /*
     * Retry or Resend - a user's Pending - over a notification that is
     * being sent would let a second run send it alongside, or be
     * overwritten when the send settles (SubscriberNotificationResendAccess).
     * 'Resend to all pages' above has refused that already, with its own
     * reason; the hooks below queue their own Pending only from a settled
     * state.
     */
    await SubscriberNotificationResendAccess.assertNotQueuedWhileBeingSent({
      modelType: Model,
      service: this,
      updateBy: updateBy,
      statusColumns: [
        "subscriberNotificationStatusOnIncidentCreated",
        "subscriberNotificationStatusOnPostmortemPublished",
      ],
    });

    await this.clearCreatedNotificationRecordOnResend({
      updateBy: updateBy,
      isResendRequested: isCreatedNotificationResendRequested,
    });

    await this.queueCreatedNotificationOnPublishIfRequested(updateBy);

    await this.applyStatusPageScopeToUpdate(updateBy, carryForward);

    /*
     * Re-apply mapped custom field values. Covers the Custom Fields modal
     * saving the whole bag back over a mapped value, and the incident's
     * monitors being added or removed — both change what a mapped field should
     * hold, and folding the answer into this payload keeps it one write with a
     * truthful audit entry.
     */
    await CustomFieldMappingService.applyMappingsToUpdate({
      definitionModelType: IncidentCustomField,
      updateBy: updateBy,
    });

    return {
      updateBy: updateBy,
      carryForward: carryForward,
    };
  }

  /*
   * The ids of the monitors an update's list holds, deduplicated and
   * lowercased like getMonitorIdForComparison. The list reaches the hook as
   * models, `{ _id }` objects, ObjectIDs or bare uuid strings (API update),
   * and comparing only `_id` read every bare id as a monitor taken off and
   * put back on again.
   */
  private getMonitorIdsInUpdate(monitors: unknown): Array<string> {
    const monitorIds: Array<string> = [];

    for (const monitorId of resolveReferenceIds(monitors)) {
      const normalizedMonitorId: string = monitorId
        .toString()
        .trim()
        .toLowerCase();

      if (!monitorIds.includes(normalizedMonitorId)) {
        monitorIds.push(normalizedMonitorId);
      }
    }

    return monitorIds;
  }

  // A monitor's id as getMonitorIdsInUpdate writes it, for comparing the two.
  private getMonitorIdForComparison(monitor: Monitor): string {
    return (monitor._id?.toString() || "").trim().toLowerCase();
  }

  /*
   * What onUpdateSuccess compares an update with: each incident it matches
   * as it is stored, read here, before the write, so a side effect follows a
   * real change only. Updates often write back what an incident holds - a
   * dashboard card sends every field it shows with each save, and an API
   * client or a workflow may write the whole incident. One read, of the
   * columns the update needs compared and no others, and only when it needs
   * any:
   *
   * - the severity, when the update writes one under either of its names. A
   *   severity change records itself in the incident feed, recalculates the
   *   SLA deadlines, re-matches the reminder rule and counts in the
   *   SeverityChange metric (ReferenceChange);
   * - the postmortem - its note, its Publish on Status Page switch and where
   *   its subscriber notification stands - when the update writes the note
   *   or the switch. Subscribers are told once, when an update publishes the
   *   postmortem, and the feed records a note that really changed
   *   (IncidentPostmortemPublication). The Edit Postmortem form sends the
   *   note with every save, so its being there is no news.
   */
  private async recordStoredValuesBeforeUpdate(
    updateBy: UpdateBy<Model>,
    carryForward: UpdateCarryForward,
  ): Promise<void> {
    const writtenSeverityId: ObjectID | null = RelationIdUtil.readConsistent(
      updateBy.data as unknown as Record<string, unknown>,
      SEVERITY_KEYS,
      "Incident Severity",
    );

    const isPostmortemWritten: boolean =
      IncidentPostmortemPublication.isWrittenBy(
        updateBy.data as unknown as Record<string, unknown>,
      );

    if (!writtenSeverityId && !isPostmortemWritten) {
      return;
    }

    const select: Select<Model> = {
      _id: true,
      ...(writtenSeverityId
        ? {
            incidentSeverityId: true,
          }
        : {}),
      ...(isPostmortemWritten
        ? {
            postmortemNote: true,
            showPostmortemOnStatusPage: true,
            subscriberNotificationStatusOnPostmortemPublished: true,
          }
        : {}),
    };

    const incidents: Array<Model> = await this.findIncidentsForUpdateHook({
      updateBy: updateBy,
      select: select,
    });

    for (const incident of incidents) {
      if (!incident.id) {
        continue;
      }

      const incidentId: string = incident.id.toString();

      carryForward[incidentId] = {
        monitorsRemoved: [],
        monitorsAdded: [],
        oldChangeMonitorStatusIdTo: undefined,
        newMonitorChangeStatusIdTo: undefined,
        ...carryForward[incidentId],
        ...(writtenSeverityId
          ? {
              severityIdBeforeUpdate: incident.incidentSeverityId
                ? incident.incidentSeverityId.toString()
                : null,
            }
          : {}),
        ...(isPostmortemWritten
          ? {
              postmortemBeforeUpdate: {
                showPostmortemOnStatusPage: incident.showPostmortemOnStatusPage,
                postmortemNote: incident.postmortemNote,
                subscriberNotificationStatusOnPostmortemPublished:
                  incident.subscriberNotificationStatusOnPostmortemPublished,
              },
            }
          : {}),
      };
    }
  }

  /*
   * The incidents an update will write to, as they are stored, for the hooks
   * below that decide what else joins the update.
   *
   * Read as root: the answer only decides which columns join this update, and
   * the update itself is still checked against the caller's permissions
   * afterwards. Reading with the caller's props would fail the whole edit for
   * a role that may edit incidents but not read these columns. The query
   * already carries the caller's privacy filter (applyIncidentSelfPrivacyFilter),
   * but not their tenant: the update's permission check adds it only after
   * this hook runs. So a non-root caller's read is limited to their own
   * project here, or a request for another project's incident id would be
   * answered with that incident's state (a refusal that depends on it)
   * instead of the usual "nothing updated".
   */
  private async findIncidentsForUpdateHook(data: {
    updateBy: UpdateBy<Model>;
    select: Select<Model>;
  }): Promise<Array<Model>> {
    const updateBy: UpdateBy<Model> = data.updateBy;

    const query: Query<Model> =
      !updateBy.props.isRoot && updateBy.props.tenantId
        ? {
            ...updateBy.query,
            projectId: updateBy.props.tenantId,
          }
        : updateBy.query;

    return await this.findBy({
      query: query,
      select: data.select,
      limit: LIMIT_MAX,
      skip: 0,
      props: {
        isRoot: true,
      },
    });
  }

  /*
   * CUSTOM FIELD VALUES must fit their fields: a Number field holds a number,
   * a Dropdown one of its options (CustomFieldValueValidator has the rules).
   *
   * Only for writes a user or an API key makes. Root writes - the server's
   * own, such as values copied from monitors or an incident template - are
   * trusted, and the mapped values are added after this runs, so they never
   * reach it. Only the keys a write changes are checked, so a value stored
   * before these checks, or a dropdown option removed since, does not stop
   * someone saving the rest of the card.
   *
   * "Required on create" is not enforced here: incidents created by
   * monitors, the API, Slack, Microsoft Teams or AI cannot fill in a form.
   */
  private async getCustomFieldDefinitionsForValidation(
    projectId: ObjectID,
  ): Promise<Array<CustomFieldDefinition>> {
    const definitions: Array<IncidentCustomField> =
      await IncidentCustomFieldService.findBy({
        query: {
          projectId: projectId,
        },
        select: {
          name: true,
          customFieldType: true,
          dropdownOptions: true,
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

    const result: Array<CustomFieldDefinition> = [];

    for (const definition of definitions) {
      if (typeof definition.name !== "string") {
        continue;
      }

      result.push({
        name: definition.name,
        customFieldType: definition.customFieldType,
        dropdownOptions: definition.dropdownOptions,
      });
    }

    return result;
  }

  private hasCustomFieldValuesToValidate(customFields: unknown): boolean {
    return (
      customFields !== null &&
      typeof customFields === "object" &&
      !Array.isArray(customFields) &&
      Object.keys(customFields as JSONObject).length > 0
    );
  }

  private throwIfCustomFieldValuesInvalid(
    errors: Array<CustomFieldValueValidationError>,
  ): void {
    if (errors.length > 0) {
      throw new BadDataException(
        formatCustomFieldValueValidationErrors(errors),
      );
    }
  }

  private async validateCustomFieldValuesOnCreate(data: {
    createBy: CreateBy<Model>;
    projectId: ObjectID;
  }): Promise<void> {
    const customFields: unknown = data.createBy.data.customFields;

    if (
      data.createBy.props.isRoot ||
      !data.projectId ||
      !this.hasCustomFieldValuesToValidate(customFields)
    ) {
      return;
    }

    this.throwIfCustomFieldValuesInvalid(
      validateCustomFieldValues({
        definitions: await this.getCustomFieldDefinitionsForValidation(
          data.projectId,
        ),
        customFields: customFields,
        storedCustomFields: {},
      }),
    );
  }

  /*
   * Checked against each incident the update writes, because what counts as
   * changed depends on what that incident already holds.
   */
  private async validateCustomFieldValuesOnUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<void> {
    const customFields: unknown = updateBy.data.customFields;

    if (
      updateBy.props.isRoot ||
      !this.hasCustomFieldValuesToValidate(customFields)
    ) {
      return;
    }

    const incidents: Array<Model> = await this.findIncidentsForUpdateHook({
      updateBy: updateBy,
      select: {
        _id: true,
        projectId: true,
        customFields: true,
      },
    });

    const definitionsByProject: Map<
      string,
      Array<CustomFieldDefinition>
    > = new Map<string, Array<CustomFieldDefinition>>();

    for (const incident of incidents) {
      if (!incident.projectId) {
        continue;
      }

      const projectKey: string = incident.projectId.toString();

      if (!definitionsByProject.has(projectKey)) {
        definitionsByProject.set(
          projectKey,
          await this.getCustomFieldDefinitionsForValidation(incident.projectId),
        );
      }

      this.throwIfCustomFieldValuesInvalid(
        validateCustomFieldValues({
          definitions: definitionsByProject.get(projectKey)!,
          customFields: customFields,
          storedCustomFields: incident.customFields,
        }),
      );
    }
  }

  /*
   * isScopedToStatusPages and statusPagesNotifiedOnCreation are this
   * service's to write. A client value for either is dropped before any hook
   * runs, so what the hooks write is all that is written: the flag is derived
   * from statusPages (applyStatusPageScopeToUpdate), and the record is the
   * notification job's - a client must not be able to seed it and so keep
   * pages from ever hearing about the incident, or clear it and have them
   * told twice. Root (internal) callers keep the record they send.
   */
  private stripServiceOwnedScopeColumns(updateBy: UpdateBy<Model>): void {
    const data: Dictionary<unknown> = updateBy.data as Dictionary<unknown>;

    delete data["isScopedToStatusPages"];

    if (!updateBy.props.isRoot) {
      delete data["statusPagesNotifiedOnCreation"];
    }
  }

  /*
   * Whether an update itself asks for the 'created' notification to go out
   * again: it sets the status to Pending - the API route of resending it,
   * and the dashboard's Retry - or asks for it to be sent to every status
   * page again (IncidentCreatedResend, the dashboard's Resend). Read before
   * any hook adds a Pending of its own.
   *
   * Writing shouldStatusPageSubscribersBeNotifiedOnIncidentCreated is no
   * such request, whatever its value: a client writing the whole incident
   * back sends it as true, and that emptied the record of told pages and
   * sent the message to every page again.
   */
  private isCreatedNotificationResendRequested(
    updateBy: UpdateBy<Model>,
  ): boolean {
    return (
      updateBy.data.subscriberNotificationStatusOnIncidentCreated ===
        StatusPageSubscriberNotificationStatus.Pending ||
      IncidentCreatedResend.isRequested(updateBy.miscDataProps)
    );
  }

  /*
   * 'Resend to all pages' (see IncidentCreatedResend): the 'created'
   * notification goes back to Pending with a message saying so, and
   * clearCreatedNotificationRecordOnResend empties its record of told pages
   * in the same write, so the job sends it to every page the incident
   * reaches now - after a failure too, where a plain Retry would resume.
   *
   * Everything is written into the caller's own update, so it lands with the
   * rest of it or not at all, and the column check that runs after this hook
   * still decides whether the caller may write the status. That check is
   * also made here first, before the incidents are read: the refusals below
   * depend on the notification's state, and a caller who may not send it
   * again is told only that. The incidents are then read with the caller's
   * own permissions (and the privacy filter already on the query), so an
   * incident they cannot see never decides the answer; when they can see
   * none of those the update matches, nothing is queued.
   *
   * Refused - with the reason, rather than silently dropped, because asking
   * for it is the whole point of the request - when any matched incident's
   * notification did not go out (Skipped) or is on its way (Pending,
   * InProgress), and when the same update sets the status to anything but
   * Pending.
   */
  private async queueCreatedNotificationResendToAllStatusPagesIfRequested(
    updateBy: UpdateBy<Model>,
  ): Promise<void> {
    if (!IncidentCreatedResend.isRequested(updateBy.miscDataProps)) {
      return;
    }

    const requestedStatus: unknown =
      updateBy.data.subscriberNotificationStatusOnIncidentCreated;

    if (
      requestedStatus !== undefined &&
      requestedStatus !== StatusPageSubscriberNotificationStatus.Pending
    ) {
      throw new BadDataException(
        IncidentCreatedResend.conflictingStatusMessage,
      );
    }

    SubscriberNotificationResendAccess.assertCallerMayUpdateColumns({
      modelType: Model,
      columns: {
        subscriberNotificationStatusOnIncidentCreated:
          StatusPageSubscriberNotificationStatus.Pending,
        subscriberNotificationStatusMessage:
          IncidentCreatedResend.queuedMessage,
        statusPagesNotifiedOnCreation: [],
      },
      props: updateBy.props,
      refusal: IncidentCreatedResend.noPermissionMessage,
    });

    const incidents: Array<Model> = await this.findBy({
      query: updateBy.query,
      select: {
        _id: true,
        subscriberNotificationStatusOnIncidentCreated: true,
      },
      limit: LIMIT_MAX,
      skip: 0,
      props: updateBy.props,
    });

    for (const incident of incidents) {
      const refusal: string | null = IncidentCreatedResend.getRefusalReason(
        incident.subscriberNotificationStatusOnIncidentCreated,
      );

      if (refusal) {
        throw new BadDataException(refusal);
      }
    }

    if (incidents.length === 0) {
      return;
    }

    updateBy.data.subscriberNotificationStatusOnIncidentCreated =
      StatusPageSubscriberNotificationStatus.Pending;

    if (updateBy.data.subscriberNotificationStatusMessage === undefined) {
      updateBy.data.subscriberNotificationStatusMessage =
        IncidentCreatedResend.queuedMessage;
    }
  }

  /*
   * A resend asked for by the update itself (see
   * isCreatedNotificationResendRequested) goes to every status page, as it
   * always did. The job skips the pages in its record of told pages
   * (Incident.statusPagesNotifiedOnCreation), so without this a resend of a
   * notification that went out would reach nobody: the record is emptied in
   * the same write.
   *
   * It is kept in three cases:
   * - Failed: Retry resumes where the failed send stopped, so the pages it
   *   told are not told twice - unless the update asks for it to go to every
   *   page again (IncidentCreatedResend), which is what that request is for;
   * - Pending or InProgress: the notification is on its way already, and its
   *   record is what keeps a send queued for added pages from reaching the
   *   pages told before (IncidentCreatedResend refuses these);
   * - a root caller that writes the record itself.
   *
   * An update matching several incidents empties the record when any of them
   * would otherwise be resent to nobody, because the write applies the same
   * data to all of them.
   */
  private async clearCreatedNotificationRecordOnResend(data: {
    updateBy: UpdateBy<Model>;
    isResendRequested: boolean;
  }): Promise<void> {
    const updateBy: UpdateBy<Model> = data.updateBy;

    if (!data.isResendRequested) {
      return;
    }

    if (
      (updateBy.data as Dictionary<unknown>)[
        "statusPagesNotifiedOnCreation"
      ] !== undefined
    ) {
      return;
    }

    if (IncidentCreatedResend.isRequested(updateBy.miscDataProps)) {
      /*
       * Queued for every page by
       * queueCreatedNotificationResendToAllStatusPagesIfRequested, which
       * left the status alone when the caller can see none of the incidents
       * the update matches: nothing to read to decide.
       */
      if (
        updateBy.data.subscriberNotificationStatusOnIncidentCreated ===
        StatusPageSubscriberNotificationStatus.Pending
      ) {
        updateBy.data.statusPagesNotifiedOnCreation = [];
      }

      return;
    }

    const incidents: Array<Model> = await this.findIncidentsForUpdateHook({
      updateBy: updateBy,
      select: {
        _id: true,
        subscriberNotificationStatusOnIncidentCreated: true,
      },
    });

    const someIncidentWouldReachNobody: boolean = incidents.some(
      (incident: Model): boolean => {
        return ![
          StatusPageSubscriberNotificationStatus.Failed,
          StatusPageSubscriberNotificationStatus.Pending,
          StatusPageSubscriberNotificationStatus.InProgress,
        ].includes(
          incident.subscriberNotificationStatusOnIncidentCreated as StatusPageSubscriberNotificationStatus,
        );
      },
    );

    if (someIncidentWouldReachNobody) {
      updateBy.data.statusPagesNotifiedOnCreation = [];
    }
  }

  /*
   * Publishing a hidden incident can announce it: when the editor turns
   * 'Visible on Status Page' on and ticks "Notify subscribers that this
   * incident was created" (see IncidentCreatedRenotify), the incident's
   * 'created' notification goes back to Pending, and the
   * Incident:SendNotificationToSubscribers job sends it now that the incident
   * is visible - to the pages its record of told pages does not list, so an
   * incident whose notification went out before it was hidden tells only the
   * pages added while it was hidden.
   *
   * It only ever re-queues a notification with someone left to tell, for an
   * incident that is hidden today, not private, and meant to notify on
   * creation, so a stray request cannot email subscribers twice or break a
   * deliberate "don't notify". The status is written into this same update,
   * so it lands together with the visibility change or not at all. The
   * column (and its message) are computed, but their update ACL lists the
   * incident roles, so a non-root edit still passes the column check that
   * runs after this hook.
   *
   * An update that sets the status itself - the API route of resetting it to
   * Pending - is left alone. Notifying on creation is read as the update
   * leaves it, so one that turns it off in the same write queues nothing.
   * An update that matches several incidents queues only when every one of
   * them qualifies, because the write applies the same data to all of them.
   */
  private async queueCreatedNotificationOnPublishIfRequested(
    updateBy: UpdateBy<Model>,
  ): Promise<void> {
    if (!IncidentCreatedRenotify.isRequested(updateBy.miscDataProps)) {
      return;
    }

    if (updateBy.data.isVisibleOnStatusPage !== true) {
      return;
    }

    if (
      updateBy.data.subscriberNotificationStatusOnIncidentCreated !== undefined
    ) {
      return;
    }

    const incidents: Array<Model> = await this.findIncidentsForUpdateHook({
      updateBy: updateBy,
      select: {
        _id: true,
        isVisibleOnStatusPage: true,
        isPrivate: true,
        subscriberNotificationStatusOnIncidentCreated: true,
        shouldStatusPageSubscribersBeNotifiedOnIncidentCreated: true,
        statusPagesNotifiedOnCreation: true,
        statusPages: {
          _id: true,
        },
      },
    });

    if (incidents.length === 0) {
      return;
    }

    const everyIncidentQualifies: boolean = incidents.every(
      (incident: Model): boolean => {
        return IncidentCreatedRenotify.canRenotifyOnPublish({
          isVisibleOnStatusPage: incident.isVisibleOnStatusPage,
          isPrivate:
            updateBy.data.isPrivate !== undefined &&
            updateBy.data.isPrivate !== null
              ? (updateBy.data.isPrivate as boolean)
              : incident.isPrivate,
          subscriberNotificationStatusOnIncidentCreated:
            incident.subscriberNotificationStatusOnIncidentCreated,
          // As this update leaves it, like the privacy above.
          shouldStatusPageSubscribersBeNotifiedOnIncidentCreated:
            this.getValueAfterUpdate(
              updateBy.data
                .shouldStatusPageSubscribersBeNotifiedOnIncidentCreated,
              incident.shouldStatusPageSubscribersBeNotifiedOnIncidentCreated,
            ),
          // The pages it is limited to once this update is written.
          statusPages:
            updateBy.data.statusPages !== undefined
              ? updateBy.data.statusPages
              : incident.statusPages,
          statusPagesNotifiedOnCreation: incident.statusPagesNotifiedOnCreation,
        });
      },
    );

    if (!everyIncidentQualifies) {
      logger.debug(
        `Not re-queueing the incident created notification on publish: ${incidents.length} incident(s) matched and not all of them were hidden, set to notify subscribers and had subscribers left to tell.`,
      );
      return;
    }

    updateBy.data.subscriberNotificationStatusOnIncidentCreated =
      StatusPageSubscriberNotificationStatus.Pending;
    updateBy.data.subscriberNotificationStatusMessage =
      IncidentCreatedRenotify.queuedMessage;
  }

  /*
   * The status pages a new incident is limited to (Incident.statusPages), and
   * the two columns that follow from them.
   *
   * isScopedToStatusPages is derived from the list, whatever the caller sent
   * for it: the column is computed, which exempts it from the column check on
   * create, so a client value would otherwise be stored as is - and a scoped
   * flag with no pages hides the incident from every status page.
   *
   * statusPagesNotifiedOnCreation is the created-notification job's record of
   * the pages it told. A client must not be able to seed it and so keep pages
   * from ever hearing about the incident; only root (internal) callers keep
   * what they send.
   *
   * The pages a non-root caller picks must be pages they can read (see
   * StatusPageReadAccess), except the pages of an incident template they can
   * read: the dashboard fills a template's pages in for everyone who declares
   * from it, which is what the template is for. Pages copied from a template
   * on the server are not the caller's pick. That is checked once the pages
   * are known to be the project's (assertCallerCanPickStatusPagesOnCreate).
   *
   * `isScopedToNothingByTemplate`: declared through the API from a template
   * whose status pages were all deleted. The incident is scoped with no
   * pages - hidden from every status page - rather than unscoped.
   */
  private applyStatusPageScopeToCreate(data: {
    createBy: CreateBy<Model>;
    isScopedToNothingByTemplate?: boolean | undefined;
  }): void {
    const createBy: CreateBy<Model> = data.createBy;

    if (!createBy.props.isRoot) {
      delete createBy.data.statusPagesNotifiedOnCreation;
    }

    const statusPageIds: Array<string> =
      IncidentScopeAddedPagesNotification.normalizeStatusPageIds(
        createBy.data.statusPages,
      );

    if (
      createBy.data.statusPages !== undefined &&
      createBy.data.statusPages !== null
    ) {
      createBy.data.statusPages = this.toStatusPageStubs(statusPageIds);
    }

    createBy.data.isScopedToStatusPages =
      statusPageIds.length > 0 || data.isScopedToNothingByTemplate === true;
  }

  /*
   * The pages a non-root caller picks for a new incident must be pages they
   * can read (see applyStatusPageScopeToCreate). Runs after the project check,
   * so another project's page, or one that does not exist, is reported as
   * such rather than as a page the caller cannot read.
   */
  private async assertCallerCanPickStatusPagesOnCreate(data: {
    createBy: CreateBy<Model>;
    projectId: ObjectID;
    statusPagesFromCaller: boolean;
  }): Promise<void> {
    const createBy: CreateBy<Model> = data.createBy;

    const statusPageIds: Array<string> =
      IncidentScopeAddedPagesNotification.normalizeStatusPageIds(
        createBy.data.statusPages,
      );

    if (
      createBy.props.isRoot ||
      !data.statusPagesFromCaller ||
      statusPageIds.length === 0
    ) {
      return;
    }

    const readableStatusPageIds: Array<string> =
      await StatusPageReadAccess.getReadableStatusPageIds({
        statusPageIds: statusPageIds,
        props: createBy.props,
      });

    let unreadableStatusPageIds: Array<string> = statusPageIds.filter(
      (id: string): boolean => {
        return !readableStatusPageIds.includes(id);
      },
    );

    if (unreadableStatusPageIds.length > 0) {
      const templateStatusPageIds: Array<string> =
        await this.getStatusPageIdsOfTemplatesReadableByCaller({
          projectId: data.projectId,
          props: createBy.props,
        });

      unreadableStatusPageIds = unreadableStatusPageIds.filter(
        (id: string): boolean => {
          return !templateStatusPageIds.includes(id);
        },
      );
    }

    if (unreadableStatusPageIds.length > 0) {
      throw new NotAuthorizedException(
        StatusPageReadAccess.getRefusalMessage("incident"),
      );
    }
  }

  /*
   * The status pages the incident templates the caller can read are limited
   * to. Such a page may be picked for a new incident without reading it:
   * declaring from the template picks it anyway. The templates are read with
   * the caller's permissions (and labels); their pages as root. A caller who
   * cannot read templates at all gets none.
   */
  private async getStatusPageIdsOfTemplatesReadableByCaller(data: {
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<Array<string>> {
    let templates: Array<IncidentTemplate> = [];

    try {
      templates = await IncidentTemplateService.findBy({
        query: {
          projectId: data.projectId,
        },
        select: {
          _id: true,
        },
        limit: LIMIT_MAX,
        skip: 0,
        props: data.props,
      });
    } catch (err) {
      // No access to templates (or not on a plan that has them): no pages.
      logger.debug(
        `Could not read the caller's incident templates while checking the status pages of a new incident: ${err}`,
      );
      return [];
    }

    if (templates.length === 0) {
      return [];
    }

    const templatesWithPages: Array<IncidentTemplate> =
      await IncidentTemplateService.findBy({
        query: {
          _id: QueryHelper.any(
            templates.map((template: IncidentTemplate): string => {
              return template.id!.toString();
            }),
          ),
          projectId: data.projectId,
        },
        select: {
          _id: true,
          statusPages: {
            _id: true,
          },
        },
        limit: LIMIT_MAX,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

    return IncidentScopeAddedPagesNotification.normalizeStatusPageIds(
      templatesWithPages.flatMap(
        (template: IncidentTemplate): Array<StatusPage> => {
          return template.statusPages || [];
        },
      ),
    );
  }

  /*
   * The status pages an incident is limited to, on update. Everything that
   * follows from a write to Incident.statusPages happens here, in the
   * caller's own update, so the list, the flag and a re-queued notification
   * land together or not at all:
   *
   * - isScopedToStatusPages is derived from the list the update writes (a
   *   value the caller sent for it was dropped by
   *   stripServiceOwnedScopeColumns). Nothing else ever sets it, and it is
   *   never recomputed when join rows disappear: deleting the only page an
   *   incident is scoped to leaves it scoped to nothing, hidden from every
   *   page, rather than widened to all of them;
   * - a non-root caller's list is topped up with the pages the incident is
   *   scoped to that the caller cannot read. Status pages are label-scoped,
   *   so an editor may see only some of an incident's pages, and a list write
   *   replaces the whole list (the dashboard sends back what the editor
   *   sees). Without this, saving the incident would silently drop every page
   *   the editor was not shown;
   * - the pages a non-root caller adds must be pages they can read (see
   *   StatusPageReadAccess);
   * - with IncidentScopeAddedPagesNotification requested, the 'created'
   *   notification is queued again for the pages the update adds;
   * - what was added and removed is carried forward for the feed item
   *   onUpdateSuccess writes, and so is whether the notification was on its
   *   way already, which onUpdateSuccess checks again once the pages are
   *   written.
   *
   * The flag and the notification columns are computed, but their update
   * access control lists every role that may edit statusPages, so a non-root
   * edit passes the column check that runs after this hook.
   */
  private async applyStatusPageScopeToUpdate(
    updateBy: UpdateBy<Model>,
    carryForward: UpdateCarryForward,
  ): Promise<void> {
    const data: Dictionary<unknown> = updateBy.data as Dictionary<unknown>;

    if (data["statusPages"] === undefined) {
      return;
    }

    const incidents: Array<Model> = await this.findIncidentsForUpdateHook({
      updateBy: updateBy,
      select: {
        _id: true,
        statusPages: {
          _id: true,
        },
        isVisibleOnStatusPage: true,
        isPrivate: true,
        subscriberNotificationStatusOnIncidentCreated: true,
        shouldStatusPageSubscribersBeNotifiedOnIncidentCreated: true,
        statusPagesNotifiedOnCreation: true,
      },
    });

    const requestedStatusPageIds: Array<string> =
      IncidentScopeAddedPagesNotification.normalizeStatusPageIds(
        data["statusPages"],
      );

    const hiddenStatusPageIds: Array<string> = updateBy.props.isRoot
      ? []
      : await this.getScopedStatusPageIdsHiddenFromCaller({
          incidents: incidents,
          props: updateBy.props,
        });

    const statusPageIds: Array<string> = [
      ...requestedStatusPageIds,
      ...hiddenStatusPageIds.filter((id: string) => {
        return !requestedStatusPageIds.includes(id);
      }),
    ];

    if (!updateBy.props.isRoot) {
      await StatusPageReadAccess.assertCallerCanPickStatusPages({
        statusPageIds: this.getStatusPageIdsAddedToAny({
          incidents: incidents,
          statusPageIds: statusPageIds,
        }),
        props: updateBy.props,
        subject: "incident",
      });
    }

    data["statusPages"] = this.toStatusPageStubs(statusPageIds);
    data["isScopedToStatusPages"] = statusPageIds.length > 0;

    const decisions: Array<AddedStatusPagesDecision> = [];

    for (const incident of incidents) {
      const incidentId: string = incident.id!.toString();

      const change: StatusPageScopeChange =
        IncidentScopeAddedPagesNotification.getScopeChange({
          before: incident.statusPages,
          after: statusPageIds,
        });

      const action: IncidentScopeAddedPagesNotificationAction =
        IncidentScopeAddedPagesNotification.getAction({
          addedStatusPageIds: change.addedStatusPageIds,
          incident: {
            subscriberNotificationStatusOnIncidentCreated:
              incident.subscriberNotificationStatusOnIncidentCreated,
            shouldStatusPageSubscribersBeNotifiedOnIncidentCreated:
              this.getValueAfterUpdate(
                updateBy.data
                  .shouldStatusPageSubscribersBeNotifiedOnIncidentCreated,
                incident.shouldStatusPageSubscribersBeNotifiedOnIncidentCreated,
              ),
            isVisibleOnStatusPage: this.getValueAfterUpdate(
              updateBy.data.isVisibleOnStatusPage,
              incident.isVisibleOnStatusPage,
            ),
            isPrivate: this.getValueAfterUpdate(
              updateBy.data.isPrivate,
              incident.isPrivate,
            ),
            statusPagesNotifiedOnCreation:
              incident.statusPagesNotifiedOnCreation,
          },
        });

      carryForward[incidentId] = {
        monitorsRemoved: [],
        monitorsAdded: [],
        oldChangeMonitorStatusIdTo: undefined,
        newMonitorChangeStatusIdTo: undefined,
        ...carryForward[incidentId],
        statusPageScopeChange: {
          ...change,
          isScoped: statusPageIds.length > 0,
          notificationQueued: false,
          /*
           * On its way already, and nothing in this update sets the status:
           * onUpdateSuccess makes sure the send did not finish without the
           * added pages in the meantime.
           */
          notificationAlreadyQueued:
            action ===
              IncidentScopeAddedPagesNotificationAction.AlreadyQueued &&
            updateBy.data.subscriberNotificationStatusOnIncidentCreated ===
              undefined,
        },
      };

      decisions.push({
        incidentId: incidentId,
        action: action,
        recordToSeed:
          action === IncidentScopeAddedPagesNotificationAction.Queue
            ? IncidentScopeAddedPagesNotification.getRecordToSeedOnQueue({
                statusPagesNotifiedOnCreation:
                  incident.statusPagesNotifiedOnCreation,
                statusPageIdsBeforeUpdate: incident.statusPages,
              })
            : undefined,
      });
    }

    this.queueCreatedNotificationForAddedStatusPagesIfRequested({
      updateBy: updateBy,
      decisions: decisions,
      carryForward: carryForward,
    });
  }

  /*
   * The pages an update writing `statusPageIds` adds to at least one of the
   * incidents it matches.
   */
  private getStatusPageIdsAddedToAny(data: {
    incidents: Array<Model>;
    statusPageIds: Array<string>;
  }): Array<string> {
    const added: Array<string> = [];

    for (const incident of data.incidents) {
      for (const id of IncidentScopeAddedPagesNotification.getScopeChange({
        before: incident.statusPages,
        after: data.statusPageIds,
      }).addedStatusPageIds) {
        if (!added.includes(id)) {
          added.push(id);
        }
      }
    }

    return added;
  }

  /*
   * Adding status pages to an incident's scope can tell them the incident was
   * created: with IncidentScopeAddedPagesNotification requested, the 'created'
   * notification goes back to Pending, and the job sends it to the pages it
   * has no record of telling (Incident.statusPagesNotifiedOnCreation). See
   * IncidentScopeAddedPagesNotification.getAction for when it applies.
   *
   * A notification that was never sent has no record yet, so the pages the
   * incident was limited to before are written in as the record in the same
   * write (getRecordToSeedOnQueue): the job then tells only the added pages.
   *
   * An update that sets the status itself - the API route of resetting it to
   * Pending, or publishing a hidden incident - is left alone. Notifying on
   * creation is read as the update leaves it, like the visibility and the
   * privacy. An update that matches several incidents queues only when it
   * may for every one of them, because the write applies the same data to
   * all. For the same reason it cannot write a record that differs between
   * them, or overwrite the record of an incident that has one, and is refused
   * instead.
   */
  private queueCreatedNotificationForAddedStatusPagesIfRequested(data: {
    updateBy: UpdateBy<Model>;
    decisions: Array<AddedStatusPagesDecision>;
    carryForward: UpdateCarryForward;
  }): void {
    const updateBy: UpdateBy<Model> = data.updateBy;

    if (
      !IncidentScopeAddedPagesNotification.isRequested(updateBy.miscDataProps)
    ) {
      return;
    }

    if (
      updateBy.data.subscriberNotificationStatusOnIncidentCreated !== undefined
    ) {
      return;
    }

    const actions: Array<IncidentScopeAddedPagesNotificationAction> =
      data.decisions.map(
        (
          decision: AddedStatusPagesDecision,
        ): IncidentScopeAddedPagesNotificationAction => {
          return decision.action;
        },
      );

    if (!actions.includes(IncidentScopeAddedPagesNotificationAction.Queue)) {
      return;
    }

    const everyIncidentMayQueue: boolean = actions.every(
      (action: IncidentScopeAddedPagesNotificationAction): boolean => {
        return (
          action === IncidentScopeAddedPagesNotificationAction.Queue ||
          action === IncidentScopeAddedPagesNotificationAction.AlreadyQueued
        );
      },
    );

    if (!everyIncidentMayQueue) {
      logger.debug(
        `Not queueing the incident created notification for added status pages: ${actions.length} incident(s) matched and not all of them gained status pages and may be announced.`,
      );
      return;
    }

    const recordsToSeed: Array<Array<string>> = data.decisions
      .map((decision: AddedStatusPagesDecision): Array<string> | undefined => {
        return decision.recordToSeed;
      })
      .filter((record: Array<string> | undefined): boolean => {
        return record !== undefined;
      }) as Array<Array<string>>;

    if (recordsToSeed.length > 0) {
      const recordToSeed: Array<string> = recordsToSeed[0]!;

      const everyIncidentTakesTheSameRecord: boolean =
        recordsToSeed.length === data.decisions.length &&
        recordsToSeed.every((record: Array<string>): boolean => {
          return (
            [...record].sort().join(",") === [...recordToSeed].sort().join(",")
          );
        });

      if (!everyIncidentTakesTheSameRecord) {
        throw new BadDataException(
          "These incidents cannot be sent the incident-created notification for their added status pages together: they were limited to different status pages, or not all of them were ever announced. Change them one at a time.",
        );
      }

      updateBy.data.statusPagesNotifiedOnCreation = recordToSeed;
    }

    updateBy.data.subscriberNotificationStatusOnIncidentCreated =
      StatusPageSubscriberNotificationStatus.Pending;
    updateBy.data.subscriberNotificationStatusMessage =
      IncidentScopeAddedPagesNotification.queuedMessage;

    for (const decision of data.decisions) {
      const scopeChange: StatusPageScopeCarryForward | undefined =
        data.carryForward[decision.incidentId]?.statusPageScopeChange;

      if (
        scopeChange &&
        decision.action === IncidentScopeAddedPagesNotificationAction.Queue
      ) {
        scopeChange.notificationQueued = true;
      }
    }
  }

  /*
   * An update that added pages while the 'created' notification was Pending
   * or being sent left the status alone: the queued send reads the scope when
   * it goes out, and a running send reads it again once it has finished (see
   * the Incident:SendNotificationToSubscribers job). One case slips between
   * the two: the whole send started after this update read the status and
   * finished before it wrote the pages. Once the pages are written, this
   * checks for exactly that - the send finished, and an added page is not in
   * its record - and queues the notification again for the pages it missed.
   *
   * Never throws: the update is already written.
   */
  private async requeueCreatedNotificationIfAddedPagesWereMissed(data: {
    incidentId: ObjectID;
    change: StatusPageScopeCarryForward | undefined;
  }): Promise<void> {
    if (
      !data.change?.notificationAlreadyQueued ||
      data.change.addedStatusPageIds.length === 0
    ) {
      return;
    }

    try {
      const incident: Model | null = await this.findOneById({
        id: data.incidentId,
        select: {
          subscriberNotificationStatusOnIncidentCreated: true,
          statusPagesNotifiedOnCreation: true,
        },
        props: {
          isRoot: true,
        },
      });

      if (
        incident?.subscriberNotificationStatusOnIncidentCreated !==
        StatusPageSubscriberNotificationStatus.Success
      ) {
        // Still on its way (it will see the pages), or settled otherwise.
        return;
      }

      const recorded: Array<string> =
        IncidentScopeAddedPagesNotification.getRecordedStatusPageIds(
          incident.statusPagesNotifiedOnCreation,
        ) || [];

      const missed: boolean = data.change.addedStatusPageIds.some(
        (id: string): boolean => {
          return !recorded.includes(id);
        },
      );

      if (!missed) {
        return;
      }

      await this.updateOneById({
        id: data.incidentId,
        data: {
          subscriberNotificationStatusOnIncidentCreated:
            StatusPageSubscriberNotificationStatus.Pending,
          subscriberNotificationStatusMessage:
            IncidentScopeAddedPagesNotification.queuedMessage,
        },
        props: {
          isRoot: true,
          ignoreHooks: true,
        },
      });
    } catch (err) {
      logger.error(
        `Failed to check whether the incident created notification reached the status pages added to the incident: ${err}`,
        {
          incidentId: data.incidentId?.toString(),
        } as LogAttributes,
      );
    }
  }

  /*
   * The pages the matched incidents are scoped to that the caller cannot
   * read, which a list write from them must keep (see
   * applyStatusPageScopeToUpdate). A bulk update writes the same list onto
   * every incident it matches, so it can only keep them when every matched
   * incident holds the same hidden pages; otherwise it would scope some of
   * them to pages they were never scoped to, and it is refused.
   */
  private async getScopedStatusPageIdsHiddenFromCaller(data: {
    incidents: Array<Model>;
    props: DatabaseCommonInteractionProps;
  }): Promise<Array<string>> {
    const heldByIncident: Array<Array<string>> = data.incidents.map(
      (incident: Model) => {
        return IncidentScopeAddedPagesNotification.normalizeStatusPageIds(
          incident.statusPages,
        );
      },
    );

    const heldIds: Array<string> =
      IncidentScopeAddedPagesNotification.normalizeStatusPageIds(
        heldByIncident.flat(),
      );

    if (heldIds.length === 0) {
      return [];
    }

    const readableIds: Array<string> =
      await StatusPageReadAccess.getReadableStatusPageIds({
        statusPageIds: heldIds,
        props: data.props,
      });

    const hiddenByIncident: Array<Array<string>> = heldByIncident.map(
      (held: Array<string>) => {
        return held
          .filter((id: string) => {
            return !readableIds.includes(id);
          })
          .sort();
      },
    );

    const hiddenIds: Array<string> = hiddenByIncident[0] || [];

    const everyIncidentHidesTheSame: boolean = hiddenByIncident.every(
      (hidden: Array<string>) => {
        return hidden.join(",") === hiddenIds.join(",");
      },
    );

    if (!everyIncidentHidesTheSame) {
      throw new BadDataException(
        "These incidents are limited to different status pages that you do not have access to, so their status pages cannot be changed together. Change them one at a time.",
      );
    }

    return hiddenIds;
  }

  private toStatusPageStubs(statusPageIds: Array<string>): Array<StatusPage> {
    return statusPageIds.map((statusPageId: string) => {
      const statusPage: StatusPage = new StatusPage();
      statusPage._id = statusPageId;
      return statusPage;
    });
  }

  // A column's value once an update is written: the update's, else the stored.
  private getValueAfterUpdate<T>(
    updatedValue: unknown,
    storedValue: T | undefined,
  ): T | undefined {
    if (updatedValue !== undefined && updatedValue !== null) {
      return updatedValue as T;
    }

    return storedValue;
  }

  /*
   * An update can repoint an incident at another project's state, severity or
   * monitor status just as easily as a create can, and the result is the same:
   * the referenced project can no longer be deleted. Only the columns actually
   * being written are checked, so ordinary updates cost no extra queries.
   */
  private async validateProjectScopedReferences(
    updateBy: UpdateBy<Model>,
  ): Promise<void> {
    /*
     * The state, the severity and the monitor status, each by both of its
     * names: the API takes the ID column and the relation alike, and every
     * name that holds an id is checked. Two names that disagree are refused
     * before anything is read.
     */
    const references: Array<ProjectScopedReference> = [
      ...getWrittenRelationReferences({
        payload: updateBy.data,
        idColumn: "currentIncidentStateId",
        relation: "currentIncidentState",
        modelName: "Incident State",
        service: IncidentStateService,
      }),
      ...getWrittenRelationReferences({
        payload: updateBy.data,
        idColumn: "incidentSeverityId",
        relation: "incidentSeverity",
        modelName: "Incident Severity",
        service: IncidentSeverityService,
      }),
      ...getWrittenRelationReferences({
        payload: updateBy.data,
        idColumn: "changeMonitorStatusToId",
        relation: "changeMonitorStatusTo",
        modelName: "Monitor Status",
        service: MonitorStatusService,
      }),
    ];

    /*
     * The SLOs this incident affects: a relation list the API accepts on
     * update. Checked for the same reason as on create; see
     * SloRecordReferenceValidator.
     */
    const hasServiceLevelObjectiveIds: boolean =
      SloRecordReferenceValidator.getReferencedIds(
        updateBy.data.serviceLevelObjectives,
      ).length > 0;

    /*
     * The monitors, on-call policies, labels and affected-resource lists,
     * when the update rewrites them. An empty list only removes rows and
     * needs no check.
     */
    const relations: Array<ProjectScopedRelation> =
      this.getProjectScopedRelations().filter(
        (relation: ProjectScopedRelation) => {
          return (
            resolveReferenceIds(
              (updateBy.data as Dictionary<unknown>)[relation.column],
            ).length > 0
          );
        },
      );

    if (
      references.length === 0 &&
      !hasServiceLevelObjectiveIds &&
      relations.length === 0
    ) {
      return;
    }

    /*
     * Root/API updates do not always carry a tenantId, so fall back to the
     * project of each incident the query actually matches.
     */
    const projectIds: Array<ObjectID> = updateBy.props.tenantId
      ? [updateBy.props.tenantId]
      : await this.getProjectIdsForUpdateQuery(updateBy);

    const heldIds: HeldRelationIds | undefined =
      relations.length > 0
        ? await ProjectScopedReferenceValidator.getHeldRelationIds({
            service: this as unknown as DatabaseService<DatabaseBaseModel>,
            query: updateBy.query as Query<DatabaseBaseModel>,
            columns: relations.map((relation: ProjectScopedRelation) => {
              return relation.column;
            }),
          })
        : undefined;

    for (const projectId of projectIds) {
      if (hasServiceLevelObjectiveIds) {
        await SloRecordReferenceValidator.validateServiceLevelObjectivesBelongToProject(
          {
            projectId: projectId,
            subject: "incident",
            serviceLevelObjectives: updateBy.data.serviceLevelObjectives,
          },
        );
      }

      const referencesInProject: Array<ProjectScopedReference> = [
        ...references,
        ...ProjectScopedReferenceValidator.getRelationReferences({
          payload: updateBy.data,
          relations: relations,
          projectId: projectId,
          heldIds: heldIds,
        }),
      ];

      if (referencesInProject.length === 0) {
        continue;
      }

      await ProjectScopedReferenceValidator.validateReferencesBelongToProject({
        projectId: projectId,
        subject: "incident",
        references: referencesInProject,
      });
    }
  }

  /*
   * The many-to-many lists whose ids must belong to the incident's project.
   * Built per call rather than at module load: these services sit in an
   * import graph that loops back to this one, and a module-level table would
   * capture whichever of them had not finished loading yet as undefined.
   */
  private getProjectScopedRelations(): Array<ProjectScopedRelation> {
    return [
      {
        column: "monitors",
        modelName: "Monitor",
        service: MonitorService,
      },
      {
        column: "labels",
        modelName: "Label",
        service: LabelService,
      },
      {
        column: "onCallDutyPolicies",
        modelName: "On-Call Policy",
        service: OnCallDutyPolicyService,
      },
      /*
       * The status pages the incident is limited to. Another project's page
       * here would put that project's page name into this incident's feed and
       * scope it to a page it can never show on.
       */
      {
        column: "statusPages",
        modelName: "Status Page",
        service: StatusPageService,
      },
      ...getAffectedResourceRelations(this.getModel()),
    ];
  }

  private async getProjectIdsForUpdateQuery(
    updateBy: UpdateBy<Model>,
  ): Promise<Array<ObjectID>> {
    const incidents: Array<Model> = await this.findBy({
      query: updateBy.query,
      select: {
        projectId: true,
      },
      limit: LIMIT_MAX,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    const projectIds: Dictionary<ObjectID> = {};

    for (const incident of incidents) {
      if (incident.projectId) {
        projectIds[incident.projectId.toString()] = incident.projectId;
      }
    }

    return Object.values(projectIds);
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    await super.onBeforeCreate(createBy);

    /*
     * A new incident is in no episode: it joins one through grouping or the
     * episode's members (EpisodeMembershipReference). Refused before the
     * incident number is taken.
     */
    EpisodeMembershipReference.refuseWriteMadeInProject({
      payload: createBy.data,
      props: createBy.props,
      reference: INCIDENT_EPISODE_REFERENCE,
    });

    if (!createBy.props.tenantId && !createBy.props.isRoot) {
      throw new BadDataException("ProjectId required to create incident.");
    }

    if (createBy.data.isPrivate === true) {
      createBy.data.isVisibleOnStatusPage = false;
      createBy.data.shouldStatusPageSubscribersBeNotifiedOnIncidentCreated =
        false;
    }

    /*
     * Owners handed over to be notified are added by onCreateSuccess's
     * chain, once the incident's Slack / Microsoft Teams channels exist -
     * seconds after the incident is written, with a workspace connected. The
     * owners' "Incident Created" notification is sent by a job that runs
     * every minute and takes every incident not yet marked as notified: run
     * in between, it would find no owners, tell the project's owners
     * instead, and mark the incident done, and the owners the create named
     * would hear nothing of it ("owner added" is off by default). So such an
     * incident is written as notified already, and the chain marks it not
     * notified once it has added them (releaseCreatedNotificationHeldForOwners):
     * the job then tells them on its next run.
     */
    if (this.isCreatedNotificationHeldForOwners(createBy)) {
      createBy.data.isOwnerNotifiedOfResourceCreation = true;
    }

    const projectId: ObjectID =
      createBy.props.tenantId || createBy.data.projectId!;

    /*
     * The values the caller sent, before a template or a mapping adds any:
     * those are not the caller's to get wrong.
     */
    await this.validateCustomFieldValuesOnCreate({
      createBy: createBy,
      projectId: projectId,
    });

    /*
     * Status pages the caller picked, as opposed to ones copied from a
     * template below (see applyStatusPageScopeToCreate).
     */
    const statusPagesFromCaller: boolean =
      createBy.data.statusPages !== undefined &&
      createBy.data.statusPages !== null;

    /*
     * Declaring the incident from alerts. The alert ids are checked here,
     * before the incident number is taken and before anything is written, so
     * a bad id (a typo, another project's alert, an alert the caller cannot
     * see, too many alerts) rejects the whole request instead of leaving an
     * incident behind that is missing some of its alerts. The alerts are
     * linked in onCreateSuccess, once the incident exists.
     */
    const alertIdsToLink: unknown =
      createBy.miscDataProps?.[INCIDENT_ALERT_IDS_TO_LINK_KEY];

    const validatedAlertIds: Array<ObjectID> =
      alertIdsToLink !== undefined && alertIdsToLink !== null
        ? await IncidentAlertService.validateAlertIdsForNewIncident({
            projectId: projectId,
            alertIds: alertIdsToLink,
            props: createBy.props,
          })
        : [];

    /*
     * Asking to acknowledge the alerts is checked here too, with the alert
     * ids, so a request that cannot be honoured (no Acknowledged alert state,
     * or a caller who may not change these alerts' states) is refused before
     * the incident exists rather than leaving alerts that keep paging.
     */
    const alertsToAcknowledge: AlertsToAcknowledgeOnDeclare | null =
      await IncidentAlertService.validateAcknowledgeAlertsForNewIncident({
        projectId: projectId,
        acknowledgeAlerts:
          createBy.miscDataProps?.[INCIDENT_ACKNOWLEDGE_ALERTS_TO_LINK_KEY],
        alertIds: validatedAlertIds,
        props: createBy.props,
      });

    if (!createBy.data.declaredAt) {
      createBy.data.declaredAt = OneUptimeDate.getCurrentDate();
    } else {
      createBy.data.declaredAt = OneUptimeDate.fromString(
        createBy.data.declaredAt as Date,
      );
    }

    /*
     * Normalize a blank incident severity to "not provided". A stored empty
     * ObjectID (`{"_type":"ObjectID","value":""}`) deserializes to a truthy
     * `new ObjectID("")`, which is NOT `=== undefined` and is a truthy object —
     * so it slips past the template fallback below AND
     * DatabaseService.checkRequiredFields, then serializes to "" → NULL on the
     * not-null `incidentSeverityId` column (Postgres 23502). Treating it as
     * undefined lets the template fallback fill it in when available, otherwise
     * the required-field check rejects with a clean "incidentSeverityId is
     * required" error instead of an opaque database failure.
     */
    if (
      createBy.data.incidentSeverityId &&
      !createBy.data.incidentSeverityId.toString()
    ) {
      delete createBy.data.incidentSeverityId;
    }

    // Determine the initial incident state
    let initialIncidentStateId: ObjectID | undefined = undefined;

    /*
     * Where the incident starts (StartingStage), read with the state it
     * starts in: one read of the project's states both places a picked
     * state, or a template's, and tells whether it is the project's own.
     * Open for the created state, where it starts when neither names one.
     */
    let startingStage: StartingStage = StartingStage.Open;

    // Whether that read found the state among the project's own.
    let isStatePlacedByStartingRead: boolean = false;

    // Declared from a template whose status pages were all deleted.
    let isScopedToNothingByTemplate: boolean = false;

    const createData: Record<string, unknown> =
      createBy.data as unknown as Record<string, unknown>;

    /*
     * A state the caller picked, and the template they declare from, each
     * under either of its names (the two must agree), so a pick sent as the
     * relation counts the same as one sent as the ID.
     */
    const pickedIncidentStateId: ObjectID | null =
      RelationIdUtil.readConsistent(
        createData,
        CURRENT_STATE_KEYS,
        "Incident State",
      );

    const incidentTemplateId: ObjectID | null = RelationIdUtil.readConsistent(
      createData,
      TEMPLATE_KEYS,
      "Incident Template",
    );

    // A state the caller picked (manual selection) is where the incident starts.
    if (pickedIncidentStateId) {
      initialIncidentStateId = pickedIncidentStateId;

      // It has to be one of the project's states.
      const pickedStart: StartingState | null =
        await IncidentStateService.getStartingState({
          projectId: projectId,
          incidentStateId: pickedIncidentStateId,
        });

      if (!pickedStart) {
        throw new BadDataException(
          "Invalid incident state provided. The state does not exist or does not belong to this project.",
        );
      }

      startingStage = pickedStart.stage;
      isStatePlacedByStartingRead = true;
    } else if (incidentTemplateId) {
      /*
       * Created from a template — pull every field we may want to
       * inherit and apply each one only if the caller didn't already
       * provide it. The dashboard pre-fills these on the client, so in
       * the UI flow this is a no-op; the gain is for API consumers
       * that just send `createdIncidentTemplateId` and expect the
       * server to materialize the rest. `undefined` means "not set by
       * the caller" — an explicit empty array or empty string is
       * treated as an intentional override and we leave it alone.
       */
      const incidentTemplate: IncidentTemplate | null =
        await IncidentTemplateService.findOneBy({
          query: {
            _id: incidentTemplateId.toString(),
            projectId: projectId,
          },
          select: {
            initialIncidentStateId: true,
            incidentSeverityId: true,
            changeMonitorStatusToId: true,
            title: true,
            description: true,
            monitors: { _id: true },
            hosts: { _id: true },
            kubernetesClusters: { _id: true },
            dockerHosts: { _id: true },
            podmanHosts: { _id: true },
            services: { _id: true },
            onCallDutyPolicies: { _id: true },
            labels: { _id: true },
            statusPages: { _id: true },
            isScopedToStatusPages: true,
            customFields: true,
          },
          props: {
            isRoot: true,
          },
        });

      if (incidentTemplate?.initialIncidentStateId) {
        /*
         * The template's state, while it is one of the project's states.
         * One deleted since, or never the project's, leaves the incident to
         * start in the created state.
         */
        const templateStart: StartingState | null =
          await IncidentStateService.getStartingState({
            projectId: projectId,
            incidentStateId: incidentTemplate.initialIncidentStateId,
          });

        if (templateStart) {
          initialIncidentStateId = incidentTemplate.initialIncidentStateId;
          startingStage = templateStart.stage;
          isStatePlacedByStartingRead = true;
        }
      }

      if (incidentTemplate) {
        /*
         * A severity or a monitor status the caller sent, under either of
         * its names, wins over the template's. The template's is written
         * with stamp, so no other name is left beside it to be stored
         * instead.
         */
        if (
          !RelationIdUtil.readConsistent(
            createData,
            SEVERITY_KEYS,
            "Incident Severity",
          ) &&
          incidentTemplate.incidentSeverityId
        ) {
          RelationIdUtil.stamp(
            createData,
            SEVERITY_KEYS,
            incidentTemplate.incidentSeverityId,
          );
        }
        if (
          !RelationIdUtil.isPresent(createData, CHANGE_MONITOR_STATUS_KEYS) &&
          incidentTemplate.changeMonitorStatusToId
        ) {
          RelationIdUtil.stamp(
            createData,
            CHANGE_MONITOR_STATUS_KEYS,
            incidentTemplate.changeMonitorStatusToId,
          );
        }
        if (
          createBy.data.title === undefined &&
          typeof incidentTemplate.title === "string"
        ) {
          createBy.data.title = incidentTemplate.title;
        }
        if (
          createBy.data.description === undefined &&
          typeof incidentTemplate.description === "string"
        ) {
          createBy.data.description = incidentTemplate.description;
        }

        const stubBy: <T extends { _id?: string | undefined }>(
          ctor: new () => T,
          rows: Array<{ _id?: string | undefined }> | undefined,
        ) => Array<T> | undefined = <T extends { _id?: string | undefined }>(
          ctor: new () => T,
          rows: Array<{ _id?: string | undefined }> | undefined,
        ): Array<T> | undefined => {
          if (!rows) {
            return undefined;
          }
          return rows
            .filter((row: { _id?: string | undefined }): boolean => {
              return Boolean(row._id);
            })
            .map((row: { _id?: string | undefined }): T => {
              const stub: T = new ctor();
              stub._id = String(row._id);
              return stub;
            });
        };

        if (createBy.data.monitors === undefined) {
          const stubs: Array<Monitor> | undefined = stubBy(
            Monitor,
            incidentTemplate.monitors,
          );
          if (stubs && stubs.length > 0) {
            createBy.data.monitors = stubs;
          }
        }
        if (createBy.data.hosts === undefined) {
          const stubs: Array<Host> | undefined = stubBy(
            Host,
            incidentTemplate.hosts,
          );
          if (stubs && stubs.length > 0) {
            createBy.data.hosts = stubs;
          }
        }
        if (createBy.data.kubernetesClusters === undefined) {
          const stubs: Array<KubernetesCluster> | undefined = stubBy(
            KubernetesCluster,
            incidentTemplate.kubernetesClusters,
          );
          if (stubs && stubs.length > 0) {
            createBy.data.kubernetesClusters = stubs;
          }
        }
        if (createBy.data.dockerHosts === undefined) {
          const stubs: Array<DockerHost> | undefined = stubBy(
            DockerHost,
            incidentTemplate.dockerHosts,
          );
          if (stubs && stubs.length > 0) {
            createBy.data.dockerHosts = stubs;
          }
        }
        if (createBy.data.podmanHosts === undefined) {
          const stubs: Array<PodmanHost> | undefined = stubBy(
            PodmanHost,
            incidentTemplate.podmanHosts,
          );
          if (stubs && stubs.length > 0) {
            createBy.data.podmanHosts = stubs;
          }
        }
        if (createBy.data.services === undefined) {
          const stubs: Array<ServiceModel> | undefined = stubBy(
            ServiceModel,
            incidentTemplate.services,
          );
          if (stubs && stubs.length > 0) {
            createBy.data.services = stubs;
          }
        }
        if (createBy.data.onCallDutyPolicies === undefined) {
          const stubs: Array<OnCallDutyPolicy> | undefined = stubBy(
            OnCallDutyPolicy,
            incidentTemplate.onCallDutyPolicies,
          );
          if (stubs && stubs.length > 0) {
            createBy.data.onCallDutyPolicies = stubs;
          }
        }
        if (createBy.data.labels === undefined) {
          const stubs: Array<Label> | undefined = stubBy(
            Label,
            incidentTemplate.labels,
          );
          if (stubs && stubs.length > 0) {
            createBy.data.labels = stubs;
          }
        }
        // Applying a template that has status pages scopes the incident.
        if (createBy.data.statusPages === undefined) {
          const stubs: Array<StatusPage> | undefined = stubBy(
            StatusPage,
            incidentTemplate.statusPages,
          );
          if (stubs && stubs.length > 0) {
            createBy.data.statusPages = stubs;
          } else if (incidentTemplate.isScopedToStatusPages) {
            /*
             * A template limited to status pages that have all been deleted
             * since. Its incidents stay limited - to nothing - like an
             * incident whose pages were deleted, rather than reaching every
             * page that lists their monitors.
             */
            isScopedToNothingByTemplate = true;
          }
        }

        /*
         * The template's custom field values fill in the fields the caller
         * left out; a value the caller sent always wins. Merged, not
         * replaced, so the caller's own values are never dropped. They are
         * the template's, so the value check above (the caller's values
         * only) does not see them, and the mapping below still has the last
         * word on a mapped field.
         */
        const customFieldsWithTemplate: JSONObject | undefined =
          mergeTemplateCustomFields({
            templateCustomFields: incidentTemplate.customFields,
            customFields: createBy.data.customFields,
          });

        if (customFieldsWithTemplate) {
          createBy.data.customFields = customFieldsWithTemplate;
        }
      }
    }

    this.applyStatusPageScopeToCreate({
      createBy: createBy,
      isScopedToNothingByTemplate: isScopedToNothingByTemplate,
    });

    /*
     * With no state picked, and none from a template, the incident starts in
     * the project's created state - as every incident a monitor declares
     * does - which is open (StartingStage) with no need to read the rest of
     * the project's states.
     */
    if (!initialIncidentStateId) {
      initialIncidentStateId =
        await IncidentStateService.getCreatedIncidentStateId(projectId);
    }

    /*
     * The severity and the monitor status to switch to can arrive from an API
     * caller, an incident template or a monitor criteria, and none of those
     * paths checked that the record belongs to this project. Persisting
     * another project's id leaves that project undeletable, so reject it here.
     *
     * The monitors, on-call policies and labels lists are checked for the same
     * reason and a worse one: onCreateSuccess changes the status of every
     * listed monitor and executes every listed on-call policy, so another
     * project's ids here would page that project's on-call and flip its
     * monitors for this project's incident. The affected-resource lists are
     * checked too (see getAffectedResourceRelations). Lists copied from the
     * template above are checked like any other payload.
     *
     * Runs before the counter increment so a rejected create does not burn an
     * incident number.
     */
    await ProjectScopedReferenceValidator.validateReferencesBelongToProject({
      projectId: projectId,
      subject: "incident",
      references: [
        /*
         * The state it starts in - unless the read of where it starts found
         * it among the project's states: a state picked or a template's.
         */
        ...(isStatePlacedByStartingRead
          ? []
          : [
              {
                modelName: "Incident State",
                id: initialIncidentStateId,
                service: IncidentStateService,
              },
            ]),
        ...getWrittenRelationReferences({
          payload: createBy.data,
          idColumn: "incidentSeverityId",
          relation: "incidentSeverity",
          modelName: "Incident Severity",
          service: IncidentSeverityService,
        }),
        ...getWrittenRelationReferences({
          payload: createBy.data,
          idColumn: "changeMonitorStatusToId",
          relation: "changeMonitorStatusTo",
          modelName: "Monitor Status",
          service: MonitorStatusService,
        }),
        ...ProjectScopedReferenceValidator.getRelationReferences({
          payload: createBy.data,
          relations: this.getProjectScopedRelations(),
        }),
      ],
    });

    /*
     * The SLOs this incident affects. The burn-rate worker links its own
     * same-project SLO as root, but the column is writable by API callers too.
     * Another project's SLO would put that SLO's name into this project's
     * feed, lists and metrics. Before the counter increment, like the check
     * above.
     */
    await SloRecordReferenceValidator.validateServiceLevelObjectivesBelongToProject(
      {
        projectId: projectId,
        subject: "incident",
        serviceLevelObjectives: createBy.data.serviceLevelObjectives,
      },
    );

    // Before the counter increment too, like the checks above.
    await this.assertCallerCanPickStatusPagesOnCreate({
      createBy: createBy,
      projectId: projectId,
      statusPagesFromCaller: statusPagesFromCaller,
    });

    /*
     * How far along it starts (StartingStage), as read with its state above,
     * is handed to onCreateSuccess, which decides on it what the create sets
     * off: an incident declared already acknowledged pages nobody, and one
     * declared resolved also sets off nothing that answers a live problem.
     *
     * The alerts to acknowledge are asked for only with alerts to link (the
     * validator refuses the request otherwise), so they are empty, and the
     * state null, for an incident declared from no alerts.
     */
    const carryForward: IncidentCreateCarryForward = {
      startingStage: startingStage,
      alertIdsToLink: validatedAlertIds,
      acknowledgedAlertStateId:
        alertsToAcknowledge?.acknowledgedAlertStateId || null,
      alertIdsToAcknowledge: alertsToAcknowledge?.alertIdsToAcknowledge || [],
    };

    const incidentCounterResult: {
      counter: number;
      prefix: string | undefined;
    } = await ProjectService.incrementAndGetIncidentCounter(projectId);

    // The state it starts in, and no other name of it to be stored instead.
    RelationIdUtil.stamp(
      createData,
      CURRENT_STATE_KEYS,
      initialIncidentStateId,
    );
    createBy.data.incidentNumber = incidentCounterResult.counter;
    createBy.data.incidentNumberWithPrefix = NumberPrefixUtil.formatNumber(
      incidentCounterResult.prefix,
      incidentCounterResult.counter,
    );

    // Who declared it, under either name of it: see CreatedByUser.
    const declaredByUserId: ObjectID | null = CreatedByUser.getId(
      createBy.data,
      createBy.props,
    );

    if (declaredByUserId && !createBy.data.rootCause) {
      createBy.data.rootCause = `Incident created by ${await UserService.getUserMarkdownString(
        {
          userId: declaredByUserId,
          projectId: projectId,
        },
      )}`;
    }

    // Set notification status based on shouldStatusPageSubscribersBeNotifiedOnIncidentCreated
    if (
      createBy.data.shouldStatusPageSubscribersBeNotifiedOnIncidentCreated ===
      false
    ) {
      createBy.data.subscriberNotificationStatusOnIncidentCreated =
        StatusPageSubscriberNotificationStatus.Skipped;
      createBy.data.subscriberNotificationStatusMessage =
        "Notifications skipped as subscribers are not to be notified for this incident.";
    } else if (
      createBy.data.shouldStatusPageSubscribersBeNotifiedOnIncidentCreated ===
      true
    ) {
      createBy.data.subscriberNotificationStatusOnIncidentCreated =
        StatusPageSubscriberNotificationStatus.Pending;
    }

    /*
     * Last, because the incident template copy above can still be adding
     * monitors and mapped custom fields are resolved from the final set.
     *
     * In onBeforeCreate rather than onCreateSuccess because `customFields` is
     * a column on this row and the onCreateSuccess chain is un-awaited — a
     * value written there would be missing from the incident the caller gets
     * back. Written not to throw: a custom field failing to inherit must not
     * stop an incident from being declared.
     */
    await CustomFieldMappingService.applyMappingsToCreate({
      definitionModelType: IncidentCustomField,
      createBy: createBy,
    });

    return {
      createBy,
      carryForward: carryForward,
    };
  }

  @CaptureSpan()
  protected override async onCreateSuccess(
    onCreate: OnCreate<Model>,
    createdItem: Model,
  ): Promise<Model> {
    // these should never be null.
    if (!createdItem.projectId) {
      throw new BadDataException("projectId is required");
    }

    if (!createdItem.id) {
      throw new BadDataException("id is required");
    }

    /*
     * Activation event for marketing funnels. Only fires for human-declared
     * incidents (captureForUser skips when there is no user).
     */
    ProductAnalytics.captureForUser({
      userId: onCreate.createBy.props.userId || createdItem.createdByUserId,
      event: "server/incident_created",
      properties: {
        project_id: createdItem.projectId.toString(),
      },
    });

    // Get incident data for feed creation
    const incident: Model | null = await this.findOneById({
      id: createdItem.id,
      select: {
        projectId: true,
        incidentNumber: true,
        incidentNumberWithPrefix: true,
        title: true,
        description: true,
        incidentSeverity: {
          name: true,
        },
        rootCause: true,
        createdByUserId: true,
        createdByUser: {
          _id: true,
          name: true,
          email: true,
        },
        remediationNotes: true,
        currentIncidentState: {
          name: true,
        },
        labels: {
          name: true,
        },
        /*
         * The resources named under "Resources Affected" are read by the feed
         * builder itself (LinkedAffectedResources), one relation at a time.
         */
        // The created feed item names the status pages a scoped incident is limited to.
        isScopedToStatusPages: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!incident) {
      throw new BadDataException("Incident not found");
    }

    /*
     * How far along the incident starts, as onBeforeCreate read it
     * (StartingStage). Declared already acknowledged, no on-call policy
     * runs. Declared resolved, it is over, and nothing below that answers a
     * live problem runs either: no channel, monitor status, paused
     * monitoring, runbook, grouping, SLA, AI investigation or remediation.
     * Its rules, its owners, its feed and its first state still happen.
     */
    const startingStage: StartingStage = StartingStageUtil.fromCarryForward(
      onCreate.carryForward,
    );
    const isOngoing: boolean = StartingStageUtil.isOngoing(startingStage);

    /*
     * Whether an AI investigation run was enqueued for this incident — set
     * by the investigation step below and read by the auto-remediation step
     * after it: an enqueued investigation DEFERS remediation until the run
     * settles (RCA-first ordering, see RemediationHandoff).
     */
    let aiInvestigationEnqueued: boolean = false;

    /*
     * Apply privacy rules BEFORE workspace operations so the workspace
     * channel is created with the correct privacy setting. This may set
     * createdItem.isPrivate=true in memory. Kept as its own promise (it never
     * rejects) so declaring from alerts can wait for it before linking: the
     * links' feed entries leave out a private incident's title, so they must
     * see the privacy the rules settle on.
     */
    const privacyRulesApplied: Promise<void> = Promise.resolve().then(
      async () => {
        try {
          await IncidentPrivacyRuleEngineService.applyRulesToIncident(
            createdItem,
          );
        } catch (error) {
          logger.error(
            `Apply incident privacy rules failed in IncidentService.onCreateSuccess: ${error}`,
            {
              projectId: createdItem.projectId?.toString(),
              incidentId: createdItem.id?.toString(),
            } as LogAttributes,
          );
        }
      },
    );

    // Execute operations sequentially with error handling
    privacyRulesApplied
      .then(async () => {
        /*
         * No channel is opened for an incident declared resolved. Its
         * created feed entry still goes to the channels the workspace rules
         * name.
         */
        try {
          if (createdItem.projectId && createdItem.id && isOngoing) {
            return await this.handleIncidentWorkspaceOperationsAsync(
              createdItem,
            );
          }
          return Promise.resolve();
        } catch (error) {
          logger.error(
            `Workspace operations failed in IncidentService.onCreateSuccess: ${error}`,
            {
              projectId: createdItem.projectId?.toString(),
              incidentId: createdItem.id?.toString(),
              userId: createdItem.createdByUserId?.toString(),
            } as LogAttributes,
          );
          return Promise.resolve();
        }
      })
      .then(async () => {
        try {
          return await this.createIncidentFeedAsync(incident);
        } catch (error) {
          logger.error(
            `Create incident feed failed in IncidentService.onCreateSuccess: ${error}`,
            {
              projectId: createdItem.projectId?.toString(),
              incidentId: createdItem.id?.toString(),
              userId: createdItem.createdByUserId?.toString(),
            } as LogAttributes,
          );
          return Promise.resolve();
        }
      })
      .then(async () => {
        /*
         * Declared from alerts: announce the alerts once, here - after
         * "Incident Created" and after the incident's Slack / Microsoft
         * Teams channels exist - rather than once per alert as each link is
         * written (see linkAlertsDeclaredWithIncident). Uses the validated
         * ids, so it does not wait for the links.
         */
        try {
          const alertIds: Array<ObjectID> =
            this.getAlertIdsDeclaredWith(onCreate);

          if (alertIds.length > 0) {
            await IncidentAlertService.createDeclaredFromAlertsFeedItem({
              projectId: createdItem.projectId!,
              incidentId: createdItem.id!,
              alertIds: alertIds,
              actorUserId: this.getDeclaringUserId(onCreate, createdItem),
            });
          }
        } catch (error) {
          logger.error(
            `Announcing the alerts an incident was declared from failed in IncidentService.onCreateSuccess: ${error}`,
            {
              projectId: createdItem.projectId?.toString(),
              incidentId: createdItem.id?.toString(),
            } as LogAttributes,
          );
        }
      })
      .then(async () => {
        /*
         * A private incident declared from alerts - private from the form or
         * made private by a privacy rule above - gets the alerts' owners as
         * its owners, so the people who could see the alerts can see the
         * incident. Here rather than before the request returns: the owners'
         * own hooks invite them to the incident's Slack / Microsoft Teams
         * channels, which exist only from the workspace step above, and their
         * "owner added" entries belong after "Incident Created".
         */
        try {
          const alertIds: Array<ObjectID> =
            this.getAlertIdsDeclaredWith(onCreate);

          if (alertIds.length > 0 && createdItem.isPrivate === true) {
            await IncidentAlertService.copyAlertOwnersToIncident({
              projectId: createdItem.projectId!,
              incidentId: createdItem.id!,
              alertIds: alertIds,
            });
          }
        } catch (error) {
          logger.error(
            `Adding the owners of the alerts a private incident was declared from failed in IncidentService.onCreateSuccess: ${error}`,
            {
              projectId: createdItem.projectId?.toString(),
              incidentId: createdItem.id?.toString(),
            } as LogAttributes,
          );
        }
      })
      .then(async () => {
        try {
          return await this.handleIncidentStateChangeAsync(
            createdItem,
            startingStage,
          );
        } catch (error) {
          logger.error(
            `Handle incident state change failed in IncidentService.onCreateSuccess: ${error}`,
            {
              projectId: createdItem.projectId?.toString(),
              incidentId: createdItem.id?.toString(),
              userId: createdItem.createdByUserId?.toString(),
            } as LogAttributes,
          );
          return Promise.resolve();
        }
      })
      .then(async () => {
        /*
         * Owners handed over with the create: a template's owners, from the
         * dashboard's Declare Incident page or from an incident form. Added
         * here - after the incident's Slack / Microsoft Teams channels
         * exist, which is when the owners' own hooks can invite them to
         * those channels, and after "Incident Created" - rather than by the
         * caller once the create returns, while this chain may still be
         * creating the channels.
         *
         * Whether they are notified is the caller's to say, but only an
         * internal (root) caller's: an incident form asks for its
         * template's owners to be notified - they are the people a report
         * through it is meant to reach. A user's request cannot: the
         * dashboard's declare has always added them quietly, and misc data
         * is whatever the request body says.
         */
        try {
          if (
            onCreate.createBy.miscDataProps &&
            (onCreate.createBy.miscDataProps["ownerTeams"] ||
              onCreate.createBy.miscDataProps["ownerUsers"])
          ) {
            const notifyOwners: boolean =
              onCreate.createBy.props.isRoot === true &&
              onCreate.createBy.miscDataProps["notifyOwners"] === true;

            return await this.addOwners(
              createdItem.projectId!,
              createdItem.id!,
              (onCreate.createBy.miscDataProps[
                "ownerUsers"
              ] as Array<ObjectID>) || [],
              (onCreate.createBy.miscDataProps[
                "ownerTeams"
              ] as Array<ObjectID>) || [],
              notifyOwners,
              onCreate.createBy.props,
            );
          }
          return Promise.resolve();
        } catch (error) {
          logger.error(
            `Add owners failed in IncidentService.onCreateSuccess: ${error}`,
            {
              projectId: createdItem.projectId?.toString(),
              incidentId: createdItem.id?.toString(),
              userId: createdItem.createdByUserId?.toString(),
            } as LogAttributes,
          );
          return Promise.resolve();
        } finally {
          /*
           * The owners the create handed over exist now - or could not be
           * added, and this chain will not try again: either way the
           * "Incident Created" notification held for them may go out.
           */
          if (this.isCreatedNotificationHeldForOwners(onCreate.createBy)) {
            await this.releaseCreatedNotificationHeldForOwners(createdItem);
          }
        }
      })
      .then(async () => {
        /*
         * An incident declared resolved leaves its monitors' status alone:
         * only resolving puts them back, and it is resolved already, so
         * nothing ever would. In turn its first state - resolved - gives
         * them nothing back (handleIncidentStateChangeAsync), so a status a
         * monitor holds for another reason stays.
         */
        try {
          if (
            createdItem.changeMonitorStatusToId &&
            createdItem.projectId &&
            isOngoing
          ) {
            return await this.handleMonitorStatusChangeAsync(
              createdItem,
              onCreate,
            );
          }
          return Promise.resolve();
        } catch (error) {
          logger.error(
            `Monitor status change failed in IncidentService.onCreateSuccess: ${error}`,
            {
              projectId: createdItem.projectId?.toString(),
              incidentId: createdItem.id?.toString(),
              userId: createdItem.createdByUserId?.toString(),
            } as LogAttributes,
          );
          return Promise.resolve();
        }
      })
      .then(async () => {
        /*
         * Nor does it pause their monitoring: nothing would ever resume it,
         * since only resolving the incident does.
         */
        if (!isOngoing) {
          return Promise.resolve();
        }

        try {
          return await this.disableActiveMonitoringIfManualIncident(
            createdItem.id!,
          );
        } catch (error) {
          logger.error(
            `Disable active monitoring failed in IncidentService.onCreateSuccess: ${error}`,
            {
              projectId: createdItem.projectId?.toString(),
              incidentId: createdItem.id?.toString(),
              userId: createdItem.createdByUserId?.toString(),
            } as LogAttributes,
          );
          return Promise.resolve();
        }
      })
      .then(async () => {
        // Apply owner rules: add matched owner users/teams to the incident.
        try {
          await IncidentOwnerRuleEngineService.applyRulesToIncident(
            createdItem,
          );
        } catch (error) {
          logger.error(
            `Apply incident owner rules failed in IncidentService.onCreateSuccess: ${error}`,
            {
              projectId: createdItem.projectId?.toString(),
              incidentId: createdItem.id?.toString(),
            } as LogAttributes,
          );
        }
      })
      .then(async () => {
        /*
         * Apply label rules: attach matched labels (and optionally inherited
         * monitor / host labels) to the incident. Runs before the on-call
         * fan-out so notifications can include the inherited labels.
         */
        try {
          await IncidentLabelRuleEngineService.applyRulesToIncident(
            createdItem,
          );
        } catch (error) {
          logger.error(
            `Apply incident label rules failed in IncidentService.onCreateSuccess: ${error}`,
            {
              projectId: createdItem.projectId?.toString(),
              incidentId: createdItem.id?.toString(),
            } as LogAttributes,
          );
        }
      })
      .then(async () => {
        /*
         * Apply on-call rules: match incident against IncidentOnCallRule rows
         * and merge their on-call policies into createdItem.onCallDutyPolicies
         * before the fan-out below picks up the merged list.
         */
        try {
          await IncidentOnCallRuleEngineService.applyRulesToIncident(
            createdItem,
          );
        } catch (error) {
          logger.error(
            `Apply incident on-call rules failed in IncidentService.onCreateSuccess: ${error}`,
            {
              projectId: createdItem.projectId?.toString(),
              incidentId: createdItem.id?.toString(),
            } as LogAttributes,
          );
        }
      })
      .then(async () => {
        // No runbook is started for an incident declared resolved.
        if (!isOngoing) {
          return;
        }

        try {
          await RunbookRuleEngineService.applyRulesToIncident(createdItem);
        } catch (error) {
          logger.error(
            `Apply runbook rules failed in IncidentService.onCreateSuccess: ${error}`,
            {
              projectId: createdItem.projectId?.toString(),
              incidentId: createdItem.id?.toString(),
            } as LogAttributes,
          );
        }
      })
      .then(async () => {
        try {
          if (
            createdItem.onCallDutyPolicies?.length &&
            createdItem.onCallDutyPolicies?.length > 0
          ) {
            return await this.executeOnCallDutyPoliciesAsync(
              createdItem,
              startingStage,
            );
          }
          return Promise.resolve();
        } catch (error) {
          logger.error(
            `On-call duty policy execution failed in IncidentService.onCreateSuccess: ${error}`,
            {
              projectId: createdItem.projectId?.toString(),
              incidentId: createdItem.id?.toString(),
              userId: createdItem.createdByUserId?.toString(),
            } as LogAttributes,
          );
          return Promise.resolve();
        }
      })
      .then(async () => {
        /*
         * Process incident for grouping into episodes - unless it was
         * declared resolved: it is over. One declared already acknowledged
         * may join an episode that is open, but never opens or reopens one
         * (GroupingOptions): a new episode runs its own on-call policies, and
         * would page for the incident after all.
         */
        if (!isOngoing) {
          return;
        }

        try {
          await IncidentGroupingEngineService.processIncident(createdItem, {
            mayOpenEpisode: StartingStageUtil.pagesOnCall(startingStage),
          });
        } catch (error) {
          logger.error(
            `Incident grouping failed in IncidentService.onCreateSuccess: ${error}`,
            {
              projectId: createdItem.projectId?.toString(),
              incidentId: createdItem.id?.toString(),
              userId: createdItem.createdByUserId?.toString(),
            } as LogAttributes,
          );
        }
      })
      .then(async () => {
        /*
         * Create SLA record for incident if a matching rule exists. An
         * incident declared resolved has nothing left to respond to or
         * resolve in time: it starts none. One declared acknowledged was
         * responded to when it was declared, so its response deadline cannot
         * be missed for it.
         */
        if (!isOngoing) {
          return;
        }

        try {
          if (
            createdItem.projectId &&
            createdItem.id &&
            createdItem.declaredAt
          ) {
            await IncidentSlaService.createSlaForIncident({
              incidentId: createdItem.id,
              projectId: createdItem.projectId,
              declaredAt: createdItem.declaredAt,
              ...(startingStage === StartingStage.Acknowledged
                ? { respondedAt: createdItem.declaredAt }
                : {}),
            });
          }
        } catch (error) {
          logger.error(
            `SLA creation failed in IncidentService.onCreateSuccess: ${error}`,
            {
              projectId: createdItem.projectId?.toString(),
              incidentId: createdItem.id?.toString(),
              userId: createdItem.createdByUserId?.toString(),
            } as LogAttributes,
          );
        }
      })
      .then(async () => {
        // Schedule reminder notifications for incident if a matching reminder rule exists
        try {
          if (createdItem.projectId && createdItem.id) {
            await this.refreshReminderSchedule({
              incidentId: createdItem.id,
              projectId: createdItem.projectId,
            });
          }
        } catch (error) {
          logger.error(
            `Reminder scheduling failed in IncidentService.onCreateSuccess: ${error}`,
            {
              projectId: createdItem.projectId?.toString(),
              incidentId: createdItem.id?.toString(),
              userId: createdItem.createdByUserId?.toString(),
            } as LogAttributes,
          );
        }
      })
      .then(async () => {
        /*
         * AI (AI SRE): automatically investigate the new incident and post
         * a cited root cause analysis to the incident timeline + Slack/Teams.
         * Runs last so the workspace channels already exist, and is gated per
         * project (opt-in) + requires a configured LLM provider. Read-only.
         */
        try {
          if (createdItem.projectId && createdItem.id) {
            /*
             * An incident declared resolved was over before it was declared:
             * nothing to investigate. The runner records why on its AI card -
             * after what stops OneUptime AI for the whole project, such as AI
             * being off, which the card then names instead.
             */
            aiInvestigationEnqueued =
              await AIIncidentInvestigationRunner.investigateNewIncident({
                incidentId: createdItem.id,
                projectId: createdItem.projectId,
                createdResolved: !isOngoing,
              });
          }
        } catch (error) {
          logger.error(
            `AI incident investigation failed in IncidentService.onCreateSuccess: ${error}`,
            {
              projectId: createdItem.projectId?.toString(),
              incidentId: createdItem.id?.toString(),
            } as LogAttributes,
          );
        }
      })
      .then(async () => {
        /*
         * Auto-remediation runs LAST — and only when NO AI investigation
         * was enqueued above. RCA-first ordering: when an investigation is
         * in flight, remediation is deferred until that run settles
         * (RemediationHandoff releases it on any terminal outcome), so the
         * remediation planner always has the posted root cause analysis as
         * input instead of racing it. Without an investigation (opt-out,
         * gates, budget) remediation fires here immediately — it must
         * never silently depend on the AI lane being enabled. Deferred, the
         * Remediation card says it waits for the analysis
         * (AutoRemediationRuleEngineService.onIncidentCreated/onAlertCreated).
         */
        // Nothing is left to remediate for an incident declared resolved.
        if (!isOngoing) {
          return;
        }

        try {
          await AutoRemediationRuleEngineService.onIncidentCreated({
            incident: createdItem,
            isInvestigationQueued: aiInvestigationEnqueued,
          });
        } catch (error) {
          logger.error(
            `Apply auto-remediation rules failed in IncidentService.onCreateSuccess: ${error}`,
            {
              projectId: createdItem.projectId?.toString(),
              incidentId: createdItem.id?.toString(),
            } as LogAttributes,
          );
        }
      })
      .catch((error: Error) => {
        logger.error(
          `Critical error in IncidentService sequential operations: ${error}`,
          {
            projectId: createdItem.projectId?.toString(),
            incidentId: createdItem.id?.toString(),
            userId: createdItem.createdByUserId?.toString(),
          } as LogAttributes,
        );
      });

    await this.linkAlertsDeclaredWithIncident(
      onCreate,
      createdItem,
      privacyRulesApplied,
    );

    return createdItem;
  }

  // The validated alert ids an incident is being declared from, if any.
  private getAlertIdsDeclaredWith(onCreate: OnCreate<Model>): Array<ObjectID> {
    const carryForward: IncidentCreateCarryForward =
      (onCreate.carryForward as IncidentCreateCarryForward) || null;

    return carryForward?.alertIdsToLink || [];
  }

  /*
   * The alerts the declaration asked to acknowledge that were not
   * acknowledged yet when it was checked - the only ones the caller was
   * authorized for, so the only ones that may be written.
   */
  private getAlertIdsToAcknowledgeDeclaredWith(
    onCreate: OnCreate<Model>,
  ): Array<ObjectID> {
    const carryForward: IncidentCreateCarryForward =
      (onCreate.carryForward as IncidentCreateCarryForward) || null;

    if (!carryForward?.acknowledgedAlertStateId) {
      return [];
    }

    return carryForward.alertIdsToAcknowledge || [];
  }

  /*
   * Who declared the incident, as "Linked by" on the links and the actor of
   * their feed entries: the incident's creator, as DatabaseService decided
   * it (UserAttribution). A user is recorded as themselves and an API key or
   * a workflow as nobody; only OneUptime's own server code names a creator
   * itself.
   */
  private getDeclaringUserId(
    onCreate: OnCreate<Model>,
    createdItem: Model,
  ): ObjectID | undefined {
    if (onCreate.createBy.props.isRoot) {
      return createdItem.createdByUserId || undefined;
    }

    return onCreate.createBy.props.userId || undefined;
  }

  /*
   * The incident was declared from alerts (see onBeforeCreate): link them now
   * that it exists. Awaited, unlike the chain above, so the incident page the
   * user lands on already lists its alerts. Written as root because the
   * caller's right to link them was checked before the incident was created;
   * the user who declared the incident is recorded as the one who linked
   * them. The links write no incident-side feed entries: the chain above
   * posts one "Declared from N alerts" entry instead. A link that fails is
   * logged and never fails the incident.
   *
   * The privacy rules run first: each link's entry on its alert leaves out
   * the incident's title when the incident is private, and a rule can make
   * it private after it was saved. (The alerts' owners are added to a private
   * incident later in the chain, once its workspace channels exist.)
   *
   * When the declaration asked for it, the alerts are then acknowledged as
   * the declaring user, which stops their on-call escalation at the
   * workers' next run. That is not waited for: each acknowledgement is a
   * full state change (feed entry, Slack / Microsoft Teams post, owner
   * notification), up to one per alert, and the page the user lands on does
   * not show the alerts' states. It never fails the incident.
   */
  @CaptureSpan()
  private async linkAlertsDeclaredWithIncident(
    onCreate: OnCreate<Model>,
    createdItem: Model,
    privacyRulesApplied: Promise<void>,
  ): Promise<void> {
    const alertIds: Array<ObjectID> = this.getAlertIdsDeclaredWith(onCreate);

    if (alertIds.length === 0 || !createdItem.projectId || !createdItem.id) {
      return;
    }

    await privacyRulesApplied;

    let linkedAlertIds: Array<ObjectID> = [];

    try {
      const result: LinkAlertsToIncidentResult =
        await IncidentAlertService.linkAlertsToIncident({
          projectId: createdItem.projectId,
          incidentId: createdItem.id,
          alertIds: alertIds,
          createdByUserId: this.getDeclaringUserId(onCreate, createdItem),
          declaredWithIncident: true,
          props: {
            isRoot: true,
          },
        });

      linkedAlertIds = [
        ...result.linkedAlertIds,
        ...result.alreadyLinkedAlertIds,
      ];

      if (result.failed.length > 0) {
        logger.error(
          `${result.failed.length} of ${alertIds.length} alerts could not be linked to the incident they were declared with.`,
          {
            projectId: createdItem.projectId.toString(),
            incidentId: createdItem.id.toString(),
          } as LogAttributes,
        );
      }
    } catch (error) {
      logger.error(
        `Linking the alerts an incident was declared from failed in IncidentService.onCreateSuccess: ${error}`,
        {
          projectId: createdItem.projectId.toString(),
          incidentId: createdItem.id.toString(),
        } as LogAttributes,
      );
    }

    const alertIdsToAcknowledge: Array<ObjectID> =
      this.getAlertIdsToAcknowledgeDeclaredWith(onCreate);

    if (alertIdsToAcknowledge.length === 0) {
      return;
    }

    const projectId: ObjectID = createdItem.projectId;
    const incidentId: ObjectID = createdItem.id;

    IncidentAlertService.acknowledgeAlertsDeclaredWithIncident({
      projectId: projectId,
      incidentId: incidentId,
      alertIds: alertIdsToAcknowledge,
      linkedAlertIds: linkedAlertIds,
      acknowledgedByUserId: this.getDeclaringUserId(onCreate, createdItem),
    })
      .then((acknowledged: AcknowledgeDeclaredAlertsResult) => {
        if (acknowledged.failed.length > 0) {
          logger.error(
            `${acknowledged.failed.length} of ${alertIdsToAcknowledge.length} alerts could not be acknowledged when the incident was declared from them.`,
            {
              projectId: projectId.toString(),
              incidentId: incidentId.toString(),
            } as LogAttributes,
          );
        }
      })
      .catch((error: Error) => {
        logger.error(
          `Acknowledging the alerts an incident was declared from failed in IncidentService.onCreateSuccess: ${error}`,
          {
            projectId: projectId.toString(),
            incidentId: incidentId.toString(),
          } as LogAttributes,
        );
      });
  }

  /*
   * Whether a create hands owners to its own onCreateSuccess chain to be
   * notified, and so holds the incident's "Incident Created" notification
   * until the chain has added them (see onBeforeCreate). Only an internal
   * (root) caller can ask for owners to be notified - misc data is whatever
   * a user's request body says - and today only an incident form does, for
   * its template's owners. Every other create is written and notified as it
   * always was. One predicate for the hold and the release alike, so the
   * chain never releases an incident nobody held: the job may already have
   * notified that one, and would do it again.
   */
  private isCreatedNotificationHeldForOwners(
    createBy: CreateBy<Model>,
  ): boolean {
    const miscDataProps: JSONObject | undefined = createBy.miscDataProps;

    return (
      createBy.props.isRoot === true &&
      miscDataProps?.["notifyOwners"] === true &&
      Boolean(miscDataProps["ownerUsers"] || miscDataProps["ownerTeams"])
    );
  }

  /*
   * Marks an incident whose create held its "Incident Created" notification
   * as not notified, so the owners' job sends it on its next run - to the
   * owners the chain has just added. Without the update hooks, as the other
   * notification markers on an incident are written: nothing they react to
   * changed. It never throws, so the chain's later steps (the owner rules,
   * on-call) still run; a failure is logged, and leaves the notification
   * unsent.
   */
  private async releaseCreatedNotificationHeldForOwners(
    incident: Model,
  ): Promise<void> {
    try {
      await this.updateOneById({
        id: incident.id!,
        data: {
          isOwnerNotifiedOfResourceCreation: false,
        },
        props: {
          isRoot: true,
          ignoreHooks: true,
        },
      });
    } catch (error) {
      logger.error(
        `Releasing the Incident Created notification held for the owners failed in IncidentService.onCreateSuccess: ${error}`,
        {
          projectId: incident.projectId?.toString(),
          incidentId: incident.id?.toString(),
        } as LogAttributes,
      );
    }
  }

  @CaptureSpan()
  private async handleIncidentWorkspaceOperationsAsync(
    createdItem: Model,
  ): Promise<void> {
    try {
      if (!createdItem.projectId || !createdItem.id) {
        throw new BadDataException(
          "projectId and id are required for workspace operations",
        );
      }

      // send message to workspaces - slack, teams, etc.
      const workspaceResult: {
        channelsCreated: Array<NotificationRuleWorkspaceChannel>;
      } | null =
        await IncidentWorkspaceMessages.createChannelsAndInviteUsersToChannels({
          projectId: createdItem.projectId,
          incidentId: createdItem.id,
          incidentNumber: createdItem.incidentNumber!,
          ...(createdItem.incidentNumberWithPrefix
            ? {
                incidentNumberWithPrefix: createdItem.incidentNumberWithPrefix,
              }
            : {}),
          isPrivate: createdItem.isPrivate === true,
        });

      if (workspaceResult && workspaceResult.channelsCreated?.length > 0) {
        // update incident with these channels.
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
      logger.error(
        `Error in handleIncidentWorkspaceOperationsAsync: ${error}`,
        {
          projectId: createdItem.projectId?.toString(),
          incidentId: createdItem.id?.toString(),
        } as LogAttributes,
      );
      throw error;
    }
  }

  /*
   * The status pages a scoped incident is limited to, as a Markdown list for
   * its created feed item. Read on their own rather than in onCreateSuccess's
   * select: a find that selects several many-to-many lists returns a row for
   * every combination of them.
   */
  private async getScopedStatusPagesMarkdown(incident: Model): Promise<string> {
    const incidentWithStatusPages: Model | null = await this.findOneById({
      id: incident.id!,
      select: {
        statusPages: {
          _id: true,
          name: true,
        },
      },
      props: {
        isRoot: true,
      },
    });

    const statusPages: Array<StatusPage> =
      incidentWithStatusPages?.statusPages || [];

    if (statusPages.length === 0) {
      // Scoped to pages that have all been deleted since: hidden everywhere.
      return `- None: the status pages it was limited to have been deleted, so it is not shown on any status page.\n`;
    }

    let markdown: string = "";

    for (const statusPage of statusPages) {
      // A page name is free text: kept from turning into a link or an image.
      markdown += `- [${escapeMarkdownInline(statusPage.name || "Untitled status page")}](${(await StatusPageService.getStatusPageLinkInDashboard(incident.projectId!, statusPage.id!)).toString()})\n`;
    }

    return markdown;
  }

  @CaptureSpan()
  private async createIncidentFeedAsync(incident: Model): Promise<void> {
    try {
      const createdByUserId: ObjectID | undefined | null =
        incident.createdByUserId || incident.createdByUser?.id;

      const incidentNumberDisplay: string =
        incident.incidentNumberWithPrefix ||
        "#" + incident.incidentNumber?.toString();

      /*
       * The title is plain text - one line, typed by whoever declared the
       * incident, which is anyone holding an incident form's link - placed
       * into Markdown that is rendered without the viewer's safe mode and
       * posted to Slack and Teams. Escaped as MarkdownEscape says a title
       * must be, so "[Reset your password](...)" arrives as those
       * characters, "![](https://tracker...)" is not fetched and "<!here>"
       * is not a mention, while "Site 03 - payments (EU)" reads unchanged.
       * The description stays Markdown: that is what it is written in.
       */
      let feedInfoInMarkdown: string = `#### 🚨 Incident ${incidentNumberDisplay} Created:
        
**${escapeMarkdownValue(incident.title || "No title provided.")}**:

${incident.description || "No description provided."}

`;

      if (incident.currentIncidentState?.name) {
        feedInfoInMarkdown += `🔴 **Incident State**: ${incident.currentIncidentState.name} \n\n`;
      }

      if (incident.incidentSeverity?.name) {
        feedInfoInMarkdown += `⚠️ **Severity**: ${incident.incidentSeverity.name} \n\n`;
      }

      /*
       * Everything the incident's Affected Resources card lists: monitors,
       * the hosts, clusters and services it is attached to, then its SLOs. A
       * burn-rate incident carries no monitors on purpose, so its SLO is the
       * only resource there is to name - and the feed's only way back to the
       * objective that declared it.
       */
      const resources: Array<LinkedAffectedResource> =
        await LinkedAffectedResources.readForIncident({
          service: this,
          projectId: incident.projectId!,
          incidentId: incident.id!,
        });

      if (resources.length > 0) {
        feedInfoInMarkdown += `🌎 **Resources Affected**:\n`;

        for (const resourceLine of LinkedAffectedResources.getMarkdownLines({
          dashboardUrl: await DatabaseConfig.getDashboardUrl(),
          projectId: incident.projectId!,
          resources: resources,
        })) {
          feedInfoInMarkdown += `${resourceLine}\n`;
        }

        feedInfoInMarkdown += `\n\n`;
      }

      if (incident.isScopedToStatusPages) {
        feedInfoInMarkdown += `📣 **Limited to Status Pages**:\n`;
        feedInfoInMarkdown += await this.getScopedStatusPagesMarkdown(incident);
        feedInfoInMarkdown += `\n\n`;
      }

      if (incident.rootCause) {
        feedInfoInMarkdown += `\n
📄 **Root Cause**:

${incident.rootCause || "No root cause provided."}

`;
      }

      if (incident.remediationNotes) {
        feedInfoInMarkdown += `\n 
🎯 **Remediation Notes**:

${incident.remediationNotes || "No remediation notes provided."}


`;
      }

      const incidentCreateMessageBlocks: Array<MessageBlocksByWorkspaceType> =
        await IncidentWorkspaceMessages.getIncidentCreateMessageBlocks({
          incidentId: incident.id!,
          projectId: incident.projectId!,
        });

      await IncidentFeedService.createIncidentFeedItem({
        incidentId: incident.id!,
        projectId: incident.projectId!,
        incidentFeedEventType: IncidentFeedEventType.IncidentCreated,
        displayColor: Red500,
        feedInfoInMarkdown: feedInfoInMarkdown,
        userId: createdByUserId || undefined,
        workspaceNotification: {
          appendMessageBlocks: incidentCreateMessageBlocks,
          sendWorkspaceNotification: true,
        },
      });
    } catch (error) {
      logger.error(`Error in createIncidentFeedAsync: ${error}`, {
        projectId: incident.projectId?.toString(),
        incidentId: incident.id?.toString(),
        userId: incident.createdByUserId?.toString(),
      } as LogAttributes);
      throw error;
    }
  }

  @CaptureSpan()
  private async handleIncidentStateChangeAsync(
    createdItem: Model,
    startingStage: StartingStage,
  ): Promise<void> {
    try {
      if (!createdItem.currentIncidentStateId) {
        throw new BadDataException("currentIncidentStateId is required");
      }

      if (!createdItem.projectId || !createdItem.id) {
        throw new BadDataException(
          "projectId and id are required for state change",
        );
      }

      await this.changeIncidentState({
        projectId: createdItem.projectId,
        incidentId: createdItem.id,
        incidentStateId: createdItem.currentIncidentStateId,
        shouldNotifyStatusPageSubscribers: Boolean(
          createdItem.shouldStatusPageSubscribersBeNotifiedOnIncidentCreated,
        ),
        isSubscribersNotified: Boolean(
          createdItem.shouldStatusPageSubscribersBeNotifiedOnIncidentCreated,
        ), // we dont want to notify subscribers when incident state changes because they are already notified when the incident is created.
        notifyOwners: false,
        rootCause: createdItem.rootCause,
        stateChangeLog: createdItem.createdStateLog,
        timelineStartsAt: createdItem.declaredAt,
        /*
         * Declared already resolved, the incident sets no status on its
         * monitors and pauses none of their monitoring (onCreateSuccess), so
         * its first state - resolved - has nothing of theirs to give back.
         */
        neverHeldItsMonitors: !StartingStageUtil.isOngoing(startingStage),
        props: {
          isRoot: true,
        },
      });
    } catch (error) {
      logger.error(`Error in handleIncidentStateChangeAsync: ${error}`, {
        projectId: createdItem.projectId?.toString(),
        incidentId: createdItem.id?.toString(),
      } as LogAttributes);
      throw error;
    }
  }

  /*
   * Runs the incident's on-call policies - the ones its create named,
   * inherited from a template, or added by its on-call rules - when it
   * starts open. Declared already acknowledged or resolved, somebody is on
   * it or it is over: none of them runs, and its feed says so instead,
   * naming them (OnCallNotRunOnCreate).
   */
  @CaptureSpan()
  private async executeOnCallDutyPoliciesAsync(
    createdItem: Model,
    startingStage: StartingStage,
  ): Promise<void> {
    try {
      if (
        createdItem.onCallDutyPolicies?.length &&
        createdItem.onCallDutyPolicies?.length > 0
      ) {
        if (!StartingStageUtil.pagesOnCall(startingStage)) {
          await OnCallNotRunOnCreate.createFeedItem({
            record: { incidentId: createdItem.id! },
            projectId: createdItem.projectId!,
            stage: startingStage,
            policies: createdItem.onCallDutyPolicies,
          });
          return;
        }

        // Execute all on-call policies in parallel
        const policyPromises: Promise<void>[] =
          createdItem.onCallDutyPolicies.map((policy: OnCallDutyPolicy) => {
            return OnCallDutyPolicyService.executePolicy(
              new ObjectID(policy["_id"] as string),
              {
                triggeredByIncidentId: createdItem.id!,
                userNotificationEventType:
                  UserNotificationEventType.IncidentCreated,
              },
            );
          });

        await Promise.allSettled(policyPromises);
      }
    } catch (error) {
      logger.error(`Error in executeOnCallDutyPoliciesAsync: ${error}`, {
        projectId: createdItem.projectId?.toString(),
        incidentId: createdItem.id?.toString(),
      } as LogAttributes);
      throw error;
    }
  }

  @CaptureSpan()
  private async handleMonitorStatusChangeAsync(
    createdItem: Model,
    onCreate: OnCreate<Model>,
  ): Promise<void> {
    try {
      if (createdItem.changeMonitorStatusToId && createdItem.projectId) {
        // change status of all the monitors.
        await MonitorService.changeMonitorStatus(
          createdItem.projectId,
          createdItem.monitors?.map((monitor: Monitor) => {
            return new ObjectID(monitor._id || "");
          }) || [],
          createdItem.changeMonitorStatusToId,
          true, // notifyMonitorOwners
          createdItem.rootCause ||
            "Status was changed because Incident " +
              (createdItem.incidentNumberWithPrefix ||
                "#" + createdItem.incidentNumber?.toString()) +
              " was created.",
          createdItem.createdStateLog,
          onCreate.createBy.props,
          createdItem.declaredAt || undefined,
        );
      }
    } catch (error) {
      logger.error(`Error in handleMonitorStatusChangeAsync: ${error}`, {
        projectId: createdItem.projectId?.toString(),
        incidentId: createdItem.id?.toString(),
      } as LogAttributes);
      throw error;
    }
  }

  @CaptureSpan()
  public async disableActiveMonitoringIfManualIncident(
    incidentId: ObjectID,
  ): Promise<void> {
    const incident: Model | null = await this.findOneById({
      id: incidentId,
      select: {
        monitors: {
          _id: true,
        },
        isCreatedAutomatically: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!incident) {
      throw new BadDataException("Incident not found");
    }

    if (!incident.isCreatedAutomatically) {
      const monitors: Array<Monitor> = incident.monitors || [];

      for (const monitor of monitors) {
        await MonitorService.updateOneById({
          id: monitor.id!,
          data: {
            disableActiveMonitoringBecauseOfManualIncident: true,
          },
          props: {
            isRoot: true,
          },
        });
      }
    }
  }

  @CaptureSpan()
  public async getIncidentIdentifiedDate(incidentId: ObjectID): Promise<Date> {
    const timeline: IncidentStateTimeline | null =
      await IncidentStateTimelineService.findOneBy({
        query: {
          incidentId: incidentId,
        },
        select: {
          startsAt: true,
        },
        sort: {
          startsAt: SortOrder.Ascending,
        },
        props: {
          isRoot: true,
        },
      });

    if (timeline && timeline.startsAt) {
      return timeline.startsAt;
    }

    /*
     * The identified-state timeline is created asynchronously after the
     * incident is committed (see onCreateSuccess), so it may not exist yet, or
     * may be missing entirely if that step failed. Fall back to the incident's
     * creation date instead of throwing, otherwise the owner-notification cron
     * fails permanently for this incident and retries every minute forever.
     */
    const incident: Model | null = await this.findOneById({
      id: incidentId,
      select: {
        createdAt: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (incident && incident.createdAt) {
      return incident.createdAt;
    }

    throw new BadDataException("Incident identified date not found.");
  }

  @CaptureSpan()
  public async findOwners(incidentId: ObjectID): Promise<Array<User>> {
    if (!incidentId) {
      throw new BadDataException("incidentId is required");
    }

    const ownerUsers: Array<IncidentOwnerUser> =
      await IncidentOwnerUserService.findBy({
        query: {
          incidentId: incidentId,
        },
        select: {
          _id: true,
          projectId: true,
          user: {
            _id: true,
            email: true,
            name: true,
            timezone: true,
          },
        },
        props: {
          isRoot: true,
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
      });

    const ownerTeams: Array<IncidentOwnerTeam> =
      await IncidentOwnerTeamService.findBy({
        query: {
          incidentId: incidentId,
        },
        select: {
          _id: true,
          projectId: true,
          teamId: true,
        },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        props: {
          isRoot: true,
        },
      });

    const users: Array<User> =
      ownerUsers.map((ownerUser: IncidentOwnerUser) => {
        return ownerUser.user!;
      }) || [];

    if (ownerTeams.length > 0) {
      const teamIds: Array<ObjectID> =
        ownerTeams.map((ownerTeam: IncidentOwnerTeam) => {
          return ownerTeam.teamId!;
        }) || [];

      const teamUsers: Array<User> =
        await TeamMemberService.getUsersInTeams(teamIds);

      for (const teamUser of teamUsers) {
        //check if the user is already added.
        const isUserAlreadyAdded: User | undefined = users.find(
          (user: User) => {
            return user.id!.toString() === teamUser.id!.toString();
          },
        );

        if (!isUserAlreadyAdded) {
          users.push(teamUser);
        }
      }
    }

    const projectId: ObjectID | undefined =
      ownerUsers[0]?.projectId || ownerTeams[0]?.projectId;

    if (!projectId) {
      return [];
    }

    // Owners who left the project are not notified, nor listed as notified.
    return await TeamMemberService.filterUsersToProjectMembers({
      projectId: projectId,
      users: users,
    });
  }

  @CaptureSpan()
  public async addOwners(
    projectId: ObjectID,
    incidentId: ObjectID,
    userIds: Array<ObjectID>,
    teamIds: Array<ObjectID>,
    notifyOwners: boolean,
    props: DatabaseCommonInteractionProps,
  ): Promise<void> {
    // Owners already on the incident are skipped, not added a second time.
    await OwnerRuleAssignment.addOwners({
      ownerUserService: IncidentOwnerUserService,
      ownerTeamService: IncidentOwnerTeamService,
      resourceIdColumn: "incidentId",
      resourceId: incidentId,
      projectId: projectId,
      userIds: userIds,
      teamIds: teamIds,
      isOwnerNotified: !notifyOwners,
      props: props,
    });
  }

  @CaptureSpan()
  public async getIncidentLinkInDashboard(
    projectId: ObjectID,
    incidentId: ObjectID,
  ): Promise<URL> {
    const dashboardUrl: URL = await DatabaseConfig.getDashboardUrl();

    return URL.fromString(dashboardUrl.toString()).addRoute(
      `/${projectId.toString()}/incidents/${incidentId.toString()}`,
    );
  }

  /*
   * What an update that writes the postmortem's note or its Publish on
   * Status Page switch does to one incident, compared with the postmortem as
   * it was before the write (recordStoredValuesBeforeUpdate; see
   * IncidentPostmortemPublication):
   *
   * - a note that reads differently is recorded in the incident feed, and
   *   its Slack and Microsoft Teams channels, once: "Postmortem Note
   *   updated", or "cleared" when it was emptied. Writing back the note the
   *   incident holds - every save of the Edit Postmortem form does - records
   *   nothing;
   * - an update that publishes the postmortem - the status page did not show
   *   it, and does now - queues its subscriber notification
   *   (getNotificationAction). Saving it again, editing it while it is
   *   published and taking it off the status page queue nothing; publishing
   *   it again after that does.
   *
   * Called once the update is written, and after the note's inline images
   * were made public, so the notification never links to images the status
   * page cannot show yet.
   */
  private async applyPostmortemUpdate(data: {
    incidentId: ObjectID;
    projectId: ObjectID;
    incidentLabel: string;
    incidentLink: URL;
    userId: ObjectID | undefined;
    written: Record<string, unknown>;
    postmortemBeforeUpdate: IncidentPostmortemStoredState | undefined;
  }): Promise<void> {
    const comparison: {
      stored: IncidentPostmortemStoredState | undefined;
      written: Record<string, unknown>;
    } = {
      stored: data.postmortemBeforeUpdate,
      written: data.written,
    };

    if (IncidentPostmortemPublication.isNoteChanged(comparison)) {
      const noteValue: string =
        typeof data.written["postmortemNote"] === "string"
          ? data.written["postmortemNote"]
          : "";

      const postmortemFeedMarkdown: string =
        IncidentPostmortemPublication.hasNote(noteValue)
          ? `**📘 Postmortem Note updated for [${data.incidentLabel}](${data.incidentLink.toString()})**\n\n${noteValue}`
          : `**📘 Postmortem Note cleared for [${data.incidentLabel}](${data.incidentLink.toString()})**\n\n_No postmortem note provided._`;

      await IncidentFeedService.createIncidentFeedItem({
        incidentId: data.incidentId,
        projectId: data.projectId,
        incidentFeedEventType: IncidentFeedEventType.PostmortemNote,
        displayColor: Blue500,
        feedInfoInMarkdown: postmortemFeedMarkdown,
        userId: data.userId,
        workspaceNotification: {
          sendWorkspaceNotification: true,
        },
      });
    }

    const action: PostmortemNotificationAction =
      IncidentPostmortemPublication.getNotificationAction(comparison);

    if (action === PostmortemNotificationAction.Queue) {
      await this.queuePostmortemNotification({
        incidentId: data.incidentId,
        postmortemBeforeUpdate: data.postmortemBeforeUpdate,
      });
    }

    if (action === PostmortemNotificationAction.QueueIfSkippedMeanwhile) {
      /*
       * It was on its way when the update read it. The run holding it may
       * have read the postmortem before this update published it, and so
       * skip it as not shown: looked at again now that the update is
       * written, a notification skipped in the meantime is queued again.
       */
      const current: PostmortemNotificationStatusRead | null =
        await this.readPostmortemNotificationStatus(data.incidentId);

      if (
        current &&
        current.status === StatusPageSubscriberNotificationStatus.Skipped
      ) {
        await this.setPostmortemNotificationPending({
          incidentId: data.incidentId,
          expectedStatus: current.status,
        });
      }
    }
  }

  /*
   * Queues the postmortem's subscriber notification from where it stood
   * before the update. An incident the read before the write did not see
   * has no such record, so where it stands now is read instead, and a
   * notification on its way already is left to go.
   */
  private async queuePostmortemNotification(data: {
    incidentId: ObjectID;
    postmortemBeforeUpdate: IncidentPostmortemStoredState | undefined;
  }): Promise<void> {
    if (data.postmortemBeforeUpdate) {
      await this.setPostmortemNotificationPending({
        incidentId: data.incidentId,
        expectedStatus:
          data.postmortemBeforeUpdate
            .subscriberNotificationStatusOnPostmortemPublished ?? null,
      });
      return;
    }

    const current: PostmortemNotificationStatusRead | null =
      await this.readPostmortemNotificationStatus(data.incidentId);

    if (!current || IncidentPostmortemPublication.isOnItsWay(current.status)) {
      return;
    }

    await this.setPostmortemNotificationPending({
      incidentId: data.incidentId,
      expectedStatus: current.status,
    });
  }

  // Where the postmortem's subscriber notification stands; null when the incident is gone.
  private async readPostmortemNotificationStatus(
    incidentId: ObjectID,
  ): Promise<PostmortemNotificationStatusRead | null> {
    const incident: Model | null = await this.findOneById({
      id: incidentId,
      select: {
        subscriberNotificationStatusOnPostmortemPublished: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!incident) {
      return null;
    }

    return {
      status:
        incident.subscriberNotificationStatusOnPostmortemPublished ?? null,
    };
  }

  /*
   * Puts the postmortem's subscriber notification back to Pending, with a
   * message saying why, for Incident:SendPostmortemNotificationToSubscribers
   * to send it - only while it still stands at `expectedStatus`, so a
   * notification someone else queued again, or a job claimed, in the
   * meantime is left to them. A hook-free write of those two columns, like
   * the job's own claim (SubscriberNotificationClaim).
   */
  private async setPostmortemNotificationPending(data: {
    incidentId: ObjectID;
    expectedStatus: StatusPageSubscriberNotificationStatus | null;
  }): Promise<void> {
    const isQueued: boolean = await this.compareAndSetColumnsByIdWithoutHooks({
      id: data.incidentId,
      data: {
        subscriberNotificationStatusOnPostmortemPublished:
          StatusPageSubscriberNotificationStatus.Pending,
        subscriberNotificationStatusMessageOnPostmortemPublished:
          IncidentPostmortemPublication.queuedMessage,
      },
      // A null status is matched as null (IS NOT DISTINCT FROM).
      expectedData: {
        subscriberNotificationStatusOnPostmortemPublished: data.expectedStatus,
      } as unknown as PartialEntity<Model>,
    });

    if (!isQueued) {
      logger.debug(
        `Not queueing incident ${data.incidentId.toString()}'s postmortem notification: it changed since the update read it.`,
      );
    }
  }

  @CaptureSpan()
  protected override async onUpdateSuccess(
    onUpdate: OnUpdate<Model>,
    updatedItemIds: ObjectID[],
  ): Promise<OnUpdate<Model>> {
    CustomFieldMappingService.restampAfterMultiRowUpdate({
      definitionModelType: IncidentCustomField,
      updateBy: onUpdate.updateBy,
      updatedItemIds: updatedItemIds,
    });

    /*
     * Correcting a timestamp is the whole point of making these fields
     * editable, so the numbers derived from them have to move. Without this
     * the metric refresh fires only from the three state-timeline hooks, and
     * a corrected declaredAt leaves every derived value stale for good.
     */
    const anchorTimestampChanged: boolean = [
      "impactStartedAt",
      "declaredAt",
      "postmortemPostedAt",
    ].some((key: string) => {
      return Object.prototype.hasOwnProperty.call(onUpdate.updateBy.data, key);
    });

    if (anchorTimestampChanged) {
      for (const itemId of updatedItemIds) {
        this.refreshIncidentMetrics({ incidentId: itemId }).catch(
          (err: Error) => {
            logger.error(err);
          },
        );

        IncidentMeasurementValueService.recomputeForIncident({
          incidentId: itemId,
        }).catch((err: Error) => {
          logger.error(err);
        });
      }
    }

    /*
     * The state the update wrote, under either of its names: onBeforeUpdate
     * refused two that disagree, so this reads one value.
     */
    const updatedIncidentStateId: ObjectID | null =
      RelationIdUtil.readConsistent(
        onUpdate.updateBy.data as unknown as Record<string, unknown>,
        CURRENT_STATE_KEYS,
        "Incident State",
      );

    /*
     * The severity the update wrote, under either of its names: the
     * dashboard's forms send the relation, the API, Terraform, workflows and
     * the AI tools the ID column, and onBeforeUpdate refused two that
     * disagree. Its feed entry, SLA recalculation, reminder refresh and
     * metric run for each incident whose severity this changed - compared
     * with the severity it held before the write
     * (recordStoredValuesBeforeUpdate) - so writing back the severity an
     * incident holds runs none of them.
     */
    const writtenIncidentSeverityId: ObjectID | null =
      RelationIdUtil.readConsistent(
        onUpdate.updateBy.data as unknown as Record<string, unknown>,
        SEVERITY_KEYS,
        "Incident Severity",
      );

    if (updatedIncidentStateId && onUpdate.updateBy.props.tenantId) {
      for (const itemId of updatedItemIds) {
        await this.changeIncidentState({
          projectId: onUpdate.updateBy.props.tenantId as ObjectID,
          incidentId: itemId,
          incidentStateId: updatedIncidentStateId,
          notifyOwners: true,
          shouldNotifyStatusPageSubscribers: true,
          isSubscribersNotified: false,
          rootCause: "This status was changed when the incident was updated.",
          stateChangeLog: undefined,
          props: {
            isRoot: true,
          },
        });
      }
    }

    // Whether the update writes the postmortem's note or its switch.
    const isPostmortemWritten: boolean =
      IncidentPostmortemPublication.isWrittenBy(
        onUpdate.updateBy.data as unknown as Record<string, unknown>,
      );

    if (updatedItemIds.length > 0) {
      for (const incidentId of updatedItemIds) {
        const incident: Model | null = await this.findOneById({
          id: incidentId,
          select: {
            projectId: true,
            incidentNumber: true,
            incidentNumberWithPrefix: true,
          },
          props: {
            isRoot: true,
          },
        });

        const projectId: ObjectID = incident!.projectId!;
        const incidentNumber: number = incident!.incidentNumber!;
        const incidentNumberDisplay: string =
          incident!.incidentNumberWithPrefix || "#" + incidentNumber;
        const incidentLabel: string = `Incident ${incidentNumberDisplay}`;
        const incidentLink: URL = await this.getIncidentLinkInDashboard(
          projectId,
          incidentId,
        );

        const updatedIncidentData: IncidentUpdatePayload = (onUpdate.updateBy
          .data ?? {}) as IncidentUpdatePayload;

        const createdByUserId: ObjectID | undefined | null =
          onUpdate.updateBy.props.userId;

        /*
         * The postmortem's inline images are already public if it is shown
         * on the status page, private if not: DatabaseService made them so
         * as it wrote the update, before this hook (PublishedImages), so
         * the notification queued below never links to a private image.
         */
        if (isPostmortemWritten) {
          await this.applyPostmortemUpdate({
            incidentId: incidentId,
            projectId: projectId,
            incidentLabel: incidentLabel,
            incidentLink: incidentLink,
            userId: createdByUserId || undefined,
            written: updatedIncidentData as Record<string, unknown>,
            postmortemBeforeUpdate: (
              onUpdate.carryForward as UpdateCarryForward | undefined
            )?.[incidentId.toString()]?.postmortemBeforeUpdate,
          });
        }

        const isSeverityChanged: boolean = ReferenceChange.isChanged({
          writtenId: writtenIncidentSeverityId,
          idBeforeUpdate: (
            onUpdate.carryForward as UpdateCarryForward | undefined
          )?.[incidentId.toString()]?.severityIdBeforeUpdate,
        });

        /*
         * The reminder rule is matched on the severity and the labels, and
         * reminders can be switched on or off. One refresh covers whatever
         * of those the update changed: each refresh restarts the interval.
         */
        const shouldRefreshReminders: boolean =
          isSeverityChanged ||
          Object.prototype.hasOwnProperty.call(
            updatedIncidentData,
            "enableReminders",
          ) ||
          // Any labels change re-matches the rule, clearing them included.
          Boolean(
            updatedIncidentData.labels &&
              Array.isArray(updatedIncidentData.labels),
          );

        // emit postmortem completion time metric when postmortemPostedAt is set
        if (
          Object.prototype.hasOwnProperty.call(
            updatedIncidentData,
            "postmortemPostedAt",
          ) &&
          updatedIncidentData["postmortemPostedAt"]
        ) {
          try {
            const postmortemPostedAt: Date = updatedIncidentData[
              "postmortemPostedAt"
            ] as Date;

            // find the resolved state timeline to calculate time from resolution to postmortem
            const resolvedStateId: ObjectID =
              await IncidentStateTimelineService.getResolvedStateIdForProject(
                projectId,
              );

            const resolvedTimeline: IncidentStateTimeline | null =
              await IncidentStateTimelineService.findOneBy({
                query: {
                  incidentId: incidentId,
                  incidentStateId: resolvedStateId,
                },
                select: {
                  startsAt: true,
                },
                sort: {
                  startsAt: SortOrder.Descending,
                },
                props: {
                  isRoot: true,
                },
              });

            // only emit if the incident has been resolved
            if (resolvedTimeline && resolvedTimeline.startsAt) {
              /*
               * Same dimension set as every other incident metric — including
               * oneuptime.label.* / oneuptime.customField.* — so a dashboard
               * grouped by a label does not silently lose this series.
               */
              const {
                baseMetricAttributes,
              }: { baseMetricAttributes: JSONObject } =
                await this.getIncidentMetricContext({
                  incidentId: incidentId,
                });

              const postmortemMetric: MutableMetric = new MutableMetric();
              postmortemMetric.projectId = projectId;
              postmortemMetric.primaryEntityId = incidentId;
              postmortemMetric.primaryEntityType = ServiceType.Incident;
              postmortemMetric.name =
                IncidentMetricType.PostmortemCompletionTime;
              postmortemMetric.metricPointId =
                IncidentMetricType.PostmortemCompletionTime;
              postmortemMetric.value = OneUptimeDate.getDifferenceInSeconds(
                postmortemPostedAt,
                resolvedTimeline.startsAt,
              );
              postmortemMetric.attributes = {
                ...baseMetricAttributes,
                incidentId: incidentId.toString(),
                projectId: projectId.toString(),
              };
              postmortemMetric.attributeKeys = TelemetryUtil.getAttributeKeys(
                postmortemMetric.attributes,
              );
              postmortemMetric.time = postmortemPostedAt;
              postmortemMetric.timeUnixNano = OneUptimeDate.toUnixNano(
                postmortemMetric.time,
              );
              postmortemMetric.metricPointType = MetricPointType.Sum;
              const postmortemRetentionDays: number =
                await this.getMetricRetentionDays();
              postmortemMetric.retentionDate = OneUptimeDate.addRemoveDays(
                OneUptimeDate.getCurrentDate(),
                postmortemRetentionDays,
              );

              await MutableMetricService.createMutableMetrics({
                metrics: [postmortemMetric],
              });

              const postmortemMetricType: MetricType = new MetricType();
              postmortemMetricType.name =
                IncidentMetricType.PostmortemCompletionTime;
              postmortemMetricType.description =
                "Time from incident resolution to postmortem publication";
              postmortemMetricType.unit = "seconds";

              TelemetryUtil.indexMetricNameServiceNameMap({
                metricNameServiceNameMap: {
                  [postmortemMetricType.name]: postmortemMetricType,
                },
                projectId: projectId,
              }).catch((err: Error) => {
                logger.error(err, {
                  projectId: projectId?.toString(),
                  incidentId: incidentId?.toString(),
                } as LogAttributes);
              });
            }
          } catch (metricError) {
            logger.error(
              `Failed to emit postmortem completion time metric: ${metricError}`,
              {
                projectId: projectId?.toString(),
                incidentId: incidentId?.toString(),
              } as LogAttributes,
            );
          }
        }

        let shouldAddIncidentFeed: boolean = false;
        let feedInfoInMarkdown: string = `**[${incidentLabel}](${incidentLink.toString()}) was updated.**`;

        if (
          Object.prototype.hasOwnProperty.call(updatedIncidentData, "title")
        ) {
          // Plain text, escaped as in the "Incident Created" item.
          const title: string = escapeMarkdownValue(
            (updatedIncidentData.title as string) || "No title provided.",
          );
          feedInfoInMarkdown += `\n\n**Title**: \n${title}\n`;
          shouldAddIncidentFeed = true;
        }

        if (
          Object.prototype.hasOwnProperty.call(updatedIncidentData, "rootCause")
        ) {
          const rootCause: string =
            (updatedIncidentData.rootCause as string) || "";
          const rootCauseText: string = rootCause.trim().length
            ? rootCause
            : "Root cause removed.";
          feedInfoInMarkdown += `\n\n**📄 Root Cause**: \n${rootCauseText}\n`;
          shouldAddIncidentFeed = true;
        }

        if (
          Object.prototype.hasOwnProperty.call(
            updatedIncidentData,
            "description",
          )
        ) {
          const description: string =
            (updatedIncidentData.description as string) ||
            "No description provided.";
          feedInfoInMarkdown += `\n\n**Incident Description**: \n${description}\n`;
          shouldAddIncidentFeed = true;
        }

        if (
          Object.prototype.hasOwnProperty.call(
            updatedIncidentData,
            "remediationNotes",
          )
        ) {
          const remediationNotes: string =
            (updatedIncidentData.remediationNotes as string) || "";
          const remediationText: string = remediationNotes.trim().length
            ? remediationNotes
            : "Remediation notes removed.";
          feedInfoInMarkdown += `\n\n**🎯 Remediation Notes**: \n${remediationText}\n`;
          shouldAddIncidentFeed = true;
        }

        if (
          updatedIncidentData.labels &&
          (updatedIncidentData.labels as Array<Label>).length > 0 &&
          Array.isArray(updatedIncidentData.labels)
        ) {
          const labelIds: Array<ObjectID> = (updatedIncidentData.labels as any)
            .map((label: Label) => {
              if (label._id) {
                return new ObjectID(label._id?.toString());
              }

              return null;
            })
            .filter((labelId: ObjectID | null) => {
              return labelId !== null;
            });

          const labels: Array<Label> = await LabelService.findBy({
            query: {
              _id: QueryHelper.any(labelIds),
            },
            select: {
              name: true,
            },
            limit: LIMIT_PER_PROJECT,
            skip: 0,
            props: {
              isRoot: true,
            },
          });

          if (labels.length > 0) {
            feedInfoInMarkdown += `\n\n**🏷️ Labels**:

${labels
  .map((label: Label) => {
    return `- ${label.name}`;
  })
  .join("\n")}
`;

            shouldAddIncidentFeed = true;
          }
        }

        if (isSeverityChanged && writtenIncidentSeverityId) {
          const incidentSeverity: IncidentSeverity | null =
            await IncidentSeverityService.findOneBy({
              query: {
                _id: writtenIncidentSeverityId,
              },
              select: {
                name: true,
              },
              props: {
                isRoot: true,
              },
            });

          if (incidentSeverity) {
            feedInfoInMarkdown += `\n\n**⚠️ Incident Severity**:
${incidentSeverity.name}
`;

            shouldAddIncidentFeed = true;

            // Recalculate SLA deadlines when severity changes
            try {
              await IncidentSlaService.recalculateDeadlines({
                incidentId: incidentId,
              });
            } catch (slaError) {
              logger.error(
                `SLA recalculation failed in IncidentService.onUpdateSuccess: ${slaError}`,
                {
                  projectId: projectId?.toString(),
                  incidentId: incidentId?.toString(),
                } as LogAttributes,
              );
            }

            // emit severity change metric
            try {
              /*
               * Same dimension set as every other incident metric — including
               * oneuptime.label.* / oneuptime.customField.* — so "severity
               * churn by product" is answerable from the metric store.
               */
              const {
                baseMetricAttributes,
              }: { baseMetricAttributes: JSONObject } =
                await this.getIncidentMetricContext({
                  incidentId: incidentId,
                });

              const severityChangeMetric: MutableMetric = new MutableMetric();
              severityChangeMetric.projectId = projectId;
              severityChangeMetric.primaryEntityId = incidentId;
              severityChangeMetric.primaryEntityType = ServiceType.Incident;
              severityChangeMetric.name = IncidentMetricType.SeverityChange;
              severityChangeMetric.metricPointId = `severity-change:${ObjectID.generate().toString()}`;
              severityChangeMetric.value = 1;
              severityChangeMetric.attributes = {
                ...baseMetricAttributes,
                incidentId: incidentId.toString(),
                projectId: projectId.toString(),
                newIncidentSeverityId: incidentSeverity._id?.toString() || "",
                newIncidentSeverityName:
                  incidentSeverity.name?.toString() || "",
              };
              severityChangeMetric.attributeKeys =
                TelemetryUtil.getAttributeKeys(severityChangeMetric.attributes);
              severityChangeMetric.time = OneUptimeDate.getCurrentDate();
              severityChangeMetric.timeUnixNano = OneUptimeDate.toUnixNano(
                severityChangeMetric.time,
              );
              severityChangeMetric.metricPointType = MetricPointType.Sum;
              const severityRetentionDays: number =
                await this.getMetricRetentionDays();
              severityChangeMetric.retentionDate = OneUptimeDate.addRemoveDays(
                OneUptimeDate.getCurrentDate(),
                severityRetentionDays,
              );

              await MutableMetricService.createMutableMetrics({
                metrics: [severityChangeMetric],
              });

              const severityChangeMetricType: MetricType = new MetricType();
              severityChangeMetricType.name = IncidentMetricType.SeverityChange;
              severityChangeMetricType.description =
                "Count of incident severity changes";
              severityChangeMetricType.unit = "";

              TelemetryUtil.indexMetricNameServiceNameMap({
                metricNameServiceNameMap: {
                  [severityChangeMetricType.name]: severityChangeMetricType,
                },
                projectId: projectId,
              }).catch((err: Error) => {
                logger.error(err, {
                  projectId: projectId?.toString(),
                  incidentId: incidentId?.toString(),
                } as LogAttributes);
              });
            } catch (metricError) {
              logger.error(
                `Failed to emit severity change metric: ${metricError}`,
                {
                  projectId: projectId?.toString(),
                  incidentId: incidentId?.toString(),
                } as LogAttributes,
              );
            }
          }
        }

        if (shouldRefreshReminders) {
          try {
            await this.refreshReminderSchedule({
              incidentId: incidentId,
              projectId: projectId,
            });
          } catch (reminderError) {
            logger.error(
              `Reminder rescheduling failed in IncidentService.onUpdateSuccess: ${reminderError}`,
              {
                projectId: projectId?.toString(),
                incidentId: incidentId?.toString(),
              } as LogAttributes,
            );
          }
        }

        const carryForward: UpdateCarryForward | undefined =
          onUpdate.carryForward;

        if (carryForward) {
          const incidentCarryForward: UpdateCarryForward[string] | undefined =
            carryForward[incidentId.toString()];

          if (incidentCarryForward) {
            if (incidentCarryForward.monitorsRemoved.length > 0) {
              const monitorsRemoved: Array<Monitor> =
                await MonitorService.findBy({
                  query: {
                    _id: QueryHelper.any(
                      incidentCarryForward.monitorsRemoved.map(
                        (monitor: Monitor) => {
                          return new ObjectID(monitor._id?.toString() || "");
                        },
                      ),
                    ),
                  },
                  select: {
                    name: true,
                    _id: true,
                  },
                  limit: LIMIT_PER_PROJECT,
                  skip: 0,
                  props: {
                    isRoot: true,
                  },
                });

              feedInfoInMarkdown += `\n\n**🗑️ Monitors Removed**:\n`;

              for (const monitor of monitorsRemoved) {
                feedInfoInMarkdown += `- [${monitor.name}](${(await MonitorService.getMonitorLinkInDashboard(projectId!, monitor.id!)).toString()})\n`;
              }

              shouldAddIncidentFeed = true;
            }

            if (incidentCarryForward.monitorsAdded.length > 0) {
              const monitorsAdded: Array<Monitor> = await MonitorService.findBy(
                {
                  query: {
                    _id: QueryHelper.any(
                      incidentCarryForward.monitorsAdded.map(
                        (monitor: Monitor) => {
                          return new ObjectID(monitor._id?.toString() || "");
                        },
                      ),
                    ),
                  },
                  select: {
                    name: true,
                    _id: true,
                  },
                  limit: LIMIT_PER_PROJECT,
                  skip: 0,
                  props: {
                    isRoot: true,
                  },
                },
              );

              feedInfoInMarkdown += `\n\n**🌎 Monitors Added**:\n`;

              for (const monitor of monitorsAdded) {
                feedInfoInMarkdown += `- [${monitor.name}](${(await MonitorService.getMonitorLinkInDashboard(projectId!, monitor.id!)).toString()})\n`;
              }

              shouldAddIncidentFeed = true;
            }

            const statusPageScopeMarkdown: string =
              await this.getStatusPageScopeFeedMarkdown({
                projectId: projectId,
                incidentId: incidentId,
                change: incidentCarryForward.statusPageScopeChange,
              });

            if (statusPageScopeMarkdown) {
              feedInfoInMarkdown += statusPageScopeMarkdown;
              shouldAddIncidentFeed = true;
            }

            await this.requeueCreatedNotificationIfAddedPagesWereMissed({
              incidentId: incidentId,
              change: incidentCarryForward.statusPageScopeChange,
            });

            // Saving the status the incident already had changes nothing.
            if (
              incidentCarryForward.oldChangeMonitorStatusIdTo &&
              incidentCarryForward.newMonitorChangeStatusIdTo &&
              this.isMonitorStatusChangedByUpdate(incidentCarryForward)
            ) {
              const oldMonitorStatus: MonitorStatus | null =
                await MonitorStatusService.findOneBy({
                  query: {
                    _id: incidentCarryForward.oldChangeMonitorStatusIdTo,
                  },
                  select: {
                    name: true,
                  },
                  props: {
                    isRoot: true,
                  },
                });

              const newMonitorStatus: MonitorStatus | null =
                await MonitorStatusService.findOneBy({
                  query: {
                    _id: incidentCarryForward.newMonitorChangeStatusIdTo,
                  },
                  select: {
                    name: true,
                  },
                  props: {
                    isRoot: true,
                  },
                });

              if (oldMonitorStatus && newMonitorStatus) {
                feedInfoInMarkdown += `\n\n**🔄 Monitor Status Changed**:\n- **From** ${oldMonitorStatus.name} to ${newMonitorStatus.name}`;
                shouldAddIncidentFeed = true;
              }
            }

            await this.updateMonitorsForIncidentEdit({
              projectId: projectId,
              incidentId: incidentId,
              incidentNumberDisplay: incidentNumberDisplay,
              carryForward: incidentCarryForward,
              props: onUpdate.updateBy.props,
            });
          }
        }

        if (shouldAddIncidentFeed) {
          await IncidentFeedService.createIncidentFeedItem({
            incidentId: incidentId,
            projectId: onUpdate.updateBy.props.tenantId as ObjectID,
            incidentFeedEventType: IncidentFeedEventType.IncidentUpdated,
            displayColor: Gray500,
            feedInfoInMarkdown: feedInfoInMarkdown,
            userId: createdByUserId || undefined,
            workspaceNotification: {
              sendWorkspaceNotification: true,
            },
          });
        }
      }
    }

    return onUpdate;
  }

  /*
   * Whether an update puts the incident's monitors in a different status
   * from the one it held: it writes a status, and not the same one again.
   */
  private isMonitorStatusChangedByUpdate(
    carryForward: UpdateCarryForward[string],
  ): boolean {
    if (!carryForward.newMonitorChangeStatusIdTo) {
      return false;
    }

    return (
      carryForward.newMonitorChangeStatusIdTo.toString().toLowerCase() !==
      (carryForward.oldChangeMonitorStatusIdTo?.toString() || "").toLowerCase()
    );
  }

  /*
   * What an edit of an incident's monitors, or of the status it puts them
   * in, does to the monitors themselves. The feed item records the edit
   * either way; this only decides which monitors change.
   *
   * The monitors taken off the incident are restored, unless another open
   * incident still holds them (markMonitorsActiveForMonitoring), when the
   * incident was open before the update. That includes an update that
   * resolves it as well: resolving restores only the monitors it still
   * holds (IncidentStateTimelineService), so this is the only restore the
   * ones taken off get. A monitor taken off an incident that was resolved
   * already was restored when it resolved, and restoring it again could
   * overwrite a status set since (maintenance, or a manual monitor's status
   * set by hand).
   *
   * A resolved incident, as it stands after the update, does nothing else
   * to its monitors. Nothing would clear what it did: an added monitor of a
   * manual incident would never be probed again, and the incident's status
   * would sit on its monitors as false downtime.
   *
   * An open incident:
   * - stops probing the monitors of a manual incident when one is added,
   *   as creating it did (disableActiveMonitoringIfManualIncident);
   * - puts the monitors added in its status, and all of its monitors only
   *   when the edit changes that status. Every save used to put all of them
   *   in it again, overwriting a status a probe had set since.
   */
  private async updateMonitorsForIncidentEdit(data: {
    projectId: ObjectID;
    incidentId: ObjectID;
    incidentNumberDisplay: string;
    carryForward: UpdateCarryForward[string];
    props: DatabaseCommonInteractionProps;
  }): Promise<void> {
    const carryForward: UpdateCarryForward[string] = data.carryForward;

    if (
      carryForward.monitorsRemoved.length > 0 &&
      !carryForward.isResolvedBeforeUpdate
    ) {
      // change these monitors back to operational state.
      await this.markMonitorsActiveForMonitoring(
        data.projectId,
        carryForward.monitorsRemoved,
      );
    }

    const isMonitorStatusChanged: boolean =
      this.isMonitorStatusChangedByUpdate(carryForward);

    if (carryForward.monitorsAdded.length === 0 && !isMonitorStatusChanged) {
      return;
    }

    /*
     * Read after the update is written, so an edit that resolves the
     * incident as well counts as resolved: changing the state restored the
     * monitors it holds, the added ones included.
     */
    if (await this.isIncidentResolved({ incidentId: data.incidentId })) {
      return;
    }

    if (carryForward.monitorsAdded.length > 0) {
      await this.disableActiveMonitoringIfManualIncident(data.incidentId);
    }

    // The status the incident puts its monitors in after the update.
    const monitorStatusIdToApply: ObjectID | undefined =
      carryForward.isChangeMonitorStatusToCleared
        ? undefined
        : carryForward.newMonitorChangeStatusIdTo ||
          carryForward.oldChangeMonitorStatusIdTo;

    if (
      !monitorStatusIdToApply ||
      (!isMonitorStatusChanged && carryForward.monitorsAdded.length === 0)
    ) {
      return;
    }

    const addedMonitorIds: Array<string> = carryForward.monitorsAdded.map(
      (monitor: Monitor): string => {
        return this.getMonitorIdForComparison(monitor);
      },
    );

    /*
     * The monitors the incident holds now, so a status is only ever put on
     * a monitor the update left on it.
     */
    const incident: Model | null = await this.findOneById({
      id: data.incidentId,
      select: {
        monitors: {
          _id: true,
        },
      },
      props: {
        isRoot: true,
      },
    });

    const monitorIdsToChange: Array<ObjectID> = (incident?.monitors || [])
      .filter((monitor: Monitor): boolean => {
        return (
          isMonitorStatusChanged ||
          addedMonitorIds.includes(this.getMonitorIdForComparison(monitor))
        );
      })
      .map((monitor: Monitor): ObjectID => {
        return new ObjectID(monitor._id?.toString() || "");
      });

    if (monitorIdsToChange.length === 0) {
      return;
    }

    await MonitorService.changeMonitorStatus(
      data.projectId,
      monitorIdsToChange,
      monitorStatusIdToApply,
      true, // notifyMonitorOwners
      "Status was changed because Incident " +
        data.incidentNumberDisplay +
        " was updated.",
      undefined,
      data.props,
    );
  }

  /*
   * The part of an update's feed item that records a change of the status
   * pages the incident is limited to: the pages added and removed, whether
   * the incident is now limited at all, and whether the added pages will be
   * sent the 'created' notification. Empty when the scope did not change.
   *
   * Page names are read as root, like the monitor names above. The pages were
   * validated as this project's when they were written, and the read is
   * filtered on the project anyway. Never throws: the update is already
   * written, and a missing line in the feed must not turn it into an error.
   */
  private async getStatusPageScopeFeedMarkdown(data: {
    projectId: ObjectID;
    incidentId: ObjectID;
    change: StatusPageScopeCarryForward | undefined;
  }): Promise<string> {
    const change: StatusPageScopeCarryForward | undefined = data.change;

    if (
      !change ||
      (change.addedStatusPageIds.length === 0 &&
        change.removedStatusPageIds.length === 0)
    ) {
      return "";
    }

    try {
      const statusPages: Array<StatusPage> = await StatusPageService.findBy({
        query: {
          _id: QueryHelper.any([
            ...change.addedStatusPageIds,
            ...change.removedStatusPageIds,
          ]),
          projectId: data.projectId,
        },
        select: {
          _id: true,
          name: true,
        },
        limit: LIMIT_MAX,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

      const statusPageLines: (ids: Array<string>) => Promise<string> = async (
        ids: Array<string>,
      ): Promise<string> => {
        let lines: string = "";

        for (const id of ids) {
          const statusPage: StatusPage | undefined = statusPages.find(
            (page: StatusPage) => {
              return page.id?.toString().toLowerCase() === id;
            },
          );

          if (!statusPage) {
            // Deleted since: its name is gone with it.
            lines += `- A deleted status page\n`;
            continue;
          }

          // A page name is free text: kept from turning into a link or an image.
          lines += `- [${escapeMarkdownInline(statusPage.name || "Untitled status page")}](${(await StatusPageService.getStatusPageLinkInDashboard(data.projectId, statusPage.id!)).toString()})\n`;
        }

        return lines;
      };

      let markdown: string = "";

      if (change.addedStatusPageIds.length > 0) {
        markdown += `\n\n**📣 Status Pages Added**:\n${await statusPageLines(change.addedStatusPageIds)}`;
      }

      if (change.removedStatusPageIds.length > 0) {
        markdown += `\n\n**🔕 Status Pages Removed**:\n${await statusPageLines(change.removedStatusPageIds)}`;
      }

      markdown += change.isScoped
        ? `\n\nThis incident is shown on, and notifies the subscribers of, only its selected status pages that list its monitors.\n`
        : `\n\nThis incident is no longer limited to specific status pages: it is shown on every status page that lists its monitors, except pages that only show incidents limited to them.\n`;

      if (change.notificationQueued) {
        markdown += `\nSubscribers of the added status pages will be sent the notification that this incident was created.\n`;
      }

      return markdown;
    } catch (err) {
      logger.error(
        `Failed to describe the status page scope change in the incident feed: ${err}`,
        {
          projectId: data.projectId?.toString(),
          incidentId: data.incidentId?.toString(),
        } as LogAttributes,
      );

      return "";
    }
  }

  @CaptureSpan()
  public async doesMonitorHasMoreActiveManualIncidents(
    monitorId: ObjectID,
    proojectId: ObjectID,
  ): Promise<boolean> {
    const resolvedState: IncidentState | null =
      await IncidentStateService.findOneBy({
        query: {
          projectId: proojectId,
          isResolvedState: true,
        },
        props: {
          isRoot: true,
        },
        select: {
          _id: true,
          order: true,
        },
      });

    const incidentCount: PositiveNumber = await this.countBy({
      query: {
        monitors: QueryHelper.inRelationArray([monitorId]),
        currentIncidentState: {
          order: QueryHelper.lessThan(resolvedState?.order as number),
        },
        isCreatedAutomatically: false,
      },
      props: {
        isRoot: true,
      },
    });

    return incidentCount.toNumber() > 0;
  }

  @CaptureSpan()
  public async doesMonitorHaveActiveIncidents(
    monitorId: ObjectID,
    projectId: ObjectID,
  ): Promise<boolean> {
    const resolvedState: IncidentState | null =
      await IncidentStateService.findOneBy({
        query: {
          projectId: projectId,
          isResolvedState: true,
        },
        props: {
          isRoot: true,
        },
        select: {
          _id: true,
          order: true,
        },
      });

    const incidentCount: PositiveNumber = await this.countBy({
      query: {
        monitors: QueryHelper.inRelationArray([monitorId]),
        currentIncidentState: {
          order: QueryHelper.lessThan(resolvedState?.order as number),
        },
      },
      props: {
        isRoot: true,
      },
    });

    return incidentCount.toNumber() > 0;
  }

  @CaptureSpan()
  public async markMonitorsActiveForMonitoring(
    projectId: ObjectID,
    monitors: Array<Monitor>,
    startsAt?: Date | undefined,
  ): Promise<void> {
    // resolve all the monitors.

    if (monitors.length > 0) {
      // get resolved monitor state.
      /*
       * Resolve monitors back to the project's operational status. A project
       * can hold more than one operational state, so this lookup MUST be
       * deterministic: without an explicit sort findOneBy falls back to
       * `createdAt DESC` and would resolve monitors into whichever operational
       * status was created most recently (e.g. a user- or fixture-added one)
       * rather than the seeded default. Order by priority ascending (the
       * seeded default operational status is priority 0), tie-broken by the
       * oldest row, matching MonitorService.onBeforeCreate so a monitor's
       * operational status is the same canonical one throughout its lifecycle.
       */
      const resolvedMonitorState: MonitorStatus | null =
        await MonitorStatusService.findOneBy({
          query: {
            projectId: projectId!,
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

      if (resolvedMonitorState) {
        for (const monitor of monitors) {
          /*
           * Per-monitor isolation: one monitor failing here (for example the
           * fail-closed status timeline lock, or a transient DB error) must not
           * abort the loop and strand the REMAINING monitors with
           * disableActiveMonitoringBecauseOfManualIncident still true - a
           * monitor left in that state is skipped by probes and sits in its
           * down status indefinitely, silently accruing downtime.
           */
          try {
            //check state of the monitor.

            const doesMonitorHasMoreActiveManualIncidents: boolean =
              await this.doesMonitorHasMoreActiveManualIncidents(
                monitor.id!,
                projectId!,
              );

            if (doesMonitorHasMoreActiveManualIncidents) {
              continue;
            }

            await MonitorService.updateOneById({
              id: monitor.id!,
              data: {
                disableActiveMonitoringBecauseOfManualIncident: false,
              },
              props: {
                isRoot: true,
              },
            });

            /*
             * Don't flip the monitor to operational while other incidents
             * are still open on it — e.g. a metric monitor with group-by
             * may have one incident per series, and resolving one series
             * shouldn't claim the whole monitor is healthy.
             */
            const hasOtherActiveIncidents: boolean =
              await this.doesMonitorHaveActiveIncidents(
                monitor.id!,
                projectId!,
              );

            if (hasOtherActiveIncidents) {
              continue;
            }

            /*
             * changeMonitorStatus performs the same latest-status dedupe check
             * this loop used to do inline, and additionally absorbs the two
             * recoverable error classes (status already set by a concurrent
             * writer, lock not acquired after retries) by skipping the write,
             * so the common failure modes never even reach the catch below.
             * notifyOwners is true to preserve the previous behavior here: the
             * created row had isOwnerNotified unset, so owners were notified.
             */
            await MonitorService.changeMonitorStatus(
              projectId!,
              [monitor.id!],
              resolvedMonitorState.id!,
              true, // notifyOwners - matches the pre-existing behavior of this loop.
              undefined,
              undefined,
              {
                isRoot: true,
              },
              startsAt,
            );
          } catch (err) {
            logger.error(
              `IncidentService.markMonitorsActiveForMonitoring: failed for monitor ${monitor.id?.toString()}; continuing with the remaining monitors.`,
            );
            logger.error(err);
            continue;
          }
        }
      }
    }
  }

  @CaptureSpan()
  protected override async onBeforeDelete(
    deleteBy: DeleteBy<Model>,
  ): Promise<OnDelete<Model>> {
    deleteBy.query = applyIncidentSelfPrivacyFilter(
      deleteBy.query,
      deleteBy.props,
    );

    const incidents: Array<Model> = await this.findBy({
      query: deleteBy.query,
      limit: LIMIT_MAX,
      skip: 0,
      select: {
        _id: true,
        projectId: true,
        monitors: {
          _id: true,
        },
      },
      props: {
        isRoot: true,
      },
    });

    return {
      deleteBy,
      carryForward: {
        incidents: incidents,
      },
    };
  }

  @CaptureSpan()
  protected override async onDeleteSuccess(
    onDelete: OnDelete<Model>,
    _itemIdsBeforeDelete: ObjectID[],
  ): Promise<OnDelete<Model>> {
    if (onDelete.carryForward && onDelete.carryForward.incidents) {
      for (const incident of onDelete.carryForward.incidents) {
        if (incident.monitors && incident.monitors.length > 0) {
          await this.markMonitorsActiveForMonitoring(
            incident.projectId!,
            incident.monitors,
          );
        }

        if (incident.projectId && incident.id) {
          const metricRetentionDays: number =
            await this.getMetricRetentionDays();

          await MutableMetricService.tombstoneEntityMetrics({
            projectId: incident.projectId,
            primaryEntityId: incident.id,
            primaryEntityType: ServiceType.Incident,
            metricNames: Object.values(IncidentMetricType),
            retentionDate: OneUptimeDate.addRemoveDays(
              OneUptimeDate.getCurrentDate(),
              metricRetentionDays,
            ),
          });

          /*
           * Measurement points carry project-defined names, so they are not
           * in the enum above and would otherwise linger in every chart
           * until their retention date -- for an entity that no longer
           * exists.
           */
          const measurementMetricNames: Array<string> =
            await IncidentMeasurementService.getMetricNamesForProject(
              incident.projectId,
            );

          await MeasurementMetricWriter.tombstoneAll({
            projectId: incident.projectId,
            primaryEntityId: incident.id,
            primaryEntityType: ServiceType.Incident,
            allMeasurementMetricNames: measurementMetricNames,
          });
        }
      }
    }

    return onDelete;
  }

  @CaptureSpan()
  public async changeIncidentState(data: {
    projectId: ObjectID;
    incidentId: ObjectID;
    incidentStateId: ObjectID;
    shouldNotifyStatusPageSubscribers: boolean;
    isSubscribersNotified: boolean;
    notifyOwners: boolean;
    rootCause: string | undefined;
    stateChangeLog: JSONObject | undefined;
    props: DatabaseCommonInteractionProps | undefined;
    timelineStartsAt?: Date | string | undefined;
    /*
     * The first state of an incident declared already resolved, which never
     * held its monitors: the resolve gives them nothing back
     * (INCIDENT_NEVER_HELD_ITS_MONITORS_KEY). Heard only from OneUptime's
     * own (root) write.
     */
    neverHeldItsMonitors?: boolean | undefined;
  }): Promise<void> {
    const {
      projectId,
      incidentId,
      incidentStateId,
      shouldNotifyStatusPageSubscribers,
      isSubscribersNotified,
      notifyOwners,
      rootCause,
      stateChangeLog,
      props,
      timelineStartsAt,
      neverHeldItsMonitors,
    } = data;

    const declaredTimelineStart: Date | undefined = timelineStartsAt
      ? OneUptimeDate.fromString(timelineStartsAt as Date)
      : undefined;

    // get last monitor status timeline.
    const lastIncidentStatusTimeline: IncidentStateTimeline | null =
      await IncidentStateTimelineService.findOneBy({
        query: {
          incidentId: incidentId,
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
      lastIncidentStatusTimeline &&
      lastIncidentStatusTimeline.incidentStateId &&
      lastIncidentStatusTimeline.incidentStateId.toString() ===
        incidentStateId.toString()
    ) {
      return;
    }

    const statusTimeline: IncidentStateTimeline = new IncidentStateTimeline();

    statusTimeline.incidentId = incidentId;
    statusTimeline.incidentStateId = incidentStateId;
    statusTimeline.projectId = projectId;
    statusTimeline.isOwnerNotified = !notifyOwners;
    statusTimeline.shouldStatusPageSubscribersBeNotified =
      shouldNotifyStatusPageSubscribers;

    if (!lastIncidentStatusTimeline && declaredTimelineStart) {
      statusTimeline.startsAt = declaredTimelineStart;
    }

    // Map boolean to enum value
    statusTimeline.subscriberNotificationStatus = isSubscribersNotified
      ? StatusPageSubscriberNotificationStatus.Success
      : StatusPageSubscriberNotificationStatus.Pending;

    if (stateChangeLog) {
      statusTimeline.stateChangeLog = stateChangeLog;
    }
    if (rootCause) {
      statusTimeline.rootCause = rootCause;
    }

    await IncidentStateTimelineService.create({
      data: statusTimeline,
      props: props || {},
      ...(neverHeldItsMonitors
        ? {
            miscDataProps: {
              [INCIDENT_NEVER_HELD_ITS_MONITORS_KEY]: true,
            },
          }
        : {}),
    });
  }

  private static readonly DEFAULT_METRIC_RETENTION_DAYS: number = 180;

  private async getMetricRetentionDays(): Promise<number> {
    try {
      const globalConfig: GlobalConfig | null =
        await GlobalConfigService.findOneBy({
          query: {
            _id: ObjectID.getZeroObjectID().toString(),
          },
          props: {
            isRoot: true,
          },
          select: {
            monitorMetricRetentionInDays: true,
          },
        });

      if (
        globalConfig &&
        globalConfig.monitorMetricRetentionInDays !== undefined &&
        globalConfig.monitorMetricRetentionInDays !== null &&
        globalConfig.monitorMetricRetentionInDays > 0
      ) {
        return globalConfig.monitorMetricRetentionInDays;
      }
    } catch (error) {
      logger.error("Error fetching metric retention config, using default:");
      logger.error(error);
    }

    return Service.DEFAULT_METRIC_RETENTION_DAYS;
  }

  /*
   * Load the incident + its owners and build the attribute set shared by
   * every incident metric (all values strings for ClickHouse
   * Map(String, String) storage; arrays joined comma-separated). Factored
   * out of refreshIncidentMetrics so one-off metric writers — e.g. the
   * AI time-to-rca metric recorded when an investigation posts its
   * analysis — record the exact same attribute shape.
   */
  @CaptureSpan()
  public async getIncidentMetricContext(data: {
    incidentId: ObjectID;
  }): Promise<{ incident: Model; baseMetricAttributes: JSONObject }> {
    const incident: Model | null = await this.findOneById({
      id: data.incidentId,
      select: {
        projectId: true,
        createdAt: true,
        declaredAt: true,
        postmortemPostedAt: true,
        monitors: {
          _id: true,
          name: true,
        },
        /*
         * The SLOs this incident affects, stamped below so an SLO's Metrics
         * page can chart the incidents that hit it. Only _id and name, which
         * the SLO model allows on relation reads.
         */
        serviceLevelObjectives: {
          _id: true,
          name: true,
        },
        incidentSeverity: {
          _id: true,
          name: true,
        },
        /*
         * A project's own taxonomy. Both become metric attributes below so
         * dashboards can group MTTA/MTTR by the dimensions the project
         * actually thinks in.
         */
        labels: {
          _id: true,
          name: true,
        },
        customFields: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!incident) {
      throw new BadDataException("Incident not found");
    }

    if (!incident.projectId) {
      throw new BadDataException("Incident Project ID not found");
    }

    // fetch owner users and teams for metric attributes
    const ownerUsers: Array<IncidentOwnerUser> =
      await IncidentOwnerUserService.findBy({
        query: {
          incidentId: data.incidentId,
        },
        select: {
          _id: true,
          user: {
            _id: true,
            name: true,
          },
        },
        props: {
          isRoot: true,
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
      });

    const ownerTeams: Array<IncidentOwnerTeam> =
      await IncidentOwnerTeamService.findBy({
        query: {
          incidentId: data.incidentId,
        },
        select: {
          _id: true,
          team: {
            _id: true,
            name: true,
          },
        },
        props: {
          isRoot: true,
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
      });

    const ownerUserIds: Array<string> = ownerUsers
      .map((ownerUser: IncidentOwnerUser) => {
        return ownerUser.user?._id?.toString();
      })
      .filter((id: string | undefined) => {
        return Boolean(id);
      }) as Array<string>;

    const ownerUserNames: Array<string> = ownerUsers
      .map((ownerUser: IncidentOwnerUser) => {
        return ownerUser.user?.name?.toString();
      })
      .filter((name: string | undefined) => {
        return Boolean(name);
      }) as Array<string>;

    const ownerTeamIds: Array<string> = ownerTeams
      .map((ownerTeam: IncidentOwnerTeam) => {
        return ownerTeam.team?._id?.toString();
      })
      .filter((id: string | undefined) => {
        return Boolean(id);
      }) as Array<string>;

    const ownerTeamNames: Array<string> = ownerTeams
      .map((ownerTeam: IncidentOwnerTeam) => {
        return ownerTeam.team?.name?.toString();
      })
      .filter((name: string | undefined) => {
        return Boolean(name);
      }) as Array<string>;

    /*
     * common attributes shared by all incident metrics
     * All values must be strings for ClickHouse Map(String, String) storage.
     * Arrays are joined as comma-separated strings.
     */
    const baseMetricAttributes: JSONObject = {
      incidentId: data.incidentId.toString(),
      projectId: incident.projectId.toString(),
      monitorIds: (
        incident.monitors
          ?.map((monitor: Monitor) => {
            return monitor._id?.toString();
          })
          .filter(Boolean) || []
      ).join(", "),
      monitorNames: (
        incident.monitors
          ?.map((monitor: Monitor) => {
            return monitor.name?.toString();
          })
          .filter(Boolean) || []
      ).join(", "),
      /*
       * Comma-joined like monitorIds: one incident can affect several SLOs.
       * The SLO Metrics page filters its Incident tab on
       * serviceLevelObjectiveIds (SERVICE_LEVEL_OBJECTIVE_IDS_METRIC_ATTRIBUTE
       * in Common/Utils/Slo/SloMetricType), so the key must not be renamed.
       */
      serviceLevelObjectiveIds: (
        incident.serviceLevelObjectives
          ?.map((serviceLevelObjective: ServiceLevelObjective) => {
            return serviceLevelObjective._id?.toString();
          })
          .filter(Boolean) || []
      ).join(", "),
      serviceLevelObjectiveNames: (
        incident.serviceLevelObjectives
          ?.map((serviceLevelObjective: ServiceLevelObjective) => {
            return serviceLevelObjective.name?.toString();
          })
          .filter(Boolean) || []
      ).join(", "),
      incidentSeverityId: incident.incidentSeverity?._id?.toString(),
      incidentSeverityName: incident.incidentSeverity?.name?.toString(),
      ownerUserIds: ownerUserIds.join(", "),
      ownerUserNames: ownerUserNames.join(", "),
      ownerTeamIds: ownerTeamIds.join(", "),
      ownerTeamNames: ownerTeamNames.join(", "),
      /*
       * oneuptime.label.* / oneuptime.customField.* — namespaced, so they can
       * never collide with the unprefixed dimensions above.
       */
      ...MetricResourceAttributeUtil.getResourceAttributes({
        labels: incident.labels,
        customFields: incident.customFields,
      }),
    };

    return { incident, baseMetricAttributes };
  }

  /*
   * AI measurement layer: record how long the incident waited for its
   * AI root-cause analysis — seconds from incident creation to now, written
   * once from IncidentInvestigationRunner.postAnalysis. Deliberately NOT
   * part of refreshIncidentMetrics: the refresh's replace-list excludes
   * this metric name, so refreshes never tombstone it.
   */
  @CaptureSpan()
  public async recordTimeToRootCausePostedMetric(data: {
    incidentId: ObjectID;
  }): Promise<void> {
    const {
      incident,
      baseMetricAttributes,
    }: { incident: Model; baseMetricAttributes: JSONObject } =
      await this.getIncidentMetricContext({ incidentId: data.incidentId });

    const now: Date = OneUptimeDate.getCurrentDate();
    const incidentCreatedAt: Date =
      incident.createdAt || incident.declaredAt || now;

    const metricRetentionDays: number = await this.getMetricRetentionDays();
    const retentionDate: Date = OneUptimeDate.addRemoveDays(
      OneUptimeDate.getCurrentDate(),
      metricRetentionDays,
    );

    const timeToRcaMetric: MutableMetric = new MutableMetric();

    timeToRcaMetric.projectId = incident.projectId!;
    timeToRcaMetric.primaryEntityId = incident.id!;
    timeToRcaMetric.primaryEntityType = ServiceType.Incident;
    timeToRcaMetric.name = IncidentMetricType.TimeToRootCausePosted;
    timeToRcaMetric.metricPointId = IncidentMetricType.TimeToRootCausePosted;
    timeToRcaMetric.value = OneUptimeDate.getDifferenceInSeconds(
      now,
      incidentCreatedAt,
    );
    timeToRcaMetric.attributes = {
      ...baseMetricAttributes,
      // Every time-to-rca point is AI-posted by construction.
      aiInvestigated: "true",
    };
    timeToRcaMetric.attributeKeys = TelemetryUtil.getAttributeKeys(
      timeToRcaMetric.attributes,
    );
    timeToRcaMetric.time = now;
    timeToRcaMetric.timeUnixNano = OneUptimeDate.toUnixNano(now);
    timeToRcaMetric.metricPointType = MetricPointType.Sum;
    timeToRcaMetric.retentionDate = retentionDate;

    await MutableMetricService.createMutableMetrics({
      metrics: [timeToRcaMetric],
    });

    // Register the metric type so it shows up in the type catalog.
    const metricType: MetricType = new MetricType();
    metricType.name = IncidentMetricType.TimeToRootCausePosted;
    metricType.description =
      "Time from incident creation to the AI investigation's posted root-cause analysis";
    metricType.unit = "seconds";

    TelemetryUtil.indexMetricNameServiceNameMap({
      metricNameServiceNameMap: {
        [IncidentMetricType.TimeToRootCausePosted]: metricType,
      },
      projectId: incident.projectId!,
    }).catch((err: Error) => {
      logger.error(err, {
        projectId: incident.projectId?.toString(),
        incidentId: incident.id?.toString(),
      } as LogAttributes);
    });
  }

  @CaptureSpan()
  public async refreshIncidentMetrics(data: {
    incidentId: ObjectID;
  }): Promise<void> {
    const {
      incident,
      baseMetricAttributes,
    }: { incident: Model; baseMetricAttributes: JSONObject } =
      await this.getIncidentMetricContext({ incidentId: data.incidentId });

    // getIncidentMetricContext guarantees this; re-checked for TS narrowing.
    if (!incident.projectId) {
      throw new BadDataException("Incident Project ID not found");
    }

    /*
     * aiInvestigated dimension for MTTA/MTTR (AI measurement layer):
     * did a completed AI investigation run for this incident? One
     * indexed countBy per metric refresh (triggeredByIncidentId is indexed)
     * — acceptable at refresh frequency. Failure must never break metric
     * recording, so this is best-effort false.
     */
    let aiInvestigated: boolean = false;
    try {
      const completedInvestigationCount: PositiveNumber =
        await AIRunService.countBy({
          query: {
            runType: AIRunType.Investigation,
            status: AIRunStatus.Completed,
            triggeredByIncidentId: data.incidentId,
          },
          props: {
            isRoot: true,
          },
        });

      aiInvestigated = completedInvestigationCount.toNumber() > 0;
    } catch (err) {
      logger.error(
        err as Error,
        {
          projectId: incident.projectId?.toString(),
          incidentId: incident.id?.toString(),
        } as LogAttributes,
      );
    }

    // get incident state timeline

    const incidentStateTimelines: Array<IncidentStateTimeline> =
      await IncidentStateTimelineService.findBy({
        query: {
          incidentId: data.incidentId,
        },
        select: {
          _id: true,
          projectId: true,
          incidentStateId: true,
          incidentState: {
            name: true,
            isAcknowledgedState: true,
            isResolvedState: true,
            isCreatedState: true,
          },
          startsAt: true,
          endsAt: true,
        },
        sort: {
          startsAt: SortOrder.Ascending,
        },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        props: {
          isRoot: true,
        },
      });

    const firstIncidentStateTimeline: IncidentStateTimeline | undefined =
      incidentStateTimelines[0];

    /*
     * Serialize concurrent refreshes for this incident across pods. Mutable
     * metrics are versioned inserts, but the replace operation also tombstones
     * stale metric-point identities. The lock keeps that read+insert cycle
     * ordered for each incident.
     */
    let metricRefreshMutex: SemaphoreMutex | null = null;
    try {
      metricRefreshMutex = await Semaphore.lock({
        key: data.incidentId.toString(),
        namespace: "IncidentService.refreshIncidentMetrics",
        lockTimeout: 30000,
      });
    } catch (err) {
      logger.error(
        err as Error,
        {
          projectId: incident.projectId?.toString(),
          incidentId: incident.id?.toString(),
        } as LogAttributes,
      );
    }

    try {
      const itemsToSave: Array<MutableMetric> = [];

      const metricRetentionDays: number = await this.getMetricRetentionDays();
      const incidentMetricRetentionDate: Date = OneUptimeDate.addRemoveDays(
        OneUptimeDate.getCurrentDate(),
        metricRetentionDays,
      );

      // now we need to create new metrics for this incident - TimeToAcknowledge, TimeToResolve, IncidentCount, IncidentDuration

      const incidentStartsAt: Date =
        firstIncidentStateTimeline?.startsAt ||
        incident.declaredAt ||
        incident.createdAt ||
        OneUptimeDate.getCurrentDate();

      const metricTypesMap: Dictionary<MetricType> = {};

      const incidentCountMetric: MutableMetric = new MutableMetric();

      incidentCountMetric.projectId = incident.projectId;
      incidentCountMetric.primaryEntityId = incident.id!;
      incidentCountMetric.primaryEntityType = ServiceType.Incident;
      incidentCountMetric.name = IncidentMetricType.IncidentCount;
      incidentCountMetric.metricPointId = IncidentMetricType.IncidentCount;
      incidentCountMetric.value = 1;
      incidentCountMetric.attributes = { ...baseMetricAttributes };
      incidentCountMetric.attributeKeys = TelemetryUtil.getAttributeKeys(
        incidentCountMetric.attributes,
      );

      incidentCountMetric.time = incidentStartsAt;
      incidentCountMetric.timeUnixNano = OneUptimeDate.toUnixNano(
        incidentCountMetric.time,
      );
      incidentCountMetric.metricPointType = MetricPointType.Sum;
      incidentCountMetric.retentionDate = incidentMetricRetentionDate;

      itemsToSave.push(incidentCountMetric);

      // Always register the metric type so it shows up in the type catalog.
      const metricType: MetricType = new MetricType();
      metricType.name = IncidentMetricType.IncidentCount;
      metricType.description = "Number of incidents created";
      metricType.unit = "";
      metricType.services = [];

      metricTypesMap[IncidentMetricType.IncidentCount] = metricType;

      // is the incident acknowledged?
      const isIncidentAcknowledged: boolean = incidentStateTimelines.some(
        (timeline: IncidentStateTimeline) => {
          return timeline.incidentState?.isAcknowledgedState;
        },
      );

      if (isIncidentAcknowledged) {
        const ackIncidentStateTimeline: IncidentStateTimeline | undefined =
          incidentStateTimelines.find((timeline: IncidentStateTimeline) => {
            return timeline.incidentState?.isAcknowledgedState;
          });

        if (ackIncidentStateTimeline) {
          // register the metric type so the catalog stays complete across refreshes.
          const metricType: MetricType = new MetricType();
          metricType.name = IncidentMetricType.TimeToAcknowledge;
          metricType.description = "Time taken to acknowledge the incident";
          metricType.unit = "seconds";
          metricTypesMap[IncidentMetricType.TimeToAcknowledge] = metricType;

          const timeToAcknowledgeMetric: MutableMetric = new MutableMetric();

          timeToAcknowledgeMetric.projectId = incident.projectId;
          timeToAcknowledgeMetric.primaryEntityId = incident.id!;
          timeToAcknowledgeMetric.primaryEntityType = ServiceType.Incident;
          timeToAcknowledgeMetric.name = IncidentMetricType.TimeToAcknowledge;
          timeToAcknowledgeMetric.metricPointId =
            IncidentMetricType.TimeToAcknowledge;
          timeToAcknowledgeMetric.value = OneUptimeDate.getDifferenceInSeconds(
            ackIncidentStateTimeline?.startsAt ||
              OneUptimeDate.getCurrentDate(),
            incidentStartsAt,
          );
          // aiInvestigated: the MTTA with/without-AI dimension.
          timeToAcknowledgeMetric.attributes = {
            ...baseMetricAttributes,
            aiInvestigated: aiInvestigated.toString(),
          };
          timeToAcknowledgeMetric.attributeKeys =
            TelemetryUtil.getAttributeKeys(timeToAcknowledgeMetric.attributes);

          timeToAcknowledgeMetric.time =
            ackIncidentStateTimeline?.startsAt ||
            incident.declaredAt ||
            incident.createdAt ||
            OneUptimeDate.getCurrentDate();
          timeToAcknowledgeMetric.timeUnixNano = OneUptimeDate.toUnixNano(
            timeToAcknowledgeMetric.time,
          );
          timeToAcknowledgeMetric.metricPointType = MetricPointType.Sum;
          timeToAcknowledgeMetric.retentionDate = incidentMetricRetentionDate;

          itemsToSave.push(timeToAcknowledgeMetric);
        }
      }

      // time to resolve
      const isIncidentResolved: boolean = incidentStateTimelines.some(
        (timeline: IncidentStateTimeline) => {
          return timeline.incidentState?.isResolvedState;
        },
      );

      const resolvedIncidentStateTimeline: IncidentStateTimeline | undefined =
        incidentStateTimelines.find((timeline: IncidentStateTimeline) => {
          return timeline.incidentState?.isResolvedState;
        });

      if (isIncidentResolved && resolvedIncidentStateTimeline) {
        // register the metric type so the catalog stays complete across refreshes.
        const metricType: MetricType = new MetricType();
        metricType.name = IncidentMetricType.TimeToResolve;
        metricType.description = "Time taken to resolve the incident";
        metricType.unit = "seconds";
        metricTypesMap[IncidentMetricType.TimeToResolve] = metricType;

        const timeToResolveMetric: MutableMetric = new MutableMetric();

        timeToResolveMetric.projectId = incident.projectId;
        timeToResolveMetric.primaryEntityId = incident.id!;
        timeToResolveMetric.primaryEntityType = ServiceType.Incident;
        timeToResolveMetric.name = IncidentMetricType.TimeToResolve;
        timeToResolveMetric.metricPointId = IncidentMetricType.TimeToResolve;
        timeToResolveMetric.value = OneUptimeDate.getDifferenceInSeconds(
          resolvedIncidentStateTimeline?.startsAt ||
            OneUptimeDate.getCurrentDate(),
          incidentStartsAt,
        );
        // aiInvestigated: the MTTR with/without-AI dimension.
        timeToResolveMetric.attributes = {
          ...baseMetricAttributes,
          aiInvestigated: aiInvestigated.toString(),
        };
        timeToResolveMetric.attributeKeys = TelemetryUtil.getAttributeKeys(
          timeToResolveMetric.attributes,
        );

        timeToResolveMetric.time =
          resolvedIncidentStateTimeline?.startsAt ||
          incident.declaredAt ||
          incident.createdAt ||
          OneUptimeDate.getCurrentDate();
        timeToResolveMetric.timeUnixNano = OneUptimeDate.toUnixNano(
          timeToResolveMetric.time,
        );
        timeToResolveMetric.metricPointType = MetricPointType.Sum;
        timeToResolveMetric.retentionDate = incidentMetricRetentionDate;

        itemsToSave.push(timeToResolveMetric);
      }

      if (isIncidentResolved && resolvedIncidentStateTimeline) {
        // register the metric type so the catalog stays complete across refreshes.
        const metricType: MetricType = new MetricType();
        metricType.name = IncidentMetricType.IncidentDuration;
        metricType.description = "Duration of the incident";
        metricType.unit = "seconds";
        metricTypesMap[IncidentMetricType.IncidentDuration] = metricType;

        const incidentEndsAt: Date =
          resolvedIncidentStateTimeline.startsAt ||
          OneUptimeDate.getCurrentDate();

        const incidentDurationMetric: MutableMetric = new MutableMetric();

        incidentDurationMetric.projectId = incident.projectId;
        incidentDurationMetric.primaryEntityId = incident.id!;
        incidentDurationMetric.primaryEntityType = ServiceType.Incident;
        incidentDurationMetric.name = IncidentMetricType.IncidentDuration;
        incidentDurationMetric.metricPointId =
          IncidentMetricType.IncidentDuration;
        incidentDurationMetric.value = OneUptimeDate.getDifferenceInSeconds(
          incidentEndsAt,
          incidentStartsAt,
        );
        incidentDurationMetric.attributes = { ...baseMetricAttributes };
        incidentDurationMetric.attributeKeys = TelemetryUtil.getAttributeKeys(
          incidentDurationMetric.attributes,
        );

        incidentDurationMetric.time = incidentEndsAt;
        incidentDurationMetric.timeUnixNano = OneUptimeDate.toUnixNano(
          incidentDurationMetric.time,
        );
        incidentDurationMetric.metricPointType = MetricPointType.Sum;
        incidentDurationMetric.retentionDate = incidentMetricRetentionDate;

        itemsToSave.push(incidentDurationMetric);

        if (incident.postmortemPostedAt) {
          const postmortemMetricType: MetricType = new MetricType();
          postmortemMetricType.name =
            IncidentMetricType.PostmortemCompletionTime;
          postmortemMetricType.description =
            "Time from incident resolution to postmortem publication";
          postmortemMetricType.unit = "seconds";
          metricTypesMap[IncidentMetricType.PostmortemCompletionTime] =
            postmortemMetricType;

          const postmortemMetric: MutableMetric = new MutableMetric();

          postmortemMetric.projectId = incident.projectId;
          postmortemMetric.primaryEntityId = incident.id!;
          postmortemMetric.primaryEntityType = ServiceType.Incident;
          postmortemMetric.name = IncidentMetricType.PostmortemCompletionTime;
          postmortemMetric.metricPointId =
            IncidentMetricType.PostmortemCompletionTime;
          postmortemMetric.value = OneUptimeDate.getDifferenceInSeconds(
            incident.postmortemPostedAt,
            incidentEndsAt,
          );
          postmortemMetric.attributes = { ...baseMetricAttributes };
          postmortemMetric.attributeKeys = TelemetryUtil.getAttributeKeys(
            postmortemMetric.attributes,
          );
          postmortemMetric.time = incident.postmortemPostedAt;
          postmortemMetric.timeUnixNano = OneUptimeDate.toUnixNano(
            postmortemMetric.time,
          );
          postmortemMetric.metricPointType = MetricPointType.Sum;
          postmortemMetric.retentionDate = incidentMetricRetentionDate;

          itemsToSave.push(postmortemMetric);
        }
      }

      // time-in-state metrics — emit one metric per state transition that has a completed duration
      for (const timeline of incidentStateTimelines) {
        if (!timeline.startsAt || !timeline.endsAt) {
          continue;
        }

        const stateName: string =
          timeline.incidentState?.name?.toString() || "Unknown";

        const timeInStateMetric: MutableMetric = new MutableMetric();

        timeInStateMetric.projectId = incident.projectId;
        timeInStateMetric.primaryEntityId = incident.id!;
        timeInStateMetric.primaryEntityType = ServiceType.Incident;
        timeInStateMetric.name = IncidentMetricType.TimeInState;
        timeInStateMetric.metricPointId = `time-in-state:${timeline.id!.toString()}`;
        timeInStateMetric.value = OneUptimeDate.getDifferenceInSeconds(
          timeline.endsAt,
          timeline.startsAt,
        );
        timeInStateMetric.attributes = {
          ...baseMetricAttributes,
          incidentStateName: stateName,
          incidentStateId: timeline.incidentStateId?.toString(),
          isCreatedState:
            timeline.incidentState?.isCreatedState?.toString() || "false",
          isAcknowledgedState:
            timeline.incidentState?.isAcknowledgedState?.toString() || "false",
          isResolvedState:
            timeline.incidentState?.isResolvedState?.toString() || "false",
        };
        timeInStateMetric.attributeKeys = TelemetryUtil.getAttributeKeys(
          timeInStateMetric.attributes,
        );

        timeInStateMetric.time = timeline.startsAt;
        timeInStateMetric.timeUnixNano = OneUptimeDate.toUnixNano(
          timeInStateMetric.time,
        );
        timeInStateMetric.metricPointType = MetricPointType.Sum;
        timeInStateMetric.retentionDate = incidentMetricRetentionDate;

        itemsToSave.push(timeInStateMetric);
      }

      // add metric type for time-in-state to map (only once)
      if (
        incidentStateTimelines.some((t: IncidentStateTimeline) => {
          return t.startsAt && t.endsAt;
        })
      ) {
        const timeInStateMetricType: MetricType = new MetricType();
        timeInStateMetricType.name = IncidentMetricType.TimeInState;
        timeInStateMetricType.description =
          "Time spent in each incident state (e.g. Created, Investigating, Acknowledged)";
        timeInStateMetricType.unit = "seconds";
        metricTypesMap[timeInStateMetricType.name] = timeInStateMetricType;
      }

      await MutableMetricService.replaceEntityMetrics({
        projectId: incident.projectId,
        primaryEntityId: incident.id!,
        primaryEntityType: ServiceType.Incident,
        metricNames: [
          IncidentMetricType.IncidentCount,
          IncidentMetricType.TimeToAcknowledge,
          IncidentMetricType.TimeToResolve,
          IncidentMetricType.IncidentDuration,
          IncidentMetricType.TimeInState,
          IncidentMetricType.PostmortemCompletionTime,
        ],
        metrics: itemsToSave,
        retentionDate: incidentMetricRetentionDate,
      });

      TelemetryUtil.indexMetricNameServiceNameMap({
        metricNameServiceNameMap: metricTypesMap,
        projectId: incident.projectId,
      }).catch((err: Error) => {
        logger.error(err, {
          projectId: incident.projectId?.toString(),
          incidentId: incident.id?.toString(),
        } as LogAttributes);
      });
    } finally {
      if (metricRefreshMutex) {
        try {
          await Semaphore.release(metricRefreshMutex);
        } catch (err) {
          logger.error(
            err as Error,
            {
              projectId: incident.projectId?.toString(),
              incidentId: incident.id?.toString(),
            } as LogAttributes,
          );
        }
      }
    }
  }

  @CaptureSpan()
  public async getWorkspaceChannelForIncident(data: {
    incidentId: ObjectID;
    workspaceType?: WorkspaceType | null;
  }): Promise<Array<NotificationRuleWorkspaceChannel>> {
    const incident: Model | null = await this.findOneById({
      id: data.incidentId,
      select: {
        postUpdatesToWorkspaceChannels: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!incident) {
      throw new BadDataException("Incident not found.");
    }

    return (incident.postUpdatesToWorkspaceChannels || []).filter(
      (channel: NotificationRuleWorkspaceChannel) => {
        if (!data.workspaceType) {
          return true;
        }

        return channel.workspaceType === data.workspaceType;
      },
    );
  }

  @CaptureSpan()
  public async getIncidentNumber(data: { incidentId: ObjectID }): Promise<{
    number: number | null;
    numberWithPrefix: string | null;
  }> {
    const incident: Model | null = await this.findOneById({
      id: data.incidentId,
      select: {
        incidentNumber: true,
        incidentNumberWithPrefix: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!incident) {
      throw new BadDataException("Incident not found.");
    }

    return {
      number: incident.incidentNumber ? Number(incident.incidentNumber) : null,
      numberWithPrefix: incident.incidentNumberWithPrefix || null,
    };
  }

  /**
   * Ensures the currentIncidentStateId of the incident matches the latest timeline entry.
   */
  public async refreshIncidentCurrentStatus(
    incidentId: ObjectID,
  ): Promise<void> {
    const incident: Model | null = await this.findOneById({
      id: incidentId,
      select: {
        _id: true,
        projectId: true,
        currentIncidentStateId: true,
      },
      props: { isRoot: true },
    });
    if (!incident || !incident.projectId) {
      return;
    }
    const latestTimeline: IncidentStateTimeline | null =
      await IncidentStateTimelineService.findOneBy({
        query: {
          incidentId: incident.id!,
          projectId: incident.projectId,
        },
        sort: {
          startsAt: SortOrder.Descending,
        },
        select: {
          incidentStateId: true,
        },
        props: {
          isRoot: true,
        },
      });
    if (
      latestTimeline &&
      latestTimeline.incidentStateId &&
      incident.currentIncidentStateId?.toString() !==
        latestTimeline.incidentStateId.toString()
    ) {
      await this.updateOneBy({
        query: { _id: incident.id!.toString() },
        data: {
          currentIncidentStateId: latestTimeline.incidentStateId,
        },
        props: { isRoot: true },
      });
      logger.info(
        `Updated Incident ${incident.id} current state to ${latestTimeline.incidentStateId}`,
        {
          projectId: incident.projectId?.toString(),
          incidentId: incident.id?.toString(),
        } as LogAttributes,
      );
    }
  }

  @CaptureSpan()
  public async generatePostmortemFromAI(data: {
    incidentId: ObjectID;
    template?: string;
  }): Promise<string> {
    // Get the incident to verify it exists and get the project ID
    const incident: Model | null = await this.findOneById({
      id: data.incidentId,
      select: {
        _id: true,
        projectId: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!incident || !incident.projectId) {
      throw new BadDataException("Incident not found");
    }

    /*
     * The project's AI kill switch, at the service layer rather than only on
     * the HTTP handler above it. This method is public and has a second
     * caller (IncidentPostmortemRunner), so gating the route alone would
     * leave the switch true for one entry point and false for the other.
     * Checking here also refuses BEFORE the context builder below, which
     * reads the whole incident dossier — private notes, workspace messages —
     * to assemble a prompt this project has said it does not want sent.
     */
    await AIService.assertProjectAIEnabled(incident.projectId);

    // Build incident context - always include workspace messages
    const contextData: IncidentContextData =
      await IncidentAIContextBuilder.buildIncidentContext({
        incidentId: data.incidentId,
        includeWorkspaceMessages: true,
        workspaceMessageLimit: 500,
      });

    // Format context for postmortem generation
    const aiContext: AIGenerationContext =
      IncidentAIContextBuilder.formatIncidentContextForPostmortem(
        contextData,
        data.template,
      );

    /*
     * Route through AIService so the call is metered, billed and budget-
     * checked like every other AI feature — the previous direct
     * LLMService.getCompletion bypassed LlmLog and cloud billing entirely.
     * Previews stay off: the prompt embeds incident context (including
     * private notes and workspace messages) whose read ACLs are narrower
     * than LlmLog's (G8).
     */
    const response: AILogResponse = await AIService.executeWithLogging({
      projectId: incident.projectId,
      feature: "Incident Postmortem",
      incidentId: data.incidentId,
      messages: aiContext.messages,
      temperature: 0.2,
      storeContentPreviews: false,
    });

    return response.content;
  }
}

export default new Service();
