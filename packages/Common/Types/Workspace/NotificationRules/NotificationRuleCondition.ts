import AlertSeverity from "../../../Models/DatabaseModels/AlertSeverity";
import AlertState from "../../../Models/DatabaseModels/AlertState";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import IncidentState from "../../../Models/DatabaseModels/IncidentState";
import Label from "../../../Models/DatabaseModels/Label";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import ScheduledMaintenanceState from "../../../Models/DatabaseModels/ScheduledMaintenanceState";
import ServiceLevelObjective from "../../../Models/DatabaseModels/ServiceLevelObjective";
import { DropdownOption } from "../../../UI/Components/Dropdown/Dropdown";
import DropdownUtil from "../../../UI/Utils/Dropdown";
import MonitorType from "../../Monitor/MonitorType";
import SecurityCasePriority from "../../../Models/DatabaseModels/SecurityCasePriority";
import SecurityCaseStatus from "../../../Models/DatabaseModels/SecurityCaseStatus";
import SecurityDetectionSource from "../../SecurityCase/SecurityDetectionSource";
import SecurityCasePriorities from "../../../Utils/SecurityCase/SecurityCasePriorities";
import SecurityCaseStatuses from "../../../Utils/SecurityCase/SecurityCaseStatuses";
import SloErrorBudgetPolicyChange, {
  SLO_ERROR_BUDGET_POLICY_CHANGES,
} from "../../ServiceLevelObjective/SloErrorBudgetPolicyChange";
import WorkspaceType, { getWorkspaceTypeDisplayName } from "../WorkspaceType";
import NotificationRuleEventType from "./EventType";
import IncidentNotificationRule from "./NotificationRuleTypes/IncidentNotificationRule";

export enum NotificationRuleConditionCheckOn {
  MonitorName = "Monitor Name",
  IncidentTitle = "Incident Title",
  IncidentDescription = "Incident Description",
  IncidentSeverity = "Incident Severity",
  IncidentState = "Incident State",
  MonitorType = "Monitor Type",
  MonitorStatus = "Monitor Status",
  AlertTitle = "Alert Title",
  AlertDescription = "Alert Description",
  AlertSeverity = "Alert Severity",
  AlertState = "Alert State",
  AlertEpisodeTitle = "Alert Episode Title",
  AlertEpisodeDescription = "Alert Episode Description",
  AlertEpisodeSeverity = "Alert Episode Severity",
  AlertEpisodeState = "Alert Episode State",
  AlertEpisodeLabels = "Alert Episode Labels",
  IncidentEpisodeTitle = "Incident Episode Title",
  IncidentEpisodeDescription = "Incident Episode Description",
  IncidentEpisodeSeverity = "Incident Episode Severity",
  IncidentEpisodeState = "Incident Episode State",
  IncidentEpisodeLabels = "Incident Episode Labels",
  ScheduledMaintenanceTitle = "Scheduled Maintenance Title",
  ScheduledMaintenanceDescription = "Scheduled Maintenance Description",
  ScheduledMaintenanceState = "Scheduled Maintenance State",
  IncidentLabels = "Incident Labels",
  AlertLabels = "Alert Labels",
  MonitorLabels = "Monitor Labels",
  ScheduledMaintenanceLabels = "Scheduled Maintenance Labels",
  Monitors = "Monitors", // like monitor contains in the incident or scheduled event.

  // On Call Duty Policy
  OnCallDutyPolicyName = "On Call Duty Policy Name",
  OnCallDutyPolicyDescription = "On Call Duty Policy Description",
  OnCallDutyPolicyLabels = "On Call Duty Policy Labels",

  // Security Case
  SecurityCaseTitle = "Security Case Title",
  SecurityCaseDescription = "Security Case Description",
  SecurityCasePriority = "Security Case Priority",
  SecurityCaseStatus = "Security Case Status",
  SecurityCaseSource = "Security Case Source",
  SecurityCaseLabels = "Security Case Labels",

  // Security Hunt: the hunt whose scheduled run found events.
  SecurityHuntName = "Security Hunt Name",

  /*
   * Service Level Objective: the SLO whose error budget policy moved - by
   * its name, by the SLO itself, by its labels - and what moved
   * (SloErrorBudgetPolicyChange).
   */
  SloName = "SLO Name",
  Slos = "SLOs",
  SloLabels = "SLO Labels",
  SloErrorBudgetPolicyChange = "Error Budget Policy Change",
}

