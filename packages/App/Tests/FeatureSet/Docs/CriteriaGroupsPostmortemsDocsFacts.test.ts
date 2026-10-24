import {
  BUILT_IN_POSTMORTEM_OUTLINES,
  CRITERIA_AND_STATUSES,
  MONITOR_GROUPS,
  POSTMORTEMS,
  SEEDED_MONITOR_STATUSES,
} from "./CriteriaGroupsPostmortemsDocsPages";
import { readPage } from "./DocsContentSupport";
import {
  MenuSection,
  PACKAGES_DIR,
  developerSection,
  menuSections,
  readCommonSource,
  readDashboardSource,
  sectionByTitle,
  startsCollapsed,
  workspaceSection,
} from "./DocsDashboardMenus";
import { escapeRegExp } from "./DocsTranslationChecks";
import CriteriaNameUtil from "../../../FeatureSet/Dashboard/src/Utils/Form/Monitor/CriteriaName";
import CriteriaFilterUiUtil from "../../../FeatureSet/Dashboard/src/Utils/Form/Monitor/CriteriaFilter";
import { MonitorMoreFieldsTitles } from "../../../FeatureSet/Dashboard/src/Components/Form/Monitor/MonitorMoreFields";
import {
  STATE_SETTINGS_COPY,
  StateSettingsCountsAsCopy,
  StateSettingsSharedCopy,
} from "../../../FeatureSet/Dashboard/src/Components/StateSettings/StateSettingsCopy";
import MonitorGroupsSwitchCopy, {
  MONITOR_GROUPS_SWITCH_COLUMN,
} from "../../../FeatureSet/Dashboard/src/Components/MonitorGroup/MonitorGroupsSwitchCopy";
import {
  AI_LANE_ADVANCED_CARDS,
  AI_LANE_ADVANCED_CARD_TITLES,
  AI_LANE_SWITCHES,
  AiLane,
  AiLaneAdvancedCard,
} from "../../../FeatureSet/Dashboard/src/Components/AISettings/ProjectAiSettingsCopy";
import { POSTMORTEM_RULE_TEMPLATES_TITLE } from "../../../FeatureSet/Dashboard/src/Components/AISettings/PostmortemRulesCopy";
import { StatusPageDisplaySettingsCopy } from "../../../FeatureSet/Dashboard/src/Components/StatusPage/StatusPageDisplaySettingsCopy";
import MonitorGroupMonitorsCopy from "../../../FeatureSet/Dashboard/src/Components/MonitorGroup/MonitorGroupMonitorsCopy";
import SubscriberNotificationResendCopy from "../../../FeatureSet/Dashboard/src/Components/StatusPageSubscribers/SubscriberNotificationResendCopy";
import Alert from "Common/Models/DatabaseModels/Alert";
import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentEpisode from "Common/Models/DatabaseModels/IncidentEpisode";
import IncidentPostmortemStatus from "Common/Models/DatabaseModels/IncidentPostmortemStatus";
import IncidentPostmortemTemplate from "Common/Models/DatabaseModels/IncidentPostmortemTemplate";
import MonitorGroup from "Common/Models/DatabaseModels/MonitorGroup";
import MonitorGroupResource from "Common/Models/DatabaseModels/MonitorGroupResource";
import MonitorStatus from "Common/Models/DatabaseModels/MonitorStatus";
import MonitorStatusTimeline from "Common/Models/DatabaseModels/MonitorStatusTimeline";
import Project from "Common/Models/DatabaseModels/Project";
import ScheduledMaintenance from "Common/Models/DatabaseModels/ScheduledMaintenance";
import ServiceLevelObjective from "Common/Models/DatabaseModels/ServiceLevelObjective";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import { ColumnAccessControl } from "Common/Types/BaseDatabase/AccessControl";
import { PlanType } from "Common/Types/Billing/SubscriptionPlan";
import FilterCondition from "Common/Types/Filter/FilterCondition";
import { isFilterConditionNeeded } from "Common/Types/Filter/FilterConditionUtil";
import {
  CheckOn,
  CriteriaFilter,
  CriteriaFilterUtil,
  EvaluateOverTimeType,
  FilterType,
} from "Common/Types/Monitor/CriteriaFilter";
import MonitorCriteria from "Common/Types/Monitor/MonitorCriteria";
import MonitorCriteriaInstance from "Common/Types/Monitor/MonitorCriteriaInstance";
import MonitorSteps from "Common/Types/Monitor/MonitorSteps";
import MonitorType, {
  MonitorTypeHelper,
} from "Common/Types/Monitor/MonitorType";
import ObjectID from "Common/Types/ObjectID";
import Permission, { PermissionHelper } from "Common/Types/Permission";
import IncidentPostmortemPublication, {
  PostmortemNotificationAction,
} from "Common/Types/StatusPage/IncidentPostmortemPublication";
import StatusPageSubscriberNotificationStatus from "Common/Types/StatusPage/StatusPageSubscriberNotificationStatus";
import { POSTMORTEM_WAITS_FOR_PREPARING_TRANSCRIPT_MS } from "Common/Types/VideoCall/CallTranscriptAutoFetch";
import IncidentMeasurementAnchorType from "Common/Types/Incident/IncidentMeasurementAnchorType";
import { POSTMORTEM_TEMPLATES } from "Common/UI/Components/AI/AITemplates";
import {
  MORE_FIELDS_SECTION_TITLE,
  MORE_SETTINGS_SECTION_TITLE,
} from "Common/UI/Components/FoldedSection/FoldedSectionTitles";
import { RULE_CRITERIA_SUBJECT_COPY } from "Common/UI/Components/RuleCriteria/RuleCriteriaSubjectCopy";
import { RULE_CRITERIA_FIELDS_BY_MODEL } from "Common/Types/Rules/RuleCriteriaFieldRegistry";
import RuleCriteriaSubject, {
  getRuleCriteriaSubjectForModel,
} from "Common/Types/Rules/RuleCriteriaSubject";
import AIPostmortemRule from "Common/Models/DatabaseModels/AIPostmortemRule";
import {
  MeasurementDomain,
  MeasurementPreset,
  getMeasurementPresets,
} from "Common/Utils/Measurement/MeasurementMoments";
import MonitorDependencyRule, {
  ParentMonitorStatusRef,
} from "Common/Utils/Monitor/MonitorDependencyRule";
import PostmortemStatusUtil, {
  DEFAULT_POSTMORTEM_STATUSES,
  DefaultPostmortemStatus,
  PostmortemProgress,
} from "Common/Utils/Incident/PostmortemStatus";
import ArchivedMonitorResources from "Common/Utils/StatusPage/ArchivedMonitorResources";
import StatusPageResourceUptimeUtil from "Common/Utils/StatusPage/ResourceUptime";
import {
  STATE_LISTS,
  StateListRow,
  StateListType,
  getStateListDeleteRefusal,
  getStateListInsertValue,
  toStateListRow,
} from "Common/Utils/StateOrder";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Docs overhaul task 36 added three pages the docs never had, and each one
 * names a great deal of the product:
 *
 *   - Monitor Criteria & Statuses: how criteria judge a check (top to
 *     bottom, the first match decides, the default status when none does),
 *     what a criteria holds, when its incidents and alerts open and close,
 *     the criteria editor, and the project's monitor statuses - seeded,
 *     ordered, built in, planned and permitted;
 *   - Monitor Groups: the worst-status rule, the feature flag, the plan and
 *     roles, the group's pages, and a group on a status page;
 *   - Postmortems: the incident's Postmortem page and its form, templates
 *     and AI drafts, publishing on the status page and telling subscribers
 *     once, episodes and the API fields.
 *
 * Markdown is not compiled, so nothing else notices when the product moves
 * on. These hold the English pages to the source: Common's types, rules and
 * models imported (and their rules run on made-up rows), the Dashboard's
 * React-free modules imported and its pages read as text, the server's
 * services, the status page app and the workers read as text (an App test
 * must not import the Dashboard's React components, nor any package but App
 * and Common). A renamed label, a moved default, a changed rule fails here
 * until the English pages follow - and CriteriaGroupsPostmortemsDocs-
 * Translations then carries the change into every language.
 */

function english(page: string): string {
  return readPage("en", page);
}

// The postmortem statuses a new project starts with, as the API returns them.
function defaultStatusRows(): Array<Record<string, unknown>> {
  return DEFAULT_POSTMORTEM_STATUSES.map(
    (
      status: DefaultPostmortemStatus,
      index: number,
    ): Record<string, unknown> => {
      return {
        _id: `status-${index + 1}`,
        name: status.name,
        order: status.order,
        isNotStartedStatus: status.flag === "isNotStartedStatus",
        isDraftStatus: status.flag === "isDraftStatus",
        isCompletedStatus: status.flag === "isCompletedStatus",
      };
    },
  );
}

// A file of any package, as text.
function readPackageFile(relative: string): string {
  return fs.readFileSync(path.join(PACKAGES_DIR, relative), "utf8");
}

// A file of the workers, as text.
function readWorkerSource(relative: string): string {
  return readPackageFile(path.join("App/FeatureSet/Workers/Jobs", relative));
}

