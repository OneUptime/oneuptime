import DatabaseConfig from "../DatabaseConfig";
import MeasurementMetricWriter from "../Utils/Measurement/MeasurementMetricWriter";
import NumberPrefixUtil from "../../Utils/Project/NumberPrefix";
import AlertMeasurementService from "./AlertMeasurementService";
import CountBy from "../Types/Database/CountBy";
import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import FindBy from "../Types/Database/FindBy";
import { OnCreate, OnDelete, OnFind, OnUpdate } from "../Types/Database/Hooks";
import QueryHelper from "../Types/Database/QueryHelper";
import UpdateBy from "../Types/Database/UpdateBy";
import { applyAlertSelfPrivacyFilter } from "../Utils/Alert/AlertPrivacyFilter";
import DatabaseService from "./DatabaseService";
import ProjectReferencesService from "./ProjectReferencesService";
import AlertCustomField from "../../Models/DatabaseModels/AlertCustomField";
import CustomFieldMappingService from "./CustomFieldMappingService";
import AlertOwnerTeamService from "./AlertOwnerTeamService";
import AlertOwnerUserService from "./AlertOwnerUserService";
import AlertStateService from "./AlertStateService";
import AlertStateTimelineService from "./AlertStateTimelineService";
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
import UserNotificationEventType from "../../Types/UserNotification/UserNotificationEventType";
import Model from "../../Models/DatabaseModels/Alert";
import AlertOwnerTeam from "../../Models/DatabaseModels/AlertOwnerTeam";
import AlertOwnerUser from "../../Models/DatabaseModels/AlertOwnerUser";
import AlertState from "../../Models/DatabaseModels/AlertState";
import Monitor from "../../Models/DatabaseModels/Monitor";
import MonitorStatusService from "./MonitorStatusService";
import ProjectScopedReferenceValidator, {
  getWrittenRelationReferences,
  HeldRelationIds,
  ProjectScopedReference,
  ProjectScopedRelation,
  resolveReferenceIds,
} from "../Utils/Database/ProjectScopedReferenceValidator";
import {
  getAffectedResourceColumns,
  getAffectedResourceRelations,
} from "../Utils/Database/AffectedResourceRelations";
import RelationIdUtil from "../Utils/Database/RelationIdUtil";
import ReferenceChange from "../Utils/Database/ReferenceChange";
import EventFieldChange, {
  EventFieldSet,
  EventValuesBeforeUpdate,
} from "../Utils/EventFieldChange";
import CreatedByUser from "../Utils/Database/CreatedByUser";
import EpisodeMembershipReference, {
  ALERT_EPISODE_REFERENCE,
} from "../Utils/Episode/EpisodeMembershipReference";
import Query from "../Types/Database/Query";
import Select from "../Types/Database/Select";
import DatabaseBaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import SloRecordReferenceValidator from "../Utils/Slo/SloRecordReferenceValidator";
import AlertStateTimeline from "../../Models/DatabaseModels/AlertStateTimeline";
import User from "../../Models/DatabaseModels/User";
import { IsBillingEnabled } from "../EnvironmentConfig";
import logger, { LogAttributes } from "../Utils/Logger";
import Semaphore, { SemaphoreMutex } from "../Infrastructure/Semaphore";
import TelemetryUtil from "../Utils/Telemetry/Telemetry";
import MetricResourceAttributeUtil from "../../Utils/Metrics/MetricResourceAttributeUtil";
import MutableMetricService from "./MutableMetricService";
import GlobalConfigService from "./GlobalConfigService";
import GlobalConfig from "../../Models/DatabaseModels/GlobalConfig";
import OneUptimeDate from "../../Types/Date";
import MutableMetric from "../../Models/AnalyticsModels/MutableMetric";
import { MetricPointType } from "../../Models/AnalyticsModels/Metric";
import ServiceType from "../../Types/Telemetry/ServiceType";
import AlertMetricType from "../../Types/Alerts/AlertMetricType";
import AlertMeasurementValueService from "./AlertMeasurementValueService";
import AlertFeedService from "./AlertFeedService";
import { AlertFeedEventType } from "../../Models/DatabaseModels/AlertFeed";
import { Gray500, Red500 } from "../../Types/BrandColors";
import Label from "../../Models/DatabaseModels/Label";
import LabelService from "./LabelService";
import AlertSeverity from "../../Models/DatabaseModels/AlertSeverity";
import AlertSeverityService from "./AlertSeverityService";
import AlertReminderRuleService from "./AlertReminderRuleService";
import AlertReminderRule from "../../Models/DatabaseModels/AlertReminderRule";
import WorkspaceType from "../../Types/Workspace/WorkspaceType";
import NotificationRuleWorkspaceChannel from "../../Types/Workspace/NotificationRules/NotificationRuleWorkspaceChannel";
import AlertWorkspaceMessages from "../Utils/Workspace/WorkspaceMessages/Alert";
import ServiceLevelObjective from "../../Models/DatabaseModels/ServiceLevelObjective";
import MonitorService from "./MonitorService";
import { MessageBlocksByWorkspaceType } from "./WorkspaceNotificationRuleService";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import MetricType from "../../Models/DatabaseModels/MetricType";
import Dictionary from "../../Types/Dictionary";
import OnCallDutyPolicy from "../../Models/DatabaseModels/OnCallDutyPolicy";
import AlertGroupingEngineService from "./AlertGroupingEngineService";
import AlertLabelRuleEngineService from "./AlertLabelRuleEngineService";
import AlertOnCallRuleEngineService from "./AlertOnCallRuleEngineService";
import AlertOwnerRuleEngineService from "./AlertOwnerRuleEngineService";
import RunbookRuleEngineService from "./RunbookRuleEngineService";
import AutoRemediationRuleEngineService from "./AutoRemediationRuleEngineService";
import AIAlertInvestigationRunner from "../Utils/AI/SRE/AlertInvestigationRunner";
import OwnerRuleAssignment from "../Utils/Rules/OwnerRuleAssignment";
import AlertPrivacyRuleEngineService from "./AlertPrivacyRuleEngineService";
import ProjectService from "./ProjectService";
import OnCallNotRunOnCreate from "../Utils/OnCall/OnCallNotRunOnCreate";
import StartingStageUtil, {
  StartingStage,
  StartingStageCarryForward,
  StartingState,
} from "../../Utils/StartingStage";
import ResolvedStateUtil from "../../Utils/ResolvedState";
import {
  escapeMarkdownInline,
  escapeMarkdownValue,
} from "../../Utils/Markdown/MarkdownEscape";
import { StateListType } from "../../Utils/StateOrder";

/*
 * The two spellings a write of an alert's monitor arrives under: the FK
 * column from the API and server code, the relation object from the
 * dashboard's forms (see RelationIdUtil).
 */
const ALERT_MONITOR_KEYS: Array<string> = ["monitorId", "monitor"];

/*
 * The two names of the other references this service reads off a write
 * itself, ID column first. A write may name a reference under either, and
 * the two must agree (RelationIdUtil.readConsistent), so what the service
 * checks and acts on is what is stored.
 */
const ALERT_STATE_KEYS: Array<string> = [
  "currentAlertStateId",
  "currentAlertState",
];
const ALERT_SEVERITY_KEYS: Array<string> = ["alertSeverityId", "alertSeverity"];

/*
 * What an update does to one alert's monitor: sets it, moves it or clears
 * it. An alert whose monitor the update leaves as it was has none.
 */
interface AlertMonitorChange {
  oldMonitorId: ObjectID | null;
  newMonitorId: ObjectID | null;
}

/*
 * Handed from onBeforeUpdate to onUpdateSuccess. Once the update has run the
 * row holds what the update wrote, so what it held before is only known from
 * the reads made before the write.
 */
interface AlertUpdateCarryForward {
  // Keyed by alert id.
  monitorChanges: Dictionary<AlertMonitorChange>;
  /*
   * The severity each alert held before the update (null: none), keyed by
   * alert id, read only when the update writes one
   * (recordStoredValuesBeforeUpdate).
   */
  severityIdsBeforeUpdate: Dictionary<string | null>;
  /*
   * The title, root cause, description, remediation notes, labels and Send
   * reminders switch each alert held before the update - those the update
   * writes, and no others - keyed by alert id, so its feed item and its
   * reminder refresh follow a real change (recordStoredValuesBeforeUpdate,
   * EventFieldChange). Empty when the update writes none of them.
   */
  valuesBeforeUpdate?: Dictionary<EventValuesBeforeUpdate> | undefined;
}

// What the one read before an update holds, keyed by alert id.
interface AlertStoredValues {
  severityIdsBeforeUpdate: Dictionary<string | null>;
  valuesBeforeUpdate: Dictionary<EventValuesBeforeUpdate>;
}