/*
 * The words a condition's field is shown with, where they differ from the
 * value stored in the rule. The on-call fields were named when the product
 * was "On Call Duty"; it is On-Call now (#6817), but a rule saved with
 * "On Call Duty Policy Name" must keep matching, so the value stays and only
 * what the Conditions step's dropdown and the rule's card say changes.
 */
export const CHECK_ON_LABELS: Readonly<
  Partial<Record<NotificationRuleConditionCheckOn, string>>
> = {
  [NotificationRuleConditionCheckOn.OnCallDutyPolicyName]:
    "On-Call Policy Name",
  [NotificationRuleConditionCheckOn.OnCallDutyPolicyDescription]:
    "On-Call Policy Description",
  [NotificationRuleConditionCheckOn.OnCallDutyPolicyLabels]:
    "On-Call Policy Labels",
};

// What a condition's field is called on screen, in English.
export function getCheckOnLabel(
  checkOn: NotificationRuleConditionCheckOn,
): string {
  return CHECK_ON_LABELS[checkOn] || checkOn;
}

export enum ConditionType {
  EqualTo = "Equal To",
  NotEqualTo = "Not Equal To",
  GreaterThan = "Greater Than",
  LessThan = "Less Than",
  GreaterThanOrEqualTo = "Greater Than Or Equal To",
  LessThanOrEqualTo = "Less Than Or Equal To",
  Contains = "Contains",
  ContainsAny = "Contains Any",
  NotContains = "Not Contains",
  StartsWith = "Starts With",
  EndsWith = "Ends With",
  IsEmpty = "Is Empty",
  IsNotEmpty = "Is Not Empty",
  True = "True",
  False = "False",
  ContainsAll = "Contains All",
}

export default interface NotificationRuleCondition {
  checkOn: NotificationRuleConditionCheckOn;
  conditionType: ConditionType | undefined;
  value: string | Array<string> | undefined;
}

export class NotificationRuleConditionUtil {
  /*
   * Why a rule cannot be saved, or null when it can: its conditions first,
   * then where it posts. The rule form asks the two on separate steps
   * (Conditions, then Destination), and each step checks its own half.
   */
  public static getValidationError(data: {
    notificationRule: IncidentNotificationRule;
    eventType: NotificationRuleEventType;
    workspaceType: WorkspaceType;
  }): string | null {
    return (
      NotificationRuleConditionUtil.getConditionsValidationError(data) ||
      NotificationRuleConditionUtil.getDestinationValidationError(data)
    );
  }

  // The rule's conditions: every one complete. No conditions at all is fine.
  public static getConditionsValidationError(data: {
    notificationRule: IncidentNotificationRule | undefined;
  }): string | null {
    for (const condition of data.notificationRule?.filters || []) {
      if (!condition.checkOn) {
        return "Check On is required";
      }

      if (!condition.conditionType) {
        return `Filter Condition is required for ${condition.checkOn}`;
      }

      if (!condition.value) {
        return `Value is required for ${condition.checkOn}`;
      }

      if (Array.isArray(condition.value) && condition.value.length === 0) {
        return `Value is required for ${condition.checkOn}`;
      }
    }

    return null;
  }

