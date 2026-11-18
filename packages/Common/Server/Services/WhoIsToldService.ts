import { IsBillingEnabled } from "../EnvironmentConfig";
import InMemoryTTLCache from "../Infrastructure/InMemoryTTLCache";
import QueryHelper from "../Types/Database/QueryHelper";
import logger from "../Utils/Logger";
import MonitorRecordText, {
  MonitorRecordTextResult,
} from "../Utils/Monitor/MonitorRecordText";
import MonitorResourceContextUtil from "../Utils/Monitor/MonitorResourceContext";
import MonitorTemplateUtil from "../Utils/Monitor/MonitorTemplateUtil";
import SeriesResourceLinker, {
  SeriesResolvedResourceIds,
} from "../Utils/Monitor/SeriesResourceLinker";
import MonitorRuleCriteriaCache from "../Utils/Rules/MonitorRuleCriteriaCache";
import { InheritedOwnersCache } from "../Utils/Rules/InheritedOwners";
import OwnerRulePlanBuilder, {
  OwnerIdSets,
  OwnerRuleInheritSource,
  OwnerRulePlan,
  OwnerRulePlanEntry,
} from "../Utils/Rules/OwnerRulePlan";
import {
  LabelInheritableResources,
  LabelRulePlan,
  LabelRulePlanEntry,
  doLabelRulesInheritFromResources,
  getLabelResourceIds,
  getNoLabelRulePlan,
} from "../Utils/Rules/LabelRulePlan";
import {
  PrivacyRulePlan,
  getPrivacyRulesThatApply,
} from "../Utils/Rules/PrivacyRulePlan";
import {
  canReadPrivateRecordWithOwners,
  shouldBypassRecordPrivacy,
} from "../Utils/PrivacyFilterUtil";
import ServerSendingStatus from "../Utils/ServerSending/ServerSendingStatus";
import IncidentStatusPageScope, {
  ResolvedIncidentStatusPages,
} from "../Utils/StatusPage/IncidentStatusPageScope";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import OnCallRulePagingHoldUtil from "../Utils/OnCall/OnCallRulePagingHold";
import AlertIncidentRuleEngineService, {
  AlertIncidentRulePlan,
} from "./AlertIncidentRuleEngineService";
import AlertIncidentRuleService from "./AlertIncidentRuleService";
import AlertLabelRuleEngineService from "./AlertLabelRuleEngineService";
import AlertLabelRuleService from "./AlertLabelRuleService";
import AlertOnCallRuleEngineService from "./AlertOnCallRuleEngineService";
import AlertOnCallRuleService from "./AlertOnCallRuleService";
import AlertOwnerRuleEngineService from "./AlertOwnerRuleEngineService";
import AlertOwnerRuleService from "./AlertOwnerRuleService";
import AlertPrivacyRuleEngineService from "./AlertPrivacyRuleEngineService";
import AlertPrivacyRuleService from "./AlertPrivacyRuleService";
import AlertSeverityService from "./AlertSeverityService";
import IncidentLabelRuleEngineService from "./IncidentLabelRuleEngineService";
import IncidentLabelRuleService from "./IncidentLabelRuleService";
import IncidentOnCallRuleEngineService from "./IncidentOnCallRuleEngineService";
import IncidentOnCallRuleService from "./IncidentOnCallRuleService";
import IncidentOwnerRuleEngineService from "./IncidentOwnerRuleEngineService";
import IncidentOwnerRuleService from "./IncidentOwnerRuleService";
import IncidentPrivacyRuleEngineService from "./IncidentPrivacyRuleEngineService";
import IncidentPrivacyRuleService from "./IncidentPrivacyRuleService";
import IncidentSeverityService from "./IncidentSeverityService";
import MonitorGroupService from "./MonitorGroupService";
import MonitorService from "./MonitorService";
import MonitorStatusService from "./MonitorStatusService";
import NetworkDeviceOwnerUserService, {
  NetworkDeviceOwners,
} from "./NetworkDeviceOwnerUserService";
import OnCallDutyPolicyService from "./OnCallDutyPolicyService";
import OnCallReadinessService, {
  ReadinessMethod,
  UserReadiness,
} from "./OnCallReadinessService";
import OnCallTestPageService, {
  getPreviewMethodsOfRule,
} from "./OnCallTestPageService";
import ProjectCallSMSConfigService from "./ProjectCallSMSConfigService";
import ProjectService from "./ProjectService";
import StatusPageService from "./StatusPageService";
import TeamMemberService from "./TeamMemberService";
import TeamService from "./TeamService";
import UserNotificationRuleService, {
  FallbackRule,
} from "./UserNotificationRuleService";
import UserService from "./UserService";
import Alert from "../../Models/DatabaseModels/Alert";
import AlertIncidentRule from "../../Models/DatabaseModels/AlertIncidentRule";
import AlertLabelRule from "../../Models/DatabaseModels/AlertLabelRule";
import AlertOnCallRule from "../../Models/DatabaseModels/AlertOnCallRule";
import AlertOwnerRule from "../../Models/DatabaseModels/AlertOwnerRule";
import AlertPrivacyRule from "../../Models/DatabaseModels/AlertPrivacyRule";
import AlertSeverity from "../../Models/DatabaseModels/AlertSeverity";
import Incident from "../../Models/DatabaseModels/Incident";
import IncidentLabelRule from "../../Models/DatabaseModels/IncidentLabelRule";
import IncidentOnCallRule from "../../Models/DatabaseModels/IncidentOnCallRule";
import IncidentOwnerRule from "../../Models/DatabaseModels/IncidentOwnerRule";
import IncidentPrivacyRule from "../../Models/DatabaseModels/IncidentPrivacyRule";
import IncidentSeverity from "../../Models/DatabaseModels/IncidentSeverity";
import Label from "../../Models/DatabaseModels/Label";
import Monitor from "../../Models/DatabaseModels/Monitor";
import MonitorStatus from "../../Models/DatabaseModels/MonitorStatus";
import OnCallDutyPolicy from "../../Models/DatabaseModels/OnCallDutyPolicy";
import Project from "../../Models/DatabaseModels/Project";
import Team from "../../Models/DatabaseModels/Team";
import TeamMember from "../../Models/DatabaseModels/TeamMember";
import User from "../../Models/DatabaseModels/User";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import TwilioConfig from "../../Types/CallAndSMS/TwilioConfig";
import LIMIT_MAX, { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import OneUptimeDate from "../../Types/Date";
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONObject } from "../../Types/JSON";
import { CriteriaAlert } from "../../Types/Monitor/CriteriaAlert";
import { CriteriaIncident } from "../../Types/Monitor/CriteriaIncident";
import MonitorCriteriaInstance from "../../Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../Types/Monitor/MonitorSteps";
import MonitorType from "../../Types/Monitor/MonitorType";
import OwnedScopePermission from "../Types/Database/Permissions/OwnedScopePermission";
import StatusPageResource from "../../Models/DatabaseModels/StatusPageResource";
import {
  WHO_IS_TOLD_CACHE_TTL_IN_MS,
  WhoIsToldChannels,
  WhoIsToldCriteria,
  WhoIsToldEvent,
  WhoIsToldMonitorGroup,
  WhoIsToldOwnerAddedBy,
  WhoIsToldOwnerIds,
  WhoIsToldOwnerKind,
  WhoIsToldOwnerMatch,
  WhoIsToldOwnerNotReached,
  WhoIsToldOwnerProblem,
  WhoIsToldOwnerRecipient,
  WhoIsToldOwners,
  WhoIsToldOwnersSource,
  WhoIsToldPerson,
  WhoIsToldPolicy,
  WhoIsToldProjectFacts,
  WhoIsToldResult,
  WhoIsToldRule,
  WhoIsToldStatusPage,
  getChannelsSwitchedOff,
  getWhoIsToldBreaks,
  getWhoIsToldPersonReach,
  isWhoIsToldEventHidden,
  redactWhoIsTold,
} from "../../Types/Monitor/WhoIsTold";
import NotificationRuleType from "../../Types/NotificationRule/NotificationRuleType";
import ObjectID from "../../Types/ObjectID";
import { OnCallPageChannel } from "../../Types/OnCallDutyPolicy/OnCallPageChannel";
import {
  OnCallTestPageNotPaged,
  OnCallTestPagePreviewPerson,
  OnCallTestPageReachedThrough,
  OnCallTestPageRecordKind,
  getOnCallTestPageRuleType,
} from "../../Types/OnCallDutyPolicy/OnCallTestPage";
import {
  ServerChannelStatus,
  ServerSendingChannel,
  ServerSendingState,
} from "../../Types/ServerSending/ServerSendingStatus";
import { TwilioMessageKind } from "../../Utils/Project/TwilioAccount";

/*
 * WHO IS TOLD WHEN A MONITOR GOES DOWN (Types/Monitor/WhoIsTold): the
 * resolver.
 *
 * Reads, as OneUptime, everything between a monitor's criteria and the
 * people they reach - and sends, attaches and writes nothing:
 *
 *   - each enabled criteria, in the order they are checked: the status it
 *     sets, and each incident or alert it opens, with its severity (one the
 *     project does not have falls back to its first, as MonitorIncident
 *     does) and its title - the criteria's template rendered as
 *     MonitorIncident renders it (MonitorRecordText), with what is known of
 *     the monitor before a check (buildStorageMapBeforeCheck);
 *   - who that emails as owners: the people and teams the criteria names,
 *     the owners of the network device the monitor watches, and whom the
 *     project's owner rules add - by the owner rule engines' own plan
 *     (planRules) of the incident or alert held in memory - or, when that
 *     is nobody, the project's owners; and the monitor's owners of a status
 *     change;
 *   - which on-call rules match what it opens, by the rule engines' own
 *     matching (getMatchingRules) run on the same incident or alert, and the
 *     policies they and the criteria run;
 *   - who each policy's first level reaches right now, read as a test of the
 *     policy reads it (OnCallTestPageService.readFirstLevel), and how a page
 *     of the severity reaches each of them: their rules for it, or, when the
 *     project falls back, what the fallback picks of their methods - read
 *     by the fallback's own chooser (UserNotificationRuleService
 *     .getFallbackRules), so it never drifts from what a page sends (#7528);
 *   - the project's channels, its balance on OneUptime Cloud, and on a
 *     self-hosted server whether it can send email, SMS and calls;
 *   - the status pages an incident shows on, as IncidentStatusPageScope
 *     works out where an incident reaches: each page that lists the monitor,
 *     directly or through a monitor group.
 *
 * The answer is kept a minute per monitor, as Readiness keeps its own, and
 * each caller is handed it as they may see it (getForMonitor): somebody who
 * may read the monitor and not a policy learns that paging is set up, and
 * nothing of who; a rule or a status page they may not read is not named.
 */

/*
 * What is read once per project and shared by every monitor a resolve asks
 * about: one (resolve) or all of them (resolveProject). The maps fill as
 * the monitors are resolved, so a policy's first level and a person's
 * paging rules are read once however many monitors reach them.
 */
interface ProjectContext {
  projectId: ObjectID;
  project: Project | null;
  channels: WhoIsToldChannels;
  incidentSeverities: Array<IncidentSeverity>;
  alertSeverities: Array<AlertSeverity>;
  statuses: Map<string, MonitorStatus>;
  policyNames: Map<string, string>;
  /*
   * The project has an on-call policy in service (not archived): with none,
   * a monitor that pages nobody is sent to the on-call guided setup (#7369).
   */
  projectHasOnCallPolicies: boolean;
  /*
   * The project's enabled owner rules, as the engines read them (kept
   * between creates, RuleSetCache). Every record's owners are worked out,
   * for breaks only too: an alert on-call rule can match on who owns the
   * alert (#9407), who may read a private record is its owners (#9370), and
   * Setup health lists the owners no Created email reaches (#9371).
   */
  incidentOwnerRules: Array<IncidentOwnerRule>;
  alertOwnerRules: Array<AlertOwnerRule>;
  /*
   * Set when the whole project is resolved at once (resolveProject): who
   * owns each network device its monitors watch, by device id in lower
   * case, read in one go (readOwnersOfProject) - so no monitor reads its
   * device's owners on its own. Null for one monitor, which reads them as
   * MonitorIncident and MonitorAlert do.
   */
  deviceOwnersByDevice: Map<string, NetworkDeviceOwners> | null;
  /*
   * Set when the whole project is resolved at once: who owns the resources
   * an owner rule inherits owners from, each read once for every record
   * (InheritedOwnersCache) - every monitor's at once. Null for one monitor,
   * whose owner rules read them as its create's do.
   */
  inheritedOwners: InheritedOwnersCache | null;
  /*
   * Its enabled privacy, label and alert incident rules, as the engines
   * read them (#7212, #7213, #7216): what a new incident or alert is made
   * private by, labelled with before its on-call rules match, and declared
   * an incident from. Privacy is read for breaks only too: a private record
   * that is not a reader's to see raises no break of theirs (#9370).
   */
  incidentPrivacyRules: Array<IncidentPrivacyRule>;
  alertPrivacyRules: Array<AlertPrivacyRule>;
  incidentLabelRules: Array<IncidentLabelRule>;
  alertLabelRules: Array<AlertLabelRule>;
  alertIncidentRules: Array<AlertIncidentRule>;
  projectHasIncidentOnCallRules: boolean;
  projectHasAlertOnCallRules: boolean;
  // People's and teams' names, by id, read once.
  userNames: Map<string, string>;
  teamNames: Map<string, string>;
  /*
   * Whether a team is the project's, by id, read with its name: a team of
   * another project is named by nobody here (#7572).
   */
  projectTeams: Map<string, boolean>;
  /*
   * Who an owner's Created email reaches, by id, read once
   * (readOwnersReached): whether a person is a member of the project, and
   * whether a team of it has a member who is.
   */
  projectMembers: Map<string, boolean>;
  teamsWithMembers: Map<string, boolean>;
  /*
   * The members of each owner team the Created email reaches through it, by
   * team id, read with the above: the person by person of an event's owners
   * (WhoIsToldOwners.recipients, #8860).
   */
  teamMemberIds: Map<string, Array<string>>;
  projectOwnerNames: Array<string> | null;
  // The project's owners, by id and name, read with their names.
  projectOwners: Array<{ id: string; name: string }> | null;
  channelsOff: Array<OnCallPageChannel>;
  isFallbackEnabled: boolean;
  firstLevels: Map<string, FirstLevel>;
  people: Map<string, WhoIsToldPerson>;
  previews: Map<string, OnCallTestPagePreviewPerson>;
  verifiedChannels: Map<string, Array<OnCallPageChannel>>;
  /*
   * What the fallback picks of a person's methods, by person and kind of
   * page (readFallbackChannels): read once however many severities,
   * policies and monitors reach them.
   */
  fallbackChannels: Map<string, Array<OnCallPageChannel>>;
  /*
   * Set when the whole project is resolved at once (resolveProject): its
   * enabled on-call rules, read once, and its monitors in the cache the
   * engines' matching reads them from - so the matching reads nothing per
   * monitor. Null for one monitor, whose matching reads as the engines do.
   */
  matching: PreloadedMatching | null;
  /*
   * What Setup health needs, and no more (resolveProject): the breaks, and
   * every record's owners as ids - whom its Alert Owner rules match on
   * (#9407), who may read it when it is private (#9370), and who no Created
   * email reaches (#9371) - but not the names of those it reaches, the
   * people its email is addressed to, the matched rules' owners by name,
   * the label rules that change who is paged, nor the status pages an
   * incident shows on: no finding depends on them.
   */
  isForBreaksOnly: boolean;
}

interface PreloadedMatching {
  incidentRules: Array<IncidentOnCallRule>;
  alertRules: Array<AlertOnCallRule>;
  monitorCache: MonitorRuleCriteriaCache;
}

