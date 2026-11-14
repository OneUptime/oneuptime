import { IsBillingEnabled } from "../EnvironmentConfig";
import InMemoryTTLCache from "../Infrastructure/InMemoryTTLCache";
import QueryHelper from "../Types/Database/QueryHelper";
import logger from "../Utils/Logger";
import ServerSendingStatus from "../Utils/ServerSending/ServerSendingStatus";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import AlertEpisodeOnCallRuleService from "./AlertEpisodeOnCallRuleService";
import AlertOnCallRuleService from "./AlertOnCallRuleService";
import IncidentEpisodeOnCallRuleService from "./IncidentEpisodeOnCallRuleService";
import IncidentOnCallRuleService from "./IncidentOnCallRuleService";
import MonitorService from "./MonitorService";
import OnCallDutyPolicyEscalationRuleScheduleService from "./OnCallDutyPolicyEscalationRuleScheduleService";
import OnCallDutyPolicyScheduleService, {
  ResolvedShiftSegments,
} from "./OnCallDutyPolicyScheduleService";
import OnCallDutyPolicyService from "./OnCallDutyPolicyService";
import OnCallReadinessService, {
  INVITATION_NOT_ACCEPTED_READINESS_REASONS,
  NOT_A_PROJECT_MEMBER_READINESS_REASONS,
  ReadinessStatus,
  ReadinessSummary,
  UserReadiness,
} from "./OnCallReadinessService";
import ProjectMilestoneService from "./ProjectMilestoneService";
import ProjectService from "./ProjectService";
import RecommendationDismissalService from "./RecommendationDismissalService";
import StatusPageDomainService from "./StatusPageDomainService";
import StatusPageResourceService from "./StatusPageResourceService";
import StatusPageService from "./StatusPageService";
import TeamMemberService from "./TeamMemberService";
import WhoIsToldService, {
  WHO_IS_TOLD_MONITOR_SELECT,
  canServerSendBy,
} from "./WhoIsToldService";
import WorkspaceNotificationRuleService from "./WorkspaceNotificationRuleService";
import WorkspaceProjectAuthTokenService from "./WorkspaceProjectAuthTokenService";
import AlertEpisodeOnCallRule from "../../Models/DatabaseModels/AlertEpisodeOnCallRule";
import AlertOnCallRule from "../../Models/DatabaseModels/AlertOnCallRule";
import IncidentEpisodeOnCallRule from "../../Models/DatabaseModels/IncidentEpisodeOnCallRule";
import IncidentOnCallRule from "../../Models/DatabaseModels/IncidentOnCallRule";
import Monitor from "../../Models/DatabaseModels/Monitor";
import OnCallDutyPolicy from "../../Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicyEscalationRuleSchedule from "../../Models/DatabaseModels/OnCallDutyPolicyEscalationRuleSchedule";
import OnCallDutyPolicySchedule from "../../Models/DatabaseModels/OnCallDutyPolicySchedule";
import Project from "../../Models/DatabaseModels/Project";
import RecommendationDismissal from "../../Models/DatabaseModels/RecommendationDismissal";
import StatusPage from "../../Models/DatabaseModels/StatusPage";
import StatusPageDomain from "../../Models/DatabaseModels/StatusPageDomain";
import StatusPageResource from "../../Models/DatabaseModels/StatusPageResource";
import TeamMember from "../../Models/DatabaseModels/TeamMember";
import User from "../../Models/DatabaseModels/User";
import WorkspaceNotificationRule from "../../Models/DatabaseModels/WorkspaceNotificationRule";
import WorkspaceProjectAuthToken from "../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import ActivationMilestone from "../../Types/Analytics/ActivationMilestone";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import OneUptimeDate from "../../Types/Date";
import { WhoIsToldResult } from "../../Types/Monitor/WhoIsTold";
import { MonitorTypeHelper } from "../../Types/Monitor/MonitorType";
import ObjectID from "../../Types/ObjectID";
import ScheduleShiftUtil, {
  OnCallShift,
  ScheduleCoverageState,
  ScheduleCoverageStatus,
} from "../../Types/OnCallDutyPolicy/ScheduleShiftUtil";
import RecommendationType from "../../Types/Recommendation/RecommendationType";
import {
  ServerChannelStatus,
  ServerSendingChannel,
} from "../../Types/ServerSending/ServerSendingStatus";
import {
  SCHEDULE_GAP_LOOKAHEAD_IN_DAYS,
  SETUP_HEALTH_CACHE_TTL_IN_MS,
  SetupHealthAnswer,
  SetupHealthBalanceFact,
  SetupHealthDismissal,
  SetupHealthDomainFact,
  SetupHealthFacts,
  SetupHealthFinding,
  SetupHealthMonitorFact,
  SetupHealthOwnersFact,
  SetupHealthReadable,
  SetupHealthRecordKind,
  SetupHealthResponderFact,
  SetupHealthResponderReason,
  SetupHealthScheduleFact,
  SetupHealthScheduleReason,
  SetupHealthStatusPageFact,
  SetupHealthSummary,
  SetupHealthWorkspaceFact,
  applySetupHealthDismissals,
  getSetupHealthCounts,
  getSetupHealthFindings,
  getSetupHealthRecordIds,
  redactSetupHealthFindings,
} from "../../Types/SetupHealth/SetupHealth";
import WorkspaceType, {
  getWorkspaceTypeDisplayName,
} from "../../Types/Workspace/WorkspaceType";