  /*
   * Where the rule posts: an event that can get a channel of its own needs
   * at least one destination, and every destination picked needs what it
   * posts to.
   */
  public static getDestinationValidationError(data: {
    notificationRule: IncidentNotificationRule | undefined;
    eventType: NotificationRuleEventType;
    workspaceType: WorkspaceType;
  }): string | null {
    const { eventType, workspaceType } = data;
    const notificationRule: Partial<IncidentNotificationRule> =
      data.notificationRule || {};

    if (
      eventType === NotificationRuleEventType.Incident ||
      eventType === NotificationRuleEventType.Alert ||
      eventType === NotificationRuleEventType.AlertEpisode ||
      eventType === NotificationRuleEventType.IncidentEpisode ||
      eventType === NotificationRuleEventType.ScheduledMaintenance
    ) {
      // either create a channel, post to an existing channel, or post to a chat.

      const workspaceDisplayName: string =
        getWorkspaceTypeDisplayName(workspaceType);

      if (
        !notificationRule.shouldCreateNewChannel &&
        !notificationRule.shouldPostToExistingChannel &&
        !notificationRule.shouldPostToExistingChat
      ) {
        return workspaceType === WorkspaceType.MicrosoftTeams
          ? `Please select a destination: create a ${workspaceDisplayName} channel, post to an existing ${workspaceDisplayName} channel, or post to an existing ${workspaceDisplayName} chat`
          : `Please select a destination: create a ${workspaceDisplayName} channel or post to an existing ${workspaceDisplayName} channel`;
      }

      if (notificationRule.shouldPostToExistingChannel) {
        if (!notificationRule.existingChannelNames?.trim()) {
          return (
            "Existing " + workspaceDisplayName + " channel name is required"
          );
        }
      }

      /*
       * A channel the rule creates needs no name: it is named after its
       * record (inc-42), and the rule's prefix, when it has one, goes in
       * front (WorkspaceChannelName).
       */
    }

    /*
     * A security case, a hunt and an SLO have no channel of their own, so
     * their rules post somewhere that exists: a channel, or (Microsoft
     * Teams) a chat.
     */
    if (
      eventType === NotificationRuleEventType.SecurityCase ||
      eventType === NotificationRuleEventType.SecurityHunt ||
      eventType === NotificationRuleEventType.ServiceLevelObjective
    ) {
      const workspaceDisplayName: string =
        getWorkspaceTypeDisplayName(workspaceType);

      if (
        !notificationRule.shouldPostToExistingChannel &&
        !notificationRule.shouldPostToExistingChat
      ) {
        return workspaceType === WorkspaceType.MicrosoftTeams
          ? `Please select a destination: post to an existing ${workspaceDisplayName} channel or to an existing ${workspaceDisplayName} chat`
          : `Please select a destination: post to an existing ${workspaceDisplayName} channel`;
      }

      if (
        notificationRule.shouldPostToExistingChannel &&
        !notificationRule.existingChannelNames?.trim()
      ) {
        return "Existing " + workspaceDisplayName + " channel name is required";
      }
    }

    if (notificationRule.shouldPostToExistingChat) {
      if (
        !notificationRule.existingChatIds ||
        notificationRule.existingChatIds.length === 0
      ) {
        const workspaceDisplayName: string =
          getWorkspaceTypeDisplayName(workspaceType);
        return `Please select at least one ${workspaceDisplayName} chat to post to. If no chats are listed, add the OneUptime app to a chat in ${workspaceDisplayName} first.`;
      }
    }

    return null;
  }

  /*
   * A condition with nothing in it yet - the row Add Condition draws, its
   * value "" - or one emptied again: no value, an empty list, or blank text.
   * A rule or summary is saved without such rows. A condition with text in
   * it ("Incident Title contains database") is not empty: the notification
   * rule table used to keep only conditions holding a list, so a rule saved
   * with a text condition lost it and fired for every event.
   */
  public static isEmptyCondition(
    condition: NotificationRuleCondition,
  ): boolean {
    const value: string | Array<string> | undefined = condition.value;

    if (!value) {
      return true;
    }

    if (Array.isArray(value)) {
      return value.length === 0;
    }

    if (typeof value === "string") {
      return value.trim().length === 0;
    }

    return false;
  }

  // The conditions with something in them, in their order.
  public static withoutEmptyConditions(
    conditions: Array<NotificationRuleCondition>,
  ): Array<NotificationRuleCondition> {
    return conditions.filter(
      (condition: NotificationRuleCondition): boolean => {
        return !NotificationRuleConditionUtil.isEmptyCondition(condition);
      },
    );
  }

  public static hasValueField(data: {
    checkOn: NotificationRuleConditionCheckOn;
    conditionType: ConditionType | undefined;
  }): boolean {
    switch (data.conditionType) {
      case ConditionType.IsEmpty:
      case ConditionType.IsNotEmpty:
      case ConditionType.True:
      case ConditionType.False:
        return false;
      default:
        return true;
    }
  }