// What one resolve of one monitor reads once and hands every criteria.
interface ResolveContext extends ProjectContext {
  monitor: Monitor;
  /*
   * The monitor as every rule engine's matching reads it - its name,
   * description and labels - seeded with the monitor in hand: the project's
   * shared cache for breaks only, else one of this resolve's own.
   */
  monitorCache: MonitorRuleCriteriaCache;
  /*
   * A monitor not created yet (getForDraft): who creates it, and so owns it
   * as it is created (DatabaseService.autoOwnerOnCreate) - null for a saved
   * monitor, or a creator who is no person. It is on no status page yet.
   */
  newMonitorCreatorId: string | null;
  // What a title can say before a check (buildStorageMapBeforeCheck).
  storageMap: JSONObject;
  // What an incident or alert from the monitor is about, read when needed.
  resources: Promise<Array<SeriesResolvedResourceIds>> | null;
  // The owners of the network device the monitor watches, by step.
  deviceOwners: Map<string, NetworkDeviceOwners>;
  monitorOwnerNames: Array<string> | null;
  statusPages: Array<WhoIsToldStatusPage>;
}

/*
 * The columns of a monitor a resolve reads. A caller that hands
 * resolveProject the monitors it read itself (SetupHealthService) selects
 * at least these.
 */
export const WHO_IS_TOLD_MONITOR_SELECT: {
  _id: true;
  name: true;
  description: true;
  slug: true;
  monitorType: true;
  projectId: true;
  monitorSteps: true;
  autoProvisionedNetworkDeviceId: true;
  labels: { _id: true };
} = {
  _id: true,
  name: true,
  description: true,
  slug: true,
  monitorType: true,
  projectId: true,
  monitorSteps: true,
  autoProvisionedNetworkDeviceId: true,
  labels: { _id: true },
};

/*
 * A policy's first level as a test reads it (OnCallTestPageService.
 * readFirstLevel): who it pages and why, and who it can't reach - in
 * English, and as codes the card words in the reader's language (#7261).
 */
interface FirstLevel {
  targets: Array<{
    userId: ObjectID;
    reachedThrough?: string | undefined;
    reachedThroughCode?: OnCallTestPageReachedThrough | undefined;
  }>;
  notPaged: Array<string>;
  notPagedCodes: Array<OnCallTestPageNotPaged>;
  levelCount: number;
}

/*
 * A monitor someone is setting up (#7055): on Create Monitor, the form's
 * name, type, labels and steps; editing a saved monitor's criteria, its id
 * and the steps being edited.
 */
export interface WhoIsToldDraft {
  monitorId?: ObjectID | undefined;
  name: string;
  description?: string | undefined;
  monitorType: MonitorType;
  monitorSteps: MonitorSteps;
  labelIds: Array<ObjectID>;
}

// One criteria of a monitor, and the step it is checked in.
export interface MonitorCriteriaOfStep {
  instance: MonitorCriteriaInstance;
  // The step's id; "" for a step without one.
  monitorStepId: string;
}

// The criteria of every step of a monitor, each once, in the order checked.
export function getMonitorCriteria(
  monitorSteps: MonitorSteps | undefined | null,
): Array<MonitorCriteriaOfStep> {
  const items: Array<MonitorCriteriaOfStep> = [];
  const seen: Set<string> = new Set<string>();

  for (const step of monitorSteps?.data?.monitorStepsInstanceArray || []) {
    const criteria: Array<MonitorCriteriaInstance> =
      (step as MonitorStep)?.data?.monitorCriteria?.data
        ?.monitorCriteriaInstanceArray || [];

    for (const instance of criteria) {
      const id: string = instance?.data?.id || "";

      if (!instance?.data || (id && seen.has(id))) {
        continue;
      }

      if (id) {
        seen.add(id);
      }

      items.push({
        instance: instance,
        monitorStepId: idText((step as MonitorStep)?.id),
      });
    }
  }

  return items;
}

// The criteria of every step of a monitor, each once, in the order checked.
export function getMonitorCriteriaInstances(
  monitorSteps: MonitorSteps | undefined | null,
): Array<MonitorCriteriaInstance> {
  return getMonitorCriteria(monitorSteps).map(
    (item: MonitorCriteriaOfStep): MonitorCriteriaInstance => {
      return item.instance;
    },
  );
}

// An id held as an ObjectID or as text, as text; "" for an empty one.
function idText(id: ObjectID | string | null | undefined): string {
  return id ? id.toString().trim() : "";
}

// Ids as text, each once, in their order; empty ones left out.
function uniqueIds(
  ids: ReadonlyArray<ObjectID | string | null | undefined>,
): Array<string> {
  const unique: Array<string> = [];
  const seen: Set<string> = new Set<string>();

  for (const id of ids) {
    const text: string = idText(id);

    if (text && !seen.has(text.toLowerCase())) {
      seen.add(text.toLowerCase());
      unique.push(text);
    }
  }

  return unique;
}

/*
 * Who the project's owner rules add to what opens, and the rules that add
 * anyone (OwnerRulePlan), each with whom it adds: a rule that matches and
 * adds nobody - it inherits from a resource nobody owns - is not why anyone
 * is emailed, nor is one that adds only people and teams the email does not
 * reach (getEventOwners).
 */
interface OwnerRuleAddition {
  rule: WhoIsToldRule;
  userIds: Array<string>;
  teamIds: Array<string>;
}

interface OwnerRuleAdditions {
  userIds: Array<string>;
  teamIds: Array<string>;
  rules: Array<OwnerRuleAddition>;
}

// Who what opens emails as its owners, and the owner rules that add any of them.
interface EventOwners {
  owners: WhoIsToldOwners;
  ownerRules: Array<WhoIsToldRule>;
  // The ids of its owners as the record will have them (WhoIsToldOwnerIds).
  ownerIds: WhoIsToldOwnerIds;
}

// The ids of a record's owners, people and teams in one list, as an owner condition reads them.
function ownerIdsOf(owners: EventOwners): Array<string> {
  return [...owners.ownerIds.userIds, ...owners.ownerIds.teamIds];
}

const NO_DEVICE_OWNERS: NetworkDeviceOwners = {
  ownerUserIds: [],
  ownerTeamIds: [],
};

/*
 * The owners a record is given as it opens: the criteria's - or, for an
 * incident declared from a private alert, the alert's - and what named
 * them, for an owner no email reaches (#7572). Null when they are said
 * elsewhere: the alert's owners an incident takes are the alert's to say.
 */
interface NamedOwners {
  userIds: ReadonlyArray<ObjectID | string>;
  teamIds: ReadonlyArray<ObjectID | string>;
  addedBy: WhoIsToldOwnerAddedBy | null;
}

// A rule as the chain names it.
function toWhoIsToldRule(rule: {
  id?: ObjectID | null | undefined;
  name?: string | null | undefined;
}): WhoIsToldRule {
  return { id: idText(rule.id), name: rule.name?.toString() || "" };
}

// Whether two matchings found the same rules.
function sameRuleIds(
  left: ReadonlyArray<{ id?: ObjectID | null | undefined }>,
  right: ReadonlyArray<{ id?: ObjectID | null | undefined }>,
): boolean {
  const ids: (
    rules: ReadonlyArray<{ id?: ObjectID | null | undefined }>,
  ) => string = (
    rules: ReadonlyArray<{ id?: ObjectID | null | undefined }>,
  ): string => {
    return uniqueIds(
      rules.map((rule: { id?: ObjectID | null | undefined }): string => {
        return idText(rule.id).toLowerCase();
      }),
    )
      .sort()
      .join("|");
  };

  return ids(left) === ids(right);
}

const NO_OWNER_RULE_ADDITIONS: OwnerRuleAdditions = {
  userIds: [],
  teamIds: [],
  rules: [],
};

export function getOwnerRuleAdditions<
  TRule extends {
    id?: ObjectID | null | undefined;
    name?: string | null | undefined;
  },
>(plan: OwnerRulePlan<TRule> | null): OwnerRuleAdditions {
  if (!plan) {
    return NO_OWNER_RULE_ADDITIONS;
  }

  return {
    userIds: uniqueIds(Array.from(plan.allUserIds)),
    teamIds: uniqueIds(Array.from(plan.allTeamIds)),
    rules: plan.entries
      .filter((entry: OwnerRulePlanEntry<TRule>): boolean => {
        return entry.userIds.length > 0 || entry.teamIds.length > 0;
      })
      .map((entry: OwnerRulePlanEntry<TRule>): OwnerRuleAddition => {
        return {
          rule: {
            id: idText(entry.rule.id),
            name: entry.rule.name?.toString() || "",
          },
          userIds: uniqueIds(entry.userIds),
          teamIds: uniqueIds(entry.teamIds),
        };
      }),
  };
}

// Whether any of these owner rules inherits owners from a resource other than the monitor.
function inheritsFromResources(rules: ReadonlyArray<unknown>): boolean {
  return rules.some((rule: unknown): boolean => {
    return OwnerRulePlanBuilder.getInheritSources(rule).some(
      (source: OwnerRuleInheritSource): boolean => {
        return source !== "monitors";
      },
    );
  });
}

/*
 * The severity what opens gets: the criteria's, when the project has it,
 * or the project's first that is not archived - as MonitorIncident and
 * MonitorAlert pick it.
 */
export function pickSeverity<
  T extends { id?: ObjectID | null; isArchived?: boolean | undefined },
>(
  severities: ReadonlyArray<T>,
  wantedId: ObjectID | string | undefined,
): T | null {
  const wanted: string = idText(wantedId);

  if (wanted) {
    const named: T | undefined = severities.find((severity: T): boolean => {
      return idText(severity.id) === wanted;
    });

    if (named) {
      return named;
    }
  }

  return (
    severities.find((severity: T): boolean => {
      return !severity.isArchived;
    }) || null
  );
}

// The ids of a list of models, each once.
function idsOf(
  items: ReadonlyArray<{ id?: ObjectID | null } | null | undefined>,
): Array<string> {
  const ids: Array<string> = [];

  for (const item of items) {
    const id: string = idText(item?.id);

    if (id && !ids.includes(id)) {
      ids.push(id);
    }
  }

  return ids;
}

/*
 * Whether the server can send by a channel: not while it is not set up, or
 * its sends fail. Null when the server says nothing of it.
 */
export function canServerSendBy(
  statuses: ReadonlyArray<ServerChannelStatus>,
  channel: ServerSendingChannel,
): boolean | null {
  const status: ServerChannelStatus | undefined = statuses.find(
    (item: ServerChannelStatus): boolean => {
      return item.channel === channel;
    },
  );

  if (!status) {
    return null;
  }

  return !(
    status.state === ServerSendingState.NotSetUp ||
    status.state === ServerSendingState.Failing
  );
}

/*
 * The channels of what the fallback picked (getFallbackRules), in the order
 * it sends them: each picked rule read as a test page's preview reads a
 * rule (getPreviewMethodsOfRule), each channel once.
 */
// The resources a page lists that reach the monitor, by the page's id.
function getPageResources(
  reached: ResolvedIncidentStatusPages,
  statusPageId: string,
): Array<StatusPageResource> {
  for (const [key, resources] of Object.entries(
    reached.statusPageToResources,
  )) {
    if (key.toLowerCase() === statusPageId.toLowerCase()) {
      return resources || [];
    }
  }

  return [];
}

/*
 * THE MONITOR GROUPS A STATUS PAGE SHOWS THE MONITOR THROUGH (#7214),
 * each once, by name - none when the page lists the monitor itself: that
 * resource is what people change first, whatever groups the monitor is in.
 */
export function getMonitorGroupsOfPage(data: {
  monitorId: string;
  resources: ReadonlyArray<StatusPageResource>;
}): Array<WhoIsToldMonitorGroup> {
  const monitorId: string = data.monitorId.toLowerCase();

  const listsItself: boolean = data.resources.some(
    (resource: StatusPageResource): boolean => {
      return idText(resource.monitorId).toLowerCase() === monitorId;
    },
  );

  if (listsItself) {
    return [];
  }

  const groups: Array<WhoIsToldMonitorGroup> = [];

  for (const resource of data.resources) {
    const id: string = idText(
      resource.monitorGroupId || resource.monitorGroup?.id,
    );

    if (
      !id ||
      groups.some((group: WhoIsToldMonitorGroup): boolean => {
        return group.id.toLowerCase() === id.toLowerCase();
      })
    ) {
      continue;
    }

    groups.push({
      id: id,
      name: resource.monitorGroup?.name?.toString() || "",
    });
  }

  return groups;
}

/*
 * Every incident and alert of an answer: each criteria's, and the incident
 * an alert incident rule declares from an alert (#7216).
 */
export function getAllEvents(
  result: Pick<WhoIsToldResult, "criteria">,
): Array<WhoIsToldEvent> {
  const events: Array<WhoIsToldEvent> = [];

  for (const item of result.criteria) {
    for (const event of item.events) {
      events.push(event);

      if (event.declares) {
        events.push(event.declares.incident);
      }
    }
  }

  return events;
}

/*
 * Whether the caller could read a record the criteria would open once it
 * exists, private (#7213): by the private-record rule
 * (canReadPrivateRecordWithOwners), on the owners the resolver worked out
 * for it. One whose owners were not worked out is nobody's but those who
 * see every private record.
 */
export function canReadPrivateRecord(data: {
  props: DatabaseCommonInteractionProps;
  ownerIds: WhoIsToldOwnerIds | undefined;
  // The teams whose invitation the caller has accepted, by lower-cased id.
  memberOfTeamIds: ReadonlySet<string>;
}): boolean {
  return canReadPrivateRecordWithOwners({
    props: data.props,
    ownerUserIds: data.ownerIds?.userIds || [],
    ownerTeamIds: data.ownerIds?.teamIds || [],
    callerAcceptedTeamIds: data.memberOfTeamIds,
  });
}

export function getFallbackRuleChannels(
  rules: ReadonlyArray<FallbackRule>,
): Array<OnCallPageChannel> {
  const channels: Array<OnCallPageChannel> = [];

  for (const picked of rules) {
    for (const method of getPreviewMethodsOfRule({
      rule: picked.rule,
      showAddresses: false,
    })) {
      if (!channels.includes(method.channel)) {
        channels.push(method.channel);
      }
    }
  }

  return channels;
}

export class WhoIsToldService {
  private static cache: InMemoryTTLCache<WhoIsToldResult> =
    new InMemoryTTLCache<WhoIsToldResult>(10_000);

  public static clearCache(): void {
    this.cache.clear();
  }

  /*
   * THE ANSWER FOR ONE CALLER. They must be able to read the monitor; what
   * they may not read of the policies and rules is taken out
   * (redactWhoIsTold).
   */
  @CaptureSpan()
  public static async getForMonitor(data: {
    projectId: ObjectID;
    monitorId: ObjectID;
    props: DatabaseCommonInteractionProps;
    // Work it out again now, rather than hand the minute-old answer.
    refresh?: boolean | undefined;
  }): Promise<WhoIsToldResult> {
    const readable: Monitor | null = await MonitorService.findOneBy({
      query: {
        _id: data.monitorId.toString(),
        projectId: data.projectId,
      },
      select: {
        _id: true,
      },
      props: data.props,
    });

    if (!readable) {
      throw new BadDataException("Monitor not found.");
    }

    const result: WhoIsToldResult = await this.resolve({
      projectId: data.projectId,
      monitorId: data.monitorId,
      refresh: data.refresh,
    });

    return await this.getForCaller({
      projectId: data.projectId,
      props: data.props,
      result: result,
    });
  }

  /*
   * WHO A MONITOR NOT SAVED YET WOULD TELL (#7055): the answer for the
   * criteria someone is choosing - on Create Monitor, or editing a saved
   * monitor's criteria - worked out by the same resolver as a saved
   * monitor's, on the monitor held in memory, and handed to them as they
   * may see it. Nothing is read from a cache or kept.
   *
   * A new monitor takes the name, type, labels and steps of the form; it
   * is on no status page yet, and whoever creates it owns it as it is
   * created (DatabaseService.autoOwnerOnCreate): its status changes email
   * them, and an owner rule that inherits the monitor's owners adds them.
   * Previewing it takes what creating it takes. A saved monitor's criteria
   * take its own name, labels and status pages, and the steps being edited;
   * previewing them takes reading it.
   */
  @CaptureSpan()
  public static async getForDraft(data: {
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
    draft: WhoIsToldDraft;
  }): Promise<WhoIsToldResult> {
    const monitor: Monitor = await this.getDraftMonitor(data);
    const isNew: boolean = !data.draft.monitorId;

    const project: ProjectContext = await this.readProjectContext({
      projectId: data.projectId,
      matching: null,
      isForBreaksOnly: false,
    });

    const result: WhoIsToldResult = await this.resolveMonitor({
      project: project,
      monitor: monitor,
      newMonitor: isNew
        ? {
            // As DatabaseService.autoOwnerOnCreate makes them its owner.
            creatorUserId:
              OwnedScopePermission.isCreatorMadeOwner(data.props) &&
              OwnedScopePermission.hasOwnerTables(Monitor)
                ? data.props.userId!.toString()
                : null,
          }
        : undefined,
    });

    return await this.getForCaller({
      projectId: data.projectId,
      props: data.props,
      result: { ...result, monitorId: isNew ? "" : result.monitorId },
    });
  }

