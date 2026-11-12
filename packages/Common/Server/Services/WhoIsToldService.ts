import { IsBillingEnabled } from "../EnvironmentConfig";
import InMemoryTTLCache from "../Infrastructure/InMemoryTTLCache";
import QueryHelper from "../Types/Database/QueryHelper";
import logger from "../Utils/Logger";
import MonitorRuleCriteriaCache from "../Utils/Rules/MonitorRuleCriteriaCache";
import ServerSendingStatus from "../Utils/ServerSending/ServerSendingStatus";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import AlertOnCallRuleEngineService from "./AlertOnCallRuleEngineService";
import AlertOnCallRuleService from "./AlertOnCallRuleService";
import AlertOwnerRuleService from "./AlertOwnerRuleService";
import AlertSeverityService from "./AlertSeverityService";
import IncidentOnCallRuleEngineService from "./IncidentOnCallRuleEngineService";
import IncidentOnCallRuleService from "./IncidentOnCallRuleService";
import IncidentOwnerRuleService from "./IncidentOwnerRuleService";
import IncidentSeverityService from "./IncidentSeverityService";
import MonitorService from "./MonitorService";
import MonitorStatusService from "./MonitorStatusService";
import OnCallDutyPolicyService from "./OnCallDutyPolicyService";
import OnCallReadinessService, {
  ReadinessMethod,
  UserReadiness,
} from "./OnCallReadinessService";
import OnCallTestPageService from "./OnCallTestPageService";
import ProjectCallSMSConfigService from "./ProjectCallSMSConfigService";
import ProjectService from "./ProjectService";
import StatusPageResourceService from "./StatusPageResourceService";
import TeamService from "./TeamService";
import UserService from "./UserService";
import Alert from "../../Models/DatabaseModels/Alert";
import AlertOnCallRule from "../../Models/DatabaseModels/AlertOnCallRule";
import AlertSeverity from "../../Models/DatabaseModels/AlertSeverity";
import Incident from "../../Models/DatabaseModels/Incident";
import IncidentOnCallRule from "../../Models/DatabaseModels/IncidentOnCallRule";
import IncidentSeverity from "../../Models/DatabaseModels/IncidentSeverity";
import Label from "../../Models/DatabaseModels/Label";
import Monitor from "../../Models/DatabaseModels/Monitor";
import MonitorStatus from "../../Models/DatabaseModels/MonitorStatus";
import OnCallDutyPolicy from "../../Models/DatabaseModels/OnCallDutyPolicy";
import Project from "../../Models/DatabaseModels/Project";
import StatusPageResource from "../../Models/DatabaseModels/StatusPageResource";
import Team from "../../Models/DatabaseModels/Team";
import User from "../../Models/DatabaseModels/User";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import TwilioConfig from "../../Types/CallAndSMS/TwilioConfig";
import { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import OneUptimeDate from "../../Types/Date";
import BadDataException from "../../Types/Exception/BadDataException";
import { CriteriaAlert } from "../../Types/Monitor/CriteriaAlert";
import { CriteriaIncident } from "../../Types/Monitor/CriteriaIncident";
import MonitorCriteriaInstance from "../../Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../Types/Monitor/MonitorSteps";
import {
  WHO_IS_TOLD_CACHE_TTL_IN_MS,
  WhoIsToldChannels,
  WhoIsToldCriteria,
  WhoIsToldEvent,
  WhoIsToldOwners,
  WhoIsToldOwnersSource,
  WhoIsToldPerson,
  WhoIsToldPolicy,
  WhoIsToldResult,
  WhoIsToldRule,
  WhoIsToldStatusPage,
  getChannelsSwitchedOff,
  getWhoIsToldBreaks,
  getWhoIsToldPersonReach,
  redactWhoIsTold,
} from "../../Types/Monitor/WhoIsTold";
import ObjectID from "../../Types/ObjectID";
import { OnCallPageChannel } from "../../Types/OnCallDutyPolicy/OnCallPageChannel";
import {
  OnCallTestPagePreviewPerson,
  OnCallTestPageRecordKind,
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
 *     does);
 *   - who that emails as owners: the people and teams the criteria names,
 *     or the project's owners - and the monitor's owners of a status change;
 *   - which on-call rules match what it opens, by the rule engines' own
 *     matching (getMatchingRules) run on the incident or alert held in
 *     memory, and the policies they and the criteria run;
 *   - who each policy's first level reaches right now, read as a test of the
 *     policy reads it (OnCallTestPageService.readFirstLevel), and how a page
 *     of the severity reaches each of them: their rules for it, or their
 *     verified methods (OnCallReadinessService) when the project falls back;
 *   - the project's channels, its balance on OneUptime Cloud, and on a
 *     self-hosted server whether it can send email, SMS and calls;
 *   - the status pages an incident shows on.
 *
 * The answer is kept a minute per monitor, as Readiness keeps its own, and
 * each caller is handed it as they may see it (getForMonitor): somebody who
 * may read the monitor and not a policy learns that paging is set up, and
 * nothing of who.
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
  hasIncidentOwnerRules: boolean;
  hasAlertOwnerRules: boolean;
  projectHasIncidentOnCallRules: boolean;
  projectHasAlertOnCallRules: boolean;
  projectOwnerNames: Array<string> | null;
  channelsOff: Array<OnCallPageChannel>;
  isFallbackEnabled: boolean;
  firstLevels: Map<string, FirstLevel>;
  people: Map<string, WhoIsToldPerson>;
  previews: Map<string, OnCallTestPagePreviewPerson>;
  verifiedChannels: Map<string, Array<OnCallPageChannel>>;
  /*
   * Set when the whole project is resolved at once (resolveProject): its
   * enabled on-call rules, read once, and its monitors in the cache the
   * engines' matching reads them from - so the matching reads nothing per
   * monitor. Null for one monitor, whose matching reads as the engines do.
   */
  matching: PreloadedMatching | null;
  /*
   * Only the breaks are wanted (resolveProject): who is emailed as owners
   * and the status pages an incident shows on are not read, as no break
   * depends on them.
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
  projectId: true;
  monitorSteps: true;
  labels: { _id: true };
} = {
  _id: true,
  name: true,
  description: true,
  projectId: true,
  monitorSteps: true,
  labels: { _id: true },
};

interface FirstLevel {
  targets: Array<{ userId: ObjectID; reachedThrough?: string | undefined }>;
  notPaged: Array<string>;
  levelCount: number;
}

// The criteria of every step of a monitor, each once, in the order checked.
export function getMonitorCriteriaInstances(
  monitorSteps: MonitorSteps | undefined | null,
): Array<MonitorCriteriaInstance> {
  const instances: Array<MonitorCriteriaInstance> = [];
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

      instances.push(instance);
    }
  }

  return instances;
}

// An id held as an ObjectID or as text, as text; "" for an empty one.
function idText(id: ObjectID | string | null | undefined): string {
  return id ? id.toString().trim() : "";
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

    const policyIds: Set<string> = new Set<string>();
    const incidentRuleIds: Set<string> = new Set<string>();
    const alertRuleIds: Set<string> = new Set<string>();

    for (const item of result.criteria) {
      for (const event of item.events) {
        for (const policy of event.policies) {
          policyIds.add(policy.id);
        }

        for (const rule of event.rules) {
          (event.kind === OnCallTestPageRecordKind.Alert
            ? alertRuleIds
            : incidentRuleIds
          ).add(rule.id);
        }
      }
    }

    const readablePolicyIds: Set<string> = await this.readableIds({
      ids: policyIds,
      read: async (
        query: Array<ObjectID>,
      ): Promise<Array<{ id?: ObjectID | null }>> => {
        return await OnCallDutyPolicyService.findBy({
          query: { _id: QueryHelper.any(query), projectId: data.projectId },
          select: { _id: true },
          skip: 0,
          limit: LIMIT_PER_PROJECT,
          props: data.props,
        });
      },
    });

    const readableIncidentRules: Set<string> = await this.readableIds({
      ids: incidentRuleIds,
      read: async (
        query: Array<ObjectID>,
      ): Promise<Array<{ id?: ObjectID | null }>> => {
        return await IncidentOnCallRuleService.findBy({
          query: { _id: QueryHelper.any(query), projectId: data.projectId },
          select: { _id: true },
          skip: 0,
          limit: LIMIT_PER_PROJECT,
          props: data.props,
        });
      },
    });

    const readableAlertRules: Set<string> = await this.readableIds({
      ids: alertRuleIds,
      read: async (
        query: Array<ObjectID>,
      ): Promise<Array<{ id?: ObjectID | null }>> => {
        return await AlertOnCallRuleService.findBy({
          query: { _id: QueryHelper.any(query), projectId: data.projectId },
          select: { _id: true },
          skip: 0,
          limit: LIMIT_PER_PROJECT,
          props: data.props,
        });
      },
    });

    return redactWhoIsTold({
      result: result,
      readablePolicyIds: readablePolicyIds,
      readableRuleIds: new Set<string>([
        ...readableIncidentRules,
        ...readableAlertRules,
      ]),
    });
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
   * every responder's verified methods up front. Who is emailed as owners
   * and the status pages are not read: no break depends on them.
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

    return {
      projectId: data.projectId,
      project: project,
      channels: channels,
      incidentSeverities: await this.readIncidentSeverities(data.projectId),
      alertSeverities: await this.readAlertSeverities(data.projectId),
      statuses: await this.readStatuses(data.projectId),
      policyNames: await this.readPolicyNames(data.projectId),
      hasIncidentOwnerRules: await this.hasEnabled(
        IncidentOwnerRuleService,
        data.projectId,
      ),
      hasAlertOwnerRules: await this.hasEnabled(
        AlertOwnerRuleService,
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
      projectOwnerNames: null,
      channelsOff: getChannelsSwitchedOff(channels),
      isFallbackEnabled: !project?.disableOnCallNotificationFallback,
      firstLevels: new Map<string, FirstLevel>(),
      people: new Map<string, WhoIsToldPerson>(),
      previews: new Map<string, OnCallTestPagePreviewPerson>(),
      verifiedChannels: new Map<string, Array<OnCallPageChannel>>(),
      matching: data.matching,
      isForBreaksOnly: data.isForBreaksOnly,
    };
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
  }): Promise<WhoIsToldResult> {
    const monitorId: string = idText(data.monitor.id);

    const context: ResolveContext = {
      ...data.project,
      monitor: data.monitor,
      monitorOwnerNames: null,
      statusPages:
        data.project.isForBreaksOnly || !monitorId
          ? []
          : await this.readStatusPages({
              projectId: data.project.projectId,
              monitorId: new ObjectID(monitorId),
            }),
    };

    const criteria: Array<WhoIsToldCriteria> = [];

    for (const instance of getMonitorCriteriaInstances(
      data.monitor.monitorSteps,
    )) {
      const item: WhoIsToldCriteria | null = await this.resolveCriteria({
        context: context,
        instance: instance,
      });

      if (item) {
        criteria.push(item);
      }
    }

    return {
      monitorId: monitorId,
      monitorName: data.monitor.name?.toString() || "",
      checkedAt: OneUptimeDate.getCurrentDate().toISOString(),
      criteria: criteria,
      channels: context.channels,
      breaks: getWhoIsToldBreaks({
        criteria: criteria,
        channels: context.channels,
        projectHasIncidentOnCallRules: context.projectHasIncidentOnCallRules,
        projectHasAlertOnCallRules: context.projectHasAlertOnCallRules,
      }),
    };
  }

  /*
   * One criteria: the status it sets and what it opens. A criteria that is
   * switched off, or does neither, is left out: it tells nobody.
   */
  private static async resolveCriteria(data: {
    context: ResolveContext;
    instance: MonitorCriteriaInstance;
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

  private static async resolveIncident(data: {
    context: ResolveContext;
    template: CriteriaIncident;
  }): Promise<WhoIsToldEvent | null> {
    const severity: IncidentSeverity | null = pickSeverity(
      data.context.incidentSeverities,
      data.template.incidentSeverityId,
    );

    // A project with no incident severity opens no incident (MonitorIncident).
    if (!severity?.id) {
      return null;
    }

    const incident: Incident = new Incident();
    incident.projectId = data.context.projectId;
    incident.incidentSeverityId = severity.id;
    incident.title = data.template.title || "";
    incident.description = data.template.description || "";
    incident.monitors = [data.context.monitor];
    incident.labels = this.toLabels(data.template.labelIds);

    const rules: Array<IncidentOnCallRule> = data.context.matching
      ? await IncidentOnCallRuleEngineService.getMatchingRules(incident, {
          rules: data.context.matching.incidentRules,
          monitorCache: data.context.matching.monitorCache,
        })
      : await IncidentOnCallRuleEngineService.getMatchingRules(incident);

    return await this.makeEvent({
      context: data.context,
      kind: OnCallTestPageRecordKind.Incident,
      severityId: severity.id,
      severityName: severity.name?.toString() || "",
      template: data.template,
      rules: rules,
      statusPages:
        data.template.showIncidentOnStatusPage === false
          ? []
          : data.context.statusPages,
    });
  }

  private static async resolveAlert(data: {
    context: ResolveContext;
    template: CriteriaAlert;
  }): Promise<WhoIsToldEvent | null> {
    const severity: AlertSeverity | null = pickSeverity(
      data.context.alertSeverities,
      data.template.alertSeverityId,
    );

    if (!severity?.id) {
      return null;
    }

    const alert: Alert = new Alert();
    alert.projectId = data.context.projectId;
    alert.alertSeverityId = severity.id;
    alert.title = data.template.title || "";
    alert.description = data.template.description || "";
    alert.monitorId = data.context.monitor.id!;
    alert.labels = this.toLabels(data.template.labelIds);

    const rules: Array<AlertOnCallRule> = data.context.matching
      ? await AlertOnCallRuleEngineService.getMatchingRules(alert, {
          rules: data.context.matching.alertRules,
          monitorCache: data.context.matching.monitorCache,
        })
      : await AlertOnCallRuleEngineService.getMatchingRules(alert);

    return await this.makeEvent({
      context: data.context,
      kind: OnCallTestPageRecordKind.Alert,
      severityId: severity.id,
      severityName: severity.name?.toString() || "",
      template: data.template,
      rules: rules,
      statusPages: [],
    });
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

  // What one incident or alert template tells, and who.
  private static async makeEvent(data: {
    context: ResolveContext;
    kind: OnCallTestPageRecordKind;
    severityId: ObjectID;
    severityName: string;
    template: CriteriaIncident | CriteriaAlert;
    rules: Array<IncidentOnCallRule | AlertOnCallRule>;
    statusPages: Array<WhoIsToldStatusPage>;
  }): Promise<WhoIsToldEvent> {
    const ruleIdsByPolicy: Map<string, Array<string>> = new Map<
      string,
      Array<string>
    >();
    const order: Array<string> = [];

    const namedIds: Array<string> = (data.template.onCallPolicyIds || [])
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

    for (const policyId of order) {
      policies.push(
        await this.resolvePolicy({
          context: data.context,
          policyId: policyId,
          kind: data.kind,
          severityId: data.severityId,
          isNamedByCriteria: namedIds.includes(policyId),
          ruleIds: ruleIdsByPolicy.get(policyId) || [],
        }),
      );
    }

    return {
      kind: data.kind,
      severityName: data.severityName,
      owners: data.context.isForBreaksOnly
        ? this.getUnreadOwners({
            context: data.context,
            kind: data.kind,
            template: data.template,
          })
        : await this.getEventOwners({
            context: data.context,
            kind: data.kind,
            template: data.template,
          }),
      rules: rules,
      policies: policies,
      statusPages: data.statusPages,
    };
  }

  /*
   * Who an incident or alert emails as its owners, without their names:
   * for an answer that only its breaks are read from (resolveProject).
   */
  private static getUnreadOwners(data: {
    context: ResolveContext;
    kind: OnCallTestPageRecordKind;
    template: CriteriaIncident | CriteriaAlert;
  }): WhoIsToldOwners {
    const namesSomebody: boolean = [
      ...(data.template.ownerUserIds || []),
      ...(data.template.ownerTeamIds || []),
    ].some((id: ObjectID): boolean => {
      return Boolean(idText(id));
    });

    return {
      source: namesSomebody
        ? WhoIsToldOwnersSource.Named
        : WhoIsToldOwnersSource.ProjectOwners,
      userNames: [],
      teamNames: [],
      hasOwnerRules:
        data.kind === OnCallTestPageRecordKind.Alert
          ? data.context.hasAlertOwnerRules
          : data.context.hasIncidentOwnerRules,
    };
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
    };
  }

  /*
   * Every verified method of these people, by channel - what a page falls
   * back to when no rule of theirs covers its severity - read once, from
   * Readiness.
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

  // A person's verified methods, by channel: what the fallback pages.
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

    const person: WhoIsToldPerson = {
      userId: data.userId.toString(),
      name: preview.userName,
      ...(data.reachedThrough ? { reachedThrough: data.reachedThrough } : {}),
      ...getWhoIsToldPersonReach({
        ruleMethods: preview.methods,
        hasNoRule: preview.hasNoRule,
        isOptedOut: preview.isOptedOut,
        verifiedChannels:
          data.context.verifiedChannels.get(data.userId.toString()) || [],
        isFallbackEnabled: data.context.isFallbackEnabled,
        channelsOff: data.context.channelsOff,
      }),
    };

    if (!person.problem) {
      delete person.problem;
    }

    data.context.people.set(key, person);

    return person;
  }

  /*
   * Who an incident or alert emails as its owners: whom the criteria names,
   * or the project's owners - unless an owner rule adds owners first.
   */
  private static async getEventOwners(data: {
    context: ResolveContext;
    kind: OnCallTestPageRecordKind;
    template: CriteriaIncident | CriteriaAlert;
  }): Promise<WhoIsToldOwners> {
    const hasOwnerRules: boolean =
      data.kind === OnCallTestPageRecordKind.Alert
        ? data.context.hasAlertOwnerRules
        : data.context.hasIncidentOwnerRules;

    const userIds: Array<ObjectID> = (data.template.ownerUserIds || []).filter(
      (id: ObjectID): boolean => {
        return Boolean(idText(id));
      },
    );
    const teamIds: Array<ObjectID> = (data.template.ownerTeamIds || []).filter(
      (id: ObjectID): boolean => {
        return Boolean(idText(id));
      },
    );

    if (userIds.length > 0 || teamIds.length > 0) {
      return {
        source: WhoIsToldOwnersSource.Named,
        userNames: await this.readUserNames({
          projectId: data.context.projectId,
          userIds: userIds,
        }),
        teamNames: await this.readTeamNames({
          projectId: data.context.projectId,
          teamIds: teamIds,
        }),
        hasOwnerRules: hasOwnerRules,
      };
    }

    if (data.context.projectOwnerNames === null) {
      data.context.projectOwnerNames = this.namesOf(
        await ProjectService.getOwners(data.context.projectId),
      );
    }

    return {
      source: WhoIsToldOwnersSource.ProjectOwners,
      userNames: data.context.projectOwnerNames,
      teamNames: [],
      hasOwnerRules: hasOwnerRules,
    };
  }

  // Who a status change emails: the monitor's owners, or the project's.
  private static async getMonitorOwners(
    context: ResolveContext,
  ): Promise<WhoIsToldOwners> {
    if (context.monitorOwnerNames === null) {
      context.monitorOwnerNames = this.namesOf(
        await MonitorService.findOwners(context.monitor.id!),
      );
    }

    if (context.monitorOwnerNames.length > 0) {
      return {
        source: WhoIsToldOwnersSource.MonitorOwners,
        userNames: context.monitorOwnerNames,
        teamNames: [],
        hasOwnerRules: false,
      };
    }

    if (context.projectOwnerNames === null) {
      context.projectOwnerNames = this.namesOf(
        await ProjectService.getOwners(context.projectId),
      );
    }

    return {
      source: WhoIsToldOwnersSource.ProjectOwners,
      userNames: context.projectOwnerNames,
      teamNames: [],
      hasOwnerRules: false,
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

  private static async readUserNames(data: {
    projectId: ObjectID;
    userIds: Array<ObjectID>;
  }): Promise<Array<string>> {
    const users: Array<User> = await UserService.findBy({
      query: { _id: QueryHelper.any(data.userIds) },
      select: { name: true, email: true },
      skip: 0,
      limit: LIMIT_PER_PROJECT,
      props: { isRoot: true },
    });

    return this.namesOf(users);
  }

  private static async readTeamNames(data: {
    projectId: ObjectID;
    teamIds: Array<ObjectID>;
  }): Promise<Array<string>> {
    const teams: Array<Team> = await TeamService.findBy({
      query: { _id: QueryHelper.any(data.teamIds), projectId: data.projectId },
      select: { name: true },
      skip: 0,
      limit: LIMIT_PER_PROJECT,
      props: { isRoot: true },
    });

    return teams
      .map((team: Team): string => {
        return team.name?.toString() || "";
      })
      .filter((name: string): boolean => {
        return Boolean(name);
      });
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

  private static async readPolicyNames(
    projectId: ObjectID,
  ): Promise<Map<string, string>> {
    const policies: Array<OnCallDutyPolicy> =
      await OnCallDutyPolicyService.findBy({
        query: { projectId: projectId },
        select: { _id: true, name: true },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        props: { isRoot: true },
      });

    const names: Map<string, string> = new Map<string, string>();

    for (const policy of policies) {
      if (policy.id) {
        names.set(policy.id.toString(), policy.name?.toString() || "");
      }
    }

    return names;
  }

  private static async readStatusPages(data: {
    projectId: ObjectID;
    monitorId: ObjectID;
  }): Promise<Array<WhoIsToldStatusPage>> {
    const resources: Array<StatusPageResource> =
      await StatusPageResourceService.findBy({
        query: { projectId: data.projectId, monitorId: data.monitorId },
        select: { statusPageId: true, statusPage: { name: true } },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        props: { isRoot: true },
      });

    const pages: Array<WhoIsToldStatusPage> = [];

    for (const resource of resources) {
      const id: string = idText(resource.statusPageId);

      if (
        id &&
        !pages.some((page: WhoIsToldStatusPage): boolean => {
          return page.id === id;
        })
      ) {
        pages.push({
          id: id,
          name: resource.statusPage?.name?.toString() || "",
        });
      }
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