  public static isDropdownValueField(data: {
    checkOn: NotificationRuleConditionCheckOn | undefined;
    conditionType: ConditionType | undefined;
  }): boolean {
    // incident state, alert state, monitor status, scheduled maintenance state, severit, labels, monitors are all dropdowns.

    if (!data.checkOn || !data.conditionType) {
      return false;
    }

    switch (data.checkOn) {
      case NotificationRuleConditionCheckOn.MonitorType:
      case NotificationRuleConditionCheckOn.IncidentState:
      case NotificationRuleConditionCheckOn.AlertState:
      case NotificationRuleConditionCheckOn.AlertEpisodeState:
      case NotificationRuleConditionCheckOn.IncidentEpisodeState:
      case NotificationRuleConditionCheckOn.MonitorStatus:
      case NotificationRuleConditionCheckOn.ScheduledMaintenanceState:
      case NotificationRuleConditionCheckOn.IncidentSeverity:
      case NotificationRuleConditionCheckOn.AlertSeverity:
      case NotificationRuleConditionCheckOn.AlertEpisodeSeverity:
      case NotificationRuleConditionCheckOn.IncidentEpisodeSeverity:
      case NotificationRuleConditionCheckOn.MonitorLabels:
      case NotificationRuleConditionCheckOn.IncidentLabels:
      case NotificationRuleConditionCheckOn.AlertLabels:
      case NotificationRuleConditionCheckOn.AlertEpisodeLabels:
      case NotificationRuleConditionCheckOn.IncidentEpisodeLabels:
      case NotificationRuleConditionCheckOn.ScheduledMaintenanceLabels:
      case NotificationRuleConditionCheckOn.OnCallDutyPolicyLabels:
      case NotificationRuleConditionCheckOn.Monitors:
      case NotificationRuleConditionCheckOn.SecurityCasePriority:
      case NotificationRuleConditionCheckOn.SecurityCaseStatus:
      case NotificationRuleConditionCheckOn.SecurityCaseSource:
      case NotificationRuleConditionCheckOn.SecurityCaseLabels:
      case NotificationRuleConditionCheckOn.Slos:
      case NotificationRuleConditionCheckOn.SloLabels:
      case NotificationRuleConditionCheckOn.SloErrorBudgetPolicyChange:
        return true;
      default:
        return false;
    }
  }

