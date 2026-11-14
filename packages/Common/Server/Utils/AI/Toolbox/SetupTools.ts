import AlertOnCallRule from "../../../../Models/DatabaseModels/AlertOnCallRule";
import AlertSeverity from "../../../../Models/DatabaseModels/AlertSeverity";
import IncidentOnCallRule from "../../../../Models/DatabaseModels/IncidentOnCallRule";
import IncidentSeverity from "../../../../Models/DatabaseModels/IncidentSeverity";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import MonitorStatus from "../../../../Models/DatabaseModels/MonitorStatus";
import OnCallDutyPolicy from "../../../../Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicyEscalationRule from "../../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRule";
import Project from "../../../../Models/DatabaseModels/Project";
import StatusPage from "../../../../Models/DatabaseModels/StatusPage";
import StatusPageResource from "../../../../Models/DatabaseModels/StatusPageResource";
import Team from "../../../../Models/DatabaseModels/Team";
import TeamMember from "../../../../Models/DatabaseModels/TeamMember";
import User from "../../../../Models/DatabaseModels/User";
import {
  AIChatCitationTargetType,
  AIToolRefusal,
} from "../../../../Types/AI/AIChatTypes";
import {
  AI_ACTION_CARD_FACTS,
  AI_ACTION_CARD_KINDS,
  AI_ACTION_CARD_LINES,
  AI_ACTION_LINES,
  AI_ACTION_NAME,
  AI_ACTION_NEW_MONITOR,
  AI_ACTION_PLURAL_LINES,
  AI_ACTION_TEAM,
  AI_ACTION_TITLES,
  AIActionList,
  AIActionSentence,
  aiActionCardFact,
  aiActionList,
  aiActionPluralSentence,
  aiActionSentence,
  aiActionTerm,
} from "../../../../Types/AI/AIActionWords";
import {
  ADD_MONITORS_TO_STATUS_PAGE_TOOL_NAME,
  PUBLISH_STATUS_PAGE_TOOL_NAME,
  SET_UP_PAGING_TOOL_NAME,
  SET_UP_WEBSITE_MONITORING_TOOL_NAME,
} from "../../../../Types/AI/AISetupActions";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "../../../../Types/Database/LimitMax";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import Permission from "../../../../Types/Permission";
import PositiveNumber from "../../../../Types/PositiveNumber";
import {
  FirstOnCallPolicyCreate,
  GUIDED_SETUP_POLICY_NAME,
  WhoIsToldMode,
  buildFirstOnCallPolicy,
  getWhoIsToldMode,
} from "../../../../Utils/GuidedSetup/OnCallPolicyRecords";
import {
  STATUS_PAGE_NAME_MIN_LENGTH,
  buildGuidedStatusPage,
  buildGuidedStatusPageMonitor,
  getDefaultStatusPageName,
} from "../../../../Utils/GuidedSetup/StatusPageRecords";
import {
  GUIDED_SETUP_MONITORING_INTERVAL,
  WEBSITE_MONITOR_SEEDS_MISSING,
  WebsiteAddress,
  WebsiteMonitorSeeds,
  buildWebsiteMonitor,
  parseWebsiteAddress,
  pickWebsiteMonitorSeeds,
} from "../../../../Utils/GuidedSetup/WebsiteMonitorRecords";
import QueryHelper from "../../../Types/Database/QueryHelper";
import AlertOnCallRuleService from "../../../Services/AlertOnCallRuleService";
import AlertSeverityService from "../../../Services/AlertSeverityService";
import IncidentOnCallRuleService from "../../../Services/IncidentOnCallRuleService";
import IncidentSeverityService from "../../../Services/IncidentSeverityService";
import MonitorProbeService from "../../../Services/MonitorProbeService";
import MonitorService from "../../../Services/MonitorService";
import MonitorStatusService from "../../../Services/MonitorStatusService";
import OnCallDutyPolicyService from "../../../Services/OnCallDutyPolicyService";
import PayAsYouGoBillingService, {
  PAY_AS_YOU_GO_PAYMENT_REQUIRED_MESSAGE,
} from "../../../Services/PayAsYouGoBillingService";
import OnCallReadinessService, {
  ReadinessMethod,
  ReadinessMethodType,
  ReadinessStatus,
  UserReadiness,
} from "../../../Services/OnCallReadinessService";
import ProbeService from "../../../Services/ProbeService";
import ProjectService from "../../../Services/ProjectService";
import StatusPageResourceService from "../../../Services/StatusPageResourceService";
import StatusPageService from "../../../Services/StatusPageService";
import TeamMemberService from "../../../Services/TeamMemberService";
import TeamService from "../../../Services/TeamService";
import ActiveMonitorLimit from "../../Billing/ActiveMonitorLimit";
import logger from "../../Logger";
import UserLanguage from "../../Notification/UserLanguage";
import { getRecordWordsTranslator } from "../../ServerTranslation";
import { readRequestedReaderLanguage } from "../../../../Types/ReaderLanguage";
import ToolResultSerializer, { SerializedResult } from "./Serializer";
import {
  ObservabilityTool,
  PlannedToolCall,
  PreparedMutation,
  SetupActionRefusal,
  ToolArgs,
  ToolContext,
  ToolExecutionResult,
} from "./ToolTypes";
import WidgetBuilder from "./WidgetBuilder";

/*
 * ASK AI SETS THINGS UP (issue #6829): one action per outcome, not one per
 * table.
 *
 * "Monitor example.com every minute and text me if it is down" used to be
 * answered with "no tool here creates a monitor". These actions set up what
 * the guided setups set up, with the same records:
 *
 *   - set_up_website_monitoring: the website (or API) monitor of the
 *     website guided setup (#6804) - Create Monitor's defaults, the type's
 *     criteria, the probes a new monitor starts with - checked every five
 *     minutes unless asked otherwise. The person owns it, so they are
 *     emailed when its status changes. Its criteria, and the incident and
 *     alert they open, are named in the language the person reads the
 *     Dashboard in, as the guided setup names them (#7247,
 *     readSetupRecordsLanguage).
 *   - set_up_paging: who is told, as #6804 decides it - the project's first
 *     on-call policy, "Default on-call policy" (the guided setups' name for
 *     it, in every language), paging the people and teams
 *     picked ("you" by default), with the two catch-all rules that run it
 *     for every new incident and alert. A project that pages people already
 *     keeps its own policies and rules: nothing is proposed beside them.
 *     Escalation levels ("page Ana if I don't answer") are #6805's guided
 *     setup's; this action is where they plug in.
 *   - publish_status_page: the status page of the status page guided setup
 *     (#6806), created together with the monitors it shows - never empty -
 *     and public from that moment, which the card says. A page the person
 *     does not name is named after the project in the language they read
 *     the Dashboard in, as the guided setup names it (#7247).
 *   - add_monitors_to_status_page: monitors put on a status page as Add
 *     Multiple Monitors puts them.
 *
 * Each builds its records with the guided setups' own builders
 * (Common/Utils/GuidedSetup) and writes them through the services the model
 * API's creates reach, with the person's props: every permission, label,
 * plan limit and default that applies to the guided setup applies here
 * (ToolboxWritesAsThePersonGuard).
 *
 * One plan, one approval: the model proposes every part of a setup in one
 * answer, so the parts share one card, each a line in plain words the
 * person can skip (Dashboard ToolApprovalCard). They make things that page
 * people or that customers see, so they ask in every mode, Auto-run
 * included, and are checked before the card is shown (checkBeforeApproval):
 * what is missing - a permission, an address, monitors, room in the plan for
 * a monitor - ends in an answer that says what is needed, never in a card
 * that fails once approved. Once
 * approved, the parts run in their plan's order (setupAction.planOrder) -
 * who is paged, what is checked, where it is shown - so a status page finds
 * the monitor its plan set up; each says what it made, and a part that
 * fails says why, while the rest still run.
 */

/*
 * The order a plan's parts run in once approved: who is paged first, so
 * the monitor's first incident already has someone to page; then the
 * monitor; then the status page that shows it.
 */
export const SETUP_PLAN_ORDER: {
  paging: number;
  websiteMonitoring: number;
  statusPage: number;
  statusPageMonitors: number;
} = {
  paging: 10,
  websiteMonitoring: 20,
  statusPage: 30,
  statusPageMonitors: 40,
};

/*
 * The intervals Create Monitor offers, in minutes, by the cron it saves
 * (MonitorIntervalDropdownOptions): a request between two is read as the
 * nearest, and five minutes - Create Monitor's default - when it names
 * none.
 */
export const SETUP_MONITOR_INTERVALS: ReadonlyArray<{
  minutes: number;
  cron: string;
}> = [
  { minutes: 1, cron: "* * * * *" },
  { minutes: 2, cron: "*/2 * * * *" },
  { minutes: 5, cron: GUIDED_SETUP_MONITORING_INTERVAL },
  { minutes: 10, cron: "*/10 * * * *" },
  { minutes: 15, cron: "*/15 * * * *" },
  { minutes: 30, cron: "*/30 * * * *" },
  { minutes: 60, cron: "0 * * * *" },
];

const DEFAULT_CHECK_EVERY_MINUTES: number = 5;

// How a person asks to be reached, as set_up_paging takes it.
export enum SetupReachMethod {
  SMS = "sms",
  Call = "call",
  Push = "push",
  Email = "email",
}

// The most names a call may hand a list: more is not a setup, it is an import.
const MAX_NAMES: number = 25;

/*
 * Permissions, derived from the models' create ACLs so the gate can never
 * drift from RBAC. Resolved lazily: this module is imported through the
 * service graph before every model class is wired up (see
 * IncidentWriteTools).
 */
let cachedMonitorCreate: Array<Permission> | null = null;
const getMonitorCreatePermissions: () => Array<Permission> =
  (): Array<Permission> => {
    if (!cachedMonitorCreate) {
      cachedMonitorCreate = new Monitor().getCreatePermissions();
    }
    return cachedMonitorCreate;
  };