export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
    if (IsBillingEnabled) {
      this.hardDeleteItemsOlderThanInDays("createdAt", 3 * 365); // 3 years
    }
  }

  /*
   * The severity, the monitor status and the monitor, the on-call
   * policies, the labels, the SLOs and the affected-resource lists are checked
   * by this service's own hooks below, with ProjectScopedReferenceValidator and
   * its own words. Everything else an alert names - its episode, its state, the
   * probe that opened it - is checked by ProjectReferencesService.
   */
  protected override getRelationsCheckedByService(): Array<string> {
    return ["alertSeverity", "monitorStatusWhenThisAlertWasCreated", "monitor"];
  }

  protected override getListsCheckedByService(): Array<string> {
    return [
      "labels",
      "onCallDutyPolicies",
      "serviceLevelObjectives",
      ...getAffectedResourceColumns(this.getModel()),
    ];
  }

  /*
   * Whether the alert is acknowledged or further along - resolved included:
   * what stops its on-call escalation. Read with the one rule
   * (StartingStage): at or below the acknowledged state, or flagged
   * acknowledged or resolved.
   */
  @CaptureSpan()
  public async isAlertAcknowledged(data: {
    alertId: ObjectID;
  }): Promise<boolean> {
    const alert: Model = await this.getAlertWithState(data.alertId);

    if (!alert.currentAlertStateId) {
      return false;
    }

    const startingState: StartingState | null =
      await AlertStateService.getStartingState({
        projectId: alert.projectId!,
        alertStateId: alert.currentAlertStateId,
      });

    return Boolean(startingState && startingState.stage !== StartingStage.Open);
  }

  // The alert's project and current state, as OneUptime.
  private async getAlertWithState(alertId: ObjectID): Promise<Model> {
    const alert: Model | null = await this.findOneBy({
      query: {
        _id: alertId,
      },
      select: {
        projectId: true,
        currentAlertStateId: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!alert) {
      throw new BadDataException("Alert not found");
    }

    if (!alert.projectId) {
      throw new BadDataException("Alert Project ID not found");
    }

    return alert;
  }

  @CaptureSpan()
  public async refreshReminderSchedule(data: {
    alertId: ObjectID;
    projectId: ObjectID;
  }): Promise<void> {
    const alert: Model | null = await this.findOneById({
      id: data.alertId,
      select: {
        enableReminders: true,
        alertSeverityId: true,
        labels: {
          _id: true,
        },
      },
      props: {
        isRoot: true,
      },
    });

    if (!alert) {
      return;
    }

    let nextReminderNotificationAt: Date | null = null;

    if (alert.enableReminders !== false) {
      const matchingRule: AlertReminderRule | null =
        await AlertReminderRuleService.findMatchingRule({
          projectId: data.projectId,
          alertSeverityId: alert.alertSeverityId,
          labelIds: alert.labels?.map((label: Label) => {
            return label.id!;
          }),
        });

      if (
        matchingRule &&
        matchingRule.reminderIntervalInMinutes &&
        !(await this.isAlertResolved({ alertId: data.alertId }))
      ) {
        nextReminderNotificationAt = OneUptimeDate.addRemoveMinutes(
          OneUptimeDate.getCurrentDate(),
          matchingRule.reminderIntervalInMinutes,
        );
      }
    }

    await this.updateOneById({
      id: data.alertId,
      data: {
        nextReminderNotificationAt: nextReminderNotificationAt,
      },
      props: {
        isRoot: true,
      },
    });
  }

  @CaptureSpan()
  public async acknowledgeAlert(
    alertId: ObjectID,
    acknowledgedByUserId: ObjectID,
  ): Promise<void> {
    const alert: Model | null = await this.findOneById({
      id: alertId,
      select: {
        projectId: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!alert || !alert.projectId) {
      throw new BadDataException("Alert not found.");
    }

    const alertState: AlertState | null = await AlertStateService.findOneBy({
      query: {
        projectId: alert.projectId,
        isAcknowledgedState: true,
      },
      select: {
        _id: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!alertState || !alertState.id) {
      throw new BadDataException(
        "Acknowledged state not found for this project. Please add acknowledged state from settings.",
      );
    }

    const alertStateTimeline: AlertStateTimeline = new AlertStateTimeline();
    alertStateTimeline.projectId = alert.projectId;
    alertStateTimeline.alertId = alertId;
    alertStateTimeline.alertStateId = alertState.id;
    alertStateTimeline.createdByUserId = acknowledgedByUserId;

    await AlertStateTimelineService.create({
      data: alertStateTimeline,
      props: {
        isRoot: true,
      },
    });
  }

  @CaptureSpan()
  protected override async onBeforeFind(
    findBy: FindBy<Model>,
  ): Promise<OnFind<Model>> {
    findBy.query = applyAlertSelfPrivacyFilter(findBy.query, findBy.props);
    return { findBy, carryForward: null };
  }

  @CaptureSpan()
  public override async countBy(
    countBy: CountBy<Model>,
  ): Promise<PositiveNumber> {
    countBy.query = applyAlertSelfPrivacyFilter(countBy.query, countBy.props);
    return super.countBy(countBy);
  }

  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    await super.onBeforeUpdate(updateBy);

    /*
     * The alert's episode follows its episode membership: only
     * AlertEpisodeMemberService moves it (EpisodeMembershipReference).
     */
    EpisodeMembershipReference.refuseWriteMadeInProject({
      payload: updateBy.data,
      props: updateBy.props,
      reference: ALERT_EPISODE_REFERENCE,
    });

    updateBy.query = applyAlertSelfPrivacyFilter(
      updateBy.query,
      updateBy.props,
    );

    const monitorChanges: Dictionary<AlertMonitorChange> =
      await this.getMonitorChangesForUpdate(updateBy);

    await this.validateProjectScopedReferences(updateBy);

    /*
     * Two cases, one call. The Custom Fields modal saves the WHOLE bag back
     * (it has no server-side merge), so a mapped value would be clobbered by
     * any manual edit of a neighbouring field; and re-pointing the alert at
     * another monitor changes what the mapped fields should hold. Both are
     * folded into this payload so the row is written once, with an audit entry,
     * workflow payload and realtime event that carry the value that was
     * actually stored.
     */
    await CustomFieldMappingService.applyMappingsToUpdate({
      definitionModelType: AlertCustomField,
      updateBy: updateBy,
    });

    const storedValues: AlertStoredValues =
      await this.recordStoredValuesBeforeUpdate(updateBy);

    const carryForward: AlertUpdateCarryForward = {
      monitorChanges: monitorChanges,
      severityIdsBeforeUpdate: storedValues.severityIdsBeforeUpdate,
      valuesBeforeUpdate: storedValues.valuesBeforeUpdate,
    };

    return { updateBy, carryForward: carryForward };
  }

  /*
   * What onUpdateSuccess compares an update with: each alert it matches as
   * it is stored, read here, before the write, so a side effect follows a
   * real change only. Updates often write back what an alert holds - the
   * dashboard's cards send every field they show with each save, and an API
   * client or a workflow may write the whole alert. One read, of the
   * columns the update needs compared and no others, and only when it needs
   * any:
   *
   * - the severity, when the update writes one under either of its names. A
   *   severity change records itself in the alert feed and re-matches the
   *   reminder rule (ReferenceChange);
   * - the title, root cause, description, remediation notes, labels and
   *   Send reminders switch the update writes. The "Alert updated" feed item
   *   records each one that really changed, and a labels change or the
   *   switch flipped matches the reminder rule again, which starts the
   *   reminder interval over (EventFieldChange).
   */
  private async recordStoredValuesBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<AlertStoredValues> {
    const storedValues: AlertStoredValues = {
      severityIdsBeforeUpdate: {},
      valuesBeforeUpdate: {},
    };

    const writtenSeverityId: ObjectID | null = RelationIdUtil.readConsistent(
      updateBy.data as unknown as Record<string, unknown>,
      ALERT_SEVERITY_KEYS,
      "Alert Severity",
    );

    const fieldsWritten: EventFieldSet = EventFieldChange.getFieldsWritten(
      updateBy.data as unknown as Record<string, unknown>,
    );

    const isFieldWritten: boolean = EventFieldChange.isAnySet(fieldsWritten);

    if (!writtenSeverityId && !isFieldWritten) {
      return storedValues;
    }

    const alerts: Array<Model> = await this.findAlertsForUpdateHook({
      updateBy: updateBy,
      select: {
        _id: true,
        ...(writtenSeverityId
          ? {
              alertSeverityId: true,
            }
          : {}),
        ...(EventFieldChange.getSelect(fieldsWritten) as Select<Model>),
      },
    });

    for (const alert of alerts) {
      if (!alert.id) {
        continue;
      }

      const alertId: string = alert.id.toString();

      if (writtenSeverityId) {
        storedValues.severityIdsBeforeUpdate[alertId] = alert.alertSeverityId
          ? alert.alertSeverityId.toString()
          : null;
      }

      if (isFieldWritten) {
        storedValues.valuesBeforeUpdate[alertId] =
          EventFieldChange.getValuesBeforeUpdate({
            record: alert,
            fields: fieldsWritten,
          });
      }
    }

    return storedValues;
  }

  /*
   * A manual alert's monitor can be set, changed or cleared after the alert
   * is created. An alert raised automatically keeps the monitor it was raised
   * with:
   *
   *   - Raised by a monitor, it keeps that one. The monitor finds its open
   *     alerts by monitor (MonitorAlert): it dedupes each new breach against
   *     them and resolves them when it recovers. Moved to another monitor, or
   *     cleared, the alert would never be resolved automatically, and the
   *     monitor it came from would raise a duplicate on its next breach.
   *   - Raised without one (an SLO burn-rate or security-event alert), or left
   *     without one when its monitor was deleted, it gets none. A monitor
   *     attached to it would find it among its own open alerts though it
   *     never raised it, and the rule above would then lock the alert to that
   *     monitor for good.
   *
   * Every caller is checked, root included: the workflow "Update Alert"
   * component writes as root, and no server code moves an alert's monitor on
   * update.
   *
   * Returns what the update does to each matched alert's monitor, for the
   * feed and the metrics in onUpdateSuccess. An update that does not write
   * the monitor reads nothing.
   */
  private async getMonitorChangesForUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<Dictionary<AlertMonitorChange>> {
    const data: Record<string, unknown> = updateBy.data as Record<
      string,
      unknown
    >;

    /*
     * An explicit null clears the monitor, so it is a write. An undefined
     * value is not: TypeORM leaves such a column as it is.
     */
    const isMonitorWritten: boolean = ALERT_MONITOR_KEYS.some(
      (key: string): boolean => {
        return (
          Object.prototype.hasOwnProperty.call(data, key) &&
          data[key] !== undefined
        );
      },
    );

    if (!isMonitorWritten) {
      return {};
    }

    /*
     * readConsistent, not read: when a payload spells the monitor both ways
     * and they disagree, TypeORM writes whichever one it prefers, so the
     * payload is refused rather than judged on the spelling read first.
     */
    const newMonitorId: ObjectID | null = RelationIdUtil.readConsistent(
      data,
      ALERT_MONITOR_KEYS,
      "Monitor",
    );

    const alerts: Array<Model> = await this.findAlertsForUpdateHook({
      updateBy: updateBy,
      select: {
        _id: true,
        isCreatedAutomatically: true,
        monitorId: true,
      },
    });

    const monitorChanges: Dictionary<AlertMonitorChange> = {};

    for (const alert of alerts) {
      const oldMonitorId: ObjectID | null = alert.monitorId || null;

      if (this.isSameMonitorId(oldMonitorId, newMonitorId)) {
        continue;
      }

      /*
       * Only a real change gets here. Re-saving what the alert already has
       * passes, including the null of an automatic alert with no monitor:
       * the dashboard hides the Monitor field for such an alert, but
       * ModelForm still submits the value it loaded.
       *
       * The message for an alert with no monitor says only that it has none,
       * not that it was raised without one: a monitor's alert whose monitor
       * was deleted reaches it too.
       */
      if (alert.isCreatedAutomatically) {
        throw new BadDataException(
          oldMonitorId
            ? "This alert was raised automatically by its monitor, so its monitor cannot be changed or removed. That monitor resolves the alert when it recovers: moved to another monitor, the alert would stay open, and the monitor would raise a duplicate alert on its next breach."
            : "This alert was raised automatically and has no monitor, so a monitor cannot be attached to it. An alert raised automatically cannot be given a monitor after it is raised.",
        );
      }

      monitorChanges[alert.id!.toString()] = {
        oldMonitorId: oldMonitorId,
        newMonitorId: newMonitorId,
      };
    }

    return monitorChanges;
  }

  /*
   * Postgres answers a uuid in lower case, and an API caller may send the
   * same id in upper case, so re-saving the monitor an alert already has must
   * not read as a change.
   */
  private isSameMonitorId(
    first: ObjectID | null,
    second: ObjectID | null,
  ): boolean {
    return (
      (first?.toString() || "").toLowerCase() ===
      (second?.toString() || "").toLowerCase()
    );
  }

  /*
   * The alerts an update will write to, as they are stored, for the check
   * above.
   *
   * Read as root: the answer only decides whether the update may go ahead,
   * and the update itself is still checked against the caller's permissions
   * afterwards. Reading with the caller's props would fail the whole edit for
   * a role that may edit alerts but not read these columns. The query already
   * carries the caller's privacy filter (applyAlertSelfPrivacyFilter), but
   * not their tenant: the update's permission check adds it only after this
   * hook runs. So a non-root caller's read is limited to their own project
   * here, or a request for another project's alert id would be answered with
   * that alert's state (a refusal that depends on it) instead of the usual
   * "nothing updated".
   */
  private async findAlertsForUpdateHook(data: {
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
   * An update can repoint an alert at another project's state, severity or
   * monitor status just as easily as a create can, and the result is the same:
   * the referenced project can no longer be deleted. Only the columns actually
   * being written are checked, so ordinary updates cost no extra queries.
   */
  private async validateProjectScopedReferences(
    updateBy: UpdateBy<Model>,
  ): Promise<void> {
    /*
     * The state, the severity, the monitor status and the monitor, each by
     * both of its names: the API takes the ID column and the relation alike,
     * and every name that holds an id is checked. Two names that disagree
     * are refused before anything is read.
     */
    const references: Array<ProjectScopedReference> = this.getWrittenReferences(
      updateBy.data,
    );

    /*
     * The SLOs this alert affects: a relation list the API accepts on update.
     * Checked for the same reason as on create; see
     * SloRecordReferenceValidator.
     */
    const hasServiceLevelObjectiveIds: boolean =
      SloRecordReferenceValidator.getReferencedIds(
        updateBy.data.serviceLevelObjectives,
      ).length > 0;

    /*
     * The on-call policies, labels and affected-resource lists, when the
     * update rewrites them. An empty list only removes rows and needs no
     * check.
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
     * project of each alert the query actually matches.
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
            subject: "alert",
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
        subject: "alert",
        references: referencesInProject,
      });
    }
  }

  /*
   * The state, the severity, the monitor status and the monitor an alert
   * write names, each by both of its names (getWrittenRelationReferences):
   * every name that holds an id is a reference to check, and two names that
   * disagree are refused. On a create, the state is the one the write
   * picked, if any, and only when where it starts did not already find it
   * among the project's states (onBeforeCreate).
   */
  private getWrittenReferences(
    data: unknown,
    options: { withState: boolean } = { withState: true },
  ): Array<ProjectScopedReference> {
    return [
      ...(options.withState
        ? getWrittenRelationReferences({
            payload: data,
            idColumn: "currentAlertStateId",
            relation: "currentAlertState",
            modelName: "Alert State",
            service: AlertStateService,
          })
        : []),
      ...getWrittenRelationReferences({
        payload: data,
        idColumn: "alertSeverityId",
        relation: "alertSeverity",
        modelName: "Alert Severity",
        service: AlertSeverityService,
      }),
      ...getWrittenRelationReferences({
        payload: data,
        idColumn: "monitorStatusWhenThisAlertWasCreatedId",
        relation: "monitorStatusWhenThisAlertWasCreated",
        modelName: "Monitor Status",
        service: MonitorStatusService,
      }),
      ...getWrittenRelationReferences({
        payload: data,
        idColumn: "monitorId",
        relation: "monitor",
        modelName: "Monitor",
        service: MonitorService,
      }),
    ];
  }

  /*
   * The many-to-many lists whose ids must belong to the alert's project.
   * Built per call rather than at module load: these services sit in an
   * import graph that loops back to this one, and a module-level table would
   * capture whichever of them had not finished loading yet as undefined.
   */
  private getProjectScopedRelations(): Array<ProjectScopedRelation> {
    return [
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
      ...getAffectedResourceRelations(this.getModel()),
    ];
  }

  private async getProjectIdsForUpdateQuery(
    updateBy: UpdateBy<Model>,
  ): Promise<Array<ObjectID>> {
    const alerts: Array<Model> = await this.findBy({
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

    for (const alert of alerts) {
      if (alert.projectId) {
        projectIds[alert.projectId.toString()] = alert.projectId;
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
     * A new alert is in no episode: it joins one through grouping or the
     * episode's members (EpisodeMembershipReference). Refused before the
     * alert number is taken.
     */
    EpisodeMembershipReference.refuseWriteMadeInProject({
      payload: createBy.data,
      props: createBy.props,
      reference: ALERT_EPISODE_REFERENCE,
    });

    if (!createBy.props.tenantId && !createBy.props.isRoot) {
      throw new BadDataException("ProjectId required to create alert.");
    }

    const projectId: ObjectID =
      createBy.props.tenantId || createBy.data.projectId!;

    const createData: Record<string, unknown> =
      createBy.data as unknown as Record<string, unknown>;

    /*
     * The state the alert starts in, when the write picks one: the Create
     * Alert form's Initial State sends the relation, the API, Terraform and
     * workflows the ID column. Either name, and the two must agree. The pick
     * is checked against the project below, and a state of another project
     * is refused like any of the alert's other references. With none
     * picked, the alert starts in the project's created state, where every
     * alert a monitor raises starts.
     */
    const pickedAlertStateId: ObjectID | null = RelationIdUtil.readConsistent(
      createData,
      ALERT_STATE_KEYS,
      "Alert State",
    );

    /*
     * Where it starts (StartingStage), read once, here, and handed to
     * onCreateSuccess, which decides on it what the create sets off: an
     * alert recorded already acknowledged pages nobody, and one recorded
     * resolved also sets off nothing that answers a live problem. The read
     * holds only the project's own states, so it also checks the state
     * picked: one it finds needs no other check below. With none picked the
     * alert starts in the created state - open, as every alert a monitor
     * raises - and there is nothing to read.
     */
    const pickedStart: StartingState | null = pickedAlertStateId
      ? await AlertStateService.getStartingState({
          projectId: projectId,
          alertStateId: pickedAlertStateId,
        })
      : null;

    const startingStage: StartingStage =
      pickedStart?.stage || StartingStage.Open;

    /*
     * The state picked, the severity and the monitor status stamped on the
     * alert come from the create form, the monitor criteria or the API
     * caller, none of which checked that the record belongs to this project.
     * Persisting another project's id leaves that project undeletable, so
     * reject it here.
     *
     * The monitor, on-call policies and labels are checked too, for a worse
     * reason: onCreateSuccess executes every listed on-call policy, so
     * another project's policy here would page that project's on-call for
     * this project's alert, and the alert's feed (read as root) would name
     * another project's monitor. The affected-resource lists likewise: see
     * getAffectedResourceRelations.
     *
     * Runs before the counter increment so a rejected create does not burn an
     * alert number.
     */
    await ProjectScopedReferenceValidator.validateReferencesBelongToProject({
      projectId: projectId,
      subject: "alert",
      references: [
        /*
         * The state as the write picked it, unless the read above found it
         * among the project's states: one it did not find is refused here,
         * with the alert's other references and in the same words. The
         * created state stamped below is the project's own and needs no
         * check.
         */
        ...this.getWrittenReferences(createBy.data, {
          withState: !pickedStart,
        }),
        ...ProjectScopedReferenceValidator.getRelationReferences({
          payload: createBy.data,
          relations: this.getProjectScopedRelations(),
        }),
      ],
    });

    /*
     * The SLOs this alert affects. The burn-rate worker links its own
     * same-project SLO as root, but the column is writable by API callers too.
     * Another project's SLO would put that SLO's name into this project's
     * feed, lists and metrics. Before the counter increment, like the check
     * above.
     */
    await SloRecordReferenceValidator.validateServiceLevelObjectivesBelongToProject(
      {
        projectId: projectId,
        subject: "alert",
        serviceLevelObjectives: createBy.data.serviceLevelObjectives,
      },
    );

    /*
     * The state it starts in, under the ID column alone: stamp leaves no
     * other name of it to be stored instead, so the state checked above is
     * the state stored - and the state onCreateSuccess writes the alert's
     * first timeline row in. The created state is looked up only when the
     * write picked none.
     */
    RelationIdUtil.stamp(
      createData,
      ALERT_STATE_KEYS,
      pickedAlertStateId ||
        (await AlertStateService.getCreatedAlertStateId(projectId)),
    );

    /*
     * Custom fields configured to inherit from the alert's monitor are stamped
     * here rather than in onCreateSuccess: `customFields` is a column on this
     * very row, and the onCreateSuccess chain below is un-awaited and runs
     * after the API response, so a value written there would be missing from
     * the alert the caller is handed back. Before the counter increment, for
     * the reason given above — although applyMappingsToCreate is written not
     * to throw, because a custom field failing to inherit must never stop an
     * alert from being opened.
     */
    await CustomFieldMappingService.applyMappingsToCreate({
      definitionModelType: AlertCustomField,
      createBy: createBy,
    });

    const alertCounterResult: {
      counter: number;
      prefix: string | undefined;
    } = await ProjectService.incrementAndGetAlertCounter(projectId);

    createBy.data.alertNumber = alertCounterResult.counter;
    createBy.data.alertNumberWithPrefix = NumberPrefixUtil.formatNumber(
      alertCounterResult.prefix,
      alertCounterResult.counter,
    );

    // Who raised it, under either name of it: see CreatedByUser.
    const raisedByUserId: ObjectID | null = CreatedByUser.getId(
      createBy.data,
      createBy.props,
    );

    if (raisedByUserId && !createBy.data.rootCause) {
      createBy.data.rootCause = `Alert created by ${await UserService.getUserMarkdownString(
        {
          userId: raisedByUserId,
          projectId: projectId,
        },
      )}`;
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

    if (!createdItem.currentAlertStateId) {
      throw new BadDataException("currentAlertStateId is required");
    }

    /*
     * How far along the alert starts, as onBeforeCreate read it
     * (StartingStage). Created already acknowledged, no on-call policy runs;
     * created resolved, it is over, and nothing below that answers a live
     * problem runs either: no channel, runbook, grouping, AI investigation
     * or remediation. Its rules, its owners, its feed and its first state
     * still happen.
     */
    const startingStage: StartingStage = StartingStageUtil.fromCarryForward(
      onCreate.carryForward,
    );
    const isOngoing: boolean = StartingStageUtil.isOngoing(startingStage);

    /*
     * Whether an AI investigation run was enqueued for this alert — set by
     * the investigation step below and read by the auto-remediation step
     * after it: an enqueued investigation DEFERS remediation until the run
     * settles (RCA-first ordering, see RemediationHandoff).
     */
    let aiInvestigationEnqueued: boolean = false;

    // Execute operations sequentially with error handling
    Promise.resolve()
      .then(async () => {
        /*
         * Apply privacy rules BEFORE workspace operations so the workspace
         * channel is created with the correct privacy setting. This may set
         * createdItem.isPrivate=true in memory.
         */
        try {
          await AlertPrivacyRuleEngineService.applyRulesToAlert(createdItem);
        } catch (error) {
          logger.error(
            `Apply alert privacy rules failed in AlertService.onCreateSuccess: ${error}`,
            {
              projectId: createdItem.projectId?.toString(),
              alertId: createdItem.id?.toString(),
            } as LogAttributes,
          );
        }
      })
      .then(async () => {
        /*
         * No channel is opened for an alert created resolved. Its created
         * feed entry still goes to the channels the workspace rules name.
         */
        if (createdItem.projectId && createdItem.id && isOngoing) {
          try {
            return await this.handleAlertWorkspaceOperationsAsync(createdItem);
          } catch (error) {
            logger.error(
              `Workspace operations failed in AlertService.onCreateSuccess: ${error}`,
              {
                projectId: createdItem.projectId?.toString(),
                alertId: createdItem.id?.toString(),
              } as LogAttributes,
            );
            return Promise.resolve();
          }
        }
        return Promise.resolve();
      })
      .then(async () => {
        try {
          return await this.createAlertFeedAsync(createdItem.id!);
        } catch (error) {
          logger.error(
            `Create alert feed failed in AlertService.onCreateSuccess: ${error}`,
            {
              projectId: createdItem.projectId?.toString(),
              alertId: createdItem.id?.toString(),
            } as LogAttributes,
          );
          return Promise.resolve(); // Continue chain even on error
        }
      })
      .then(async () => {
        try {
          return await this.handleAlertStateChangeAsync(createdItem);
        } catch (error) {
          logger.error(
            `Handle alert state change failed in AlertService.onCreateSuccess: ${error}`,
            {
              projectId: createdItem.projectId?.toString(),
              alertId: createdItem.id?.toString(),
            } as LogAttributes,
          );
          return Promise.resolve(); // Continue chain even on error
        }
      })
      .then(async () => {
        try {
          if (
            onCreate.createBy.miscDataProps &&
            (onCreate.createBy.miscDataProps["ownerTeams"] ||
              onCreate.createBy.miscDataProps["ownerUsers"])
          ) {
            return await this.addOwners(
              createdItem.projectId!,
              createdItem.id!,
              (onCreate.createBy.miscDataProps![
                "ownerUsers"
              ] as Array<ObjectID>) || [],
              (onCreate.createBy.miscDataProps![
                "ownerTeams"
              ] as Array<ObjectID>) || [],
              false,
              onCreate.createBy.props,
            );
          }
          return Promise.resolve();
        } catch (error) {
          logger.error(
            `Add owners failed in AlertService.onCreateSuccess: ${error}`,
            {
              projectId: createdItem.projectId?.toString(),
              alertId: createdItem.id?.toString(),
            } as LogAttributes,
          );
          return Promise.resolve(); // Continue chain even on error
        }
      })
      .then(async () => {
        // Apply owner rules: add matched owner users/teams to the alert.
        try {
          await AlertOwnerRuleEngineService.applyRulesToAlert(createdItem);
        } catch (error) {
          logger.error(
            `Apply alert owner rules failed in AlertService.onCreateSuccess: ${error}`,
            {
              projectId: createdItem.projectId?.toString(),
              alertId: createdItem.id?.toString(),
            } as LogAttributes,
          );
        }
      })
      .then(async () => {
        // Apply label rules: attach matched (and inherited monitor) labels.
        try {
          await AlertLabelRuleEngineService.applyRulesToAlert(createdItem);
        } catch (error) {
          logger.error(
            `Apply alert label rules failed in AlertService.onCreateSuccess: ${error}`,
            {
              projectId: createdItem.projectId?.toString(),
              alertId: createdItem.id?.toString(),
            } as LogAttributes,
          );
        }
      })
      .then(async () => {
        /*
         * Apply on-call rules: match alert against AlertOnCallRule rows and
         * merge their on-call policies into createdItem.onCallDutyPolicies
         * before the fan-out below picks up the merged list.
         */
        try {
          await AlertOnCallRuleEngineService.applyRulesToAlert(createdItem);
        } catch (error) {
          logger.error(
            `Apply alert on-call rules failed in AlertService.onCreateSuccess: ${error}`,
            {
              projectId: createdItem.projectId?.toString(),
              alertId: createdItem.id?.toString(),
            } as LogAttributes,
          );
        }
      })
      .then(async () => {
        // No runbook is started for an alert created resolved.
        if (!isOngoing) {
          return;
        }

        try {
          await RunbookRuleEngineService.applyRulesToAlert(createdItem);
        } catch (error) {
          logger.error(
            `Apply runbook rules failed in AlertService.onCreateSuccess: ${error}`,
            {
              projectId: createdItem.projectId?.toString(),
              alertId: createdItem.id?.toString(),
            } as LogAttributes,
          );
        }
      })
      .then(async () => {
        if (
          createdItem.onCallDutyPolicies?.length &&
          createdItem.onCallDutyPolicies?.length > 0
        ) {
          try {
            return await this.executeAlertOnCallDutyPoliciesAsync(
              createdItem,
              startingStage,
            );
          } catch (error) {
            logger.error(
              `On-call duty policy execution failed in AlertService.onCreateSuccess: ${error}`,
              {
                projectId: createdItem.projectId?.toString(),
                alertId: createdItem.id?.toString(),
              } as LogAttributes,
            );
            return Promise.resolve();
          }
        }
        return Promise.resolve();
      })
      .then(async () => {
        /*
         * Process alert for grouping into episodes - unless it was created
         * resolved: it is over. One created already acknowledged may join an
         * episode that is open, but never opens or reopens one
         * (GroupingOptions): a new episode runs its own on-call policies, and
         * would page for the alert after all.
         */
        if (!isOngoing) {
          return;
        }

        try {
          await AlertGroupingEngineService.processAlert(createdItem, {
            mayOpenEpisode: StartingStageUtil.pagesOnCall(startingStage),
          });
        } catch (error) {
          logger.error(
            `Alert grouping failed in AlertService.onCreateSuccess: ${error}`,
            {
              projectId: createdItem.projectId?.toString(),
              alertId: createdItem.id?.toString(),
            } as LogAttributes,
          );
          return Promise.resolve();
        }
      })
      .then(async () => {
        // Schedule reminder notifications for alert if a matching reminder rule exists
        try {
          if (createdItem.projectId && createdItem.id) {
            await this.refreshReminderSchedule({
              alertId: createdItem.id,
              projectId: createdItem.projectId,
            });
          }
        } catch (error) {
          logger.error(
            `Reminder scheduling failed in AlertService.onCreateSuccess: ${error}`,
            {
              projectId: createdItem.projectId?.toString(),
              alertId: createdItem.id?.toString(),
            } as LogAttributes,
          );
        }
      })
      .then(async () => {
        /*
         * AI (AI SRE): automatically investigate the new alert and post a
         * cited root cause analysis to the alert timeline + Slack/Teams. Runs
         * last, is gated per project (opt-in) + requires an LLM provider, and is
         * read-only.
         */
        try {
          if (createdItem.projectId && createdItem.id) {
            /*
             * An alert created resolved was over before it was recorded:
             * nothing to investigate. The runner records why on its AI card -
             * after what stops OneUptime AI for the whole project, such as AI
             * being off, which the card then names instead.
             */
            aiInvestigationEnqueued =
              await AIAlertInvestigationRunner.investigateNewAlert({
                alertId: createdItem.id,
                projectId: createdItem.projectId,
                createdResolved: !isOngoing,
              });
          }
        } catch (error) {
          logger.error(
            `AI alert investigation failed in AlertService.onCreateSuccess: ${error}`,
            {
              projectId: createdItem.projectId?.toString(),
              alertId: createdItem.id?.toString(),
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
        // Nothing is left to remediate for an alert created resolved.
        if (!isOngoing) {
          return;
        }

        try {
          await AutoRemediationRuleEngineService.onAlertCreated({
            alert: createdItem,
            isInvestigationQueued: aiInvestigationEnqueued,
          });
        } catch (error) {
          logger.error(
            `Apply auto-remediation rules failed in AlertService.onCreateSuccess: ${error}`,
            {
              projectId: createdItem.projectId?.toString(),
              alertId: createdItem.id?.toString(),
            } as LogAttributes,
          );
        }
      })
      .catch((error: Error) => {
        logger.error(
          `Critical error in AlertService sequential operations: ${error}`,
          {
            projectId: createdItem.projectId?.toString(),
            alertId: createdItem.id?.toString(),
          } as LogAttributes,
        );
      });

    return createdItem;
  }

  @CaptureSpan()
  private async handleAlertWorkspaceOperationsAsync(
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
        await AlertWorkspaceMessages.createChannelsAndInviteUsersToChannels({
          projectId: createdItem.projectId,
          alertId: createdItem.id,
          alertNumber: createdItem.alertNumber!,
          ...(createdItem.alertNumberWithPrefix
            ? { alertNumberWithPrefix: createdItem.alertNumberWithPrefix }
            : {}),
          isPrivate: createdItem.isPrivate === true,
        });

      logger.debug("Alert created. Workspace result:", {
        projectId: createdItem.projectId?.toString(),
        alertId: createdItem.id?.toString(),
      } as LogAttributes);
      logger.debug(workspaceResult, {
        projectId: createdItem.projectId?.toString(),
        alertId: createdItem.id?.toString(),
      } as LogAttributes);

      if (workspaceResult && workspaceResult.channelsCreated?.length > 0) {
        // update alert with these channels.
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
      logger.error(`Error in handleAlertWorkspaceOperationsAsync: ${error}`, {
        projectId: createdItem.projectId?.toString(),
        alertId: createdItem.id?.toString(),
      } as LogAttributes);
      throw error;
    }
  }

  @CaptureSpan()
  private async createAlertFeedAsync(alertId: ObjectID): Promise<void> {
    try {
      // Get alert data for feed creation
      const alert: Model | null = await this.findOneById({
        id: alertId,
        select: {
          projectId: true,
          alertNumber: true,
          alertNumberWithPrefix: true,
          title: true,
          description: true,
          alertSeverity: {
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
          currentAlertState: {
            name: true,
          },
          labels: {
            name: true,
          },
        },
        props: {
          isRoot: true,
        },
      });

      if (!alert) {
        throw new BadDataException("Alert not found");
      }

      const createdByUserId: ObjectID | undefined | null =
        alert.createdByUserId || alert.createdByUser?.id;

      /*
       * The title is plain text, and often not typed by a person at all: a
       * monitor fills it in from what it watched - the subject and sender of
       * an incoming email, a field of an incoming request, a response body.
       * It is placed into Markdown that the dashboard renders without its
       * safe mode and that is posted to Slack and Teams, so it is escaped as
       * MarkdownEscape says a title must be (as the incident's "Incident
       * Created" item escapes its title): "[Reset your password](...)"
       * arrives as those characters, "![](https://tracker...)" is not
       * fetched and "<!here>" or "<@U123>" mentions nobody, while "Site 03 -
       * payments (EU)" reads unchanged. The state and severity names are
       * plain text too. The description stays Markdown: that is what it is
       * written in.
       */
      let feedInfoInMarkdown: string = `#### 🚨 Alert ${alert.alertNumberWithPrefix || "#" + alert.alertNumber?.toString()} Created:
           
**${escapeMarkdownValue(alert.title || "No title provided.")}**:
     
${alert.description || "No description provided."}
     
`;

      if (alert.currentAlertState?.name) {
        feedInfoInMarkdown += `🔴 **Alert State**: ${escapeMarkdownValue(alert.currentAlertState.name)} \n\n`;
      }

      if (alert.alertSeverity?.name) {
        feedInfoInMarkdown += `⚠️ **Severity**: ${escapeMarkdownValue(alert.alertSeverity.name)} \n\n`;
      }

      /*
       * Everything the alert's Affected Resources card lists: its monitor,
       * the hosts, clusters and services it is attached to, then its SLOs. A
       * burn-rate alert has no monitor, so its SLO is the only resource there
       * is to name - and the feed's only way back to the objective that
       * raised it.
       */
      const resources: Array<LinkedAffectedResource> =
        await LinkedAffectedResources.readForAlert({
          service: this,
          projectId: alert.projectId!,
          alertId: alert.id!,
        });

      if (resources.length > 0) {
        feedInfoInMarkdown += `🌎 **Resources Affected**:\n`;

        for (const resourceLine of LinkedAffectedResources.getMarkdownLines({
          dashboardUrl: await DatabaseConfig.getDashboardUrl(),
          projectId: alert.projectId!,
          resources: resources,
        })) {
          feedInfoInMarkdown += `${resourceLine}\n`;
        }

        feedInfoInMarkdown += `\n\n`;
      }

      if (alert.rootCause) {
        feedInfoInMarkdown += `\n
📄 **Root Cause**:
     
${alert.rootCause || "No root cause provided."}
     
`;
      }

      if (alert.remediationNotes) {
        feedInfoInMarkdown += `\n 
🎯 **Remediation Notes**:
     
${alert.remediationNotes || "No remediation notes provided."}
     
     
     `;
      }

      const alertCreateMessageBlocks: Array<MessageBlocksByWorkspaceType> =
        await AlertWorkspaceMessages.getAlertCreateMessageBlocks({
          alertId: alert.id!,
          projectId: alert.projectId!,
        });

      await AlertFeedService.createAlertFeedItem({
        alertId: alert.id!,
        projectId: alert.projectId!,
        alertFeedEventType: AlertFeedEventType.AlertCreated,
        displayColor: Red500,
        feedInfoInMarkdown: feedInfoInMarkdown,
        userId: createdByUserId || undefined,
        workspaceNotification: {
          appendMessageBlocks: alertCreateMessageBlocks,
          sendWorkspaceNotification: true,
        },
      });
    } catch (error) {
      logger.error(`Error in createAlertFeedAsync: ${error}`, {
        alertId: alertId?.toString(),
      } as LogAttributes);
      throw error;
    }
  }

  @CaptureSpan()
  private async handleAlertStateChangeAsync(createdItem: Model): Promise<void> {
    try {
      if (!createdItem.projectId || !createdItem.id) {
        throw new BadDataException(
          "projectId and id are required for state change",
        );
      }

      await this.changeAlertState({
        projectId: createdItem.projectId,
        alertId: createdItem.id,
        alertStateId: createdItem.currentAlertStateId!,
        notifyOwners: false,
        rootCause: createdItem.rootCause,
        stateChangeLog: createdItem.createdStateLog,
        props: {
          isRoot: true,
        },
      });
    } catch (error) {
      logger.error(`Error in handleAlertStateChangeAsync: ${error}`, {
        projectId: createdItem.projectId?.toString(),
        alertId: createdItem.id?.toString(),
      } as LogAttributes);
      throw error;
    }
  }

  /*
   * Runs the alert's on-call policies - the ones its create named and the
   * ones its on-call rules added - when it starts open. Created already
   * acknowledged or resolved, somebody is on it or it is over: none of them
   * runs, and its feed says so instead, naming them (OnCallNotRunOnCreate).
   */
  @CaptureSpan()
  private async executeAlertOnCallDutyPoliciesAsync(
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
            record: { alertId: createdItem.id! },
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
                triggeredByAlertId: createdItem.id!,
                userNotificationEventType:
                  UserNotificationEventType.AlertCreated,
              },
            );
          });

        await Promise.allSettled(policyPromises);
      }
    } catch (error) {
      logger.error(`Error in executeAlertOnCallDutyPoliciesAsync: ${error}`, {
        projectId: createdItem.projectId?.toString(),
        alertId: createdItem.id?.toString(),
      } as LogAttributes);
      throw error;
    }
  }

  @CaptureSpan()
  public async getWorkspaceChannelForAlert(data: {
    alertId: ObjectID;
    workspaceType?: WorkspaceType | null;
  }): Promise<Array<NotificationRuleWorkspaceChannel>> {
    const alert: Model | null = await this.findOneById({
      id: data.alertId,
      select: {
        postUpdatesToWorkspaceChannels: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!alert) {
      throw new BadDataException("Alert not found.");
    }

    return (alert.postUpdatesToWorkspaceChannels || []).filter(
      (channel: NotificationRuleWorkspaceChannel) => {
        if (!data.workspaceType) {
          return true;
        }

        return channel.workspaceType === data.workspaceType;
      },
    );
  }

  @CaptureSpan()
  public async getAlertIdentifiedDate(alertId: ObjectID): Promise<Date> {
    const timeline: AlertStateTimeline | null =
      await AlertStateTimelineService.findOneBy({
        query: {
          alertId: alertId,
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
     * The identified-state timeline is created asynchronously after the alert
     * is committed (see onCreateSuccess), so it may not exist yet, or may be
     * missing entirely if that step failed. Fall back to the alert's creation
     * date instead of throwing, otherwise the owner-notification cron fails
     * permanently for this alert and retries every minute forever.
     */
    const alert: Model | null = await this.findOneById({
      id: alertId,
      select: {
        createdAt: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (alert && alert.createdAt) {
      return alert.createdAt;
    }

    throw new BadDataException("Alert identified date not found.");
  }

  @CaptureSpan()
  public async findOwners(alertId: ObjectID): Promise<Array<User>> {
    if (!alertId) {
      throw new BadDataException("alertId is required");
    }

    const ownerUsers: Array<AlertOwnerUser> =
      await AlertOwnerUserService.findBy({
        query: {
          alertId: alertId,
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

    const ownerTeams: Array<AlertOwnerTeam> =
      await AlertOwnerTeamService.findBy({
        query: {
          alertId: alertId,
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
      ownerUsers.map((ownerUser: AlertOwnerUser) => {
        return ownerUser.user!;
      }) || [];

    if (ownerTeams.length > 0) {
      const teamIds: Array<ObjectID> =
        ownerTeams.map((ownerTeam: AlertOwnerTeam) => {
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
    alertId: ObjectID,
    userIds: Array<ObjectID>,
    teamIds: Array<ObjectID>,
    notifyOwners: boolean,
    props: DatabaseCommonInteractionProps,
  ): Promise<void> {
    // Owners already on the alert are skipped, not added a second time.
    await OwnerRuleAssignment.addOwners({
      ownerUserService: AlertOwnerUserService,
      ownerTeamService: AlertOwnerTeamService,
      resourceIdColumn: "alertId",
      resourceId: alertId,
      projectId: projectId,
      userIds: userIds,
      teamIds: teamIds,
      isOwnerNotified: !notifyOwners,
      props: props,
    });
  }

  @CaptureSpan()
  public async getAlertLinkInDashboard(
    projectId: ObjectID,
    alertId: ObjectID,
  ): Promise<URL> {
    const dashboardUrl: URL = await DatabaseConfig.getDashboardUrl();

    return URL.fromString(dashboardUrl.toString()).addRoute(
      `/${projectId.toString()}/alerts/${alertId.toString()}`,
    );
  }

  @CaptureSpan()
  protected override async onUpdateSuccess(
    onUpdate: OnUpdate<Model>,
    updatedItemIds: ObjectID[],
  ): Promise<OnUpdate<Model>> {
    CustomFieldMappingService.restampAfterMultiRowUpdate({
      definitionModelType: AlertCustomField,
      updateBy: onUpdate.updateBy,
      updatedItemIds: updatedItemIds,
    });

    /*
     * Correcting a timestamp is the whole point of making these fields
     * editable, so the numbers derived from them have to move. Without this
     * the metric refresh fires only from the state-timeline hooks, and a
     * corrected impactStartedAt leaves every derived value stale for good.
     */
    const anchorTimestampChanged: boolean = ["impactStartedAt"].some(
      (key: string) => {
        return Object.prototype.hasOwnProperty.call(
          onUpdate.updateBy.data,
          key,
        );
      },
    );

    // Only the alerts whose monitor this update actually set, moved or cleared.
    const monitorChanges: Dictionary<AlertMonitorChange> =
      (onUpdate.carryForward as AlertUpdateCarryForward | null | undefined)
        ?.monitorChanges || {};

    // What each alert held before the write, when the update writes a severity.
    const severityIdsBeforeUpdate: Dictionary<string | null> =
      (onUpdate.carryForward as AlertUpdateCarryForward | null | undefined)
        ?.severityIdsBeforeUpdate || {};

    /*
     * The title, root cause, description, remediation notes, labels and Send
     * reminders switch each alert held before the write, for those the
     * update writes.
     */
    const valuesBeforeUpdate: Dictionary<EventValuesBeforeUpdate> =
      (onUpdate.carryForward as AlertUpdateCarryForward | null | undefined)
        ?.valuesBeforeUpdate || {};

    for (const itemId of updatedItemIds) {
      /*
       * Every alert metric and measurement point is stamped with the alert's
       * monitor id and name, so an alert whose monitor moved is stamped
       * again.
       */
      if (!anchorTimestampChanged && !monitorChanges[itemId.toString()]) {
        continue;
      }

      /*
       * Side by side, not one in the other's failure handler: the
       * measurement values hang off the same anchors and carry the same
       * monitor, so they are recomputed whether or not the refresh works.
       * Neither is awaited; a derived number must not fail the edit.
       */
      this.refreshAlertMetrics({ alertId: itemId }).catch((err: Error) => {
        logger.error(err);
      });

      AlertMeasurementValueService.recomputeForAlert({
        alertId: itemId,
      }).catch((err: Error) => {
        logger.error(err);
      });
    }

    /*
     * The state the update wrote, under either of its names: onBeforeUpdate
     * refused two that disagree, so this reads one value.
     */
    const updatedAlertStateId: ObjectID | null = RelationIdUtil.readConsistent(
      onUpdate.updateBy.data as unknown as Record<string, unknown>,
      ALERT_STATE_KEYS,
      "Alert State",
    );

    /*
     * The severity the update wrote, under either of its names: the
     * dashboard's forms send the relation, the API, Terraform, workflows and
     * the AI tools the ID column, and onBeforeUpdate refused two that
     * disagree. Its feed entry and reminder refresh run for each alert whose
     * severity this changed - compared with the severity it held before the
     * write (recordStoredValuesBeforeUpdate) - so writing back the severity an
     * alert holds runs neither.
     */
    const writtenAlertSeverityId: ObjectID | null =
      RelationIdUtil.readConsistent(
        onUpdate.updateBy.data as unknown as Record<string, unknown>,
        ALERT_SEVERITY_KEYS,
        "Alert Severity",
      );

    if (updatedAlertStateId && onUpdate.updateBy.props.tenantId) {
      for (const itemId of updatedItemIds) {
        await this.changeAlertState({
          projectId: onUpdate.updateBy.props.tenantId as ObjectID,
          alertId: itemId,
          alertStateId: updatedAlertStateId,
          notifyOwners: true,
          rootCause: "This status was changed when the alert was updated.",
          stateChangeLog: undefined,
          props: {
            isRoot: true,
          },
        });
      }
    }

    if (updatedItemIds.length > 0) {
      const monitorsById: Dictionary<Monitor> =
        await this.getMonitorsForFeed(monitorChanges);

      for (const alertId of updatedItemIds) {
        let shouldAddAlertFeed: boolean = false;

        /*
         * An alert the read before the write did not see has no entry, and
         * counts as changed (ReferenceChange), so a real change is never
         * missed.
         */
        const isSeverityChanged: boolean = ReferenceChange.isChanged({
          writtenId: writtenAlertSeverityId,
          idBeforeUpdate: severityIdsBeforeUpdate[alertId.toString()],
        });

        const alert: Model | null = await this.findOneById({
          id: alertId,
          select: {
            projectId: true,
            alertNumber: true,
            alertNumberWithPrefix: true,
          },
          props: {
            isRoot: true,
          },
        });

        const projectId: ObjectID = alert!.projectId!;
        const alertNumber: number = alert!.alertNumber!;
        const alertNumberWithPrefix: string | undefined =
          alert!.alertNumberWithPrefix || undefined;

        let feedInfoInMarkdown: string = `**[Alert ${alertNumberWithPrefix || "#" + alertNumber}](${(await this.getAlertLinkInDashboard(projectId!, alertId!)).toString()}) was updated.**`;

        const createdByUserId: ObjectID | undefined | null =
          onUpdate.updateBy.props.userId;

        /*
         * What the update changed of the title, root cause, description,
         * remediation notes, labels and Send reminders switch, against what
         * the alert held before the write (recordStoredValuesBeforeUpdate).
         * An alert the read did not see counts as changed.
         */
        const fieldChanges: EventFieldSet = EventFieldChange.getChanges({
          written: onUpdate.updateBy.data as unknown as Record<string, unknown>,
          valuesBeforeUpdate: valuesBeforeUpdate[alertId.toString()],
        });

        /*
         * A line for each of the title, root cause, description, remediation
         * notes and labels the update really changed: writing back what the
         * alert holds - every save of a card sends its fields - adds none.
         */
        const fieldsMarkdown: string = await EventFieldChange.getFeedMarkdown({
          written: onUpdate.updateBy.data as unknown as Record<string, unknown>,
          changes: fieldChanges,
          projectId: projectId,
          recordName: "Alert",
        });

        if (fieldsMarkdown) {
          feedInfoInMarkdown += fieldsMarkdown;
          shouldAddAlertFeed = true;
        }

        if (isSeverityChanged && writtenAlertSeverityId) {
          const alertSeverity: AlertSeverity | null =
            await AlertSeverityService.findOneBy({
              query: {
                _id: writtenAlertSeverityId,
              },
              select: {
                name: true,
              },
              props: {
                isRoot: true,
              },
            });

          if (alertSeverity) {
            feedInfoInMarkdown += `\n\n**⚠️ Alert Severity**:
${escapeMarkdownValue(alertSeverity.name)}
`;

            shouldAddAlertFeed = true;
          }
        }

        const monitorChange: AlertMonitorChange | undefined =
          monitorChanges[alertId.toString()];

        if (monitorChange) {
          feedInfoInMarkdown += await this.getMonitorChangeFeedMarkdown({
            projectId: projectId,
            monitorChange: monitorChange,
            monitorsById: monitorsById,
          });

          shouldAddAlertFeed = true;
        }

        /*
         * The reminder rule is matched on the severity and the labels, and
         * reminders can be switched on or off. One refresh covers whatever
         * of those the update changed - clearing the labels included - and
         * none runs when it changed none of them: each refresh restarts the
         * interval, so writing back the labels the alert has must not.
         */
        if (
          isSeverityChanged ||
          fieldChanges.labels ||
          fieldChanges.enableReminders
        ) {
          try {
            await this.refreshReminderSchedule({
              alertId: alertId,
              projectId: projectId,
            });
          } catch (reminderError) {
            logger.error(
              `Reminder rescheduling failed in AlertService.onUpdateSuccess: ${reminderError}`,
              {
                projectId: projectId?.toString(),
                alertId: alertId?.toString(),
              } as LogAttributes,
            );
          }
        }

        if (shouldAddAlertFeed) {
          await AlertFeedService.createAlertFeedItem({
            alertId: alertId,
            projectId: onUpdate.updateBy.props.tenantId as ObjectID,
            alertFeedEventType: AlertFeedEventType.AlertUpdated,
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
   * The monitors an update moved alerts from or to, by lower-cased id, read
   * once for every alert it wrote. As root and by id alone: the new monitor
   * was checked against the alert's project before the write, and the old one
   * was the alert's own.
   */
  private async getMonitorsForFeed(
    monitorChanges: Dictionary<AlertMonitorChange>,
  ): Promise<Dictionary<Monitor>> {
    const monitorIds: Dictionary<ObjectID> = {};

    for (const monitorChange of Object.values(monitorChanges)) {
      for (const monitorId of [
        monitorChange.oldMonitorId,
        monitorChange.newMonitorId,
      ]) {
        if (monitorId) {
          monitorIds[monitorId.toString().toLowerCase()] = monitorId;
        }
      }
    }

    if (Object.keys(monitorIds).length === 0) {
      return {};
    }

    const monitors: Array<Monitor> = await MonitorService.findBy({
      query: {
        _id: QueryHelper.any(Object.values(monitorIds)),
      },
      select: {
        _id: true,
        name: true,
      },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    const monitorsById: Dictionary<Monitor> = {};

    for (const monitor of monitors) {
      if (monitor.id) {
        monitorsById[monitor.id.toString().toLowerCase()] = monitor;
      }
    }

    return monitorsById;
  }

  /*
   * The "Alert updated" feed line for a monitor the edit set, moved or
   * cleared, each monitor linked to its dashboard page.
   */
  private async getMonitorChangeFeedMarkdown(data: {
    projectId: ObjectID;
    monitorChange: AlertMonitorChange;
    monitorsById: Dictionary<Monitor>;
  }): Promise<string> {
    const oldMonitor: string | null = await this.getMonitorFeedLink({
      projectId: data.projectId,
      monitorId: data.monitorChange.oldMonitorId,
      monitorsById: data.monitorsById,
    });

    const newMonitor: string | null = await this.getMonitorFeedLink({
      projectId: data.projectId,
      monitorId: data.monitorChange.newMonitorId,
      monitorsById: data.monitorsById,
    });

    if (oldMonitor && newMonitor) {
      return `\n\n**🌎 Monitor**: changed from ${oldMonitor} to ${newMonitor}\n`;
    }

    if (newMonitor) {
      return `\n\n**🌎 Monitor**: set to ${newMonitor}\n`;
    }

    if (oldMonitor) {
      return `\n\n**🗑️ Monitor**: ${oldMonitor} removed\n`;
    }

    return "";
  }

  private async getMonitorFeedLink(data: {
    projectId: ObjectID;
    monitorId: ObjectID | null;
    monitorsById: Dictionary<Monitor>;
  }): Promise<string | null> {
    if (!data.monitorId) {
      return null;
    }

    const monitor: Monitor | undefined =
      data.monitorsById[data.monitorId.toString().toLowerCase()];

    /*
     * Deleted between the write and this read. There is no page left to link
     * to, but the line still says the monitor changed.
     */
    if (!monitor) {
      return "an unknown monitor";
    }

    // The name is plain text inside the link's own text.
    return `[${escapeMarkdownInline(monitor.name)}](${(await MonitorService.getMonitorLinkInDashboard(data.projectId, data.monitorId)).toString()})`;
  }

  // Whether another open alert raised by hand is still on the monitor.
  @CaptureSpan()
  public async doesMonitorHasMoreActiveManualAlerts(
    monitorId: ObjectID,
    proojectId: ObjectID,
  ): Promise<boolean> {
    const alertCount: PositiveNumber = await this.countBy({
      query: {
        monitorId: monitorId,
        currentAlertStateId: QueryHelper.any(
          await AlertStateService.getUnresolvedAlertStateIds(proojectId),
        ),
        isCreatedAutomatically: false,
      },
      props: {
        isRoot: true,
      },
    });

    return alertCount.toNumber() > 0;
  }

  @CaptureSpan()
  protected override async onBeforeDelete(
    deleteBy: DeleteBy<Model>,
  ): Promise<OnDelete<Model>> {
    deleteBy.query = applyAlertSelfPrivacyFilter(
      deleteBy.query,
      deleteBy.props,
    );

    const alerts: Array<Model> = await this.findBy({
      query: deleteBy.query,
      limit: LIMIT_MAX,
      skip: 0,
      select: {
        _id: true,
        projectId: true,
        monitor: {
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
        alerts: alerts,
      },
    };
  }

  @CaptureSpan()
  protected override async onDeleteSuccess(
    onDelete: OnDelete<Model>,
    _itemIdsBeforeDelete: ObjectID[],
  ): Promise<OnDelete<Model>> {
    if (onDelete.carryForward && onDelete.carryForward.alerts) {
      for (const alert of onDelete.carryForward.alerts) {
        if (alert.projectId && alert.id) {
          const metricRetentionDays: number =
            await this.getMetricRetentionDays();

          await MutableMetricService.tombstoneEntityMetrics({
            projectId: alert.projectId,
            primaryEntityId: alert.id,
            primaryEntityType: ServiceType.Alert,
            metricNames: Object.values(AlertMetricType),
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
            await AlertMeasurementService.getMetricNamesForProject(
              alert.projectId,
            );

          await MeasurementMetricWriter.tombstoneAll({
            projectId: alert.projectId,
            primaryEntityId: alert.id,
            primaryEntityType: ServiceType.Alert,
            allMeasurementMetricNames: measurementMetricNames,
          });
        }
      }
    }

    return onDelete;
  }

  @CaptureSpan()
  public async changeAlertState(data: {
    projectId: ObjectID;
    alertId: ObjectID;
    alertStateId: ObjectID;
    notifyOwners: boolean;
    rootCause: string | undefined;
    stateChangeLog: JSONObject | undefined;
    /*
     * The user the change is credited to (the alert's feed names them), for
     * a change a user asked for that is written on their behalf. Unset for
     * changes the system makes on its own.
     */
    createdByUserId?: ObjectID | undefined;
    props: DatabaseCommonInteractionProps | undefined;
  }): Promise<void> {
    const {
      projectId,
      alertId,
      alertStateId,
      notifyOwners,
      rootCause,
      stateChangeLog,
      createdByUserId,
      props,
    } = data;

    // get last monitor status timeline.
    const lastAlertStatusTimeline: AlertStateTimeline | null =
      await AlertStateTimelineService.findOneBy({
        query: {
          alertId: alertId,
          projectId: projectId,
        },
        select: {
          _id: true,
          alertStateId: true,
        },
        sort: {
          createdAt: SortOrder.Descending,
        },
        props: {
          isRoot: true,
        },
      });

    if (
      lastAlertStatusTimeline &&
      lastAlertStatusTimeline.alertStateId &&
      lastAlertStatusTimeline.alertStateId.toString() ===
        alertStateId.toString()
    ) {
      return;
    }

    const statusTimeline: AlertStateTimeline = new AlertStateTimeline();

    statusTimeline.alertId = alertId;
    statusTimeline.alertStateId = alertStateId;
    statusTimeline.projectId = projectId;
    statusTimeline.isOwnerNotified = !notifyOwners;

    if (stateChangeLog) {
      statusTimeline.stateChangeLog = stateChangeLog;
    }
    if (rootCause) {
      statusTimeline.rootCause = rootCause;
    }

    if (createdByUserId) {
      statusTimeline.createdByUserId = createdByUserId;
    }

    await AlertStateTimelineService.create({
      data: statusTimeline,
      props: props || {},
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

  @CaptureSpan()
  public async refreshAlertMetrics(data: { alertId: ObjectID }): Promise<void> {
    const alert: Model | null = await this.findOneById({
      id: data.alertId,
      select: {
        projectId: true,
        monitor: {
          _id: true,
          name: true,
        },
        /*
         * The SLOs this alert affects, stamped below so an SLO's Metrics page
         * can chart the alerts raised against it. Only _id and name, which
         * the SLO model allows on relation reads.
         */
        serviceLevelObjectives: {
          _id: true,
          name: true,
        },
        alertSeverity: {
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

    if (!alert) {
      throw new BadDataException("Alert not found");
    }

    if (!alert.projectId) {
      throw new BadDataException("Alert Project ID not found");
    }

    // get alert state timeline
    const alertStateTimelines: Array<AlertStateTimeline> =
      await AlertStateTimelineService.findBy({
        query: {
          alertId: data.alertId,
        },
        select: {
          projectId: true,
          alertStateId: true,
          alertState: {
            isAcknowledgedState: true,
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

    // Which of them count as resolved (Common/Utils/ResolvedState).
    const alertStates: Array<AlertState> =
      await AlertStateService.getAllAlertStates({
        projectId: alert.projectId,
        props: {
          isRoot: true,
        },
      });

    const firstAlertStateTimeline: AlertStateTimeline | undefined =
      alertStateTimelines[0];

    /*
     * Serialize concurrent refreshes for this alert across pods. Mutable
     * metrics are versioned inserts, but the replace operation also tombstones
     * stale metric-point identities. The lock keeps that read+insert cycle
     * ordered for each alert.
     */
    let metricRefreshMutex: SemaphoreMutex | null = null;
    try {
      metricRefreshMutex = await Semaphore.lock({
        key: data.alertId.toString(),
        namespace: "AlertService.refreshAlertMetrics",
        lockTimeout: 30000,
      });
    } catch (err) {
      logger.error(
        err as Error,
        {
          projectId: alert.projectId?.toString(),
          alertId: alert.id?.toString(),
        } as LogAttributes,
      );
    }

    try {
      const itemsToSave: Array<MutableMetric> = [];
      const metricTypesMap: Dictionary<MetricType> = {};

      const metricRetentionDays: number = await this.getMetricRetentionDays();
      const alertMetricRetentionDate: Date = OneUptimeDate.addRemoveDays(
        OneUptimeDate.getCurrentDate(),
        metricRetentionDays,
      );

      /*
       * Dimensions shared by every alert metric. Built once so all four
       * metrics below record the identical attribute set — a dashboard that
       * groups by oneuptime.label.product must not find the dimension on
       * AlertCount but missing from TimeToResolve.
       */
      const baseMetricAttributes: JSONObject = {
        alertId: data.alertId.toString(),
        projectId: alert.projectId.toString(),
        monitorId: alert.monitor?._id?.toString(),
        monitorName: alert.monitor?.name?.toString(),
        /*
         * Plural and comma-joined, unlike monitorId: an alert can affect
         * several SLOs. The SLO Metrics page filters its Alert tab on
         * serviceLevelObjectiveIds (SERVICE_LEVEL_OBJECTIVE_IDS_METRIC_ATTRIBUTE
         * in Common/Utils/Slo/SloMetricType), so the key must not be renamed.
         */
        serviceLevelObjectiveIds: (
          alert.serviceLevelObjectives
            ?.map((serviceLevelObjective: ServiceLevelObjective) => {
              return serviceLevelObjective._id?.toString();
            })
            .filter(Boolean) || []
        ).join(", "),
        serviceLevelObjectiveNames: (
          alert.serviceLevelObjectives
            ?.map((serviceLevelObjective: ServiceLevelObjective) => {
              return serviceLevelObjective.name?.toString();
            })
            .filter(Boolean) || []
        ).join(", "),
        alertSeverityId: alert.alertSeverity?._id?.toString(),
        alertSeverityName: alert.alertSeverity?.name?.toString(),
        /*
         * oneuptime.label.* / oneuptime.customField.* — namespaced, so they can
         * never collide with the unprefixed dimensions above.
         */
        ...MetricResourceAttributeUtil.getResourceAttributes({
          labels: alert.labels,
          customFields: alert.customFields,
        }),
      };

      // now we need to create new metrics for this alert - TimeToAcknowledge, TimeToResolve, AlertCount, AlertDuration
      const alertStartsAt: Date =
        firstAlertStateTimeline?.startsAt ||
        alert.createdAt ||
        OneUptimeDate.getCurrentDate();

      // register the metric type so the catalog stays complete across refreshes.
      const alertCountMetricType: MetricType = new MetricType();
      alertCountMetricType.name = AlertMetricType.AlertCount;
      alertCountMetricType.description = "Number of alerts created";
      alertCountMetricType.unit = "";
      alertCountMetricType.services = [];
      metricTypesMap[AlertMetricType.AlertCount] = alertCountMetricType;

      const alertCountMetric: MutableMetric = new MutableMetric();

      alertCountMetric.projectId = alert.projectId;
      alertCountMetric.primaryEntityId = alert.id!;
      alertCountMetric.primaryEntityType = ServiceType.Alert;
      alertCountMetric.name = AlertMetricType.AlertCount;
      alertCountMetric.metricPointId = AlertMetricType.AlertCount;
      alertCountMetric.value = 1;
      alertCountMetric.attributes = { ...baseMetricAttributes };
      alertCountMetric.attributeKeys = TelemetryUtil.getAttributeKeys(
        alertCountMetric.attributes,
      );

      alertCountMetric.time = alertStartsAt;
      alertCountMetric.timeUnixNano = OneUptimeDate.toUnixNano(
        alertCountMetric.time,
      );
      alertCountMetric.metricPointType = MetricPointType.Sum;
      alertCountMetric.retentionDate = alertMetricRetentionDate;

      itemsToSave.push(alertCountMetric);

      // is the alert acknowledged?
      const isAlertAcknowledged: boolean = alertStateTimelines.some(
        (timeline: AlertStateTimeline) => {
          return timeline.alertState?.isAcknowledgedState;
        },
      );

      if (isAlertAcknowledged) {
        const ackAlertStateTimeline: AlertStateTimeline | undefined =
          alertStateTimelines.find((timeline: AlertStateTimeline) => {
            return timeline.alertState?.isAcknowledgedState;
          });

        if (ackAlertStateTimeline) {
          // register the metric type so the catalog stays complete across refreshes.
          const metricType: MetricType = new MetricType();
          metricType.name = AlertMetricType.TimeToAcknowledge;
          metricType.description = "Time taken to acknowledge the alert";
          metricType.unit = "seconds";
          metricTypesMap[AlertMetricType.TimeToAcknowledge] = metricType;

          const timeToAcknowledgeMetric: MutableMetric = new MutableMetric();

          timeToAcknowledgeMetric.projectId = alert.projectId;
          timeToAcknowledgeMetric.primaryEntityId = alert.id!;
          timeToAcknowledgeMetric.primaryEntityType = ServiceType.Alert;
          timeToAcknowledgeMetric.name = AlertMetricType.TimeToAcknowledge;
          timeToAcknowledgeMetric.metricPointId =
            AlertMetricType.TimeToAcknowledge;
          timeToAcknowledgeMetric.value = OneUptimeDate.getDifferenceInSeconds(
            ackAlertStateTimeline?.startsAt || OneUptimeDate.getCurrentDate(),
            alertStartsAt,
          );
          timeToAcknowledgeMetric.attributes = { ...baseMetricAttributes };
          timeToAcknowledgeMetric.attributeKeys =
            TelemetryUtil.getAttributeKeys(timeToAcknowledgeMetric.attributes);

          timeToAcknowledgeMetric.time =
            ackAlertStateTimeline?.startsAt ||
            alert.createdAt ||
            OneUptimeDate.getCurrentDate();
          timeToAcknowledgeMetric.timeUnixNano = OneUptimeDate.toUnixNano(
            timeToAcknowledgeMetric.time,
          );
          timeToAcknowledgeMetric.metricPointType = MetricPointType.Sum;
          timeToAcknowledgeMetric.retentionDate = alertMetricRetentionDate;

          itemsToSave.push(timeToAcknowledgeMetric);
        }
      }

      /*
       * Time to resolve: until the alert first moved into a state that
       * counts as resolved (Common/Utils/ResolvedState) - the project's
       * resolved state, or one placed after it.
       */
      const resolvedAlertStateTimeline: AlertStateTimeline | undefined =
        ResolvedStateUtil.getResolutionRows({
          list: StateListType.AlertState,
          states: alertStates,
          timeline: alertStateTimelines.map((timeline: AlertStateTimeline) => {
            return {
              stateId: timeline.alertStateId,
              startsAt: timeline.startsAt,
              timeline: timeline,
            };
          }),
        })[0]?.timeline;

      const isAlertResolved: boolean = Boolean(resolvedAlertStateTimeline);

      if (isAlertResolved && resolvedAlertStateTimeline) {
        // register the metric type so the catalog stays complete across refreshes.
        const metricType: MetricType = new MetricType();
        metricType.name = AlertMetricType.TimeToResolve;
        metricType.description = "Time taken to resolve the alert";
        metricType.unit = "seconds";
        metricTypesMap[AlertMetricType.TimeToResolve] = metricType;

        const timeToResolveMetric: MutableMetric = new MutableMetric();

        timeToResolveMetric.projectId = alert.projectId;
        timeToResolveMetric.primaryEntityId = alert.id!;
        timeToResolveMetric.primaryEntityType = ServiceType.Alert;
        timeToResolveMetric.name = AlertMetricType.TimeToResolve;
        timeToResolveMetric.metricPointId = AlertMetricType.TimeToResolve;
        timeToResolveMetric.value = OneUptimeDate.getDifferenceInSeconds(
          resolvedAlertStateTimeline?.startsAt ||
            OneUptimeDate.getCurrentDate(),
          alertStartsAt,
        );
        timeToResolveMetric.attributes = { ...baseMetricAttributes };
        timeToResolveMetric.attributeKeys = TelemetryUtil.getAttributeKeys(
          timeToResolveMetric.attributes,
        );

        timeToResolveMetric.time =
          resolvedAlertStateTimeline?.startsAt ||
          alert.createdAt ||
          OneUptimeDate.getCurrentDate();
        timeToResolveMetric.timeUnixNano = OneUptimeDate.toUnixNano(
          timeToResolveMetric.time,
        );
        timeToResolveMetric.metricPointType = MetricPointType.Sum;
        timeToResolveMetric.retentionDate = alertMetricRetentionDate;

        itemsToSave.push(timeToResolveMetric);
      }

      if (isAlertResolved && resolvedAlertStateTimeline) {
        // register the metric type so the catalog stays complete across refreshes.
        const metricType: MetricType = new MetricType();
        metricType.name = AlertMetricType.AlertDuration;
        metricType.description = "Duration of the alert";
        metricType.unit = "seconds";
        metricTypesMap[AlertMetricType.AlertDuration] = metricType;

        const alertEndsAt: Date =
          resolvedAlertStateTimeline.startsAt || OneUptimeDate.getCurrentDate();

        const alertDurationMetric: MutableMetric = new MutableMetric();

        alertDurationMetric.projectId = alert.projectId;
        alertDurationMetric.primaryEntityId = alert.id!;
        alertDurationMetric.primaryEntityType = ServiceType.Alert;
        alertDurationMetric.name = AlertMetricType.AlertDuration;
        alertDurationMetric.metricPointId = AlertMetricType.AlertDuration;
        alertDurationMetric.value = OneUptimeDate.getDifferenceInSeconds(
          alertEndsAt,
          alertStartsAt,
        );
        alertDurationMetric.attributes = { ...baseMetricAttributes };
        alertDurationMetric.attributeKeys = TelemetryUtil.getAttributeKeys(
          alertDurationMetric.attributes,
        );

        alertDurationMetric.time = alertEndsAt;
        alertDurationMetric.timeUnixNano = OneUptimeDate.toUnixNano(
          alertDurationMetric.time,
        );
        alertDurationMetric.metricPointType = MetricPointType.Sum;
        alertDurationMetric.retentionDate = alertMetricRetentionDate;

        itemsToSave.push(alertDurationMetric);
      }

      await MutableMetricService.replaceEntityMetrics({
        projectId: alert.projectId,
        primaryEntityId: alert.id!,
        primaryEntityType: ServiceType.Alert,
        metricNames: Object.values(AlertMetricType),
        metrics: itemsToSave,
        retentionDate: alertMetricRetentionDate,
      });

      TelemetryUtil.indexMetricNameServiceNameMap({
        metricNameServiceNameMap: metricTypesMap,
        projectId: alert.projectId,
      }).catch((err: Error) => {
        logger.error(err, {
          projectId: alert.projectId?.toString(),
          alertId: alert.id?.toString(),
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
              projectId: alert.projectId?.toString(),
              alertId: alert.id?.toString(),
            } as LogAttributes,
          );
        }
      }
    }
  }

  /*
   * Whether the alert is resolved: its state is at or below its project's
   * resolved state, or flagged resolved - the one rule
   * (Common/Utils/ResolvedState) that reminders, Slack, Microsoft Teams,
   * auto-remediation and everything else read.
   */
  @CaptureSpan()
  public async isAlertResolved(data: { alertId: ObjectID }): Promise<boolean> {
    const alert: Model = await this.getAlertWithState(data.alertId);

    if (!alert.currentAlertStateId) {
      return false;
    }

    return await AlertStateService.isResolvedAlertState({
      projectId: alert.projectId!,
      alertStateId: alert.currentAlertStateId,
    });
  }

  @CaptureSpan()
  public async getAlertNumber(data: { alertId: ObjectID }): Promise<{
    number: number | null;
    numberWithPrefix: string | null;
  }> {
    const alert: Model | null = await this.findOneById({
      id: data.alertId,
      select: {
        alertNumber: true,
        alertNumberWithPrefix: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!alert) {
      throw new BadDataException("Alert not found.");
    }

    return {
      number: alert.alertNumber ? Number(alert.alertNumber) : null,
      numberWithPrefix: alert.alertNumberWithPrefix || null,
    };
  }

  @CaptureSpan()
  public async resolveAlert(
    alertId: ObjectID,
    resolvedByUserId: ObjectID,
  ): Promise<Model> {
    const alert: Model | null = await this.findOneById({
      id: alertId,
      select: {
        projectId: true,
        alertNumber: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!alert || !alert.projectId) {
      throw new BadDataException("Alert not found.");
    }

    // The project's resolved state: the first from the top flagged resolved.
    const alertState: AlertState =
      await AlertStateService.getResolvedAlertState({
        projectId: alert.projectId,
        props: {
          isRoot: true,
        },
      });

    if (!alertState.id) {
      throw new BadDataException(
        "Resolved state not found for this project. Please add resolved state from settings.",
      );
    }

    const alertStateTimeline: AlertStateTimeline = new AlertStateTimeline();
    alertStateTimeline.projectId = alert.projectId;
    alertStateTimeline.alertId = alertId;
    alertStateTimeline.alertStateId = alertState.id;
    alertStateTimeline.createdByUserId = resolvedByUserId;

    await AlertStateTimelineService.create({
      data: alertStateTimeline,
      props: {
        isRoot: true,
      },
    });

    // store alert metric

    return alert;
  }

  /**
   * Ensures the currentAlertStateId of the alert matches the latest timeline entry.
   */
  public async refreshAlertCurrentStatus(alertId: ObjectID): Promise<void> {
    const alert: Model | null = await this.findOneById({
      id: alertId,
      select: {
        _id: true,
        projectId: true,
        currentAlertStateId: true,
      },
      props: { isRoot: true },
    });
    if (!alert || !alert.projectId) {
      return;
    }
    const latestTimeline: AlertStateTimeline | null =
      await AlertStateTimelineService.findOneBy({
        query: {
          alertId: alert.id!,
          projectId: alert.projectId,
        },
        sort: {
          startsAt: SortOrder.Descending,
        },
        select: {
          alertStateId: true,
        },
        props: {
          isRoot: true,
        },
      });
    if (
      latestTimeline &&
      latestTimeline.alertStateId &&
      alert.currentAlertStateId?.toString() !==
        latestTimeline.alertStateId.toString()
    ) {
      await this.updateOneBy({
        query: { _id: alert.id!.toString() },
        data: {
          currentAlertStateId: latestTimeline.alertStateId,
        },
        props: { isRoot: true },
      });
      logger.info(
        `Updated Alert ${alert.id} current state to ${latestTimeline.alertStateId}`,
        {
          projectId: alert.projectId?.toString(),
          alertId: alert.id?.toString(),
        } as LogAttributes,
      );
    }
  }
}
export default new Service();