  /*
   * What a condition's value dropdown offers. States, severities, monitor
   * statuses and labels come with their colours (when the rows were fetched
   * with them), as they do in every other picker.
   */
  public static getDropdownOptionsByCheckOn(data: {
    alertSeverities: Array<AlertSeverity>;
    alertStates: Array<AlertState>;
    incidentSeverities: Array<IncidentSeverity>;
    monitorStatus: Array<MonitorStatus>;
    incidentStates: Array<IncidentState>;
    scheduledMaintenanceStates: Array<ScheduledMaintenanceState>;
    labels: Array<Label>;
    monitors: Array<Monitor>;
    // The project's own case priorities and statuses, in their order.
    securityCasePriorities?: Array<SecurityCasePriority> | undefined;
    securityCaseStatuses?: Array<SecurityCaseStatus> | undefined;
    // The project's SLOs, for an SLO rule's SLOs condition.
    serviceLevelObjectives?: Array<ServiceLevelObjective> | undefined;
    checkOn: NotificationRuleConditionCheckOn;
  }): Array<DropdownOption> {
    type ToOptionsFunction = (rows: Array<BaseModel>) => Array<DropdownOption>;

    const toOptions: ToOptionsFunction = (
      rows: Array<BaseModel>,
    ): Array<DropdownOption> => {
      return DropdownUtil.getDropdownOptionsFromEntityArray({
        array: rows,
        labelField: "name",
        valueField: "_id",
      });
    };

    if (
      data.checkOn === NotificationRuleConditionCheckOn.IncidentEpisodeSeverity
    ) {
      return toOptions(data.incidentSeverities);
    }

    if (
      data.checkOn === NotificationRuleConditionCheckOn.AlertSeverity ||
      data.checkOn === NotificationRuleConditionCheckOn.AlertEpisodeSeverity
    ) {
      return toOptions(data.alertSeverities);
    }

    if (data.checkOn === NotificationRuleConditionCheckOn.IncidentSeverity) {
      return toOptions(data.incidentSeverities);
    }

    if (data.checkOn === NotificationRuleConditionCheckOn.MonitorStatus) {
      return toOptions(data.monitorStatus);
    }

    if (
      data.checkOn === NotificationRuleConditionCheckOn.IncidentState ||
      data.checkOn === NotificationRuleConditionCheckOn.IncidentEpisodeState
    ) {
      return toOptions(data.incidentStates);
    }

    if (
      data.checkOn ===
      NotificationRuleConditionCheckOn.ScheduledMaintenanceState
    ) {
      return toOptions(data.scheduledMaintenanceStates);
    }

    if (
      data.checkOn === NotificationRuleConditionCheckOn.MonitorLabels ||
      data.checkOn === NotificationRuleConditionCheckOn.IncidentLabels ||
      data.checkOn === NotificationRuleConditionCheckOn.AlertLabels ||
      data.checkOn === NotificationRuleConditionCheckOn.AlertEpisodeLabels ||
      data.checkOn === NotificationRuleConditionCheckOn.IncidentEpisodeLabels ||
      data.checkOn ===
        NotificationRuleConditionCheckOn.ScheduledMaintenanceLabels ||
      data.checkOn ===
        NotificationRuleConditionCheckOn.OnCallDutyPolicyLabels ||
      data.checkOn === NotificationRuleConditionCheckOn.SecurityCaseLabels ||
      data.checkOn === NotificationRuleConditionCheckOn.SloLabels
    ) {
      return toOptions(data.labels);
    }

    // An SLO's name is the team's own, drawn as written in every language.
    if (data.checkOn === NotificationRuleConditionCheckOn.Slos) {
      return toOptions(data.serviceLevelObjectives || []).map(
        (option: DropdownOption): DropdownOption => {
          return { ...option, isUserContent: true };
        },
      );
    }

    /*
     * What moved in the SLO's error budget policy: a fixed list, in the
     * order a tier change reads - entered, recovered, left - then the deploy
     * gate. Each is shown as it is stored, in the reader's language where
     * the condition is drawn.
     */
    if (
      data.checkOn ===
      NotificationRuleConditionCheckOn.SloErrorBudgetPolicyChange
    ) {
      return SLO_ERROR_BUDGET_POLICY_CHANGES.map(
        (change: SloErrorBudgetPolicyChange): DropdownOption => {
          return { label: change, value: change };
        },
      );
    }

    if (data.checkOn === NotificationRuleConditionCheckOn.Monitors) {
      return toOptions(data.monitors);
    }

    // alert states (also used for alert episodes)
    if (
      data.checkOn === NotificationRuleConditionCheckOn.AlertState ||
      data.checkOn === NotificationRuleConditionCheckOn.AlertEpisodeState
    ) {
      return toOptions(data.alertStates);
    }

    // if monitor type
    if (data.checkOn === NotificationRuleConditionCheckOn.MonitorType) {
      return DropdownUtil.getDropdownOptionsFromEnum(MonitorType);
    }

    /*
     * A security case's priority and status are the project's own, by id,
     * in their order whatever order they are handed in: most urgent priority
     * first, statuses as a case moves through them. Its source is a fixed
     * scale every project shares.
     */
    if (
      data.checkOn === NotificationRuleConditionCheckOn.SecurityCasePriority
    ) {
      return toOptions(
        SecurityCasePriorities.sort(data.securityCasePriorities || []),
      );
    }

    if (data.checkOn === NotificationRuleConditionCheckOn.SecurityCaseStatus) {
      return toOptions(
        SecurityCaseStatuses.sort(data.securityCaseStatuses || []),
      );
    }

    if (data.checkOn === NotificationRuleConditionCheckOn.SecurityCaseSource) {
      return DropdownUtil.getDropdownOptionsFromEnum(SecurityDetectionSource);
    }

    return [];
  }