let cachedPagingGroups: Array<Array<Permission>> | null = null;
/*
 * Setting paging up makes a policy, its first escalation rule, and an
 * incident and an alert on-call rule: the permission to make each, as the
 * guided setup asks for them before it offers to make a policy
 * (getWhoIsToldMode's mayCreatePolicy, mayAddEscalationRules, mayAddRules).
 */
const getPagingPermissionGroups: () => Array<Array<Permission>> = (): Array<
  Array<Permission>
> => {
  if (!cachedPagingGroups) {
    cachedPagingGroups = [
      new OnCallDutyPolicy().getCreatePermissions(),
      new OnCallDutyPolicyEscalationRule().getCreatePermissions(),
      new IncidentOnCallRule().getCreatePermissions(),
      new AlertOnCallRule().getCreatePermissions(),
    ];
  }
  return cachedPagingGroups;
};

let cachedStatusPageGroups: Array<Array<Permission>> | null = null;
// A status page and the monitors on it: both, as the guided setup asks.
const getStatusPagePermissionGroups: () => Array<Array<Permission>> = (): Array<
  Array<Permission>
> => {
  if (!cachedStatusPageGroups) {
    cachedStatusPageGroups = [
      new StatusPage().getCreatePermissions(),
      new StatusPageResource().getCreatePermissions(),
    ];
  }
  return cachedStatusPageGroups;
};

let cachedStatusPageResourceCreate: Array<Permission> | null = null;
const getStatusPageResourceCreatePermissions: () => Array<Permission> =
  (): Array<Permission> => {
    if (!cachedStatusPageResourceCreate) {
      cachedStatusPageResourceCreate =
        new StatusPageResource().getCreatePermissions();
    }
    return cachedStatusPageResourceCreate;
  };

/*
 * ---------------------------------------------------------------------------
 * Reading the arguments
 * ---------------------------------------------------------------------------
 */

// The minutes between checks a call asks for: Create Monitor's nearest.
export function readCheckEveryMinutes(args: JSONObject): number {
  const asked: number = ToolArgs.getNumber(args, "checkEveryMinutes", {
    defaultValue: DEFAULT_CHECK_EVERY_MINUTES,
    min: 1,
    max: 24 * 60,
  });

  let nearest: { minutes: number; cron: string } = SETUP_MONITOR_INTERVALS[0]!;

  for (const interval of SETUP_MONITOR_INTERVALS) {
    if (
      Math.abs(interval.minutes - asked) < Math.abs(nearest.minutes - asked)
    ) {
      nearest = interval;
    }
  }

  return nearest.minutes;
}

export function getMonitoringIntervalForMinutes(minutes: number): string {
  return (
    SETUP_MONITOR_INTERVALS.find((interval: { minutes: number }): boolean => {
      return interval.minutes === minutes;
    })?.cron || GUIDED_SETUP_MONITORING_INTERVAL
  );
}

// The names a call hands a list: trimmed, each once (without case), at most MAX_NAMES.
export function readNames(args: JSONObject, key: string): Array<string> {
  const names: Array<string> = [];
  const seen: Set<string> = new Set<string>();

  for (const name of ToolArgs.getStringArray(args, key) || []) {
    const trimmed: string = name.trim();
    const lower: string = trimmed.toLowerCase();

    if (!trimmed || seen.has(lower)) {
      continue;
    }

    seen.add(lower);
    names.push(trimmed);

    if (names.length >= MAX_NAMES) {
      break;
    }
  }

  return names;
}

// The ways a call asks for the person to be reached, each once.
export function readReachMethods(args: JSONObject): Array<SetupReachMethod> {
  const methods: Array<SetupReachMethod> = [];

  for (const value of ToolArgs.getStringArray(args, "reachMeBy") || []) {
    const method: string = value.trim().toLowerCase();

    if (
      Object.values(SetupReachMethod).includes(method as SetupReachMethod) &&
      !methods.includes(method as SetupReachMethod)
    ) {
      methods.push(method as SetupReachMethod);
    }
  }

  return methods;
}

/*
 * The monitors the same plan sets up, by the name each will have
 * (WebsiteAddress.monitorName): a status page in that plan may show them.
 */
export function getMonitorNamesSetUpInPlan(
  plannedCalls: ReadonlyArray<PlannedToolCall> | undefined,
): Array<string> {
  const names: Array<string> = [];

  for (const call of plannedCalls || []) {
    if (call.name !== SET_UP_WEBSITE_MONITORING_TOOL_NAME) {
      continue;
    }

    const address: WebsiteAddress | null = parseWebsiteAddress(
      ToolArgs.getString(call.arguments || {}, "address") || "",
    );

    if (address && !names.includes(address.monitorName)) {
      names.push(address.monitorName);
    }
  }

  return names;
}

/*
 * How many monitors the same plan sets up: one for each website monitoring
 * call whose address is one, and at least the one being checked.
 */
export function countMonitorsSetUpInPlan(
  plannedCalls: ReadonlyArray<PlannedToolCall> | undefined,
): number {
  const count: number = (plannedCalls || []).filter(
    (call: PlannedToolCall): boolean => {
      return (
        call.name === SET_UP_WEBSITE_MONITORING_TOOL_NAME &&
        Boolean(
          parseWebsiteAddress(
            ToolArgs.getString(call.arguments || {}, "address") || "",
          ),
        )
      );
    },
  ).length;

  return Math.max(1, count);
}

/*
 * What the project's plan says to the monitors a plan sets up, asked before
 * its card so a project that may not add them is told now, not after an
 * approval: the two answers MonitorService.create gives when it runs - and
 * gives again then. OneUptime Cloud's pay as you go, which a website
 * monitor needs on every plan, and room under the plan's active monitor
 * limit for every monitor of the plan (ActiveMonitorLimit.getRefusal, an
 * answer for now). Null on an install without billing, and when there is
 * room.
 */
export async function readMonitorPlanRefusal(
  ctx: ToolContext,
): Promise<string | null> {
  if (!(await PayAsYouGoBillingService.canUsePayAsYouGo(ctx.projectId))) {
    return PAY_AS_YOU_GO_PAYMENT_REQUIRED_MESSAGE;
  }

  return await ActiveMonitorLimit.getRefusal({
    projectId: ctx.projectId,
    adding: countMonitorsSetUpInPlan(ctx.plannedCalls),
  });
}

// A name in a card's list, as written, in quotes - a monitor's.
function quotedName(name: string): AIActionSentence {
  return aiActionSentence(AI_ACTION_NAME, { name: JSON.stringify(name) });
}

// A name in a card's list, as written - a person's.
function plainName(name: string): AIActionSentence {
  return aiActionSentence(AI_ACTION_NAME, { name: name });
}

/*
 * ---------------------------------------------------------------------------
 * Reads, as the person
 * ---------------------------------------------------------------------------
 */

/*
 * The statuses and severities a new monitor's criteria name, read as the
 * person and picked as the guided setup picks them. Null when the project
 * lacks one.
 */
async function readWebsiteMonitorSeeds(
  ctx: ToolContext,
): Promise<WebsiteMonitorSeeds | null> {
  const [statuses, incidentSeverities, alertSeverities]: [
    Array<MonitorStatus>,
    Array<IncidentSeverity>,
    Array<AlertSeverity>,
  ] = await Promise.all([
    MonitorStatusService.findBy({
      query: { projectId: ctx.projectId },
      select: { _id: true, isOperationalState: true, isOfflineState: true },
      sort: { priority: SortOrder.Ascending },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      props: ctx.props,
    }),
    IncidentSeverityService.findBy({
      query: { projectId: ctx.projectId },
      select: { _id: true, name: true, isArchived: true },
      sort: { order: SortOrder.Ascending },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      props: ctx.props,
    }),
    AlertSeverityService.findBy({
      query: { projectId: ctx.projectId },
      select: { _id: true, isArchived: true },
      sort: { order: SortOrder.Ascending },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      props: ctx.props,
    }),
  ]);

  return pickWebsiteMonitorSeeds({
    statuses: statuses,
    incidentSeverities: incidentSeverities,
    alertSeverities: alertSeverities,
  });
}

/*
 * THE LANGUAGE A SETUP'S RECORDS ARE WORDED IN (#7247).
 *
 * The monitor names its criteria, and the incident and alert they open, in
 * the language of the person it is made for - as the website guided setup
 * names them for the same person, and Create Monitor does: the language
 * they read the Dashboard in, as the request that approved it said
 * (ToolContext.language), else the one saved on their account
 * (User.language: their on-call pages are written in it, and the Dashboard
 * starts in it), else English. A read that fails is English: a monitor is
 * never held back for the language of its words.
 */
export async function readSetupRecordsLanguage(
  ctx: ToolContext,
): Promise<string> {
  const requested: string | undefined = readRequestedReaderLanguage(
    ctx.language,
  );

  if (requested) {
    return requested;
  }

  return await UserLanguage.getLanguage(ctx.props.userId);
}

// The name of the incident severity a new monitor's criteria open, or null.
async function readIncidentSeverityName(
  ctx: ToolContext,
  severityId: ObjectID,
): Promise<string | null> {
  try {
    const severity: IncidentSeverity | null =
      await IncidentSeverityService.findOneById({
        id: severityId,
        select: { _id: true, name: true },
        props: ctx.props,
      });

    return severity?.name?.trim() || null;
  } catch {
    return null;
  }
}

/*
 * How many locations check a new monitor: the probes the server adds when a
 * create names none (MonitorService.addDefaultProbesToMonitor) - the global
 * ones that start on new monitors, unless the project turned that off, and
 * the project's own that do. Counted as OneUptime counts them there; null
 * when it cannot be told.
 */