const HEADING_LEVEL: RegExp = /^(#+) /;
const BOLD: RegExp = /\*\*([^*\n]+)\*\*/g;

/*
 * The text of the section under `heading` ("## X"), up to the next heading of
 * its level or above. A heading the page lacks fails, naming it.
 */
function section(markdown: string, heading: string): string {
  const start: number = markdown.indexOf(`\n${heading}\n`);

  expect({ heading: heading, found: start >= 0 }).toEqual({
    heading: heading,
    found: true,
  });

  const level: number = (heading.match(HEADING_LEVEL)?.[1] || "#").length;
  const rest: string = markdown.slice(start + heading.length + 2);
  const end: number = rest.search(new RegExp(`\\n#{1,${level}} `));

  return end === -1 ? rest : rest.slice(0, end);
}

// The cells of a markdown table row, trimmed, without the empty outer ones.
function tableCells(row: string): Array<string> {
  return row
    .split("|")
    .slice(1, -1)
    .map((cell: string): string => {
      return cell.trim();
    });
}

// The body rows of the first table in a piece of markdown.
function tableRows(markdown: string): Array<string> {
  const lines: Array<string> = markdown.split("\n");
  const start: number = lines.findIndex((line: string): boolean => {
    return line.startsWith("|");
  });

  if (start < 0) {
    return [];
  }

  const rows: Array<string> = [];

  for (const line of lines.slice(start)) {
    if (!line.startsWith("|")) {
      break;
    }

    rows.push(line);
  }

  return rows.slice(2);
}

// The first cell of each body row of the first table in a piece of markdown.
function firstColumn(markdown: string): Array<string> {
  return tableRows(markdown).map((row: string): string => {
    return tableCells(row)[0] || "";
  });
}

// Every **bold** name in a piece of markdown, in order.
function boldNames(markdown: string): Array<string> {
  return Array.from(markdown.matchAll(BOLD)).map(
    (match: RegExpMatchArray): string => {
      return match[1] as string;
    },
  );
}

// "A, B or C": names as a sentence lists them, without bold.
function listedPlainly(
  names: ReadonlyArray<string>,
  conjunction: string,
): string {
  if (names.length < 2) {
    return names.join("");
  }

  return `${names.slice(0, -1).join(", ")} ${conjunction} ${names[names.length - 1]}`;
}

// The titles of a list of permissions, as a custom role's picker shows them.
function permissionTitles(permissions: Array<Permission>): Array<string> {
  return permissions.map((permission: Permission): string => {
    return PermissionHelper.getTitle(permission);
  });
}

// Whether a permission is a role (Project Owner, Monitor Admin, ...).
function isRole(permission: Permission): boolean {
  return PermissionHelper.getAllPermissionProps().some(
    (props: { permission: Permission; isRolePermission?: boolean }) => {
      return props.permission === permission && Boolean(props.isRolePermission);
    },
  );
}

// The role names among a list of permissions, the custom permissions left out.
function rolesOf(permissions: Array<Permission>): Array<string> {
  return permissionTitles(permissions.filter(isRole));
}

// The custom permissions among a list, by title.
function customPermissionsOf(permissions: Array<Permission>): Array<string> {
  return permissionTitles(
    permissions.filter((permission: Permission): boolean => {
      return !isRole(permission);
    }),
  );
}

/*
 * The text of a source between two markers, the first one included. A
 * marker the source lacks fails, naming it.
 */
function between(source: string, start: string, end: string): string {
  const from: number = source.indexOf(start);

  expect({ marker: start, found: from >= 0 }).toEqual({
    marker: start,
    found: true,
  });

  const to: number = source.indexOf(end, from + start.length);

  expect({ marker: end, found: to >= 0 }).toEqual({ marker: end, found: true });

  return source.slice(from, to);
}

/*
 * Code with its white space and its trailing commas taken out: what a label
 * declaration says whichever way Prettier wraps it.
 */
function compact(code: string): string {
  return code.split(/\s+/).join("").split(",)").join(")");
}

/*
 * Whether `source` declares the label `constant` as the Dashboard key `text`
 * (translationKey), however the line is wrapped.
 */
function expectLabelDeclared(
  source: string,
  constant: string,
  text: string,
): void {
  expect(compact(source)).toContain(
    compact(
      `export const ${constant}: string = translationKey(${JSON.stringify(text)});`,
    ),
  );
}

/*
 * The source of the object a field is declared in on a form, from its title:
 * the text between the `{` that opens it and the `}` that closes it, found by
 * brace depth around `title: "<title>"`.
 */
function fieldObject(source: string, title: string): string {
  const at: number = source.search(
    new RegExp(`title:\\s*"${escapeRegExp(title)}"`),
  );

  expect({ field: title, found: at >= 0 }).toEqual({
    field: title,
    found: true,
  });

  let start: number = at;
  let depth: number = 0;

  while (start > 0) {
    const character: string = source[start] as string;

    if (character === "}") {
      depth++;
    }

    if (character === "{") {
      if (depth === 0) {
        break;
      }

      depth--;
    }

    start--;
  }

  let end: number = at;
  depth = 0;

  while (end < source.length) {
    const character: string = source[end] as string;

    if (character === "{") {
      depth++;
    }

    if (character === "}") {
      if (depth === 0) {
        break;
      }

      depth--;
    }

    end++;
  }

  return source.slice(start, end + 1);
}

/*
 * The decorators of a model's property, from the declaration back to the
 * end of the property before it: what TypeORM is told about that column or
 * relation.
 */
function propertyDecorators(source: string, declaration: string): string {
  const at: number = source.indexOf(declaration);

  expect({ declaration: declaration, found: at >= 0 }).toEqual({
    declaration: declaration,
    found: true,
  });

  const before: string = source.slice(0, at);
  const previous: number = before.lastIndexOf("= undefined;");

  return before.slice(previous + 1);
}

// A status as a project's list holds it, for the list rules.
function statusRow(
  id: string,
  name: string,
  priority: number,
  flags: { isOperationalState?: boolean; isOfflineState?: boolean } = {},
): StateListRow {
  return toStateListRow(STATE_LISTS[StateListType.MonitorStatus], {
    _id: id,
    name: name,
    priority: priority,
    ...flags,
  });
}

// A MonitorStatus row with a place, for the worst-status rules.
function monitorStatus(name: string, priority: number): MonitorStatus {
  const status: MonitorStatus = new MonitorStatus();
  status.name = name;
  status.priority = priority;

  return status;
}

const ONLINE_STATUS_ID: ObjectID = ObjectID.generate();
const OFFLINE_STATUS_ID: ObjectID = ObjectID.generate();
const INCIDENT_SEVERITY_ID: ObjectID = ObjectID.generate();
const ALERT_SEVERITY_ID: ObjectID = ObjectID.generate();

// What a new monitor of a type starts with, as the dashboard seeds it.
function defaultCriteria(
  monitorType: MonitorType,
): Array<MonitorCriteriaInstance> {
  return (
    MonitorCriteria.getDefaultMonitorCriteria({
      monitorType: monitorType,
      monitorName: "Acme",
      onlineMonitorStatusId: ONLINE_STATUS_ID,
      offlineMonitorStatusId: OFFLINE_STATUS_ID,
      defaultIncidentSeverityId: INCIDENT_SEVERITY_ID,
      defaultAlertSeverityId: ALERT_SEVERITY_ID,
    }).data?.monitorCriteriaInstanceArray || []
  );
}

// ---- Sources -------------------------------------------------------------------

const EVALUATOR: string = readCommonSource(
  "Server/Utils/Monitor/MonitorCriteriaEvaluator.ts",
);
const MONITOR_RESOURCE: string = readCommonSource(
  "Server/Utils/Monitor/MonitorResource.ts",
);
const MONITOR_INCIDENT: string = readCommonSource(
  "Server/Utils/Monitor/MonitorIncident.ts",
);
const MONITOR_ALERT: string = readCommonSource(
  "Server/Utils/Monitor/MonitorAlert.ts",
);
const CRITERIA_INSTANCE_FORM: string = readDashboardSource(
  "Components/Form/Monitor/MonitorCriteriaInstance.tsx",
);
const CRITERIA_LIST_FORM: string = readDashboardSource(
  "Components/Form/Monitor/MonitorCriteria.tsx",
);
const CRITERIA_FILTER_FORM: string = readDashboardSource(
  "Components/Form/Monitor/CriteriaFilter.tsx",
);
const CRITERIA_INCIDENT_FORM: string = readDashboardSource(
  "Components/Form/Monitor/MonitorCriteriaIncidentForm.tsx",
);
const CRITERIA_ALERT_FORM: string = readDashboardSource(
  "Components/Form/Monitor/MonitorCriteriaAlertForm.tsx",
);
const MONITOR_STEPS_FORM: string = readDashboardSource(
  "Components/Form/Monitor/MonitorSteps.tsx",
);
const MONITOR_TEST_FORM: string = readDashboardSource(
  "Components/Form/Monitor/MonitorTest.tsx",
);
const CRITERIA_PAGE: string = readDashboardSource(
  "Pages/Monitor/View/Criteria.tsx",
);
const DEPENDENCIES_PAGE: string = readDashboardSource(
  "Pages/Monitor/View/Dependencies.tsx",
);
const STATUS_TIMELINE_PAGE: string = readDashboardSource(
  "Pages/Monitor/View/StatusTimeline.tsx",
);
const MONITOR_STATUSES_PAGE: string = readDashboardSource(
  "Pages/Monitor/Settings/MonitorStatus.tsx",
);
const STATE_SETTINGS_TABLE: string = readDashboardSource(
  "Components/StateSettings/StateSettingsTable.tsx",
);
const MONITOR_MENU: string = readDashboardSource(
  "Pages/Monitor/View/SideMenu.tsx",
);
const MONITORS_MENU_FILE: string = readDashboardSource(
  "Pages/Monitor/SideMenu.tsx",
);
const MONITORS_MENU_SOURCE: string = MONITORS_MENU_FILE.slice(
  MONITORS_MENU_FILE.indexOf("const sections: SideMenuSectionProps[]"),
);
const SETTINGS_MENU: string = readDashboardSource(
  "Pages/Settings/SideMenu.tsx",
);
const INCIDENTS_MENU: string = readDashboardSource(
  "Pages/Incidents/SideMenu.tsx",
);
const INCIDENT_MENU: string = readDashboardSource(
  "Pages/Incidents/View/SideMenu.tsx",
);
const EPISODE_MENU: string = readDashboardSource(
  "Pages/Incidents/EpisodeView/SideMenu.tsx",
);
const SUMMARY_CARD: string = readDashboardSource(
  "Components/Monitor/SummaryView/Summary.tsx",
);
const GROUPS_PAGE: string = readDashboardSource(
  "Pages/MonitorGroup/MonitorGroups.tsx",
);
const GROUP_OVERVIEW_PAGE: string = readDashboardSource(
  "Pages/MonitorGroup/View/Index.tsx",
);
const GROUP_MONITORS_PAGE: string = readDashboardSource(
  "Pages/MonitorGroup/View/Monitors.tsx",
);
// The list's Current Status, and the line it and the Overview draw for an empty group.
const GROUP_CURRENT_STATUS: string = readDashboardSource(
  "Components/MonitorGroup/CurrentStatus.tsx",
);
const NO_MONITORS_STATUS: string = readDashboardSource(
  "Components/MonitorGroup/NoMonitorsStatus.tsx",
);
const GROUP_MENU: string = readDashboardSource(
  "Pages/MonitorGroup/View/SideMenu.tsx",
);
const STATUS_PAGE_MENU: string = readDashboardSource(
  "Pages/StatusPages/View/SideMenu.tsx",
);
const STATUS_PAGE_RESOURCES_PAGE: string = readDashboardSource(
  "Pages/StatusPages/View/Resources.tsx",
);
const STATUS_PAGE_RESOURCE_FIELDS: string = readDashboardSource(
  "Components/StatusPage/StatusPageResourceFormFields.ts",
);
const STATUS_PAGE_RESOURCE_PANEL: string = readDashboardSource(
  "Components/StatusPage/StatusPageResourcePanel.tsx",
);
const POSTMORTEM_PAGE: string = readDashboardSource(
  "Pages/Incidents/View/Postmortem.tsx",
);
const EPISODE_POSTMORTEM_PAGE: string = readDashboardSource(
  "Pages/Incidents/EpisodeView/Postmortem.tsx",
);
const POSTMORTEM_FORM: string = readDashboardSource(
  "Components/Postmortem/IncidentPostmortemForm.ts",
);
const POSTMORTEM_CARD_BUTTONS: string = readDashboardSource(
  "Components/Postmortem/PostmortemCardButtons.ts",
);
const POSTMORTEM_TEMPLATE_MODAL: string = readDashboardSource(
  "Components/Postmortem/ApplyPostmortemTemplateModal.tsx",
);
const POSTMORTEM_TEMPLATES_MODULE: string = readDashboardSource(
  "Components/Postmortem/PostmortemTemplates.ts",
);
const POSTMORTEM_EMPTY_STATE: string = readDashboardSource(
  "Components/Postmortem/PostmortemEmptyState.tsx",
);
const POSTMORTEM_MORE_MENU: string = readDashboardSource(
  "Components/Postmortem/PostmortemMoreMenu.tsx",
);
const POSTMORTEM_SUMMARY: string = readDashboardSource(
  "Components/Postmortem/PostmortemSummary.tsx",
);
const POSTMORTEM_STATUS_PICKER: string = readDashboardSource(
  "Components/Postmortem/PostmortemStatusPicker.tsx",
);
const POSTMORTEMS_TABLE: string = readDashboardSource(
  "Components/Postmortem/PostmortemsTable.tsx",
);
const POSTMORTEM_LIST_FACETS_SOURCE: string = readDashboardSource(
  "Components/Postmortem/PostmortemListFacets.ts",
);
const POSTMORTEM_STATUS_TILES: string = readDashboardSource(
  "Components/Postmortem/PostmortemStatusTiles.ts",
);
const BULK_POSTMORTEM_STATUS: string = readDashboardSource(
  "Components/Postmortem/BulkPostmortemStatusAction.tsx",
);
const RESOURCE_OWNERS_HOOK: string = readDashboardSource(
  "Components/ResourceOwners/useResourceOwners.tsx",
);
const ARCHIVABLE_VALUE_COPY_SOURCE: string = readDashboardSource(
  "Components/ArchivableValue/ArchivableValueCopy.ts",
);
const GENERATE_FROM_AI_MODAL: string = readCommonSource(
  "UI/Components/AI/GenerateFromAIModal.tsx",
);
const INCIDENT_API: string = readCommonSource("Server/API/IncidentAPI.ts");
const EPISODE_API: string = readCommonSource(
  "Server/API/IncidentEpisodeAPI.ts",
);
const INCIDENT_AI_CONTEXT: string = readCommonSource(
  "Server/Utils/AI/IncidentAIContextBuilder.ts",
);
const EPISODE_AI_CONTEXT: string = readCommonSource(
  "Server/Utils/AI/IncidentEpisodeAIContextBuilder.ts",
);
const POSTMORTEM_RUNNER: string = readCommonSource(
  "Server/Utils/AI/SRE/IncidentPostmortemRunner.ts",
);
const POSTMORTEM_RULES_PLAN: string = readCommonSource(
  "Server/Utils/AI/SRE/PostmortemRules.ts",
);
const POSTMORTEM_TEMPLATE_PICK: string = readCommonSource(
  "Server/Utils/AI/SRE/PostmortemTemplatePick.ts",
);
const INCIDENT_AI_SETTINGS_PAGE: string = readDashboardSource(
  "Pages/Incidents/Settings/IncidentAISettings.tsx",
);
const INCIDENT_SERVICE: string = readCommonSource(
  "Server/Services/IncidentService.ts",
);
const INCIDENT_STATE_TIMELINE_SERVICE: string = readCommonSource(
  "Server/Services/IncidentStateTimelineService.ts",
);
const EPISODE_STATE_TIMELINE_SERVICE: string = readCommonSource(
  "Server/Services/IncidentEpisodeStateTimelineService.ts",
);
const PROJECT_SERVICE: string = readCommonSource(
  "Server/Services/ProjectService.ts",
);
const MONITOR_SERVICE: string = readCommonSource(
  "Server/Services/MonitorService.ts",
);
const MONITOR_STATUS_SERVICE: string = readCommonSource(
  "Server/Services/MonitorStatusService.ts",
);
const MONITOR_PROBE_SERVICE: string = readCommonSource(
  "Server/Services/MonitorProbeService.ts",
);
const MONITOR_GROUP_SERVICE: string = readCommonSource(
  "Server/Services/MonitorGroupService.ts",
);
const MONITOR_GROUP_RESOURCE_SERVICE: string = readCommonSource(
  "Server/Services/MonitorGroupResourceService.ts",
);
const STATUS_PAGE_SERVICE: string = readCommonSource(
  "Server/Services/StatusPageService.ts",
);
const STATUS_PAGE_RESOURCE_SERVICE: string = readCommonSource(
  "Server/Services/StatusPageResourceService.ts",
);
const NOTIFICATION_SETTING_SERVICE: string = readCommonSource(
  "Server/Services/UserNotificationSettingService.ts",
);
const STATUS_TIMELINE_UTIL: string = readCommonSource(
  "Server/Utils/Monitor/MonitorStatusTimeline.ts",
);
const STATUS_PAGE_RESOURCE_MODEL: string = readCommonSource(
  "Models/DatabaseModels/StatusPageResource.ts",
);
const MONITOR_GROUP_RESOURCE_MODEL: string = readCommonSource(
  "Models/DatabaseModels/MonitorGroupResource.ts",
);
const STATUS_PAGE_INCIDENT_PAGE: string = readPackageFile(
  "App/FeatureSet/StatusPage/src/Pages/Incidents/Detail.tsx",
);
const NOTIFICATION_SETTINGS_PAGE: string = readDashboardSource(
  "Pages/UserSettings/NotificationSettings.tsx",
);
const POSTMORTEM_NOTIFICATION_JOB: string = readWorkerSource(
  "Incident/SendPostmortemNotificationToSubscribers.ts",
);
const STATUS_CHANGE_NOTIFICATION_JOB: string = readWorkerSource(
  "MonitorOwners/SendStatusChangeNotification.ts",
);

// ---- Monitor Criteria & Statuses: how criteria decide --------------------------------

describe("how criteria decide", () => {
  const criteriaPage: string = english(CRITERIA_AND_STATUSES);
  const loop: string = between(
    EVALUATOR,
    "for (const criteriaInstance of criteria.data.monitorCriteriaInstanceArray) {",
    "if (fanOutAcrossCriteria) {",
  );

  it("judges the criteria from the top of the list down, and none after the first match", () => {
    expect(loop).toContain(
      "if (matchedCriteria.length > 0 && !fanOutAcrossCriteria) {",
    );
    expect(loop).toContain(
      "MonitorCriteriaEvaluator.pushNotEvaluatedCriteriaResult({",
    );
    expect(criteriaPage).toContain(
      "Each time a monitor is checked, its criteria judge the result from the top of the list down. The first criteria whose filters match decides what happens, and the criteria below it are not looked at for that check.",
    );
    expect(criteriaPage).toContain(
      "- [How criteria decide](#how-criteria-decide): Top to bottom, and the first match wins.",
    );
  });

  it("lets a criteria that matches decide the check whether or not it changes the status", () => {
    // A match is a match: nothing in the loop asks whether it changes the status.
    expect(loop).not.toContain("changeMonitorStatus");
    expect(loop).toContain("matchedCriteria.push({");

    // The warning a certificate monitor starts with changes no status, above the online one.
    const certificate: Array<MonitorCriteriaInstance> = defaultCriteria(
      MonitorType.SSLCertificate,
    );

    expect(certificate[1]?.data?.changeMonitorStatus).toBe(false);
    expect(certificate[1]?.data?.createAlerts).toBe(true);
    expect(criteriaPage).toContain(
      "A criteria that matches but changes no status still decides the check: the monitor keeps the status it has, and the criteria below it wait for the next check.",
    );
  });

  it("moves the monitor to its Default Monitor Status when no criteria matches, telling no owner", () => {
    expect(MONITOR_RESOURCE).toContain(
      "No criteria met. Change to default status.",
    );
    expect(MONITOR_RESOURCE).toContain(
      "monitorStatusTimeline.monitorStatusId =\n            monitorSteps.data.defaultMonitorStatusId!;",
    );
    expect(MONITOR_RESOURCE).toContain(
      "monitorStatusTimeline.isOwnerNotified = true; // no need to notify owner as this is default status.",
    );
    // The owners' job sends only rows nobody has been told about.
    expect(STATUS_CHANGE_NOTIFICATION_JOB).toContain("isOwnerNotified: false,");
    expect(MONITOR_STEPS_FORM).toContain('title="Default Monitor Status"');
    expect(criteriaPage).toContain(
      "When none matches, the monitor goes to its **Default Monitor Status**.",
    );
    expect(criteriaPage).toContain(
      "The **Default Monitor Status** applies only when no criteria matches.",
    );
    expect(criteriaPage).toContain(
      "A monitor that goes back to its **Default Monitor Status** because no criteria matched notifies nobody.",
    );
  });

  it("starts a new monitor's criteria worst first: offline, a warning where the type has one, then online", () => {
    const ping: Array<MonitorCriteriaInstance> = defaultCriteria(
      MonitorType.Ping,
    );

    expect(
      ping.map((criteria: MonitorCriteriaInstance): string | undefined => {
        return criteria.data?.monitorStatusId?.toString();
      }),
    ).toEqual([OFFLINE_STATUS_ID.toString(), ONLINE_STATUS_ID.toString()]);

    for (const monitorType of [
      MonitorType.SSLCertificate,
      MonitorType.Domain,
    ]) {
      const criteria: Array<MonitorCriteriaInstance> =
        defaultCriteria(monitorType);

      expect({ monitorType, count: criteria.length }).toEqual({
        monitorType,
        count: 3,
      });
      expect(criteria[0]?.data?.monitorStatusId?.toString()).toBe(
        OFFLINE_STATUS_ID.toString(),
      );
      expect(criteria[1]?.data?.monitorStatusId).toBeUndefined();
      expect(criteria[2]?.data?.monitorStatusId?.toString()).toBe(
        ONLINE_STATUS_ID.toString(),
      );
    }

    expect(
      MonitorCriteriaInstance.getDefaultWarningMonitorCriteriaInstance({
        monitorType: MonitorType.Website,
        alertSeverityId: ALERT_SEVERITY_ID,
        monitorName: "Acme",
      }),
    ).toBeNull();
    expect(criteriaPage).toContain(
      "A new monitor lists its criteria worst first: offline, then a warning where its type has one (a certificate or a domain that expires soon), then online.",
    );
  });

  it("seeds a probe monitor's healthy criteria with Is Online set to True, last", () => {
    const ping: Array<MonitorCriteriaInstance> = defaultCriteria(
      MonitorType.Ping,
    );
    const online: CriteriaFilter | undefined =
      ping[ping.length - 1]?.data?.filters[0];

    expect(online?.checkOn).toBe(CheckOn.IsOnline);
    expect(online?.filterType).toBe(FilterType.True);
    expect(CheckOn.IsOnline).toBe("Is Online");
    expect(FilterType.True).toBe("True");
    expect(criteriaPage).toContain(
      `A broad healthy criteria, such as **${CheckOn.IsOnline}** set to **${FilterType.True}**, matches almost every check, so it goes last: above the others, it would match first every time and they would never act.`,
    );
  });

  it("gives a new monitor the operational status as its default, under More fields below the criteria", () => {
    const steps: MonitorSteps = MonitorSteps.getDefaultMonitorSteps({
      defaultMonitorStatusId: ONLINE_STATUS_ID,
      monitorType: MonitorType.Website,
      monitorName: "Acme",
      onlineMonitorStatusId: ONLINE_STATUS_ID,
      offlineMonitorStatusId: OFFLINE_STATUS_ID,
      defaultIncidentSeverityId: INCIDENT_SEVERITY_ID,
      defaultAlertSeverityId: ALERT_SEVERITY_ID,
    });

    expect(steps.data?.defaultMonitorStatusId?.toString()).toBe(
      ONLINE_STATUS_ID.toString(),
    );
    // The dashboard seeds the steps with the project's operational status.
    expect(MONITOR_STEPS_FORM).toContain(
      "defaultMonitorStatusId: operationalMonitorStatusId!,",
    );
    expect(MORE_FIELDS_SECTION_TITLE).toBe("More fields");
    expect(
      between(
        MONITOR_STEPS_FORM,
        "title={MORE_FIELDS_SECTION_TITLE}",
        "</FoldedSection>",
      ),
    ).toContain('title="Default Monitor Status"');
    expect(criteriaPage).toContain(
      `A new monitor's default is **${SEEDED_MONITOR_STATUSES[0]?.name}**; change it under **${MORE_FIELDS_SECTION_TITLE}**, below the criteria.`,
    );
  });

  it("judges every criteria on a monitor that raises one per host, but not on an Incoming Request monitor", () => {
    expect(EVALUATOR).toContain(
      "const fanOutAcrossCriteria: boolean =\n      isPerSeriesMonitor &&\n      input.monitor.monitorType !== MonitorType.IncomingRequest;",
    );

    const perSeries: string = between(
      EVALUATOR,
      "private static isPerSeriesMonitor(input: {",
      "\n  }\n",
    );

    expect(perSeries).toContain(
      "MonitorStep.getGroupByAttributeKeys(input.monitorStep).length > 0",
    );
    expect(perSeries).toContain(
      "MonitorStepLogMonitorUtil.getGroupByAttributes(",
    );
    // A "*" disk, port or table row - each criteria's own opt-in.
    expect(perSeries).toContain("PerEntityCriteriaFanOut.isFanOutConfigured({");

    const fanOutOptIn: string = between(
      readCommonSource("Server/Utils/Monitor/PerEntityCriteriaFanOut.ts"),
      "public static isFanOutConfigured(input: {",
      "\n  }\n",
    );

    for (const optIn of [
      "isServerDiskFanOutConfigured(",
      "isSnmpInterfaceFanOutConfigured(",
      "isSnmpTableFanOutConfigured(",
    ]) {
      expect(fanOutOptIn).toContain(optIn);
    }

    expect(criteriaPage).toContain(
      "> A monitor that raises one incident or alert per host, container, disk or interface judges every criteria on each check, so two hosts can match two different criteria at once.",
    );
    expect(criteriaPage).toContain(
      "That is a monitor whose query has a **Group By**, such as a Metrics or Logs monitor, or a criteria that names `*` for every disk or interface. An Incoming Request monitor that groups incidents by a payload field still stops at the first match.",
    );
  });
});

// ---- What a criteria holds ----------------------------------------------------------

describe("what a criteria holds", () => {
  const criteriaPage: string = english(CRITERIA_AND_STATUSES);
  const parts: string = section(criteriaPage, "## What a criteria holds");

  it("is a name and three sections, each folding to a one-line summary, as the parts table lists them", () => {
    expect(CRITERIA_INSTANCE_FORM).toContain('title={"Criteria Name"}');
    expect(CRITERIA_INSTANCE_FORM).toContain(
      '? "Alert Rules"\n            : "Filters"',
    );
    expect(CRITERIA_INSTANCE_FORM).toContain('title="Actions"');
    expect(CRITERIA_INSTANCE_FORM).toContain('title="Settings"');
    // Each section shows a summary in its header, so it reads folded.
    expect(CRITERIA_INSTANCE_FORM.split("<CollapsibleSection").length - 1).toBe(
      3,
    );
    expect(CRITERIA_INSTANCE_FORM.split("badge={").length - 1).toBe(3);
    expect(firstColumn(parts)).toEqual([
      "**Criteria Name**",
      "**Filters**",
      "**Actions**",
      "**Settings**",
    ]);
    expect(parts).toContain(
      "Open a criteria and it has a name and three sections, each of which folds to a one-line summary.",
    );
  });

  it("names the incidents and alerts a criteria opens in their root cause", () => {
    expect(EVALUATOR).toContain(
      "**Criteria Name**: ${criteriaInstance.data?.name}",
    );
    expect(parts).toContain(
      "| **Criteria Name** | The name in the criteria list, and in the root cause of every incident and alert the criteria opens.",
    );
  });

  it("names a new criteria after its filters, and the name follows them until you type one of your own", () => {
    const criteria: MonitorCriteriaInstance = new MonitorCriteriaInstance();
    const filters: Array<CriteriaFilter> = [
      {
        checkOn: CheckOn.ResponseTime,
        filterType: FilterType.GreaterThan,
        value: 3000,
      },
    ];

    criteria.setFilters(filters);
    criteria.setName(CriteriaNameUtil.getNameForCriteria(criteria));

    const generated: string = criteria.data?.name || "";

    expect(generated).toContain(CheckOn.ResponseTime);
    expect(
      CriteriaNameUtil.isNameFromFilters({
        name: generated,
        filters: criteria.data?.filters,
        filterCondition: criteria.data?.filterCondition,
      }),
    ).toBe(true);

    const nextFilters: Array<CriteriaFilter> = [
      { ...(filters[0] as CriteriaFilter), value: 5000 },
    ];
    const followed: string = CriteriaNameUtil.getNameAfterFiltersChange({
      name: generated,
      previous: { filters: filters, filterCondition: FilterCondition.All },
      next: { filters: nextFilters, filterCondition: FilterCondition.All },
    });

    expect(followed).not.toBe(generated);
    expect(followed).toContain("5000");
    expect(
      CriteriaNameUtil.getNameAfterFiltersChange({
        name: "Checkout is slow",
        previous: { filters: filters, filterCondition: FilterCondition.All },
        next: { filters: nextFilters, filterCondition: FilterCondition.All },
      }),
    ).toBe("Checkout is slow");
    // Add Criteria names the criteria it adds.
    expect(CRITERIA_LIST_FORM).toContain(
      "newMonitorCriteria.setName(\n                CriteriaNameUtil.getNameForCriteria(newMonitorCriteria),",
    );
    expect(parts).toContain(
      "**Add Criteria** names a new criteria after its filters, and the name follows them until you type one of your own.",
    );
  });

  it("calls the filters Alert Rules on Kubernetes and Metrics monitors only", () => {
    expect(CRITERIA_INSTANCE_FORM).toContain(
      'props.monitorType === MonitorType.Kubernetes ||\n          props.monitorType === MonitorType.Metrics\n            ? "Alert Rules"',
    );
    expect(parts).toContain(
      "| **Filters** | What the check must show, as one or more filters. Kubernetes and Metrics monitors call them **Alert Rules**. |",
    );
  });

  it("keeps the switch, the description and, on Incoming Request monitors only, grouping under Settings", () => {
    const settings: string = between(
      CRITERIA_INSTANCE_FORM,
      'title="Settings"',
      'title="Delete Criteria"',
    );

    expect(settings).toContain('title="Enable this criteria"');
    expect(settings).toContain('title={"Description"}');
    expect(settings).toContain(
      'props.monitorType === MonitorType.IncomingRequest && (\n            <div className="mt-6 border-t border-gray-100 pt-4">\n              <Toggle\n                value={showIncidentGrouping}\n                title="Group incidents and alerts by a payload field"',
    );
    expect(parts).toContain(
      "| **Settings** | **Enable this criteria**, an optional **Description** and, on Incoming Request monitors, **Group incidents and alerts by a payload field**. |",
    );
  });
});

describe("a criteria's filters", () => {
  const criteriaPage: string = english(CRITERIA_AND_STATUSES);
  const filters: string = section(criteriaPage, "### Filters");

  it("read one thing from the check and compare it: Filter Type, Filter Condition and Value", () => {
    expect(CRITERIA_FILTER_FORM).toContain(
      '<FieldLabelElement title="Filter Type" />',
    );
    expect(CRITERIA_FILTER_FORM).toContain(
      'title={isMetricOnly ? "Condition" : "Filter Condition"}',
    );
    expect(CRITERIA_FILTER_FORM).toContain(
      'title={isMetricOnly ? "Threshold" : "Value"}',
    );
    expect(CheckOn.ResponseStatusCode).toBe("Response Status Code");
    expect(FilterType.GreaterThan).toBe("Greater Than");
    expect(filters).toContain(
      `A filter reads one thing from the check and compares it: a **Filter Type** (what to read, such as **${CheckOn.ResponseStatusCode}**), a **Filter Condition** (how to compare, such as **${FilterType.GreaterThan}**) and a **Value**.`,
    );
  });

  it("ask for a Condition and a Threshold on the monitors that compare metrics", () => {
    for (const monitorType of [MonitorType.Kubernetes, MonitorType.Metrics]) {
      expect({
        monitorType,
        metricOnly: CriteriaFilterUiUtil.isMetricOnlyMonitorType(monitorType),
      }).toEqual({ monitorType, metricOnly: true });
    }

    expect(
      CriteriaFilterUiUtil.isMetricOnlyMonitorType(MonitorType.Website),
    ).toBe(false);
    expect(filters).toContain(
      "Monitors that compare metrics, such as Kubernetes and Metrics monitors, ask for a **Condition** and a **Threshold** instead.",
    );
  });

  it("show Match Condition from two filters on, All or Any, and a new criteria starts on All", () => {
    const one: Array<CriteriaFilter> = [
      {
        checkOn: CheckOn.IsOnline,
        filterType: FilterType.True,
        value: undefined,
      },
    ];

    expect(isFilterConditionNeeded(one)).toBe(false);
    expect(isFilterConditionNeeded([...one, ...one])).toBe(true);
    expect(CRITERIA_INSTANCE_FORM).toContain(
      "{isFilterConditionNeeded(monitorCriteriaInstance?.data?.filters) && (",
    );
    expect(CRITERIA_INSTANCE_FORM).toContain('title="Match Condition"');
    expect(new MonitorCriteriaInstance().data?.filterCondition).toBe(
      FilterCondition.All,
    );
    expect(filters).toContain(
      `With two filters or more, **Match Condition** appears below them: **${FilterCondition.All}** means every filter must match, **${FilterCondition.Any}** means one is enough. A new criteria starts on **${FilterCondition.All}**.`,
    );
  });

  it("offer a window on the checks every check measures, starting on the last 5 minutes with All Values", () => {
    for (const checkOn of [
      CheckOn.IsOnline,
      CheckOn.ResponseStatusCode,
      CheckOn.ResponseTime,
    ]) {
      expect({
        checkOn,
        offered: CriteriaFilterUtil.isEvaluateOverTimeFilter(
          checkOn,
          MonitorType.Website,
        ),
      }).toEqual({ checkOn, offered: true });
    }

    const ticked: CriteriaFilter = CriteriaFilterUiUtil.setEvaluateOverTime({
      criteriaFilter: {
        checkOn: CheckOn.ResponseTime,
        filterType: FilterType.GreaterThan,
        value: 3000,
      },
      evaluateOverTime: true,
    });

    expect(ticked.evaluateOverTimeOptions?.timeValueInMinutes).toBe(5);
    expect(ticked.evaluateOverTimeOptions?.evaluateOverTimeType).toBe(
      EvaluateOverTimeType.AllValues,
    );
    expect(EvaluateOverTimeType.AllValues).toBe("All Values");
    expect(CRITERIA_FILTER_FORM).toContain(
      'title={"Evaluate this criteria over a period of time"}',
    );
    expect(filters).toContain(
      `Filters that measure every check, such as **${CheckOn.IsOnline}**, **${CheckOn.ResponseStatusCode}** and **${CheckOn.ResponseTime}**, offer **Evaluate this criteria over a period of time**.`,
    );
    expect(filters).toContain(
      `It judges a window of recent checks instead of the latest one, and starts on the last ${ticked.evaluateOverTimeOptions?.timeValueInMinutes} minutes with **${EvaluateOverTimeType.AllValues}**, which matches only once every check in the window did.`,
    );
  });
});

describe("a criteria's actions", () => {
  const criteriaPage: string = english(CRITERIA_AND_STATUSES);
  const actions: string = section(criteriaPage, "### Actions");

  it("are three switches, each naming what it sets up, in the order the form draws them", () => {
    const switches: Array<string> = [
      "When filters match, change monitor status.",
      "When filters match, create an alert.",
      "When filters match, declare an incident.",
    ];
    const positions: Array<number> = switches.map((title: string): number => {
      return CRITERIA_INSTANCE_FORM.indexOf(`title="${title}"`);
    });

    expect(
      positions.every((at: number): boolean => {
        return at > 0;
      }),
    ).toBe(true);
    expect(
      [...positions].sort((a: number, b: number): number => {
        return a - b;
      }),
    ).toEqual(positions);
    expect(firstColumn(actions)).toEqual(
      switches.map((title: string): string => {
        return `**${title}**`;
      }),
    );

    for (const label of [
      'title="Change monitor status to"',
      '<FieldLabelElement title="Create Alert" />',
      '<FieldLabelElement title="Create Incident" />',
    ]) {
      expect(CRITERIA_INSTANCE_FORM).toContain(label);
    }

    expect(actions).toContain(
      "| **When filters match, change monitor status.** | Moves the monitor to the status picked in **Change monitor status to**. |",
    );
  });

  it("tell the team with an alert and show an incident on status pages", () => {
    expect(CRITERIA_INSTANCE_FORM).toContain(
      'tooltip="When you create an alert, it is used to notify the team but is not shown on the status page."',
    );
    expect(CRITERIA_INSTANCE_FORM).toContain(
      'tooltip="When you declare an incident, it is used to notify the team and is shown on the status page as well."',
    );
    expect(actions).toContain(
      "| **When filters match, create an alert.** | Creates the alerts set up under **Create Alert**. An alert tells your team and never shows on a status page. |",
    );
    expect(actions).toContain(
      "| **When filters match, declare an incident.** | Declares the incidents set up under **Create Incident**. Your status pages can show them. |",
    );
  });

  it("ask an incident for a title and a Severity, with the rest folded away, and page through On-Call", () => {
    for (const label of [
      'title="Incident Title"',
      '<FieldLabelElement title="Severity" required={true} />',
      'title="Description"',
      'title="On-Call"',
      'title="On-Call Policies"',
      'title="Ownership & Labels"',
      'title="Owners"',
      'title="Labels"',
    ]) {
      expect({ label, drawn: CRITERIA_INCIDENT_FORM.includes(label) }).toEqual({
        label,
        drawn: true,
      });
    }

    expect(actions).toContain(
      "An incident or an alert asks for a title, a **Severity** and, folded away, a description, owners, labels and on-call policies.",
    );
    expect(actions).toContain(
      "To page someone when the criteria matches, pick a policy under **On-Call**: see [On-Call Policies](/docs/on-call/policies).",
    );
  });
});

describe("a criteria's settings", () => {
  const criteriaPage: string = english(CRITERIA_AND_STATUSES);
  const settings: string = section(criteriaPage, "### Settings");

  it("start every new criteria enabled; a disabled one is skipped and says so in its header", () => {
    expect(new MonitorCriteriaInstance().data?.isEnabled).toBe(true);
    expect(EVALUATOR).toContain(
      "if (criteriaInstance.data?.isEnabled === false) {",
    );
    expect(EVALUATOR).toContain(
      '"This criterion is disabled, so it was not evaluated."',
    );
    expect(CRITERIA_INSTANCE_FORM).toContain(
      'description="When disabled, this criteria will not be evaluated. It will not change the monitor status, create incidents, or trigger alerts."',
    );
    expect(
      between(CRITERIA_LIST_FORM, "{isCriteriaDisabled && (", ")}"),
    ).toContain('"Disabled"');
    expect(settings).toContain(
      "**Enable this criteria** is on for every new criteria. Turn it off to keep a criteria without using it: it is skipped on every check, changes no status, opens nothing, and its header shows **Disabled**.",
    );
  });

  it("open one incident per value found in an incoming request when grouping is on", () => {
    expect(CRITERIA_INSTANCE_FORM).toContain(
      "Open a separate incident and alert for each value of a field in the request body, so one webhook can keep several open.",
    );
    expect(settings).toContain(
      "**Group incidents and alerts by a payload field** opens one incident per value found in an incoming request, so one webhook address can keep several incidents open.",
    );
  });
});

// ---- When incidents and alerts open and close -----------------------------------------

describe("when a criteria's incidents and alerts open and close", () => {
  const criteriaPage: string = english(CRITERIA_AND_STATUSES);
  const lifecycle: string = section(
    criteriaPage,
    "## When incidents and alerts open and close",
  );

  it("opens one at a time per criteria, per host or value when grouped", () => {
    expect(MONITOR_INCIDENT).toContain(
      "(incident.createdCriteriaId || undefined) ===\n                  (input.criteriaInstance.data?.id?.toString() || undefined) &&",
    );
    expect(MONITOR_INCIDENT).toContain(
      "(incident.seriesFingerprint || undefined) === seriesFingerprint",
    );
    expect(MONITOR_INCIDENT).toContain(
      '"Skipped creating a new incident because an active incident exists for this criteria."',
    );
    expect(MONITOR_ALERT).toContain(
      "(alert.createdCriteriaId || undefined) ===",
    );
    expect(MONITOR_ALERT).toContain(
      '"Skipped creating a new alert because an active alert exists for this criteria."',
    );
    expect(lifecycle).toContain(
      "- **One at a time.** While an incident a criteria declared is still open, the same criteria matching again declares no other. Alerts work the same way. A monitor that groups by host or by payload field keeps one open per host or value",
    );
  });

  it("opens one per email on an Incoming Email criteria that says so", () => {
    const everyEmail: MonitorCriteriaInstance = new MonitorCriteriaInstance();

    everyEmail.data!.openForEveryEmail = true;

    expect(
      MonitorCriteriaInstance.isOpenForEveryEmail({
        monitorType: MonitorType.IncomingEmail,
        criteriaInstance: everyEmail,
      }),
    ).toBe(true);
    expect(
      MonitorCriteriaInstance.isOpenForEveryEmail({
        monitorType: MonitorType.IncomingRequest,
        criteriaInstance: everyEmail,
      }),
    ).toBe(false);
    expect(CRITERIA_INSTANCE_FORM).toContain(
      '? "Open a new incident for every email"',
    );
    expect(lifecycle).toContain(
      "and an Incoming Email criteria with **Open a new incident for every email** opens one per email.",
    );
  });

  it("resolves on a later check that another criteria, or none, decides, where the criteria auto-resolves", () => {
    const close: string = between(
      MONITOR_INCIDENT,
      "private static shouldCloseIncident(input: {",
      "\n  }\n}",
    );

    expect(close).toContain(
      "input.openIncident.createdCriteriaId?.toString() ===\n      input.criteriaInstance?.data?.id?.toString()",
    );
    expect(close).toContain("// same incident active. So, do not close.");
    expect(close).toContain(
      "return MonitorIncident.isAutoResolveConfiguredForIncident({",
    );
    expect(MonitorMoreFieldsTitles.autoResolveIncident).toBe(
      "Auto Resolve Incident",
    );
    expect(MonitorMoreFieldsTitles.autoResolveAlert).toBe("Auto Resolve Alert");
    expect(
      between(
        CRITERIA_INCIDENT_FORM,
        "title={MORE_FIELDS_SECTION_TITLE}",
        "</FoldedSection>",
      ),
    ).toContain('title="Auto Resolve Incident"');
    expect(CRITERIA_ALERT_FORM).toContain("title={MORE_FIELDS_SECTION_TITLE}");
    expect(lifecycle).toContain(
      `- **Closing.** On a later check where another criteria matches, or none, an incident whose criteria has **${MonitorMoreFieldsTitles.autoResolveIncident}** on is resolved, and so is an alert with **${MonitorMoreFieldsTitles.autoResolveAlert}**. Both sit under **${MORE_FIELDS_SECTION_TITLE}** in the incident or alert`,
    );
  });

  it("gives the criteria a new monitor starts with auto-resolving incidents and alerts", () => {
    const offline: MonitorCriteriaInstance | undefined = defaultCriteria(
      MonitorType.Ping,
    )[0];

    expect(offline?.data?.incidents.length).toBeGreaterThan(0);
    expect(offline?.data?.alerts.length).toBeGreaterThan(0);

    for (const incident of offline?.data?.incidents || []) {
      expect(incident.autoResolveIncident).toBe(true);
    }

    for (const alert of offline?.data?.alerts || []) {
      expect(alert.autoResolveAlert).toBe(true);
    }

    expect(lifecycle).toContain(
      "and the criteria a new monitor starts with have them on.",
    );
  });

  it("leaves an incident whose criteria was deleted for someone to resolve", () => {
    // The auto-resolve rules are read from the criteria the monitor has now.
    expect(MONITOR_RESOURCE).toContain(
      'for (const criteriaInstance of criteriaInstances) {\n        criteriaInstanceMap[criteriaInstance.data?.id || ""] = criteriaInstance;',
    );
    expect(MONITOR_INCIDENT).toContain(
      "if (!autoResolveTemplates || autoResolveTemplates.length === 0) {\n      return false;\n    }",
    );
    expect(criteriaPage).toContain(
      "An incident from a criteria you have since deleted is not resolved by the monitor: resolve it by hand.",
    );
  });

  it("changes a monitor several probes check only when its probes agree", () => {
    expect(MONITOR_RESOURCE).toContain(
      "MonitorTypeHelper.isProbableMonitor(monitor.monitorType) &&",
    );
    expect(MONITOR_RESOURCE).toContain("Probe agreement not reached:");
    expect(MONITOR_RESOURCE).toContain(
      "if (!probeAgreementResult.hasAgreement) {",
    );
    expect(lifecycle).toContain(
      "- **Several probes.** A monitor checked by more than one probe changes only when its probes agree.",
    );
  });

  it("holds back new incidents and alerts while a parent monitor is in a suppressing status, by default any offline one", () => {
    const parent: (
      isOffline: boolean,
      statusId: string,
    ) => ParentMonitorStatusRef = (
      isOffline: boolean,
      statusId: string,
    ): ParentMonitorStatusRef => {
      return {
        monitorId: "router",
        monitorName: "Router",
        statusId: statusId,
        statusName: isOffline ? "Offline" : "Degraded",
        isOfflineState: isOffline,
      };
    };

    expect(
      MonitorDependencyRule.getSuppressingParents({
        parents: [parent(true, "offline")],
        configuredSuppressionStatusIds: new Set<string>(),
      }),
    ).toHaveLength(1);
    expect(
      MonitorDependencyRule.getSuppressingParents({
        parents: [parent(false, "degraded")],
        configuredSuppressionStatusIds: new Set<string>(),
      }),
    ).toHaveLength(0);
    expect(
      MonitorDependencyRule.getSuppressingParents({
        parents: [parent(false, "degraded")],
        configuredSuppressionStatusIds: new Set<string>(["degraded"]),
      }),
    ).toHaveLength(1);
    expect(DEPENDENCIES_PAGE).toContain('title: "Depends On Monitors",');
    expect(DEPENDENCIES_PAGE).toContain(
      'title: "Suppress When Parent Status Is",',
    );
    expect(MONITOR_MENU).toContain('title: "Dependencies",');
    // Only creation is held back: the status and the resolve path go on.
    expect(MONITOR_INCIDENT).toContain(
      "This monitor's status still updates normally; open incidents still auto-resolve.",
    );
    expect(lifecycle).toContain(
      "- **A parent monitor that is down.** On a monitor's **Configuration → Dependencies** page, **Depends On Monitors** names the monitors it relies on. While one of them is in a status listed in **Suppress When Parent Status Is** (any offline status, when that is left empty), the monitor opens no incidents or alerts. Its status still changes, and what is open still resolves.",
    );
  });

  it("does not check a monitor while a maintenance event it is on is in progress", () => {
    expect(MONITOR_PROBE_SERVICE).toContain(
      'AND m."disableActiveMonitoringBecauseOfScheduledMaintenanceEvent" = false',
    );
    expect(MONITOR_RESOURCE).toContain(
      "if (monitor.disableActiveMonitoringBecauseOfScheduledMaintenanceEvent) {",
    );
    expect(lifecycle).toContain(
      "- **Scheduled maintenance.** A monitor on a maintenance event that is in progress is not checked, so its criteria do not run.",
    );
  });

  it("shows how a check was judged on the Monitor Summary card, a skipped incident included", () => {
    expect(SUMMARY_CARD).toContain('title="Monitor Summary"');
    expect(SUMMARY_CARD).toContain("evaluationSummary");
    expect(MONITOR_INCIDENT).toContain('type: "incident-skipped",');
    expect(lifecycle).toContain(
      "To see how a check was judged, open the monitor's **Overview**: the **Monitor Summary** card shows which criteria matched and what each one did, including an incident it skipped because one was already open.",
    );
  });
});

// ---- Changing a monitor's criteria ---------------------------------------------------------

describe("changing a monitor's criteria", () => {
  const criteriaPage: string = english(CRITERIA_AND_STATUSES);
  const steps: string = section(criteriaPage, "## Change a monitor's criteria");

  it("starts from the Criteria page, under the monitor's Configuration section, which starts folded", () => {
    const configuration: string = between(
      MONITOR_MENU,
      "const configurationItems: SideMenuItemProps[] = [];",
      "const advancedItems",
    );

    expect(configuration).toContain('title: "Criteria",');
    expect(configuration).toContain('title: "Dependencies",');
    expect(MONITOR_MENU).toContain('title: "Configuration",');
    expect(startsCollapsed(MONITOR_MENU, "Configuration")).toBe(true);
    expect(startsCollapsed(MONITOR_MENU, "Overview")).toBe(false);
    expect(steps).toContain(
      "Go to **Monitors** and open the monitor. Expand **Configuration** in its side menu and click **Criteria**. The **Monitoring Criteria** card shows each criteria, what it checks and what it does.",
    );
  });

  it("edits on the Monitoring Criteria card, every criteria open", () => {
    expect(CRITERIA_PAGE).toContain('title: "Monitoring Criteria",');
    expect(CRITERIA_PAGE).toContain(
      'editButtonText="Edit Monitoring Criteria"',
    );
    // Only Create Monitor folds a new monitor's criteria to their headers.
    expect(CRITERIA_PAGE).not.toContain("foldDefaultCriteria");
    expect(readDashboardSource("Pages/Monitor/Create.tsx")).toContain(
      "foldDefaultCriteria={true}",
    );
    expect(CRITERIA_LIST_FORM).toContain(
      "if (!props.foldDefaultCriteria) {\n      return false;\n    }",
    );
    expect(steps).toContain("### Click Edit Monitoring Criteria");
    expect(steps).toContain("The editor shows every criteria open.");
  });

  it("folds a criteria to its header: name, filter count and what it does", () => {
    const header: string = between(
      CRITERIA_LIST_FORM,
      "const parts: Array<string> = [",
      "return parts",
    );

    expect(header).toContain("getCriteriaFilterCountText({");
    expect(header).toContain('translator.translateText("status change")');
    expect(CRITERIA_LIST_FORM).toContain("aria-expanded={!isCollapsed}");
    expect(steps).toContain(
      "Click a criteria's header to fold it to one line: its name, how many filters it has and what it does.",
    );
  });

  it("adds at the bottom, open; reorders by the handle on the left; keeps at least one", () => {
    const add: string = between(
      CRITERIA_LIST_FORM,
      'title="Add Criteria"',
      "props.onChange?.(",
    );

    expect(add).toContain(
      "addedCriteriaIds.current.add(newMonitorCriteria.data.id);",
    );
    expect(add).toContain("newMonitorCriterias.push(newMonitorCriteria);");
    expect(CRITERIA_LIST_FORM).toContain(
      "if (addedCriteriaIds.current.has(criteriaId)) {\n      return false;\n    }",
    );
    // The drag handle is the first thing in a criteria's header.
    const handle: number = CRITERIA_LIST_FORM.indexOf(
      "{...draggableProvided.dragHandleProps}",
    );
    const toggle: number = CRITERIA_LIST_FORM.indexOf(
      "aria-expanded={!isCollapsed}",
    );

    expect(handle).toBeGreaterThan(0);
    expect(handle).toBeLessThan(toggle);
    expect(CRITERIA_INSTANCE_FORM).toContain('title="Delete Criteria"');
    expect(CRITERIA_LIST_FORM).toContain('title="This is the only criteria"');
    expect(CRITERIA_LIST_FORM).toContain(
      "A monitor needs at least one criteria.",
    );
    expect(steps).toContain(
      "**Add Criteria** adds one at the bottom, open and named after its filter. Drag a criteria by the handle on its left to move it: the first match wins, so put the worst case first. **Delete Criteria** removes one; a monitor keeps at least one criteria.",
    );
  });

  it("saves with Save Changes", () => {
    expect(
      readCommonSource("UI/Components/ModelDetail/CardModelDetail.tsx"),
    ).toContain("submitButtonText={`Save Changes`}");
    expect(steps).toContain(
      "Click **Save Changes**. The next check is judged by the new criteria.",
    );
  });

  it("tests a monitor probes check from the card", () => {
    expect(CRITERIA_PAGE).toContain(
      "rightElement: monitorSteps ? (\n            <MonitorTestForm",
    );
    expect(MONITOR_TEST_FORM).toContain("if (!isProbeable || !canRunTest) {");
    for (const label of [
      'title="Test Monitor"',
      'submitButtonText="Run Test"',
      'title: "Select Probe",',
      'title="Monitor Test Result"',
    ]) {
      expect({ label, drawn: MONITOR_TEST_FORM.includes(label) }).toEqual({
        label,
        drawn: true,
      });
    }

    expect(steps).toContain(
      "On a monitor that probes check, click **Test Monitor** on the card, pick a probe under **Select Probe** and click **Run Test**. **Monitor Test Result** shows what the check found.",
    );
  });

  it("has no criteria on a Manual monitor", () => {
    expect(
      MonitorTypeHelper.doesMonitorTypeHaveCriteria(MonitorType.Manual),
    ).toBe(false);
    expect(
      MonitorTypeHelper.doesMonitorTypeHaveCriteria(MonitorType.Website),
    ).toBe(true);
    expect(CRITERIA_PAGE).toContain(
      'title={"No Criteria for Manual Monitors"}',
    );
    expect(criteriaPage).toContain(
      "A Manual monitor has no criteria: you set its status yourself.",
    );
  });
});

// ---- Monitor statuses -----------------------------------------------------------------------

/*
 * What a new project is seeded with, read from ProjectService's
 * addDefaultMonitorStatus: each status's name, place, colour and flag.
 */
interface SeededStatus {
  name: string;
  priority: number;
  color: string;
  flag: string | null;
}

function seededStatuses(): Array<SeededStatus> {
  const body: string = between(
    PROJECT_SERVICE,
    "async addDefaultMonitorStatus(",
    "\n  }\n",
  );

  return body
    .split("if (!existingNames.has(")
    .slice(1)
    .map((block: string): SeededStatus => {
      const field: (name: string) => string = (name: string): string => {
        return (
          block.match(
            new RegExp(`\\.${escapeRegExp(name)} =\\s*([^;]+);`),
          )?.[1] || ""
        ).trim();
      };
      const flag: RegExpMatchArray | null = block.match(
        /\.(is\w+State) = true;/,
      );

      return {
        name: JSON.parse(field("name")) as string,
        priority: Number(field("priority")),
        color: field("color"),
        flag: flag ? (flag[1] as string) : null,
      };
    });
}

describe("the monitor statuses a new project has", () => {
  const criteriaPage: string = english(CRITERIA_AND_STATUSES);
  const statuses: string = section(criteriaPage, "## Monitor statuses");
  const seeded: Array<SeededStatus> = seededStatuses();

  it("are three, the operational status first and the offline status last", () => {
    expect(
      seeded.map((status: SeededStatus): Array<string | number | null> => {
        return [status.name, status.priority, status.color, status.flag];
      }),
    ).toEqual([
      ["Operational", 1, "Green", "isOperationalState"],
      ["Degraded", 2, "Yellow", null],
      ["Offline", 3, "Red", "isOfflineState"],
    ]);
    expect(
      SEEDED_MONITOR_STATUSES.map(
        (status: {
          name: string;
          place: number;
          color: string;
        }): Array<string | number> => {
          return [status.name, status.place, status.color];
        },
      ),
    ).toEqual(
      seeded.map((status: SeededStatus): Array<string | number> => {
        return [status.name, status.priority, status.color];
      }),
    );
    expect(statuses).toContain(
      "A monitor is always in one of your project's statuses. A new project has three, from the healthiest to the worst:",
    );
  });

  it("are the statuses table: name, place and colour, the built-in ones marked", () => {
    const rows: Array<Array<string>> = tableRows(statuses).map(tableCells);

    expect(
      rows.map((cells: Array<string>): Array<string> => {
        return cells.slice(0, 3);
      }),
    ).toEqual(
      seeded.map((status: SeededStatus): Array<string> => {
        return [`**${status.name}**`, String(status.priority), status.color];
      }),
    );

    for (const [index, status] of seeded.entries()) {
      const what: string = (rows[index] as Array<string>)[3] || "";

      expect({
        status: status.name,
        builtIn: what.endsWith(" Built-in."),
      }).toEqual({
        status: status.name,
        builtIn: status.flag !== null,
      });
    }
  });

  it("say what OneUptime does with each built-in status, as their Built-in tags do", () => {
    const tooltips: Record<string, string> =
      STATE_SETTINGS_COPY[StateListType.MonitorStatus].builtInTooltips;
    const rows: Array<string> = tableRows(statuses);

    expect(tooltips["isOperationalState"]).toContain(
      "New monitors start in this status.",
    );
    expect(tooltips["isOfflineState"]).toContain(
      "OneUptime treats a monitor in this status as down.",
    );
    expect(rows[0]).toContain("New monitors start in it,");
    expect(rows[2]).toContain("OneUptime treats a monitor in it as down.");
    // New monitors start in the project's operational status.
    expect(
      between(
        MONITOR_SERVICE,
        "A new monitor starts in the project's operational status.",
        "RelationIdUtil.stamp(",
      ),
    ).toContain("isOperationalState: true,");
  });

  it("are an order in which the status lowest in the list wins where monitors are shown together", () => {
    expect(
      STATE_SETTINGS_COPY[StateListType.MonitorStatus].description,
    ).toContain(
      "From healthiest to worst. Where monitors are shown together, as on a status page or in a monitor group, the status lowest in this list wins.",
    );
    expect(
      StatusPageResourceUptimeUtil.getWorstMonitorStatus({
        monitorStatuses: [
          monitorStatus("Operational", 1),
          monitorStatus("Offline", 3),
          monitorStatus("Degraded", 2),
        ],
      }).name,
    ).toBe("Offline");
    expect(MONITOR_GROUP_SERVICE).toContain(
      "if (monitorStatus && currentStatus.priority! < monitorStatus.priority!) {",
    );
    expect(statuses).toContain(
      "The list is an order. Where monitors are shown together, the status lowest in the list wins: a monitor group, a status page group and a status page's overall status each show the worst status among their monitors.",
    );
  });
});

describe("where a monitor's status counts", () => {
  const criteriaPage: string = english(CRITERIA_AND_STATUSES);
  const counts: string = section(criteriaPage, "### Where a status counts");
  const rows: Array<string> = tableRows(counts);

  it("lists the Monitors list, status pages, monitor groups, SLOs and dependencies", () => {
    expect(firstColumn(counts)).toEqual([
      "The **Monitors** list",
      "Status pages",
      "Monitor groups",
      "SLOs",
      "Dependencies",
    ]);
  });

  it("counts every monitor not in the operational status under Not Operational, in red", () => {
    const monitors: Array<MenuSection> = menuSections(MONITORS_MENU_SOURCE, {
      "...(workspaceSection ? [workspaceSection] : [])": workspaceSection(),
      "addDeveloperSideMenuSection(sections": developerSection(),
    });
    const attention: string = between(
      MONITORS_MENU_SOURCE,
      'title: "Not Operational",',
      'title: "Disabled",',
    );

    expect(sectionByTitle(monitors, "Attention Required").items).toContain(
      "Not Operational",
    );
    expect(attention).toContain("badgeType: BadgeType.DANGER,");
    expect(attention).toContain("isOperationalState: false,");
    expect(rows[0]).toContain(
      "**Not Operational** lists the monitors in any status but the operational one, with a red count beside it.",
    );
  });

  it("counts against a status page's uptime only its Counts as downtime statuses, every non-operational one to start", () => {
    expect(StatusPageDisplaySettingsCopy.downtimeLabel).toBe(
      "Counts as downtime",
    );
    expect(new StatusPage().getTableColumns().columns).toContain(
      "downtimeMonitorStatuses",
    );
    expect(STATUS_PAGE_SERVICE).toContain(
      "if (!createBy.data.downtimeMonitorStatuses) {",
    );
    expect(STATUS_PAGE_SERVICE).toContain(
      "return !monitorStatus.isOperationalState;",
    );
    expect(rows[1]).toContain(
      `only the statuses in the page's **${StatusPageDisplaySettingsCopy.downtimeLabel}** count against it. A new status page starts with every status but the operational one.`,
    );
  });

  it("leaves a status added later out of the lists existing status pages hold", () => {
    expect(MONITOR_STATUS_SERVICE).not.toContain("downtimeMonitorStatuses");
    expect(criteriaPage).toContain(
      "A status you add later is not added to the **Counts as downtime** list of an existing status page: add it there yourself.",
    );
  });

  it("gives an SLO its own list of statuses that count as downtime", () => {
    expect(new ServiceLevelObjective().getTableColumns().columns).toContain(
      "downtimeMonitorStatuses",
    );
    expect(rows[3]).toContain(
      "| SLOs | The downtime an SLO counts, from its own list of statuses.",
    );
  });

  it("holds back a child's incidents and alerts while its parent is offline, by default", () => {
    expect(rows[4]).toBe(
      "| Dependencies | Whether a parent monitor holds back its children's incidents and alerts: by default, while it is in an offline status. |",
    );
  });
});

describe("adding a monitor status of your own", () => {
  const criteriaPage: string = english(CRITERIA_AND_STATUSES);
  // Its steps are headings of their own, so the section runs to the next one of its level.
  const adding: string = between(
    criteriaPage,
    "### Add a status of your own",
    "### The status timeline",
  );
  const definition: (typeof STATE_LISTS)[StateListType.MonitorStatus] =
    STATE_LISTS[StateListType.MonitorStatus];
  const rows: Array<StateListRow> = [
    statusRow("operational", "Operational", 1, { isOperationalState: true }),
    statusRow("degraded", "Degraded", 2),
    statusRow("offline", "Offline", 3, { isOfflineState: true }),
  ];

  it("starts from Monitor Status under the Monitors menu's Settings section, which starts folded", () => {
    const monitors: Array<MenuSection> = menuSections(MONITORS_MENU_SOURCE, {
      "...(workspaceSection ? [workspaceSection] : [])": workspaceSection(),
      "addDeveloperSideMenuSection(sections": developerSection(),
    });

    expect(sectionByTitle(monitors, "Settings").items[0]).toBe(
      "Monitor Status",
    );
    expect(startsCollapsed(MONITORS_MENU_SOURCE, "Settings")).toBe(true);
    expect(STATE_SETTINGS_COPY[StateListType.MonitorStatus].title).toBe(
      "Monitor Statuses",
    );
    expect(MONITOR_STATUSES_PAGE).toContain("sortOrder={SortOrder.Ascending}");
    expect(adding).toContain(
      "Go to **Monitors → Settings → Monitor Status**. **Settings** starts collapsed in the side menu: expand it first. The **Monitor Statuses** card lists the statuses from the healthiest to the worst.",
    );
  });

  it("creates a status with its name, description and colour, just above the offline status", () => {
    expect(new MonitorStatus().singularName).toBe("Monitor Status");
    expect(MONITOR_STATUSES_PAGE).toContain("isCreateable={true}");
    expect([
      StateSettingsSharedCopy.nameFieldTitle,
      StateSettingsSharedCopy.descriptionFieldTitle,
      StateSettingsSharedCopy.colorFieldTitle,
    ]).toEqual(["Name", "Description", "Color"]);
    expect(STATE_SETTINGS_TABLE).toContain(
      "title: StateSettingsSharedCopy.colorFieldTitle,",
    );
    expect(definition.insertAboveFlag).toBe("isOfflineState");
    // The new status takes the offline status's place, and it steps down one.
    expect(getStateListInsertValue(definition, rows)).toBe(3);
    expect(MONITOR_STATUS_SERVICE).toContain(
      "definition: STATE_LISTS[StateListType.MonitorStatus],",
    );
    expect(adding).toContain(
      "Click **Create Monitor Status** and fill in **Name**, **Description** and **Color**. The new status goes in just above the offline status, so an outage still reads as the worst.",
    );
  });

  it("is dragged into its place, a status lower in the list reading as worse", () => {
    expect(MONITOR_STATUSES_PAGE).toContain("enableDragAndDrop={true}");
    expect(MONITOR_STATUSES_PAGE).toContain('dragDropIndexField="priority"');
    expect(adding).toContain(
      "Drag the status by its handle. A status lower in the list reads as worse than every status above it.",
    );
  });

  it("does nothing until a criteria moves monitors into it", () => {
    expect(STATUS_TIMELINE_UTIL).toContain(
      "input.criteriaInstance.data?.monitorStatusId.toString() !==\n        input.monitor.currentMonitorStatusId?.toString()",
    );
    expect(adding).toContain(
      "A status does nothing until a criteria moves monitors into it. Pick it in **Change monitor status to** on the criteria that should set it.",
    );
  });

  it("keeps the operational and offline statuses: renamed, recoloured, never deleted", () => {
    expect(
      definition.builtIns.map((builtIn: { flag: string }): string => {
        return builtIn.flag;
      }),
    ).toEqual(["isOperationalState", "isOfflineState"]);
    expect(
      getStateListDeleteRefusal({
        definition: definition,
        rows: rows,
        idsToDelete: ["offline"],
      })?.builtIn.flag,
    ).toBe("isOfflineState");
    expect(
      getStateListDeleteRefusal({
        definition: definition,
        rows: rows,
        idsToDelete: ["degraded"],
      }),
    ).toBeNull();
    expect(StateSettingsSharedCopy.builtInTag).toBe("Built-in");
    expect(
      STATE_SETTINGS_COPY[StateListType.MonitorStatus].deleteLockedReason,
    ).toBe("Built-in statuses can be renamed, but not deleted.");
    expect(criteriaPage).toContain(
      "The operational and offline statuses are marked **Built-in**: you can rename them and change their color, but not delete them.",
    );
    expect(criteriaPage).toContain(
      "**Operational** and **Offline** are built-in: OneUptime moves monitors into them, so they can be renamed but not deleted.",
    );
  });

  it("needs the Growth plan to create or change a status on OneUptime Cloud", () => {
    const model: MonitorStatus = new MonitorStatus();

    expect([
      model.getCreateBillingPlan(),
      model.getUpdateBillingPlan(),
      model.getReadBillingPlan(),
      model.getDeleteBillingPlan(),
    ]).toEqual([
      PlanType.Growth,
      PlanType.Growth,
      PlanType.Free,
      PlanType.Free,
    ]);
    expect(criteriaPage).toContain(
      `On OneUptime Cloud, creating a status or changing one needs the ${PlanType.Growth} plan.`,
    );
  });

  it("is managed by the Project Owner, Project Admin and Monitor Admin roles, or the matching custom permission", () => {
    const model: MonitorStatus = new MonitorStatus();
    const roles: Array<string> = rolesOf(model.getCreatePermissions());

    expect(roles).toEqual(["Project Owner", "Project Admin", "Monitor Admin"]);
    expect(rolesOf(model.getUpdatePermissions())).toEqual(roles);
    expect(rolesOf(model.getDeletePermissions())).toEqual(roles);
    expect(customPermissionsOf(model.getCreatePermissions())).toEqual([
      "Create Monitor Status",
    ]);
    expect(customPermissionsOf(model.getUpdatePermissions())).toEqual([
      "Edit Monitor Status",
    ]);
    expect(criteriaPage).toContain(
      `Managing statuses takes the ${listedPlainly(roles, "or")} role, or a custom role with the matching monitor status permission.`,
    );
  });
});

describe("a monitor's status timeline", () => {
  const criteriaPage: string = english(CRITERIA_AND_STATUSES);
  const timeline: string = section(criteriaPage, "### The status timeline");

  it("keeps every change, with its cause, and takes a status added by hand", () => {
    expect(MONITOR_MENU).toContain('title: "Status Timeline",');
    expect(STATUS_TIMELINE_PAGE).toContain('title: "View Cause",');
    expect(STATUS_TIMELINE_PAGE).toContain("isCreateable={true}");
    expect(new MonitorStatusTimeline().singularName).toBe(
      "Monitor Status Event",
    );
    expect(timeline).toContain(
      "Every status change is kept on the monitor's **Status Timeline**: when it started, how long it lasted, and **View Cause** for the criteria that set it. **Create Monitor Status Event** adds a status by hand.",
    );
  });

  it("tells owners of a change only once they turn Monitor status changed on, which a new member has off", () => {
    expect(NOTIFICATION_SETTINGS_PAGE).toContain(
      '[NotificationSettingEventType.SEND_MONITOR_STATUS_CHANGED_OWNER_NOTIFICATION]:\n    {\n      label: "Monitor status changed",',
    );
    // A new member's defaults leave it off.
    expect(
      between(
        NOTIFICATION_SETTING_SERVICE,
        "public async addDefaultNotificationSettingsForUser(",
        "\n  }\n",
      ),
    ).toContain(
      "await this.addMonitorNotificationSettings(userId, projectId);",
    );
    expect(NOTIFICATION_SETTING_SERVICE).not.toContain(
      "SEND_MONITOR_STATUS_CHANGED_OWNER_NOTIFICATION",
    );
    expect(STATUS_CHANGE_NOTIFICATION_JOB).toContain(
      "NotificationSettingEventType.SEND_MONITOR_STATUS_CHANGED_OWNER_NOTIFICATION",
    );
    expect(timeline).toContain(
      "Changing a monitor's status notifies its owners only when they have turned on **Monitor status changed** in their notification settings: it starts off.",
    );
  });
});

// ---- Monitor groups -----------------------------------------------------------------------

describe("a monitor group's status", () => {
  const groupsPage: string = english(MONITOR_GROUPS);
  const status: string = between(
    MONITOR_GROUP_SERVICE,
    "public async getCurrentStatus(",
    "\n  }\n",
  );

  it("rolls the group's monitors up into one status a status page shows as one row", () => {
    expect(MonitorGroupsSwitchCopy.note).toBe(
      "A monitor group rolls several monitors up into one status, which a status page can show as one row. Turning this off deletes no group.",
    );
    expect(GROUPS_PAGE).toContain(
      '"Monitors that together make up one service, such as Checkout. A group shows the worst status among its monitors, and a status page can show the whole group as one resource."',
    );
    expect(groupsPage).toContain(
      "A monitor group rolls several monitors up into one status. Group the monitors that together make up one service, such as Checkout",
    );
    expect(groupsPage).toContain(
      "The group shows the worst status among them, keeps its own uptime, and a status page can show the whole group as one row.",
    );
  });

  it("starts at the operational status and takes the worst among the group's monitors", () => {
    expect(status).toContain("return monitorStatus.isOperationalState;");
    expect(status).toContain(
      "if (monitorStatus && currentStatus.priority! < monitorStatus.priority!) {",
    );
    expect(groupsPage).toContain(
      "A group starts at your operational status and takes the worst status among its monitors: the one lowest in your project's list of monitor statuses.",
    );
  });

  it("leaves archived monitors out, so a group of none or only archived ones is operational", () => {
    expect(status).toContain(
      "ArchivedMonitorResources.withoutArchivedMonitors(",
    );
    expect(
      ArchivedMonitorResources.withoutArchivedMonitors([
        { monitor: { isArchived: true } },
        { monitor: { isArchived: false } },
        { monitor: {} },
      ]),
    ).toHaveLength(2);
    expect(groupsPage).toContain(
      "- **Archived monitors do not count.** An archived monitor is not checked, so its status is frozen; the group leaves it out.",
    );
    expect(groupsPage).toContain(
      "- **An empty group is operational.** A group with no monitors, or with only archived ones, shows your operational status. Until you add a monitor, the Dashboard shows **No monitors yet** in place of its status.",
    );
  });

  it("says No monitors yet in the Dashboard for a group with no monitors at all, on its Overview and in the list", () => {
    expect(MonitorGroupMonitorsCopy.emptyGroupStatus).toBe("No monitors yet");
    // Both count the group's rows - archived monitors included - and draw it.
    expect(GROUP_OVERVIEW_PAGE).toContain("modelType: MonitorGroupResource,");
    expect(GROUP_OVERVIEW_PAGE).toContain("return <NoMonitorsStatus />;");
    expect(GROUP_CURRENT_STATUS).toContain("modelType: MonitorGroupResource,");
    expect(GROUP_CURRENT_STATUS).toContain("return <NoMonitorsStatus />;");
    expect(NO_MONITORS_STATUS).toContain(
      "translator.translateText(MonitorGroupMonitorsCopy.emptyGroupStatus)",
    );
  });

  it("is not a status page group", () => {
    expect(groupsPage).toContain(
      "A monitor group is not a status page group. A status page group is a heading on one status page that holds rows. A monitor group is one row that stands for several monitors, and any status page can show it.",
    );
  });
});

describe("before a project uses monitor groups", () => {
  const groupsPage: string = english(MONITOR_GROUPS);
  const before: string = section(groupsPage, "## Before you begin");

  it("needs the Scale plan on OneUptime Cloud", () => {
    const model: MonitorGroup = new MonitorGroup();

    expect([
      model.getCreateBillingPlan(),
      model.getReadBillingPlan(),
      model.getUpdateBillingPlan(),
      model.getDeleteBillingPlan(),
    ]).toEqual([
      PlanType.Scale,
      PlanType.Scale,
      PlanType.Scale,
      PlanType.Scale,
    ]);
    expect(before).toContain(
      `- **Your plan.** On OneUptime Cloud, monitor groups need the ${PlanType.Scale} plan.`,
    );
  });

  it("is switched on per project, off to start, by the Project Owner or a custom role with Edit Project or Manage Billing", () => {
    const project: Project = new Project();

    expect(MONITOR_GROUPS_SWITCH_COLUMN).toBe(
      "isFeatureFlagMonitorGroupsEnabled",
    );
    expect(
      project.getTableColumnMetadata(MONITOR_GROUPS_SWITCH_COLUMN).defaultValue,
    ).toBe(false);

    const updaters: Array<Permission> =
      project.getColumnAccessControlFor(MONITOR_GROUPS_SWITCH_COLUMN)?.update ||
      [];

    expect(rolesOf(updaters)).toEqual(["Project Owner"]);
    expect([...customPermissionsOf(updaters)].sort()).toEqual([
      "Edit Project",
      "Manage Billing",
    ]);
    expect(before).toContain(
      "- **The switch.** Monitor groups are hidden until **Monitor Groups** is turned on for the project (see below). Turning it on takes the Project Owner role, or a custom role with the Edit Project or Manage Billing permission.",
    );
  });

  it("lets five roles create, change and delete groups, and a Viewer only see them", () => {
    const model: MonitorGroup = new MonitorGroup();
    const roles: Array<string> = rolesOf(model.getCreatePermissions());

    expect(roles).toEqual([
      "Project Owner",
      "Project Admin",
      "Project Member",
      "Monitor Admin",
      "Monitor Member",
    ]);
    expect(rolesOf(model.getUpdatePermissions())).toEqual(roles);
    expect(rolesOf(model.getDeletePermissions())).toEqual(roles);
    expect(rolesOf(model.getReadPermissions())).toContain("Viewer");
    expect(rolesOf(model.getCreatePermissions())).not.toContain("Viewer");
    expect(before).toContain(
      `- **Your role.** Creating, changing and deleting groups takes the ${listedPlainly(roles, "or")} role, or a custom role with the matching monitor group permissions. A Viewer can see groups but not change them.`,
    );
  });
});

describe("turning monitor groups on", () => {
  const groupsPage: string = english(MONITOR_GROUPS);
  const turningOn: string = section(groupsPage, "## Turn on monitor groups");

  it("is a switch on Feature Flags, under Project Settings' Advanced section, which starts folded", () => {
    const settings: Array<MenuSection> = menuSections(SETTINGS_MENU);

    expect(sectionByTitle(settings, "Advanced").items).toContain(
      "Feature Flags",
    );
    expect(startsCollapsed(SETTINGS_MENU, "Advanced")).toBe(true);
    expect(MonitorGroupsSwitchCopy.cardTitle).toBe("Feature Flags");
    expect(MonitorGroupsSwitchCopy.switchTitle).toBe("Monitor Groups");
    expect(turningOn).toContain(
      "Go to **Project Settings → Advanced → Feature Flags**. **Advanced** starts collapsed in the side menu: expand it first.",
    );
  });

  it("puts Monitor Groups in the Monitors menu and renames a status page's Monitors item Resources", () => {
    expect(MONITORS_MENU_SOURCE).toContain(
      '...(props.project?.isFeatureFlagMonitorGroupsEnabled\n          ? [\n              {\n                link: {\n                  title: "Monitor Groups",',
    );
    expect(STATUS_PAGE_MENU).toContain(
      'title: project?.isFeatureFlagMonitorGroupsEnabled\n              ? "Resources"\n              : "Monitors",',
    );
    expect(turningOn).toContain(
      "Flip the **Monitor Groups** switch. It saves at once: **Monitor Groups** appears in the **Monitors** side menu, and each status page's **Monitors** item is renamed **Resources**, where you can add a group.",
    );
  });

  it("deletes no group when it is turned off", () => {
    expect(MonitorGroupsSwitchCopy.note).toContain(
      "Turning this off deletes no group.",
    );
    expect(groupsPage).toContain(
      "Turning the switch off again hides **Monitor Groups** from the menu. It deletes no group.",
    );
  });
});

describe("creating a monitor group", () => {
  const groupsPage: string = english(MONITOR_GROUPS);
  const creating: string = section(groupsPage, "## Create a monitor group");

  it("lists each group with its current status, labels and owners", () => {
    const columns: string = between(GROUPS_PAGE, "columns={[", "]}\n      />");

    expect(GROUPS_PAGE).toContain('title: "Monitor Groups",');
    expect(
      Array.from(columns.matchAll(/title: "([^"]+)"/g)).map(
        (match: RegExpMatchArray): string => {
          return match[1] as string;
        },
      ),
    ).toEqual(["Name", "Current Status", "Labels", "Owners"]);
    expect(creating).toContain(
      "Go to **Monitors → Monitor Groups**. The **Monitor Groups** card lists each group with its **Current Status**, labels and owners.",
    );
  });

  it("asks a new group for a name and an optional description, and creates it with no monitors", () => {
    const form: string = between(
      GROUPS_PAGE,
      "formFields={[",
      "viewPageRoute=",
    );

    expect(new MonitorGroup().singularName).toBe("Monitor Group");
    expect(GROUPS_PAGE).toContain("isCreateable={true}");
    expect(fieldObject(form, "Name")).toContain("required: true,");
    expect(fieldObject(form, "Description")).toContain("required: false,");
    expect(creating).toContain(
      "Click **Create Monitor Group**, enter a **Name** and, if you like, a **Description**, and click **Create Monitor Group** at the bottom of the form. The group starts with no monitors.",
    );
  });

  it("adds monitors from an empty group's Overview, or its Monitors page, several at a time", () => {
    expect(GROUP_MONITORS_PAGE).toContain('title={"Monitors in Group"}');
    expect(MonitorGroupMonitorsCopy.addButton).toBe("Add Monitors");
    expect(MonitorGroupMonitorsCopy.monitorsField).toBe("Monitors");
    expect(GROUP_MONITORS_PAGE).toContain(
      "title: MonitorGroupMonitorsCopy.addButton,",
    );
    expect(GROUP_MONITORS_PAGE).toContain(
      "title: MonitorGroupMonitorsCopy.monitorsField,",
    );
    expect(GROUP_MONITORS_PAGE).toContain(
      "fieldType: FormFieldSchemaType.MultiSelectDropdown,",
    );
    expect(GROUP_MONITORS_PAGE).toContain(
      "submitButtonText={MonitorGroupMonitorsCopy.addButton}",
    );
    // An empty group's Overview offers it, and opens the page with it open.
    expect(GROUP_OVERVIEW_PAGE).toContain("monitorCount === 0 ? (");
    expect(GROUP_OVERVIEW_PAGE).toContain(
      "title={MonitorGroupMonitorsCopy.addButton}",
    );
    expect(GROUP_OVERVIEW_PAGE).toContain(
      "PageMap.MONITOR_GROUP_VIEW_MONITORS",
    );
    expect(GROUP_OVERVIEW_PAGE).toContain(
      '[ADD_MONITORS_QUERY_PARAM]: "true",',
    );
    expect(creating).toContain(
      "### Add its monitors\n\nOpen the group: until it has a monitor, its **Overview** offers **Add Monitors**. Later, click **Monitors** in its side menu, then **Add Monitors**. Pick every monitor of the group under **Monitors** and click **Add Monitors**.",
    );
  });

  it("shows the group's status now and over the last 90 days, one bar per day", () => {
    expect(GROUP_OVERVIEW_PAGE).toContain('title: "Current Status",');
    expect(GROUP_OVERVIEW_PAGE).toContain('title="Uptime Graph"');
    expect(GROUP_OVERVIEW_PAGE).toContain(
      'description="This group\'s status over the last 90 days, one bar per day."',
    );
    expect(GROUP_OVERVIEW_PAGE).toContain(
      "startDate={OneUptimeDate.getSomeDaysAgo(90)}",
    );
    expect(creating).toContain(
      "Click **Overview**. **Current Status** shows the group's status now, and **Uptime Graph** shows its last 90 days, one bar per day.",
    );
  });

  it("takes a monitor out with Remove, leaving the monitor as it is, in as many groups as you like", () => {
    expect(GROUP_MONITORS_PAGE).toContain('title: "Remove",');
    expect(GROUP_MONITORS_PAGE).toContain("isDeleteable={false}");
    // Nothing keeps a monitor to one group.
    expect(MONITOR_GROUP_RESOURCE_SERVICE).not.toContain("onBeforeCreate");
    expect(groupsPage).toContain(
      "To take a monitor out of the group, click **Remove** on its row in **Monitors in Group**. The monitor itself does not change. A monitor can belong to more than one group.",
    );
  });
});