  public static getCheckOnByEventType(
    eventType: NotificationRuleEventType,
  ): Array<NotificationRuleConditionCheckOn> {
    switch (eventType) {
      case NotificationRuleEventType.Incident:
        return [
          NotificationRuleConditionCheckOn.IncidentTitle,
          NotificationRuleConditionCheckOn.IncidentDescription,
          NotificationRuleConditionCheckOn.IncidentSeverity,
          NotificationRuleConditionCheckOn.IncidentState,
          NotificationRuleConditionCheckOn.IncidentLabels,
          NotificationRuleConditionCheckOn.MonitorLabels,
          NotificationRuleConditionCheckOn.Monitors,
        ];
      case NotificationRuleEventType.Alert:
        return [
          NotificationRuleConditionCheckOn.AlertTitle,
          NotificationRuleConditionCheckOn.AlertDescription,
          NotificationRuleConditionCheckOn.AlertSeverity,
          NotificationRuleConditionCheckOn.AlertState,

          NotificationRuleConditionCheckOn.AlertLabels,
          NotificationRuleConditionCheckOn.MonitorLabels,

          NotificationRuleConditionCheckOn.Monitors,
        ];
      case NotificationRuleEventType.AlertEpisode:
        return [
          NotificationRuleConditionCheckOn.AlertEpisodeTitle,
          NotificationRuleConditionCheckOn.AlertEpisodeDescription,
          NotificationRuleConditionCheckOn.AlertEpisodeSeverity,
          NotificationRuleConditionCheckOn.AlertEpisodeState,
          NotificationRuleConditionCheckOn.AlertEpisodeLabels,
        ];
      case NotificationRuleEventType.IncidentEpisode:
        return [
          NotificationRuleConditionCheckOn.IncidentEpisodeTitle,
          NotificationRuleConditionCheckOn.IncidentEpisodeDescription,
          NotificationRuleConditionCheckOn.IncidentEpisodeSeverity,
          NotificationRuleConditionCheckOn.IncidentEpisodeState,
          NotificationRuleConditionCheckOn.IncidentEpisodeLabels,
        ];
      case NotificationRuleEventType.Monitor:
        return [
          NotificationRuleConditionCheckOn.MonitorName,
          NotificationRuleConditionCheckOn.MonitorStatus,
          NotificationRuleConditionCheckOn.MonitorType,
          NotificationRuleConditionCheckOn.Monitors,
          NotificationRuleConditionCheckOn.MonitorLabels,
        ];
      case NotificationRuleEventType.ScheduledMaintenance:
        return [
          NotificationRuleConditionCheckOn.ScheduledMaintenanceTitle,
          NotificationRuleConditionCheckOn.ScheduledMaintenanceDescription,
          NotificationRuleConditionCheckOn.ScheduledMaintenanceState,
          NotificationRuleConditionCheckOn.ScheduledMaintenanceLabels,
          NotificationRuleConditionCheckOn.MonitorLabels,
          NotificationRuleConditionCheckOn.Monitors,
        ];
      case NotificationRuleEventType.OnCallDutyPolicy:
        return [
          NotificationRuleConditionCheckOn.OnCallDutyPolicyName,
          NotificationRuleConditionCheckOn.OnCallDutyPolicyDescription,
          NotificationRuleConditionCheckOn.OnCallDutyPolicyLabels,
        ];
      case NotificationRuleEventType.SecurityCase:
        return [
          NotificationRuleConditionCheckOn.SecurityCasePriority,
          NotificationRuleConditionCheckOn.SecurityCaseTitle,
          NotificationRuleConditionCheckOn.SecurityCaseDescription,
          NotificationRuleConditionCheckOn.SecurityCaseStatus,
          NotificationRuleConditionCheckOn.SecurityCaseSource,
          NotificationRuleConditionCheckOn.SecurityCaseLabels,
        ];
      /*
       * Which hunts' finds a rule posts: by the hunt's name ("starts with
       * IR -", "contains ransomware"). A rule with no condition posts every
       * hunt's.
       */
      case NotificationRuleEventType.SecurityHunt:
        return [NotificationRuleConditionCheckOn.SecurityHuntName];
      /*
       * Which SLOs a rule posts the error budget policy of - picked from
       * the project's, which a new condition starts on, or by their labels
       * or name - and which of the policy's changes (entered a tier,
       * recovered, left every tier, deployments frozen or allowed again).
       * A rule with no condition posts every change of every SLO.
       */
      case NotificationRuleEventType.ServiceLevelObjective:
        return [
          NotificationRuleConditionCheckOn.Slos,
          NotificationRuleConditionCheckOn.SloLabels,
          NotificationRuleConditionCheckOn.SloName,
          NotificationRuleConditionCheckOn.SloErrorBudgetPolicyChange,
        ];
      default:
        return [];
    }
  }