async function countNewMonitorLocations(
  ctx: ToolContext,
): Promise<number | null> {
  try {
    const project: Project | null = await ProjectService.findOneById({
      id: ctx.projectId,
      select: { _id: true, doNotAddGlobalProbesByDefaultOnNewMonitors: true },
      props: { isRoot: true },
    });

    const [globalProbes, projectProbes]: [PositiveNumber, PositiveNumber] =
      await Promise.all([
        project?.doNotAddGlobalProbesByDefaultOnNewMonitors === true
          ? Promise.resolve(new PositiveNumber(0))
          : ProbeService.countBy({
              query: {
                isGlobalProbe: true,
                shouldAutoEnableProbeOnNewMonitors: true,
              },
              props: { isRoot: true },
            }),
        ProbeService.countBy({
          query: {
            isGlobalProbe: false,
            shouldAutoEnableProbeOnNewMonitors: true,
            projectId: ctx.projectId,
          },
          props: { isRoot: true },
        }),
      ]);

    return globalProbes.toNumber() + projectProbes.toNumber();
  } catch (error) {
    logger.debug(
      `set_up_website_monitoring could not count a new monitor's locations: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return null;
  }
}

// How many of the project's on-call policies and rules the person can count.
export interface PagingCounts {
  policyCount: number;
  incidentRuleCount: number;
  alertRuleCount: number;
}

/*
 * The project's on-call policies and rules, counted as the person, as the
 * guided setup counts them: null when they may not read them, which makes
 * nothing (WhoIsToldMode.OwnerEmailOnly).
 */
async function readPagingCounts(
  ctx: ToolContext,
): Promise<PagingCounts | null> {
  try {
    const [policies, incidentRules, alertRules]: [
      PositiveNumber,
      PositiveNumber,
      PositiveNumber,
    ] = await Promise.all([
      OnCallDutyPolicyService.countBy({
        query: { projectId: ctx.projectId },
        props: ctx.props,
      }),
      IncidentOnCallRuleService.countBy({
        query: { projectId: ctx.projectId },
        props: ctx.props,
      }),
      AlertOnCallRuleService.countBy({
        query: { projectId: ctx.projectId },
        props: ctx.props,
      }),
    ]);

    return {
      policyCount: policies.toNumber(),
      incidentRuleCount: incidentRules.toNumber(),
      alertRuleCount: alertRules.toNumber(),
    };
  } catch {
    return null;
  }
}

// A monitor of the project, as a status page action names it.
export interface SetupMonitor {
  id: string;
  name: string;
}

export interface FoundMonitors {
  // In the order they were named, each once.
  found: Array<SetupMonitor>;
  // Named, and not among the project's monitors the person may read.
  notFound: Array<string>;
}

/*
 * The project's monitors a call names, read as the person: by the name
 * each has (without case), else - for "https://example.com" - by the name
 * the website setup gives an address (example.com). Each monitor once.
 */
async function findMonitorsByName(
  ctx: ToolContext,
  names: ReadonlyArray<string>,
): Promise<FoundMonitors> {
  if (names.length === 0) {
    return { found: [], notFound: [] };
  }

  const candidates: Array<string> = [];

  for (const name of names) {
    candidates.push(name);

    const address: WebsiteAddress | null = parseWebsiteAddress(name);

    if (address) {
      candidates.push(address.monitorName);
    }
  }

  const monitors: Array<Monitor> = await MonitorService.findBy({
    query: {
      projectId: ctx.projectId,
      name: QueryHelper.findWithSameTextAnyOf(candidates),
    },
    select: { _id: true, name: true },
    sort: { name: SortOrder.Ascending },
    limit: LIMIT_PER_PROJECT,
    skip: 0,
    props: ctx.props,
  });

  const byName: Map<string, Monitor> = new Map<string, Monitor>();

  for (const monitor of monitors) {
    const key: string = (monitor.name || "").trim().toLowerCase();

    if (key && monitor.id && !byName.has(key)) {
      byName.set(key, monitor);
    }
  }

  const found: Array<SetupMonitor> = [];
  const notFound: Array<string> = [];

  for (const name of names) {
    const address: WebsiteAddress | null = parseWebsiteAddress(name);
    const monitor: Monitor | undefined =
      byName.get(name.trim().toLowerCase()) ||
      (address ? byName.get(address.monitorName.toLowerCase()) : undefined);

    if (!monitor) {
      notFound.push(name);
      continue;
    }

    const id: string = monitor.id!.toString();

    if (
      !found.some((each: SetupMonitor): boolean => {
        return each.id === id;
      })
    ) {
      found.push({ id: id, name: monitor.name || name });
    }
  }

  return { found, notFound };
}

/*
 * The monitors a status page action shows, before it is approved: the
 * project's, and the ones the same plan sets up first (new), and the names
 * that are neither.
 */
export interface MonitorsToShow {
  existing: Array<SetupMonitor>;
  setUpInPlan: Array<string>;
  notFound: Array<string>;
}

async function readMonitorsToShow(
  ctx: ToolContext,
  names: ReadonlyArray<string>,
): Promise<MonitorsToShow> {
  const found: FoundMonitors = await findMonitorsByName(ctx, names);
  const planned: Array<string> = getMonitorNamesSetUpInPlan(ctx.plannedCalls);
  const setUpInPlan: Array<string> = [];
  const notFound: Array<string> = [];

  for (const name of found.notFound) {
    const address: WebsiteAddress | null = parseWebsiteAddress(name);
    const plannedName: string | undefined = planned.find(
      (each: string): boolean => {
        return (
          each.toLowerCase() === name.trim().toLowerCase() ||
          (address !== null &&
            each.toLowerCase() === address.monitorName.toLowerCase())
        );
      },
    );

    if (plannedName) {
      if (!setUpInPlan.includes(plannedName)) {
        setUpInPlan.push(plannedName);
      }
    } else {
      notFound.push(name);
    }
  }

  return { existing: found.found, setUpInPlan, notFound };
}

// The monitors a card says a status page shows: the project's, then the new.
function describeMonitorsToShow(monitors: MonitorsToShow): AIActionList {
  return aiActionList([
    ...monitors.existing.map((monitor: SetupMonitor): AIActionSentence => {
      return quotedName(monitor.name);
    }),
    ...monitors.setUpInPlan.map((name: string): AIActionSentence => {
      return aiActionSentence(AI_ACTION_NEW_MONITOR, {
        name: JSON.stringify(name),
      });
    }),
  ]);
}

/*
 * Puts monitors on a status page as Add Multiple Monitors puts them, one
 * after another (the page numbers each as it is added), skipping the ones
 * it shows already. Each as the person; one that is refused is named with
 * its reason and the rest still go on.
 */
export interface AddedMonitors {
  added: Array<SetupMonitor>;
  alreadyShown: Array<SetupMonitor>;
  failed: Array<{ monitor: SetupMonitor; reason: string }>;
}

async function addMonitorsToPage(
  ctx: ToolContext,
  data: {
    statusPageId: ObjectID;
    monitors: ReadonlyArray<SetupMonitor>;
  },
): Promise<AddedMonitors> {
  const existing: Array<StatusPageResource> =
    await StatusPageResourceService.findBy({
      query: {
        projectId: ctx.projectId,
        statusPageId: data.statusPageId,
      },
      select: { _id: true, monitorId: true },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      props: ctx.props,
    });

  const shown: Set<string> = new Set<string>(
    existing
      .map((resource: StatusPageResource): string => {
        return resource.monitorId?.toString() || "";
      })
      .filter(Boolean),
  );

  const added: Array<SetupMonitor> = [];
  const alreadyShown: Array<SetupMonitor> = [];
  const failed: Array<{ monitor: SetupMonitor; reason: string }> = [];

  for (const monitor of data.monitors) {
    if (shown.has(monitor.id)) {
      alreadyShown.push(monitor);
      continue;
    }

    try {
      await StatusPageResourceService.create({
        data: buildGuidedStatusPageMonitor({
          projectId: ctx.projectId,
          statusPageId: data.statusPageId,
          monitorId: new ObjectID(monitor.id),
          monitorName: monitor.name,
        }),
        props: ctx.props,
      });
      shown.add(monitor.id);
      added.push(monitor);
    } catch (error) {
      failed.push({
        monitor: monitor,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { added, alreadyShown, failed };
}

/*
 * ---------------------------------------------------------------------------
 * set_up_website_monitoring
 * ---------------------------------------------------------------------------
 */

const NOT_AN_ADDRESS: string =
  "That is not a web address a website monitor can check. Ask the person for the address, such as example.com or https://example.com/health, and propose the setup again.";

// The address a call names: the parsed one, or null.
function readAddress(args: JSONObject): WebsiteAddress | null {
  return parseWebsiteAddress(ToolArgs.getString(args, "address") || "");
}

/*
 * What the approval card says the monitor will do: what is checked and how
 * often, from where, what happens when it goes down, and who is emailed.
 */
export function describeWebsiteMonitoringForPerson(data: {
  address: WebsiteAddress;
  isApi: boolean;
  minutes: number;
  locationCount: number | null;
  incidentSeverityName: string | null;
}): Array<AIActionSentence> {
  const sentences: Array<AIActionSentence> = [
    aiActionPluralSentence(
      data.isApi
        ? AI_ACTION_PLURAL_LINES.apiMonitorChecks
        : AI_ACTION_PLURAL_LINES.websiteMonitorChecks,
      data.minutes,
      { url: data.address.url },
    ),
  ];

  if (data.locationCount === 0) {
    sentences.push(
      aiActionSentence(AI_ACTION_LINES.monitorNoLocations, {
        host: data.address.host,
      }),
    );
  } else if (data.locationCount !== null) {
    sentences.push(
      aiActionPluralSentence(
        AI_ACTION_PLURAL_LINES.checkedFromLocations,
        data.locationCount,
      ),
    );
  }

  sentences.push(
    data.incidentSeverityName
      ? aiActionSentence(AI_ACTION_LINES.monitorOpensIncident, {
          severity: data.incidentSeverityName,
        })
      : aiActionSentence(AI_ACTION_LINES.monitorGoesOffline),
  );

  sentences.push(aiActionSentence(AI_ACTION_LINES.monitorOwnerEmailed));

  return sentences;
}

export const SetUpWebsiteMonitoringTool: ObservabilityTool = {
  name: "set_up_website_monitoring",
  description:
    "Set up monitoring for a website or API address, as the guided setup does: a Website monitor (or an API monitor, with isApi) with Create Monitor's defaults - it opens an incident when the address does not answer or answers with an error - checked from the locations a new monitor starts with. The person owns the monitor, so they are emailed when its status changes. Use it for 'monitor example.com', 'tell me when my site is down', 'watch our API'. Who else is paged is set_up_paging's job: propose both in the same answer when the person asks to be paged, texted or called. It always shows the person an approval card, in every mode.",
  inputSchema: {
    type: "object",
    properties: {
      address: {
        type: "string",
        description:
          "The address to check, as the person gave it: 'example.com' (https is added) or a full URL such as 'https://api.example.com/health'.",
      },
      isApi: {
        type: "boolean",
        description:
          "True when the address is an API endpoint rather than a website. Defaults to false.",
      },
      checkEveryMinutes: {
        type: "number",
        description:
          "How often to check, in minutes: 1, 2, 5, 10, 15, 30 or 60 (Create Monitor's choices; another number is read as the nearest). Defaults to 5. Set it only when the person asked for how often.",
      },
    },
    required: ["address"],
  },
  get requiredPermissions(): Array<Permission> {
    return getMonitorCreatePermissions();
  },
  isMutation: true,
  setupAction: { planOrder: SETUP_PLAN_ORDER.websiteMonitoring },
  buildActionTitle: (args: JSONObject): AIActionSentence => {
    const address: WebsiteAddress | null = readAddress(args);

    return address
      ? aiActionSentence(AI_ACTION_TITLES.setUpWebsiteMonitoring, {
          address: address.monitorName,
        })
      : aiActionSentence(AI_ACTION_TITLES.setUpWebsiteMonitoringUnnamed);
  },
  /*
   * The interval it runs with written out (the nearest of Create Monitor's),
   * and what the card says: what is checked, how often and from where, what
   * happens when it goes down, and who is emailed.
   */
  prepareMutation: async (
    args: JSONObject,
    ctx: ToolContext,
  ): Promise<PreparedMutation> => {
    const minutes: number = readCheckEveryMinutes(args);
    const isApi: boolean = ToolArgs.getBoolean(args, "isApi") === true;
    const prepared: JSONObject = {
      ...args,
      isApi: isApi,
      checkEveryMinutes: minutes,
    };
    const address: WebsiteAddress | null = readAddress(args);

    if (!address) {
      return { arguments: prepared };
    }

    let incidentSeverityName: string | null = null;

    try {
      const seeds: WebsiteMonitorSeeds | null =
        await readWebsiteMonitorSeeds(ctx);

      incidentSeverityName = seeds
        ? await readIncidentSeverityName(ctx, seeds.incidentSeverityId)
        : null;
    } catch {
      incidentSeverityName = null;
    }

    return {
      arguments: prepared,
      description: describeWebsiteMonitoringForPerson({
        address: address,
        isApi: isApi,
        minutes: minutes,
        locationCount: await countNewMonitorLocations(ctx),
        incidentSeverityName: incidentSeverityName,
      }),
      describedArguments: ["address", "isApi", "checkEveryMinutes"],
    };
  },
  checkBeforeApproval: async (
    args: JSONObject,
    ctx: ToolContext,
  ): Promise<SetupActionRefusal | null> => {
    if (!readAddress(args)) {
      return { toldModel: NOT_AN_ADDRESS };
    }

    try {
      if (!(await readWebsiteMonitorSeeds(ctx))) {
        return { toldModel: WEBSITE_MONITOR_SEEDS_MISSING };
      }
    } catch {
      // Unreadable now: running it says why.
    }

    try {
      const planRefusal: string | null = await readMonitorPlanRefusal(ctx);

      if (planRefusal) {
        return {
          toldModel: `Nothing proposed: the project's plan does not allow it now. ${planRefusal} Tell the person what is needed, in these words.`,
          refusal: AIToolRefusal.Plan,
        };
      }
    } catch {
      // Unreadable now: running it says why.
    }

    return null;
  },
  execute: async (
    args: JSONObject,
    ctx: ToolContext,
  ): Promise<ToolExecutionResult> => {
    const address: WebsiteAddress | null = readAddress(args);

    if (!address) {
      throw new BadDataException(NOT_AN_ADDRESS);
    }

    const isApi: boolean = ToolArgs.getBoolean(args, "isApi") === true;
    const minutes: number = readCheckEveryMinutes(args);
    const seeds: WebsiteMonitorSeeds | null =
      await readWebsiteMonitorSeeds(ctx);

    if (!seeds) {
      throw new BadDataException(WEBSITE_MONITOR_SEEDS_MISSING);
    }

    /*
     * The guided setup's monitor, for the same answers (Common/Utils/
     * GuidedSetup), its criteria worded in the person's language as the
     * guided setup words them (#7247): undefined is the builders' English.
     */
    const monitor: Monitor = buildWebsiteMonitor({
      address: address,
      isApi: isApi,
      seeds: seeds,
      monitoringInterval: getMonitoringIntervalForMinutes(minutes),
      translator: getRecordWordsTranslator(await readSetupRecordsLanguage(ctx)),
    });
    monitor.projectId = ctx.projectId;

    // Created as the person: their permissions, the plan's limits, their ownership.
    const created: Monitor = await MonitorService.create({
      data: monitor,
      props: ctx.props,
    });

    const monitorId: string = created.id!.toString();
    const incidentSeverityName: string | null = await readIncidentSeverityName(
      ctx,
      seeds.incidentSeverityId,
    );

    let locationCount: number | null = null;

    try {
      locationCount = (
        await MonitorProbeService.countBy({
          query: { monitorId: created.id!, isEnabled: true },
          props: ctx.props,
        })
      ).toNumber();
    } catch {
      locationCount = null;
    }

    const serialized: SerializedResult = ToolResultSerializer.serializeRows([
      {
        id: monitorId,
        name: address.monitorName,
        type: isApi ? "API" : "Website",
        address: address.url,
        checkedEveryMinutes: minutes,
        ...(locationCount !== null ? { locations: locationCount } : {}),
        ...(incidentSeverityName
          ? { opensIncidentWithSeverity: incidentSeverityName }
          : {}),
      },
    ]);

    return {
      dataForLlm: `Created the ${isApi ? "API" : "Website"} monitor "${address.monitorName}", checking ${address.url} every ${minutes === 1 ? "minute" : `${minutes} minutes`}${
        locationCount !== null
          ? ` from ${locationCount} location${locationCount === 1 ? "" : "s"}`
          : ""
      }.${
        locationCount === 0
          ? " No location checks it yet: the project adds no probe to new monitors. Probes are added under Monitors > Settings > Probes."
          : ""
      } ${
        incidentSeverityName
          ? `If it does not answer, or answers with an error, OneUptime opens an incident (${incidentSeverityName}).`
          : "If it does not answer, or answers with an error, its status changes to Offline."
      } The person owns it, so they are emailed when its status changes. Who else is told depends on the project's on-call policies and rules: who_is_told answers it. Under your answer the person can send themselves a test page; offer it in one sentence and never say one was sent.\n${serialized.text}`,
      rowCount: 1,
      citationLabel: `Set up monitor "${address.monitorName}"`,
      citationTarget: {
        type: AIChatCitationTargetType.MonitorView,
        params: { monitorId: monitorId },
      },
      redactionCount: serialized.redactionCount,
      isTruncated: false,
      widget: WidgetBuilder.actionCard({
        title: "Monitor set up",
        heading: address.monitorName,
        words: {
          kind: aiActionTerm(AI_ACTION_CARD_KINDS.monitor),
          line: [
            aiActionPluralSentence(
              AI_ACTION_PLURAL_LINES.checkedEveryMinutes,
              minutes,
            ),
          ],
          facts: [aiActionCardFact(AI_ACTION_CARD_FACTS.address, address.url)],
        },
        link: {
          type: AIChatCitationTargetType.MonitorView,
          params: { monitorId: monitorId },
        },
        testPage: { kind: "self" },
      }),
    };
  },
};

