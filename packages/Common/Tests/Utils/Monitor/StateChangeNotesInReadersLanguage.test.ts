import { describe, expect, jest, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { createTranslator, Translator } from "../../../Types/Translator";
import FeedMarkdown, { mdText } from "../../../Utils/Markdown/FeedMarkdown";
import StatusChangeCauseWording, {
  ALERT_AUTO_RESOLVED,
  INCIDENT_AUTO_RESOLVED,
} from "../../../Utils/Monitor/StatusChangeCauseWording";
import {
  EPISODE_ACKNOWLEDGED_BY_USER,
  EPISODE_ACKNOWLEDGED_VIA_API,
  EPISODE_REOPENED_BY_NEW_ALERT,
  EPISODE_REOPENED_BY_NEW_INCIDENT,
  EPISODE_REOPENED_BY_USER,
  EPISODE_REOPENED_VIA_API,
  EPISODE_RESOLVED_ALL_ALERTS_RESOLVED,
  EPISODE_RESOLVED_ALL_INCIDENTS_RESOLVED,
  EPISODE_RESOLVED_BY_USER,
  EPISODE_RESOLVED_NO_NEW_ALERT,
  EPISODE_RESOLVED_NO_NEW_INCIDENT,
  EPISODE_RESOLVED_VIA_API,
  STATE_CHANGED_BY_EPISODE,
  STATE_CHANGED_WITH_ALERT,
  STATE_CHANGED_WITH_EPISODE,
  STATE_CHANGED_WITH_INCIDENT,
  STATE_CHANGED_WITH_ITS_EPISODE,
  STATUS_CHANGED_BY_USER,
  STATUS_CHANGE_NOTES,
  StatusChangeNote,
  WHO_OPENED_IT_NOTES,
  getStatusChangeNotePlaceholders,
  readCostItems,
  readStatusChangeNote,
  wordStatusChangeNote,
  writeStatusChangeNote,
} from "../../../Utils/Monitor/StatusChangeNotes";
import RecordRootCauseWording from "../../../Utils/Monitor/RecordRootCauseWording";
import isWhoOpenedItRootCause from "../../../Utils/Incident/WhoOpenedItRootCause";
import { formatSloPolicyTierThreshold } from "../../../Utils/Slo/SloErrorBudgetPolicy";
import CloudBudgetEvaluator from "../../../Server/Utils/CloudConnection/CloudBudgetEvaluator";
import PerSeriesResolutionRootCause from "../../../Server/Utils/Monitor/PerSeriesResolutionRootCause";
import MonitorTurnedOff from "../../../Server/Utils/Monitor/MonitorTurnedOff";
import { LOG_GROUP_RESOLVED_ROOT_CAUSE } from "../../../Server/Utils/Monitor/LogGroupCriteriaFanOut";
import { getRestoredStatusEventRootCause } from "../../../Server/Utils/Monitor/MonitorStatusTimelineReconciler";
import { getNothingReportsRootCause } from "../../../Server/Services/NetworkSiteService";
import { getDeclaredAlertAcknowledgementCause } from "../../../Server/Services/IncidentAlertService";
import {
  SLO_ARCHIVED_ROOT_CAUSE,
  SLO_DISABLED_OR_DELETED_ROOT_CAUSE,
} from "../../../Server/Services/ServiceLevelObjectiveService";
import {
  SLO_POLICY_TIER_ALERTS_OFF_ROOT_CAUSE,
  SLO_POLICY_TIER_DELETED_ROOT_CAUSE,
  SLO_POLICY_TIER_DISABLED_ROOT_CAUSE,
  SLO_POLICY_TIER_INCIDENTS_OFF_ROOT_CAUSE,
  SLO_POLICY_TIER_SLO_DISABLED_OR_DELETED_ROOT_CAUSE,
} from "../../../Server/Services/ServiceLevelObjectiveErrorBudgetPolicyTierService";
import { DELETED_STORE_WHY } from "../../../Server/Services/DataStoreService";
import { CLOSED_BY_PERSON_WHY } from "../../../Server/Services/DataSecurityIssueService";
import MetricSeriesFingerprint from "../../../Utils/Metrics/MetricSeriesFingerprint";
import { DataAlertFeedback } from "../../../Types/DataObservability/DataAlertFeedback";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import Dictionary from "../../../Types/Dictionary";
import {
  dashboardTranslator,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";
import { NO_BREAK_SPACE } from "../../../Types/NoBreakSpaces";

// The services log through @CaptureSpan; nothing here is about logging.
jest.mock("../../../Server/Utils/Logger");

/*
 * VIEW CAUSE READS ONEUPTIME'S OWN STATE CHANGES IN THE READER'S LANGUAGE
 * (#9959).
 *
 * #9752 worded a status or state change's root cause behind View Cause:
 * the criteria's Markdown, the auto-resolve sentence and the monitor's own
 * status notes. Every other note OneUptime writes onto an incident's, an
 * alert's or an episode's State Timeline still read in English on every
 * page: "This status was changed when the incident was updated.", "State
 * changed by episode state cascade.", a linked incident's, a series' or a
 * key's recovery, monitoring turned off, a network site's recovery, an SLO,
 * a budget, Data Security, Data Observability, auto-remediation and
 * OneUptime AI closing it. And an episode's State Timeline showed no cause
 * at all.
 *
 * Each note is now defined once (StatusChangeNotes): how OneUptime writes
 * it, how older rows wrote it, and the key each language words it by. Each
 * root cause here is written as the server writes one - by the writer's own
 * function where it has one, from its constant, or held to the writer's
 * source - so a writer that changes its words fails here first; then each
 * is read in German, Japanese, Persian and Arabic from the Dashboard's own
 * locale files.
 */

const REPOSITORY_ROOT: string = path.resolve(__dirname, "../../../../..");

// An episode's own resolve or reopen note, by its constant's name.
const EPISODE_NOTE_NAME: RegExp = /EPISODE_(?:RESOLVED|REOPENED)_/;

function source(file: string): string {
  return fs.readFileSync(path.join(REPOSITORY_ROOT, file), "utf8");
}

const ENGLISH: Translator = createTranslator((): string | undefined => {
  return undefined;
}, "en");

// A text as a reader reads it: no isolate marks, a plain space for a held one.
function plain(text: string | null | undefined): string {
  return withoutIsolateMarks(text || "")
    .split(NO_BREAK_SPACE)
    .join(" ");
}

const USER_LINK: string =
  mdText`[${"Jane Doe"}](${"https://oneuptime.example/dashboard/p/users/u"})`.toString();

const LANGUAGES: ReadonlyArray<string> = ["de", "ja", "fa", "ar"];

/*
 * ---------------------------------------------------------------------------
 * Every note OneUptime writes onto a State Timeline, as it writes it
 * ---------------------------------------------------------------------------
 */

interface Written {
  // Who writes it, for a reader of a failure.
  writer: string;
  stored: string;
  // A value the note keeps, as stored: it reads as written in every language.
  keeps?: ReadonlyArray<string> | undefined;
}

const criteria: Dictionary<MonitorCriteriaInstance> = {
  "criteria-1": { data: { name: "High CPU" } } as MonitorCriteriaInstance,
};

const SERIES_LABELS: Record<string, string> = { host: "node-a" };

const WRITTEN: ReadonlyArray<Written> = [
  // The timeline services, for a state a person changed.
  {
    writer: "IncidentStateTimelineService",
    stored:
      mdText`Incident state created by ${FeedMarkdown.asMarkdown(USER_LINK)}`.toString(),
    keeps: ["Jane Doe"],
  },
  {
    writer: "AlertStateTimelineService",
    stored:
      mdText`Alert state created by ${FeedMarkdown.asMarkdown(USER_LINK)}`.toString(),
    keeps: ["Jane Doe"],
  },
  {
    writer:
      "IncidentEpisodeStateTimelineService / AlertEpisodeStateTimelineService",
    stored:
      mdText`Episode state created by ${FeedMarkdown.asMarkdown(USER_LINK)}`.toString(),
    keeps: ["Jane Doe"],
  },
  // A record's update, and an episode's.
  { writer: "IncidentService", stored: STATE_CHANGED_WITH_INCIDENT },
  { writer: "AlertService", stored: STATE_CHANGED_WITH_ALERT },
  { writer: "*EpisodeService", stored: STATE_CHANGED_WITH_EPISODE },
  { writer: "*EpisodeService cascade", stored: STATE_CHANGED_BY_EPISODE },
  { writer: "IncidentEpisodeService", stored: EPISODE_ACKNOWLEDGED_BY_USER },
  { writer: "IncidentEpisodeService", stored: EPISODE_ACKNOWLEDGED_VIA_API },
  { writer: "IncidentEpisodeService", stored: EPISODE_RESOLVED_BY_USER },
  { writer: "IncidentEpisodeService", stored: EPISODE_RESOLVED_VIA_API },
  { writer: "IncidentEpisodeService", stored: EPISODE_REOPENED_BY_USER },
  { writer: "IncidentEpisodeService", stored: EPISODE_REOPENED_VIA_API },
  {
    writer: "IncidentEpisode AutoResolve",
    stored: EPISODE_RESOLVED_ALL_INCIDENTS_RESOLVED,
  },
  {
    writer: "AlertEpisode AutoResolve",
    stored: EPISODE_RESOLVED_ALL_ALERTS_RESOLVED,
  },
  {
    writer: "IncidentEpisode ResolveInactiveEpisodes",
    stored: EPISODE_RESOLVED_NO_NEW_INCIDENT,
  },
  {
    writer: "AlertEpisode ResolveInactiveEpisodes",
    stored: EPISODE_RESOLVED_NO_NEW_ALERT,
  },
  {
    writer: "IncidentGroupingEngineService",
    stored: EPISODE_REOPENED_BY_NEW_INCIDENT,
  },
  {
    writer: "AlertGroupingEngineService",
    stored: EPISODE_REOPENED_BY_NEW_ALERT,
  },
  // An alert an incident was declared from, or one linked to an incident.
  {
    writer: "IncidentAlertService (private)",
    stored: getDeclaredAlertAcknowledgementCause({
      incidentNumber: "#42",
      isIncidentPrivate: true,
    }),
  },
  {
    writer: "IncidentAlertService (declared)",
    stored: getDeclaredAlertAcknowledgementCause({
      incidentNumber: "INC-42",
      isIncidentPrivate: false,
    }),
    keeps: ["INC-42"],
  },
  {
    writer: "IncidentAlertService (declared, no number)",
    stored: getDeclaredAlertAcknowledgementCause({
      incidentNumber: "",
      isIncidentPrivate: false,
    }),
  },
  {
    writer: "IncidentAlertService (linked, resolved)",
    stored:
      mdText`Resolved because linked ${"Incident INC-7"} was resolved.`.toString(),
    keeps: ["INC-7"],
  },
  {
    writer: "IncidentAlertService (linked, acknowledged when resolved)",
    stored:
      mdText`Acknowledged because linked ${"Incident INC-7"} was ${"resolved"}.`.toString(),
    keeps: ["INC-7"],
  },
  {
    writer: "IncidentAlertService (linked, acknowledged)",
    stored:
      mdText`Acknowledged because linked ${"Incident INC-7"} was ${"acknowledged"}.`.toString(),
    keeps: ["INC-7"],
  },
  {
    writer: "IncidentAlertService (linked, no number)",
    stored:
      mdText`Resolved because linked ${"Incident"} was resolved.`.toString(),
  },
  {
    writer: "IncidentAlertService (linked, no number)",
    stored:
      mdText`Acknowledged because linked ${"Incident"} was ${"resolved"}.`.toString(),
  },
  {
    writer: "IncidentAlertService (linked, no number)",
    stored:
      mdText`Acknowledged because linked ${"Incident"} was ${"acknowledged"}.`.toString(),
  },
  // A series or a key that recovered.
  {
    writer: "PerSeriesResolutionRootCause (the whole monitor)",
    stored: PerSeriesResolutionRootCause.build({
      seriesLabels: SERIES_LABELS,
      createdCriteriaId: "criteria-1",
      criteriaInstancesById: criteria,
      seriesFingerprint: MetricSeriesFingerprint.WholeMonitorFingerprint,
    }),
    keeps: ["High CPU"],
  },
  {
    writer: "PerSeriesResolutionRootCause (the whole monitor, no criteria)",
    stored: PerSeriesResolutionRootCause.build({
      seriesLabels: SERIES_LABELS,
      createdCriteriaId: undefined,
      seriesFingerprint: MetricSeriesFingerprint.WholeMonitorFingerprint,
    }),
  },
  {
    writer: "PerSeriesResolutionRootCause (a series)",
    stored: PerSeriesResolutionRootCause.build({
      seriesLabels: SERIES_LABELS,
      createdCriteriaId: "criteria-1",
      criteriaInstancesById: criteria,
    }),
    keeps: ["node-a", "High CPU"],
  },
  {
    writer: "PerSeriesResolutionRootCause (a series, no criteria)",
    stored: PerSeriesResolutionRootCause.build({
      seriesLabels: SERIES_LABELS,
      createdCriteriaId: undefined,
    }),
    keeps: ["node-a"],
  },
  {
    writer: "PerSeriesResolutionRootCause (a series with no labels)",
    stored: PerSeriesResolutionRootCause.build({
      seriesLabels: undefined,
      createdCriteriaId: "criteria-1",
      criteriaInstancesById: criteria,
    }),
    keeps: ["High CPU"],
  },
  {
    writer:
      "PerSeriesResolutionRootCause (a series with no labels, no criteria)",
    stored: PerSeriesResolutionRootCause.build({
      seriesLabels: undefined,
      createdCriteriaId: undefined,
    }),
  },
  {
    writer: "MonitorResource (a key)",
    stored: "Incoming request reported this key as resolved.",
  },
  {
    writer: "MonitorResource (no key)",
    stored: "Incoming request with no value to group by reported recovered.",
  },
  { writer: "LogGroupCriteriaFanOut", stored: LOG_GROUP_RESOLVED_ROOT_CAUSE },
  // Monitoring turned off.
  ...(["incident", "alert"] as const).flatMap(
    (kind: "incident" | "alert"): Array<Written> => {
      return [
        {
          writer: `MonitorTurnedOff (${kind}, the upgrade)`,
          stored: MonitorTurnedOff.getRootCause({
            kind: kind,
            monitorName: "Checkout API",
            turnedOffBy: FeedMarkdown.empty(),
            isUpgrade: true,
          }),
          keeps: ["Checkout API"],
        },
        {
          writer: `MonitorTurnedOff (${kind}, nobody named)`,
          stored: MonitorTurnedOff.getRootCause({
            kind: kind,
            monitorName: "Checkout API",
            turnedOffBy: FeedMarkdown.empty(),
          }),
          keeps: ["Checkout API"],
        },
        {
          writer: `MonitorTurnedOff (${kind}, by a person)`,
          stored: MonitorTurnedOff.getRootCause({
            kind: kind,
            monitorName: "Checkout API",
            turnedOffBy: FeedMarkdown.asMarkdown(USER_LINK),
          }),
          keeps: ["Checkout API", "Jane Doe"],
        },
      ];
    },
  ),
  // A network site's alert.
  {
    writer: "NetworkSiteService (nothing reports)",
    stored: getNothingReportsRootCause("Head Office"),
    keeps: ["Head Office"],
  },
  {
    writer: "NetworkSiteService (recovered)",
    stored:
      mdText`**Recovered:** Network site **${"Head Office"}** rolled back up to ${"Up and Running"}.`.toString(),
    keeps: ["Head Office", "Up and Running"],
  },
  {
    writer: "NetworkSiteService (recovered, no status name)",
    stored:
      mdText`**Recovered:** Network site **${"Head Office"}** rolled back up to ${"an operational status"}.`.toString(),
    keeps: ["Head Office"],
  },
  // An SLO's.
  { writer: "ServiceLevelObjectiveService", stored: SLO_ARCHIVED_ROOT_CAUSE },
  {
    writer: "ServiceLevelObjectiveService",
    stored: SLO_DISABLED_OR_DELETED_ROOT_CAUSE,
  },
  {
    writer: "ServiceLevelObjectiveErrorBudgetPolicyTierService",
    stored: SLO_POLICY_TIER_DISABLED_ROOT_CAUSE,
  },
  {
    writer: "ServiceLevelObjectiveErrorBudgetPolicyTierService",
    stored: SLO_POLICY_TIER_DELETED_ROOT_CAUSE,
  },
  {
    writer: "ServiceLevelObjectiveErrorBudgetPolicyTierService",
    stored: SLO_POLICY_TIER_ALERTS_OFF_ROOT_CAUSE,
  },
  {
    writer: "ServiceLevelObjectiveErrorBudgetPolicyTierService",
    stored: SLO_POLICY_TIER_INCIDENTS_OFF_ROOT_CAUSE,
  },
  {
    writer: "ServiceLevelObjectiveErrorBudgetPolicyTierService",
    stored: SLO_POLICY_TIER_SLO_DISABLED_OR_DELETED_ROOT_CAUSE,
  },
  ...[
    "Auto-resolved because the SLO burn rate rule that created it was deleted.",
    "Alert auto-resolved because the SLO burn rate rule that created it was disabled.",
    "Alert auto-resolved because the SLO burn rate rule that created it no longer raises alerts.",
    "Incident auto-resolved because the SLO burn rate rule that declared it was disabled.",
    "Incident auto-resolved because the SLO burn rate rule that declared it no longer declares incidents.",
    "Alert auto-resolved because the SLO burn rate rule that created it is no longer active.",
    "Incident auto-resolved because the SLO burn rate rule that declared it is no longer active.",
  ].map((stored: string): Written => {
    return { writer: "ServiceLevelObjectiveBurnRateRuleService", stored };
  }),
  ...[
    "Alert auto-resolved because the error budget policy tier that raised it no longer applies.",
    "Incident auto-resolved because the error budget policy tier that declared it no longer applies.",
  ].map((stored: string): Written => {
    return {
      writer: "ServiceLevelObjectiveErrorBudgetPolicyTierService (fallbacks)",
      stored,
    };
  }),
  {
    writer: "EvaluateSlos (superseded)",
    stored:
      mdText`Superseded: SLO "${"Checkout availability"}" entered the more severe "${"Freeze"}" tier of its error budget policy.`.toString(),
    keeps: ["Checkout availability", "Freeze"],
  },
  {
    writer: "EvaluateSlos (recovered)",
    stored:
      mdText`The error budget of SLO "${"Checkout availability"}" recovered out of the "${"Freeze"}" tier of its error budget policy.`.toString(),
    keeps: ["Checkout availability", "Freeze"],
  },
  {
    writer: "EvaluateSlos (no valid rule)",
    stored:
      "Auto-resolved because this SLO burn rate rule no longer has a valid threshold and window configuration, so it can no longer justify staying open.",
  },
  { writer: "EvaluateSlos", stored: "Burn rate dropped below threshold." },
  {
    writer: "EvaluateSlos (requests)",
    stored:
      mdText`The SLO no longer has ${60} minutes of counted requests, so this burn rate rule can no longer justify an open alert or incident.`.toString(),
  },
  {
    writer: "EvaluateSlos (history)",
    stored:
      mdText`The SLO no longer has ${1440} minutes of monitoring history, so this burn rate rule can no longer justify an open alert or incident.`.toString(),
  },
  // A budget's month.
  {
    writer: "CloudBudgetEvaluator",
    stored:
      "Resolved by OneUptime: the month this cloud budget alert was raised in is over.",
  },
  {
    writer: "OpenStackBudgetEvaluator",
    stored:
      "Resolved by OneUptime: the month this OpenStack budget alert was raised in is over.",
  },
  // Data Security's, for each why its issue is no longer open.
  ...[
    "its check passes now",
    "its check no longer runs on the store",
    "its store was archived",
    DELETED_STORE_WHY,
    ...Object.values(CLOSED_BY_PERSON_WHY),
  ].map((why: string | undefined): Written => {
    return {
      writer: "DataSecurityIssueAlerts",
      stored: `Resolved by Data Security, as the issue it was raised for is no longer open: ${why}.`,
    };
  }),
  // Data Observability's, for each feedback.
  ...[DataAlertFeedback.Expected, DataAlertFeedback.NotAnIssue].map(
    (feedback: DataAlertFeedback): Written => {
      return {
        writer: "DataAlertFeedbackRecorder",
        stored: `Marked ${feedback.toLowerCase()} in Data Observability.`,
      };
    },
  ),
  // A fix.
  ...[
    "the AI command remediation",
    "the fix through MCP servers",
    `runbook "${"Restart pods"}"`,
  ].map((fix: string): Written => {
    return {
      writer: "RemediationVerifier",
      // As RemediationVerifier places its description: as text.
      stored:
        mdText`Auto-resolved by auto-remediation: ${fix} (rule "${"Restart on 5xx"}") completed and the monitor(s) recovered within the verification window.`.toString(),
      keeps: ["Restart on 5xx"],
    };
  }),
  {
    writer: "AiFirstResponder",
    stored:
      mdText`Resolved by OneUptime AI: its fix was verified - every affected monitor is operational again - so nobody was paged.`.toString(),
  },
  // A monitor's status history, restored.
  {
    writer: "MonitorStatusTimelineReconciler",
    stored: getRestoredStatusEventRootCause("OneUptime"),
    keeps: ["OneUptime"],
  },
];

/*
 * Rows older ones hold: what a writer wrote before, read and worded the
 * same.
 */
const FORMERLY_WRITTEN: ReadonlyArray<Written> = [
  {
    writer: "IncidentStateTimelineService, before 2025",
    stored: "Incident state created by Jane Doe (jane@example.com)",
    keeps: ["Jane Doe (jane@example.com)"],
  },
  {
    writer: "AlertGroupingEngineService, before #9959",
    stored: "Episode reopened due to new alert added.",
  },
  {
    writer: "an episode's Change State in Slack, before October 2026",
    stored: "State changed via Slack.",
  },
  {
    writer: "an episode's Change State in Microsoft Teams, before October 2026",
    stored: "State changed via Microsoft Teams.",
  },
  {
    writer: "ServiceLevelObjectiveService, before September 2026",
    stored:
      "Alert auto-resolved because the Service Level Objective was disabled or deleted.",
  },
  {
    writer: "ServiceLevelObjectiveBurnRateRuleService, before September 2026",
    stored:
      "Alert auto-resolved because the SLO burn rate rule that created it was deleted.",
  },
  {
    writer: "EvaluateSlos, before September 2026",
    stored:
      "The SLO no longer has 360 minutes of monitoring history, so this burn rate rule can no longer justify an open alert.",
  },
  {
    writer: "MonitorStatusTimelineReconciler, its first words",
    stored:
      "Restored by OneUptime. This monitor's status history had been deleted, so OneUptime recorded its current status again, from the last status change it has a record of (or from when the monitor was created).",
    keeps: ["OneUptime"],
  },
];

/*
 * ---------------------------------------------------------------------------
 * An incident's or an alert's own root cause, when OneUptime opened it
 * (#10125), as each writer writes it
 * ---------------------------------------------------------------------------
 *
 * The record's Root Cause page and its What happened card read it
 * (RecordRootCauseWording), and View Cause reads the copy its first state
 * holds (IncidentService, AlertService): the same notes.
 */
const CLOUD_COSTS: Array<{ service: string; amount: number }> = [
  { service: "Amazon EC2", amount: 437.87 },
  { service: "Amazon S3", amount: 272.74 },
  { service: "AWS Lambda", amount: 34.84 },
];

const RECORD_ROOT_CAUSES_WRITTEN: ReadonlyArray<Written> = [
  {
    writer: "IncomingRequestIncidentGrouping",
    // As toFiringMatch writes it: the key a code span mdText writes round it.
    stored:
      mdText`Incoming request matched grouping key \`${"checkout-42"}\`.`.toString(),
    keeps: ["`checkout-42`"],
  },
  {
    writer: "IncomingRequestIncidentGrouping (a key with a backtick)",
    stored:
      mdText`Incoming request matched grouping key \`${"order`7"}\`.`.toString(),
    keeps: ["order`7"],
  },
  {
    writer: "DetectionRuleEvaluator (an alert's, an incident's)",
    stored:
      mdText`Sigma detection rule "${"Sudo to root"}" matched security events.`.toString(),
    keeps: ["Sudo to root"],
  },
  {
    writer: "ThreatIntelMatcher",
    stored:
      mdText`Threat intel feed "${"URLhaus"}" indicator matched security events.`.toString(),
    keeps: ["URLhaus"],
  },
  {
    writer: "DataSecurityIntegrations",
    stored:
      mdText`The Data Security check "${"s3-public-bucket"}" failed on ${"customer-exports"}.`.toString(),
    keeps: ["s3-public-bucket", "customer-exports"],
  },
  {
    writer: "EvaluateSlos (a burn rate rule)",
    stored:
      mdText`Error budget burn rate breached the "${"Fast burn"}" rule of SLO "${"Checkout availability"}".`.toString(),
    keeps: ["Fast burn", "Checkout availability"],
  },
  {
    writer: "EvaluateSlos (a policy tier)",
    stored:
      mdText`The error budget left of SLO "${"Checkout availability"}" is at or below ${formatSloPolicyTierThreshold(25)}, the "${"Freeze"}" tier of its error budget policy.`.toString(),
    keeps: ["Checkout availability", "Freeze"],
  },
  {
    writer: "EvaluateSlos (a policy tier at a fraction)",
    stored:
      mdText`The error budget left of SLO "${"Checkout availability"}" is at or below ${formatSloPolicyTierThreshold(12.345)}, the "${"Freeze"}" tier of its error budget policy.`.toString(),
    keeps: ["Checkout availability", "Freeze"],
  },
  {
    writer: "NetworkSiteService (a status the project named)",
    stored:
      mdText`Network site **${"Head Office"}** rolled up to **${"Partial Outage"}**.`.toString(),
    keeps: ["Head Office", "Partial Outage"],
  },
  {
    writer: "NetworkSiteService (a default status)",
    stored:
      mdText`Network site **${"Head Office"}** rolled up to **${"Degraded"}**.`.toString(),
    keeps: ["Head Office"],
  },
  {
    writer: "CloudBudgetEvaluator (three services)",
    stored: CloudBudgetEvaluator.describeTopServices(CLOUD_COSTS, "USD")!,
    keeps: [
      "Amazon EC2 ($437.87)",
      "Amazon S3 ($272.74)",
      "AWS Lambda ($34.84)",
    ],
  },
  {
    writer: "CloudBudgetEvaluator (two services)",
    stored: CloudBudgetEvaluator.describeTopServices(
      CLOUD_COSTS.slice(0, 2),
      "EUR",
    )!,
    keeps: ["Amazon EC2 (€437.87)", "Amazon S3 (€272.74)"],
  },
  {
    writer: "CloudBudgetEvaluator (one service)",
    stored: CloudBudgetEvaluator.describeTopServices(
      CLOUD_COSTS.slice(0, 1),
      "USD",
    )!,
    keeps: ["Amazon EC2 ($437.87)"],
  },
  {
    writer: "OnCallPageService (a workflow's page)",
    stored:
      mdText`Created by workflow **${"Page on 5xx"}** to page people.`.toString(),
    keeps: ["Page on 5xx"],
  },
  {
    writer: "WorkspacePage (Slack, by a person)",
    stored:
      mdText`Created by **${"Jane Doe"}** from ${"Slack"} to page people.`.toString(),
    keeps: ["Jane Doe", "Slack"],
  },
  {
    writer: "WorkspacePage (Microsoft Teams, nobody named)",
    stored:
      mdText`Created from ${"Microsoft Teams"} to page people.`.toString(),
    keeps: ["Microsoft Teams"],
  },
];

/*
 * Who opened the record, as OneUptime wrote it into an empty root cause
 * until e1318450be7: older records still hold it, and so do their first
 * state and the monitor statuses they changed (WhoOpenedItRootCause).
 */
const RECORD_ROOT_CAUSES_FORMERLY_WRITTEN: ReadonlyArray<Written> = [
  {
    writer: "IncidentService, before e1318450be7",
    stored:
      mdText`Incident created by ${FeedMarkdown.asMarkdown(USER_LINK)}`.toString(),
    keeps: ["Jane Doe"],
  },
  {
    writer: "AlertService, before e1318450be7",
    stored:
      mdText`Alert created by ${FeedMarkdown.asMarkdown(USER_LINK)}`.toString(),
    keeps: ["Jane Doe"],
  },
  {
    writer: "Slack's Declare Incident, before e1318450be7",
    stored: mdText`Incident created by @${"maya.chen"} on Slack.`.toString(),
    keeps: ["@maya.chen"],
  },
  {
    writer: "Microsoft Teams' Declare Incident, before e1318450be7",
    stored: "Incident created via Microsoft Teams",
  },
  {
    writer: "the OneUptime AI copilot's tool, before e1318450be7",
    stored: "Incident created via the OneUptime AI copilot.",
  },
];

/*
 * A value as a writer places one, of the value's shape where its note
 * reads it only so: a person's link, a chat handle, a percentage.
 */
function sampleValue(note: StatusChangeNote, name: string): string {
  if (note.people?.includes(name)) {
    return `[The ${name}](https://oneuptime.example/${name})`;
  }

  if (note.handles?.includes(name)) {
    return `@the-${name}`;
  }

  if (note.percents?.includes(name)) {
    return "12.5%";
  }

  return `the ${name}`;
}

// Every note a writer writes now, and every one older rows hold.
const ALL_WRITTEN: ReadonlyArray<Written> = [
  ...WRITTEN,
  ...RECORD_ROOT_CAUSES_WRITTEN,
];
const ALL_FORMERLY_WRITTEN: ReadonlyArray<Written> = [
  ...FORMERLY_WRITTEN,
  ...RECORD_ROOT_CAUSES_FORMERLY_WRITTEN,
];

// Each note as test.each takes it: its writer's name, then the note.
function byWriter(list: ReadonlyArray<Written>): Array<[string, Written]> {
  return list.map((written: Written): [string, Written] => {
    return [written.writer, written];
  });
}

function word(stored: string, translator: Translator): string {
  return StatusChangeCauseWording.wordCause({
    rootCause: stored,
    translator: translator,
    setsValuesApart: true,
  });
}

describe("every note OneUptime writes onto a State Timeline is one of its notes", () => {
  test.each(byWriter(WRITTEN))("%s", (_writer: string, written: Written) => {
    expect({
      stored: written.stored,
      read: Boolean(readStatusChangeNote(written.stored)),
    }).toEqual({ stored: written.stored, read: true });
  });

  test.each(byWriter(FORMERLY_WRITTEN))(
    "older rows: %s",
    (_writer: string, written: Written) => {
      expect({
        stored: written.stored,
        read: Boolean(readStatusChangeNote(written.stored)),
      }).toEqual({ stored: written.stored, read: true });
    },
  );

  test.each(byWriter(RECORD_ROOT_CAUSES_WRITTEN))(
    "a record's own root cause: %s",
    (_writer: string, written: Written) => {
      expect({
        stored: written.stored,
        read: Boolean(readStatusChangeNote(written.stored)),
      }).toEqual({ stored: written.stored, read: true });
    },
  );

  test.each(byWriter(RECORD_ROOT_CAUSES_FORMERLY_WRITTEN))(
    "an older record's root cause: %s",
    (_writer: string, written: Written) => {
      expect({
        stored: written.stored,
        read: Boolean(readStatusChangeNote(written.stored)),
      }).toEqual({ stored: written.stored, read: true });
    },
  );

  test("every note of the list is one a writer writes, or wrote", () => {
    const unread: Array<string> = STATUS_CHANGE_NOTES.flatMap(
      (note: StatusChangeNote): Array<string> => {
        return [note.written, ...(note.formerly || [])];
      },
    ).filter((template: string): boolean => {
      // The monitor's own notes have their writers in StatusChangeCauseWording.test.
      return ![...ALL_WRITTEN, ...ALL_FORMERLY_WRITTEN].some(
        (written: Written): boolean => {
          const read: ReturnType<typeof readStatusChangeNote> =
            readStatusChangeNote(written.stored);
          return Boolean(
            read &&
              (read.note.written === template ||
                (read.note.formerly || []).includes(template)),
          );
        },
      );
    });

    // What only StatusChangeCauseWording.test writes: a monitor's status notes.
    for (const template of unread) {
      expect({
        template,
        isMonitorStatusNote: MONITOR_STATUS_TEMPLATES.includes(template),
      }).toEqual({ template, isMonitorStatusNote: true });
    }
  });
});

// A monitor's own status notes, read in StatusChangeCauseWording.test.ts.
const MONITOR_STATUS_TEMPLATES: ReadonlyArray<string> = [
  "Monitor status created by {{user}}",
  "Status was changed because Incident {{incident}} was created.",
  "Status was changed because Incident {{incident}} was updated.",
  "Changed because of maintenance event: {{maintenanceEventId}}",
  "No monitoring criteria met. Change to default status.",
  "This status was created when the monitor was created.",
  "This status was changed when the monitor was updated.",
  "Monitoring is off. Nothing checks the monitor until it is turned back on, so its status stays at the last one recorded, and uptime, status pages and SLOs leave this time out.",
  "Monitoring was turned back on. Uptime, status pages and SLOs count the monitor's time again from here.",
  "{{user}} turned off monitoring. Nothing checks the monitor until it is turned back on, so its status stays at the last one recorded, and uptime, status pages and SLOs leave this time out.",
  "{{user}} turned monitoring back on. Uptime, status pages and SLOs count the monitor's time again from here.",
  "Something this project uses has an incident.",
  "What this project uses is back.",
];

describe.each(LANGUAGES)(
  "in %s, from the Dashboard's own locale",
  (language: string) => {
    const translator: Translator = dashboardTranslator(language);

    test.each(byWriter([...ALL_WRITTEN, ...ALL_FORMERLY_WRITTEN]))(
      "%s reads in the reader's words, its values as written",
      (_writer: string, written: Written) => {
        const worded: string = plain(word(written.stored, translator));
        const read: ReturnType<typeof readStatusChangeNote> =
          readStatusChangeNote(written.stored);
        const said: string = read!.note.said || read!.note.written;

        // The reader's sentence, never the stored English.
        expect({ stored: written.stored, worded }).not.toEqual({
          stored: written.stored,
          worded: plain(written.stored),
        });
        expect(translator.hasTranslation(said)).toBe(true);

        for (const value of written.keeps || []) {
          expect({ value, kept: worded.includes(value) }).toEqual({
            value,
            kept: true,
          });
        }
      },
    );
  },
);

describe("a note's values, as the reader reads them", () => {
  const persian: Translator = dashboardTranslator("fa");
  const arabic: Translator = dashboardTranslator("ar");

  test("a person's link and an incident's number are kept as written, set apart in a sentence read from the right", () => {
    const stored: string = getDeclaredAlertAcknowledgementCause({
      incidentNumber: "INC-42",
      isIncidentPrivate: false,
    });
    const worded: string = word(stored, persian);

    expect(worded).toContain("⁨INC-42⁩");
    expect(
      word(
        mdText`Incident state created by ${FeedMarkdown.asMarkdown(USER_LINK)}`.toString(),
        arabic,
      ),
    ).toContain(`⁨${USER_LINK}⁩`);
  });

  test("a count of minutes is written in the reader's digits", () => {
    const stored: string =
      mdText`The SLO no longer has ${1440} minutes of counted requests, so this burn rate rule can no longer justify an open alert or incident.`.toString();

    expect(plain(word(stored, persian))).toContain("۱٬۴۴۰");
    // Arabic writes Latin digits.
    expect(plain(word(stored, arabic))).toMatch(/1[,٬]?440/);
  });

  test("a default status name reads in the reader's words, a status a project named as written", () => {
    const german: Translator = dashboardTranslator("de");
    const operational: string =
      mdText`**Recovered:** Network site **${"Head Office"}** rolled back up to ${"Operational"}.`.toString();
    const named: string =
      mdText`**Recovered:** Network site **${"Head Office"}** rolled back up to ${"Up and Running"}.`.toString();

    expect(plain(word(operational, german))).not.toContain("Operational");
    expect(plain(word(operational, german))).toContain(
      readDashboardLocale("de")["Operational"] as string,
    );
    expect(plain(word(named, german))).toContain("Up and Running");
  });

  test("in English, each reads as stored - but for a sentence said better", () => {
    for (const written of [...ALL_WRITTEN, ...ALL_FORMERLY_WRITTEN]) {
      const read: ReturnType<typeof readStatusChangeNote> =
        readStatusChangeNote(written.stored);
      const worded: string = plain(word(written.stored, ENGLISH));

      if (!read!.note.said && !read!.note.formerly) {
        expect(worded).toBe(plain(written.stored));
      }
    }

    expect(word(STATE_CHANGED_BY_EPISODE, ENGLISH)).toBe(
      STATE_CHANGED_WITH_ITS_EPISODE,
    );
    expect(
      plain(
        word(
          mdText`Episode state created by ${FeedMarkdown.asMarkdown(USER_LINK)}`.toString(),
          ENGLISH,
        ),
      ),
    ).toBe(`Changed by ${USER_LINK}`);
    // An older row reads as the note does now.
    expect(word("Episode reopened due to new alert added.", ENGLISH)).toBe(
      EPISODE_REOPENED_BY_NEW_ALERT,
    );
  });
});

/*
 * A RECORD'S OWN ROOT CAUSE ON ITS ROOT CAUSE PAGE AND WHAT HAPPENED CARD
 * (#10125).
 *
 * Why OneUptime opened an incident or an alert read in English on every
 * page: "Sigma detection rule ... matched security events.", an SLO's burn
 * rate, a network site's rollup, a budget's costs, a page from a workflow
 * or a chat, and who opened it on older records. Each is a note of the
 * registry now, read by RecordRootCauseWording on the record's own pages
 * and by View Cause on the copy its first state holds - the same words.
 */
describe("a record's own root cause, as its Root Cause page and What happened card read it (#10125)", () => {
  const german: Translator = dashboardTranslator("de");
  const persian: Translator = dashboardTranslator("fa");
  const arabic: Translator = dashboardTranslator("ar");

  function wordRecord(stored: string, translator: Translator): string {
    return RecordRootCauseWording.wordRootCause({
      rootCause: stored,
      translator: translator,
      setsValuesApart: true,
    });
  }

  test.each(
    byWriter([
      ...RECORD_ROOT_CAUSES_WRITTEN,
      ...RECORD_ROOT_CAUSES_FORMERLY_WRITTEN,
    ]),
  )(
    "%s reads in the reader's words on the record's pages, as View Cause reads its first state",
    (_writer: string, written: Written) => {
      for (const language of LANGUAGES) {
        const translator: Translator = dashboardTranslator(language);
        const worded: string = wordRecord(written.stored, translator);

        expect({ language, worded: plain(worded) }).not.toEqual({
          language,
          worded: plain(written.stored),
        });
        // The record and its first state, which holds a copy, say the same.
        expect(worded).toBe(word(written.stored, translator));

        for (const value of written.keeps || []) {
          expect({
            language,
            value,
            kept: plain(worded).includes(value),
          }).toEqual({ language, value, kept: true });
        }
      }
    },
  );

  test("a policy tier's threshold is written in the reader's digits", () => {
    const stored: string =
      mdText`The error budget left of SLO "${"Checkout availability"}" is at or below ${formatSloPolicyTierThreshold(12.345)}, the "${"Freeze"}" tier of its error budget policy.`.toString();

    expect(stored).toContain("12.35%");
    expect(plain(wordRecord(stored, persian))).toContain("۱۲٫۳۵٪");
    expect(plain(wordRecord(stored, german))).toContain("12,35 %");
    expect(plain(wordRecord(stored, persian))).not.toContain("12.35%");
  });

  test("what cost the most is listed the way the reader's language lists it, each cost as written", () => {
    const stored: string = CloudBudgetEvaluator.describeTopServices(
      CLOUD_COSTS,
      "USD",
    )!;

    expect(stored).toBe(
      "What cost the most this month: Amazon EC2 ($437.87), Amazon S3 ($272.74) and AWS Lambda ($34.84).",
    );
    expect(plain(wordRecord(stored, german))).toContain(
      "Amazon EC2 ($437.87), Amazon S3 ($272.74) und AWS Lambda ($34.84)",
    );
    expect(plain(wordRecord(stored, persian))).toContain(
      "Amazon EC2 ($437.87)، Amazon S3 ($272.74) و AWS Lambda ($34.84)",
    );
    expect(plain(wordRecord(stored, persian))).not.toContain(" and ");
    // Two costs, and one, read the same way.
    expect(
      plain(
        wordRecord(
          CloudBudgetEvaluator.describeTopServices(
            CLOUD_COSTS.slice(0, 2),
            "USD",
          )!,
          german,
        ),
      ),
    ).toContain("Amazon EC2 ($437.87) und Amazon S3 ($272.74)");
  });

  test("a list of costs is read item by item, and a name with a bracket and a comma of its own is kept whole", () => {
    expect(
      readCostItems("Amazon EC2 ($1), Amazon S3 ($2) and AWS Lambda ($3)"),
    ).toEqual(["Amazon EC2 ($1)", "Amazon S3 ($2)", "AWS Lambda ($3)"]);
    expect(readCostItems("Amazon EC2 ($1) and Amazon S3 ($2)")).toEqual([
      "Amazon EC2 ($1)",
      "Amazon S3 ($2)",
    ]);
    expect(readCostItems("Compute (EC2) ($437.87)")).toEqual([
      "Compute (EC2) ($437.87)",
    ]);
    expect(readCostItems("Foo (bar), baz ($1)")).toBeNull();
    expect(readCostItems("Amazon EC2")).toBeNull();

    const stored: string =
      "What cost the most this month: Foo (bar), baz ($1).";

    expect(plain(wordRecord(stored, german))).toContain("Foo (bar), baz ($1)");
  });

  test("a default status a site rolled up to is in the reader's words, a status the project named as written", () => {
    const degraded: string =
      mdText`Network site **${"Head Office"}** rolled up to **${"Degraded"}**.`.toString();

    expect(plain(wordRecord(degraded, german))).toContain(
      readDashboardLocale("de")["Degraded"] as string,
    );
    expect(plain(wordRecord(degraded, german))).not.toContain("Degraded");
  });

  test("who opened an older record: a person's link is kept whole, set apart in a sentence read from the right", () => {
    const stored: string =
      mdText`Incident created by ${FeedMarkdown.asMarkdown(USER_LINK)}`.toString();

    expect(wordRecord(stored, arabic)).toContain(`⁨${USER_LINK}⁩`);
    expect(wordRecord(stored, persian)).toContain(`⁨${USER_LINK}⁩`);
    expect(plain(wordRecord(stored, ENGLISH))).toBe(`Declared by ${USER_LINK}`);
    expect(
      plain(
        wordRecord(
          mdText`Alert created by ${FeedMarkdown.asMarkdown(USER_LINK)}`.toString(),
          ENGLISH,
        ),
      ),
    ).toBe(`Created by ${USER_LINK}`);
    expect(
      plain(wordRecord("Incident created by @maya.chen on Slack.", ENGLISH)),
    ).toBe("Declared by @maya.chen in Slack.");
    expect(
      plain(wordRecord("Incident created via Microsoft Teams", ENGLISH)),
    ).toBe("Declared from Microsoft Teams.");
    expect(
      plain(
        wordRecord("Incident created via the OneUptime AI copilot.", ENGLISH),
      ),
    ).toBe("Declared by OneUptime AI.");
  });

  test("a root cause a person typed that starts as OneUptime's reads as they wrote it", () => {
    for (const typed of [
      "Incident created by a bad deploy of checkout-api.",
      "Incident created by Maya Chen",
      `Incident created by ${USER_LINK}, who rolled back the pool size change.`,
      "Incident created by @maya on Slack. The pool was cut to 10.",
      "Incident created by @ on Slack.",
      "Incident created via Microsoft Teams after a bad deploy",
      'Sigma detection rule "Sudo" matched security events. We think it was a test.',
      'The error budget left of SLO "Checkout" is at or below a quarter, the "Freeze" tier of its error budget policy.',
      "What cost the most this month: EC2.\nAnd S3.",
    ]) {
      expect({ typed, read: readStatusChangeNote(typed) }).toEqual({
        typed,
        read: null,
      });
      expect(wordRecord(typed, ENGLISH)).toBe(typed);
    }
  });

  test("the What happened card reads exactly the notes that say who opened the record as no root cause", () => {
    for (const written of RECORD_ROOT_CAUSES_FORMERLY_WRITTEN) {
      expect({
        stored: written.stored,
        isWhoOpenedIt: isWhoOpenedItRootCause(written.stored),
      }).toEqual({ stored: written.stored, isWhoOpenedIt: true });
    }

    for (const written of [...WRITTEN, ...RECORD_ROOT_CAUSES_WRITTEN]) {
      expect({
        stored: written.stored,
        isWhoOpenedIt: isWhoOpenedItRootCause(written.stored),
      }).toEqual({ stored: written.stored, isWhoOpenedIt: false });
    }

    expect(
      WHO_OPENED_IT_NOTES.map((note: StatusChangeNote): string => {
        return note.written;
      }),
    ).toEqual([
      "Incident created by {{user}}",
      "Alert created by {{user}}",
      "Incident created by {{handle}} on Slack.",
      "Incident created via Microsoft Teams",
      "Incident created via the OneUptime AI copilot.",
    ]);
  });

  test("a criteria's Markdown, or a root cause a person wrote, reads as the record's monitor wording has it", () => {
    const criteria: string =
      "**Created because the following criteria was met**:\n\n**Criteria Name**: Website is down";
    const worded: string = plain(wordRecord(criteria, german));

    expect(worded).not.toContain("Criteria Name");
    expect(worded).toContain("Website is down");
    expect(wordRecord("The pool was cut to 10.", german)).toBe(
      "The pool was cut to 10.",
    );
    expect(wordRecord("", german)).toBe("");
  });

  test("regression: a Sigma rule's root cause read in English on a Persian page", () => {
    const stored: string =
      mdText`Sigma detection rule "${"Sudo to root"}" matched security events.`.toString();

    expect(plain(wordRecord(stored, persian))).not.toContain(
      "matched security events",
    );
    expect(plain(wordRecord(stored, persian))).toContain("Sudo to root");
  });
});

describe("an auto-resolve, and OneUptime's own why on the same line", () => {
  test.each(["de", "fa", "ar"])(
    "%s: the auto-resolve sentence and why it resolved both read in the reader's words",
    (language: string) => {
      const translator: Translator = dashboardTranslator(language);

      for (const [prefix, why] of [
        [
          INCIDENT_AUTO_RESOLVED,
          "Incoming request reported this key as resolved.",
        ],
        [
          ALERT_AUTO_RESOLVED,
          PerSeriesResolutionRootCause.build({
            seriesLabels: SERIES_LABELS,
            createdCriteriaId: "criteria-1",
            criteriaInstancesById: criteria,
          }),
        ],
        [INCIDENT_AUTO_RESOLVED, LOG_GROUP_RESOLVED_ROOT_CAUSE],
        [
          ALERT_AUTO_RESOLVED,
          "No monitoring criteria met. Change to default status.",
        ],
      ] as Array<[string, string]>) {
        // As MonitorIncident and MonitorAlert write it: one line.
        const stored: string = `${prefix} ${why}`;
        const worded: string = plain(word(stored, translator));

        expect(worded.startsWith(plain(translator.translateText(prefix)))).toBe(
          true,
        );
        expect(worded).toContain(plain(word(why, translator)));
        expect(worded).not.toContain(why);
      }
    },
  );

  test("in English it reads as stored", () => {
    const stored: string = `${INCIDENT_AUTO_RESOLVED} Incoming request reported this key as resolved.`;

    expect(word(stored, ENGLISH)).toBe(stored);
  });

  test("regression: the whole line read in English on every page", () => {
    const stored: string = `${INCIDENT_AUTO_RESOLVED} Incoming request reported this key as resolved.`;

    expect(plain(word(stored, dashboardTranslator("fa")))).not.toContain(
      "Incoming request",
    );
  });
});

describe("the notes, read whole", () => {
  test("a note inside other words, or cut short, reads as written", () => {
    for (const text of [
      "Note: This status was changed when the incident was updated.",
      "This status was changed when the incident was updated. And then some.",
      "Incident state created by",
      "Resolved because linked Incident #42 was",
      `${"x".repeat(4000)} turned off monitoring for the monitor **a**.`,
    ]) {
      expect(readStatusChangeNote(text)).toBeNull();
      expect(wordStatusChangeNote(text, dashboardTranslator("de"))).toBeNull();
    }
  });

  test("a value is at most a line, and bounded", () => {
    expect(
      readStatusChangeNote(`Incident state created by ${"a".repeat(600)}`),
    ).toBeNull();
    expect(
      readStatusChangeNote("Incident state created by Jane\nDoe"),
    ).toBeNull();
  });

  test("a note written from its template is read back as itself, its values with it", () => {
    for (const note of STATUS_CHANGE_NOTES) {
      for (const template of [note.written, ...(note.formerly || [])]) {
        const values: Record<string, string> = {};

        for (const name of getStatusChangeNotePlaceholders(template)) {
          values[name] = sampleValue(note, name);
        }

        const read: ReturnType<typeof readStatusChangeNote> =
          readStatusChangeNote(writeStatusChangeNote(template, values));

        expect({ template, note: read?.note.written }).toEqual({
          template,
          note: note.written,
        });
        expect(read?.values).toEqual(values);
      }
    }
  });

  test("what a reader reads names only values the note holds", () => {
    for (const note of STATUS_CHANGE_NOTES) {
      const held: Array<string> = getStatusChangeNotePlaceholders(note.written);

      for (const name of getStatusChangeNotePlaceholders(
        note.said || note.written,
      )) {
        expect({ note: note.written, name, held: held.includes(name) }).toEqual(
          { note: note.written, name, held: true },
        );
      }

      for (const formerly of note.formerly || []) {
        expect({
          formerly,
          values: getStatusChangeNotePlaceholders(formerly).sort(),
        }).toEqual({ formerly, values: [...held].sort() });
      }
    }
  });

  test("a person's change on any record says Changed by, as a monitor's does", () => {
    for (const stored of [
      "Incident state created by [Jane](https://x)",
      "Alert state created by [Jane](https://x)",
      "Episode state created by [Jane](https://x)",
      "Monitor status created by [Jane](https://x)",
    ]) {
      expect(readStatusChangeNote(stored)?.note.said).toBe(
        STATUS_CHANGED_BY_USER,
      );
    }
  });
});

/*
 * The notes are read by their English, as the server writes them: a writer
 * that changes its words without this list would leave the note in English
 * on every page. Each writer still writes it so - by the constant where it
 * has one.
 */
describe("the server still writes each note as it is read (#9959)", () => {
  test.each([
    [
      "packages/Common/Server/Services/IncidentStateTimelineService.ts",
      "mdText`Incident state created by ${",
    ],
    [
      "packages/Common/Server/Services/AlertStateTimelineService.ts",
      "mdText`Alert state created by ${",
    ],
    [
      "packages/Common/Server/Services/IncidentEpisodeStateTimelineService.ts",
      "mdText`Episode state created by ${",
    ],
    [
      "packages/Common/Server/Services/AlertEpisodeStateTimelineService.ts",
      "mdText`Episode state created by ${",
    ],
    [
      "packages/Common/Server/Services/IncidentService.ts",
      "rootCause: STATE_CHANGED_WITH_INCIDENT,",
    ],
    [
      "packages/Common/Server/Services/AlertService.ts",
      "rootCause: STATE_CHANGED_WITH_ALERT,",
    ],
    [
      "packages/Common/Server/Services/IncidentEpisodeService.ts",
      "rootCause: STATE_CHANGED_WITH_EPISODE,",
    ],
    [
      "packages/Common/Server/Services/IncidentEpisodeService.ts",
      "rootCause: STATE_CHANGED_BY_EPISODE,",
    ],
    [
      "packages/Common/Server/Services/AlertEpisodeService.ts",
      "rootCause: STATE_CHANGED_WITH_EPISODE,",
    ],
    [
      "packages/Common/Server/Services/AlertEpisodeService.ts",
      "rootCause: STATE_CHANGED_BY_EPISODE,",
    ],
    [
      "packages/Common/Server/Services/IncidentEpisodeService.ts",
      "? EPISODE_ACKNOWLEDGED_BY_USER",
    ],
    [
      "packages/Common/Server/Services/IncidentEpisodeService.ts",
      ": EPISODE_ACKNOWLEDGED_VIA_API",
    ],
    [
      "packages/Common/Server/Services/IncidentEpisodeService.ts",
      "? EPISODE_RESOLVED_BY_USER",
    ],
    [
      "packages/Common/Server/Services/IncidentEpisodeService.ts",
      ": EPISODE_RESOLVED_VIA_API",
    ],
    [
      "packages/Common/Server/Services/IncidentEpisodeService.ts",
      "? EPISODE_REOPENED_BY_USER",
    ],
    [
      "packages/Common/Server/Services/IncidentEpisodeService.ts",
      ": EPISODE_REOPENED_VIA_API",
    ],
    [
      "packages/App/FeatureSet/Workers/Jobs/IncidentEpisode/AutoResolve.ts",
      "EPISODE_RESOLVED_ALL_INCIDENTS_RESOLVED,",
    ],
    [
      "packages/App/FeatureSet/Workers/Jobs/AlertEpisode/AutoResolve.ts",
      "EPISODE_RESOLVED_ALL_ALERTS_RESOLVED,",
    ],
    [
      "packages/App/FeatureSet/Workers/Jobs/IncidentEpisode/ResolveInactiveEpisodes.ts",
      "EPISODE_RESOLVED_NO_NEW_INCIDENT,",
    ],
    [
      "packages/App/FeatureSet/Workers/Jobs/AlertEpisode/ResolveInactiveEpisodes.ts",
      "EPISODE_RESOLVED_NO_NEW_ALERT,",
    ],
    [
      "packages/Common/Server/Services/IncidentGroupingEngineService.ts",
      "EPISODE_REOPENED_BY_NEW_INCIDENT,",
    ],
    [
      "packages/Common/Server/Services/AlertGroupingEngineService.ts",
      "EPISODE_REOPENED_BY_NEW_ALERT,",
    ],
    [
      "packages/Common/Server/Services/IncidentAlertService.ts",
      "mdText`Resolved because linked ${incidentLabel} was resolved.`",
    ],
    [
      "packages/Common/Server/Services/IncidentAlertService.ts",
      "mdText`Acknowledged because linked ${incidentLabel} was ${",
    ],
    [
      "packages/Common/Server/Services/IncidentAlertService.ts",
      'plan.incidentReachedResolved ? "resolved" : "acknowledged"',
    ],
    [
      "packages/Common/Server/Utils/Monitor/MonitorResource.ts",
      '"Incoming request reported this key as resolved."',
    ],
    [
      "packages/Common/Server/Utils/Monitor/MonitorResource.ts",
      '"Incoming request with no value to group by reported recovered."',
    ],
    [
      "packages/Common/Server/Services/NetworkSiteService.ts",
      'mdText`**Recovered:** Network site **${site.name || "site"}** rolled back up to ${data.newStatus.name || "an operational status"}.`',
    ],
    [
      "packages/Common/Server/Services/ServiceLevelObjectiveBurnRateRuleService.ts",
      '"Auto-resolved because the SLO burn rate rule that created it was deleted."',
    ],
    [
      "packages/Common/Server/Services/ServiceLevelObjectiveBurnRateRuleService.ts",
      '"Alert auto-resolved because the SLO burn rate rule that created it was disabled."',
    ],
    [
      "packages/Common/Server/Services/ServiceLevelObjectiveBurnRateRuleService.ts",
      '"Alert auto-resolved because the SLO burn rate rule that created it no longer raises alerts."',
    ],
    [
      "packages/Common/Server/Services/ServiceLevelObjectiveBurnRateRuleService.ts",
      '"Incident auto-resolved because the SLO burn rate rule that declared it was disabled."',
    ],
    [
      "packages/Common/Server/Services/ServiceLevelObjectiveBurnRateRuleService.ts",
      '"Incident auto-resolved because the SLO burn rate rule that declared it no longer declares incidents."',
    ],
    [
      "packages/Common/Server/Services/ServiceLevelObjectiveBurnRateRuleService.ts",
      '"Alert auto-resolved because the SLO burn rate rule that created it is no longer active."',
    ],
    [
      "packages/Common/Server/Services/ServiceLevelObjectiveBurnRateRuleService.ts",
      '"Incident auto-resolved because the SLO burn rate rule that declared it is no longer active."',
    ],
    [
      "packages/Common/Server/Services/ServiceLevelObjectiveErrorBudgetPolicyTierService.ts",
      '"Alert auto-resolved because the error budget policy tier that raised it no longer applies."',
    ],
    [
      "packages/Common/Server/Services/ServiceLevelObjectiveErrorBudgetPolicyTierService.ts",
      '"Incident auto-resolved because the error budget policy tier that declared it no longer applies."',
    ],
    [
      "packages/App/FeatureSet/Workers/Jobs/Slo/EvaluateSlos.ts",
      'mdText`Superseded: SLO "${context.slo.name || ""}" entered the more severe "${currentTier.name || ""}" tier of its error budget policy.`',
    ],
    [
      "packages/App/FeatureSet/Workers/Jobs/Slo/EvaluateSlos.ts",
      'mdText`The error budget of SLO "${context.slo.name || ""}" recovered out of the "${tier.name || ""}" tier of its error budget policy.`',
    ],
    [
      "packages/App/FeatureSet/Workers/Jobs/Slo/EvaluateSlos.ts",
      '"Auto-resolved because this SLO burn rate rule no longer has a valid threshold and window configuration, so it can no longer justify staying open."',
    ],
    [
      "packages/App/FeatureSet/Workers/Jobs/Slo/EvaluateSlos.ts",
      '"Burn rate dropped below threshold."',
    ],
    [
      "packages/App/FeatureSet/Workers/Jobs/Slo/EvaluateSlos.ts",
      "mdText`The SLO no longer has ${rule.longWindowInMinutes} minutes of counted requests, so this burn rate rule can no longer justify an open alert or incident.`",
    ],
    [
      "packages/App/FeatureSet/Workers/Jobs/Slo/EvaluateSlos.ts",
      "mdText`The SLO no longer has ${rule.longWindowInMinutes} minutes of monitoring history, so this burn rate rule can no longer justify an open alert or incident.`",
    ],
    [
      "packages/Common/Server/Utils/CloudConnection/CloudBudgetEvaluator.ts",
      '"Resolved by OneUptime: the month this cloud budget alert was raised in is over."',
    ],
    [
      "packages/Common/Server/Utils/OpenStack/OpenStackBudgetEvaluator.ts",
      '"Resolved by OneUptime: the month this OpenStack budget alert was raised in is over."',
    ],
    [
      "packages/Common/Server/Utils/DataSecurity/DataSecurityIssueAlerts.ts",
      "`Resolved by Data Security, as the issue it was raised for is no longer open: ${issue.why}.`",
    ],
    [
      "packages/Common/Server/Utils/DataSecurity/DataSecurityIssueReconciler.ts",
      '? "its check no longer runs on the store"',
    ],
    [
      "packages/Common/Server/Utils/DataSecurity/DataSecurityIssueReconciler.ts",
      ': "its check passes now"',
    ],
    [
      "packages/Common/Server/Utils/DataSecurity/DataSecurityIssueReconciler.ts",
      'why: "its store was archived"',
    ],
    [
      "packages/Common/Server/Utils/DataObservability/DataAlertFeedbackRecorder.ts",
      "`Marked ${data.feedback.toLowerCase()} in Data Observability.`",
    ],
    [
      "packages/Common/Server/Utils/AutoRemediation/RemediationVerifier.ts",
      'mdText`Auto-resolved by auto-remediation: ${remediationDescription} (rule "${suggestion.ruleNameSnapshot || "AI rule"}") completed and the monitor(s) recovered within the verification window.`',
    ],
    [
      "packages/Common/Server/Utils/AutoRemediation/RemediationVerifier.ts",
      '? "the AI command remediation"',
    ],
    [
      "packages/Common/Server/Utils/AutoRemediation/RemediationVerifier.ts",
      '? "the fix through MCP servers"',
    ],
    [
      "packages/Common/Server/Utils/AutoRemediation/RemediationVerifier.ts",
      ': `runbook "${suggestion.runbookNameSnapshot || "Runbook"}"`',
    ],
    [
      "packages/Common/Server/Utils/AI/FirstResponder/AiFirstResponder.ts",
      "mdText`Resolved by OneUptime AI: its fix was verified - every affected monitor is operational again - so nobody was paged.`",
    ],
    // A record's own root cause, when OneUptime opened it (#10125).
    [
      "packages/Common/Server/Utils/Monitor/IncomingRequestIncidentGrouping.ts",
      "mdText`Incoming request matched grouping key \\`${input.item.keyValue}\\`.`",
    ],
    [
      "packages/Common/Server/Utils/SecurityEvent/DetectionRuleEvaluator.ts",
      'mdText`Sigma detection rule "${rule.name}" matched security events.`',
    ],
    [
      "packages/Common/Server/Utils/SecurityEvent/ThreatIntel/ThreatIntelMatcher.ts",
      'mdText`Threat intel feed "${feed.name}" indicator matched security events.`',
    ],
    [
      "packages/Common/Server/Utils/DataSecurity/DataSecurityIntegrations.ts",
      'mdText`The Data Security check "${issue.checkId}" failed on ${issue.dataStoreName}.`',
    ],
    [
      "packages/App/FeatureSet/Workers/Jobs/Slo/EvaluateSlos.ts",
      'mdText`Error budget burn rate breached the "${rule.name}" rule of SLO "${context.slo.name}".`',
    ],
    [
      "packages/App/FeatureSet/Workers/Jobs/Slo/EvaluateSlos.ts",
      'mdText`The error budget left of SLO "${context.slo.name || ""}" is at or below ${formatSloPolicyTierThreshold(tier.thresholdPercentage)}, the "${tier.name || ""}" tier of its error budget policy.`',
    ],
    [
      "packages/Common/Server/Services/NetworkSiteService.ts",
      "mdText`Network site **${site.name || site.id.toString()}** rolled up to **${statusName}**.`",
    ],
    [
      "packages/Common/Server/Services/OnCallPageService.ts",
      "mdText`Created by workflow **${workflowName}** to page people.`",
    ],
    [
      "packages/Common/Server/Utils/Workspace/WorkspacePage.ts",
      "mdText`Created by **${pagerName}** from ${WorkspacePage.getWorkspaceName(data.workspaceType)} to page people.`",
    ],
    [
      "packages/Common/Server/Utils/Workspace/WorkspacePage.ts",
      "mdText`Created from ${WorkspacePage.getWorkspaceName(data.workspaceType)} to page people.`",
    ],
    // Copied to the record's first state, where View Cause reads it.
    [
      "packages/Common/Server/Services/IncidentService.ts",
      "rootCause: createdItem.rootCause,",
    ],
    [
      "packages/Common/Server/Services/AlertService.ts",
      "rootCause: createdItem.rootCause,",
    ],
  ])("%s writes %s", (file: string, written: string) => {
    expect(source(file)).toContain(written);
  });

  test("no episode writer says a person or the API did what OneUptime did", () => {
    // The jobs and the grouping engines name why, so "via API" is the API's alone.
    for (const file of [
      "packages/App/FeatureSet/Workers/Jobs/IncidentEpisode/AutoResolve.ts",
      "packages/App/FeatureSet/Workers/Jobs/IncidentEpisode/ResolveInactiveEpisodes.ts",
      "packages/App/FeatureSet/Workers/Jobs/AlertEpisode/AutoResolve.ts",
      "packages/App/FeatureSet/Workers/Jobs/AlertEpisode/ResolveInactiveEpisodes.ts",
      "packages/Common/Server/Services/IncidentGroupingEngineService.ts",
      "packages/Common/Server/Services/AlertGroupingEngineService.ts",
    ]) {
      expect({
        file,
        names: EPISODE_NOTE_NAME.test(source(file)),
      }).toEqual({ file, names: true });
    }

    expect(
      source("packages/Common/Server/Services/AlertEpisodeService.ts"),
    ).not.toContain("Episode reopened due to new alert added.");
  });
});