describe("a monitor group's pages", () => {
  const groupsPage: string = english(MONITOR_GROUPS);
  const pages: string = section(groupsPage, "## A group's pages");
  const menu: Array<MenuSection> = menuSections(GROUP_MENU);

  it("are its side menu's pages, Owners, Audit Logs and Delete Group under Advanced, which starts folded", () => {
    expect(
      menu.map((menuSection: MenuSection): Array<string> => {
        return [menuSection.title, ...menuSection.items];
      }),
    ).toEqual([
      ["Overview", "Overview", "Monitors"],
      ["Activity", "Incidents", "Alerts"],
      ["Advanced", "Owners", "Audit Logs", "Delete Group"],
    ]);
    expect(startsCollapsed(GROUP_MENU, "Advanced")).toBe(true);
    expect(firstColumn(pages)).toEqual(
      menu
        .flatMap((menuSection: MenuSection): Array<string> => {
          return menuSection.items;
        })
        .map((item: string): string => {
          return `**${item}**`;
        }),
    );
    expect(pages).toContain(
      "| **Owners** | The people and teams responsible for the group. It is under **Advanced**, which starts collapsed. |",
    );
    expect(pages).toContain(
      "| **Audit Logs** | Who changed the group, and when, also under **Advanced**. |",
    );
    expect(pages).toContain(
      "| **Delete Group** | Deletes the group, also under **Advanced**. |",
    );
  });

  it("show the group's details and its uptime over the last 90 days on Overview", () => {
    expect(GROUP_OVERVIEW_PAGE).toContain('title: "Monitor Group Details",');
    expect(GROUP_OVERVIEW_PAGE).toContain(
      "startDate: OneUptimeDate.getSomeDaysAgo(90),",
    );
    expect(pages).toContain(
      "| **Overview** | **Monitor Group Details**, **Current Status**, and **Uptime Graph** with the group's uptime percentage over the last 90 days. A group with no monitors offers **Add Monitors** in place of the graph. |",
    );
    expect(GROUP_OVERVIEW_PAGE).toContain(
      "title={MonitorGroupMonitorsCopy.emptyGroupCardTitle}",
    );
  });

  it("count every status but the operational one as downtime in the group's uptime", () => {
    expect(GROUP_OVERVIEW_PAGE).toContain(
      "setDowntimeMonitorStatues(\n        monitorStatuses.data.filter((status: MonitorStatus) => {\n          return !status.isOperationalState;",
    );
    expect(pages).toContain(
      "The uptime on **Overview** counts every status but the operational one as downtime.",
    );
  });

  it("let the list filter by owner and label, label and own many groups at once, and export or import JSON", () => {
    expect(GROUPS_PAGE).toContain("showLabelsFacet: true,");
    expect(GROUPS_PAGE).toContain(
      "buttons: [...labelBulkActions, ...ownerBulkActions],",
    );
    expect(GROUPS_PAGE).toContain("enableJsonImportExport={true}");
    expect(groupsPage).toContain(
      "The **Monitor Groups** list can filter groups by owner and label, set labels and owners on many groups at once, and export or import groups as JSON.",
    );
  });
});