/*
 * ---------------------------------------------------------------------------
 * set_up_paging
 * ---------------------------------------------------------------------------
 */

// Who a paging call pages, resolved against the project's members and teams.
export interface PagingResponders {
  includesMe: boolean;
  // Other people, by id and name.
  people: Array<{ id: string; name: string }>;
  teams: Array<{ id: string; name: string }>;
  // Names that are no member or team of the project.
  notFound: Array<string>;
}

/*
 * The name and email of each member the person's own read found, read as
 * OneUptime. A member's user is read by fewer people than the membership
 * (Current User reaches a person's own memberships, not who they belong to),
 * so the person's read selects only what every reader of a membership may
 * read, and this adds who each one is - for those memberships alone, in the
 * person's project.
 */
async function addMemberUsers(
  ctx: ToolContext,
  members: Array<TeamMember>,
): Promise<void> {
  const ids: Array<string> = members
    .map((member: TeamMember): string => {
      return member.id?.toString() || "";
    })
    .filter((id: string): boolean => {
      return Boolean(id);
    });

  if (ids.length === 0) {
    return;
  }

  const withUsers: Array<TeamMember> = await TeamMemberService.findBy({
    query: {
      _id: QueryHelper.any(ids),
      projectId: ctx.projectId,
    } as never,
    select: {
      _id: true,
      user: { _id: true, name: true, email: true },
    },
    limit: LIMIT_PER_PROJECT,
    skip: 0,
    props: { isRoot: true },
  });

  const userOf: Map<string, User> = new Map();

  for (const withUser of withUsers) {
    if (withUser.user) {
      userOf.set(withUser.id?.toString() || "", withUser.user);
    }
  }

  for (const member of members) {
    const user: User | undefined = userOf.get(member.id?.toString() || "");

    if (user) {
      member.user = user;
    }
  }
}