/*
 * SETUP HEALTH (Types/SetupHealth/SetupHealth, #6812): the facts, read once
 * per project, and each person's view of the findings.
 *
 * What it reads does not grow with the number of monitors. The monitors
 * are read in pages; their chains come from WhoIsToldService.resolveProject,
 * which reads the rules, the channels and each policy and person once; the
 * responders come from one Readiness summary; and every other check is one
 * read of its kind for the whole project - the policies, the rules that run
 * them, the schedules they page (resolved in one batch), the status pages,
 * their resources and domains, the owners and members, the chat workspaces
 * and their rules, the activation milestones. A project of a thousand
 * monitors costs what a project of ten does, plus a read of the monitors
 * per thousand (SetupHealthService.test measures it).
 *
 * The findings are kept a minute per project, as Readiness and "When this
 * goes down" keep theirs, and two asks at once share one computation. Each
 * person is then handed the findings about records they may read, with the
 * project's dismissals (RecommendationDismissal, RecommendationType.
 * SetupHealth) applied - read on every ask, so a dismissal or a Restore
 * shows at once, for everyone.
 */

// What is kept a minute per project.
interface ProjectFindings {
  findings: Array<SetupHealthFinding>;
  monitorCount: number;
  checkedAt: string;
}

// How many monitors one read takes.
export const SETUP_HEALTH_MONITOR_PAGE_SIZE: number = 1000;

// The activation milestones that say telemetry arrives (#6830).
export const TELEMETRY_MILESTONES: ReadonlyArray<ActivationMilestone> = [
  ActivationMilestone.FirstLogsReceived,
  ActivationMilestone.FirstTracesReceived,
  ActivationMilestone.FirstMetricsReceived,
  ActivationMilestone.FirstExceptionsReceived,
  ActivationMilestone.FirstProfilesReceived,
];

// An id held as an ObjectID or as text, as text; "" for an empty one.
function idText(id: ObjectID | string | null | undefined): string {
  return id ? id.toString().trim() : "";
}

function isoOf(date: Date | string | null | undefined): string | null {
  if (!date) {
    return null;
  }

  const value: Date = date instanceof Date ? date : new Date(date);

  return Number.isNaN(value.getTime()) ? null : value.toISOString();
}

/*
 * Why nobody is on call in a schedule, from its coverage
 * (ScheduleShiftUtil.getCoverageState) over the days ahead, or null when
 * somebody always is. A gap is said only when the engine read every shift
 * of the window: a truncated expansion would show gaps that are not there.
 */
export function getScheduleReason(data: {
  coverage: ScheduleCoverageState;
  isTruncated: boolean;
}): { reason: SetupHealthScheduleReason | null; gapStartsAt: string | null } {
  switch (data.coverage.status) {
    case ScheduleCoverageStatus.NoLayers:
      return {
        reason: SetupHealthScheduleReason.NoRotations,
        gapStartsAt: null,
      };
    case ScheduleCoverageStatus.NoUsers:
      return {
        reason: SetupHealthScheduleReason.NobodyInRotations,
        gapStartsAt: null,
      };
    case ScheduleCoverageStatus.UncoveredNow:
      return { reason: SetupHealthScheduleReason.NobodyNow, gapStartsAt: null };
    case ScheduleCoverageStatus.Covered: {
      const gap: { start: Date } | undefined = data.coverage.gaps[0];

      if (!gap || data.isTruncated) {
        return { reason: null, gapStartsAt: null };
      }

      return {
        reason: SetupHealthScheduleReason.GapAhead,
        gapStartsAt: isoOf(gap.start),
      };
    }
  }
}