  public static getConditionTypeByCheckOn(
    checkOn: NotificationRuleConditionCheckOn,
  ): Array<ConditionType> {
    switch (checkOn) {
      case NotificationRuleConditionCheckOn.MonitorName:
      case NotificationRuleConditionCheckOn.IncidentTitle:
      case NotificationRuleConditionCheckOn.IncidentDescription:
      case NotificationRuleConditionCheckOn.AlertTitle:
      case NotificationRuleConditionCheckOn.AlertDescription:
      case NotificationRuleConditionCheckOn.AlertEpisodeTitle:
      case NotificationRuleConditionCheckOn.AlertEpisodeDescription:
      case NotificationRuleConditionCheckOn.IncidentEpisodeTitle:
      case NotificationRuleConditionCheckOn.IncidentEpisodeDescription:
      case NotificationRuleConditionCheckOn.ScheduledMaintenanceTitle:
      case NotificationRuleConditionCheckOn.ScheduledMaintenanceDescription:
      case NotificationRuleConditionCheckOn.OnCallDutyPolicyName:
      case NotificationRuleConditionCheckOn.OnCallDutyPolicyDescription:
      case NotificationRuleConditionCheckOn.SecurityCaseTitle:
      case NotificationRuleConditionCheckOn.SecurityCaseDescription:
      case NotificationRuleConditionCheckOn.SecurityHuntName:
      case NotificationRuleConditionCheckOn.SloName:
        return [
          ConditionType.EqualTo,
          ConditionType.NotEqualTo,
          ConditionType.Contains,
          ConditionType.NotContains,
          ConditionType.StartsWith,
          ConditionType.EndsWith,
        ];
      case NotificationRuleConditionCheckOn.IncidentSeverity:
      case NotificationRuleConditionCheckOn.AlertSeverity:
      case NotificationRuleConditionCheckOn.AlertEpisodeSeverity:
      case NotificationRuleConditionCheckOn.IncidentEpisodeSeverity:
        return [ConditionType.ContainsAny, ConditionType.NotContains];
      case NotificationRuleConditionCheckOn.IncidentState:
      case NotificationRuleConditionCheckOn.AlertState:
      case NotificationRuleConditionCheckOn.AlertEpisodeState:
      case NotificationRuleConditionCheckOn.IncidentEpisodeState:
      case NotificationRuleConditionCheckOn.MonitorStatus:
      case NotificationRuleConditionCheckOn.ScheduledMaintenanceState:
        return [ConditionType.ContainsAny, ConditionType.NotContains];
      case NotificationRuleConditionCheckOn.MonitorType:
      case NotificationRuleConditionCheckOn.SecurityCasePriority:
      case NotificationRuleConditionCheckOn.SecurityCaseStatus:
      case NotificationRuleConditionCheckOn.SecurityCaseSource:
      case NotificationRuleConditionCheckOn.SloErrorBudgetPolicyChange:
        return [ConditionType.ContainsAny, ConditionType.NotContains];
      // An SLO's rule names the SLOs it is for, by id, as a monitor's names monitors.
      case NotificationRuleConditionCheckOn.Slos:
        return [ConditionType.ContainsAny, ConditionType.NotContains];
      case NotificationRuleConditionCheckOn.AlertLabels:
      case NotificationRuleConditionCheckOn.AlertEpisodeLabels:
      case NotificationRuleConditionCheckOn.IncidentEpisodeLabels:
      case NotificationRuleConditionCheckOn.IncidentLabels:
      case NotificationRuleConditionCheckOn.MonitorLabels:
      case NotificationRuleConditionCheckOn.ScheduledMaintenanceLabels:
      case NotificationRuleConditionCheckOn.OnCallDutyPolicyLabels:
      case NotificationRuleConditionCheckOn.SecurityCaseLabels:
      case NotificationRuleConditionCheckOn.SloLabels:
        return [
          ConditionType.ContainsAny,
          ConditionType.NotContains,
          ConditionType.ContainsAll,
        ];
      case NotificationRuleConditionCheckOn.Monitors:
        return [
          ConditionType.ContainsAny,
          ConditionType.NotContains,
          ConditionType.ContainsAll,
        ];
      default:
        return [];
    }
  }
}