/*
 * The people and teams a call names, matched to the project's members (by
 * name or email, without case) and teams (by name), as the person reads
 * them. The person asking is "you", however they are named.
 */
async function readPagingResponders(
  args: JSONObject,
  ctx: ToolContext,
): Promise<PagingResponders> {
  const myId: string = ctx.props.userId?.toString() || "";
  const peopleNames: Array<string> = readNames(args, "alsoPage");
  const teamNames: Array<string> = readNames(args, "teams");
  const responders: PagingResponders = {
    includesMe: ToolArgs.getBoolean(args, "includeMe") !== false,
    people: [],
    teams: [],
    notFound: [],
  };

  if (peopleNames.length > 0) {
    // Which members the person may read, by their own permissions.
    const members: Array<TeamMember> = await TeamMemberService.findBy({
      query: { projectId: ctx.projectId, hasAcceptedInvitation: true },
      select: {
        _id: true,
        userId: true,
      },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      props: ctx.props,
    });

    await addMemberUsers(ctx, members);

    for (const asked of peopleNames) {
      const lower: string = asked.toLowerCase();
      const member: TeamMember | undefined = members.find(
        (each: TeamMember): boolean => {
          return (
            (each.user?.name?.toString() || "").trim().toLowerCase() ===
              lower ||
            (each.user?.email?.toString() || "").trim().toLowerCase() === lower
          );
        },
      );
      const userId: string = member?.userId?.toString() || "";

      if (!member || !userId) {
        responders.notFound.push(asked);
      } else if (userId === myId) {
        responders.includesMe = true;
      } else if (
        !responders.people.some((person: { id: string }): boolean => {
          return person.id === userId;
        })
      ) {
        responders.people.push({
          id: userId,
          name:
            member.user?.name?.toString() ||
            member.user?.email?.toString() ||
            asked,
        });
      }
    }
  }

  if (teamNames.length > 0) {
    const teams: Array<Team> = await TeamService.findBy({
      query: {
        projectId: ctx.projectId,
        name: QueryHelper.findWithSameTextAnyOf(teamNames),
      },
      select: { _id: true, name: true },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      props: ctx.props,
    });

    for (const asked of teamNames) {
      const team: Team | undefined = teams.find((each: Team): boolean => {
        return (each.name || "").trim().toLowerCase() === asked.toLowerCase();
      });

      if (!team?.id) {
        responders.notFound.push(asked);
      } else if (
        !responders.teams.some((each: { id: string }): boolean => {
          return each.id === team.id!.toString();
        })
      ) {
        responders.teams.push({
          id: team.id.toString(),
          name: team.name || asked,
        });
      }
    }
  }

  return responders;
}

// Who a policy pages, as one of the three sentences (with or without "you").
function describePagedForPerson(
  responders: Pick<PagingResponders, "includesMe" | "people" | "teams">,
  lines: {
    you: string;
    youAndOthers: string;
    others: string;
  },
): AIActionSentence {
  const others: Array<AIActionSentence> = [
    ...responders.people.map((person: { name: string }): AIActionSentence => {
      return plainName(person.name);
    }),
    ...responders.teams.map((team: { name: string }): AIActionSentence => {
      return aiActionSentence(AI_ACTION_TEAM, { name: team.name });
    }),
  ];

  if (responders.includesMe && others.length === 0) {
    return aiActionSentence(lines.you);
  }

  if (responders.includesMe) {
    return aiActionSentence(lines.youAndOthers, {
      others: aiActionList(others),
    });
  }

  return aiActionSentence(lines.others, { responders: aiActionList(others) });
}

/*
 * What is missing for the person to be reached the way they asked, from
 * their verified methods (On-Call Readiness): Ask AI never adds a number
 * or the app - the person verifies them - so the card says what is missing,
 * and where it is added. Nothing when they asked for nothing in particular,
 * unless nothing reaches them at all.
 */
export function describeReachForPerson(data: {
  asked: ReadonlyArray<SetupReachMethod>;
  readiness: Pick<UserReadiness, "status" | "methods"> | null;
}): Array<AIActionSentence> {
  if (!data.readiness) {
    return [];
  }

  const isVerified: (type: string) => boolean = (type: string): boolean => {
    return data.readiness!.methods.some((method: ReadinessMethod): boolean => {
      return method.methodType === type && method.isVerified;
    });
  };

  const sentences: Array<AIActionSentence> = [];

  if (
    data.asked.includes(SetupReachMethod.SMS) &&
    !isVerified(ReadinessMethodType.SMS)
  ) {
    sentences.push(aiActionSentence(AI_ACTION_LINES.noVerifiedPhoneForSms));
  }

  if (
    data.asked.includes(SetupReachMethod.Call) &&
    !isVerified(ReadinessMethodType.Call)
  ) {
    sentences.push(aiActionSentence(AI_ACTION_LINES.noVerifiedPhoneForCalls));
  }

  if (
    data.asked.includes(SetupReachMethod.Push) &&
    !isVerified(ReadinessMethodType.Push)
  ) {
    sentences.push(aiActionSentence(AI_ACTION_LINES.noMobileApp));
  }

  if (
    sentences.length === 0 &&
    data.readiness.status === ReadinessStatus.NotReachable
  ) {
    sentences.push(aiActionSentence(AI_ACTION_LINES.nothingReachesYou));
  }

  return sentences;
}

// The person's readiness, as their own page shows it; null when unknown.
async function readMyReadiness(
  ctx: ToolContext,
): Promise<UserReadiness | null> {
  if (!ctx.props.userId) {
    return null;
  }

  try {
    return await OnCallReadinessService.getReadinessForUser(
      new ObjectID(ctx.props.userId.toString()),
      ctx.projectId,
    );
  } catch {
    return null;
  }
}

/*
 * Who a prepared call pages, as its prepare wrote it out: the ids it runs
 * with - the person asking first, when they are paged - and the names the
 * card said, for the card the policy leaves.
 */
export interface PreparedResponders {
  userIds: Array<string>;
  teamIds: Array<string>;
  // The other people's names and the teams', as the approval card named them.
  otherPeople: Array<string>;
  pagedTeams: Array<string>;
}

export function readPreparedResponders(args: JSONObject): PreparedResponders {
  const ids: (key: string) => Array<string> = (key: string): Array<string> => {
    return (ToolArgs.getStringArray(args, key) || []).filter(
      (id: string): boolean => {
        return ObjectID.isValidUUID(id);
      },
    );
  };

  return {
    userIds: ids("userIds"),
    teamIds: ids("teamIds"),
    otherPeople: ToolArgs.getStringArray(args, "otherPeople") || [],
    pagedTeams: ToolArgs.getStringArray(args, "pagedTeams") || [],
  };
}

const PAGING_PREPARED_ARGUMENTS: Array<string> = [
  "includeMe",
  "alsoPage",
  "teams",
  "reachMeBy",
  "userIds",
  "teamIds",
  "otherPeople",
  "pagedTeams",
];

/*
 * Whether the project pages people already, as the guided setup decides
 * it (getWhoIsToldMode): a policy or an on-call rule of any kind. The
 * person's permissions to make one were checked by the toolbox's gate
 * before this is asked (AIToolbox.checkBeforeApproval).
 */
export function pagesPeopleAlready(counts: PagingCounts): boolean {
  return (
    getWhoIsToldMode({
      ...counts,
      mayCreatePolicy: true,
      mayAddEscalationRules: true,
      mayAddRules: true,
    }) === WhoIsToldMode.ExistingPolicy
  );
}

const NOBODY_TO_PAGE: string =
  "Nothing proposed: nobody named is a member or a team of this project, so the policy would page nobody. Ask the person who to page, by the name the project knows them by (query_teams lists members), and propose it again.";

const PROJECT_PAGES_ALREADY: (counts: PagingCounts) => string = (
  counts: PagingCounts,
): string => {
  return `Nothing proposed: this project already pages people through its on-call policies and on-call rules (${counts.policyCount} on-call ${counts.policyCount === 1 ? "policy" : "policies"}, ${counts.incidentRuleCount + counts.alertRuleCount} on-call ${counts.incidentRuleCount + counts.alertRuleCount === 1 ? "rule" : "rules"}), so they decide who is paged, and a second policy that pages for every incident would page twice. Say so in one sentence. Once a monitor exists, who_is_told says who it reaches; changing who is paged is done in the project's on-call policies (find_dashboard_page "On-Call Policies"), or with the on-call guided setup.`;
};

