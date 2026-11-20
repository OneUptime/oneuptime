import AlertOnCallRule from "../../../../Models/DatabaseModels/AlertOnCallRule";
import AlertSeverity from "../../../../Models/DatabaseModels/AlertSeverity";
import IncidentOnCallRule from "../../../../Models/DatabaseModels/IncidentOnCallRule";
import IncidentSeverity from "../../../../Models/DatabaseModels/IncidentSeverity";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import MonitorStatus from "../../../../Models/DatabaseModels/MonitorStatus";
import OnCallDutyPolicy from "../../../../Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicyEscalationRule from "../../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRule";
import OnCallDutyPolicyEscalationRuleTeam from "../../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRuleTeam";
import OnCallDutyPolicyEscalationRuleUser from "../../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRuleUser";
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
  AI_ACTION_NEW_MONITOR,
  AI_ACTION_PLURAL_LINES,
  AI_ACTION_TEAM,
  AI_ACTION_TITLES,
  AIActionList,
  AIActionSentence,
  aiActionCardFact,
  aiActionFigure,
  aiActionList,
  aiActionPluralSentence,
  aiActionSentence,
  aiActionTerm,
  AIActionSentenceValue,
} from "../../../../Types/AI/AIActionWords";
import {
  getProbeAgreementSentence,
  getProbeAgreementWords,
  ProbeAgreementWords,
} from "../../../../Utils/Monitor/ProbeAgreementRule";
import { createTranslator, Translator } from "../../../../Types/Translator";
import {
  ADD_MONITORS_TO_STATUS_PAGE_TOOL_NAME,
  ADD_TO_ON_CALL_POLICY_TOOL_NAME,
  INVITE_PEOPLE_TOOL_NAME,
  PUBLISH_STATUS_PAGE_TOOL_NAME,
  SET_HOW_TO_REACH_ME_TOOL_NAME,
  SET_UP_PAGING_TOOL_NAME,
  SET_UP_SERVICE_MONITOR_TOOL_NAME,
  SET_UP_WEBSITE_MONITORING_TOOL_NAME,
} from "../../../../Types/AI/AISetupActions";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "../../../../Types/Database/LimitMax";
import Email from "../../../../Types/Email";
import BadDataException from "../../../../Types/Exception/BadDataException";
import ConflictException from "../../../../Types/Exception/ConflictException";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import {
  DEFAULT_ESCALATE_AFTER_IN_MINUTES,
  getDefaultEscalationRuleName,
} from "../../../../Types/OnCallDutyPolicy/EscalationRuleDefaults";
import Permission from "../../../../Types/Permission";
import PositiveNumber from "../../../../Types/PositiveNumber";
import {
  FirstOnCallPolicyCreate,
  GUIDED_SETUP_POLICY_NAME,
  MAX_LEVEL_WAIT_IN_MINUTES,
  OnCallPolicyLevelCreate,
  OnCallPolicyLevelMembers,
  WhoIsToldMode,
  buildFirstOnCallPolicy,
  buildLevelMembers,
  buildLevelWait,
  buildOnCallPolicyLevel,
  buildPolicyRepeat,
  countRulesRunningPolicyInService,
  getFirstOnCallPolicyName,
  getWhoIsToldMode,
  readPolicyRepeatTimes,
} from "../../../../Utils/GuidedSetup/OnCallPolicyRecords";
import { createWithFreeName } from "../../../../Types/Database/UniqueName";
import {
  ESCALATION_RULE_TEAM_INDEX,
  ESCALATION_RULE_USER_INDEX,
} from "../../../../Types/OnCallDutyPolicy/EscalationRuleResponderOnce";
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
  isMonitorCheckingAddress,
  parseWebsiteAddress,
  pickWebsiteMonitorSeeds,
} from "../../../../Utils/GuidedSetup/WebsiteMonitorRecords";
import QueryHelper from "../../../Types/Database/QueryHelper";
import PostgresErrorTranslator from "../../Database/PostgresErrorTranslator";
import AlertOnCallRuleService from "../../../Services/AlertOnCallRuleService";
import AlertSeverityService from "../../../Services/AlertSeverityService";
import IncidentOnCallRuleService from "../../../Services/IncidentOnCallRuleService";
import IncidentSeverityService from "../../../Services/IncidentSeverityService";
import MonitorProbeService from "../../../Services/MonitorProbeService";
import MonitorService from "../../../Services/MonitorService";
import MonitorStatusService from "../../../Services/MonitorStatusService";
import OnCallDutyPolicyEscalationRuleService from "../../../Services/OnCallDutyPolicyEscalationRuleService";
import OnCallDutyPolicyEscalationRuleTeamService from "../../../Services/OnCallDutyPolicyEscalationRuleTeamService";
import OnCallDutyPolicyEscalationRuleUserService from "../../../Services/OnCallDutyPolicyEscalationRuleUserService";
import OnCallDutyPolicyService from "../../../Services/OnCallDutyPolicyService";
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
import logger from "../../Logger";
import UserLanguage from "../../Notification/UserLanguage";
import { getRecordWordsTranslator } from "../../ServerTranslation";
import { readRequestedReaderLanguage } from "../../../../Types/ReaderLanguage";
import ToolResultSerializer, { SerializedResult } from "./Serializer";
import {
  SETUP_PLAN_ORDER,
  SetupTestPageTarget,
  addMemberUsers,
  countMonitorsSetUpInPlan,
  describeMonitorPriceForPerson,
  getMissingMethodAdviceForModel,
  getTestPageOfferForModel,
  plainName,
  quotedName,
  readMonitorPlanRefusal,
  readNames,
  readWebsiteMonitors,
} from "./SetupPlan";
import { InvitePeopleTool, readInviteEmails } from "./SetupInviteTools";
import { SetHowToReachMeTool } from "./SetupLadderTools";
import { SetUpServiceMonitorTool } from "./SetupServiceMonitorTools";
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

import { AI_TOOL_CITATIONS } from "../../../../Types/AI/AIReadTableWords";
import { citationSentence } from "./ReadTableWords";
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
 * The order a plan's parts run in, how names are read and said, and the
 * plan's room for monitors: SetupPlan's, which every setup action reads.
 */