describe("a monitor group on a status page", () => {
  const groupsPage: string = english(MONITOR_GROUPS);
  const showing: string = section(
    groupsPage,
    "## Show a group on a status page",
  );

  it("is added from the page's Resources with Add Monitor, switched to a group while the switch is on", () => {
    const footer: string = between(
      STATUS_PAGE_RESOURCES_PAGE,
      "const getFooterForMonitor: GetFooterForMonitorFunction = (): ReactElement => {",
      "\n  };\n",
    );

    expect(footer).toContain(
      "if (!props.currentProject?.isFeatureFlagMonitorGroupsEnabled) {\n      return <></>;\n    }",
    );
    expect(footer).toContain(
      'translator.translateText("Add a Monitor Group instead.")',
    );
    expect(STATUS_PAGE_RESOURCE_PANEL).toContain('title="Add Monitor"');
    expect(STATUS_PAGE_RESOURCE_PANEL).toContain(
      'submitButtonText="Add Monitor"',
    );
    expect(STATUS_PAGE_RESOURCE_FIELDS).toContain('title: "Monitor Group",');
    expect(showing).toContain(
      "Click **Add Monitor**. Under the monitor dropdown, click **Add a Monitor Group instead.** The dropdown becomes **Monitor Group**.",
    );
    expect(groupsPage).toContain(
      "**Add a Monitor Group instead.** appears in the dialog only while the **Monitor Groups** switch is on for the project.",
    );
  });

  it("names the row after the group until you type a name of your own", () => {
    expect(fieldObject(STATUS_PAGE_RESOURCE_FIELDS, "Display Name")).toContain(
      "The name visitors see on the status page. It follows what you pick above until you type a name of your own.",
    );
    expect(showing).toContain(
      "Pick the group. **Display Name**, the name visitors read, fills in with the group's name until you type one of your own.",
    );
  });

  it("shows the incidents of the group's monitors, naming the group among the affected resources", () => {
    expect(STATUS_PAGE_INCIDENT_PAGE).toContain(
      "monitorsInGroup[monitorGroupId]! || []",
    );
    expect(groupsPage).toContain(
      "- **Its incidents.** An incident on any monitor in the group appears on the page, with the group named among the affected resources.",
    );
  });

  it("tells a subscriber who picks the group about every monitor in it", () => {
    expect(STATUS_PAGE_RESOURCE_SERVICE).toContain(
      "monitorGroupId: QueryHelper.any(monitorGroupIds),",
    );
    expect(groupsPage).toContain(
      "- **Its subscribers.** A subscriber who picks the group hears about every monitor in it.",
    );
  });

  it("goes with the group: deleting it deletes its rows and memberships, never its monitors", () => {
    expect(
      propertyDecorators(
        STATUS_PAGE_RESOURCE_MODEL,
        "public monitorGroup?: MonitorGroup = undefined;",
      ),
    ).toContain('onDelete: "CASCADE",');
    expect(
      propertyDecorators(
        MONITOR_GROUP_RESOURCE_MODEL,
        "public monitorGroup?: MonitorGroup = undefined;",
      ),
    ).toContain('onDelete: "CASCADE",');
    expect(groupsPage).toContain(
      "> Deleting a monitor group also deletes its row from every status page that shows it. The monitors in the group, and their incidents, are not deleted.",
    );
  });
});