export const SetUpPagingTool: ObservabilityTool = {
  name: "set_up_paging",
  description:
    "Set up who is paged in a project that pages nobody yet, as the website guided setup does: the project's first on-call policy, 'Default on-call policy', paging the person ('you', unless includeMe is false) and any members (alsoPage) and teams (teams) named, with the two catch-all on-call rules that page it for every new incident and alert. Use it with set_up_website_monitoring, in the same answer, when the person asks to be paged, texted or called. A project that already has on-call policies or rules keeps them: query_on_call_policies first, and do not propose it there. Pass reachMeBy with how the person asked to be reached ('text me' is sms): the card then says what is missing, since a phone number or the app is added and verified by the person, never by you. It always shows the person an approval card, in every mode.",
  inputSchema: {
    type: "object",
    properties: {
      includeMe: {
        type: "boolean",
        description:
          "Page the person asking. Defaults to true; false only when they asked to page others instead of themselves.",
      },
      alsoPage: {
        type: "array",
        items: { type: "string" },
        description:
          "Other members of the project to page too, each by the name or email the project knows them by (query_teams lists members by name).",
      },
      teams: {
        type: "array",
        items: { type: "string" },
        description: "Teams of the project to page, by name (query_teams).",
      },
      reachMeBy: {
        type: "array",
        items: {
          type: "string",
          enum: Object.values(SetupReachMethod),
        },
        description:
          "How the person asked to be reached: sms ('text me'), call ('phone me'), push ('notify my phone'), email. Leave it out when they did not say.",
      },
    },
  },
  get requiredPermissions(): Array<Permission> {
    return getPagingPermissionGroups()[0]!;
  },
  getRequiredPermissionGroups: (): Array<Array<Permission>> => {
    return getPagingPermissionGroups();
  },
  isMutation: true,
  setupAction: { planOrder: SETUP_PLAN_ORDER.paging },
  buildActionTitle: (): AIActionSentence => {
    return aiActionSentence(AI_ACTION_TITLES.createOnCallPolicy, {
      policy: JSON.stringify(GUIDED_SETUP_POLICY_NAME),
    });
  },
  /*
   * Who it pages, resolved to the project's members and teams and written
   * out by id, so what runs is what the card named; and what is missing
   * for the person to be reached the way they asked.
   */
  prepareMutation: async (
    args: JSONObject,
    ctx: ToolContext,
  ): Promise<PreparedMutation> => {
    let responders: PagingResponders = {
      includesMe: ToolArgs.getBoolean(args, "includeMe") !== false,
      people: [],
      teams: [],
      notFound: [],
    };

    try {
      responders = await readPagingResponders(args, ctx);
    } catch (error) {
      logger.debug(
        `set_up_paging could not read who to page: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    const myId: string | undefined = ctx.props.userId?.toString();
    const userIds: Array<string> = [
      ...(responders.includesMe && myId ? [myId] : []),
      ...responders.people.map((person: { id: string }): string => {
        return person.id;
      }),
    ];
    const teamIds: Array<string> = responders.teams.map(
      (team: { id: string }): string => {
        return team.id;
      },
    );

    const description: Array<AIActionSentence> = [];

    if (userIds.length + teamIds.length > 0) {
      description.push(
        describePagedForPerson(responders, {
          you: AI_ACTION_LINES.pagesYouForEveryNewEvent,
          youAndOthers: AI_ACTION_LINES.pagesYouAndOthersForEveryNewEvent,
          others: AI_ACTION_LINES.pagesOthersForEveryNewEvent,
        }),
      );
    }

    if (responders.notFound.length > 0) {
      description.push(
        aiActionSentence(AI_ACTION_LINES.respondersNotFound, {
          names: aiActionList(responders.notFound.map(plainName)),
        }),
      );
    }

    if (responders.includesMe) {
      description.push(
        ...describeReachForPerson({
          asked: readReachMethods(args),
          readiness: await readMyReadiness(ctx),
        }),
      );
    }

    return {
      arguments: {
        ...args,
        includeMe: responders.includesMe,
        userIds: userIds,
        teamIds: teamIds,
        otherPeople: responders.people.map((person: { name: string }) => {
          return person.name;
        }),
        pagedTeams: responders.teams.map((team: { name: string }) => {
          return team.name;
        }),
      },
      description: description,
      describedArguments: PAGING_PREPARED_ARGUMENTS,
    };
  },
  checkBeforeApproval: async (
    args: JSONObject,
    ctx: ToolContext,
  ): Promise<SetupActionRefusal | null> => {
    const counts: PagingCounts | null = await readPagingCounts(ctx);

    if (!counts) {
      return {
        toldModel:
          "Nothing proposed: the person may not read this project's on-call policies and rules, so Ask AI cannot tell whether it pages people already, and making a policy beside them could page twice. Tell them a project admin can set up paging, and that a monitor they set up emails them, its owner, when its status changes.",
        refusal: AIToolRefusal.Permission,
      };
    }

    if (pagesPeopleAlready(counts)) {
      return { toldModel: PROJECT_PAGES_ALREADY(counts) };
    }

    const responders: PreparedResponders = readPreparedResponders(args);

    if (responders.userIds.length + responders.teamIds.length === 0) {
      return { toldModel: NOBODY_TO_PAGE };
    }

    return null;
  },
  execute: async (
    args: JSONObject,
    ctx: ToolContext,
  ): Promise<ToolExecutionResult> => {
    /*
     * Asked again now: a policy may have been made since the card was
     * shown, and a second one paging for every incident would page twice.
     */
    const counts: PagingCounts | null = await readPagingCounts(ctx);

    if (counts && pagesPeopleAlready(counts)) {
      throw new BadDataException(PROJECT_PAGES_ALREADY(counts));
    }

    const responders: PreparedResponders = readPreparedResponders(args);

    if (responders.userIds.length + responders.teamIds.length === 0) {
      throw new BadDataException(NOBODY_TO_PAGE);
    }

    // The guided setup's policy, for the same answers (Common/Utils/GuidedSetup).
    const create: FirstOnCallPolicyCreate = buildFirstOnCallPolicy({
      userIds: responders.userIds,
      teamIds: responders.teamIds,
    });
    create.policy.projectId = ctx.projectId;

    /*
     * As the person: OnCallDutyPolicyService.create checks that they may
     * add the escalation rule and both on-call rules, and that everyone it
     * pages is the project's, before anything is saved.
     */
    const created: OnCallDutyPolicy = await OnCallDutyPolicyService.create({
      data: create.policy,
      miscDataProps: create.miscDataProps,
      props: ctx.props,
    });

    const policyId: string = created.id!.toString();
    const myId: string | undefined = ctx.props.userId?.toString();
    const includesMe: boolean = Boolean(
      myId && responders.userIds.includes(myId),
    );
    const toResponder: (name: string) => { id: string; name: string } = (
      name: string,
    ): { id: string; name: string } => {
      return { id: "", name: name };
    };

    const pagedLine: AIActionSentence = describePagedForPerson(
      {
        includesMe: includesMe,
        people: responders.otherPeople.map(toResponder),
        teams: responders.pagedTeams.map(toResponder),
      },
      {
        you: AI_ACTION_CARD_LINES.pagesYouForEveryNewEvent,
        youAndOthers: AI_ACTION_CARD_LINES.pagesYouAndOthersForEveryNewEvent,
        others: AI_ACTION_CARD_LINES.pagesOthersForEveryNewEvent,
      },
    );

    const pagedNames: Array<string> = [
      ...(includesMe ? ["the person asking"] : []),
      ...responders.otherPeople,
      ...responders.pagedTeams.map((team: string): string => {
        return `the ${team} team`;
      }),
    ];

    const serialized: SerializedResult = ToolResultSerializer.serializeRows([
      {
        id: policyId,
        name: GUIDED_SETUP_POLICY_NAME,
        pagesThePersonAsking: includesMe,
        otherPeoplePaged: responders.otherPeople.join(", "),
        teamsPaged: responders.pagedTeams.join(", "),
        runsFor: "every new incident and alert",
      },
    ]);

    return {
      dataForLlm: `Created the on-call policy "${GUIDED_SETUP_POLICY_NAME}". Its first escalation rule pages ${pagedNames.join(", ")}, and two on-call rules run it for every new incident and alert, so every monitor that opens one pages them. How a page reaches each person is their own notification rules and verified methods (Notification Methods). If the approval card said a phone number or the app is missing, tell the person to add and verify it in Notification Methods, and end with that page's citation (find_dashboard_page "Notification Methods"). Under your answer the person can test the policy with a test page; offer it in one sentence and never say one was sent.\n${serialized.text}`,
      rowCount: 1,
      citationLabel: `Created on-call policy "${GUIDED_SETUP_POLICY_NAME}"`,
      citationTarget: {
        type: AIChatCitationTargetType.OnCallPolicyView,
        params: { onCallDutyPolicyId: policyId },
      },
      redactionCount: serialized.redactionCount,
      isTruncated: false,
      widget: WidgetBuilder.actionCard({
        title: "On-call policy created",
        heading: GUIDED_SETUP_POLICY_NAME,
        words: {
          kind: aiActionTerm(AI_ACTION_CARD_KINDS.onCallPolicy),
          line: [pagedLine],
        },
        link: {
          type: AIChatCitationTargetType.OnCallPolicyView,
          params: { onCallDutyPolicyId: policyId },
        },
        testPage: {
          kind: "policy",
          policyId: policyId,
          policyName: GUIDED_SETUP_POLICY_NAME,
        },
      }),
    };
  },
};

/*
 * ---------------------------------------------------------------------------
 * publish_status_page
 * ---------------------------------------------------------------------------
 */

// The name a status page is published under: the call's, else "<project> Status".
async function readStatusPageName(
  args: JSONObject,
  ctx: ToolContext,
): Promise<string> {
  const named: string | undefined = ToolArgs.getString(args, "name");

  if (named) {
    return named;
  }

  try {
    /*
     * Read as OneUptime: the person names a page of their own project, and
     * a project's name is read by fewer people than the project (its Billing
     * roles read the project, not its name), so a read with their props
     * could be refused, and the page named plain "Status".
     */
    const project: Project | null = await ProjectService.findOneById({
      id: ctx.projectId,
      select: { _id: true, name: true },
      props: { isRoot: true },
    });
    /*
     * The guided setup's name for it, in the person's language (#7247):
     * "Status von Acme" for a reader of German, as the guided setup
     * starts it. "Status" only when the project cannot be read, as
     * every project has a name.
     */
    const name: string = getDefaultStatusPageName({
      translator: getRecordWordsTranslator(await readSetupRecordsLanguage(ctx)),
      projectName: project?.name || undefined,
    });

    return name || "Status";
  } catch {
    return "Status";
  }
}

const NO_MONITORS_TO_SHOW: (notFound: ReadonlyArray<string>) => string = (
  notFound: ReadonlyArray<string>,
): string => {
  return `Nothing proposed: a status page shows monitors, and ${
    notFound.length > 0
      ? `none of the ones named (${notFound.join(", ")}) is a monitor of this project the person can see`
      : "no monitor was named"
  }. Find the project's monitors with query_monitors and name them by their names, or propose set_up_website_monitoring for a new one in the same answer.`;
};

export const PublishStatusPageTool: ObservabilityTool = {
  name: "publish_status_page",
  description:
    "Publish a status page that shows monitors, as the status page guided setup does: the page is created together with the monitors it shows - each with its status, uptime and history - and is public at its link from that moment. Name the monitors by their names (query_monitors), or by the address of one set_up_website_monitoring sets up in the same answer. The name defaults to '<project name> Status', in the language the person reads the Dashboard in. Use it for 'publish a status page', 'show our uptime to customers'. It always shows the person an approval card, in every mode.",
  inputSchema: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description:
          "The status page's name, at least two characters. Defaults to the project's name and 'Status'.",
      },
      monitors: {
        type: "array",
        items: { type: "string" },
        description:
          "The monitors it shows, by name, in the order to show them (at least one).",
      },
    },
    required: ["monitors"],
  },
  get requiredPermissions(): Array<Permission> {
    return getStatusPagePermissionGroups()[0]!;
  },
  getRequiredPermissionGroups: (): Array<Array<Permission>> => {
    return getStatusPagePermissionGroups();
  },
  isMutation: true,
  setupAction: { planOrder: SETUP_PLAN_ORDER.statusPage },
  buildActionTitle: (args: JSONObject): AIActionSentence => {
    return aiActionSentence(AI_ACTION_TITLES.publishStatusPage, {
      name: JSON.stringify(ToolArgs.getString(args, "name") || "Status"),
    });
  },
  // The name it is published under written out, and what it shows.
  prepareMutation: async (
    args: JSONObject,
    ctx: ToolContext,
  ): Promise<PreparedMutation> => {
    const name: string = await readStatusPageName(args, ctx);
    const prepared: JSONObject = { ...args, name: name };
    const description: Array<AIActionSentence> = [
      aiActionSentence(AI_ACTION_LINES.statusPageIsPublic),
    ];

    try {
      const monitors: MonitorsToShow = await readMonitorsToShow(
        ctx,
        readNames(args, "monitors"),
      );

      if (monitors.existing.length + monitors.setUpInPlan.length > 0) {
        description.push(
          aiActionSentence(AI_ACTION_LINES.statusPageShows, {
            monitors: describeMonitorsToShow(monitors),
          }),
        );
      }

      if (monitors.notFound.length > 0) {
        description.push(
          aiActionSentence(AI_ACTION_LINES.monitorsNotFound, {
            names: aiActionList(monitors.notFound.map(quotedName)),
          }),
        );
      }
    } catch {
      // Unreadable now: running it says why.
    }

    return {
      arguments: prepared,
      title: aiActionSentence(AI_ACTION_TITLES.publishStatusPage, {
        name: JSON.stringify(name),
      }),
      namedArguments: ["name"],
      description: description,
      describedArguments: ["monitors"],
    };
  },
  checkBeforeApproval: async (
    args: JSONObject,
    ctx: ToolContext,
  ): Promise<SetupActionRefusal | null> => {
    const name: string = ToolArgs.getString(args, "name") || "";

    if (name.length < STATUS_PAGE_NAME_MIN_LENGTH) {
      return {
        toldModel:
          "Nothing proposed: a status page's name needs at least two characters. Ask the person what to call it.",
      };
    }

    try {
      const monitors: MonitorsToShow = await readMonitorsToShow(
        ctx,
        readNames(args, "monitors"),
      );

      if (monitors.existing.length + monitors.setUpInPlan.length === 0) {
        return { toldModel: NO_MONITORS_TO_SHOW(monitors.notFound) };
      }
    } catch {
      // Unreadable now: running it says why.
    }

    return null;
  },
  execute: async (
    args: JSONObject,
    ctx: ToolContext,
  ): Promise<ToolExecutionResult> => {
    const name: string = (ToolArgs.getString(args, "name") || "").trim();

    if (name.length < STATUS_PAGE_NAME_MIN_LENGTH) {
      throw new BadDataException(
        "A status page's name needs at least two characters.",
      );
    }

    /*
     * Read again now: a monitor its plan set up exists by now, or was
     * skipped. Never an empty page: nothing to show makes nothing.
     */
    const monitors: FoundMonitors = await findMonitorsByName(
      ctx,
      readNames(args, "monitors"),
    );

    if (monitors.found.length === 0) {
      throw new BadDataException(NO_MONITORS_TO_SHOW(monitors.notFound));
    }

    // The guided setup's page, for the same answers (Common/Utils/GuidedSetup).
    const created: StatusPage = await StatusPageService.create({
      data: buildGuidedStatusPage({ name: name, projectId: ctx.projectId }),
      props: ctx.props,
    });

    const statusPageId: ObjectID = created.id!;
    const result: AddedMonitors = await addMonitorsToPage(ctx, {
      statusPageId: statusPageId,
      monitors: monitors.found,
    });

    let publicUrl: string = "";

    try {
      publicUrl = await StatusPageService.getStatusPageURL(statusPageId);
    } catch {
      publicUrl = "";
    }

    const shown: Array<SetupMonitor> = [
      ...result.added,
      ...result.alreadyShown,
    ];
    const serialized: SerializedResult = ToolResultSerializer.serializeRows([
      {
        id: statusPageId.toString(),
        name: name,
        isPublic: true,
        ...(publicUrl ? { publicLink: publicUrl } : {}),
        shows: shown
          .map((monitor: SetupMonitor): string => {
            return monitor.name;
          })
          .join(", "),
        ...(result.failed.length > 0
          ? {
              notAdded: result.failed
                .map((failure: { monitor: SetupMonitor; reason: string }) => {
                  return `${failure.monitor.name} (${failure.reason})`;
                })
                .join("; "),
            }
          : {}),
        ...(monitors.notFound.length > 0
          ? { notFound: monitors.notFound.join(", ") }
          : {}),
      },
    ]);

    return {
      dataForLlm: `Published the status page "${name}"${publicUrl ? ` at ${publicUrl}` : ""}. It is public: anyone with its link sees ${
        shown.length > 0
          ? `the status, uptime and history of ${shown
              .map((monitor: SetupMonitor): string => {
                return `"${monitor.name}"`;
              })
              .join(", ")}`
          : "nothing yet"
      }.${
        result.failed.length > 0
          ? ` Not added: ${result.failed
              .map((failure: { monitor: SetupMonitor; reason: string }) => {
                return `"${failure.monitor.name}" (${failure.reason})`;
              })
              .join("; ")}.`
          : ""
      }${
        monitors.notFound.length > 0
          ? ` Not found, so not shown: ${monitors.notFound.join(", ")}.`
          : ""
      } An incident on these monitors appears on it by itself, and subscribers are emailed; alerts never do.\n${serialized.text}`,
      rowCount: 1,
      citationLabel: `Published status page "${name}"`,
      citationTarget: {
        type: AIChatCitationTargetType.StatusPageView,
        params: { statusPageId: statusPageId.toString() },
      },
      redactionCount: serialized.redactionCount,
      isTruncated: false,
      widget: WidgetBuilder.actionCard({
        title: "Status page published",
        heading: name,
        words: {
          kind: aiActionTerm(AI_ACTION_CARD_KINDS.statusPage),
          line: [aiActionSentence(AI_ACTION_CARD_LINES.statusPagePublished)],
          facts: [
            ...(publicUrl
              ? [aiActionCardFact(AI_ACTION_CARD_FACTS.publicLink, publicUrl)]
              : []),
            ...(shown.length > 0
              ? [
                  aiActionCardFact(
                    AI_ACTION_CARD_FACTS.shows,
                    aiActionList(
                      shown.map((monitor: SetupMonitor): AIActionSentence => {
                        return quotedName(monitor.name);
                      }),
                    ),
                  ),
                ]
              : []),
            ...(result.failed.length > 0
              ? [
                  aiActionCardFact(
                    AI_ACTION_CARD_FACTS.notAdded,
                    aiActionList(
                      result.failed.map(
                        (failure: {
                          monitor: SetupMonitor;
                        }): AIActionSentence => {
                          return quotedName(failure.monitor.name);
                        },
                      ),
                    ),
                  ),
                ]
              : []),
          ],
        },
        link: {
          type: AIChatCitationTargetType.StatusPageView,
          params: { statusPageId: statusPageId.toString() },
        },
      }),
    };
  },
};