  /*
   * The monitor a draft describes, held in memory: a saved one read as the
   * resolver reads it (the caller must be able to read it), its steps those
   * of the draft; or a new one, for a caller who may create a monitor, with
   * an id of its own that names no saved monitor.
   */
  private static async getDraftMonitor(data: {
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
    draft: WhoIsToldDraft;
  }): Promise<Monitor> {
    if (data.draft.monitorId) {
      const readable: Monitor | null = await MonitorService.findOneBy({
        query: {
          _id: data.draft.monitorId.toString(),
          projectId: data.projectId,
        },
        select: { _id: true },
        props: data.props,
      });

      const saved: Monitor | null = readable
        ? await MonitorService.findOneBy({
            query: {
              _id: data.draft.monitorId.toString(),
              projectId: data.projectId,
            },
            select: WHO_IS_TOLD_MONITOR_SELECT,
            props: { isRoot: true },
          })
        : null;

      if (!saved) {
        throw new BadDataException("Monitor not found.");
      }

      saved.monitorSteps = data.draft.monitorSteps;

      return saved;
    }

    /*
     * Seeing who a new monitor tells takes what creating it takes: the very
     * checks its create runs, asked without creating it
     * (DatabaseService.checkCallerMayCreate) - the table and every column
     * it is written with, its labels, and what a grant limited to labels or
     * to owned records reaches - refused as its create would be. Asked of a
     * copy of its own, as the check stamps what it is handed.
     */
    await MonitorService.checkCallerMayCreate({
      data: this.newMonitorOfDraft(data),
      props: data.props,
    });

    const monitor: Monitor = this.newMonitorOfDraft(data);
    monitor.id = ObjectID.generate();

    return monitor;
  }

  // A new monitor as a draft describes it, as its create would be handed it.
  private static newMonitorOfDraft(data: {
    projectId: ObjectID;
    draft: WhoIsToldDraft;
  }): Monitor {
    const monitor: Monitor = new Monitor();
    monitor.projectId = data.projectId;
    monitor.name = data.draft.name;
    monitor.description = data.draft.description || "";
    monitor.monitorType = data.draft.monitorType;
    monitor.monitorSteps = data.draft.monitorSteps;
    monitor.labels = uniqueIds(data.draft.labelIds).map((id: string): Label => {
      const label: Label = new Label();
      label._id = id;
      return label;
    });

    return monitor;
  }

  /*
   * An answer as one caller may see it (redactWhoIsTold): each policy,
   * rule, status page and monitor group asked as they would list it, and
   * each private record (#7213) theirs only when they could read it once it
   * exists - as an owner of it, an accepted member of a team of its owners,
   * or a Project Owner or Project Admin (canReadPrivateRecord).
   */
  private static async getForCaller(data: {
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
    result: WhoIsToldResult;
  }): Promise<WhoIsToldResult> {
    const { projectId, props, result } = data;

    const policyIds: Set<string> = new Set<string>();
    const incidentRuleIds: Set<string> = new Set<string>();
    const alertRuleIds: Set<string> = new Set<string>();
    const incidentOwnerRuleIds: Set<string> = new Set<string>();
    const alertOwnerRuleIds: Set<string> = new Set<string>();
    const incidentPrivacyRuleIds: Set<string> = new Set<string>();
    const alertPrivacyRuleIds: Set<string> = new Set<string>();
    const incidentLabelRuleIds: Set<string> = new Set<string>();
    const alertLabelRuleIds: Set<string> = new Set<string>();
    const alertIncidentRuleIds: Set<string> = new Set<string>();
    const statusPageIds: Set<string> = new Set<string>();
    const monitorGroupIds: Set<string> = new Set<string>();

    for (const event of getAllEvents(result)) {
      const isAlert: boolean = event.kind === OnCallTestPageRecordKind.Alert;

      for (const policy of event.policies) {
        policyIds.add(policy.id);
      }

      for (const rule of event.rules) {
        (isAlert ? alertRuleIds : incidentRuleIds).add(rule.id);
      }

      for (const rule of event.ownerRules) {
        (isAlert ? alertOwnerRuleIds : incidentOwnerRuleIds).add(rule.id);
      }

      // An owner rule that adds only owners no email reaches is named too (#7572).
      for (const owner of event.owners.notReached || []) {
        if (owner.rule) {
          (isAlert ? alertOwnerRuleIds : incidentOwnerRuleIds).add(
            owner.rule.id,
          );
        }
      }

      for (const rule of event.privacyRules || []) {
        (isAlert ? alertPrivacyRuleIds : incidentPrivacyRuleIds).add(rule.id);
      }

      for (const rule of event.labelRules || []) {
        (isAlert ? alertLabelRuleIds : incidentLabelRuleIds).add(rule.id);
      }

      if (event.declares) {
        alertIncidentRuleIds.add(event.declares.rule.id);
      }

      for (const page of event.statusPages) {
        statusPageIds.add(page.id);

        for (const group of page.groups || []) {
          monitorGroupIds.add(group.id);
        }
      }
    }

    const readablePolicyIds: Set<string> = await this.readableIds({
      ids: policyIds,
      read: async (
        query: Array<ObjectID>,
      ): Promise<Array<{ id?: ObjectID | null }>> => {
        return await OnCallDutyPolicyService.findBy({
          query: { _id: QueryHelper.any(query), projectId: projectId },
          select: { _id: true },
          skip: 0,
          limit: LIMIT_PER_PROJECT,
          props: props,
        });
      },
    });

    const readableIncidentRules: Set<string> = await this.readableIds({
      ids: incidentRuleIds,
      read: async (
        query: Array<ObjectID>,
      ): Promise<Array<{ id?: ObjectID | null }>> => {
        return await IncidentOnCallRuleService.findBy({
          query: { _id: QueryHelper.any(query), projectId: projectId },
          select: { _id: true },
          skip: 0,
          limit: LIMIT_PER_PROJECT,
          props: props,
        });
      },
    });

    const readableAlertRules: Set<string> = await this.readableIds({
      ids: alertRuleIds,
      read: async (
        query: Array<ObjectID>,
      ): Promise<Array<{ id?: ObjectID | null }>> => {
        return await AlertOnCallRuleService.findBy({
          query: { _id: QueryHelper.any(query), projectId: projectId },
          select: { _id: true },
          skip: 0,
          limit: LIMIT_PER_PROJECT,
          props: props,
        });
      },
    });

    const readableIncidentOwnerRules: Set<string> = await this.readableIds({
      ids: incidentOwnerRuleIds,
      read: async (
        query: Array<ObjectID>,
      ): Promise<Array<{ id?: ObjectID | null }>> => {
        return await IncidentOwnerRuleService.findBy({
          query: { _id: QueryHelper.any(query), projectId: projectId },
          select: { _id: true },
          skip: 0,
          limit: LIMIT_PER_PROJECT,
          props: props,
        });
      },
    });

    const readableAlertOwnerRules: Set<string> = await this.readableIds({
      ids: alertOwnerRuleIds,
      read: async (
        query: Array<ObjectID>,
      ): Promise<Array<{ id?: ObjectID | null }>> => {
        return await AlertOwnerRuleService.findBy({
          query: { _id: QueryHelper.any(query), projectId: projectId },
          select: { _id: true },
          skip: 0,
          limit: LIMIT_PER_PROJECT,
          props: props,
        });
      },
    });

    const readableIncidentPrivacyRules: Set<string> = await this.readableIds({
      ids: incidentPrivacyRuleIds,
      read: async (
        query: Array<ObjectID>,
      ): Promise<Array<{ id?: ObjectID | null }>> => {
        return await IncidentPrivacyRuleService.findBy({
          query: { _id: QueryHelper.any(query), projectId: projectId },
          select: { _id: true },
          skip: 0,
          limit: LIMIT_PER_PROJECT,
          props: props,
        });
      },
    });

    const readableAlertPrivacyRules: Set<string> = await this.readableIds({
      ids: alertPrivacyRuleIds,
      read: async (
        query: Array<ObjectID>,
      ): Promise<Array<{ id?: ObjectID | null }>> => {
        return await AlertPrivacyRuleService.findBy({
          query: { _id: QueryHelper.any(query), projectId: projectId },
          select: { _id: true },
          skip: 0,
          limit: LIMIT_PER_PROJECT,
          props: props,
        });
      },
    });

    const readableIncidentLabelRules: Set<string> = await this.readableIds({
      ids: incidentLabelRuleIds,
      read: async (
        query: Array<ObjectID>,
      ): Promise<Array<{ id?: ObjectID | null }>> => {
        return await IncidentLabelRuleService.findBy({
          query: { _id: QueryHelper.any(query), projectId: projectId },
          select: { _id: true },
          skip: 0,
          limit: LIMIT_PER_PROJECT,
          props: props,
        });
      },
    });

    const readableAlertLabelRules: Set<string> = await this.readableIds({
      ids: alertLabelRuleIds,
      read: async (
        query: Array<ObjectID>,
      ): Promise<Array<{ id?: ObjectID | null }>> => {
        return await AlertLabelRuleService.findBy({
          query: { _id: QueryHelper.any(query), projectId: projectId },
          select: { _id: true },
          skip: 0,
          limit: LIMIT_PER_PROJECT,
          props: props,
        });
      },
    });

    const readableAlertIncidentRules: Set<string> = await this.readableIds({
      ids: alertIncidentRuleIds,
      read: async (
        query: Array<ObjectID>,
      ): Promise<Array<{ id?: ObjectID | null }>> => {
        return await AlertIncidentRuleService.findBy({
          query: { _id: QueryHelper.any(query), projectId: projectId },
          select: { _id: true },
          skip: 0,
          limit: LIMIT_PER_PROJECT,
          props: props,
        });
      },
    });

    // Status pages are label-scoped: a page the caller may not read is not named.
    const readableStatusPages: Set<string> = await this.readableIds({
      ids: statusPageIds,
      read: async (
        query: Array<ObjectID>,
      ): Promise<Array<{ id?: ObjectID | null }>> => {
        return await StatusPageService.findBy({
          query: { _id: QueryHelper.any(query), projectId: projectId },
          select: { _id: true },
          skip: 0,
          limit: LIMIT_PER_PROJECT,
          props: props,
        });
      },
    });

    // So are monitor groups (#7214).
    const readableMonitorGroups: Set<string> = await this.readableIds({
      ids: monitorGroupIds,
      read: async (
        query: Array<ObjectID>,
      ): Promise<Array<{ id?: ObjectID | null }>> => {
        return await MonitorGroupService.findBy({
          query: { _id: QueryHelper.any(query), projectId: projectId },
          select: { _id: true },
          skip: 0,
          limit: LIMIT_PER_PROJECT,
          props: props,
        });
      },
    });

    const canReadPrivateEvent: (event: WhoIsToldEvent) => boolean =
      await this.readPrivateEventReader({
        props: props,
        results: [result],
      });

    return redactWhoIsTold({
      result: result,
      readablePolicyIds: readablePolicyIds,
      readableRuleIds: new Set<string>([
        ...readableIncidentRules,
        ...readableAlertRules,
      ]),
      readableOwnerRuleIds: new Set<string>([
        ...readableIncidentOwnerRules,
        ...readableAlertOwnerRules,
      ]),
      readableStatusPageIds: readableStatusPages,
      readableMonitorGroupIds: readableMonitorGroups,
      readablePrivacyRuleIds: new Set<string>([
        ...readableIncidentPrivacyRules,
        ...readableAlertPrivacyRules,
      ]),
      readableLabelRuleIds: new Set<string>([
        ...readableIncidentLabelRules,
        ...readableAlertLabelRules,
      ]),
      readableAlertIncidentRuleIds: readableAlertIncidentRules,
      canReadPrivateEvent: canReadPrivateEvent,
    });
  }

  /*
   * WHICH PRIVATE RECORDS OF THESE ANSWERS THE CALLER COULD READ once they
   * exist (#7213), by the private-record rule (canReadPrivateRecord) on the
   * owners the resolver worked out: the owner teams whose invitation they
   * have accepted are read once for all of them, and not at all when there
   * is no private record, or they see every one. A monitor's card
   * (getForCaller) and Setup health (readHiddenFromCaller, #9370) ask it the
   * same way.
   */
  private static async readPrivateEventReader(data: {
    props: DatabaseCommonInteractionProps;
    results: ReadonlyArray<WhoIsToldResult>;
  }): Promise<(event: WhoIsToldEvent) => boolean> {
    const privateOwnerTeamIds: Set<string> = new Set<string>();

    for (const result of data.results) {
      for (const event of getAllEvents(result)) {
        if (event.isPrivate) {
          for (const teamId of event.ownerIds?.teamIds || []) {
            privateOwnerTeamIds.add(teamId);
          }
        }
      }
    }

    const memberOfTeamIds: Set<string> = await this.readCallerAcceptedTeamIds({
      props: data.props,
      teamIds: privateOwnerTeamIds,
    });

    return (event: WhoIsToldEvent): boolean => {
      return canReadPrivateRecord({
        props: data.props,
        ownerIds: event.ownerIds,
        memberOfTeamIds: memberOfTeamIds,
      });
    };
  }

  /*
   * THE RECORDS THESE CHAINS WOULD OPEN THAT ARE HIDDEN FROM THE CALLER
   * (#7213): private, and not theirs to see once they exist - as each
   * monitor's card hides them from the same caller. Setup health lists no
   * finding such a record alone raises (#9370): the chains come from
   * resolveProject, which works out every private record's owners.
   */
  public static async readHiddenFromCaller(data: {
    props: DatabaseCommonInteractionProps;
    results: ReadonlyArray<WhoIsToldResult>;
  }): Promise<(event: WhoIsToldEvent) => boolean> {
    const canReadPrivateEvent: (event: WhoIsToldEvent) => boolean =
      await this.readPrivateEventReader(data);

    return (event: WhoIsToldEvent): boolean => {
      return isWhoIsToldEventHidden(event, canReadPrivateEvent);
    };
  }

  /*
   * The teams among these whose invitation the caller has accepted: those
   * through which a private record's owner team lets them read it, as
   * PrivateRecordReadFilter reads the same TeamMember rows.
   */
  private static async readCallerAcceptedTeamIds(data: {
    props: DatabaseCommonInteractionProps;
    teamIds: Set<string>;
  }): Promise<Set<string>> {
    if (
      data.teamIds.size === 0 ||
      !data.props.userId ||
      shouldBypassRecordPrivacy(data.props)
    ) {
      return new Set<string>();
    }

    const members: Array<TeamMember> = await TeamMemberService.findBy({
      query: {
        userId: data.props.userId,
        teamId: QueryHelper.any(
          Array.from(data.teamIds).map((id: string): ObjectID => {
            return new ObjectID(id);
          }),
        ),
        hasAcceptedInvitation: true,
      },
      select: { teamId: true },
      skip: 0,
      limit: LIMIT_MAX,
      props: { isRoot: true },
    });

    return new Set<string>(
      members
        .map((member: TeamMember): string => {
          return idText(member.teamId).toLowerCase();
        })
        .filter((id: string): boolean => {
          return Boolean(id);
        }),
    );
  }