describe("monitor groups through the API and Terraform", () => {
  const groupsPage: string = english(MONITOR_GROUPS);

  it("are /api/monitor-group, and a row of /api/monitor-group-resource for each monitor in one", () => {
    const resourceColumns: Array<string> =
      new MonitorGroupResource().getTableColumns().columns;

    expect(new MonitorGroup().crudApiPath?.toString()).toBe("/monitor-group");
    expect(new MonitorGroupResource().crudApiPath?.toString()).toBe(
      "/monitor-group-resource",
    );
    expect(resourceColumns).toContain("monitorGroupId");
    expect(resourceColumns).toContain("monitorId");
    expect(groupsPage).toContain(
      "A group is `/api/monitor-group`, and each monitor in it is a row of `/api/monitor-group-resource` that pairs a `monitorGroupId` with a `monitorId`.",
    );
  });

  it("are the Terraform resources the Terraform examples page uses", () => {
    const examples: string = english("terraform/examples");

    expect(examples).toContain('resource "oneuptime_monitor_group"');
    expect(examples).toContain('resource "oneuptime_monitor_group_resource"');
    expect(examples).toContain("\n### Monitor group\n");
    expect(groupsPage).toContain(
      "In Terraform they are `oneuptime_monitor_group` and `oneuptime_monitor_group_resource`: see [Monitor group](/docs/terraform/examples#monitor-group).",
    );
  });
});