/*
 * ---------------------------------------------------------------------------
 * add_monitors_to_status_page
 * ---------------------------------------------------------------------------
 */

// A status page of the project, by its id or its name (without case), as the person reads it.
async function findStatusPage(
  args: JSONObject,
  ctx: ToolContext,
): Promise<StatusPage | null> {
  const named: string | undefined = ToolArgs.getString(args, "statusPage");
  const statusPageId: string | undefined = ToolArgs.getString(
    args,
    "statusPageId",
  );

  if (statusPageId && ObjectID.isValidUUID(statusPageId)) {
    return await StatusPageService.findOneBy({
      query: { _id: statusPageId, projectId: ctx.projectId },
      select: { _id: true, name: true },
      props: ctx.props,
    });
  }

  if (!named) {
    return null;
  }

  if (ObjectID.isValidUUID(named)) {
    return await StatusPageService.findOneBy({
      query: { _id: named, projectId: ctx.projectId },
      select: { _id: true, name: true },
      props: ctx.props,
    });
  }

  return await StatusPageService.findOneBy({
    query: {
      projectId: ctx.projectId,
      name: QueryHelper.findWithSameText(named),
    },
    select: { _id: true, name: true },
    props: ctx.props,
  });
}

const NO_SUCH_STATUS_PAGE: (named: string) => string = (
  named: string,
): string => {
  return `Nothing proposed: ${
    named
      ? `"${named}" is no status page of this project`
      : "no status page was named"
  }. Find it with query_status_pages, or propose publish_status_page to make one.`;
};