// A responder as Readiness sees them, as a fact.
export function toResponderFact(user: UserReadiness): SetupHealthResponderFact {
  const firstReason: string = user.reasons[0] || "";

  let reason: SetupHealthResponderReason =
    SetupHealthResponderReason.NoVerifiedMethod;

  if (firstReason === NOT_A_PROJECT_MEMBER_READINESS_REASONS[0]) {
    reason = SetupHealthResponderReason.NotAMember;
  } else if (firstReason === INVITATION_NOT_ACCEPTED_READINESS_REASONS[0]) {
    reason = SetupHealthResponderReason.InvitationNotAccepted;
  }

  return {
    userId: idText(user.userId),
    name: user.userName || user.userEmail || "",
    isNotReachable: user.status === ReadinessStatus.NotReachable,
    reason: reason,
  };
}

export default class SetupHealthService {
  private static cache: InMemoryTTLCache<ProjectFindings> =
    new InMemoryTTLCache<ProjectFindings>(10_000);

  // The computations under way, so two asks at once share one.
  private static inFlight: Map<string, Promise<ProjectFindings>> = new Map<
    string,
    Promise<ProjectFindings>
  >();

  public static clearCache(): void {
    this.cache.clear();
    this.inFlight.clear();
  }

  /*
   * THE ANSWER FOR ONE PERSON: the findings about records they may read,
   * with the dismissed ones set apart.
   */
  @CaptureSpan()
  public static async getForCaller(data: {
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
    // Work it out again now, rather than hand the minute-old answer.
    refresh?: boolean | undefined;
  }): Promise<SetupHealthAnswer> {
    const computed: ProjectFindings = await this.getProjectFindings({
      projectId: data.projectId,
      refresh: data.refresh,
    });

    const readable: SetupHealthReadable = await this.readReadable({
      projectId: data.projectId,
      props: data.props,
      findings: computed.findings,
    });

    const visible: Array<SetupHealthFinding> = redactSetupHealthFindings(
      computed.findings,
      readable,
    );

    const split: ReturnType<typeof applySetupHealthDismissals> =
      applySetupHealthDismissals(
        visible,
        await this.readDismissals(data.projectId),
      );

    return {
      findings: split.findings,
      dismissed: split.dismissed,
      counts: getSetupHealthCounts(split.findings),
      monitorCount: computed.monitorCount,
      checkedAt: computed.checkedAt,
    };
  }