// ---- Postmortems -------------------------------------------------------------------------

describe("where a postmortem is written", () => {
  const postmortems: string = english(POSTMORTEMS);
  const writing: string = section(postmortems, "## Write a postmortem");

  it("is the incident's Postmortem page, under Investigation in its side menu", () => {
    const investigation: string = between(
      INCIDENT_MENU,
      '<SideMenuSection title="Investigation">',
      "</SideMenuSection>",
    );

    expect(investigation).toContain('title: "Postmortem",');
    expect(postmortems).toContain(
      "They are on the incident's **Postmortem** page, under **Investigation** in its side menu.",
    );
    expect(writing).toContain(
      "Open the incident, then click **Postmortem** under **Investigation** in its side menu.",
    );
  });

  it("is the Postmortem card: its status and owners, the note, its attachments and whether it is on the status page", () => {
    expect(POSTMORTEM_PAGE).toContain(
      'cardProps={{\n          title: "Postmortem",',
    );
    expect(POSTMORTEM_PAGE).toContain("<PostmortemSummary");
    expect(POSTMORTEM_SUMMARY).toContain('<DetailFieldLabel title="Status" />');
    expect(POSTMORTEM_SUMMARY).toContain('title="Owners"');
    expect(POSTMORTEM_PAGE).toContain('title: "Postmortem Attachments",');
    expect(POSTMORTEM_PAGE).toContain(
      'title: "Postmortem visible on Status Page?",',
    );
    expect(writing).toContain(
      "The **Postmortem** card shows the postmortem's **Status** and **Owners**, the note, the attachments and whether the postmortem is on the status page.",
    );
  });

  it("opens the Write Postmortem dialog on its Postmortem step, then Status Page; written, Edit Postmortem Note opens the same steps", () => {
    const formSteps: string = between(
      POSTMORTEM_FORM,
      "export const INCIDENT_POSTMORTEM_FORM_STEPS",
      "];",
    );
    const writeDialog: string = between(
      POSTMORTEM_PAGE,
      "{isWriting ? (",
      "</>",
    );

    // Nothing written: Write Postmortem, the empty card's one button.
    expectLabelDeclared(
      POSTMORTEM_EMPTY_STATE,
      "WRITE_POSTMORTEM",
      "Write Postmortem",
    );
    expect(POSTMORTEM_EMPTY_STATE).toContain(
      "title: WRITE_POSTMORTEM,\n      icon: IconProp.Edit,\n      buttonStyle: ButtonStyleType.PRIMARY,",
    );
    expect(writeDialog).toContain('title="Write Postmortem"');
    expect(writeDialog).toContain("steps: INCIDENT_POSTMORTEM_FORM_STEPS,");
    // Written: the card's Edit button, with the same steps.
    expect(POSTMORTEM_PAGE).toContain("isEditable={hasNote === true}");
    expect(POSTMORTEM_PAGE).toContain('editButtonText="Edit Postmortem Note"');
    expect(POSTMORTEM_PAGE).toContain('editModalTitle="Edit Postmortem Note"');
    expect(POSTMORTEM_PAGE).toContain(
      "formSteps={INCIDENT_POSTMORTEM_FORM_STEPS}",
    );
    expect(
      Array.from(formSteps.matchAll(/title: "([^"]+)"/g)).map(
        (match: RegExpMatchArray): string => {
          return match[1] as string;
        },
      ),
    ).toEqual(["Postmortem", "Status Page"]);
    expect(writing).toContain("\n### Click Write Postmortem\n");
    expect(writing).toContain(
      "The **Write Postmortem** dialog opens on its first step, **Postmortem**. Once the postmortem is written, the card's button is **Edit Postmortem Note**, which opens the same steps.",
    );
  });

  it("asks for the note in Markdown and the attachments on the first step", () => {
    const note: string = fieldObject(POSTMORTEM_FORM, "Postmortem Note");
    const attachments: string = fieldObject(
      POSTMORTEM_FORM,
      "Postmortem Attachments",
    );

    expect(note).toContain('stepId: "postmortem",');
    expect(note).toContain("fieldType: FormFieldSchemaType.Markdown,");
    expect(note).toContain(
      "Capture what happened, impact, resolution, and follow-up actions.",
    );
    expect(attachments).toContain('stepId: "postmortem",');
    expect(attachments).toContain(
      "fieldType: FormFieldSchemaType.MultipleFiles,",
    );
    expect(writing).toContain(
      "Write the **Postmortem Note** in Markdown: what happened, the impact, how it was resolved and the follow-ups. Add screenshots, reports or timelines under **Postmortem Attachments**.",
    );
  });

  it("starts Publish on Status Page off on the Status Page step", () => {
    const publish: string = fieldObject(
      POSTMORTEM_FORM,
      "Publish on Status Page",
    );

    expect(publish).toContain('stepId: "status-page",');
    expect(publish).toContain("defaultValue: false,");
    expect(writing).toContain(
      "Click **Next**. On the **Status Page** step, **Publish on Status Page** starts off, so the postmortem stays with your team.",
    );
  });

  it("moves a postmortem not started to Draft once its note is saved", () => {
    const statuses: Array<Record<string, unknown>> = defaultStatusRows();

    expect(
      (
        PostmortemStatusUtil.getAutomaticMove({
          statuses: statuses,
          stored: { postmortemNote: "", showPostmortemOnStatusPage: false },
          written: { postmortemNote: "## What happened" },
          statusIdBefore: "status-1",
        }) as Record<string, unknown> | null
      )?.["name"],
    ).toBe("Draft");
    expect(writing).toContain(
      "Click **Save Changes**. The card shows the note and the attachments. The postmortem's status moves from **Not Started** to **Draft**: see [How a postmortem moves](#how-a-postmortem-moves).",
    );
  });

  it("records every change to the note in the incident's feed and its chat channel", () => {
    const feed: string = between(
      INCIDENT_SERVICE,
      "if (IncidentPostmortemPublication.isNoteChanged(comparison)) {",
      "const action: PostmortemNotificationAction =",
    );

    expect(feed).toContain(
      "incidentFeedEventType: IncidentFeedEventType.PostmortemNote,",
    );
    expect(feed).toContain("sendWorkspaceNotification: true,");
    expect(postmortems).toContain(
      "Every change to the note is recorded in the incident's feed, and posted to the incident's Slack or Microsoft Teams channel when it has one. While the postmortem is not published, no status page subscriber hears about it.",
    );
  });

  it("is written by the roles that edit incidents, and read by whoever reads the incident", () => {
    const incident: Incident = new Incident();
    const access: ColumnAccessControl | null =
      incident.getColumnAccessControlFor("postmortemNote");
    const roles: Array<string> = rolesOf(access?.update || []);

    expect(roles).toEqual([
      "Project Owner",
      "Project Admin",
      "Project Member",
      "Incident Admin",
      "Incident Member",
    ]);
    expect(customPermissionsOf(access?.update || [])).toEqual([
      "Edit Incident",
    ]);
    expect([...(access?.read || [])].sort()).toEqual(
      [...incident.getReadPermissions()].sort(),
    );
    expect(postmortems).toContain(
      `Writing a postmortem takes the ${listedPlainly(roles, "or")} role, or a custom role with the Edit Incident permission. Anyone who can read the incident can read its postmortem.`,
    );
  });
});