export {
  SETUP_PLAN_ORDER,
  countMonitorsSetUpInPlan,
  readMonitorPlanRefusal,
  readNames,
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
 * How many status pages the same plan publishes: one for each
 * publish_status_page call, and at least the one being checked - the
 * Free plan's limit is on them all (#7250).
 */
export function countStatusPagesSetUpInPlan(
  plannedCalls: ReadonlyArray<PlannedToolCall> | undefined,
): number {
  const count: number = (plannedCalls || []).filter(
    (call: PlannedToolCall): boolean => {
      return call.name === PUBLISH_STATUS_PAGE_TOOL_NAME;
    },
  ).length;

  return Math.max(1, count);
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

/*
 * How many of the project's on-call policies in service, and of its
 * on-call rules that run one, the person can count.
 */
export interface PagingCounts {
  policyCount: number;
  incidentRuleCount: number;
  alertRuleCount: number;
}

// What an on-call rule is read with: the policies it runs, archived or not.
const RULE_WITH_POLICIES_SELECT: {
  _id: true;
  onCallDutyPolicies: { _id: true; isArchived: true };
} = {
  _id: true,
  onCallDutyPolicies: { _id: true, isArchived: true },
};

/*
 * The project's on-call policies and rules, counted as the person, as the
 * website-down guided setup counts them (WebsiteDownApi.loadWhoIsToldFacts):
 * null when they may not read them, which makes nothing
 * (WhoIsToldMode.OwnerEmailOnly). Only what pages people counts. An
 * archived policy pages no one, so it is left out (#8234), and a rule
 * counts only when it runs a policy in service (#8433): a project whose
 * only policy was archived, with the rules that run it, was told it pages
 * people already, and nothing was proposed (#8518).
 */
async function readPagingCounts(
  ctx: ToolContext,
): Promise<PagingCounts | null> {
  try {
    const [policies, incidentRules, alertRules]: [
      PositiveNumber,
      Array<IncidentOnCallRule>,
      Array<AlertOnCallRule>,
    ] = await Promise.all([
      OnCallDutyPolicyService.countBy({
        query: { projectId: ctx.projectId, isArchived: false },
        props: ctx.props,
      }),
      IncidentOnCallRuleService.findBy({
        query: { projectId: ctx.projectId },
        select: RULE_WITH_POLICIES_SELECT,
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        props: ctx.props,
      }),
      AlertOnCallRuleService.findBy({
        query: { projectId: ctx.projectId },
        select: RULE_WITH_POLICIES_SELECT,
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        props: ctx.props,
      }),
    ]);

    return {
      policyCount: policies.toNumber(),
      incidentRuleCount: countRulesRunningPolicyInService(incidentRules || []),
      alertRuleCount: countRulesRunningPolicyInService(alertRules || []),
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

// A monitor of the project that checks an address now (#7292).
export interface MonitorCheckingAddress extends SetupMonitor {
  // Made by the person asking.
  isOwn: boolean;
}

/*
 * The monitor among these that checks the address now, by the website
 * guided setup's rule (isMonitorCheckingAddress: the same address, neither
 * archived nor turned off): the person's own first, as the guided setup
 * looks for theirs before a teammate's, then the newest. A monitor someone
 * else made - a teammate, the API, Terraform - watches the address just as
 * well. Null when none does.
 */
export function pickMonitorCheckingAddress(data: {
  monitors: ReadonlyArray<Monitor>;
  address: WebsiteAddress;
  userId?: string | undefined;
}): MonitorCheckingAddress | null {
  const checking: Array<Monitor> = data.monitors.filter(
    (monitor: Monitor): boolean => {
      return (
        Boolean(monitor.id) &&
        isMonitorCheckingAddress({ monitor: monitor, address: data.address })
      );
    },
  );
  const own: Monitor | undefined = data.userId
    ? checking.find((monitor: Monitor): boolean => {
        return monitor.createdByUserId?.toString() === data.userId;
      })
    : undefined;
  const found: Monitor | undefined = own || checking[0];

  if (!found?.id) {
    return null;
  }

  return {
    id: found.id.toString(),
    name: found.name || data.address.monitorName,
    isOwn: Boolean(own),
  };
}

/*
 * NO SECOND MONITOR FOR AN ADDRESS A MONITOR CHECKS ALREADY (#7292), as
 * the website guided setup makes none (#7059, #7254): the project's monitor
 * that checks it now, read as the person - one they may not read is never
 * seen, and never named. Null when none does.
 */
export async function findMonitorCheckingAddress(
  ctx: ToolContext,
  address: WebsiteAddress,
): Promise<MonitorCheckingAddress | null> {
  return pickMonitorCheckingAddress({
    monitors: await readWebsiteMonitors(ctx),
    address: address,
    userId: ctx.props.userId?.toString(),
  });
}

/*
 * The project's monitors a call names, read as the person: by the name
 * each has (without case), else - for "https://example.com" - by the name
 * the website setup gives an address (example.com), else by the address a
 * monitor checks (#7292): "example.com" names the monitor "Acme website"
 * that checks it. Each monitor once.
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
  const add: (monitor: SetupMonitor) => void = (
    monitor: SetupMonitor,
  ): void => {
    if (
      !found.some((each: SetupMonitor): boolean => {
        return each.id === monitor.id;
      })
    ) {
      found.push(monitor);
    }
  };

  // The project's Website and API monitors, read once, for the addresses named.
  let websiteMonitors: Array<Monitor> | null = null;

  for (const name of names) {
    const address: WebsiteAddress | null = parseWebsiteAddress(name);
    const monitor: Monitor | undefined =
      byName.get(name.trim().toLowerCase()) ||
      (address ? byName.get(address.monitorName.toLowerCase()) : undefined);

    if (monitor) {
      add({ id: monitor.id!.toString(), name: monitor.name || name });
      continue;
    }

    if (address) {
      if (websiteMonitors === null) {
        try {
          websiteMonitors = await readWebsiteMonitors(ctx);
        } catch {
          websiteMonitors = [];
        }
      }

      const checking: MonitorCheckingAddress | null =
        pickMonitorCheckingAddress({
          monitors: websiteMonitors,
          address: address,
          userId: ctx.props.userId?.toString(),
        });

      if (checking) {
        add({ id: checking.id, name: checking.name });
        continue;
      }
    }

    notFound.push(name);
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

/*
 * A monitor checks the address already (#7292): what the model is told
 * instead of a card - its name, so the answer says the address is watched
 * and by what, and what can be done with it instead.
 */
export const MONITOR_CHECKS_ADDRESS_ALREADY: (data: {
  monitor: MonitorCheckingAddress;
  address: WebsiteAddress;
}) => string = (data: {
  monitor: MonitorCheckingAddress;
  address: WebsiteAddress;
}): string => {
  return `Nothing proposed: ${data.monitor.isOwn ? "the person's own monitor" : "the monitor"} "${data.monitor.name}" already checks ${data.address.url}, so no second monitor is made, as the website guided setup makes none. Say so in one sentence, naming it. who_is_told says who it reaches; to show it on a status page, name it in publish_status_page or add_monitors_to_status_page.`;
};

// The address a call names: the parsed one, or null.
function readAddress(args: JSONObject): WebsiteAddress | null {
  return parseWebsiteAddress(ToolArgs.getString(args, "address") || "");
}

/*
 * How many of the locations checking a monitor must agree before its status
 * changes, as the monitor's probes card says it (#8245): a status changes
 * only when its probes agree (MonitorResourceUtil.checkProbeAgreement), and
 * on a new monitor, whose minimum is not set, all of them must. One rule
 * (Utils/Monitor/ProbeAgreementRule), so the card never promises an
 * incident one failing location would not open. Null with fewer than two
 * locations, or a minimum of one: nothing to agree on.
 */
export function describeProbeAgreementForPerson(data: {
  minimumProbeAgreement: number | null | undefined;
  locationCount: number;
}): AIActionSentence | null {
  const words: ProbeAgreementWords | null = getProbeAgreementWords({
    minimumProbeAgreement: data.minimumProbeAgreement,
    activeProbeCount: data.locationCount,
  });

  if (!words) {
    return null;
  }

  // Each count a figure, written in the reader's digits.
  const values: Record<string, AIActionSentenceValue> = {};

  for (const [name, count] of Object.entries(words.values)) {
    values[name] = aiActionFigure(count);
  }

  return aiActionSentence(
    words.template,
    Object.keys(values).length > 0 ? values : undefined,
  );
}

const ENGLISH: Translator = createTranslator(undefined, "en");

/*
 * What the approval card says the monitor will do: what is checked and how
 * often, from where, what happens when it goes down - when its locations
 * agree it is (#8245) - and who is emailed.
 */
export function describeWebsiteMonitoringForPerson(data: {
  address: WebsiteAddress;
  isApi: boolean;
  minutes: number;
  locationCount: number | null;
  incidentSeverityName: string | null;
  // The new monitor's own minimum: not set, so all its locations must agree.
  minimumProbeAgreement?: number | null | undefined;
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

  const agreement: AIActionSentence | null =
    data.locationCount !== null
      ? describeProbeAgreementForPerson({
          minimumProbeAgreement: data.minimumProbeAgreement,
          locationCount: data.locationCount,
        })
      : null;

  if (agreement) {
    sentences.push(agreement);
  }

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

    // What it adds to the bill, on OneUptime Cloud's Free plan (#9995).
    const price: AIActionSentence | null =
      await describeMonitorPriceForPerson(ctx);

    return {
      arguments: prepared,
      description: [
        ...describeWebsiteMonitoringForPerson({
          address: address,
          isApi: isApi,
          minutes: minutes,
          locationCount: await countNewMonitorLocations(ctx),
          incidentSeverityName: incidentSeverityName,
        }),
        ...(price ? [price] : []),
      ],
      describedArguments: ["address", "isApi", "checkEveryMinutes"],
    };
  },
  checkBeforeApproval: async (
    args: JSONObject,
    ctx: ToolContext,
  ): Promise<SetupActionRefusal | null> => {
    const address: WebsiteAddress | null = readAddress(args);

    if (!address) {
      return { toldModel: NOT_AN_ADDRESS };
    }

    // One monitor for one address, as the website guided setup (#7292).
    try {
      const checking: MonitorCheckingAddress | null =
        await findMonitorCheckingAddress(ctx, address);

      if (checking) {
        return {
          toldModel: MONITOR_CHECKS_ADDRESS_ALREADY({
            monitor: checking,
            address: address,
          }),
        };
      }
    } catch {
      // Unreadable now: the card shows, and running it reads again.
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

    /*
     * Asked again now (#7292): a monitor of the address may have been made
     * since the card was shown - by a teammate, or by a second card of
     * the same request - and two would page twice for one outage. A read
     * that fails makes the monitor the card promised.
     */
    let checking: MonitorCheckingAddress | null = null;

    try {
      checking = await findMonitorCheckingAddress(ctx, address);
    } catch {
      checking = null;
    }

    if (checking) {
      throw new BadDataException(
        `The monitor "${checking.name}" already checks ${address.url}, so no second monitor was made.`,
      );
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

    /*
     * The person owns it, as the card said: the server makes the creator of
     * an operational resource its owner (DatabaseService.autoOwnerOnCreate),
     * but never a master admin - and the first person to sign up to a
     * self-hosted server is one. The guided setup makes them the owner, and
     * so does this, quietly (#7409). A failure leaves the monitor as made.
     */
    if (ctx.props.isMasterAdmin && ctx.props.userId) {
      try {
        await MonitorService.addOwners(
          ctx.projectId,
          created.id!,
          [ctx.props.userId],
          [],
          false,
          ctx.props,
        );
      } catch (error) {
        logger.error(
          `set_up_website_monitoring could not make its master admin the owner of monitor ${created.id!.toString()}.`,
        );
        logger.error(error as Error);
      }
    }

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

    /*
     * One failing location opens nothing while the others answer (#8245):
     * the model is told how many must agree, as the card told the person.
     */
    const agreementSentence: string | null =
      locationCount !== null
        ? getProbeAgreementSentence({
            minimumProbeAgreement: created.minimumProbeAgreement,
            activeProbeCount: locationCount,
            translator: ENGLISH,
          })
        : null;

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
      }${agreementSentence ? ` ${agreementSentence}` : ""} The person owns it, so they are emailed when its status changes. Who else is told depends on the project's on-call policies and rules: who_is_told answers it. ${getTestPageOfferForModel(ctx, SetupTestPageTarget.Self)}\n${serialized.text}`,
      rowCount: 1,
      // In the reader's language (issue #8311).
      ...citationSentence(AI_TOOL_CITATIONS.setUpMonitor, {
        name: address.monitorName,
      }),
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
  /*
   * Addresses the same plan invites to the project (#7242), lower case:
   * paged once they join.
   */
  invited: Array<string>;
  // Names that are no member or team of the project.
  notFound: Array<string>;
}

/*
 * The addresses the same plan invites to the project (#7242), each once,
 * without case: a policy in that plan pages them once they join, so it
 * names them as invited rather than as people the project does not have.
 */
export function getEmailsInvitedInPlan(
  plannedCalls: ReadonlyArray<PlannedToolCall> | undefined,
): Array<string> {
  const emails: Array<string> = [];

  for (const call of plannedCalls || []) {
    if (call.name !== INVITE_PEOPLE_TOOL_NAME) {
      continue;
    }

    for (const email of readInviteEmails(call.arguments || {}).emails) {
      if (!emails.includes(email)) {
        emails.push(email);
      }
    }
  }

  return emails;
}

/*
 * The people and teams a call names, matched to the project's members (by
 * name or email, without case) and teams (by name), as the person reads
 * them. The person asking is "you", however they are named. An address the
 * same plan invites (invitedInPlan) is invited, not unknown.
 */
async function resolveResponders(
  ctx: ToolContext,
  data: {
    peopleNames: ReadonlyArray<string>;
    teamNames: ReadonlyArray<string>;
    includesMe: boolean;
    invitedInPlan?: ReadonlyArray<string> | undefined;
    /*
     * The person asking, named among them, is one of the people by their
     * name - a later level that pages them - rather than "you".
     */
    meAsPerson?: boolean | undefined;
  },
): Promise<PagingResponders> {
  const myId: string = ctx.props.userId?.toString() || "";
  const peopleNames: ReadonlyArray<string> = data.peopleNames;
  const teamNames: ReadonlyArray<string> = data.teamNames;
  const responders: PagingResponders = {
    includesMe: data.includesMe,
    people: [],
    teams: [],
    invited: [],
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

      if ((!member || !userId) && (data.invitedInPlan || []).includes(lower)) {
        if (!responders.invited.includes(lower)) {
          responders.invited.push(lower);
        }
      } else if (!member || !userId) {
        responders.notFound.push(asked);
      } else if (userId === myId && !data.meAsPerson) {
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
        name: QueryHelper.findWithSameTextAnyOf([...teamNames]),
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

// Who a set_up_paging call pages first: alsoPage, teams and includeMe.
async function readPagingResponders(
  args: JSONObject,
  ctx: ToolContext,
): Promise<PagingResponders> {
  return await resolveResponders(ctx, {
    peopleNames: readNames(args, "alsoPage"),
    teamNames: readNames(args, "teams"),
    includesMe: ToolArgs.getBoolean(args, "includeMe") !== false,
    invitedInPlan: getEmailsInvitedInPlan(ctx.plannedCalls),
  });
}

// Someone invited to the project, by the user the invitation made.
interface InvitedPerson {
  userId: string;
  email: string;
}

/*
 * The user ids of addresses invited to the project (#7242), read once the
 * invitation exists - so after the plan's invite_people ran - as the
 * person reads the project's memberships, accepted or not. An address
 * with no membership is left out.
 */
async function readInvitedUserIds(
  ctx: ToolContext,
  emails: ReadonlyArray<string>,
): Promise<Array<string>> {
  return (await readInvitedPeople(ctx, emails)).map(
    (person: InvitedPerson): string => {
      return person.userId;
    },
  );
}

// The same, each with the address they were invited at.
async function readInvitedPeople(
  ctx: ToolContext,
  emails: ReadonlyArray<string>,
): Promise<Array<InvitedPerson>> {
  if (emails.length === 0) {
    return [];
  }

  const memberships: Array<TeamMember> = await TeamMemberService.findBy({
    query: { projectId: ctx.projectId },
    select: { _id: true, userId: true },
    limit: LIMIT_PER_PROJECT,
    skip: 0,
    props: ctx.props,
  });

  await addMemberUsers(ctx, memberships);

  const people: Array<InvitedPerson> = [];

  for (const email of emails) {
    const membership: TeamMember | undefined = memberships.find(
      (each: TeamMember): boolean => {
        return (
          (each.user?.email?.toString() || "").trim().toLowerCase() ===
          email.toLowerCase()
        );
      },
    );
    const userId: string = membership?.userId?.toString() || "";

    if (
      userId &&
      !people.some((person: InvitedPerson): boolean => {
        return person.userId === userId;
      })
    ) {
      people.push({ userId: userId, email: email });
    }
  }

  return people;
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
  // Addresses the same plan invites, paged once they join (#7242).
  invitedEmails: Array<string>;
}

// The ids a prepared call carries under `key`, ids only.
function readPreparedIds(args: JSONObject, key: string): Array<string> {
  return (ToolArgs.getStringArray(args, key) || []).filter(
    (id: string): boolean => {
      return ObjectID.isValidUUID(id);
    },
  );
}

// The addresses a prepared call carries under `key`, lower case.
function readPreparedEmails(args: JSONObject, key: string): Array<string> {
  return (ToolArgs.getStringArray(args, key) || [])
    .map((email: string): string => {
      return email.trim().toLowerCase();
    })
    .filter((email: string): boolean => {
      return Email.isValid(email);
    });
}

export function readPreparedResponders(args: JSONObject): PreparedResponders {
  return {
    userIds: readPreparedIds(args, "userIds"),
    teamIds: readPreparedIds(args, "teamIds"),
    otherPeople: ToolArgs.getStringArray(args, "otherPeople") || [],
    pagedTeams: ToolArgs.getStringArray(args, "pagedTeams") || [],
    invitedEmails: readPreparedEmails(args, "invitedEmails"),
  };
}

/*
 * WHAT IF NOBODY ACKNOWLEDGES (#7244): who set_up_paging's policy pages
 * next and after how long, and how many more times it starts over, as the
 * guided on-call setup's "What if nobody answers?" sets them - the people
 * and teams written out by id, as its prepare resolved them.
 */
export interface PreparedEscalation {
  userIds: Array<string>;
  teamIds: Array<string>;
  // The names the card said, for the card the policy leaves.
  people: Array<string>;
  teams: Array<string>;
  // Addresses the same plan invites, paged at that level once they join.
  invitedEmails: Array<string>;
  // How long the first level waits for someone to acknowledge.
  afterMinutes: number;
  // How many more times the policy starts over; 0 when it does not.
  repeatTimes: number;
}

// The minutes a call asks a level to wait: a whole number from 1 to a day, or null.
export function readAfterMinutes(args: JSONObject): number | null {
  const asked: unknown = args["afterMinutes"];

  if (asked === undefined || asked === null || asked === "") {
    return null;
  }

  const minutes: number = Number(asked);

  if (!Number.isFinite(minutes)) {
    return null;
  }

  return Math.min(Math.max(Math.round(minutes), 1), MAX_LEVEL_WAIT_IN_MINUTES);
}

// How many more times a call asks the policy to start over: 1 to 10, or 0.
export function readRepeatTimes(args: JSONObject): number {
  const asked: unknown = args["repeatTimes"];

  if (asked === undefined || asked === null || asked === "") {
    return 0;
  }

  const times: number = Number(asked);

  if (!Number.isFinite(times) || times < 1) {
    return 0;
  }

  return readPolicyRepeatTimes(Math.min(Math.round(times), 10)) || 0;
}

// Whether a call asks for someone else to be paged next.
function asksForEscalation(args: JSONObject): boolean {
  return (
    readNames(args, "escalateTo").length +
      readNames(args, "escalateToTeams").length >
    0
  );
}

export function readPreparedEscalation(args: JSONObject): PreparedEscalation {
  return {
    userIds: readPreparedIds(args, "escalateUserIds"),
    teamIds: readPreparedIds(args, "escalateTeamIds"),
    people: ToolArgs.getStringArray(args, "escalatePeople") || [],
    teams: ToolArgs.getStringArray(args, "escalateTeamNames") || [],
    invitedEmails: readPreparedEmails(args, "escalateInvitedEmails"),
    afterMinutes: readAfterMinutes(args) || DEFAULT_ESCALATE_AFTER_IN_MINUTES,
    repeatTimes: readRepeatTimes(args),
  };
}

// Whether a prepared escalation pages anyone next.
export function isEscalating(escalation: PreparedEscalation): boolean {
  return (
    escalation.userIds.length +
      escalation.teamIds.length +
      escalation.invitedEmails.length >
    0
  );
}

// Who a level pages, as a list a sentence says: names, teams, then addresses invited.
function describeLevelResponders(data: {
  people: ReadonlyArray<string>;
  teams: ReadonlyArray<string>;
  invitedEmails?: ReadonlyArray<string> | undefined;
}): ReturnType<typeof aiActionList> {
  return aiActionList([
    ...data.people.map(plainName),
    ...data.teams.map((team: string): AIActionSentence => {
      return aiActionSentence(AI_ACTION_TEAM, { name: team });
    }),
    ...(data.invitedEmails || []).map(plainName),
  ]);
}

/*
 * What the approval card says the policy does when nobody acknowledges:
 * who it pages next after the first level's wait, how long each round
 * waits when it only starts over, and how many more times it starts over.
 */
export function describeEscalationForPerson(
  escalation: PreparedEscalation,
): Array<AIActionSentence> {
  const sentences: Array<AIActionSentence> = [];

  if (isEscalating(escalation)) {
    sentences.push(
      aiActionPluralSentence(
        AI_ACTION_PLURAL_LINES.escalatesAfter,
        escalation.afterMinutes,
        { responders: describeLevelResponders(escalation) },
      ),
    );
  } else if (escalation.repeatTimes > 0) {
    sentences.push(
      aiActionPluralSentence(
        AI_ACTION_PLURAL_LINES.eachRoundWaits,
        escalation.afterMinutes,
      ),
    );
  }

  if (escalation.repeatTimes > 0) {
    sentences.push(
      aiActionPluralSentence(
        AI_ACTION_PLURAL_LINES.policyStartsOver,
        escalation.repeatTimes,
      ),
    );
  }

  return sentences;
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
  "invitedEmails",
  "escalateTo",
  "escalateToTeams",
  "afterMinutes",
  "repeatTimes",
  "escalateUserIds",
  "escalateTeamIds",
  "escalatePeople",
  "escalateTeamNames",
  "escalateInvitedEmails",
];

/*
 * Whether the project pages people already, as the guided setup decides
 * it (getWhoIsToldMode): a policy in service, or an on-call rule of any
 * kind that runs one (readPagingCounts). The
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

// Who a level pages, in English for the model: names, teams, then addresses invited.
function describeLevelInEnglish(
  level: Pick<PreparedEscalation, "people" | "teams" | "invitedEmails">,
): string {
  return [
    ...level.people,
    ...level.teams.map((team: string): string => {
      return `the ${team} team`;
    }),
    ...level.invitedEmails.map((email: string): string => {
      return `${email} (invited: paged once they join)`;
    }),
  ].join(", ");
}

// What a new policy got of what was asked for when nobody acknowledges.
export interface PolicyLevelsDone {
  // A second level pages someone else.
  secondLevel: boolean;
  // How many more times the policy starts over; 0 when it does not.
  repeatTimes: number;
  // What was refused, and why, in English.
  failures: Array<string>;
}

/*
 * WHAT IF NOBODY ACKNOWLEDGES, ON A POLICY JUST MADE (#7244): the guided
 * on-call setup's writes for the same answers (OnCallSetupApi's
 * addSecondLevel and setRepeat, built with Common's OnCallPolicyRecords),
 * each as the person:
 *
 *   - the first level waits afterMinutes, set only when it differs
 *     (buildLevelWait);
 *   - someone else is paged next: a second escalation rule
 *     (buildOnCallPolicyLevel);
 *   - the policy starts over that many more times (buildPolicyRepeat).
 *
 * The policy exists by now: a part refused - the plan, a permission - is
 * said, and the others still run.
 */
async function addLevelsToNewPolicy(
  ctx: ToolContext,
  data: {
    policyId: ObjectID;
    escalation: PreparedEscalation;
    invitedNextUserIds: ReadonlyArray<string>;
  },
): Promise<PolicyLevelsDone> {
  const done: PolicyLevelsDone = {
    secondLevel: false,
    repeatTimes: 0,
    failures: [],
  };
  const nextUserIds: Array<string> = [...data.escalation.userIds];

  for (const userId of data.invitedNextUserIds) {
    if (!nextUserIds.includes(userId)) {
      nextUserIds.push(userId);
    }
  }

  const escalates: boolean =
    nextUserIds.length + data.escalation.teamIds.length > 0;

  if (!escalates && data.escalation.repeatTimes === 0) {
    return done;
  }

  const reason: (error: unknown) => string = (error: unknown): string => {
    return error instanceof Error ? error.message : String(error);
  };

  try {
    const firstLevel: OnCallDutyPolicyEscalationRule | null =
      await OnCallDutyPolicyEscalationRuleService.findOneBy({
        query: {
          projectId: ctx.projectId,
          onCallDutyPolicyId: data.policyId,
        },
        select: { _id: true, escalateAfterInMinutes: true },
        props: ctx.props,
      });

    if (!firstLevel?.id) {
      throw new BadDataException(
        "The policy's first escalation rule could not be read.",
      );
    }

    if (firstLevel.escalateAfterInMinutes !== data.escalation.afterMinutes) {
      await OnCallDutyPolicyEscalationRuleService.updateOneById({
        id: firstLevel.id,
        data: buildLevelWait(data.escalation.afterMinutes),
        props: ctx.props,
      });
    }
  } catch (error) {
    done.failures.push(
      `the first level's wait of ${data.escalation.afterMinutes} minutes (${reason(error)})`,
    );
  }

  if (escalates) {
    try {
      const level: OnCallPolicyLevelCreate = buildOnCallPolicyLevel({
        projectId: ctx.projectId,
        policyId: data.policyId,
        userIds: nextUserIds,
        teamIds: data.escalation.teamIds,
      });

      await OnCallDutyPolicyEscalationRuleService.create({
        data: level.rule,
        miscDataProps: level.miscDataProps,
        props: ctx.props,
      });

      done.secondLevel = true;
    } catch (error) {
      done.failures.push(
        `the second level, paging ${describeLevelInEnglish(data.escalation)} (${reason(error)})`,
      );
    }
  }

  if (data.escalation.repeatTimes > 0) {
    try {
      await OnCallDutyPolicyService.updateOneById({
        id: data.policyId,
        data: buildPolicyRepeat(data.escalation.repeatTimes),
        props: ctx.props,
      });

      done.repeatTimes = data.escalation.repeatTimes;
    } catch (error) {
      done.failures.push(
        `starting over up to ${data.escalation.repeatTimes} more times (${reason(error)})`,
      );
    }
  }

  return done;
}

// What a new policy does when nobody acknowledges, in English for the model.
function describeLevelsDoneInEnglish(data: {
  escalation: PreparedEscalation;
  done: PolicyLevelsDone;
}): string {
  const minutes: string = `${data.escalation.afterMinutes} minute${data.escalation.afterMinutes === 1 ? "" : "s"}`;
  let text: string = "";

  if (data.done.secondLevel) {
    text += ` If nobody acknowledges within ${minutes}, its second escalation rule pages ${describeLevelInEnglish(data.escalation)}.`;
  } else if (data.done.repeatTimes > 0) {
    text += ` Its first escalation rule waits ${minutes} for someone to acknowledge.`;
  }

  if (data.done.repeatTimes > 0) {
    text += ` If nobody acknowledges, the policy starts over, up to ${data.done.repeatTimes} more time${data.done.repeatTimes === 1 ? "" : "s"}.`;
  }

  if (data.done.failures.length > 0) {
    text += ` Not set up: ${data.done.failures.join("; ")}. Tell the person exactly what was not set up, and why.`;
  }

  return text;
}

const NOBODY_TO_PAGE: string =
  "Nothing proposed: nobody named is a member or a team of this project, so the policy would page nobody. Ask the person who to page, by the name the project knows them by (query_teams lists members), and propose it again.";

const PROJECT_PAGES_ALREADY: (counts: PagingCounts) => string = (
  counts: PagingCounts,
): string => {
  return `Nothing proposed: this project already pages people through its on-call policies and on-call rules (${counts.policyCount} on-call ${counts.policyCount === 1 ? "policy" : "policies"}, ${counts.incidentRuleCount + counts.alertRuleCount} on-call ${counts.incidentRuleCount + counts.alertRuleCount === 1 ? "rule" : "rules"}), so they decide who is paged, and a second policy that pages for every incident would page twice. Say so in one sentence. Once a monitor exists, who_is_told says who it reaches. To page more people, propose ${ADD_TO_ON_CALL_POLICY_TOOL_NAME} on one of its policies (query_on_call_policies names them): at a level it has, or as a new level after a wait.`;
};

/*
 * OneUptime Cloud's Free plan allows one escalation rule per policy: a
 * second level is refused before the card, with the plan's own sentence
 * (OnCallDutyPolicyEscalationRuleService.getLevelsRefusal).
 */
const SECOND_LEVEL_NOT_IN_PLAN: (refusal: string) => string = (
  refusal: string,
): string => {
  return `Nothing proposed: the project's plan does not allow it. ${refusal} Paging someone else when nobody acknowledges is a second escalation rule, which needs a paid plan. Tell the person so, in these words, and offer to propose it again without someone else to page next: on the Free plan the policy can page the same people again instead (repeatTimes).`;
};

export const SetUpPagingTool: ObservabilityTool = {
  name: "set_up_paging",
  description:
    "Set up who is paged in a project that pages nobody yet, as the website and on-call guided setups do: the project's first on-call policy, 'Default on-call policy', paging the person ('you', unless includeMe is false) and any members (alsoPage) and teams (teams) named, with the two catch-all on-call rules that page it for every new incident and alert. What if nobody acknowledges: escalateTo and escalateToTeams page someone else after afterMinutes ('page Ana if I don't answer in 5 minutes'), and repeatTimes starts the policy over that many more times. Use it with set_up_website_monitoring, in the same answer, when the person asks to be paged, texted or called. A project that already has on-call policies or rules keeps them: query_on_call_policies first, and do not propose it there (add_to_on_call_policy adds people to one of its policies). Pass reachMeBy with how the person asked to be reached ('text me' is sms): the card then says what is missing, since a phone number or the app is added and verified by the person, never by you; to set the order pages reach them ('text me, then call me after 5 minutes'), propose set_how_to_reach_me too. It always shows the person an approval card, in every mode.",
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
          "Other members of the project to page too, each by the name or email the project knows them by (query_teams lists members by name), or the address of someone invite_people invites in the same answer.",
      },
      teams: {
        type: "array",
        items: { type: "string" },
        description: "Teams of the project to page, by name (query_teams).",
      },
      escalateTo: {
        type: "array",
        items: { type: "string" },
        description:
          "Members to page next when nobody acknowledges within afterMinutes, by name or email: a second escalation level. Leave it out unless the person asked for someone else to be paged when they do not answer.",
      },
      escalateToTeams: {
        type: "array",
        items: { type: "string" },
        description:
          "Teams to page next when nobody acknowledges within afterMinutes, by name.",
      },
      afterMinutes: {
        type: "number",
        description:
          "How many minutes the first level waits for someone to acknowledge before the next level is paged, or the policy starts over: 1 to 1440. Defaults to 30.",
      },
      repeatTimes: {
        type: "number",
        description:
          "How many more times the policy starts over when nobody acknowledges: 1 to 10. Leave it out unless the person asked to be paged again.",
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
  /*
   * The policy, its first level and its two rules; and, for what happens
   * when nobody acknowledges, changing that level's wait - and the policy,
   * for its repeats - as the guided on-call setup asks for them.
   */
  getRequiredPermissionGroups: (args: JSONObject): Array<Array<Permission>> => {
    const groups: Array<Array<Permission>> = [...getPagingPermissionGroups()];

    if (asksForEscalation(args) || readRepeatTimes(args) > 0) {
      groups.push(new OnCallDutyPolicyEscalationRule().getUpdatePermissions());
    }

    if (readRepeatTimes(args) > 0) {
      groups.push(new OnCallDutyPolicy().getUpdatePermissions());
    }

    return groups;
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
      invited: [],
      notFound: [],
    };
    // Who is paged next when nobody acknowledges (#7244).
    let next: PagingResponders = {
      includesMe: false,
      people: [],
      teams: [],
      invited: [],
      notFound: [],
    };

    try {
      responders = await readPagingResponders(args, ctx);

      if (asksForEscalation(args)) {
        next = await resolveResponders(ctx, {
          peopleNames: readNames(args, "escalateTo"),
          teamNames: readNames(args, "escalateToTeams"),
          includesMe: false,
          invitedInPlan: getEmailsInvitedInPlan(ctx.plannedCalls),
          meAsPerson: true,
        });
      }
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
    const escalation: PreparedEscalation = {
      userIds: next.people.map((person: { id: string }): string => {
        return person.id;
      }),
      teamIds: next.teams.map((team: { id: string }): string => {
        return team.id;
      }),
      people: next.people.map((person: { name: string }): string => {
        return person.name;
      }),
      teams: next.teams.map((team: { name: string }): string => {
        return team.name;
      }),
      invitedEmails: next.invited,
      afterMinutes: readAfterMinutes(args) || DEFAULT_ESCALATE_AFTER_IN_MINUTES,
      repeatTimes: readRepeatTimes(args),
    };

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

    // People the same plan invites: paged once they join (#7242).
    const invited: Array<string> = [...responders.invited];

    for (const email of next.invited) {
      if (!invited.includes(email)) {
        invited.push(email);
      }
    }

    if (invited.length > 0) {
      description.push(
        aiActionSentence(AI_ACTION_LINES.invitedPagedOnceTheyJoin, {
          names: aiActionList(invited.map(plainName)),
        }),
      );
    }

    description.push(...describeEscalationForPerson(escalation));

    const notFound: Array<string> = [...responders.notFound];

    for (const name of next.notFound) {
      if (!notFound.includes(name)) {
        notFound.push(name);
      }
    }

    if (notFound.length > 0) {
      description.push(
        aiActionSentence(AI_ACTION_LINES.respondersNotFound, {
          names: aiActionList(notFound.map(plainName)),
        }),
      );
    }

    /*
     * What is missing for the person to be reached the way they asked -
     * unless the same plan sets how pages reach them (#7454), whose part
     * says it.
     */
    if (
      responders.includesMe &&
      !(ctx.plannedCalls || []).some((call: PlannedToolCall): boolean => {
        return call.name === SET_HOW_TO_REACH_ME_TOOL_NAME;
      })
    ) {
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
        ...(responders.invited.length > 0
          ? { invitedEmails: responders.invited }
          : {}),
        ...(asksForEscalation(args)
          ? {
              escalateUserIds: escalation.userIds,
              escalateTeamIds: escalation.teamIds,
              escalatePeople: escalation.people,
              escalateTeamNames: escalation.teams,
              escalateInvitedEmails: escalation.invitedEmails,
            }
          : {}),
        ...(asksForEscalation(args) || escalation.repeatTimes > 0
          ? { afterMinutes: escalation.afterMinutes }
          : {}),
        ...(escalation.repeatTimes > 0
          ? { repeatTimes: escalation.repeatTimes }
          : {}),
      },
      /*
       * The card names the policy as it will be made: in the person's
       * language (#7995), as execute names it.
       */
      title: aiActionSentence(AI_ACTION_TITLES.createOnCallPolicy, {
        policy: JSON.stringify(
          getFirstOnCallPolicyName(
            getRecordWordsTranslator(await readSetupRecordsLanguage(ctx)),
          ),
        ),
      }),
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
          "Nothing proposed: the person may not read this project's on-call policies and rules, so Ask AI cannot tell whether it pages people already, and making a policy beside them could page twice. Tell them a Project Admin can set up paging, and that a monitor they set up emails them, its owner, when its status changes.",
        refusal: AIToolRefusal.Permission,
      };
    }

    if (pagesPeopleAlready(counts)) {
      return { toldModel: PROJECT_PAGES_ALREADY(counts) };
    }

    const responders: PreparedResponders = readPreparedResponders(args);

    if (
      responders.userIds.length +
        responders.teamIds.length +
        responders.invitedEmails.length ===
      0
    ) {
      return { toldModel: NOBODY_TO_PAGE };
    }

    /*
     * A second level on OneUptime Cloud's Free plan (#7244): one escalation
     * rule per policy, said before the card, in the plan's own sentence.
     */
    if (isEscalating(readPreparedEscalation(args))) {
      const refusal: string | null =
        OnCallDutyPolicyEscalationRuleService.getLevelsRefusal({
          props: ctx.props,
          existingLevels: 0,
          adding: 2,
        });

      if (refusal) {
        return {
          toldModel: SECOND_LEVEL_NOT_IN_PLAN(refusal),
          refusal: AIToolRefusal.Plan,
        };
      }
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
    const escalation: PreparedEscalation = readPreparedEscalation(args);

    /*
     * The people the same plan invited (#7242), by the user each invitation
     * made: invited by now, so they are the project's, and paged once they
     * join.
     */
    const [invitedFirst, invitedNext]: [Array<string>, Array<string>] =
      await Promise.all([
        readInvitedUserIds(ctx, responders.invitedEmails),
        readInvitedUserIds(ctx, escalation.invitedEmails),
      ]);
    const firstUserIds: Array<string> = [...responders.userIds];

    for (const userId of invitedFirst) {
      if (!firstUserIds.includes(userId)) {
        firstUserIds.push(userId);
      }
    }

    if (firstUserIds.length + responders.teamIds.length === 0) {
      throw new BadDataException(NOBODY_TO_PAGE);
    }

    /*
     * The guided setup's policy, for the same answers (Common/Utils/GuidedSetup),
     * named in the person's language - and its two rules too: the language
     * goes with the create (#7995).
     */
    const language: string = await readSetupRecordsLanguage(ctx);
    const create: FirstOnCallPolicyCreate = buildFirstOnCallPolicy({
      userIds: firstUserIds,
      teamIds: responders.teamIds,
      translator: getRecordWordsTranslator(language),
      language: language,
    });
    create.policy.projectId = ctx.projectId;

    /*
     * As the person: OnCallDutyPolicyService.create checks that they may
     * add the escalation rule and both on-call rules, and that everyone it
     * pages is the project's, before anything is saved. A policy's name is
     * one policy's (#9742): while another has it - an archived one, or one
     * the person may not see - the policy is made numbered, as Duplicate
     * numbers a copy ("Default on-call policy 2"), and said by that name.
     */
    const { created, name: policyName } =
      await createWithFreeName<OnCallDutyPolicy>({
        name: create.policy.name || GUIDED_SETUP_POLICY_NAME,
        create: async (name: string): Promise<OnCallDutyPolicy> => {
          create.policy.name = name;

          return await OnCallDutyPolicyService.create({
            data: create.policy,
            miscDataProps: create.miscDataProps,
            props: ctx.props,
          });
        },
        readRefusal: (error: unknown): string => {
          return error instanceof Error ? error.message : "";
        },
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

    /*
     * What if nobody acknowledges (#7244): the guided on-call setup's
     * writes for the same answers (Common's OnCallPolicyRecords), each as
     * the person. The policy exists by now, so a part refused here - the
     * plan, a permission - is said, and the rest stands.
     */
    const done: PolicyLevelsDone = await addLevelsToNewPolicy(ctx, {
      policyId: created.id!,
      escalation: escalation,
      invitedNextUserIds: invitedNext,
    });

    const pagedLine: AIActionSentence = describePagedForPerson(
      {
        includesMe: includesMe,
        people: [...responders.otherPeople, ...responders.invitedEmails].map(
          toResponder,
        ),
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
      ...responders.invitedEmails.map((email: string): string => {
        return `${email} (invited: paged once they join)`;
      }),
      ...responders.pagedTeams.map((team: string): string => {
        return `the ${team} team`;
      }),
    ];

    const serialized: SerializedResult = ToolResultSerializer.serializeRows([
      {
        id: policyId,
        name: policyName,
        pagesThePersonAsking: includesMe,
        otherPeoplePaged: responders.otherPeople.join(", "),
        teamsPaged: responders.pagedTeams.join(", "),
        runsFor: "every new incident and alert",
        ...(done.secondLevel
          ? {
              pagesNext: describeLevelInEnglish(escalation),
              afterMinutes: escalation.afterMinutes,
            }
          : {}),
        ...(done.repeatTimes > 0 ? { startsOverUpTo: done.repeatTimes } : {}),
      },
    ]);

    return {
      dataForLlm: `Created the on-call policy "${policyName}". Its first escalation rule pages ${pagedNames.join(", ")}, and two on-call rules run it for every new incident and alert, so every monitor that opens one pages them.${describeLevelsDoneInEnglish(
        { escalation: escalation, done: done },
      )} How a page reaches each person is their own notification rules and verified methods (Notification Methods). ${getMissingMethodAdviceForModel(ctx)} ${getTestPageOfferForModel(ctx, SetupTestPageTarget.Policy)}\n${serialized.text}`,
      rowCount: 1,
      ...citationSentence(AI_TOOL_CITATIONS.createdOnCallPolicy, {
        name: policyName,
      }),
      citationTarget: {
        type: AIChatCitationTargetType.OnCallPolicyView,
        params: { onCallDutyPolicyId: policyId },
      },
      redactionCount: serialized.redactionCount,
      isTruncated: false,
      widget: WidgetBuilder.actionCard({
        title: "On-call policy created",
        heading: policyName,
        words: {
          kind: aiActionTerm(AI_ACTION_CARD_KINDS.onCallPolicy),
          line: [
            pagedLine,
            ...(done.secondLevel
              ? [
                  aiActionPluralSentence(
                    AI_ACTION_PLURAL_LINES.pagesNextAfter,
                    escalation.afterMinutes,
                    { responders: describeLevelResponders(escalation) },
                  ),
                ]
              : []),
            ...(done.repeatTimes > 0
              ? [
                  aiActionPluralSentence(
                    AI_ACTION_PLURAL_LINES.startsOverUpTo,
                    done.repeatTimes,
                  ),
                ]
              : []),
          ],
        },
        link: {
          type: AIChatCitationTargetType.OnCallPolicyView,
          params: { onCallDutyPolicyId: policyId },
        },
        testPage: {
          kind: "policy",
          policyId: policyId,
          policyName: policyName,
        },
      }),
    };
  },
};

/*
 * ---------------------------------------------------------------------------
 * add_to_on_call_policy
 * ---------------------------------------------------------------------------
 */

/*
 * PEOPLE ADDED TO A POLICY THE PROJECT HAS (#7244). In a project that
 * pages people already, set_up_paging proposes nothing beside its policies
 * - and "page Ana too" was answered with nothing. This adds people and
 * teams to a policy, as the guided on-call setup's "Who else is on call?"
 * does (OnCallSetupApi.addToFirstLevel, Common's buildLevelMembers): to a
 * level it has (the first by default), or as a new level after its last,
 * paged when nobody acknowledges within a wait (buildOnCallPolicyLevel,
 * buildLevelWait) - which OneUptime Cloud's Free plan allows once per
 * policy, said before the card.
 */

// One level of a policy, as the card names it.
interface PolicyLevelRead {
  id: ObjectID;
  name: string;
  escalateAfterInMinutes: number | undefined;
}

// The project's policies in service the person may read, by name.
async function readPoliciesInService(
  ctx: ToolContext,
): Promise<Array<OnCallDutyPolicy>> {
  return await OnCallDutyPolicyService.findBy({
    query: { projectId: ctx.projectId, isArchived: false },
    select: { _id: true, name: true },
    sort: { name: SortOrder.Ascending },
    limit: LIMIT_PER_PROJECT,
    skip: 0,
    props: ctx.props,
  });
}

// A policy's levels, in the order a page climbs them, as the person reads them.
async function readPolicyLevels(
  ctx: ToolContext,
  policyId: ObjectID,
): Promise<Array<PolicyLevelRead>> {
  const rules: Array<OnCallDutyPolicyEscalationRule> =
    await OnCallDutyPolicyEscalationRuleService.findBy({
      query: { projectId: ctx.projectId, onCallDutyPolicyId: policyId },
      select: {
        _id: true,
        name: true,
        order: true,
        escalateAfterInMinutes: true,
      },
      sort: { order: SortOrder.Ascending },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      props: ctx.props,
    });

  return rules
    .filter((rule: OnCallDutyPolicyEscalationRule): boolean => {
      return Boolean(rule.id);
    })
    .map((rule: OnCallDutyPolicyEscalationRule, index: number) => {
      return {
        id: rule.id!,
        name: rule.name || getDefaultEscalationRuleName(index + 1),
        escalateAfterInMinutes: rule.escalateAfterInMinutes,
      };
    });
}

// Who a level pages now: its people's and teams' ids, as the person reads them.
async function readLevelMembers(
  ctx: ToolContext,
  ruleId: ObjectID,
): Promise<{ userIds: Array<string>; teamIds: Array<string> }> {
  const [users, teams]: [
    Array<OnCallDutyPolicyEscalationRuleUser>,
    Array<OnCallDutyPolicyEscalationRuleTeam>,
  ] = await Promise.all([
    OnCallDutyPolicyEscalationRuleUserService.findBy({
      query: {
        projectId: ctx.projectId,
        onCallDutyPolicyEscalationRuleId: ruleId,
      },
      select: { _id: true, userId: true },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      props: ctx.props,
    }),
    OnCallDutyPolicyEscalationRuleTeamService.findBy({
      query: {
        projectId: ctx.projectId,
        onCallDutyPolicyEscalationRuleId: ruleId,
      },
      select: { _id: true, teamId: true },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      props: ctx.props,
    }),
  ]);

  return {
    userIds: users
      .map((row: OnCallDutyPolicyEscalationRuleUser): string => {
        return row.userId?.toString() || "";
      })
      .filter(Boolean),
    teamIds: teams
      .map((row: OnCallDutyPolicyEscalationRuleTeam): string => {
        return row.teamId?.toString() || "";
      })
      .filter(Boolean),
  };
}

/*
 * The person asking, by the name the project knows them by - their
 * membership read as them, and who it is as membership reads add it
 * (addMemberUsers) - else their email, never blank.
 */
async function readMyName(ctx: ToolContext): Promise<string> {
  const memberships: Array<TeamMember> = await TeamMemberService.findBy({
    query: { projectId: ctx.projectId, userId: ctx.props.userId! },
    select: { _id: true, userId: true },
    limit: 1,
    skip: 0,
    props: ctx.props,
  });

  await addMemberUsers(ctx, memberships);

  const user: User | undefined = memberships[0]?.user;

  return (
    user?.name?.toString() ||
    user?.email?.toString() ||
    ctx.props.userId!.toString()
  );
}

// The level a call asks for: 1, the first, unless it names another.
export function readLevelNumber(args: JSONObject): number {
  return ToolArgs.getNumber(args, "level", {
    defaultValue: 1,
    min: 1,
    max: 100,
  });
}

/*
 * The policy a call names, by its name (without case) or id, among the
 * project's policies in service - or its only one, when it names none.
 */
export function pickPolicyToAddTo(data: {
  named: string | undefined;
  policies: ReadonlyArray<OnCallDutyPolicy>;
}): OnCallDutyPolicy | null {
  if (!data.named) {
    return data.policies.length === 1 ? data.policies[0]! : null;
  }

  const named: string = data.named.trim().toLowerCase();

  return (
    data.policies.find((policy: OnCallDutyPolicy): boolean => {
      return (
        policy.id?.toString().toLowerCase() === named ||
        (policy.name || "").trim().toLowerCase() === named
      );
    }) || null
  );
}

// The policy names a refusal lists for the model to pick from: the first ten.
function listPolicyNames(policies: ReadonlyArray<OnCallDutyPolicy>): string {
  return policies
    .slice(0, 10)
    .map((policy: OnCallDutyPolicy): string => {
      return `"${policy.name || ""}"`;
    })
    .join(", ");
}

const NO_POLICY_TO_ADD_TO: string = `Nothing proposed: this project has no on-call policy in service to add people to. Propose ${SET_UP_PAGING_TOOL_NAME} to make its first, instead.`;

// A list of names, each in quotes, as a refusal says them.
function quotedNames(names: ReadonlyArray<string>): string {
  return names
    .map((name: string): string => {
      return `"${name}"`;
    })
    .join(", ");
}

/*
 * Nobody named is new at the level (#10041): who it pages there already -
 * what a second identical call finds, so it adds nobody again and makes
 * no second level - and who is no member or team of the project.
 */
const NOBODY_NEW_AT_LEVEL: (data: {
  args: JSONObject;
  policy: OnCallDutyPolicy;
  level: number;
}) => string = (data: {
  args: JSONObject;
  policy: OnCallDutyPolicy;
  level: number;
}): string => {
  const alreadyPaged: Array<string> =
    ToolArgs.getStringArray(data.args, "alreadyPaged") || [];
  const notFound: Array<string> =
    ToolArgs.getStringArray(data.args, "notFound") || [];
  const notFoundSentence: string =
    notFound.length > 0
      ? ` ${quotedNames(notFound)} ${notFound.length === 1 ? "is" : "are"} no member or team of this project: ask the person who they meant, by the name the project knows them by (query_teams lists members).`
      : "";

  if (alreadyPaged.length > 0) {
    return `Nothing proposed: level ${data.level} of the on-call policy "${data.policy.name}" pages ${quotedNames(alreadyPaged)} already, so nobody is added again and no level is made.${notFoundSentence} Say so in one sentence.`;
  }

  return `Nothing proposed: nobody named is a member or a team of this project who is not paged at that level of "${data.policy.name}" already.${notFoundSentence || " Ask the person who to add, by the name the project knows them by (query_teams lists members), and propose it again."}`;
};

// A level that pages everyone a call named already (#10041, #10411).
const everyoneNamedPagedAlready: (
  level: number,
  policyName: string,
) => string = (level: number, policyName: string): string => {
  return `Level ${level} of the on-call policy "${policyName}" pages everyone named already, so nobody was added again.`;
};

/*
 * Who of those a call named the level pages already, said after what was
 * added (#10411): nothing when there is nobody.
 */
const pagedThereAlready: (names: ReadonlyArray<string>) => string = (
  names: ReadonlyArray<string>,
): string => {
  if (names.length === 0) {
    return "";
  }

  return ` ${quotedNames(names)} ${names.length === 1 ? "is" : "are"} paged at that level already, so they were not added again.`;
};

// What a prepared add_to_on_call_policy call runs with.
export interface PreparedPolicyAddition {
  policyId: string;
  policyName: string;
  // The level it adds to, or the new level's place (one past the last).
  level: number;
  // The rule of a level the policy has; empty for a new level.
  ruleId: string;
  ruleName: string;
  // The level before a new one, whose wait is set; empty when there is none.
  previousRuleId: string;
  afterMinutes: number;
  userIds: Array<string>;
  teamIds: Array<string>;
  people: Array<string>;
  teams: Array<string>;
  invitedEmails: Array<string>;
}

export function readPreparedPolicyAddition(
  args: JSONObject,
): PreparedPolicyAddition {
  const id: (key: string) => string = (key: string): string => {
    const value: string = ToolArgs.getString(args, key) || "";
    return ObjectID.isValidUUID(value) ? value : "";
  };

  return {
    policyId: id("policyId"),
    policyName: ToolArgs.getString(args, "policyName") || "",
    level: readLevelNumber(args),
    ruleId: id("ruleId"),
    ruleName: ToolArgs.getString(args, "ruleName") || "",
    previousRuleId: id("previousRuleId"),
    afterMinutes: readAfterMinutes(args) || DEFAULT_ESCALATE_AFTER_IN_MINUTES,
    userIds: readPreparedIds(args, "userIds"),
    teamIds: readPreparedIds(args, "teamIds"),
    people: ToolArgs.getStringArray(args, "people") || [],
    teams: ToolArgs.getStringArray(args, "teamNames") || [],
    invitedEmails: readPreparedEmails(args, "invitedEmails"),
  };
}

// Whether a prepared addition makes a new level rather than adding to one.
function isNewLevel(addition: PreparedPolicyAddition): boolean {
  return Boolean(addition.policyId) && !addition.ruleId;
}

/*
 * Why the call cannot be proposed, from what its prepare wrote out: no
 * policy, a level the policy does not have, nobody new to page there.
 * Null when nothing stops it.
 */
async function checkPolicyAddition(
  args: JSONObject,
  ctx: ToolContext,
): Promise<SetupActionRefusal | null> {
  const policies: Array<OnCallDutyPolicy> = await readPoliciesInService(ctx);

  if (policies.length === 0) {
    return { toldModel: NO_POLICY_TO_ADD_TO };
  }

  const named: string | undefined = ToolArgs.getString(args, "policy");
  const policy: OnCallDutyPolicy | null = pickPolicyToAddTo({
    named: named,
    policies: policies,
  });

  if (!policy?.id) {
    return {
      toldModel: named
        ? `Nothing proposed: "${named}" is no on-call policy of this project in service. Its policies: ${listPolicyNames(policies)}. Name one of them.`
        : `Nothing proposed: this project has ${policies.length} on-call policies (${listPolicyNames(policies)}). Ask the person which one to add to, and propose it again with its name.`,
    };
  }

  const levels: Array<PolicyLevelRead> = await readPolicyLevels(ctx, policy.id);
  const level: number = readLevelNumber(args);

  if (level > Math.max(levels.length, 0) + 1) {
    return {
      toldModel: `Nothing proposed: the on-call policy "${policy.name}" has ${levels.length} escalation ${levels.length === 1 ? "level" : "levels"}. Add to one of them (level 1 to ${levels.length}), or as level ${levels.length + 1}, a new level paged when nobody acknowledges within afterMinutes.`,
    };
  }

  const addition: PreparedPolicyAddition = readPreparedPolicyAddition(args);

  if (
    addition.userIds.length +
      addition.teamIds.length +
      addition.invitedEmails.length ===
    0
  ) {
    return { toldModel: NOBODY_NEW_AT_LEVEL({ args, policy, level }) };
  }

  // A second level on OneUptime Cloud's Free plan: said before the card.
  if (level > levels.length && levels.length > 0) {
    const refusal: string | null =
      OnCallDutyPolicyEscalationRuleService.getLevelsRefusal({
        props: ctx.props,
        existingLevels: levels.length,
        adding: 1,
      });

    if (refusal) {
      return {
        toldModel: `Nothing proposed: the project's plan does not allow it. ${refusal} A new level, paging someone else when nobody acknowledges, is another escalation rule, which needs a paid plan. Tell the person so, in these words, and offer to add them to the policy's first level instead (level 1), where they are paged with the others.`,
        refusal: AIToolRefusal.Plan,
      };
    }
  }

  return null;
}

export const AddToOnCallPolicyTool: ObservabilityTool = {
  name: "add_to_on_call_policy",
  description:
    "Add people and teams to an on-call policy the project has, as the guided on-call setup's 'Who else is on call?' does: to a level it has (level 1, the first, by default), or as a new level after its last one, paged when nobody acknowledges within afterMinutes ('page Ana if I don't answer in 5 minutes'). Use it where set_up_paging is not proposed because the project pages people already: query_on_call_policies first, and name the policy by its name. Name people by the name or email the project knows them by, or the address of someone invite_people invites in the same answer. It always shows the person an approval card, in every mode.",
  inputSchema: {
    type: "object",
    properties: {
      policy: {
        type: "string",
        description:
          "The on-call policy, by its name (query_on_call_policies). Leave it out only when the project has one policy.",
      },
      alsoPage: {
        type: "array",
        items: { type: "string" },
        description:
          "Members of the project to add, each by the name or email the project knows them by (query_teams lists members).",
      },
      teams: {
        type: "array",
        items: { type: "string" },
        description: "Teams of the project to add, by name (query_teams).",
      },
      includeMe: {
        type: "boolean",
        description:
          "Add the person asking too. Defaults to false; true when they said 'me' or 'page me too'.",
      },
      level: {
        type: "number",
        description:
          "The level to add to: 1 (the default) is the first, paged at once. One past the policy's last level makes a new level, paged when nobody acknowledges within afterMinutes.",
      },
      afterMinutes: {
        type: "number",
        description:
          "For a new level: how many minutes the level before it waits for someone to acknowledge, 1 to 1440. Defaults to 30.",
      },
    },
  },
  get requiredPermissions(): Array<Permission> {
    return new OnCallDutyPolicyEscalationRuleUser().getCreatePermissions();
  },
  /*
   * As the guided setup asks for them: adding people and teams to a level
   * it has, or a new level - and changing the wait of the level before it.
   */
  getRequiredPermissionGroups: (args: JSONObject): Array<Array<Permission>> => {
    const addition: PreparedPolicyAddition = readPreparedPolicyAddition(args);

    if (isNewLevel(addition)) {
      return [
        new OnCallDutyPolicyEscalationRule().getCreatePermissions(),
        ...(addition.previousRuleId
          ? [new OnCallDutyPolicyEscalationRule().getUpdatePermissions()]
          : []),
      ];
    }

    const groups: Array<Array<Permission>> = [];

    if (
      addition.userIds.length + addition.invitedEmails.length > 0 ||
      addition.teamIds.length === 0
    ) {
      groups.push(
        new OnCallDutyPolicyEscalationRuleUser().getCreatePermissions(),
      );
    }

    if (addition.teamIds.length > 0) {
      groups.push(
        new OnCallDutyPolicyEscalationRuleTeam().getCreatePermissions(),
      );
    }

    return groups;
  },
  isMutation: true,
  setupAction: { planOrder: SETUP_PLAN_ORDER.onCallPolicyPeople },
  buildActionTitle: (args: JSONObject): AIActionSentence => {
    const named: string | undefined = ToolArgs.getString(args, "policy");

    return named && !ObjectID.isValidUUID(named)
      ? aiActionSentence(AI_ACTION_TITLES.addToOnCallPolicy, {
          policy: JSON.stringify(named),
        })
      : aiActionSentence(AI_ACTION_TITLES.addToOnCallPolicyUnnamed);
  },
  /*
   * The policy and its level written out by id - what the card named is
   * what runs - and who is added there: the people and teams it does not
   * page yet, by id, and who it pages there already.
   */
  prepareMutation: async (
    args: JSONObject,
    ctx: ToolContext,
  ): Promise<PreparedMutation> => {
    try {
      const policy: OnCallDutyPolicy | null = pickPolicyToAddTo({
        named: ToolArgs.getString(args, "policy"),
        policies: await readPoliciesInService(ctx),
      });

      if (!policy?.id) {
        return { arguments: args };
      }

      const levels: Array<PolicyLevelRead> = await readPolicyLevels(
        ctx,
        policy.id,
      );
      const levelNumber: number = readLevelNumber(args);

      if (levelNumber > levels.length + 1) {
        return { arguments: args };
      }

      const existing: PolicyLevelRead | undefined = levels[levelNumber - 1];
      const previous: PolicyLevelRead | undefined = existing
        ? undefined
        : levels[levels.length - 1];
      const responders: PagingResponders = await resolveResponders(ctx, {
        peopleNames: readNames(args, "alsoPage"),
        teamNames: readNames(args, "teams"),
        includesMe: false,
        invitedInPlan: getEmailsInvitedInPlan(ctx.plannedCalls),
        meAsPerson: true,
      });

      // The person asking, when they asked to be added too: by their name.
      if (
        ToolArgs.getBoolean(args, "includeMe") === true &&
        ctx.props.userId &&
        !responders.people.some((person: { id: string }): boolean => {
          return person.id === ctx.props.userId!.toString();
        })
      ) {
        responders.people.unshift({
          id: ctx.props.userId.toString(),
          name: await readMyName(ctx),
        });
      }

      // Who the level pages already is left as it is.
      const already: { userIds: Array<string>; teamIds: Array<string> } =
        existing
          ? await readLevelMembers(ctx, existing.id)
          : { userIds: [], teamIds: [] };
      const newPeople: Array<{ id: string; name: string }> =
        responders.people.filter((person: { id: string }): boolean => {
          return !already.userIds.includes(person.id);
        });
      const newTeams: Array<{ id: string; name: string }> =
        responders.teams.filter((team: { id: string }): boolean => {
          return !already.teamIds.includes(team.id);
        });
      const alreadyThere: Array<string> = [
        ...responders.people
          .filter((person: { id: string }): boolean => {
            return already.userIds.includes(person.id);
          })
          .map((person: { name: string }): string => {
            return person.name;
          }),
        ...responders.teams
          .filter((team: { id: string }): boolean => {
            return already.teamIds.includes(team.id);
          })
          .map((team: { name: string }): string => {
            return team.name;
          }),
      ];

      const addition: PreparedPolicyAddition = {
        policyId: policy.id.toString(),
        policyName: policy.name || "",
        level: levelNumber,
        ruleId: existing?.id.toString() || "",
        ruleName: existing?.name || "",
        previousRuleId: previous?.id.toString() || "",
        afterMinutes:
          readAfterMinutes(args) || DEFAULT_ESCALATE_AFTER_IN_MINUTES,
        userIds: newPeople.map((person: { id: string }): string => {
          return person.id;
        }),
        teamIds: newTeams.map((team: { id: string }): string => {
          return team.id;
        }),
        people: newPeople.map((person: { name: string }): string => {
          return person.name;
        }),
        teams: newTeams.map((team: { name: string }): string => {
          return team.name;
        }),
        invitedEmails: responders.invited,
      };

      const description: Array<AIActionSentence> = [];
      const adds: ReturnType<typeof aiActionList> = describeLevelResponders({
        people: addition.people,
        teams: addition.teams,
        invitedEmails: addition.invitedEmails,
      });
      const addsAnyone: boolean =
        addition.userIds.length +
          addition.teamIds.length +
          addition.invitedEmails.length >
        0;

      if (addsAnyone && (existing || !previous)) {
        description.push(
          aiActionSentence(AI_ACTION_LINES.addsToEscalationRule, {
            responders: adds,
            rule: JSON.stringify(
              existing?.name || getDefaultEscalationRuleName(levelNumber),
            ),
          }),
        );
      } else if (addsAnyone) {
        description.push(
          aiActionPluralSentence(
            AI_ACTION_PLURAL_LINES.escalatesAfter,
            addition.afterMinutes,
            { responders: adds },
          ),
        );
      }

      if (alreadyThere.length > 0) {
        description.push(
          aiActionSentence(AI_ACTION_LINES.alreadyPagedThere, {
            names: aiActionList(alreadyThere.map(plainName)),
          }),
        );
      }

      if (addition.invitedEmails.length > 0) {
        description.push(
          aiActionSentence(AI_ACTION_LINES.invitedPagedOnceTheyJoin, {
            names: aiActionList(addition.invitedEmails.map(plainName)),
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

      return {
        arguments: {
          ...args,
          policyId: addition.policyId,
          policyName: addition.policyName,
          level: addition.level,
          ruleId: addition.ruleId,
          ruleName: addition.ruleName,
          previousRuleId: addition.previousRuleId,
          ...(addition.ruleId ? {} : { afterMinutes: addition.afterMinutes }),
          userIds: addition.userIds,
          teamIds: addition.teamIds,
          people: addition.people,
          teamNames: addition.teams,
          invitedEmails: addition.invitedEmails,
          // What the check says when nobody is new there (#10041).
          alreadyPaged: alreadyThere,
          notFound: responders.notFound,
        },
        title: aiActionSentence(AI_ACTION_TITLES.addToOnCallPolicy, {
          policy: JSON.stringify(addition.policyName),
        }),
        namedArguments: ["policy", "policyId", "policyName"],
        description: description,
        describedArguments: [
          "alsoPage",
          "teams",
          "includeMe",
          "level",
          "afterMinutes",
          "ruleId",
          "ruleName",
          "previousRuleId",
          "userIds",
          "teamIds",
          "people",
          "teamNames",
          "invitedEmails",
          "alreadyPaged",
          "notFound",
        ],
      };
    } catch (error) {
      logger.debug(
        `add_to_on_call_policy could not read the policy: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return { arguments: args };
    }
  },
  checkBeforeApproval: async (
    args: JSONObject,
    ctx: ToolContext,
  ): Promise<SetupActionRefusal | null> => {
    try {
      return await checkPolicyAddition(args, ctx);
    } catch {
      // Unreadable now: running it says why.
      return null;
    }
  },
  execute: async (
    args: JSONObject,
    ctx: ToolContext,
  ): Promise<ToolExecutionResult> => {
    const addition: PreparedPolicyAddition = readPreparedPolicyAddition(args);

    if (!addition.policyId) {
      throw new BadDataException(
        "The on-call policy to add to was not found. Name one of the project's on-call policies.",
      );
    }

    const policyId: ObjectID = new ObjectID(addition.policyId);
    const invited: Array<InvitedPerson> = await readInvitedPeople(
      ctx,
      addition.invitedEmails,
    );
    const userIds: Array<string> = [...addition.userIds];

    for (const person of invited) {
      if (!userIds.includes(person.userId)) {
        userIds.push(person.userId);
      }
    }

    if (userIds.length + addition.teamIds.length === 0) {
      throw new BadDataException(
        "Nobody named is a member or a team of this project, so nobody was added.",
      );
    }

    const failures: Array<string> = [];
    let added: boolean = false;
    // Who is added, by name: those the level pages already by now left out.
    let people: Array<string> = addition.people;
    let teams: Array<string> = addition.teams;
    let invitedEmails: Array<string> = addition.invitedEmails;
    /*
     * Who the level pages already, by name: found there when the call ran
     * (#10041), or added there since that read and refused a second row
     * (#10411).
     */
    const alreadyThere: Array<string> = [];

    if (addition.ruleId) {
      /*
       * Who the level pages now (#10041): someone added there since the
       * card was shown - by a teammate, or by the same call made twice -
       * is not added again, and the words say they are there already. The
       * level would refuse their second row anyway (#10411); this read
       * says so before any write. A read that fails adds the rows the card
       * promised, and a refusal of one as there already is said the same
       * way.
       */
      let pagedNow: { userIds: Array<string>; teamIds: Array<string> } = {
        userIds: [],
        teamIds: [],
      };

      try {
        pagedNow = await readLevelMembers(ctx, new ObjectID(addition.ruleId));
      } catch {
        pagedNow = { userIds: [], teamIds: [] };
      }

      const newUserIds: Array<string> = userIds.filter(
        (userId: string): boolean => {
          return !pagedNow.userIds.includes(userId);
        },
      );
      const newTeamIds: Array<string> = addition.teamIds.filter(
        (teamId: string): boolean => {
          return !pagedNow.teamIds.includes(teamId);
        },
      );

      if (newUserIds.length + newTeamIds.length === 0) {
        throw new ConflictException(
          everyoneNamedPagedAlready(addition.level, addition.policyName),
        );
      }

      // Someone named by the name the card gave them; one invited, by their address.
      const nameOfPerson: (userId: string) => string = (
        userId: string,
      ): string => {
        const index: number = addition.userIds.indexOf(userId);

        return (
          (index >= 0 ? addition.people[index] : undefined) ||
          invited.find((person: InvitedPerson): boolean => {
            return person.userId === userId;
          })?.email ||
          userId
        );
      };
      const nameOfTeam: (teamId: string) => string = (
        teamId: string,
      ): string => {
        return addition.teams[addition.teamIds.indexOf(teamId)] || teamId;
      };

      for (const userId of userIds) {
        if (!newUserIds.includes(userId)) {
          alreadyThere.push(nameOfPerson(userId));
        }
      }

      for (const teamId of addition.teamIds) {
        if (!newTeamIds.includes(teamId)) {
          alreadyThere.push(nameOfTeam(teamId));
        }
      }

      // Those a row was written for: the words say who was added.
      const addedUserIds: Array<string> = [];
      const addedTeamIds: Array<string> = [];

      /*
       * A level the policy has: the guided setup's rows, one per person and
       * team (buildLevelMembers), each as the person.
       */
      const members: OnCallPolicyLevelMembers = buildLevelMembers({
        projectId: ctx.projectId,
        policyId: policyId,
        ruleId: new ObjectID(addition.ruleId),
        userIds: newUserIds,
        teamIds: newTeamIds,
      });

      for (const row of members.users) {
        const userId: string = row.userId?.toString() || "";

        try {
          await OnCallDutyPolicyEscalationRuleUserService.create({
            data: row,
            props: ctx.props,
          });
          added = true;
          addedUserIds.push(userId);
        } catch (error) {
          /*
           * Added to the level since the read above - by a teammate, or by
           * the same call made at the same moment - and the level takes
           * each person once (#10411): where they were asked to be, so no
           * failure.
           */
          if (
            PostgresErrorTranslator.isUniqueViolationOf(
              error,
              ESCALATION_RULE_USER_INDEX,
            )
          ) {
            alreadyThere.push(nameOfPerson(userId));
            continue;
          }

          failures.push(error instanceof Error ? error.message : String(error));
        }
      }

      for (const row of members.teams) {
        const teamId: string = row.teamId?.toString() || "";

        try {
          await OnCallDutyPolicyEscalationRuleTeamService.create({
            data: row,
            props: ctx.props,
          });
          added = true;
          addedTeamIds.push(teamId);
        } catch (error) {
          // As for a person: the level takes each team once (#10411).
          if (
            PostgresErrorTranslator.isUniqueViolationOf(
              error,
              ESCALATION_RULE_TEAM_INDEX,
            )
          ) {
            alreadyThere.push(nameOfTeam(teamId));
            continue;
          }

          failures.push(error instanceof Error ? error.message : String(error));
        }
      }

      people = addition.people.filter((_name: string, index: number) => {
        return addedUserIds.includes(addition.userIds[index] || "");
      });
      teams = addition.teams.filter((_name: string, index: number) => {
        return addedTeamIds.includes(addition.teamIds[index] || "");
      });
      // An address is named once its user was added, or when it made no user yet.
      invitedEmails = addition.invitedEmails.filter((email: string) => {
        const person: InvitedPerson | undefined = invited.find(
          (each: InvitedPerson): boolean => {
            return each.email === email;
          },
        );

        return !person || addedUserIds.includes(person.userId);
      });

      /*
       * Everyone named is on the level by now: what the call asked for,
       * done by someone else in between - said as when the read above
       * finds it.
       */
      if (!added && failures.length === 0) {
        throw new ConflictException(
          everyoneNamedPagedAlready(addition.level, addition.policyName),
        );
      }
    } else {
      /*
       * A level at this place made since the card was shown (#10041) - by
       * a teammate, or by the same call made twice - would be a second
       * escalation rule, paging them after a level the card never named:
       * nothing is added, and the words say what to do instead. A read
       * that fails makes the level the card promised.
       */
      let levelsNow: number | null = null;

      try {
        levelsNow = (await readPolicyLevels(ctx, policyId)).length;
      } catch {
        levelsNow = null;
      }

      if (levelsNow !== null && levelsNow >= addition.level) {
        throw new ConflictException(
          `The on-call policy "${addition.policyName}" has a level ${addition.level} already, made since this was asked for, so no second one was made and nobody was added. Add them to that level instead, if they belong there.`,
        );
      }

      /*
       * A new level after the last: the level before waits afterMinutes
       * (buildLevelWait), and a new escalation rule pages them
       * (buildOnCallPolicyLevel) - the guided setup's addSecondLevel.
       */
      if (addition.previousRuleId) {
        const previous: OnCallDutyPolicyEscalationRule | null =
          await OnCallDutyPolicyEscalationRuleService.findOneById({
            id: new ObjectID(addition.previousRuleId),
            select: { _id: true, escalateAfterInMinutes: true },
            props: ctx.props,
          });

        if (
          previous?.id &&
          previous.escalateAfterInMinutes !== addition.afterMinutes
        ) {
          await OnCallDutyPolicyEscalationRuleService.updateOneById({
            id: previous.id,
            data: buildLevelWait(addition.afterMinutes),
            props: ctx.props,
          });
        }
      }

      const level: OnCallPolicyLevelCreate = buildOnCallPolicyLevel({
        projectId: ctx.projectId,
        policyId: policyId,
        userIds: userIds,
        teamIds: addition.teamIds,
      });

      await OnCallDutyPolicyEscalationRuleService.create({
        data: level.rule,
        miscDataProps: level.miscDataProps,
        props: ctx.props,
      });
      added = true;
    }

    if (!added) {
      // Who is there already is said beside the refusals (#10411).
      const notAdded: Array<string> = [
        ...failures.map((failure: string): string => {
          return failure.replace(/\.$/, "");
        }),
        ...alreadyThere.map((name: string): string => {
          return `"${name}" is paged at that level already`;
        }),
      ];

      throw new BadDataException(
        `Nobody was added to the on-call policy "${addition.policyName}", as each addition was refused (${notAdded.join("; ")}).`,
      );
    }

    const who: string = describeLevelInEnglish({
      people: people,
      teams: teams,
      invitedEmails: invitedEmails,
    });
    const responders: ReturnType<typeof aiActionList> = describeLevelResponders(
      {
        people: people,
        teams: teams,
        invitedEmails: invitedEmails,
      },
    );
    const ruleName: string =
      addition.ruleName || getDefaultEscalationRuleName(addition.level);

    return {
      dataForLlm: `${
        addition.ruleId
          ? `Added ${who} to the escalation rule "${ruleName}" (level ${addition.level}) of the on-call policy "${addition.policyName}": they are paged with the people it paged there already.`
          : `Added a new level to the on-call policy "${addition.policyName}": if nobody acknowledges within ${addition.afterMinutes} minute${addition.afterMinutes === 1 ? "" : "s"} of the level before it, it pages ${who}.`
      }${pagedThereAlready(alreadyThere)}${
        failures.length > 0
          ? ` Not added: ${failures.join("; ")}. Say exactly what was not added, and why.`
          : ""
      } ${getTestPageOfferForModel(ctx, SetupTestPageTarget.Policy)}`,
      rowCount: 1,
      ...citationSentence(AI_TOOL_CITATIONS.addedToOnCallPolicy, {
        name: addition.policyName,
      }),
      citationTarget: {
        type: AIChatCitationTargetType.OnCallPolicyView,
        params: { onCallDutyPolicyId: addition.policyId },
      },
      redactionCount: 0,
      isTruncated: false,
      widget: WidgetBuilder.actionCard({
        title: "Added to the on-call policy",
        heading: addition.policyName,
        words: {
          kind: aiActionTerm(AI_ACTION_CARD_KINDS.onCallPolicy),
          line: [
            addition.ruleId
              ? aiActionSentence(AI_ACTION_CARD_LINES.addedToEscalationRule, {
                  responders: responders,
                  rule: JSON.stringify(ruleName),
                })
              : aiActionPluralSentence(
                  AI_ACTION_PLURAL_LINES.pagesNextAfter,
                  addition.afterMinutes,
                  { responders: responders },
                ),
          ],
        },
        link: {
          type: AIChatCitationTargetType.OnCallPolicyView,
          params: { onCallDutyPolicyId: addition.policyId },
        },
        testPage: {
          kind: "policy",
          policyId: addition.policyId,
          policyName: addition.policyName,
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

    /*
     * The project's plan, asked before the card (#7250): on OneUptime
     * Cloud's Free plan a project has one status page, and an unpaid
     * subscription adds none - StatusPageService's own answer, which it
     * gives again when the page is created.
     */
    try {
      const planRefusal: string | null =
        await StatusPageService.getCreateRefusal({
          projectId: ctx.projectId,
          adding: countStatusPagesSetUpInPlan(ctx.plannedCalls),
        });

      if (planRefusal) {
        return {
          toldModel: `Nothing proposed: the project's plan does not allow another status page now. ${planRefusal} Tell the person what is needed, in these words. A status page the project has already can show the monitor: add_monitors_to_status_page adds it.`,
          refusal: AIToolRefusal.Plan,
        };
      }
    } catch {
      // Unreadable now: running it says why.
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
      ...citationSentence(AI_TOOL_CITATIONS.publishedStatusPage, { name }),
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
      ...citationSentence(AI_TOOL_CITATIONS.addedMonitorsToStatusPage, {
        name,
      }),
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
  InvitePeopleTool,
  SetUpPagingTool,
  AddToOnCallPolicyTool,
  SetHowToReachMeTool,
  SetUpWebsiteMonitoringTool,
  SetUpServiceMonitorTool,
  PublishStatusPageTool,
  AddMonitorsToStatusPageTool,
];

/*
 * The names Types/AI/AISetupActions gives the Dashboard, in the same
 * order: a tool renamed here without it fails SetupTools' own test.
 */
export const SETUP_TOOL_NAMES: ReadonlyArray<string> = [
  INVITE_PEOPLE_TOOL_NAME,
  SET_UP_PAGING_TOOL_NAME,
  ADD_TO_ON_CALL_POLICY_TOOL_NAME,
  SET_HOW_TO_REACH_ME_TOOL_NAME,
  SET_UP_WEBSITE_MONITORING_TOOL_NAME,
  SET_UP_SERVICE_MONITOR_TOOL_NAME,
  PUBLISH_STATUS_PAGE_TOOL_NAME,
  ADD_MONITORS_TO_STATUS_PAGE_TOOL_NAME,
];

// The setup actions of their own files, from here too: one place lists them all.
export { InvitePeopleTool, SetHowToReachMeTool, SetUpServiceMonitorTool };