  /*
   * Which of these ids the caller may read, asked as they would list them.
   * A caller who may read none of the kind is refused by the read: that is
   * none readable.
   */
  private static async readableIds(data: {
    ids: Set<string>;
    read: (ids: Array<ObjectID>) => Promise<Array<{ id?: ObjectID | null }>>;
  }): Promise<Set<string>> {
    if (data.ids.size === 0) {
      return new Set<string>();
    }

    try {
      const rows: Array<{ id?: ObjectID | null }> = await data.read(
        Array.from(data.ids).map((id: string): ObjectID => {
          return new ObjectID(id);
        }),
      );

      return new Set<string>(idsOf(rows));
    } catch (err) {
      logger.debug(
        `WhoIsTold: caller may not read some of the chain: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return new Set<string>();
    }
  }

  /*
   * THE WHOLE ANSWER, as OneUptime reads it, kept a minute. `refresh`
   * works it out again now.
   */
  @CaptureSpan()
  public static async resolve(data: {
    projectId: ObjectID;
    monitorId: ObjectID;
    refresh?: boolean | undefined;
  }): Promise<WhoIsToldResult> {
    const cacheKey: string = `${data.projectId.toString()}:${data.monitorId.toString()}`;

    if (!data.refresh) {
      const cached: WhoIsToldResult | undefined = this.cache.get(cacheKey);

      if (cached) {
        return cached;
      }
    }

    const result: WhoIsToldResult = await this.compute(data);

    this.cache.set(cacheKey, result, WHO_IS_TOLD_CACHE_TTL_IN_MS);

    return result;
  }

  private static async compute(data: {
    projectId: ObjectID;
    monitorId: ObjectID;
  }): Promise<WhoIsToldResult> {
    const monitor: Monitor | null = await MonitorService.findOneBy({
      query: {
        _id: data.monitorId.toString(),
        projectId: data.projectId,
      },
      select: WHO_IS_TOLD_MONITOR_SELECT,
      props: {
        isRoot: true,
      },
    });

    if (!monitor) {
      throw new BadDataException("Monitor not found.");
    }

    const project: ProjectContext = await this.readProjectContext({
      projectId: data.projectId,
      matching: null,
      isForBreaksOnly: false,
    });

    return await this.resolveMonitor({ project: project, monitor: monitor });
  }

  /*
   * EVERY MONITOR'S ANSWER AT ONCE, for Setup health (#6812): resolve's
   * answer for each of these monitors of the project, as OneUptime reads
   * it, with its breaks worked out by the same rules (getWhoIsToldBreaks)
   * - so the card on a monitor and the project's list never disagree.
   *
   * What it reads does not grow with the number of monitors. The caller
   * reads the monitors (with at least WHO_IS_TOLD_MONITOR_SELECT); the
   * project, its channels, severities, statuses, policies and on-call rules
   * are read once; the rule engines match each incident or alert against
   * the rules read once and the monitors handed in (getMatchingRules'
   * `preloaded`); each policy's first level and each person's paging rules
   * are read once however many monitors reach them; and `readiness` (the
   * project's, from OnCallReadinessService.getReadinessForProject) gives
   * every responder's verified methods up front. The status pages, and the
   * names of the owners an email reaches, are not read: no finding depends
   * on them.
   *
   * EVERY RECORD'S OWNERS, as ids, as the card works them out: the people
   * and teams its criteria names, the owners of the network device the
   * monitor watches, and whom the owner rules add. An alert on-call rule
   * can match on them (Alert Owner, #9407), a private record is theirs to
   * read (#9370: a reader who may not is told none of the breaks it raises,
   * readHiddenFromCaller), and Setup health lists the owners no Created
   * email reaches (#9371). They are read for the project at once
   * (readOwnersOfProject): the owner rules once; every device's owners in
   * one read; every monitor's own owners in one, when an owner rule
   * inherits them; and whether each person and team named anywhere is
   * reached, in one. A project that names nobody reads none of it. Only an
   * owner rule that inherits from a monitor's hosts, clusters or services
   * reads what each monitor is about, as label rules that inherit from them
   * do.
   *
   * Not cached: its reader keeps its own answer (SetupHealthService).
   */
  @CaptureSpan()
  public static async resolveProject(data: {
    projectId: ObjectID;
    monitors: Array<Monitor>;
    readiness?: Array<UserReadiness> | undefined;
  }): Promise<Array<WhoIsToldResult>> {
    if (data.monitors.length === 0) {
      return [];
    }

    const monitorCache: MonitorRuleCriteriaCache =
      new MonitorRuleCriteriaCache();

    for (const monitor of data.monitors) {
      monitorCache.seed(monitor);
    }

    const [incidentRules, alertRules]: [
      Array<IncidentOnCallRule>,
      Array<AlertOnCallRule>,
    ] = await Promise.all([
      IncidentOnCallRuleEngineService.readEnabledRules(data.projectId),
      AlertOnCallRuleEngineService.readEnabledRules(data.projectId),
    ]);

    const project: ProjectContext = await this.readProjectContext({
      projectId: data.projectId,
      matching: {
        incidentRules: incidentRules,
        alertRules: alertRules,
        monitorCache: monitorCache,
      },
      isForBreaksOnly: true,
    });

    for (const person of data.readiness || []) {
      project.verifiedChannels.set(
        person.userId.toString(),
        this.verifiedChannelsOf(person),
      );
    }

    await this.readOwnersOfProject({
      project: project,
      monitors: data.monitors,
    });

    const results: Array<WhoIsToldResult> = [];

    for (const monitor of data.monitors) {
      results.push(
        await this.resolveMonitor({ project: project, monitor: monitor }),
      );
    }

    return results;
  }

  // What every monitor of a project shares, read once.
  private static async readProjectContext(data: {
    projectId: ObjectID;
    matching: PreloadedMatching | null;
    isForBreaksOnly: boolean;
  }): Promise<ProjectContext> {
    const project: Project | null = await ProjectService.findOneById({
      id: data.projectId,
      select: {
        enableSmsNotifications: true,
        enableCallNotifications: true,
        enableWhatsAppNotifications: true,
        enableTelegramNotifications: true,
        disableOnCallNotificationFallback: true,
        smsOrCallCurrentBalanceInUSDCents: true,
        enableAutoRechargeSmsOrCallBalance: true,
      },
      props: {
        isRoot: true,
      },
    });

    const channels: WhoIsToldChannels = await this.readChannels({
      projectId: data.projectId,
      project: project,
    });

    const policies: {
      names: Map<string, string>;
      hasPolicyInService: boolean;
    } = await this.readPolicies(data.projectId);

    return {
      projectId: data.projectId,
      project: project,
      channels: channels,
      incidentSeverities: await this.readIncidentSeverities(data.projectId),
      alertSeverities: await this.readAlertSeverities(data.projectId),
      statuses: await this.readStatuses(data.projectId),
      policyNames: policies.names,
      projectHasOnCallPolicies: policies.hasPolicyInService,
      // Every record's owners are worked out, for breaks only too (#9407).
      incidentOwnerRules: await IncidentOwnerRuleEngineService.getEnabledRules(
        data.projectId,
      ),
      alertOwnerRules: await AlertOwnerRuleEngineService.getEnabledRules(
        data.projectId,
      ),
      deviceOwnersByDevice: null,
      inheritedOwners: data.matching ? new InheritedOwnersCache() : null,
      incidentPrivacyRules:
        await IncidentPrivacyRuleEngineService.getEnabledRules(data.projectId),
      alertPrivacyRules: await AlertPrivacyRuleEngineService.getEnabledRules(
        data.projectId,
      ),
      // Labels change which on-call rules page, so breaks need them too.
      incidentLabelRules: await IncidentLabelRuleEngineService.getEnabledRules(
        data.projectId,
      ),
      alertLabelRules: await AlertLabelRuleEngineService.getEnabledRules(
        data.projectId,
      ),
      // An alert that becomes an incident that pages is no break.
      alertIncidentRules: await AlertIncidentRuleEngineService.getEnabledRules(
        data.projectId,
      ),
      projectHasIncidentOnCallRules: await this.hasEnabled(
        IncidentOnCallRuleService,
        data.projectId,
      ),
      projectHasAlertOnCallRules: await this.hasEnabled(
        AlertOnCallRuleService,
        data.projectId,
      ),
      userNames: new Map<string, string>(),
      teamNames: new Map<string, string>(),
      projectTeams: new Map<string, boolean>(),
      projectMembers: new Map<string, boolean>(),
      teamsWithMembers: new Map<string, boolean>(),
      teamMemberIds: new Map<string, Array<string>>(),
      projectOwnerNames: null,
      projectOwners: null,
      channelsOff: getChannelsSwitchedOff(channels),
      isFallbackEnabled: !project?.disableOnCallNotificationFallback,
      firstLevels: new Map<string, FirstLevel>(),
      people: new Map<string, WhoIsToldPerson>(),
      previews: new Map<string, OnCallTestPagePreviewPerson>(),
      verifiedChannels: new Map<string, Array<OnCallPageChannel>>(),
      fallbackChannels: new Map<string, Array<OnCallPageChannel>>(),
      matching: data.matching,
      isForBreaksOnly: data.isForBreaksOnly,
    };
  }

  /*
   * WHO EVERY MONITOR'S RECORDS ARE OWNED BY, READ FOR THE PROJECT AT ONCE
   * (resolveProject, #9407, #9371), so that working out each record's
   * owners reads nothing per monitor:
   *
   *   - the owners of every network device a monitor's step watches, in
   *     one read (getDeviceOwnersForDevices);
   *   - every monitor's own owners, in one read, when an owner rule
   *     inherits a monitor's owners (InheritedOwnersCache);
   *   - whether each person named anywhere - a criteria, a device, an owner
   *     rule, a monitor's owners - is a member of the project, and each
   *     team the project's and reached, in one read each (readOwnersReached,
   *     readTeamNames).
   *
   * A project whose monitors watch no device, whose owner rules inherit
   * from no monitor and that names nobody reads none of it.
   */
  private static async readOwnersOfProject(data: {
    project: ProjectContext;
    monitors: Array<Monitor>;
  }): Promise<void> {
    const project: ProjectContext = data.project;
    const deviceIds: Array<ObjectID> = [];
    const seenDevices: Set<string> = new Set<string>();
    const userIds: Array<ObjectID | string> = [];
    const teamIds: Array<ObjectID | string> = [];

    for (const monitor of data.monitors) {
      for (const item of getMonitorCriteria(monitor.monitorSteps)) {
        const deviceId: ObjectID | null =
          NetworkDeviceOwnerUserService.getDeviceIdForMonitor({
            monitor: monitor,
            monitorStepId: item.monitorStepId || undefined,
          });
        const key: string = idText(deviceId).toLowerCase();

        if (deviceId && key && !seenDevices.has(key)) {
          seenDevices.add(key);
          deviceIds.push(deviceId);
        }

        const criteria: MonitorCriteriaInstance["data"] = item.instance.data;

        for (const template of [
          ...(criteria?.createIncidents ? criteria.incidents || [] : []),
          ...(criteria?.createAlerts ? criteria.alerts || [] : []),
        ]) {
          userIds.push(...(template.ownerUserIds || []));
          teamIds.push(...(template.ownerTeamIds || []));
        }
      }
    }

    project.deviceOwnersByDevice =
      deviceIds.length > 0
        ? await NetworkDeviceOwnerUserService.getDeviceOwnersForDevices({
            projectId: project.projectId,
            networkDeviceIds: deviceIds,
          })
        : new Map<string, NetworkDeviceOwners>();

    for (const owners of project.deviceOwnersByDevice.values()) {
      userIds.push(...owners.ownerUserIds);
      teamIds.push(...owners.ownerTeamIds);
    }

    const ownerRules: Array<IncidentOwnerRule | AlertOwnerRule> = [
      ...project.incidentOwnerRules,
      ...project.alertOwnerRules,
    ];

    for (const rule of ownerRules) {
      userIds.push(...OwnerRulePlanBuilder.idsOf(rule.ownerUsers));
      teamIds.push(...OwnerRulePlanBuilder.idsOf(rule.ownerTeams));
    }

    const inheritsFromMonitors: boolean = ownerRules.some(
      (rule: IncidentOwnerRule | AlertOwnerRule): boolean => {
        return OwnerRulePlanBuilder.getInheritSources(rule).includes(
          "monitors",
        );
      },
    );

    if (project.inheritedOwners && inheritsFromMonitors) {
      await project.inheritedOwners.preload({
        source: "monitors",
        resourceIds: data.monitors
          .map((monitor: Monitor): ObjectID | null => {
            return monitor.id || null;
          })
          .filter((id: ObjectID | null): id is ObjectID => {
            return Boolean(id);
          }),
      });

      const inherited: OwnerIdSets = project.inheritedOwners.getAllHeld();

      userIds.push(...Array.from(inherited.userIds));
      teamIds.push(...Array.from(inherited.teamIds));
    }

    const people: Array<string> = uniqueIds(userIds);
    const teams: Array<string> = uniqueIds(teamIds);

    await this.readOwnersReached({
      context: project,
      userIds: people,
      teamIds: teams,
    });
    await this.readTeamNames({ context: project, teamIds: teams });
  }

  // Whether the project has an enabled rule of this kind.
  private static async hasEnabled(
    service: {
      countBy: (args: {
        query: { projectId: ObjectID; isEnabled: boolean };
        props: DatabaseCommonInteractionProps;
      }) => Promise<{ toNumber: () => number }>;
    },
    projectId: ObjectID,
  ): Promise<boolean> {
    return (
      (
        await service.countBy({
          query: { projectId: projectId, isEnabled: true },
          props: { isRoot: true },
        })
      ).toNumber() > 0
    );
  }

  // One monitor's answer, from what its project shares.
  private static async resolveMonitor(data: {
    project: ProjectContext;
    monitor: Monitor;
    // A monitor not created yet, and who creates it (getForDraft).
    newMonitor?: { creatorUserId: string | null } | undefined;
  }): Promise<WhoIsToldResult> {
    const monitorId: string = idText(data.monitor.id);

    let monitorCache: MonitorRuleCriteriaCache | undefined =
      data.project.matching?.monitorCache;

    if (!monitorCache) {
      // The monitor in hand, with the name, description and labels matching reads.
      monitorCache = new MonitorRuleCriteriaCache();
      monitorCache.seed(data.monitor);
    }

    const context: ResolveContext = {
      ...data.project,
      monitor: data.monitor,
      monitorCache: monitorCache,
      newMonitorCreatorId: data.newMonitor?.creatorUserId || null,
      storageMap: MonitorTemplateUtil.buildStorageMapBeforeCheck({
        monitor: data.monitor,
      }),
      resources: null,
      deviceOwners: new Map<string, NetworkDeviceOwners>(),
      monitorOwnerNames: null,
      // A monitor not created yet is on no status page.
      statusPages:
        data.project.isForBreaksOnly || !monitorId || data.newMonitor
          ? []
          : await this.readStatusPages({
              projectId: data.project.projectId,
              monitorId: new ObjectID(monitorId),
            }),
    };

    const criteria: Array<WhoIsToldCriteria> = [];

    for (const criteriaOfStep of getMonitorCriteria(
      data.monitor.monitorSteps,
    )) {
      const item: WhoIsToldCriteria | null = await this.resolveCriteria({
        context: context,
        instance: criteriaOfStep.instance,
        monitorStepId: criteriaOfStep.monitorStepId,
      });

      if (item) {
        criteria.push(item);
      }
    }

    const facts: WhoIsToldProjectFacts = {
      projectHasIncidentOnCallRules: context.projectHasIncidentOnCallRules,
      projectHasAlertOnCallRules: context.projectHasAlertOnCallRules,
      projectHasOnCallPolicies: context.projectHasOnCallPolicies,
    };

    return {
      monitorId: monitorId,
      monitorName: data.monitor.name?.toString() || "",
      checkedAt: OneUptimeDate.getCurrentDate().toISOString(),
      criteria: criteria,
      channels: context.channels,
      breaks: getWhoIsToldBreaks({
        criteria: criteria,
        channels: context.channels,
        ...facts,
      }),
      // A reader's breaks are worked out again from these (redactWhoIsTold).
      facts: facts,
    };
  }

  /*
   * One criteria: the status it sets and what it opens. A criteria that is
   * switched off, or does neither, is left out: it tells nobody.
   */
  private static async resolveCriteria(data: {
    context: ResolveContext;
    instance: MonitorCriteriaInstance;
    monitorStepId: string;
  }): Promise<WhoIsToldCriteria | null> {
    const criteria: MonitorCriteriaInstance["data"] = data.instance.data;

    if (!criteria || criteria.isEnabled === false) {
      return null;
    }

    const status: MonitorStatus | undefined =
      criteria.changeMonitorStatus && idText(criteria.monitorStatusId)
        ? data.context.statuses.get(idText(criteria.monitorStatusId))
        : undefined;

    const events: Array<WhoIsToldEvent> = [];

    if (criteria.createIncidents) {
      for (const template of criteria.incidents || []) {
        const event: WhoIsToldEvent | null = await this.resolveIncident({
          context: data.context,
          template: template,
          monitorStepId: data.monitorStepId,
        });

        if (event) {
          events.push(event);
        }
      }
    }

    if (criteria.createAlerts) {
      for (const template of criteria.alerts || []) {
        const event: WhoIsToldEvent | null = await this.resolveAlert({
          context: data.context,
          template: template,
          monitorStepId: data.monitorStepId,
        });

        if (event) {
          events.push(event);
        }
      }
    }

    if (!status && events.length === 0) {
      return null;
    }

    const item: WhoIsToldCriteria = {
      id: criteria.id || "",
      name: criteria.name || "",
      events: events,
    };

    if (status) {
      item.statusName = status.name?.toString() || "";

      if (status.color) {
        item.statusColor = status.color.toString();
      }

      if (!data.context.isForBreaksOnly) {
        item.statusOwners = await this.getMonitorOwners(data.context);
      }
    }

    return item;
  }

  /*
   * The incident a criteria would open, held in memory, as MonitorIncident
   * makes it before a check reports anything: its rendered title and
   * description, severity, labels and monitor - private when the criteria
   * says so - and the resources it is about, when a rule inherits from
   * them. It is then told as every new incident is (resolveIncidentRecord).
   */
  private static async resolveIncident(data: {
    context: ResolveContext;
    template: CriteriaIncident;
    monitorStepId: string;
  }): Promise<WhoIsToldEvent | null> {
    const severity: IncidentSeverity | null = pickSeverity(
      data.context.incidentSeverities,
      data.template.incidentSeverityId,
    );

    // A project with no incident severity opens no incident (MonitorIncident).
    if (!severity?.id) {
      return null;
    }

    const text: MonitorRecordTextResult = this.renderText({
      context: data.context,
      template: data.template,
    });

    const incident: Incident = new Incident();
    incident.projectId = data.context.projectId;
    incident.incidentSeverityId = severity.id;
    incident.title = text.title;
    incident.description = text.description;
    incident.monitors = [data.context.monitor];
    incident.labels = this.toLabels(data.template.labelIds);

    if (data.template.isPrivate === true) {
      incident.isPrivate = true;
    }

    await this.attachResources({
      context: data.context,
      record: incident,
      needsResources:
        inheritsFromResources(data.context.incidentOwnerRules) ||
        doLabelRulesInheritFromResources(data.context.incidentLabelRules),
    });

    return await this.resolveIncidentRecord({
      context: data.context,
      incident: incident,
      templateId: data.template.id,
      severityName: severity.name?.toString() || "",
      onCallPolicyIds: data.template.onCallPolicyIds || [],
      namedOwners: {
        userIds: data.template.ownerUserIds || [],
        teamIds: data.template.ownerTeamIds || [],
        addedBy: WhoIsToldOwnerAddedBy.Criteria,
      },
      withDeviceOwners: true,
      monitorStepId: data.monitorStepId,
      showsOnStatusPages: data.template.showIncidentOnStatusPage !== false,
    });
  }

  /*
   * A NEW INCIDENT, TOLD AS ITS CREATE TELLS IT (IncidentService
   * .onCreateSuccess), by each engine's own read-only plan of it, in the
   * create's order:
   *
   *   1. privacy rules (unless it is private already): a private incident
   *      shows on no status page (#7213);
   *   2. owner rules;
   *   3. label rules: their labels are the incident's when its on-call
   *      rules match (#7212);
   *   4. on-call rules.
   *
   * Used for what a criteria opens and for what an alert incident rule
   * declares from an alert (#7216), whose owners are handed in.
   */
  private static async resolveIncidentRecord(data: {
    context: ResolveContext;
    incident: Incident;
    // The criteria's template it is opened from; none for a declared one.
    templateId: string | undefined;
    severityName: string;
    onCallPolicyIds: Array<ObjectID>;
    namedOwners: NamedOwners;
    // The owners of the network device the monitor watches are its owners too.
    withDeviceOwners: boolean;
    monitorStepId: string;
    showsOnStatusPages: boolean;
  }): Promise<WhoIsToldEvent> {
    const { context, incident } = data;

    const privacyRules: Array<WhoIsToldRule> = await this.planIncidentPrivacy({
      context: context,
      incident: incident,
    });

    let ownerPlan: OwnerRulePlan<IncidentOwnerRule> | null = null;

    if (context.incidentOwnerRules.length > 0) {
      ownerPlan = await IncidentOwnerRuleEngineService.planRules({
        incident: incident,
        rules: context.incidentOwnerRules,
        allowOwnerNotification: true,
        monitorCache: context.monitorCache,
        pendingOwners: this.getPendingOwners(context),
        inheritedOwners: context.inheritedOwners || undefined,
      });
    }

    const labelPlan: LabelRulePlan<IncidentLabelRule> =
      await this.planIncidentLabels({ context: context, incident: incident });

    const paging: {
      rules: Array<IncidentOnCallRule>;
      labelRules: Array<WhoIsToldRule>;
    } = await this.matchWithLabels<IncidentOnCallRule, IncidentLabelRule>({
      context: context,
      record: incident,
      labelPlan: labelPlan,
      match: async (): Promise<Array<IncidentOnCallRule>> => {
        return await IncidentOnCallRuleEngineService.getMatchingRules(
          incident,
          {
            rules: context.matching?.incidentRules,
            monitorCache: context.monitorCache,
          },
        );
      },
    });

    const isPrivate: boolean = incident.isPrivate === true;

    const event: WhoIsToldEvent = await this.makeEvent({
      context: context,
      kind: OnCallTestPageRecordKind.Incident,
      templateId: data.templateId,
      title: incident.title || "",
      severityId: incident.incidentSeverityId!,
      severityName: data.severityName,
      onCallPolicyIds: data.onCallPolicyIds,
      owners: await this.getEventOwners({
        context: context,
        namedOwners: data.namedOwners,
        withDeviceOwners: data.withDeviceOwners,
        monitorStepId: data.monitorStepId,
        ownerRuleAdditions: getOwnerRuleAdditions(ownerPlan),
      }),
      rules: paging.rules,
      // A private incident, or one kept off status pages, shows on none.
      statusPages:
        !data.showsOnStatusPages || isPrivate ? [] : context.statusPages,
    });

    return this.withRecordFacts({
      event: event,
      isPrivate: isPrivate,
      privacyRules: privacyRules,
      isPrivateOffStatusPages:
        isPrivate && data.showsOnStatusPages && context.statusPages.length > 0,
      labelRules: paging.labelRules,
    });
  }

  // The alert a criteria would open, held in memory, as MonitorAlert makes it.
  private static async resolveAlert(data: {
    context: ResolveContext;
    template: CriteriaAlert;
    monitorStepId: string;
  }): Promise<WhoIsToldEvent | null> {
    const { context } = data;

    const severity: AlertSeverity | null = pickSeverity(
      context.alertSeverities,
      data.template.alertSeverityId,
    );

    if (!severity?.id) {
      return null;
    }

    const text: MonitorRecordTextResult = this.renderText({
      context: context,
      template: data.template,
    });

    const alert: Alert = new Alert();
    alert.projectId = context.projectId;
    alert.alertSeverityId = severity.id;
    alert.title = text.title;
    alert.description = text.description;
    alert.monitorId = context.monitor.id!;
    alert.labels = this.toLabels(data.template.labelIds);

    if (data.template.isPrivate === true) {
      alert.isPrivate = true;
    }

    /*
     * What the alert is about, when a rule inherits from it - an incident
     * an alert incident rule declares takes the alert's resources, and its
     * own rules may inherit from them.
     */
    await this.attachResources({
      context: context,
      record: alert,
      needsResources:
        inheritsFromResources(context.alertOwnerRules) ||
        doLabelRulesInheritFromResources(context.alertLabelRules) ||
        (context.alertIncidentRules.length > 0 &&
          (inheritsFromResources(context.incidentOwnerRules) ||
            doLabelRulesInheritFromResources(context.incidentLabelRules))),
    });

    // The alert's create, in its order (AlertService.onCreateSuccess).
    const privacyRules: Array<WhoIsToldRule> = await this.planAlertPrivacy({
      context: context,
      alert: alert,
    });

    let ownerPlan: OwnerRulePlan<AlertOwnerRule> | null = null;

    if (context.alertOwnerRules.length > 0) {
      ownerPlan = await AlertOwnerRuleEngineService.planRules({
        alert: alert,
        rules: context.alertOwnerRules,
        allowOwnerNotification: true,
        monitorCache: context.monitorCache,
        pendingOwners: this.getPendingOwners(context),
        inheritedOwners: context.inheritedOwners || undefined,
      });
    }

    /*
     * ITS OWNERS, BEFORE ITS ON-CALL RULES MATCH (#9407). An alert on-call
     * rule can match on who owns the alert (Alert Owner), and the real
     * alert's owners are in by then: the people and teams its criteria
     * names and the network device's owners (MonitorAlert adds them as it
     * is created), and whom its owner rules add, which run before its
     * on-call rules (AlertService.onCreateSuccess) - an owner added later
     * runs those rules again (AlertOnCallRulesOnOwnerChange). They are
     * handed to the engine's matching as its owner rows will hold them.
     */
    const owners: EventOwners = await this.getEventOwners({
      context: context,
      namedOwners: {
        userIds: data.template.ownerUserIds || [],
        teamIds: data.template.ownerTeamIds || [],
        addedBy: WhoIsToldOwnerAddedBy.Criteria,
      },
      withDeviceOwners: true,
      monitorStepId: data.monitorStepId,
      ownerRuleAdditions: getOwnerRuleAdditions(ownerPlan),
    });

    const labelPlan: LabelRulePlan<AlertLabelRule> = await this.planAlertLabels(
      { context: context, alert: alert },
    );

    const paging: {
      rules: Array<AlertOnCallRule>;
      labelRules: Array<WhoIsToldRule>;
    } = await this.matchWithLabels<AlertOnCallRule, AlertLabelRule>({
      context: context,
      record: alert,
      labelPlan: labelPlan,
      match: async (): Promise<Array<AlertOnCallRule>> => {
        return await AlertOnCallRuleEngineService.getMatchingRules(
          alert,
          {
            rules: context.matching?.alertRules,
            monitorCache: context.monitorCache,
          },
          { ownerIds: ownerIdsOf(owners) },
        );
      },
    });

    const isPrivate: boolean = alert.isPrivate === true;

    const event: WhoIsToldEvent = this.withRecordFacts({
      event: await this.makeEvent({
        context: context,
        kind: OnCallTestPageRecordKind.Alert,
        templateId: data.template.id,
        title: text.title,
        severityId: severity.id,
        severityName: severity.name?.toString() || "",
        onCallPolicyIds: data.template.onCallPolicyIds || [],
        owners: owners,
        rules: paging.rules,
        statusPages: [],
      }),
      isPrivate: isPrivate,
      privacyRules: privacyRules,
      isPrivateOffStatusPages: false,
      labelRules: paging.labelRules,
    });

    // The owners that make an on-call rule match, as the card says them.
    const ownerMatches: Array<WhoIsToldOwnerMatch> = this.getOwnerMatches({
      context: context,
      rules: paging.rules,
      owners: owners,
    });

    if (ownerMatches.length > 0) {
      event.ownerMatches = ownerMatches;
    }

    // Last, as the create's last rules: the incident an alert incident rule declares.
    const declares: WhoIsToldEvent["declares"] = await this.resolveDeclaration({
      context: context,
      alert: alert,
      alertEvent: event,
      monitorStepId: data.monitorStepId,
    });

    if (declares) {
      event.declares = declares;
    }

    return event;
  }

  /*
   * THE INCIDENT AN ALERT INCIDENT RULE DECLARES FROM THE ALERT (#7216), by
   * the engine's own plan (planDeclaration, planIncident) of the alert as
   * its create leaves it - its labels and privacy as its rules set them -
   * then told as any new incident is: its own privacy, owner, label and
   * on-call rules, its status pages. It names no on-call policy of the
   * alert's (declaring must not page anyone its own rules do not), and a
   * private one has the alert's owners as its own, as declaring copies
   * them (IncidentAlertService.copyAlertOwnersToIncident). Undefined when no
   * rule matches, or the project has no incident severity to give it.
   */
  private static async resolveDeclaration(data: {
    context: ResolveContext;
    alert: Alert;
    alertEvent: WhoIsToldEvent;
    monitorStepId: string;
  }): Promise<WhoIsToldEvent["declares"]> {
    const { context } = data;

    if (context.alertIncidentRules.length === 0) {
      return undefined;
    }

    const plan: AlertIncidentRulePlan | null =
      await AlertIncidentRuleEngineService.planDeclaration({
        alert: data.alert,
        rules: context.alertIncidentRules,
        monitorCache: context.monitorCache,
      });

    if (!plan) {
      return undefined;
    }

    const incident: Incident | null =
      await AlertIncidentRuleEngineService.planIncident({
        alert: data.alert,
        rule: plan.rule,
      });

    if (!incident?.incidentSeverityId) {
      return undefined;
    }

    const severityId: string = idText(incident.incidentSeverityId);
    const severity: IncidentSeverity | undefined =
      context.incidentSeverities.find((item: IncidentSeverity): boolean => {
        return idText(item.id) === severityId;
      });

    const copied: WhoIsToldOwnerIds | undefined =
      incident.isPrivate === true ? data.alertEvent.ownerIds : undefined;

    return {
      rule: {
        id: idText(plan.rule.id),
        name: plan.rule.name?.toString() || "",
      },
      waitInMinutes: plan.waitInMinutes,
      incident: await this.resolveIncidentRecord({
        context: context,
        incident: incident,
        templateId: undefined,
        severityName: severity?.name?.toString() || "",
        onCallPolicyIds: [],
        namedOwners: {
          userIds: copied?.userIds || [],
          teamIds: copied?.teamIds || [],
          // The alert's owners, said there already: not again.
          addedBy: null,
        },
        withDeviceOwners: false,
        monitorStepId: data.monitorStepId,
        showsOnStatusPages: incident.isVisibleOnStatusPage !== false,
      }),
    };
  }

  /*
   * Whether the project's incident privacy rules make the incident private
   * (#7213), and which: the engine's own plan, asked only when it is not
   * private already - its create asks no rule then either. Empty when none
   * does, or the criteria made it private.
   */
  private static async planIncidentPrivacy(data: {
    context: ResolveContext;
    incident: Incident;
  }): Promise<Array<WhoIsToldRule>> {
    if (
      data.incident.isPrivate === true ||
      data.context.incidentPrivacyRules.length === 0
    ) {
      return [];
    }

    const plan: PrivacyRulePlan<IncidentPrivacyRule> =
      await IncidentPrivacyRuleEngineService.planRules({
        incident: data.incident,
        rules: data.context.incidentPrivacyRules,
        monitorCache: data.context.monitorCache,
      });

    if (!plan.makesPrivate) {
      return [];
    }

    data.incident.isPrivate = true;

    return getPrivacyRulesThatApply(plan).map(toWhoIsToldRule);
  }

  // The same of an alert, by the alert privacy rules.
  private static async planAlertPrivacy(data: {
    context: ResolveContext;
    alert: Alert;
  }): Promise<Array<WhoIsToldRule>> {
    if (
      data.alert.isPrivate === true ||
      data.context.alertPrivacyRules.length === 0
    ) {
      return [];
    }

    const plan: PrivacyRulePlan<AlertPrivacyRule> =
      await AlertPrivacyRuleEngineService.planRules({
        alert: data.alert,
        rules: data.context.alertPrivacyRules,
        monitorCache: data.context.monitorCache,
      });

    if (!plan.makesPrivate) {
      return [];
    }

    data.alert.isPrivate = true;

    return getPrivacyRulesThatApply(plan).map(toWhoIsToldRule);
  }

  /*
   * What the project's incident label rules add (#7212), by the engine's
   * own plan. A plan that cannot be read - which labels are the project's
   * - adds nothing, as the create logs it and labels nothing.
   */
  private static async planIncidentLabels(data: {
    context: ResolveContext;
    incident: Incident;
  }): Promise<LabelRulePlan<IncidentLabelRule>> {
    if (data.context.incidentLabelRules.length === 0) {
      return getNoLabelRulePlan<IncidentLabelRule>();
    }

    try {
      return await IncidentLabelRuleEngineService.planRules({
        incident: data.incident,
        rules: data.context.incidentLabelRules,
        monitorCache: data.context.monitorCache,
      });
    } catch (err) {
      logger.debug(
        `WhoIsTold: the incident label rules could not be planned: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return getNoLabelRulePlan<IncidentLabelRule>();
    }
  }

  // The same of an alert, by the alert label rules, on the resources it holds.
  private static async planAlertLabels(data: {
    context: ResolveContext;
    alert: Alert;
  }): Promise<LabelRulePlan<AlertLabelRule>> {
    if (data.context.alertLabelRules.length === 0) {
      return getNoLabelRulePlan<AlertLabelRule>();
    }

    const resources: LabelInheritableResources = {
      monitorIds: data.alert.monitorId ? [data.alert.monitorId] : [],
      hostIds: getLabelResourceIds(data.alert.hosts),
      kubernetesClusterIds: getLabelResourceIds(data.alert.kubernetesClusters),
      dockerHostIds: getLabelResourceIds(data.alert.dockerHosts),
      podmanHostIds: getLabelResourceIds(data.alert.podmanHosts),
      serviceIds: getLabelResourceIds(data.alert.services),
    };

    try {
      return (
        (await AlertLabelRuleEngineService.planRules({
          alert: data.alert,
          rules: data.context.alertLabelRules,
          monitorCache: data.context.monitorCache,
          resources: resources,
        })) || getNoLabelRulePlan<AlertLabelRule>()
      );
    } catch (err) {
      logger.debug(
        `WhoIsTold: the alert label rules could not be planned: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return getNoLabelRulePlan<AlertLabelRule>();
    }
  }

  /*
   * THE ON-CALL RULES THAT MATCH, ONCE THE LABEL RULES HAVE RUN (#7212):
   * the record takes the labels the plan adds, as the label engine hands
   * them to the on-call engine in the create's chain, and is matched then.
   * The label rules that add a label it lacked are named only when they
   * change which on-call rules page it - matched once more without their
   * labels to know - and not for breaks only.
   */
  private static async matchWithLabels<
    TOnCallRule extends IncidentOnCallRule | AlertOnCallRule,
    TLabelRule extends IncidentLabelRule | AlertLabelRule,
  >(data: {
    context: ResolveContext;
    record: Incident | Alert;
    labelPlan: LabelRulePlan<TLabelRule>;
    match: () => Promise<Array<TOnCallRule>>;
  }): Promise<{ rules: Array<TOnCallRule>; labelRules: Array<WhoIsToldRule> }> {
    const had: Set<string> = new Set<string>(
      (data.record.labels || []).map((label: Label): string => {
        return idText(label.id || label._id);
      }),
    );

    const added: Array<string> = data.labelPlan.labelIds.filter(
      (id: string): boolean => {
        return !had.has(id);
      },
    );

    if (added.length === 0) {
      return { rules: await data.match(), labelRules: [] };
    }

    const before: Array<TOnCallRule> | null = data.context.isForBreaksOnly
      ? null
      : await data.match();

    data.record.labels = [
      ...(data.record.labels || []),
      ...this.toLabels(
        added.map((id: string): ObjectID => {
          return new ObjectID(id);
        }),
      ),
    ];

    const after: Array<TOnCallRule> = await data.match();

    if (!before || sameRuleIds(before, after)) {
      return { rules: after, labelRules: [] };
    }

    return {
      rules: after,
      labelRules: data.labelPlan.entries
        .filter((entry: LabelRulePlanEntry<TLabelRule>): boolean => {
          return entry.labelIds.some((id: string): boolean => {
            return !had.has(id);
          });
        })
        .map((entry: LabelRulePlanEntry<TLabelRule>): WhoIsToldRule => {
          return toWhoIsToldRule(entry.rule);
        }),
    };
  }

  /*
   * The owners the monitor will have once it is created (getForDraft): its
   * creator, whom an owner rule that inherits the monitor's owners adds as
   * it would once they own it. None for a saved monitor.
   */
  private static getPendingOwners(
    context: ResolveContext,
  ): Map<OwnerRuleInheritSource, OwnerIdSets> | undefined {
    if (!context.newMonitorCreatorId) {
      return undefined;
    }

    return new Map<OwnerRuleInheritSource, OwnerIdSets>([
      [
        "monitors",
        {
          userIds: new Set<string>([context.newMonitorCreatorId]),
          teamIds: new Set<string>(),
        },
      ],
    ]);
  }

  // An event, with what its record's own rules say of it.
  private static withRecordFacts(data: {
    event: WhoIsToldEvent;
    isPrivate: boolean;
    privacyRules: Array<WhoIsToldRule>;
    isPrivateOffStatusPages: boolean;
    labelRules: Array<WhoIsToldRule>;
  }): WhoIsToldEvent {
    const event: WhoIsToldEvent = data.event;

    if (data.isPrivate) {
      event.isPrivate = true;
      event.privacyRules = data.privacyRules;
    }

    if (data.isPrivateOffStatusPages) {
      event.isPrivateOffStatusPages = true;
    }

    if (data.labelRules.length > 0) {
      event.labelRules = data.labelRules;
    }

    return event;
  }

  /*
   * The title and description what opens gets, as MonitorIncident and
   * MonitorAlert render them (MonitorRecordText), with what is known of the
   * monitor before a check: a value only a check reports is left as written.
   */
  private static renderText(data: {
    context: ResolveContext;
    template: CriteriaIncident | CriteriaAlert;
  }): MonitorRecordTextResult {
    return MonitorRecordText.render({
      titleTemplate: data.template.title,
      descriptionTemplate: data.template.description,
      monitorType: data.context.monitor.monitorType!,
      storageMap: data.context.storageMap,
    });
  }

  /*
   * The resources an incident or alert from the monitor is about - what its
   * configuration names, and what it was linked to by hand - attached as
   * MonitorIncident and MonitorAlert attach them. Read once, and only when
   * a rule inherits owners or labels from such a resource: no rule reads
   * them otherwise.
   */
  private static async attachResources(data: {
    context: ResolveContext;
    record: Incident | Alert;
    needsResources: boolean;
  }): Promise<void> {
    if (!data.needsResources) {
      return;
    }

    if (!data.context.resources) {
      data.context.resources = Promise.all([
        MonitorResourceContextUtil.resolveResourceContextForMonitor({
          monitor: data.context.monitor,
        }),
        MonitorResourceContextUtil.resolveLinkedResourcesForMonitor({
          monitor: data.context.monitor,
        }),
      ]);
    }

    for (const resolved of await data.context.resources) {
      SeriesResourceLinker.attachResolvedResources({
        model: data.record,
        resolved: resolved,
      });
    }
  }

  private static toLabels(ids: Array<ObjectID> | undefined): Array<Label> {
    return (ids || [])
      .filter((id: ObjectID): boolean => {
        return Boolean(idText(id));
      })
      .map((id: ObjectID): Label => {
        const label: Label = new Label();
        label._id = idText(id);
        return label;
      });
  }

  // What one incident or alert tells, and who.
  private static async makeEvent(data: {
    context: ResolveContext;
    kind: OnCallTestPageRecordKind;
    /*
     * The criteria's incident or alert template it is opened from: what a
     * fire drill asks for it by (#7012). None for an incident an alert
     * incident rule declares, which is opened from no template of its own.
     */
    templateId: string | undefined;
    title: string;
    severityId: ObjectID;
    severityName: string;
    // The policies the record is given as it opens: its criteria's.
    onCallPolicyIds: Array<ObjectID>;
    /*
     * Who it emails as owners, and the ids of its owners - who may read it
     * once it is private (#9370) - as getEventOwners works them out.
     */
    owners: EventOwners;
    rules: Array<IncidentOnCallRule | AlertOnCallRule>;
    statusPages: Array<WhoIsToldStatusPage>;
  }): Promise<WhoIsToldEvent> {
    const ruleIdsByPolicy: Map<string, Array<string>> = new Map<
      string,
      Array<string>
    >();
    const order: Array<string> = [];

    const namedIds: Array<string> = data.onCallPolicyIds
      .map((id: ObjectID): string => {
        return idText(id);
      })
      .filter((id: string): boolean => {
        // A policy that is gone, or another project's, is never paged.
        return Boolean(id) && data.context.policyNames.has(id);
      });

    for (const id of namedIds) {
      if (!order.includes(id)) {
        order.push(id);
      }
    }

    const rules: Array<WhoIsToldRule> = [];

    for (const rule of data.rules) {
      const ruleId: string = idText(rule.id);

      rules.push({ id: ruleId, name: rule.name?.toString() || "" });

      for (const policy of rule.onCallDutyPolicies || []) {
        const policyId: string = idText(policy.id);

        // Only the project's own policies are ever paged (OnCallRulePolicyScope).
        if (!policyId || !data.context.policyNames.has(policyId)) {
          continue;
        }

        if (!order.includes(policyId)) {
          order.push(policyId);
        }

        ruleIdsByPolicy.set(policyId, [
          ...(ruleIdsByPolicy.get(policyId) || []),
          ruleId,
        ]);
      }
    }

    const policies: Array<WhoIsToldPolicy> = [];

    const now: Date = OneUptimeDate.getCurrentDate();

    for (const policyId of order) {
      const policy: WhoIsToldPolicy = await this.resolvePolicy({
        context: data.context,
        policyId: policyId,
        kind: data.kind,
        severityId: data.severityId,
        isNamedByCriteria: namedIds.includes(policyId),
        ruleIds: ruleIdsByPolicy.get(policyId) || [],
      });

      policies.push({
        ...policy,
        pagesAtOnce: this.isPolicyPagedAtOnce({
          isNamedByCriteria: policy.isNamedByCriteria,
          rules: data.rules.filter(
            (rule: IncidentOnCallRule | AlertOnCallRule): boolean => {
              return policy.ruleIds.includes(idText(rule.id));
            },
          ),
          now: now,
        }),
      });
    }

    const owners: EventOwners = data.owners;

    return {
      kind: data.kind,
      id: data.templateId || "",
      severityId: data.severityId.toString(),
      title: data.title,
      severityName: data.severityName,
      owners: owners.owners,
      ownerRules: owners.ownerRules,
      rules: rules,
      policies: policies,
      statusPages: data.statusPages,
      // Who may read it once it is private (redactWhoIsTold); never sent.
      ownerIds: owners.ownerIds,
    };
  }

  /*
   * WHETHER A POLICY'S RUN PAGES ITS FIRST LEVEL AS WHAT OPENS IS CREATED
   * (#8860), as the rule engines hold runs (OnCallRulePagingHold): a policy
   * the criteria names pages right away, as one a record had before its
   * rules ran always has; one the rules add pages right away when any rule
   * that adds it does now - right away wins. A rule held for working hours
   * outside them holds it, and so does one set to After OneUptime AI: whether
   * AI may respond first to a record is only known once it exists, and a
   * page it held has sent nothing by the time the owners are emailed.
   */
  private static isPolicyPagedAtOnce(data: {
    isNamedByCriteria: boolean;
    rules: Array<IncidentOnCallRule | AlertOnCallRule>;
    now: Date;
  }): boolean {
    if (data.isNamedByCriteria) {
      return true;
    }

    return data.rules.some(
      (rule: IncidentOnCallRule | AlertOnCallRule): boolean => {
        return OnCallRulePagingHoldUtil.isPagingNow(rule, data.now);
      },
    );
  }

  /*
   * THE OWNERS THAT MAKE AN ALERT'S ON-CALL RULES MATCH (#9407): each
   * matched rule whose Alert Owner condition picks one of the alert's
   * owners (AlertOnCallRuleEngineService.getOwnersMakingRuleMatch), with
   * those owners by name, as the card says a label rule's label made a rule
   * match (#7212). A name is the person's or the team's - every owner the
   * condition reads has a row, so a name read with the owners. Not for
   * breaks only, whose answer names nobody.
   */
  private static getOwnerMatches(data: {
    context: ResolveContext;
    rules: Array<AlertOnCallRule>;
    owners: EventOwners;
  }): Array<WhoIsToldOwnerMatch> {
    if (data.context.isForBreaksOnly) {
      return [];
    }

    const ownerIds: Array<string> = ownerIdsOf(data.owners);
    const matches: Array<WhoIsToldOwnerMatch> = [];

    for (const rule of data.rules) {
      const ownerNames: Array<string> = [];

      for (const id of AlertOnCallRuleEngineService.getOwnersMakingRuleMatch({
        rule: rule,
        ownerIds: ownerIds,
      })) {
        const key: string = id.toLowerCase();
        const name: string =
          (data.context.projectTeams.get(key) === true
            ? data.context.teamNames.get(key)
            : data.context.userNames.get(key)) || "";

        if (name && !ownerNames.includes(name)) {
          ownerNames.push(name);
        }
      }

      if (ownerNames.length > 0) {
        matches.push({ ruleId: idText(rule.id), ownerNames: ownerNames });
      }
    }

    return matches;
  }

  // A policy: its levels, and who its first level reaches by a page of this severity.
  private static async resolvePolicy(data: {
    context: ResolveContext;
    policyId: string;
    kind: OnCallTestPageRecordKind;
    severityId: ObjectID;
    isNamedByCriteria: boolean;
    ruleIds: Array<string>;
  }): Promise<WhoIsToldPolicy> {
    let level: FirstLevel | undefined = data.context.firstLevels.get(
      data.policyId,
    );

    if (!level) {
      level = await OnCallTestPageService.readFirstLevel({
        projectId: data.context.projectId,
        policyId: new ObjectID(data.policyId),
      });

      data.context.firstLevels.set(data.policyId, level);
    }

    const people: Array<WhoIsToldPerson> = [];

    if (level.levelCount > 0) {
      await this.readVerifiedChannels({
        context: data.context,
        userIds: level.targets.map((target: { userId: ObjectID }): ObjectID => {
          return target.userId;
        }),
      });

      for (const target of level.targets) {
        people.push(
          await this.resolvePerson({
            context: data.context,
            userId: target.userId,
            reachedThrough: target.reachedThrough,
            reachedThroughCode: target.reachedThroughCode,
            kind: data.kind,
            severityId: data.severityId,
          }),
        );
      }
    }

    return {
      id: data.policyId,
      name: data.context.policyNames.get(data.policyId) || "",
      isHidden: false,
      isNamedByCriteria: data.isNamedByCriteria,
      ruleIds: data.ruleIds,
      levelCount: level.levelCount,
      people: people,
      notPaged: level.levelCount > 0 ? level.notPaged : [],
      notPagedCodes: level.levelCount > 0 ? level.notPagedCodes : [],
    };
  }

  /*
   * Every verified method of these people, by channel, read once from
   * Readiness: for somebody with no rule for a severity whose fallback picks
   * nothing, a verified method on a channel the project switched off names
   * the switch to turn on (getWhoIsToldPersonReach).
   */
  private static async readVerifiedChannels(data: {
    context: ResolveContext;
    userIds: Array<ObjectID>;
  }): Promise<void> {
    const missing: Array<ObjectID> = data.userIds.filter(
      (userId: ObjectID): boolean => {
        return !data.context.verifiedChannels.has(userId.toString());
      },
    );

    if (missing.length === 0) {
      return;
    }

    const readiness: Array<UserReadiness> =
      await OnCallReadinessService.getReadinessForUsers(
        missing,
        data.context.projectId,
      );

    for (const userId of missing) {
      data.context.verifiedChannels.set(userId.toString(), []);
    }

    for (const person of readiness) {
      data.context.verifiedChannels.set(
        person.userId.toString(),
        this.verifiedChannelsOf(person),
      );
    }
  }

  // A person's verified methods, by channel.
  private static verifiedChannelsOf(
    person: UserReadiness,
  ): Array<OnCallPageChannel> {
    return person.methods
      .filter((method: ReadinessMethod): boolean => {
        return method.isVerified;
      })
      .map((method: ReadinessMethod): OnCallPageChannel => {
        return method.methodType as OnCallPageChannel;
      });
  }

  private static async resolvePerson(data: {
    context: ResolveContext;
    userId: ObjectID;
    reachedThrough?: string | undefined;
    reachedThroughCode?: OnCallTestPageReachedThrough | undefined;
    kind: OnCallTestPageRecordKind;
    severityId: ObjectID;
  }): Promise<WhoIsToldPerson> {
    const key: string = `${data.userId.toString()}|${data.kind}|${data.severityId.toString()}|${data.reachedThrough || ""}`;
    const known: WhoIsToldPerson | undefined = data.context.people.get(key);

    if (known) {
      return known;
    }

    /*
     * A person's paging rules for a kind and severity are read once,
     * however many ways and monitors reach them.
     */
    const previewKey: string = `${data.userId.toString()}|${data.kind}|${data.severityId.toString()}`;
    let preview: OnCallTestPagePreviewPerson | undefined =
      data.context.previews.get(previewKey);

    if (!preview) {
      preview = await OnCallTestPageService.getPersonPreview({
        projectId: data.context.projectId,
        userId: data.userId,
        recordKind: data.kind,
        severityId: data.severityId,
        showAddresses: false,
        reachedThrough: data.reachedThrough,
        project: data.context.project,
      });

      data.context.previews.set(previewKey, preview);
    }

    /*
     * No rule of theirs covers the severity, they did not opt out, and the
     * project falls back: a page goes to what the fallback picks of their
     * methods (#7528), read only then.
     */
    const fallbackChannels: Array<OnCallPageChannel> =
      preview.hasNoRule && !preview.isOptedOut && data.context.isFallbackEnabled
        ? await this.readFallbackChannels({
            context: data.context,
            userId: data.userId,
            kind: data.kind,
          })
        : [];

    const person: WhoIsToldPerson = {
      userId: data.userId.toString(),
      name: preview.userName,
      ...(data.reachedThrough ? { reachedThrough: data.reachedThrough } : {}),
      ...(data.reachedThroughCode
        ? { reachedThroughCode: data.reachedThroughCode }
        : {}),
      ...getWhoIsToldPersonReach({
        ruleMethods: preview.methods,
        hasNoRule: preview.hasNoRule,
        isOptedOut: preview.isOptedOut,
        fallbackChannels: fallbackChannels,
        verifiedChannels:
          data.context.verifiedChannels.get(data.userId.toString()) || [],
        isFallbackEnabled: data.context.isFallbackEnabled,
        channelsOff: data.context.channelsOff,
      }),
    };

    if (!person.problem) {
      delete person.problem;
    }

    /*
     * What goes out as their page starts (#8860): the fallback sends what it
     * picks at once; a rule sends at once when it notifies after no minutes.
     */
    person.channelsAtOnce = !person.isReachable
      ? []
      : person.isFallback
        ? [...person.channels]
        : this.getChannelsAtOnce({
            methods: preview.methods,
            channelsOff: data.context.channelsOff,
          });

    data.context.people.set(key, person);

    return person;
  }

  /*
   * The channels of a person's rules for a severity that notify as their
   * page starts (#8860): after no minutes, on a verified method, by a
   * channel the project has on - each once, in the order the rules send.
   */
  public static getChannelsAtOnce(data: {
    methods: ReadonlyArray<{
      channel: OnCallPageChannel;
      isVerified: boolean;
      notifyAfterMinutes: number;
      isFallback?: boolean | undefined;
    }>;
    channelsOff: ReadonlyArray<OnCallPageChannel>;
  }): Array<OnCallPageChannel> {
    const channels: Array<OnCallPageChannel> = [];

    for (const method of data.methods) {
      if (
        method.isVerified &&
        !method.isFallback &&
        Number(method.notifyAfterMinutes || 0) <= 0 &&
        !data.channelsOff.includes(method.channel) &&
        !channels.includes(method.channel)
      ) {
        channels.push(method.channel);
      }
    }

    return channels;
  }

  /*
   * WHAT THE FALLBACK PICKS OF A PERSON'S METHODS for a kind of page, read
   * by the fallback's own chooser (UserNotificationRuleService
   * .getFallbackRules, what executeFallbackNotification then sends), so the
   * card can never say more or less than a page sends: every free verified
   * method, or else one paid one on a channel the project has on, or else a
   * webhook (#7528). Read without sending anything, once per person and
   * kind - a page's severity does not change what it picks.
   */
  private static async readFallbackChannels(data: {
    context: ResolveContext;
    userId: ObjectID;
    kind: OnCallTestPageRecordKind;
  }): Promise<Array<OnCallPageChannel>> {
    const ruleType: NotificationRuleType = getOnCallTestPageRuleType(data.kind);
    const key: string = `${data.userId.toString()}|${ruleType}`;
    const known: Array<OnCallPageChannel> | undefined =
      data.context.fallbackChannels.get(key);

    if (known) {
      return known;
    }

    const channels: Array<OnCallPageChannel> = getFallbackRuleChannels(
      await UserNotificationRuleService.getFallbackRules({
        projectId: data.context.projectId,
        userId: data.userId,
        ruleType: ruleType,
      }),
    );

    data.context.fallbackChannels.set(key, channels);

    return channels;
  }

  /*
   * Who an incident or alert emails as its owners: everyone it is given as
   * an owner - whom the criteria names and the owners of the network device
   * the monitor watches (MonitorIncident and MonitorAlert add both), and
   * whom the owner rules add - or, when that is nobody, the project's owners
   * (the owners' "created" notification falls back to them).
   *
   * Only the owners that email reaches are named (#7211), as the incident's
   * own findOwners reads them: a person who is a member of the project - an
   * owner row is refused for one who left (OwnerRuleAssignment.createOwner)
   * - and a team of the project with a member who is, as a team is emailed
   * through its members. Named owners left: Named; only the owner rules'
   * left: OwnerRules; nobody: the project's owners. An owner rule that adds
   * only people and teams the email does not reach is not why anyone is
   * emailed, and is not listed.
   *
   * The others are kept, with why and what named them (notReached, #7572):
   * a person who is not a member of the project, a team of the project with
   * nobody in it who is, a team of another project. And the ids of the
   * owners the record will have - its members and the project's teams -
   * for who may read it once it is private (#7213), and whom an alert's
   * Alert Owner rules match (#9407).
   *
   * For breaks only (resolveProject) the ids and those not reached are all
   * that is worked out: who is reached was read for the project at once
   * (readOwnersOfProject), and no name, recipient or Project Owner is read.
   */
  private static async getEventOwners(data: {
    context: ResolveContext;
    namedOwners: NamedOwners;
    withDeviceOwners: boolean;
    monitorStepId: string;
    ownerRuleAdditions: OwnerRuleAdditions;
  }): Promise<EventOwners> {
    const deviceOwners: NetworkDeviceOwners = data.withDeviceOwners
      ? await this.getDeviceOwners({
          context: data.context,
          monitorStepId: data.monitorStepId,
        })
      : { ownerUserIds: [], ownerTeamIds: [] };

    const namedUserIds: Array<string> = uniqueIds([
      ...data.namedOwners.userIds,
      ...deviceOwners.ownerUserIds,
    ]);
    const namedTeamIds: Array<string> = uniqueIds([
      ...data.namedOwners.teamIds,
      ...deviceOwners.ownerTeamIds,
    ]);

    await this.readOwnersReached({
      context: data.context,
      userIds: [...namedUserIds, ...data.ownerRuleAdditions.userIds],
      teamIds: [...namedTeamIds, ...data.ownerRuleAdditions.teamIds],
    });

    const isUserReached: (id: string) => boolean = (id: string): boolean => {
      return data.context.projectMembers.get(id.toLowerCase()) === true;
    };
    const isTeamReached: (id: string) => boolean = (id: string): boolean => {
      return data.context.teamsWithMembers.get(id.toLowerCase()) === true;
    };

    const reachedNamedUserIds: Array<string> =
      namedUserIds.filter(isUserReached);
    const reachedNamedTeamIds: Array<string> =
      namedTeamIds.filter(isTeamReached);

    const userIds: Array<string> = uniqueIds([
      ...reachedNamedUserIds,
      ...data.ownerRuleAdditions.userIds.filter(isUserReached),
    ]);
    const teamIds: Array<string> = uniqueIds([
      ...reachedNamedTeamIds,
      ...data.ownerRuleAdditions.teamIds.filter(isTeamReached),
    ]);

    const ownerRules: Array<WhoIsToldRule> = data.ownerRuleAdditions.rules
      .filter((addition: OwnerRuleAddition): boolean => {
        return (
          addition.userIds.some(isUserReached) ||
          addition.teamIds.some(isTeamReached)
        );
      })
      .map((addition: OwnerRuleAddition): WhoIsToldRule => {
        return addition.rule;
      });

    const allTeamIds: Array<string> = uniqueIds([
      ...namedTeamIds,
      ...data.ownerRuleAdditions.teamIds,
    ]);

    const isLean: boolean = data.context.isForBreaksOnly;

    // Which teams are the project's, and their names, read once.
    const userNames: Array<string> = isLean
      ? []
      : await this.readUserNames({
          context: data.context,
          userIds: userIds,
        });
    await this.readTeamNames({ context: data.context, teamIds: allTeamIds });
    const teamNames: Array<string> = this.namesInOrder(
      teamIds,
      data.context.teamNames,
    );

    const isProjectTeam: (id: string) => boolean = (id: string): boolean => {
      return data.context.projectTeams.get(id.toLowerCase()) === true;
    };

    const notReached: Array<WhoIsToldOwnerNotReached> =
      this.getOwnersNotReached({
        context: data.context,
        namedOwners: data.namedOwners,
        deviceOwners: deviceOwners,
        monitorStepId: data.monitorStepId,
        ownerRuleAdditions: data.ownerRuleAdditions,
        isUserReached: isUserReached,
        isTeamReached: isTeamReached,
        isProjectTeam: isProjectTeam,
      });

    const ownerIds: WhoIsToldOwnerIds = {
      userIds: userIds,
      // Every team of the project named: each is an owner row, emailed or not.
      teamIds: allTeamIds.filter(isProjectTeam),
    };

    if (userIds.length > 0 || teamIds.length > 0) {
      const owners: WhoIsToldOwners = {
        source:
          reachedNamedUserIds.length > 0 || reachedNamedTeamIds.length > 0
            ? WhoIsToldOwnersSource.Named
            : WhoIsToldOwnersSource.OwnerRules,
        userNames: userNames,
        teamNames: isLean ? [] : teamNames,
      };

      if (!isLean) {
        owners.recipients = await this.getOwnerRecipients({
          context: data.context,
          userIds: userIds,
          teamIds: teamIds,
        });
      }

      if (notReached.length > 0) {
        owners.notReached = notReached;
      }

      return { owners: owners, ownerRules: ownerRules, ownerIds: ownerIds };
    }

    if (isLean) {
      const owners: WhoIsToldOwners = {
        source: WhoIsToldOwnersSource.ProjectOwners,
        userNames: [],
        teamNames: [],
      };

      if (notReached.length > 0) {
        owners.notReached = notReached;
      }

      return { owners: owners, ownerRules: ownerRules, ownerIds: ownerIds };
    }

    const projectOwners: Array<{ id: string; name: string }> =
      await this.readProjectOwners(data.context);

    const owners: WhoIsToldOwners = {
      source: WhoIsToldOwnersSource.ProjectOwners,
      userNames: data.context.projectOwnerNames || [],
      teamNames: [],
      // The Project Owners stand in for owners: each is named (#8860).
      recipients: projectOwners.map(
        (owner: { id: string; name: string }): WhoIsToldOwnerRecipient => {
          return {
            userId: owner.id,
            name: owner.name,
            isNamed: true,
            teamNames: [],
          };
        },
      ),
    };

    if (notReached.length > 0) {
      owners.notReached = notReached;
    }

    return { owners: owners, ownerRules: ownerRules, ownerIds: ownerIds };
  }

  /*
   * THE OWNERS NO CREATED EMAIL REACHES (#7572), each with why and what
   * named it: the criteria, the network device the monitor watches, or an
   * owner rule. A person who is not a member of the project is never named
   * - the project's pages do not name them either - nor is a team of
   * another project. One named in two places is said in each.
   */
  private static getOwnersNotReached(data: {
    context: ResolveContext;
    namedOwners: NamedOwners;
    deviceOwners: NetworkDeviceOwners;
    monitorStepId: string;
    ownerRuleAdditions: OwnerRuleAdditions;
    isUserReached: (id: string) => boolean;
    isTeamReached: (id: string) => boolean;
    isProjectTeam: (id: string) => boolean;
  }): Array<WhoIsToldOwnerNotReached> {
    const notReached: Array<WhoIsToldOwnerNotReached> = [];
    const seen: Set<string> = new Set<string>();

    const add: (item: {
      kind: WhoIsToldOwnerKind;
      id: string;
      addedBy: WhoIsToldOwnerAddedBy;
      rule?: WhoIsToldRule | undefined;
      networkDeviceId?: string | undefined;
    }) => void = (item: {
      kind: WhoIsToldOwnerKind;
      id: string;
      addedBy: WhoIsToldOwnerAddedBy;
      rule?: WhoIsToldRule | undefined;
      networkDeviceId?: string | undefined;
    }): void => {
      const isUser: boolean = item.kind === WhoIsToldOwnerKind.User;

      if (isUser ? data.isUserReached(item.id) : data.isTeamReached(item.id)) {
        return;
      }

      const key: string = [
        item.kind,
        item.id.toLowerCase(),
        item.addedBy,
        item.rule?.id || "",
      ].join("|");

      if (seen.has(key)) {
        return;
      }

      seen.add(key);

      const isProjectTeam: boolean = !isUser && data.isProjectTeam(item.id);

      const owner: WhoIsToldOwnerNotReached = {
        kind: item.kind,
        id: item.id,
        name: isProjectTeam
          ? data.context.teamNames.get(item.id.toLowerCase()) || ""
          : "",
        problem: isUser
          ? WhoIsToldOwnerProblem.NotInProject
          : isProjectTeam
            ? WhoIsToldOwnerProblem.TeamHasNobodyInProject
            : WhoIsToldOwnerProblem.TeamOfAnotherProject,
        addedBy: item.addedBy,
      };

      if (item.rule) {
        owner.rule = item.rule;
      }

      if (item.networkDeviceId) {
        owner.networkDeviceId = item.networkDeviceId;
      }

      notReached.push(owner);
    };

    // The alert's owners an incident takes are said on the alert.
    if (data.namedOwners.addedBy) {
      for (const id of uniqueIds(data.namedOwners.userIds)) {
        add({
          kind: WhoIsToldOwnerKind.User,
          id: id,
          addedBy: data.namedOwners.addedBy,
        });
      }

      for (const id of uniqueIds(data.namedOwners.teamIds)) {
        add({
          kind: WhoIsToldOwnerKind.Team,
          id: id,
          addedBy: data.namedOwners.addedBy,
        });
      }
    }

    const networkDeviceId: string = idText(
      NetworkDeviceOwnerUserService.getDeviceIdForMonitor({
        monitor: data.context.monitor,
        monitorStepId: data.monitorStepId || undefined,
      }),
    );

    for (const id of uniqueIds(data.deviceOwners.ownerUserIds)) {
      add({
        kind: WhoIsToldOwnerKind.User,
        id: id,
        addedBy: WhoIsToldOwnerAddedBy.NetworkDevice,
        networkDeviceId: networkDeviceId,
      });
    }

    for (const id of uniqueIds(data.deviceOwners.ownerTeamIds)) {
      add({
        kind: WhoIsToldOwnerKind.Team,
        id: id,
        addedBy: WhoIsToldOwnerAddedBy.NetworkDevice,
        networkDeviceId: networkDeviceId,
      });
    }

    for (const addition of data.ownerRuleAdditions.rules) {
      for (const id of addition.userIds) {
        add({
          kind: WhoIsToldOwnerKind.User,
          id: id,
          addedBy: WhoIsToldOwnerAddedBy.OwnerRule,
          rule: addition.rule,
        });
      }

      for (const id of addition.teamIds) {
        add({
          kind: WhoIsToldOwnerKind.Team,
          id: id,
          addedBy: WhoIsToldOwnerAddedBy.OwnerRule,
          rule: addition.rule,
        });
      }
    }

    return notReached;
  }

  /*
   * Everyone an event's Created email is addressed to, person by person
   * (#8860): the owners it names and the members of its owner teams it
   * reaches through them (readOwnersReached), each once, by id - with the
   * teams that reach each. Their names are read once with the owners'.
   */
  private static async getOwnerRecipients(data: {
    context: ResolveContext;
    userIds: Array<string>;
    teamIds: Array<string>;
  }): Promise<Array<WhoIsToldOwnerRecipient>> {
    const membersOf: (teamId: string) => Array<string> = (
      teamId: string,
    ): Array<string> => {
      return data.context.teamMemberIds.get(teamId.toLowerCase()) || [];
    };

    const recipientIds: Array<string> = uniqueIds([
      ...data.userIds,
      ...data.teamIds.flatMap(membersOf),
    ]);

    await this.readUserNames({
      context: data.context,
      userIds: recipientIds,
    });

    const named: Set<string> = new Set<string>(
      data.userIds.map((id: string): string => {
        return id.toLowerCase();
      }),
    );

    return recipientIds.map((userId: string): WhoIsToldOwnerRecipient => {
      const key: string = userId.toLowerCase();

      return {
        userId: userId,
        name: data.context.userNames.get(key) || "",
        isNamed: named.has(key),
        teamNames: data.teamIds
          .filter((teamId: string): boolean => {
            return membersOf(teamId).some((memberId: string): boolean => {
              return memberId.toLowerCase() === key;
            });
          })
          .map((teamId: string): string => {
            return data.context.teamNames.get(teamId.toLowerCase()) || "";
          })
          .filter((name: string): boolean => {
            return Boolean(name);
          }),
      };
    });
  }

  /*
   * The project's owners, by id and name, read once - with their names, as
   * a status change and an event with no owners name them.
   */
  private static async readProjectOwners(
    context: ResolveContext,
  ): Promise<Array<{ id: string; name: string }>> {
    if (context.projectOwners === null) {
      const owners: Array<User> = await ProjectService.getOwners(
        context.projectId,
      );

      context.projectOwnerNames = this.namesOf(owners);
      context.projectOwners = owners
        .filter((owner: User): boolean => {
          return Boolean(idText(owner.id));
        })
        .map((owner: User): { id: string; name: string } => {
          return {
            id: idText(owner.id),
            name: owner.name?.toString() || owner.email?.toString() || "",
          };
        });
    }

    return context.projectOwners;
  }

  /*
   * Whether the Created email reaches each of these owners, read once per
   * resolve into the context, as the incident's findOwners decides it: the
   * project's teams' member rows (pending invitations too, as
   * TeamMemberService.getUsersInTeams reads them), then, in one read for
   * the owners and those members alike, who among them is a member of the
   * project (TeamMemberService.getProjectMemberUserIds: an accepted
   * invitation to any of its teams). A team of another project has no rows
   * here, and reaches nobody.
   */
  private static async readOwnersReached(data: {
    context: ProjectContext;
    userIds: Array<string>;
    teamIds: Array<string>;
  }): Promise<void> {
    const teamIds: Array<string> = uniqueIds(data.teamIds).filter(
      (id: string): boolean => {
        return !data.context.teamsWithMembers.has(id.toLowerCase());
      },
    );

    const membersByTeam: Map<string, Array<string>> = new Map<
      string,
      Array<string>
    >();

    if (teamIds.length > 0) {
      const members: Array<TeamMember> = await TeamMemberService.findBy({
        query: {
          teamId: QueryHelper.any(
            teamIds.map((id: string): ObjectID => {
              return new ObjectID(id);
            }),
          ),
          projectId: data.context.projectId,
        },
        select: { teamId: true, userId: true },
        skip: 0,
        limit: LIMIT_MAX,
        props: { isRoot: true },
      });

      for (const member of members) {
        const teamId: string = idText(member.teamId).toLowerCase();
        const userId: string = idText(member.userId);

        if (teamId && userId) {
          membersByTeam.set(teamId, [
            ...(membersByTeam.get(teamId) || []),
            userId,
          ]);
        }
      }
    }

    const userIds: Array<string> = uniqueIds([
      ...data.userIds,
      ...Array.from(membersByTeam.values()).flat(),
    ]).filter((id: string): boolean => {
      return !data.context.projectMembers.has(id.toLowerCase());
    });

    if (userIds.length > 0) {
      const memberIds: Set<string> = new Set<string>(
        (
          await TeamMemberService.getProjectMemberUserIds({
            projectId: data.context.projectId,
            userIds: userIds,
          })
        ).map((id: ObjectID): string => {
          return id.toString().toLowerCase();
        }),
      );

      for (const id of userIds) {
        data.context.projectMembers.set(
          id.toLowerCase(),
          memberIds.has(id.toLowerCase()),
        );
      }
    }

    for (const id of teamIds) {
      const reachedMembers: Array<string> = uniqueIds(
        membersByTeam.get(id.toLowerCase()) || [],
      ).filter((userId: string): boolean => {
        return data.context.projectMembers.get(userId.toLowerCase()) === true;
      });

      data.context.teamsWithMembers.set(
        id.toLowerCase(),
        reachedMembers.length > 0,
      );
      // Who the email reaches through the team, person by person (#8860).
      data.context.teamMemberIds.set(id.toLowerCase(), reachedMembers);
    }
  }

  // The owners of the network device a step watches (none for most monitors), read once.
  private static async getDeviceOwners(data: {
    context: ResolveContext;
    monitorStepId: string;
  }): Promise<NetworkDeviceOwners> {
    let owners: NetworkDeviceOwners | undefined = data.context.deviceOwners.get(
      data.monitorStepId,
    );

    if (!owners) {
      // The whole project at once: its devices' owners were read in one go.
      const preloaded: Map<string, NetworkDeviceOwners> | null =
        data.context.deviceOwnersByDevice;

      if (preloaded) {
        const deviceId: string = idText(
          NetworkDeviceOwnerUserService.getDeviceIdForMonitor({
            monitor: data.context.monitor,
            monitorStepId: data.monitorStepId || undefined,
          }),
        ).toLowerCase();

        owners = (deviceId && preloaded.get(deviceId)) || NO_DEVICE_OWNERS;
      } else {
        owners = await NetworkDeviceOwnerUserService.getDeviceOwnersForMonitor({
          monitor: data.context.monitor,
          monitorStepId: data.monitorStepId || undefined,
        });
      }

      data.context.deviceOwners.set(data.monitorStepId, owners);
    }

    return owners;
  }

  /*
   * Who a status change emails: the monitor's owners, or the project's. A
   * monitor not created yet is owned by whoever creates it.
   */
  private static async getMonitorOwners(
    context: ResolveContext,
  ): Promise<WhoIsToldOwners> {
    if (context.monitorOwnerNames === null) {
      context.monitorOwnerNames = context.newMonitorCreatorId
        ? await this.readUserNames({
            context: context,
            userIds: [context.newMonitorCreatorId],
          })
        : this.namesOf(await MonitorService.findOwners(context.monitor.id!));
    }

    if (context.monitorOwnerNames.length > 0) {
      return {
        source: WhoIsToldOwnersSource.MonitorOwners,
        userNames: context.monitorOwnerNames,
        teamNames: [],
      };
    }

    await this.readProjectOwners(context);

    return {
      source: WhoIsToldOwnersSource.ProjectOwners,
      userNames: context.projectOwnerNames || [],
      teamNames: [],
    };
  }

  private static namesOf(users: Array<User>): Array<string> {
    const names: Array<string> = [];

    for (const user of users) {
      const name: string =
        user.name?.toString() || user.email?.toString() || "";

      if (name && !names.includes(name)) {
        names.push(name);
      }
    }

    return names;
  }

  // People's names (or emails), in the order of their ids, each read once.
  private static async readUserNames(data: {
    context: ProjectContext;
    userIds: Array<string>;
  }): Promise<Array<string>> {
    const missing: Array<string> = data.userIds.filter(
      (id: string): boolean => {
        return !data.context.userNames.has(id.toLowerCase());
      },
    );

    if (missing.length > 0) {
      const users: Array<User> = await UserService.findBy({
        query: {
          _id: QueryHelper.any(
            missing.map((id: string): ObjectID => {
              return new ObjectID(id);
            }),
          ),
        },
        select: { _id: true, name: true, email: true },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        props: { isRoot: true },
      });

      for (const id of missing) {
        data.context.userNames.set(id.toLowerCase(), "");
      }

      for (const user of users) {
        data.context.userNames.set(
          idText(user.id).toLowerCase(),
          user.name?.toString() || user.email?.toString() || "",
        );
      }
    }

    return this.namesInOrder(data.userIds, data.context.userNames);
  }

  // Teams' names, in the order of their ids, each read once: the project's own only.
  private static async readTeamNames(data: {
    context: ProjectContext;
    teamIds: Array<string>;
  }): Promise<Array<string>> {
    const missing: Array<string> = data.teamIds.filter(
      (id: string): boolean => {
        return !data.context.teamNames.has(id.toLowerCase());
      },
    );

    if (missing.length > 0) {
      const teams: Array<Team> = await TeamService.findBy({
        query: {
          _id: QueryHelper.any(
            missing.map((id: string): ObjectID => {
              return new ObjectID(id);
            }),
          ),
          projectId: data.context.projectId,
        },
        select: { _id: true, name: true },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        props: { isRoot: true },
      });

      for (const id of missing) {
        data.context.teamNames.set(id.toLowerCase(), "");
        data.context.projectTeams.set(id.toLowerCase(), false);
      }

      for (const team of teams) {
        data.context.teamNames.set(
          idText(team.id).toLowerCase(),
          team.name?.toString() || "",
        );
        // Read with the project's id: a team of another project is not found.
        data.context.projectTeams.set(idText(team.id).toLowerCase(), true);
      }
    }

    return this.namesInOrder(data.teamIds, data.context.teamNames);
  }

  // The names of these ids, in their order, each once; nameless ones left out.
  private static namesInOrder(
    ids: Array<string>,
    names: Map<string, string>,
  ): Array<string> {
    const inOrder: Array<string> = [];

    for (const id of ids) {
      const name: string = names.get(id.toLowerCase()) || "";

      if (name && !inOrder.includes(name)) {
        inOrder.push(name);
      }
    }

    return inOrder;
  }

  private static async readIncidentSeverities(
    projectId: ObjectID,
  ): Promise<Array<IncidentSeverity>> {
    return await IncidentSeverityService.findBy({
      query: { projectId: projectId },
      select: { _id: true, name: true, isArchived: true },
      sort: { order: SortOrder.Ascending },
      skip: 0,
      limit: LIMIT_PER_PROJECT,
      props: { isRoot: true },
    });
  }

  private static async readAlertSeverities(
    projectId: ObjectID,
  ): Promise<Array<AlertSeverity>> {
    return await AlertSeverityService.findBy({
      query: { projectId: projectId },
      select: { _id: true, name: true, isArchived: true },
      sort: { order: SortOrder.Ascending },
      skip: 0,
      limit: LIMIT_PER_PROJECT,
      props: { isRoot: true },
    });
  }

  private static async readStatuses(
    projectId: ObjectID,
  ): Promise<Map<string, MonitorStatus>> {
    const statuses: Array<MonitorStatus> = await MonitorStatusService.findBy({
      query: { projectId: projectId },
      select: { _id: true, name: true, color: true },
      skip: 0,
      limit: LIMIT_PER_PROJECT,
      props: { isRoot: true },
    });

    const byId: Map<string, MonitorStatus> = new Map<string, MonitorStatus>();

    for (const status of statuses) {
      if (status.id) {
        byId.set(status.id.toString(), status);
      }
    }

    return byId;
  }

  /*
   * The project's on-call policies by name, every one of them; and whether
   * one is in service - not archived, as an archived policy pages no one -
   * which tells a project with no on-call policy yet (#7369).
   */
  private static async readPolicies(projectId: ObjectID): Promise<{
    names: Map<string, string>;
    hasPolicyInService: boolean;
  }> {
    const policies: Array<OnCallDutyPolicy> =
      await OnCallDutyPolicyService.findBy({
        query: { projectId: projectId },
        select: { _id: true, name: true, isArchived: true },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        props: { isRoot: true },
      });

    const names: Map<string, string> = new Map<string, string>();
    let hasPolicyInService: boolean = false;

    for (const policy of policies) {
      if (policy.id) {
        names.set(policy.id.toString(), policy.name?.toString() || "");
        hasPolicyInService = hasPolicyInService || !policy.isArchived;
      }
    }

    return { names: names, hasPolicyInService: hasPolicyInService };
  }

  /*
   * The status pages an incident from the monitor shows on, by name. Where
   * an incident reaches is IncidentStatusPageScope's call, as for the
   * subscriber jobs and the public pages: each page that lists the monitor,
   * directly or through a monitor group it is in - not an archived page, a
   * page of a blocked project, or a page that shows only the incidents
   * limited to it (one a monitor opens never is). A page that does not show
   * incidents at all tells nobody of one, and is left out too.
   */
  private static async readStatusPages(data: {
    projectId: ObjectID;
    monitorId: ObjectID;
  }): Promise<Array<WhoIsToldStatusPage>> {
    const reached: ResolvedIncidentStatusPages =
      await IncidentStatusPageScope.resolvePagesForDraftIncident({
        monitorIds: [data.monitorId],
        // How each page reaches the monitor: itself, or a group it is in (#7214).
        resourceSelect: {
          statusPageId: true,
          monitorId: true,
          monitorGroupId: true,
          monitorGroup: { _id: true, name: true },
        },
      });

    const projectId: string = idText(data.projectId).toLowerCase();
    const pages: Array<WhoIsToldStatusPage> = [];

    for (const statusPage of reached.statusPages) {
      const id: string = idText(statusPage.id);

      if (
        !id ||
        statusPage.showIncidentsOnStatusPage === false ||
        idText(statusPage.projectId).toLowerCase() !== projectId ||
        pages.some((page: WhoIsToldStatusPage): boolean => {
          return page.id === id;
        })
      ) {
        continue;
      }

      pages.push({
        id: id,
        name: statusPage.name?.toString() || "",
        groups: getMonitorGroupsOfPage({
          monitorId: idText(data.monitorId),
          resources: getPageResources(reached, id),
        }),
      });
    }

    return pages;
  }

  /*
   * The channels: the project's switches, its own Twilio account, its
   * balance on OneUptime Cloud, and on a self-hosted server what the
   * server can send (ServerSendingStatus).
   */
  private static async readChannels(data: {
    projectId: ObjectID;
    project: Project | null;
  }): Promise<WhoIsToldChannels> {
    const smsConfig: TwilioConfig | undefined =
      await ProjectCallSMSConfigService.getProjectDefaultTwilioConfig(
        data.projectId,
        TwilioMessageKind.SMS,
      );

    const callConfig: TwilioConfig | undefined =
      await ProjectCallSMSConfigService.getProjectDefaultTwilioConfig(
        data.projectId,
        TwilioMessageKind.Call,
      );

    const channels: WhoIsToldChannels = {
      isBillingEnabled: IsBillingEnabled,
      isSmsOn: data.project?.enableSmsNotifications !== false,
      isCallOn: data.project?.enableCallNotifications !== false,
      isWhatsAppOn: data.project?.enableWhatsAppNotifications !== false,
      isTelegramOn: data.project?.enableTelegramNotifications !== false,
      hasOwnTwilioForSms: Boolean(smsConfig),
      hasOwnTwilioForCalls: Boolean(callConfig),
      serverCanSendEmail: null,
      serverCanSendSms: null,
      serverCanCall: null,
    };

    if (IsBillingEnabled) {
      channels.balanceInUSDCents =
        data.project?.smsOrCallCurrentBalanceInUSDCents || 0;
      channels.isAutoRechargeOn = Boolean(
        data.project?.enableAutoRechargeSmsOrCallBalance,
      );
      return channels;
    }

    try {
      const statuses: Array<ServerChannelStatus> =
        await ServerSendingStatus.getStatuses();

      channels.serverCanSendEmail = canServerSendBy(
        statuses,
        ServerSendingChannel.Email,
      );
      channels.serverCanSendSms = canServerSendBy(
        statuses,
        ServerSendingChannel.SMS,
      );
      channels.serverCanCall = canServerSendBy(
        statuses,
        ServerSendingChannel.Call,
      );
    } catch (err) {
      logger.debug(
        `WhoIsTold: could not read what the server can send: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    return channels;
  }
}

export default WhoIsToldService;