describe("starting a postmortem from a template or an AI draft", () => {
  const postmortems: string = english(POSTMORTEMS);
  const starting: string = section(
    postmortems,
    "## Start from a template or an AI draft",
  );

  it("offers Start from Template and Generate with AI beside Write Postmortem, and Apply Template and Generate with AI in the ⋯ once written", () => {
    expect(POSTMORTEM_PAGE).toContain(
      "const hasTemplates: boolean = postmortemTemplates.templates.length > 0;",
    );
    // Nothing written: beside Write Postmortem.
    expectLabelDeclared(
      POSTMORTEM_EMPTY_STATE,
      "START_FROM_TEMPLATE",
      "Start from Template",
    );
    expectLabelDeclared(
      POSTMORTEM_EMPTY_STATE,
      "GENERATE_WITH_AI",
      "Generate with AI",
    );
    /*
     * Beside it for someone who may write the postmortem: a viewer, who may
     * not, finds Write Postmortem alone, locked, with why under it.
     */
    expect(POSTMORTEM_EMPTY_STATE).toContain(
      "if (!isLocked && props.hasTemplates) {\n    actions.push({\n      title: START_FROM_TEMPLATE,",
    );
    expect(POSTMORTEM_EMPTY_STATE).toContain(
      "if (!isLocked && props.isAiOffered) {\n    actions.push({\n      title: GENERATE_WITH_AI,",
    );
    // Written: the ⋯ beside Edit Postmortem Note.
    expect(POSTMORTEM_PAGE).toContain(
      "buttons:\n            hasNote &&\n            hasPostmortemMoreMenuItems({",
    );
    expectLabelDeclared(
      POSTMORTEM_MORE_MENU,
      "APPLY_TEMPLATE",
      "Apply Template",
    );
    expect(POSTMORTEM_MORE_MENU).toContain("text={APPLY_TEMPLATE}");
    expect(POSTMORTEM_MORE_MENU).toContain("text={GENERATE_WITH_AI}");
    expect(POSTMORTEM_MORE_MENU).toContain("<CardMoreMenu");
    expect(starting).toContain(
      "Two buttons fill the note in for you. While nothing is written, they are beside **Write Postmortem**: **Start from Template**, once the project has a postmortem template, and **Generate with AI**. Once the postmortem is written, they are in the **⋯** menu beside **Edit Postmortem Note**, as **Apply Template** and **Generate with AI**.",
    );
  });

  it("opens the same editor with the note filled in and the rest as it was, saving nothing yet", () => {
    const draftEditor: string = between(
      POSTMORTEM_PAGE,
      "{draftNote !== null ? (",
      "</>",
    );

    expect(draftEditor).toContain('title="Edit Postmortem Note"');
    expect(draftEditor).toContain('submitButtonText="Save Changes"');
    expect(draftEditor).toContain("fields: INCIDENT_POSTMORTEM_FORM_FIELDS,");
    expect(draftEditor).toContain(
      "draftValues: {\n              postmortemNote: draftNote,\n            },",
    );
    expect(starting).toContain(
      "Both open the same editor, with the note filled in and the rest of the postmortem as it was. Nothing is saved until you click **Save Changes**, so read the note and change it first.",
    );
  });

  it("makes templates under Incidents → Settings → Postmortem Templates, on the Growth plan", () => {
    const incidents: Array<MenuSection> = menuSections(INCIDENTS_MENU);
    const template: IncidentPostmortemTemplate =
      new IncidentPostmortemTemplate();

    expect(sectionByTitle(incidents, "Settings").items).toContain(
      "Postmortem Templates",
    );
    expect(template.getCreateBillingPlan()).toBe(PlanType.Growth);
    expect(starting).toContain(
      `You make them under **Incidents → Settings → Postmortem Templates**: see [Postmortem templates](/docs/incidents/settings#postmortem-templates). On OneUptime Cloud, templates need the ${PlanType.Growth} plan.`,
    );
  });

  it("applies a template from the Apply Postmortem Template dialog, one template picked already", () => {
    expect(POSTMORTEM_TEMPLATE_MODAL).toContain(
      'title="Apply Postmortem Template"',
    );
    expect(POSTMORTEM_TEMPLATE_MODAL).toContain(
      'submitButtonText="Apply Template"',
    );
    expect(POSTMORTEM_TEMPLATE_MODAL).toContain('title: "Select Template",');
    const initialValues: string = between(
      POSTMORTEM_TEMPLATES_MODULE,
      "export function getPostmortemTemplatePickerInitialValues(",
      "\n}\n",
    );

    expect(initialValues).toContain(
      "if (templates.length !== 1) {\n    return {};\n  }",
    );
    expect(initialValues).toContain(
      "[POSTMORTEM_TEMPLATE_PICKER_FIELD]: templates[0]!.id,",
    );
    expect(POSTMORTEM_TEMPLATE_MODAL).toContain(
      "initialValues: getPostmortemTemplatePickerInitialValues(",
    );
    // Start from Template and Apply Template open the same picker.
    expect(POSTMORTEM_PAGE).toContain(
      "onApplyTemplate={() => {\n                      setShowTemplateModal(true);",
    );
    expect(starting).toContain(
      "Click **Start from Template**, or **Apply Template** in the **⋯** menu, pick one under **Select Template** in the **Apply Postmortem Template** dialog, and click **Apply Template**. A project with one template has it picked already.",
    );
  });

  it("offers the three built-in outlines first, then the project's templates, each editable before it generates", () => {
    expect(
      POSTMORTEM_TEMPLATES.slice(0, BUILT_IN_POSTMORTEM_OUTLINES.length).map(
        (template: { name: string }): string => {
          return template.name;
        },
      ),
    ).toEqual([...BUILT_IN_POSTMORTEM_OUTLINES]);
    expect(POSTMORTEM_PAGE).toContain('title="Generate Postmortem with AI"');
    expect(POSTMORTEM_PAGE).toContain(
      "templates={[\n            ...POSTMORTEM_TEMPLATES,\n            ...toAITemplates(postmortemTemplates.templates),\n          ]}",
    );
    expect(GENERATE_FROM_AI_MODAL).toContain(
      'translator.translateText("Select Template")',
    );
    expect(GENERATE_FROM_AI_MODAL).toContain(
      'translator.translateText("Template Preview")',
    );
    expect(GENERATE_FROM_AI_MODAL).toContain("<MarkdownEditor");
    expect(GENERATE_FROM_AI_MODAL).toContain('"Generate with AI"');
    expect(starting).toContain(
      `The **Generate Postmortem with AI** dialog offers an outline under **Select Template**: ${BUILT_IN_POSTMORTEM_OUTLINES.slice(
        0,
        -1,
      )
        .map((name: string): string => {
          return `**${name}**`;
        })
        .join(
          ", ",
        )} or **${BUILT_IN_POSTMORTEM_OUTLINES[BUILT_IN_POSTMORTEM_OUTLINES.length - 1]}**, then your own postmortem templates. **Template Preview** shows the outline, and you can change it before you generate.`,
    );
  });

  it("writes from the incident: its description, root cause, remediation, timeline, notes, chat messages and calls", () => {
    expect(INCIDENT_AI_CONTEXT).toContain(
      "export interface IncidentContextData {\n  incident: Incident;\n  stateTimeline: Array<IncidentStateTimeline>;\n  internalNotes: Array<IncidentInternalNote>;\n  publicNotes: Array<IncidentPublicNote>;\n  workspaceMessages: Array<WorkspaceChannelMessage>;\n",
    );
    // What was said on its calls (issue #4875), which the draft asks for.
    expect(INCIDENT_AI_CONTEXT).toContain(
      "  calls?: Array<IncidentCallForPrompt> | undefined;\n}",
    );

    for (const column of [
      "description: true,",
      "rootCause: true,",
      "remediationNotes: true,",
    ]) {
      expect(INCIDENT_AI_CONTEXT).toContain(column);
    }

    expect(INCIDENT_API).toContain(
      "const includeWorkspaceMessages: boolean = true;",
    );
    expect(
      between(
        INCIDENT_API,
        "private async generatePostmortemFromAI(",
        "private async generateNoteFromAI(",
      ),
    ).toContain("includeCalls: true,");
    expect(starting).toContain(
      "OneUptime AI reads the incident (its description, root cause and remediation, its state timeline, its public and private notes, the messages in its Slack or Microsoft Teams channel, and what was said on [its calls](/docs/workspace-connections/video-calls#call-transcripts)) and writes the postmortem in your outline. The editor then opens on it.",
    );
  });

  it("generates only with AI on for the project, and only for the Project Owner, Project Admin or Edit Incident", () => {
    const generate: string = between(
      INCIDENT_API,
      "private async generatePostmortemFromAI(",
      "private async generateNoteFromAI(",
    );

    expect(generate).toContain(
      "CallerPermission.holdsAnyOf(props, [\n      Permission.ProjectOwner,\n      Permission.ProjectAdmin,\n      Permission.EditProjectIncident,\n    ]);",
    );
    expect(generate).toContain(
      "await AIService.assertProjectAIEnabled(incident.projectId);",
    );
    expect(PermissionHelper.getTitle(Permission.EditProjectIncident)).toBe(
      "Edit Incident",
    );
    expect(sectionByTitle(menuSections(SETTINGS_MENU), "AI").items).toContain(
      "AI Features",
    );
    expect(starting).toContain(
      "Generating needs AI turned on for the project, under **Project Settings → AI → AI Features**, and an LLM provider: see [LLM Providers](/docs/ai/llm-provider). It also takes the Project Owner or Project Admin role, or a custom role with the Edit Incident permission: other roles can write the postmortem, but not generate it.",
    );
  });

  it("lets OneUptime AI draft one when an incident resolves, a switch new projects start with on", () => {
    const draftSwitch: { column: string; title: string } | undefined =
      AI_LANE_SWITCHES[AiLane.Incident].find(
        (definition: { column: string }): boolean => {
          return definition.column === "enableAutomaticPostmortemDraft";
        },
      );

    expect(draftSwitch?.title).toBe(
      "Draft a postmortem when an incident resolves",
    );
    expect(
      between(
        PROJECT_SERVICE,
        "export const NEW_PROJECT_AI_DEFAULT_COLUMNS",
        "];",
      ),
    ).toContain('"enableAutomaticPostmortemDraft",');
    expect(sectionByTitle(menuSections(INCIDENTS_MENU), "AI").items).toContain(
      "Settings",
    );
    expect(INCIDENT_STATE_TIMELINE_SERVICE).toContain(
      "AIIncidentPostmortemRunner.draftPostmortemOnResolve({",
    );
    expect(starting).toContain(
      `With **${draftSwitch?.title}** on, OneUptime AI drafts the postmortem each time an incident is resolved, saves it as the note, and posts it to the incident's feed for your team to review. The switch is on **Incidents → AI → Settings**, and it is on for new projects.`,
    );
  });

  it("never replaces a written note, never drafts into a published postmortem, and keeps to the AI switch and daily limits", () => {
    const draft: string = between(
      POSTMORTEM_RUNNER,
      "public static async draftPostmortemOnResolve(",
      "\n  }\n}",
    );
    const enabled: string = between(
      POSTMORTEM_RUNNER,
      "public static async isEnabledForProject(",
      "\n  }\n",
    );

    expect(draft).toContain(
      "if (incident.postmortemNote && incident.postmortemNote.trim().length > 0) {",
    );
    expect(draft).toContain(
      "if (incident.showPostmortemOnStatusPage === true) {",
    );
    // Both the draft on resolve and the draft that waited for its calls check it.
    expect(
      draft.split("!AIIncidentPostmortemRunner.isDraftable(incident)"),
    ).toHaveLength(3);
    expect(draft).toContain("postmortemNote: draft,");
    expect(draft).toContain(
      "incidentFeedEventType: IncidentFeedEventType.PostmortemNote,",
    );
    // The two switches, asked first: AI on, and drafting on.
    const drafting: string = between(
      POSTMORTEM_RUNNER,
      "private static isDraftingOn(",
      "\n  }\n",
    );

    expect(enabled).toContain(
      "if (!AIIncidentPostmortemRunner.isDraftingOn(project)) {",
    );
    expect(drafting).toContain("project.enableAi !== false &&");
    expect(drafting).toContain(
      "project.enableAutomaticPostmortemDraft === true",
    );
    // The daily limits, for the provider the draft would use.
    expect(enabled).toMatch(
      /await AIService\.getReachedProjectDailyLimit\(\{\s*projectId,\s*project,/,
    );
    expect(starting).toContain(
      "- It never replaces a note that is already written.",
    );
    expect(starting).toContain(
      "- It never writes into a postmortem that is already published, where the draft would reach the status page unreviewed.",
    );
    expect(starting).toContain(
      "- It needs AI turned on for the project, and stops for the day once the project reaches its daily AI limits.",
    );
  });

  it("waits for the transcript of the incident's call, as long as the rule it is held to says", () => {
    const draft: string = between(
      POSTMORTEM_RUNNER,
      "public static async draftPostmortemOnResolve(",
      "\n  }\n}",
    );

    expect(draft).toContain("await IncidentPostmortemCallWait.isWaiting({");
    expect(draft).toContain("await IncidentService.startPostmortemDraftWait({");
    expect(
      POSTMORTEM_WAITS_FOR_PREPARING_TRANSCRIPT_MS / (60 * 60 * 1000),
    ).toBe(6);
    expect(starting).toContain(
      "- When the transcript of the incident's call is still on its way as the incident resolves, it waits for OneUptime AI to read it, so the draft reads what was said on the call: up to six hours while the provider prepares the transcript. See [Record and transcribe every call](/docs/workspace-connections/video-calls#record-and-transcribe-every-call).",
    );
  });
});

/*
 * Postmortem rules: which resolved incidents OneUptime AI drafts a
 * postmortem for, and the templates the draft may follow - "rules for these
 * just like we have investigation rules in more options", the maintainer
 * asked. The page says what the rules page, the planner
 * (Common/Server/Utils/AI/SRE/PostmortemRules) and the template pick do.
 */
describe("which resolved incidents get a draft, and the template it follows", () => {
  const postmortems: string = english(POSTMORTEMS);
  const rules: string = section(
    postmortems,
    "#### Choose which incidents get a draft, and its template",
  );
  const cardTitle: string =
    AI_LANE_ADVANCED_CARD_TITLES[AiLane.Incident][
      AiLaneAdvancedCard.PostmortemRules
    ];

  it("sits under More settings on the incident AI settings page, by the title the page gives it", () => {
    expect(cardTitle).toBe("Postmortem rules");
    expect(MORE_SETTINGS_SECTION_TITLE).toBe("More settings");
    expect(AI_LANE_ADVANCED_CARDS[AiLane.Incident]).toContain(
      AiLaneAdvancedCard.PostmortemRules,
    );
    // An alert has no postmortem, so the alerts' page has no such rules.
    expect(AI_LANE_ADVANCED_CARDS[AiLane.Alert]).not.toContain(
      AiLaneAdvancedCard.PostmortemRules,
    );
    expect(INCIDENT_AI_SETTINGS_PAGE).toContain("<AIPostmortemRulesTable");
    expect(rules).toContain(
      `With no rule, every resolved incident gets a draft, in OneUptime AI's standard outline. **${cardTitle}**, under **${MORE_SETTINGS_SECTION_TITLE}** on the same page, change that:`,
    );
    expect(POSTMORTEM_RULES_PLAN).toContain(
      "if (rules.length === 0) {\n      return POSTMORTEM_DRAFT_PLAN_WITHOUT_RULES;\n    }",
    );
  });

  it("matches as an AI rule does, with the conditions builder's two answers", () => {
    const subject: RuleCriteriaSubject | null =
      getRuleCriteriaSubjectForModel("AIPostmortemRule");
    const fields: ReadonlyArray<string> =
      RULE_CRITERIA_FIELDS_BY_MODEL["AIPostmortemRule"] || [];

    expect(subject).toBe(RuleCriteriaSubject.Incidents);
    expect([...fields]).toEqual([
      "monitors",
      "incidentSeverities",
      "labels",
      "monitorLabels",
      "titlePattern",
      "descriptionPattern",
    ]);

    /*
     * An AI rule's incident fields, every one of them (the AI rules hold
     * the investigation rules now).
     */
    for (const field of fields) {
      expect(RULE_CRITERIA_FIELDS_BY_MODEL["AutoRemediationRule"]).toContain(
        field,
      );
    }
    expect(
      RULE_CRITERIA_FIELDS_BY_MODEL["AIInvestigationRule"],
    ).toBeUndefined();

    expect(POSTMORTEM_RULES_PLAN).toContain(
      "await IncidentAlertRuleMatcher.doesIncidentMatch(",
    );
    expect(rules).toContain(
      `- A rule matches **${RULE_CRITERIA_SUBJECT_COPY[RuleCriteriaSubject.Incidents].all}**, or **${RULE_CRITERIA_SUBJECT_COPY[RuleCriteriaSubject.Incidents].matching}** on monitors, severities, labels, monitor labels, title and description, as an AI rule does.`,
    );
  });

  it("follows the rule's templates: the standard outline with none, that one with one, the best fit of several, named in the feed", () => {
    expect(POSTMORTEM_RULE_TEMPLATES_TITLE).toBe("Templates");
    expect(POSTMORTEM_TEMPLATE_PICK).toContain(
      "if (templates.length === 0) {\n      return null;\n    }",
    );
    expect(POSTMORTEM_TEMPLATE_PICK).toContain(
      "if (templates.length === 1) {\n      return templates[0]!;\n    }",
    );
    expect(POSTMORTEM_TEMPLATE_PICK).toContain(
      "Answer with the number of the template that fits this incident best",
    );
    expect(POSTMORTEM_RUNNER).toContain(
      "mdText`, following the postmortem template **${template.name",
    );
    expect(rules).toContain(
      `- Its **${POSTMORTEM_RULE_TEMPLATES_TITLE}** are the postmortem templates the draft may follow. With none, the draft follows the standard outline; with one, that template; with several, the one OneUptime AI finds fits the incident best. The draft's post in the feed names the template it followed.`,
    );
  });

  it("lets the first enabled rule that matches decide, from the top, and drafts nothing when none does or the rules cannot be read", () => {
    expect(POSTMORTEM_RULES_PLAN).toContain("isEnabled: true,");
    expect(POSTMORTEM_RULES_PLAN).toContain(
      "sort: {\n            order: SortOrder.Ascending,",
    );
    expect(POSTMORTEM_RULES_PLAN).toContain(
      "return {\n      isInScope: false,",
    );
    expect(POSTMORTEM_RULES_PLAN).toContain(
      "if (rules === null) {\n      return null;\n    }",
    );
    expect(rules).toContain(
      "- The first enabled rule that matches the incident decides, from the top of the list: drag a rule to change its place. An incident that no rule matches gets no draft, and so does every incident while the rules cannot be read.",
    );
  });

  it("leaves the switch the one way to stop drafts, and Generate with AI every outline", () => {
    const generate: string = between(
      INCIDENT_API,
      "private async generatePostmortemFromAI(",
      "private async generateNoteFromAI(",
    );

    expect(generate).not.toContain("PostmortemRules");
    expect(POSTMORTEM_PAGE).not.toContain("AIPostmortemRule");
    expect(rules).toContain(
      "- **Draft a postmortem when an incident resolves** stays the one switch that turns drafts off. Rules decide only the drafts OneUptime AI writes on its own: **Generate with AI** offers every outline, whatever they say.",
    );
  });

  it("takes the Project Owner or Project Admin role, and on OneUptime Cloud the Growth plan for templates", () => {
    const rule: AIPostmortemRule = new AIPostmortemRule();

    for (const permissions of [
      rule.getCreatePermissions(),
      rule.getUpdatePermissions(),
      rule.getDeletePermissions(),
    ]) {
      expect(rolesOf(permissions)).toEqual(["Project Owner", "Project Admin"]);
      expect(customPermissionsOf(permissions)).toEqual([]);
    }

    expect(new IncidentPostmortemTemplate().getReadBillingPlan()).toBe(
      PlanType.Growth,
    );
    // Below the plan, a rule's templates are not followed.
    expect(POSTMORTEM_RULES_PLAN).toContain(
      "if (!(await this.isTemplatePlanMet(data.projectId))) {",
    );
    expect(rules).toContain(
      `- Creating, editing and reordering rules takes the ${listedPlainly(rolesOf(rule.getCreatePermissions()), "or")} role. On OneUptime Cloud, templates need the ${PlanType.Growth} plan: below it, rules still decide which incidents get a draft, and every draft follows the standard outline.`,
    );
  });

  it("is a reason the troubleshooting gives when no draft appeared", () => {
    expect(postmortems).toContain(
      "The incident already had a note, the postmortem was already published, no postmortem rule matched it, or **Draft a postmortem when an incident resolves** is off.",
    );
  });
});

describe("publishing a postmortem on the status page", () => {
  const postmortems: string = english(POSTMORTEMS);
  const publishing: string = section(
    postmortems,
    "## Publish it on your status page",
  );

  it("shows the note highlighted in the incident's timeline, with its attachments to download", () => {
    const item: string = between(
      STATUS_PAGE_INCIDENT_PAGE,
      "IncidentPostmortemPublication.isPublished(incident)",
      "timeline.sort(",
    );

    expect(item).toContain("highlight: true,");
    expect(item).toContain("downloadUrl: downloadRoute.toString(),");
    expect(item).toContain("incident.postmortemPostedAt ||");
    expect(publishing).toContain(
      "A published postmortem is the incident's closing update for your customers: the status page shows the note, highlighted in the incident's timeline, with its attachments to download.",
    );
  });

  it("asks Notify Subscribers, on, and Published At, now, once Publish on Status Page is on", () => {
    const notify: string = fieldObject(POSTMORTEM_FORM, "Notify Subscribers");
    const postedAt: string = fieldObject(
      POSTMORTEM_FORM,
      "Postmortem Published At",
    );
    const onPublishing: string = between(
      POSTMORTEM_FORM,
      "export function getPostmortemValuesWhenPublishingChanges(",
      "\n}\n",
    );

    expect(notify).toContain("defaultValue: true,");
    expect(notify).toContain("showIf: isPublishing,");
    expect(postedAt).toContain("showIf: isPublishing,");
    expect(onPublishing).toContain('current["postmortemPostedAt"] = now;');
    expect(publishing).toContain(
      "Turn on **Publish on Status Page**. Two more fields appear: **Notify Subscribers**, which is on, and **Postmortem Published At**, which is now.",
    );
    expect(publishing).toContain(
      "Change **Postmortem Published At** to show another time beside the postmortem.",
    );
  });

  it("shows on the card whether it is visible, whether subscribers are told, how that went and when it was published", () => {
    const titles: Array<string> = [
      "Postmortem visible on Status Page?",
      "Notify Subscribers",
      "Subscriber Notification Status",
      "Postmortem Published At",
    ];
    const positions: Array<number> = titles.map((title: string): number => {
      return POSTMORTEM_PAGE.indexOf(`title: "${title}",`);
    });

    // Every field is on the card, in the order the page names them.
    expect(
      positions.every((at: number): boolean => {
        return at > 0;
      }),
    ).toBe(true);
    expect(
      [...positions].sort((a: number, b: number): number => {
        return a - b;
      }),
    ).toEqual(positions);

    const cardLine: string =
      publishing.split("\n").find((line: string): boolean => {
        return line.startsWith("Click **Save Changes**. The card now shows");
      }) || "";

    expect(boldNames(cardLine)).toEqual(["Save Changes", ...titles]);
    expect(publishing).toContain(
      "Click **Save Changes**. The card now shows **Postmortem visible on Status Page?**, **Notify Subscribers**, **Subscriber Notification Status** and **Postmortem Published At**.",
    );
  });

  it("is shown only on an incident the status page shows, with a note that says something", () => {
    expect(
      IncidentPostmortemPublication.isIncidentShown({
        isVisibleOnStatusPage: true,
        isPrivate: false,
      }),
    ).toBe(true);
    expect(
      IncidentPostmortemPublication.isIncidentShown({
        isVisibleOnStatusPage: true,
        isPrivate: true,
      }),
    ).toBe(false);
    expect(
      IncidentPostmortemPublication.isIncidentShown({
        isVisibleOnStatusPage: false,
        isPrivate: false,
      }),
    ).toBe(false);
    expect(
      IncidentPostmortemPublication.isPublished({
        showPostmortemOnStatusPage: true,
        postmortemNote: "  \n ",
      }),
    ).toBe(false);
    expect(readDashboardSource("Pages/Incidents/View/Settings.tsx")).toContain(
      'title: "Visible on Status Page",',
    );
    expect(publishing).toContain(
      "- **The incident must be on the status page.** A status page shows a postmortem only on an incident it shows: **Visible on Status Page** on, and the incident not private.",
    );
    expect(publishing).toContain(
      "- **The note must say something.** A postmortem published with an empty note is not shown, and nobody is told.",
    );
  });

  it("tells subscribers once: the first publish, again after being taken off, and not on a save or an edit", () => {
    const published: {
      showPostmortemOnStatusPage: boolean;
      postmortemNote: string;
      subscriberNotificationStatusOnPostmortemPublished: StatusPageSubscriberNotificationStatus;
    } = {
      showPostmortemOnStatusPage: true,
      postmortemNote: "What happened",
      subscriberNotificationStatusOnPostmortemPublished:
        StatusPageSubscriberNotificationStatus.Success,
    };

    // The first publish.
    expect(
      IncidentPostmortemPublication.getNotificationAction({
        stored: {
          showPostmortemOnStatusPage: false,
          postmortemNote: "What happened",
        },
        written: { showPostmortemOnStatusPage: true },
      }),
    ).toBe(PostmortemNotificationAction.Queue);
    // Saving it again, and editing it while it is published.
    expect(
      IncidentPostmortemPublication.getNotificationAction({
        stored: published,
        written: {
          showPostmortemOnStatusPage: true,
          postmortemNote: "What happened",
        },
      }),
    ).toBe(PostmortemNotificationAction.None);
    expect(
      IncidentPostmortemPublication.getNotificationAction({
        stored: published,
        written: { postmortemNote: "What happened, and why" },
      }),
    ).toBe(PostmortemNotificationAction.None);
    // Taken off, then published again.
    expect(
      IncidentPostmortemPublication.getNotificationAction({
        stored: { ...published, showPostmortemOnStatusPage: false },
        written: { showPostmortemOnStatusPage: true },
      }),
    ).toBe(PostmortemNotificationAction.Queue);
    expect(publishing).toContain(
      "- **Subscribers are told once**, the first time the status page shows the postmortem. Saving it again, or editing it while it is published, updates the page and tells nobody. Taking it off and publishing it again tells them again.",
    );
  });

  it("sends one published while its incident was hidden once the incident is made visible", () => {
    expect(
      IncidentPostmortemPublication.getNotificationAction({
        stored: {
          showPostmortemOnStatusPage: true,
          postmortemNote: "What happened",
          isVisibleOnStatusPage: false,
          isPrivate: false,
          subscriberNotificationStatusOnPostmortemPublished:
            StatusPageSubscriberNotificationStatus.Skipped,
          subscriberNotificationStatusMessageOnPostmortemPublished:
            IncidentPostmortemPublication.hiddenIncidentMessage,
        },
        written: { isVisibleOnStatusPage: true },
      }),
    ).toBe(PostmortemNotificationAction.QueueIfSkippedAsHidden);
    expect(publishing).toContain(
      "One published while its incident is hidden is sent when the incident is made visible.",
    );
  });

  it("reads Notify Subscribers when the notification goes out, so turning it on later sends nothing", () => {
    expect(POSTMORTEM_NOTIFICATION_JOB).toContain(
      "if (!incident.notifySubscribersOnPostmortemPublished) {",
    );
    expect(
      IncidentPostmortemPublication.getNotificationAction({
        stored: {
          showPostmortemOnStatusPage: true,
          postmortemNote: "What happened",
          subscriberNotificationStatusOnPostmortemPublished:
            StatusPageSubscriberNotificationStatus.Skipped,
        },
        written: { notifySubscribersOnPostmortemPublished: true },
      }),
    ).toBe(PostmortemNotificationAction.None);
    expect(publishing).toContain(
      "- **Notify Subscribers is read when the notification goes out.** Turning it on after the postmortem was published sends nothing.",
    );
  });

  it("shows how the notification went, with Retry after a failure", () => {
    expect(SubscriberNotificationResendCopy.retryButton).toBe("Retry");
    expect(POSTMORTEM_PAGE).toContain(
      "subscriberNotificationStatusOnPostmortemPublished:\n              StatusPageSubscriberNotificationStatus.Pending,",
    );
    expect(publishing).toContain(
      `**Subscriber Notification Status** shows whether the notification went out, and offers **${SubscriberNotificationResendCopy.retryButton}** when it failed.`,
    );
  });

  it("counts as published at Published At for the Time to postmortem measurement", () => {
    const preset: MeasurementPreset | undefined = getMeasurementPresets(
      MeasurementDomain.Incident,
    ).find((candidate: MeasurementPreset): boolean => {
      return candidate.id === "time-to-postmortem";
    });

    expect(preset?.name).toBe("Time to postmortem");
    expect(preset?.endMoment).toBe(
      IncidentMeasurementAnchorType.PostmortemPostedAt,
    );
    expect(postmortems).toContain(
      `**Postmortem Published At** is also when the postmortem counts as published for the **${preset?.name}** measurement: see [Ready-made measurements](/docs/incidents/settings#ready-made-measurements).`,
    );
  });
});

describe("postmortems of episodes", () => {
  const postmortems: string = english(POSTMORTEMS);
  const episodes: string = section(postmortems, "## Postmortems of episodes");

  it("are an episode's Postmortem page, under Investigation, edited with Edit Postmortem", () => {
    const investigation: string = between(
      EPISODE_MENU,
      '<SideMenuSection title="Investigation">',
      "</SideMenuSection>",
    );

    expect(investigation).toContain('title: "Postmortem",');
    expect(EPISODE_POSTMORTEM_PAGE).toContain(
      'editButtonText="Edit Postmortem"',
    );
    expect(EPISODE_POSTMORTEM_PAGE).toContain("getPostmortemCardButtons({");
    expect(EPISODE_POSTMORTEM_PAGE).toContain("...POSTMORTEM_TEMPLATES,");
    expect(episodes).toContain(
      "An incident episode has a **Postmortem** page too, under **Investigation**: one write-up for every incident in the episode. Click **Edit Postmortem** to write it.",
    );
  });

  it("are written by the AI from the episode and its member incidents", () => {
    expect(EPISODE_AI_CONTEXT).toContain(
      "memberIncidents: Array<IncidentEpisodeMember>;",
    );
    expect(EPISODE_API).toContain(
      "IncidentEpisodeAIContextBuilder.formatEpisodeContextForPostmortem(",
    );
    expect(episodes).toContain(
      "**Apply Template** and **Generate with AI** work as on an incident, and the AI reads the episode and its member incidents.",
    );
  });

  it("are the note alone, never on a status page, never drafted on their own", () => {
    const columns: Array<string> = new IncidentEpisode().getTableColumns()
      .columns;

    expect(columns).toContain("postmortemNote");
    expect(columns).not.toContain("postmortemAttachments");
    expect(columns).not.toContain("showPostmortemOnStatusPage");
    expect(EPISODE_STATE_TIMELINE_SERVICE).not.toContain("PostmortemRunner");
    expect(episodes).toContain(
      "An episode's postmortem is the note alone: it has no attachments, and no status page shows it. OneUptime AI does not draft one on its own when an episode resolves.",
    );
  });

  it("are generated only by the Project Owner, Project Admin or Edit Incident Episode", () => {
    expect(EPISODE_API).toContain(
      "CallerPermission.holdsAnyOf(props, [\n      Permission.ProjectOwner,\n      Permission.ProjectAdmin,\n      Permission.EditIncidentEpisode,\n    ]);",
    );
    expect(PermissionHelper.getTitle(Permission.EditIncidentEpisode)).toBe(
      "Edit Incident Episode",
    );
    expect(episodes).toContain(
      "Generating one takes the Project Owner or Project Admin role, or a custom role with the Edit Incident Episode permission.",
    );
  });

  it("leave alerts and scheduled maintenance events with no postmortem", () => {
    expect(new Alert().getTableColumns().columns).not.toContain(
      "postmortemNote",
    );
    expect(new ScheduledMaintenance().getTableColumns().columns).not.toContain(
      "postmortemNote",
    );
    expect(episodes).toContain(
      "Alerts and scheduled maintenance events have no postmortem.",
    );
  });
});

describe("a postmortem through the API", () => {
  const postmortems: string = english(POSTMORTEMS);
  const api: string = section(postmortems, "## Through the API");
  const incident: Incident = new Incident();

  it("is fields of the incident, read and written through /api/incident", () => {
    expect(incident.crudApiPath?.toString()).toBe("/incident");
    expect(
      firstColumn(api).map((cell: string): string => {
        return cell.replace(/`/g, "");
      }),
    ).toEqual([
      "postmortemNote",
      "showPostmortemOnStatusPage",
      "notifySubscribersOnPostmortemPublished",
      "postmortemPostedAt",
      "postmortemStatusId",
    ]);

    for (const column of firstColumn(api)) {
      const name: string = column.replace(/`/g, "");

      expect({
        column: name,
        isColumn: incident.getTableColumns().columns.includes(name),
      }).toEqual({
        column: name,
        isColumn: true,
      });
    }

    expect(api).toContain(
      "A postmortem is a set of fields on the incident, read and written through `/api/incident` like the rest of it:",
    );
  });

  it("starts unpublished, with subscribers to be told", () => {
    expect(
      incident.getTableColumnMetadata("showPostmortemOnStatusPage")
        .defaultValue,
    ).toBe(false);
    expect(
      incident.getTableColumnMetadata("notifySubscribersOnPostmortemPublished")
        .defaultValue,
    ).toBe(true);
    expect(api).toContain(
      "| `showPostmortemOnStatusPage` | Whether the postmortem is published on your status pages. Starts `false`. |",
    );
    expect(api).toContain(
      "| `notifySubscribersOnPostmortemPublished` | Whether subscribers are told when it is published. Starts `true`. |",
    );
  });

  it("is published by writing the switch on over a written note, as the dialog does", () => {
    expect(
      IncidentPostmortemPublication.isPublishedByUpdate({
        stored: {
          showPostmortemOnStatusPage: false,
          postmortemNote: "What happened",
        },
        written: { showPostmortemOnStatusPage: true },
      }),
    ).toBe(true);
    expect(
      IncidentPostmortemPublication.isPublishedByUpdate({
        stored: { showPostmortemOnStatusPage: false, postmortemNote: "" },
        written: { showPostmortemOnStatusPage: true },
      }),
    ).toBe(false);
    expect(api).toContain(
      "Writing `showPostmortemOnStatusPage` as `true` over a written `postmortemNote` publishes the postmortem, as the dialog does.",
    );
  });

  it("names the postmortem's status, one of the project's statuses at /api/incident-postmortem-status, which publishing moves unless the write names one", () => {
    expect(incident.getTableColumnMetadata("postmortemStatus").modelType).toBe(
      IncidentPostmortemStatus,
    );
    expect(
      incident.getTableColumnMetadata("postmortemStatus")
        .manyToOneRelationColumn,
    ).toBe("postmortemStatusId");
    expect(new IncidentPostmortemStatus().crudApiPath?.toString()).toBe(
      "/incident-postmortem-status",
    );
    expect(api).toContain(
      "| `postmortemStatusId` | The postmortem's status: one of the project's statuses, at `/api/incident-postmortem-status`. |",
    );

    const statuses: Array<Record<string, unknown>> = defaultStatusRows();
    const publishing: {
      stored: { postmortemNote: string; showPostmortemOnStatusPage: boolean };
      statusIdBefore: string;
    } = {
      stored: {
        postmortemNote: "What happened",
        showPostmortemOnStatusPage: false,
      },
      statusIdBefore: "status-2",
    };

    expect(
      (
        PostmortemStatusUtil.getAutomaticMove({
          statuses: statuses,
          ...publishing,
          written: { showPostmortemOnStatusPage: true },
        }) as Record<string, unknown> | null
      )?.["name"],
    ).toBe("Completed");
    expect(
      PostmortemStatusUtil.getAutomaticMove({
        statuses: statuses,
        ...publishing,
        written: {
          showPostmortemOnStatusPage: true,
          postmortemStatusId: "status-2",
        },
      }),
    ).toBeNull();
    expect(api).toContain(
      "publishes the postmortem, as the dialog does. It moves the postmortem to **Completed** as well, unless the same write sets `postmortemStatusId`.",
    );
  });
});

describe("where each postmortem stands", () => {
  const postmortems: string = english(POSTMORTEMS);
  const standing: string = section(
    postmortems,
    "## Track where each postmortem stands",
  );
  const moving: string = section(postmortems, "### How a postmortem moves");
  const yourself: string = section(postmortems, "### Move it yourself");
  const ownStatuses: string = section(
    postmortems,
    "### Make the statuses your own",
  );
  const statuses: Array<Record<string, unknown>> = defaultStatusRows();

  function progressOf(name: string): PostmortemProgress | null {
    const status: Record<string, unknown> | undefined = statuses.find(
      (candidate: Record<string, unknown>): boolean => {
        return candidate["name"] === name;
      },
    );

    return PostmortemStatusUtil.getProgress({
      statuses: statuses,
      statusId: status?.["_id"] as string,
    });
  }

  function nameOf(status: unknown): string | null {
    return status
      ? ((status as Record<string, unknown>)["name"] as string)
      : null;
  }

  it("is shown under Status at the top of the Postmortem card", () => {
    expect(POSTMORTEM_SUMMARY).toContain('<DetailFieldLabel title="Status" />');
    expect(POSTMORTEM_SUMMARY).toContain("<PostmortemStatusPicker");
    expect(standing).toContain(
      "Every incident's postmortem is in one of the project's postmortem statuses, shown under **Status** at the top of its **Postmortem** card.",
    );
  });

  it("lists a new project's four statuses, each with what it means and whether it is still owed", () => {
    expect(PROJECT_SERVICE).toContain(
      "this.addDefaultIncidentPostmortemStatuses(createdItem),",
    );
    expect(firstColumn(standing)).toEqual(
      DEFAULT_POSTMORTEM_STATUSES.map(
        (status: DefaultPostmortemStatus): string => {
          return `**${status.name}**`;
        },
      ),
    );

    for (const status of DEFAULT_POSTMORTEM_STATUSES) {
      const owed: boolean = progressOf(status.name) !== PostmortemProgress.Done;

      expect(standing).toContain(
        `| **${status.name}** | ${status.description} | ${owed ? "Yes" : "No"} |`,
      );
    }

    expect(standing).toContain(
      "A new project has four. A postmortem in **Not Started** or **Draft** is still owed; one in **Completed** or **Not Needed** is not:",
    );
  });

  it("starts by its fields, moves forward on its first note and on publishing, and never back or over a pick", () => {
    const starting: (postmortem: Record<string, unknown>) => string | null = (
      postmortem: Record<string, unknown>,
    ): string | null => {
      return nameOf(
        PostmortemStatusUtil.getStartingStatus({
          statuses: statuses,
          postmortem: postmortem,
        }),
      );
    };

    expect(starting({ postmortemNote: "" })).toBe("Not Started");
    expect(starting({ postmortemNote: "## What happened" })).toBe("Draft");
    expect(
      starting({
        postmortemNote: "## What happened",
        showPostmortemOnStatusPage: true,
      }),
    ).toBe("Completed");

    const move: (data: {
      before: string;
      stored: Record<string, unknown>;
      written: Record<string, unknown>;
    }) => string | null = (data: {
      before: string;
      stored: Record<string, unknown>;
      written: Record<string, unknown>;
    }): string | null => {
      const before: Record<string, unknown> | undefined = statuses.find(
        (status: Record<string, unknown>): boolean => {
          return status["name"] === data.before;
        },
      );

      return nameOf(
        PostmortemStatusUtil.getAutomaticMove({
          statuses: statuses,
          stored: data.stored,
          written: data.written,
          statusIdBefore: before?.["_id"] as string,
        }),
      );
    };

    // The first note: Not Started to Draft, and nothing else moves.
    expect(
      move({
        before: "Not Started",
        stored: { postmortemNote: "" },
        written: { postmortemNote: "## Impact" },
      }),
    ).toBe("Draft");
    expect(
      move({
        before: "Completed",
        stored: { postmortemNote: "" },
        written: { postmortemNote: "## Impact" },
      }),
    ).toBeNull();
    // Publishing: to Completed, unless done already.
    expect(
      move({
        before: "Draft",
        stored: { postmortemNote: "## Impact" },
        written: { showPostmortemOnStatusPage: true },
      }),
    ).toBe("Completed");
    expect(
      move({
        before: "Not Needed",
        stored: { postmortemNote: "## Impact" },
        written: { showPostmortemOnStatusPage: true },
      }),
    ).toBeNull();
    // Never back: clearing the note, taking it off the status page.
    expect(
      move({
        before: "Draft",
        stored: { postmortemNote: "## Impact" },
        written: { postmortemNote: "" },
      }),
    ).toBeNull();
    expect(
      move({
        before: "Completed",
        stored: {
          postmortemNote: "## Impact",
          showPostmortemOnStatusPage: true,
        },
        written: { showPostmortemOnStatusPage: false },
      }),
    ).toBeNull();
    // A status picked in the same save stands.
    expect(
      move({
        before: "Not Started",
        stored: { postmortemNote: "" },
        written: { postmortemNote: "## Impact", postmortemStatusId: "x" },
      }),
    ).toBeNull();

    for (const line of [
      "- A new incident's postmortem starts in **Not Started**, or in **Draft** when the incident is declared with a note, or in **Completed** when that note is published with it.",
      "- The first note of a postmortem in **Not Started** moves it to **Draft**, whether someone writes it, applies a template or OneUptime AI drafts it.",
      "- Publishing it on the status page moves it to **Completed**, unless it is done already.",
      "It never moves back: clearing the note, or taking the postmortem off the status page, leaves its status where it is. A status someone picks in the same save always stands.",
    ]) {
      expect(moving).toContain(line);
    }
  });

  it("moves from its status under Move postmortem to, by the roles that write it", () => {
    const incident: Incident = new Incident();

    expectLabelDeclared(
      POSTMORTEM_STATUS_PICKER,
      "POSTMORTEM_STATUS_MENU_TITLE",
      "Move postmortem to",
    );
    expect(POSTMORTEMS_TABLE).toContain("<PostmortemStatusPicker");
    expect(
      [
        ...(incident.getColumnAccessControlFor("postmortemStatusId")?.update ||
          []),
      ].sort(),
    ).toEqual(
      [
        ...(incident.getColumnAccessControlFor("postmortemNote")?.update || []),
      ].sort(),
    );
    expect(yourself).toContain(
      "Click the status, on the incident's **Postmortem** page or on its row of the postmortems list, and pick one under **Move postmortem to**. The postmortem moves at once. Moving a postmortem takes the roles that write one, and anyone who can read the incident sees where its postmortem stands.",
    );
  });

  it("is the project's own list under Incidents → Settings → Postmortem Statuses, a new status just above Completed", () => {
    const incidents: Array<MenuSection> = menuSections(INCIDENTS_MENU);
    const status: IncidentPostmortemStatus = new IncidentPostmortemStatus();

    expect(sectionByTitle(incidents, "Settings").items).toContain(
      "Postmortem Statuses",
    );
    expect(status.singularName).toBe("Postmortem Status");
    expect(
      STATE_SETTINGS_COPY[StateListType.IncidentPostmortemStatus]
        .namePlaceholder,
    ).toBe("In Review");
    expect(
      STATE_LISTS[StateListType.IncidentPostmortemStatus].insertAboveFlag,
    ).toBe("isCompletedStatus");
    expect(ownStatuses).toContain(
      "Open **Incidents → Settings → Postmortem Statuses**, click **Create Postmortem Status**, and give it a name, such as **In Review**, a color and a description. A new status goes just above **Completed**; drag a status to change where it sits.",
    );
  });

  it("counts a status by where it sits, as Counts as shows it", () => {
    const countsAs: StateSettingsCountsAsCopy | undefined =
      STATE_SETTINGS_COPY[StateListType.IncidentPostmortemStatus].countsAs;

    expect(countsAs?.title).toBe("Counts as");
    expect(countsAs?.aboveAll).toBe("Not started");
    expect(countsAs?.byBuiltIn).toEqual({
      isNotStartedStatus: "Not started",
      isDraftStatus: "In progress",
      isCompletedStatus: "Done",
    });

    // A project's own In Review, between Draft and Completed, is still owed.
    const withReview: Array<Record<string, unknown>> = [
      ...statuses.slice(0, 2),
      { _id: "status-review", name: "In Review", order: 3 },
      ...statuses
        .slice(2)
        .map((row: Record<string, unknown>): Record<string, unknown> => {
          return { ...row, order: (row["order"] as number) + 1 };
        }),
    ];

    expect(
      PostmortemStatusUtil.getProgress({
        statuses: withReview,
        statusId: "status-review",
      }),
    ).toBe(PostmortemProgress.InProgress);
    expect(ownStatuses).toContain(
      "Where a status sits decides what it counts as, shown under **Counts as**: above **Draft**, **Not started**; from **Draft** down, **In progress**; from **Completed** down, **Done**, and no longer owed. **In Review**, between them, is still owed; **Not Needed**, below **Completed**, is not.",
    );
  });

  it("keeps the three built in, archives the rest, and is edited by the roles that manage incidents", () => {
    const status: IncidentPostmortemStatus = new IncidentPostmortemStatus();

    expect(
      STATE_LISTS[StateListType.IncidentPostmortemStatus].builtIns.map(
        (builtIn: { flag: string }): string => {
          return builtIn.flag;
        },
      ),
    ).toEqual(["isNotStartedStatus", "isDraftStatus", "isCompletedStatus"]);
    expect(ARCHIVABLE_VALUE_COPY_SOURCE).toContain(
      'archivedTitle: translationKey("Archived Postmortem Statuses"),',
    );

    for (const permissions of [
      status.getCreatePermissions(),
      status.getUpdatePermissions(),
      status.getDeletePermissions(),
    ]) {
      expect(rolesOf(permissions)).toEqual([
        "Project Owner",
        "Project Admin",
        "Incident Admin",
      ]);
    }

    expect(ownStatuses).toContain(
      "**Not Started**, **Draft** and **Completed** are built in, since OneUptime moves postmortems into them: you can rename and recolor them, but not delete or archive them, and they keep their order.",
    );
    expect(ownStatuses).toContain(
      "**Archived Postmortem Statuses**, folded under the table, lists them, with **Unarchive** to bring one back. Creating, editing and deleting statuses takes the Project Owner, Project Admin or Incident Admin role, or a custom role with the matching Postmortem Status permission.",
    );
  });
});

describe("every postmortem in one list", () => {
  const postmortems: string = english(POSTMORTEMS);
  const list: string = section(postmortems, "## See every postmortem");

  it("is Incidents → Postmortems, with the incident, its title, status, severity, owners and when it was declared", () => {
    const incidents: Array<MenuSection> = menuSections(INCIDENTS_MENU);

    expect(sectionByTitle(incidents, "Overview").items).toContain(
      "Postmortems",
    );
    expect(
      Array.from(
        POSTMORTEMS_TABLE.slice(
          POSTMORTEMS_TABLE.indexOf("columns={["),
        ).matchAll(/\n {12}title: "([^"]+)",/g),
      ).map((match: RegExpMatchArray): string => {
        return match[1] as string;
      }),
    ).toEqual([
      "Incident",
      "Title",
      "Postmortem Status",
      "Severity",
      "Owners",
      "Declared",
      "Labels",
    ]);
    // Labels is there for those who want it, from Columns.
    expect(
      POSTMORTEMS_TABLE.slice(POSTMORTEMS_TABLE.indexOf('title: "Labels",')),
    ).toContain("isHiddenByDefault: true,");
    expect(POSTMORTEMS_TABLE).toContain('viewButtonText="View"');
    expect(POSTMORTEMS_TABLE).toContain(
      "RouteMap[PageMap.INCIDENT_VIEW_POSTMORTEM] as Route",
    );
    expect(list).toContain(
      "**Incidents → Postmortems** lists the postmortem of every incident in the project, newest first, with the columns **Incident**, **Title**, **Postmortem Status**, **Severity**, **Owners** and **Declared**. **View** on a row opens the incident's **Postmortem** page.",
    );
  });

  it("counts each status in a tile that lists only those, and a second click lists them all", () => {
    expect(POSTMORTEM_STATUS_TILES).toContain(
      'data.setFacetSelection(POSTMORTEM_STATUS_FACET_KEY, [], "is");',
    );
    expect(POSTMORTEMS_TABLE).toContain("<PostmortemStatusSummaryCards");
    expect(list).toContain(
      "Above the list, a tile per status counts the postmortems in it. Click a tile to list only those, and click it again to list them all.",
    );
  });

  it("filters by owner, severity, status, incident state, labels and what the incident affects", () => {
    expect(RESOURCE_OWNERS_HOOK).toContain('label="Owner"');
    expect(RESOURCE_OWNERS_HOOK).toContain('label="Labels"');
    expect(POSTMORTEMS_TABLE).toContain("showLabelsFacet: true,");
    expect(
      Array.from(
        POSTMORTEM_LIST_FACETS_SOURCE.matchAll(
          /label: translationKey\("([^"]+)"\)/g,
        ),
      ).map((match: RegExpMatchArray): string => {
        return match[1] as string;
      }),
    ).toEqual(["Severity", "Incident State"]);
    expect(POSTMORTEM_LIST_FACETS_SOURCE).toContain(
      "label: POSTMORTEM_STATUS_FACET_LABEL,",
    );
    expect(POSTMORTEM_LIST_FACETS_SOURCE).toContain(
      "buildAffectedResourcesFacet<Incident>({",
    );
    expect(POSTMORTEMS_TABLE).toContain("urlStateKey={POSTMORTEMS_TABLE_ID}");
    expect(list).toContain(
      "Filter the list with the chips above it: **Owner**, a person or a team; **Severity**; **Postmortem Status**; **Incident State**; **Labels**; and **Affected Resources**.",
    );
    expect(list).toContain(
      "The filters are kept in the page's address, so you can bookmark the list or share it.",
    );
  });

  it("changes many at once: Change Postmortem Status, Add Owner and Remove Owner", () => {
    expectLabelDeclared(
      BULK_POSTMORTEM_STATUS,
      "CHANGE_POSTMORTEM_STATUS",
      "Change Postmortem Status",
    );
    expect(POSTMORTEMS_TABLE).toContain(
      "buttons: [statusBulkAction, ...ownerBulkActions],",
    );
    expect(list).toContain(
      "To change many at once, select them and open **Bulk Actions**: **Change Postmortem Status** moves them all to one status, such as **Not Needed** for incidents that need none, and **Add Owner** and **Remove Owner** change who owns them.",
    );
  });

  it("leaves out episodes, whose postmortem has no status and keeps the card's own buttons", () => {
    const episodes: string = section(postmortems, "## Postmortems of episodes");

    expect(EPISODE_POSTMORTEM_PAGE).not.toContain("postmortemStatus");
    // An episode's card still offers Apply Template and Generate with AI as buttons.
    expect(EPISODE_POSTMORTEM_PAGE).toContain(
      "buttons: getPostmortemCardButtons({",
    );
    expect(POSTMORTEM_CARD_BUTTONS).toContain('title: "Generate with AI",');
    expect(POSTMORTEM_CARD_BUTTONS).toContain(
      'if (options.hasTemplates) {\n    buttons.push({\n      title: "Apply Template",',
    );
    expect(episodes).toContain(
      "**Apply Template** and **Generate with AI** work as on an incident",
    );
    expect(episodes).toContain(
      "It has no status either, and the postmortems list leaves it out.",
    );
  });
});