  // What Home asks for: the counts, as the person's answer has them.
  @CaptureSpan()
  public static async getSummaryForCaller(data: {
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<SetupHealthSummary> {
    const answer: SetupHealthAnswer = await this.getForCaller({
      projectId: data.projectId,
      props: data.props,
    });

    return { counts: answer.counts, checkedAt: answer.checkedAt };
  }

  /*
   * THE PROJECT'S FINDINGS, as OneUptime reads them, kept a minute.
   * `refresh` works them out again now.
   */
  @CaptureSpan()
  public static async getProjectFindings(data: {
    projectId: ObjectID;
    refresh?: boolean | undefined;
  }): Promise<ProjectFindings> {
    const key: string = data.projectId.toString();

    if (!data.refresh) {
      const cached: ProjectFindings | undefined = this.cache.get(key);

      if (cached) {
        return cached;
      }

      const running: Promise<ProjectFindings> | undefined =
        this.inFlight.get(key);

      if (running) {
        return await running;
      }
    }

    const computing: Promise<ProjectFindings> = this.compute(data.projectId);

    this.inFlight.set(key, computing);

    try {
      const computed: ProjectFindings = await computing;

      this.cache.set(key, computed, SETUP_HEALTH_CACHE_TTL_IN_MS);

      return computed;
    } finally {
      if (this.inFlight.get(key) === computing) {
        this.inFlight.delete(key);
      }
    }
  }

  private static async compute(projectId: ObjectID): Promise<ProjectFindings> {
    /*
     * A sample project (issue #6808) has no findings. It reaches nobody by
     * design - nothing is ever sent from it, and its people are made up -
     * so every finding about reaching someone would be true and could not
     * be fixed, and teach the wrong lesson.
     */
    if (await ProjectService.isSampleProject(projectId)) {
      return {
        findings: [],
        monitorCount: 0,
        checkedAt: OneUptimeDate.getCurrentDate().toISOString(),
      };
    }

    const facts: SetupHealthFacts = await this.readFacts(projectId);

    return {
      findings: getSetupHealthFindings(facts),
      monitorCount: facts.chains.length,
      checkedAt: facts.now,
    };
  }

  /*
   * EVERYTHING THE RULES READ, once. A part that cannot be read is left
   * empty and logged: one failing read takes its own checks away, never
   * the whole list.
   */
  @CaptureSpan()
  public static async readFacts(
    projectId: ObjectID,
  ): Promise<SetupHealthFacts> {
    const now: Date = OneUptimeDate.getCurrentDate();

    const monitors: Array<Monitor> = await this.readMonitors(projectId);
    const policies: Array<OnCallDutyPolicy> =
      await this.readPolicies(projectId);

    const readiness: ReadinessSummary | null = await this.attempt(
      "on-call readiness",
      async (): Promise<ReadinessSummary> => {
        return await OnCallReadinessService.getReadinessForProject(projectId);
      },
      null,
    );

    const chainMonitors: Array<Monitor> = monitors.filter(
      (monitor: Monitor): boolean => {
        return (
          !monitor.disableActiveMonitoring &&
          (!monitor.monitorType ||
            MonitorTypeHelper.doesMonitorTypeHaveCriteria(monitor.monitorType))
        );
      },
    );

    const chains: Array<WhoIsToldResult> = await this.attempt(
      "the monitors' chains",
      async (): Promise<Array<WhoIsToldResult>> => {
        return await WhoIsToldService.resolveProject({
          projectId: projectId,
          monitors: chainMonitors,
          readiness: readiness?.users,
        });
      },
      [],
    );

    const project: Project | null = await this.attempt(
      "the project",
      async (): Promise<Project | null> => {
        return await ProjectService.findOneById({
          id: projectId,
          select: {
            smsOrCallCurrentBalanceInUSDCents: true,
            enableAutoRechargeSmsOrCallBalance: true,
            autoRechargeSmsOrCallWhenCurrentBalanceFallsInUSD: true,
          },
          props: { isRoot: true },
        });
      },
      null,
    );

    return {
      projectId: projectId.toString(),
      now: now.toISOString(),
      chains: chains,
      channels: chains[0]?.channels || null,
      policies: policies.map(
        (policy: OnCallDutyPolicy): { id: string; name: string } => {
          return {
            id: idText(policy.id),
            name: policy.name?.toString() || "",
          };
        },
      ),
      policyIdsRunByRules: await this.attempt(
        "the on-call rules",
        async (): Promise<Array<string>> => {
          return await this.readPolicyIdsRunByRules(projectId);
        },
        // Unknown: no policy is said to be run by nothing.
        policies.map((policy: OnCallDutyPolicy): string => {
          return idText(policy.id);
        }),
      ),
      responders: (readiness?.users || []).map(toResponderFact),
      schedules: await this.attempt(
        "the on-call schedules",
        async (): Promise<Array<SetupHealthScheduleFact>> => {
          return await this.readSchedules({
            projectId: projectId,
            policyIds: policies.map((policy: OnCallDutyPolicy): string => {
              return idText(policy.id);
            }),
            now: now,
          });
        },
        [],
      ),
      balance: this.toBalanceFact(project),
      serverCanSendEmail: await this.readServerCanSendEmail(),
      monitors: monitors.map((monitor: Monitor): SetupHealthMonitorFact => {
        return this.toMonitorFact(monitor);
      }),
      statusPages: await this.attempt(
        "the status pages",
        async (): Promise<Array<SetupHealthStatusPageFact>> => {
          return await this.readStatusPages(projectId);
        },
        [],
      ),
      statusPageDomains: await this.attempt(
        "the status page domains",
        async (): Promise<Array<SetupHealthDomainFact>> => {
          return await this.readStatusPageDomains(projectId);
        },
        [],
      ),
      owners: await this.attempt(
        "the owners",
        async (): Promise<SetupHealthOwnersFact> => {
          return await this.readOwners(projectId);
        },
        null,
      ),
      workspaces: await this.attempt(
        "the chat workspaces",
        async (): Promise<Array<SetupHealthWorkspaceFact>> => {
          return await this.readWorkspaces(projectId);
        },
        [],
      ),
      telemetry: await this.attempt(
        "the activation milestones",
        async (): Promise<{ receivesTelemetry: boolean }> => {
          const reached: Array<{ milestone: ActivationMilestone }> =
            await ProjectMilestoneService.getReachedMilestones(projectId);

          return {
            receivesTelemetry: reached.some(
              (item: { milestone: ActivationMilestone }): boolean => {
                return TELEMETRY_MILESTONES.includes(item.milestone);
              },
            ),
          };
        },
        null,
      ),
    };
  }

  // A read of one part of the facts, which a failure empties, never ends.
  private static async attempt<T>(
    what: string,
    read: () => Promise<T>,
    fallback: T,
  ): Promise<T> {
    try {
      return await read();
    } catch (err) {
      logger.error(
        `Setup health could not read ${what}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return fallback;
    }
  }

  // Every monitor of the project that is not archived, a page at a time.
  private static async readMonitors(
    projectId: ObjectID,
  ): Promise<Array<Monitor>> {
    const monitors: Array<Monitor> = [];

    for (let skip: number = 0; ; skip += SETUP_HEALTH_MONITOR_PAGE_SIZE) {
      const page: Array<Monitor> = await MonitorService.findBy({
        query: { projectId: projectId },
        select: {
          ...WHO_IS_TOLD_MONITOR_SELECT,
          monitorType: true,
          disableActiveMonitoring: true,
          isArchived: true,
          updatedAt: true,
          isNoProbeEnabledOnThisMonitor: true,
          isAllProbesDisconnectedFromThisMonitor: true,
        },
        sort: { createdAt: SortOrder.Ascending },
        skip: skip,
        limit: SETUP_HEALTH_MONITOR_PAGE_SIZE,
        props: { isRoot: true },
      });

      for (const monitor of page) {
        if (!monitor.isArchived) {
          monitors.push(monitor);
        }
      }

      if (page.length < SETUP_HEALTH_MONITOR_PAGE_SIZE) {
        return monitors;
      }
    }
  }

  private static toMonitorFact(monitor: Monitor): SetupHealthMonitorFact {
    return {
      id: idText(monitor.id),
      name: monitor.name?.toString() || "",
      isCheckedByProbes: monitor.monitorType
        ? MonitorTypeHelper.isProbableMonitor(monitor.monitorType)
        : false,
      isTurnedOff: Boolean(monitor.disableActiveMonitoring),
      updatedAt: isoOf(monitor.updatedAt),
      hasNoProbeOn: Boolean(monitor.isNoProbeEnabledOnThisMonitor),
      areAllProbesDisconnected: Boolean(
        monitor.isAllProbesDisconnectedFromThisMonitor,
      ),
      isTelemetryMonitor: monitor.monitorType
        ? MonitorTypeHelper.isTelemetryMonitor(monitor.monitorType)
        : false,
    };
  }

  // The project's on-call policies that are not archived.
  private static async readPolicies(
    projectId: ObjectID,
  ): Promise<Array<OnCallDutyPolicy>> {
    const policies: Array<OnCallDutyPolicy> =
      await OnCallDutyPolicyService.findBy({
        query: { projectId: projectId },
        select: { _id: true, name: true, isArchived: true },
        sort: { name: SortOrder.Ascending },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        props: { isRoot: true },
      });

    return policies.filter((policy: OnCallDutyPolicy): boolean => {
      return !policy.isArchived && Boolean(idText(policy.id));
    });
  }

  /*
   * The policies an enabled on-call rule of any kind runs: incidents',
   * alerts', and their episodes'.
   */
  public static async readPolicyIdsRunByRules(
    projectId: ObjectID,
  ): Promise<Array<string>> {
    const query: { projectId: ObjectID; isEnabled: boolean } = {
      projectId: projectId,
      isEnabled: true,
    };
    const select: { _id: true; onCallDutyPolicies: { _id: true } } = {
      _id: true,
      onCallDutyPolicies: { _id: true },
    };

    const [
      incidentRules,
      alertRules,
      incidentEpisodeRules,
      alertEpisodeRules,
    ]: [
      Array<IncidentOnCallRule>,
      Array<AlertOnCallRule>,
      Array<IncidentEpisodeOnCallRule>,
      Array<AlertEpisodeOnCallRule>,
    ] = await Promise.all([
      IncidentOnCallRuleService.findBy({
        query: query,
        select: select,
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        props: { isRoot: true },
      }),
      AlertOnCallRuleService.findBy({
        query: query,
        select: select,
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        props: { isRoot: true },
      }),
      IncidentEpisodeOnCallRuleService.findBy({
        query: query,
        select: select,
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        props: { isRoot: true },
      }),
      AlertEpisodeOnCallRuleService.findBy({
        query: query,
        select: select,
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        props: { isRoot: true },
      }),
    ]);

    const policyIds: Set<string> = new Set<string>();

    for (const rule of [
      ...incidentRules,
      ...alertRules,
      ...incidentEpisodeRules,
      ...alertEpisodeRules,
    ] as Array<{ onCallDutyPolicies?: Array<OnCallDutyPolicy> }>) {
      for (const policy of rule.onCallDutyPolicies || []) {
        const id: string = idText(policy?.id);

        if (id) {
          policyIds.add(id);
        }
      }
    }

    return Array.from(policyIds);
  }

  /*
   * The schedules the policies' escalation rules page, and who is on call
   * in each over the days ahead - resolved in one batch, as the calendar
   * feeds and the shift reminders resolve them.
   */
  private static async readSchedules(data: {
    projectId: ObjectID;
    policyIds: Array<string>;
    now: Date;
  }): Promise<Array<SetupHealthScheduleFact>> {
    const rows: Array<OnCallDutyPolicyEscalationRuleSchedule> =
      await OnCallDutyPolicyEscalationRuleScheduleService.findBy({
        query: { projectId: data.projectId },
        select: {
          onCallDutyPolicyId: true,
          onCallDutyPolicyScheduleId: true,
          onCallDutyPolicySchedule: { name: true },
        },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        props: { isRoot: true },
      });

    const policyIds: Set<string> = new Set<string>(data.policyIds);
    const names: Map<string, string> = new Map<string, string>();

    for (const row of rows) {
      const scheduleId: string = idText(row.onCallDutyPolicyScheduleId);

      // A schedule only an archived policy pages pages nobody.
      if (!scheduleId || !policyIds.has(idText(row.onCallDutyPolicyId))) {
        continue;
      }

      names.set(
        scheduleId,
        row.onCallDutyPolicySchedule?.name?.toString() || "",
      );
    }

    if (names.size === 0) {
      return [];
    }

    const windowEnd: Date = OneUptimeDate.addRemoveDays(
      data.now,
      SCHEDULE_GAP_LOOKAHEAD_IN_DAYS,
    );

    const resolved: Array<ResolvedShiftSegments> =
      await OnCallDutyPolicyScheduleService.getResolvedShiftSegmentsForSchedules(
        {
          scheduleIds: Array.from(names.keys()).map((id: string): ObjectID => {
            return new ObjectID(id);
          }),
          windowStart: data.now,
          windowEnd: windowEnd,
        },
      );

    return resolved.map(
      (schedule: ResolvedShiftSegments): SetupHealthScheduleFact => {
        const shifts: Array<OnCallShift> =
          ScheduleShiftUtil.groupEventsIntoShifts(schedule.segments);

        const coverage: ScheduleCoverageState =
          ScheduleShiftUtil.getCoverageState({
            layerCount: schedule.layerProps.length,
            assignedUserCount: schedule.scheduleUserIds.length,
            shifts: shifts,
            now: data.now,
            windowEnd: windowEnd,
          });

        const why: {
          reason: SetupHealthScheduleReason | null;
          gapStartsAt: string | null;
        } = getScheduleReason({
          coverage: coverage,
          isTruncated: schedule.truncated,
        });

        return {
          id: schedule.schedule.id,
          name: names.get(schedule.schedule.id) || schedule.schedule.name,
          reason: why.reason,
          gapStartsAt: why.gapStartsAt,
        };
      },
    );
  }

  /*
   * OneUptime Cloud: the balance SMS and calls are paid from, and the
   * project's own threshold for a low one (its auto-recharge threshold,
   * $10 unless changed).
   */
  private static toBalanceFact(
    project: Project | null,
  ): SetupHealthBalanceFact | null {
    if (!IsBillingEnabled || !project) {
      return null;
    }

    return {
      balanceInUSDCents: project.smsOrCallCurrentBalanceInUSDCents || 0,
      isAutoRechargeOn: Boolean(project.enableAutoRechargeSmsOrCallBalance),
      lowBalanceInUSDCents:
        (project.autoRechargeSmsOrCallWhenCurrentBalanceFallsInUSD || 10) * 100,
    };
  }

  // Self-hosted: whether the server can send email (ServerSendingStatus).
  private static async readServerCanSendEmail(): Promise<boolean | null> {
    if (IsBillingEnabled) {
      return null;
    }

    try {
      const statuses: Array<ServerChannelStatus> =
        await ServerSendingStatus.getStatuses();

      return canServerSendBy(statuses, ServerSendingChannel.Email);
    } catch (err) {
      logger.debug(
        `Setup health could not read what the server can send: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return null;
    }
  }

  // The status pages that are not archived, and how much each shows.
  private static async readStatusPages(
    projectId: ObjectID,
  ): Promise<Array<SetupHealthStatusPageFact>> {
    const pages: Array<StatusPage> = await StatusPageService.findBy({
      query: { projectId: projectId },
      select: { _id: true, name: true, isArchived: true },
      skip: 0,
      limit: LIMIT_PER_PROJECT,
      props: { isRoot: true },
    });

    const live: Array<StatusPage> = pages.filter(
      (page: StatusPage): boolean => {
        return !page.isArchived && Boolean(idText(page.id));
      },
    );

    if (live.length === 0) {
      return [];
    }

    const resources: Array<StatusPageResource> =
      await StatusPageResourceService.findBy({
        query: { projectId: projectId },
        select: { statusPageId: true },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        props: { isRoot: true },
      });

    const counts: Map<string, number> = new Map<string, number>();

    for (const resource of resources) {
      const id: string = idText(resource.statusPageId);
      counts.set(id, (counts.get(id) || 0) + 1);
    }

    return live.map((page: StatusPage): SetupHealthStatusPageFact => {
      return {
        id: idText(page.id),
        name: page.name?.toString() || "",
        resourceCount: counts.get(idText(page.id)) || 0,
      };
    });
  }

  private static async readStatusPageDomains(
    projectId: ObjectID,
  ): Promise<Array<SetupHealthDomainFact>> {
    const domains: Array<StatusPageDomain> =
      await StatusPageDomainService.findBy({
        query: { projectId: projectId },
        select: {
          _id: true,
          fullDomain: true,
          statusPageId: true,
          statusPage: { name: true },
          isCnameVerified: true,
          createdAt: true,
        },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        props: { isRoot: true },
      });

    return domains
      .filter((domain: StatusPageDomain): boolean => {
        return (
          Boolean(idText(domain.id)) && Boolean(idText(domain.statusPageId))
        );
      })
      .map((domain: StatusPageDomain): SetupHealthDomainFact => {
        return {
          id: idText(domain.id),
          fullDomain: domain.fullDomain?.toString() || "",
          statusPageId: idText(domain.statusPageId),
          statusPageName: domain.statusPage?.name?.toString() || "",
          isCnameVerified: Boolean(domain.isCnameVerified),
          createdAt: isoOf(domain.createdAt),
        };
      });
  }

  // How many owners the project has, and how many members who accepted.
  private static async readOwners(
    projectId: ObjectID,
  ): Promise<SetupHealthOwnersFact> {
    const owners: Array<User> = await ProjectService.getOwners(projectId);

    const memberships: Array<TeamMember> = await TeamMemberService.findBy({
      query: { projectId: projectId, hasAcceptedInvitation: true },
      select: { userId: true },
      skip: 0,
      limit: LIMIT_PER_PROJECT,
      props: { isRoot: true },
    });

    const members: Set<string> = new Set<string>();

    for (const membership of memberships) {
      const id: string = idText(membership.userId);

      if (id) {
        members.add(id);
      }
    }

    return {
      ownerCount: owners.length,
      memberCount: members.size,
    };
  }

  // The chat workspaces the project connected, and the rules that post to each.
  private static async readWorkspaces(
    projectId: ObjectID,
  ): Promise<Array<SetupHealthWorkspaceFact>> {
    const tokens: Array<WorkspaceProjectAuthToken> =
      await WorkspaceProjectAuthTokenService.findBy({
        query: { projectId: projectId },
        select: { workspaceType: true },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        props: { isRoot: true },
      });

    const connected: Array<WorkspaceType> = [];

    for (const token of tokens) {
      if (token.workspaceType && !connected.includes(token.workspaceType)) {
        connected.push(token.workspaceType);
      }
    }

    if (connected.length === 0) {
      return [];
    }

    const rules: Array<WorkspaceNotificationRule> =
      await WorkspaceNotificationRuleService.findBy({
        query: { projectId: projectId },
        select: { workspaceType: true },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        props: { isRoot: true },
      });

    return connected.map(
      (workspaceType: WorkspaceType): SetupHealthWorkspaceFact => {
        return {
          workspaceType: workspaceType,
          workspaceName: getWorkspaceTypeDisplayName(workspaceType),
          ruleCount: rules.filter(
            (rule: WorkspaceNotificationRule): boolean => {
              return rule.workspaceType === workspaceType;
            },
          ).length,
        };
      },
    );
  }

  // The project's dismissals of setup health findings.
  public static async readDismissals(
    projectId: ObjectID,
  ): Promise<Array<SetupHealthDismissal>> {
    const rows: Array<RecommendationDismissal> =
      await RecommendationDismissalService.findBy({
        query: {
          projectId: projectId,
          recommendationType: RecommendationType.SetupHealth,
        },
        select: {
          _id: true,
          recommendationId: true,
          resourceType: true,
          resourceId: true,
          dismissalReason: true,
          createdAt: true,
          createdByUser: { name: true, email: true },
        },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        props: { isRoot: true },
      });

    return rows.map((row: RecommendationDismissal): SetupHealthDismissal => {
      const by: User | undefined = row.createdByUser;

      return {
        id: idText(row.id),
        recommendationId: row.recommendationId || "",
        resourceType: row.resourceType || "",
        resourceId: idText(row.resourceId),
        reason: row.dismissalReason || "",
        dismissedByName: by?.name?.toString() || by?.email?.toString() || "",
        dismissedAt: isoOf(row.createdAt),
      };
    });
  }

  /*
   * WHAT ONE PERSON MAY READ of the records the findings name, asked as
   * they would list them. Somebody who may read none of a kind is refused
   * by the read: that is none readable.
   */
  private static async readReadable(data: {
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
    findings: Array<SetupHealthFinding>;
  }): Promise<SetupHealthReadable> {
    const readIds: (
      kind: SetupHealthRecordKind,
      read: (ids: Array<ObjectID>) => Promise<Array<{ id?: ObjectID | null }>>,
    ) => Promise<Set<string>> = async (
      kind: SetupHealthRecordKind,
      read: (ids: Array<ObjectID>) => Promise<Array<{ id?: ObjectID | null }>>,
    ): Promise<Set<string>> => {
      const ids: Array<string> = getSetupHealthRecordIds(data.findings, kind);

      if (ids.length === 0) {
        return new Set<string>();
      }

      try {
        const rows: Array<{ id?: ObjectID | null }> = await read(
          ids.map((id: string): ObjectID => {
            return new ObjectID(id);
          }),
        );

        return new Set<string>(
          rows
            .map((row: { id?: ObjectID | null }): string => {
              return idText(row.id);
            })
            .filter((id: string): boolean => {
              return Boolean(id);
            }),
        );
      } catch (err) {
        logger.debug(
          `Setup health: the caller may not read some ${kind} records: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        return new Set<string>();
      }
    };

    const idsQuery: (ids: Array<ObjectID>) => {
      _id: ReturnType<typeof QueryHelper.any>;
      projectId: ObjectID;
    } = (
      ids: Array<ObjectID>,
    ): { _id: ReturnType<typeof QueryHelper.any>; projectId: ObjectID } => {
      return { _id: QueryHelper.any(ids), projectId: data.projectId };
    };

    return {
      monitorIds: await readIds(
        SetupHealthRecordKind.Monitor,
        async (ids: Array<ObjectID>): Promise<Array<Monitor>> => {
          return await MonitorService.findBy({
            query: idsQuery(ids),
            select: { _id: true },
            skip: 0,
            limit: LIMIT_PER_PROJECT,
            props: data.props,
          });
        },
      ),
      policyIds: await readIds(
        SetupHealthRecordKind.OnCallDutyPolicy,
        async (ids: Array<ObjectID>): Promise<Array<OnCallDutyPolicy>> => {
          return await OnCallDutyPolicyService.findBy({
            query: idsQuery(ids),
            select: { _id: true },
            skip: 0,
            limit: LIMIT_PER_PROJECT,
            props: data.props,
          });
        },
      ),
      scheduleIds: await readIds(
        SetupHealthRecordKind.OnCallDutyPolicySchedule,
        async (
          ids: Array<ObjectID>,
        ): Promise<Array<OnCallDutyPolicySchedule>> => {
          return await OnCallDutyPolicyScheduleService.findBy({
            query: idsQuery(ids),
            select: { _id: true },
            skip: 0,
            limit: LIMIT_PER_PROJECT,
            props: data.props,
          });
        },
      ),
      statusPageIds: await readIds(
        SetupHealthRecordKind.StatusPage,
        async (ids: Array<ObjectID>): Promise<Array<StatusPage>> => {
          return await StatusPageService.findBy({
            query: idsQuery(ids),
            select: { _id: true },
            skip: 0,
            limit: LIMIT_PER_PROJECT,
            props: data.props,
          });
        },
      ),
      canReadResponders: await this.canReadPolicies(data),
    };
  }

  /*
   * Whether the caller may read the project's on-call policies, as the
   * Readiness page asks: who a policy pages is told only to them.
   */
  private static async canReadPolicies(data: {
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<boolean> {
    try {
      await OnCallDutyPolicyService.findBy({
        query: { projectId: data.projectId },
        select: { _id: true },
        skip: 0,
        limit: 1,
        props: data.props,
      });

      return true;
    } catch {
      return false;
    }
  }
}