export const AddMonitorsToStatusPageTool: ObservabilityTool = {
  name: "add_monitors_to_status_page",
  description:
    "Add monitors to an existing status page, as Add Multiple Monitors does: each with its status, uptime and history, after the ones it shows; monitors it shows already are left as they are. Name the page by its name (query_status_pages) and the monitors by their names (query_monitors), or by the address of one set_up_website_monitoring sets up in the same answer. It always shows the person an approval card, in every mode.",
  inputSchema: {
    type: "object",
    properties: {
      statusPage: {
        type: "string",
        description: "The status page, by its name.",
      },
      monitors: {
        type: "array",
        items: { type: "string" },
        description: "The monitors to add, by name (at least one).",
      },
    },
    required: ["statusPage", "monitors"],
  },
  get requiredPermissions(): Array<Permission> {
    return getStatusPageResourceCreatePermissions();
  },
  isMutation: true,
  setupAction: { planOrder: SETUP_PLAN_ORDER.statusPageMonitors },
  buildActionTitle: (args: JSONObject): AIActionSentence => {
    const named: string | undefined = ToolArgs.getString(args, "statusPage");

    return named && !ObjectID.isValidUUID(named)
      ? aiActionSentence(AI_ACTION_TITLES.addMonitorsToStatusPage, {
          statusPage: JSON.stringify(named),
        })
      : aiActionSentence(AI_ACTION_TITLES.addMonitorsToStatusPageUnnamed);
  },
  // The page written out by id (what the card named is what runs), and what it adds.
  prepareMutation: async (
    args: JSONObject,
    ctx: ToolContext,
  ): Promise<PreparedMutation> => {
    let statusPage: StatusPage | null = null;

    try {
      statusPage = await findStatusPage(args, ctx);
    } catch {
      statusPage = null;
    }

    if (!statusPage?.id) {
      return { arguments: args };
    }

    const description: Array<AIActionSentence> = [];

    try {
      const monitors: MonitorsToShow = await readMonitorsToShow(
        ctx,
        readNames(args, "monitors"),
      );
      const existing: Array<StatusPageResource> =
        await StatusPageResourceService.findBy({
          query: { projectId: ctx.projectId, statusPageId: statusPage.id },
          select: { _id: true, monitorId: true },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          props: ctx.props,
        });
      const shownIds: Set<string> = new Set<string>(
        existing.map((resource: StatusPageResource): string => {
          return resource.monitorId?.toString() || "";
        }),
      );
      const toAdd: MonitorsToShow = {
        existing: monitors.existing.filter((monitor: SetupMonitor): boolean => {
          return !shownIds.has(monitor.id);
        }),
        setUpInPlan: monitors.setUpInPlan,
        notFound: [],
      };
      const alreadyShown: Array<SetupMonitor> = monitors.existing.filter(
        (monitor: SetupMonitor): boolean => {
          return shownIds.has(monitor.id);
        },
      );

      if (toAdd.existing.length + toAdd.setUpInPlan.length > 0) {
        description.push(
          aiActionSentence(AI_ACTION_LINES.adds, {
            resources: describeMonitorsToShow(toAdd),
          }),
        );
      }

      if (alreadyShown.length > 0) {
        description.push(
          aiActionSentence(AI_ACTION_LINES.alreadyOnStatusPage, {
            monitors: aiActionList(
              alreadyShown.map((monitor: SetupMonitor): AIActionSentence => {
                return quotedName(monitor.name);
              }),
            ),
          }),
        );
      }

      if (monitors.notFound.length > 0) {
        description.push(
          aiActionSentence(AI_ACTION_LINES.monitorsNotFound, {
            names: aiActionList(monitors.notFound.map(quotedName)),
          }),
        );
      }
    } catch {
      // Unreadable now: running it says why.
    }

    const name: string = statusPage.name || "";

    return {
      arguments: { ...args, statusPageId: statusPage.id.toString() },
      ...(name
        ? {
            title: aiActionSentence(AI_ACTION_TITLES.addMonitorsToStatusPage, {
              statusPage: JSON.stringify(name),
            }),
            namedArguments: ["statusPage", "statusPageId"],
          }
        : {}),
      description: description,
      describedArguments: ["monitors"],
    };
  },
  checkBeforeApproval: async (
    args: JSONObject,
    ctx: ToolContext,
  ): Promise<SetupActionRefusal | null> => {
    try {
      const statusPage: StatusPage | null = await findStatusPage(args, ctx);

      if (!statusPage?.id) {
        return {
          toldModel: NO_SUCH_STATUS_PAGE(
            ToolArgs.getString(args, "statusPage") || "",
          ),
        };
      }

      const monitors: MonitorsToShow = await readMonitorsToShow(
        ctx,
        readNames(args, "monitors"),
      );

      if (monitors.existing.length + monitors.setUpInPlan.length === 0) {
        return { toldModel: NO_MONITORS_TO_SHOW(monitors.notFound) };
      }
    } catch {
      // Unreadable now: running it says why.
    }

    return null;
  },
  execute: async (
    args: JSONObject,
    ctx: ToolContext,
  ): Promise<ToolExecutionResult> => {
    const statusPage: StatusPage | null = await findStatusPage(args, ctx);

    if (!statusPage?.id) {
      throw new BadDataException(
        NO_SUCH_STATUS_PAGE(ToolArgs.getString(args, "statusPage") || ""),
      );
    }

    const monitors: FoundMonitors = await findMonitorsByName(
      ctx,
      readNames(args, "monitors"),
    );

    if (monitors.found.length === 0) {
      throw new BadDataException(NO_MONITORS_TO_SHOW(monitors.notFound));
    }

    const result: AddedMonitors = await addMonitorsToPage(ctx, {
      statusPageId: statusPage.id,
      monitors: monitors.found,
    });

    if (result.added.length === 0 && result.alreadyShown.length === 0) {
      throw new BadDataException(
        `No monitor was added to "${statusPage.name}": ${result.failed
          .map((failure: { monitor: SetupMonitor; reason: string }) => {
            return `"${failure.monitor.name}" (${failure.reason})`;
          })
          .join("; ")}.`,
      );
    }

    const name: string = statusPage.name || "";
    const quoted: (list: Array<SetupMonitor>) => string = (
      list: Array<SetupMonitor>,
    ): string => {
      return list
        .map((monitor: SetupMonitor): string => {
          return `"${monitor.name}"`;
        })
        .join(", ");
    };
    const serialized: SerializedResult = ToolResultSerializer.serializeRows([
      {
        id: statusPage.id.toString(),
        name: name,
        added: quoted(result.added),
        ...(result.alreadyShown.length > 0
          ? { alreadyShown: quoted(result.alreadyShown) }
          : {}),
        ...(result.failed.length > 0
          ? {
              notAdded: result.failed
                .map((failure: { monitor: SetupMonitor; reason: string }) => {
                  return `${failure.monitor.name} (${failure.reason})`;
                })
                .join("; "),
            }
          : {}),
      },
    ]);

    return {
      dataForLlm: `${
        result.added.length > 0
          ? `Added ${quoted(result.added)} to the status page "${name}".`
          : `Nothing was added to the status page "${name}".`
      }${
        result.alreadyShown.length > 0
          ? ` It already showed ${quoted(result.alreadyShown)}.`
          : ""
      }${
        result.failed.length > 0
          ? ` Not added: ${result.failed
              .map((failure: { monitor: SetupMonitor; reason: string }) => {
                return `"${failure.monitor.name}" (${failure.reason})`;
              })
              .join("; ")}.`
          : ""
      }${
        monitors.notFound.length > 0
          ? ` Not found, so not added: ${monitors.notFound.join(", ")}.`
          : ""
      }\n${serialized.text}`,
      rowCount: 1,
      citationLabel: `Added monitors to status page "${name}"`,
      citationTarget: {
        type: AIChatCitationTargetType.StatusPageView,
        params: { statusPageId: statusPage.id.toString() },
      },
      redactionCount: serialized.redactionCount,
      isTruncated: false,
      widget: WidgetBuilder.actionCard({
        title: "Monitors added to the status page",
        heading: name,
        words: {
          kind: aiActionTerm(AI_ACTION_CARD_KINDS.statusPage),
          line:
            result.added.length > 0
              ? [
                  aiActionSentence(AI_ACTION_CARD_LINES.monitorsAdded, {
                    monitors: aiActionList(
                      result.added.map(
                        (monitor: SetupMonitor): AIActionSentence => {
                          return quotedName(monitor.name);
                        },
                      ),
                    ),
                  }),
                ]
              : [],
          facts:
            result.failed.length > 0
              ? [
                  aiActionCardFact(
                    AI_ACTION_CARD_FACTS.notAdded,
                    aiActionList(
                      result.failed.map(
                        (failure: {
                          monitor: SetupMonitor;
                        }): AIActionSentence => {
                          return quotedName(failure.monitor.name);
                        },
                      ),
                    ),
                  ),
                ]
              : [],
        },
        link: {
          type: AIChatCitationTargetType.StatusPageView,
          params: { statusPageId: statusPage.id.toString() },
        },
      }),
    };
  },
};

/*
 * The setup actions, in the order a plan runs them. Their names are the
 * ones Types/AI/AISetupActions gives the Dashboard (a test holds them to
 * it).
 */
export const SETUP_TOOLS: ReadonlyArray<ObservabilityTool> = [
  SetUpPagingTool,
  SetUpWebsiteMonitoringTool,
  PublishStatusPageTool,
  AddMonitorsToStatusPageTool,
];

/*
 * The names Types/AI/AISetupActions gives the Dashboard, in the same
 * order: a tool renamed here without it fails SetupTools' own test.
 */
export const SETUP_TOOL_NAMES: ReadonlyArray<string> = [
  SET_UP_PAGING_TOOL_NAME,
  SET_UP_WEBSITE_MONITORING_TOOL_NAME,
  PUBLISH_STATUS_PAGE_TOOL_NAME,
  ADD_MONITORS_TO_STATUS_PAGE_TOOL_NAME,
];
