import Alert from "../../Models/DatabaseModels/Alert";
import AutoRemediationRule from "../../Models/DatabaseModels/AutoRemediationRule";
import AutoRemediationSuggestion from "../../Models/DatabaseModels/AutoRemediationSuggestion";
import Incident from "../../Models/DatabaseModels/Incident";
import Label from "../../Models/DatabaseModels/Label";
import Monitor from "../../Models/DatabaseModels/Monitor";
import Project from "../../Models/DatabaseModels/Project";
import Runbook from "../../Models/DatabaseModels/Runbook";
import RunbookExecution from "../../Models/DatabaseModels/RunbookExecution";
import RunnerJob from "../../Models/DatabaseModels/RunnerJob";
import { AlertFeedEventType } from "../../Models/DatabaseModels/AlertFeed";
import { IncidentFeedEventType } from "../../Models/DatabaseModels/IncidentFeed";
import AlertSeverity from "../../Models/DatabaseModels/AlertSeverity";
import IncidentSeverity from "../../Models/DatabaseModels/IncidentSeverity";
import AIRunType from "../../Types/AI/AIRunType";
import AutoRemediationExecutionMode from "../../Types/AutoRemediation/AutoRemediationExecutionMode";
import AutoRemediationSuggestionStatus from "../../Types/AutoRemediation/AutoRemediationSuggestionStatus";
import AutoRemediationSuggestionType from "../../Types/AutoRemediation/AutoRemediationSuggestionType";
import AutoRemediationVerificationStatus from "../../Types/AutoRemediation/AutoRemediationVerificationStatus";
import AutoRemediationTriggerEntity from "../../Types/AutoRemediation/AutoRemediationTriggerEntity";
import {
  APPROVED_COMMAND_STEP_ID_PREFIX,
  INLINE_COMMAND_STEP_ID_PREFIX,
  KUBECTL_ALWAYS_ASKS_SUMMARY,
  KUBECTL_SAFE_CHANGES_SUMMARY,
} from "../../Types/AutoRemediation/AiRemediationCommandPlan";
import {
  KubernetesAiRemediationMode,
  KubernetesClusterAiAccessStatus,
} from "../../Types/Kubernetes/KubernetesClusterAiAccess";
import RunnerJobOrigin from "../../Types/Runbook/RunnerJobOrigin";
import { Indigo500 } from "../../Types/BrandColors";
import OneUptimeDate from "../../Types/Date";
import ObjectID from "../../Types/ObjectID";
import QueryHelper from "../Types/Database/QueryHelper";
import AlertService from "./AlertService";
import IncidentService from "./IncidentService";
import AlertFeedService from "./AlertFeedService";
import AutoRemediationRuleService from "./AutoRemediationRuleService";
import AutoRemediationSuggestionService from "./AutoRemediationSuggestionService";
import IncidentFeedService from "./IncidentFeedService";
import KubernetesClusterAiAccessService from "./KubernetesClusterAiAccessService";
import LlmProviderService from "./LlmProviderService";
import ProjectService from "./ProjectService";
import RunbookRuleEngineService from "./RunbookRuleEngineService";
import RunnerJobService from "./RunnerJobService";
import AIInvestigationQueue from "../Utils/AI/SRE/InvestigationQueue";
import Semaphore, { SemaphoreMutex } from "../Infrastructure/Semaphore";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import logger, { LogAttributes } from "../Utils/Logger";
import { MAX_RULES_EVALUATED_PER_PROJECT } from "../../Utils/Rules/RuleEngineLimits";
import logIfRuleReadWasTruncated from "../Utils/Rules/RuleEngineRuleRead";
import RuleCriteriaMatcher from "../../Utils/Rules/RuleCriteriaMatcher";
import MonitorRuleCriteriaCache from "../Utils/Rules/MonitorRuleCriteriaCache";

/*
 * Guardrails (minimal G1 for auto-remediation Phase 1):
 * - At most this many suggestions per incident/alert, ever. Stops rule
 *   fan-out and repeated matching from flooding a subject with proposals.
 */
export const MAX_SUGGESTIONS_PER_SUBJECT: number = 3;

/*
 * - A FullAuto rule that has auto-executed this many times in the last hour
 *   is downgraded to Suggest for the next match (remediation-storm circuit
 *   breaker). A human gets pulled back into the loop instead of a runbook
 *   being started in a tight flap loop.
 */
export const MAX_AUTO_EXECUTIONS_PER_RULE_PER_HOUR: number = 3;

/*
 * How long the subject's monitors get to recover after a remediation
 * runbook starts, when the rule does not set its own window. The verifier
 * fails the remediation past this deadline — escalation continues as
 * normal either way.
 */
export const DEFAULT_VERIFICATION_WINDOW_MINUTES: number = 15;

/*
 * - Cluster-level remediation (a cluster's AI page, no rule) may try at most
 *   this many rounds per subject per cluster: the first plan, then one
 *   follow-up when verification fails ("ask again for a new set of
 *   commands"). Beyond that a human takes over.
 */
export const MAX_CLUSTER_REMEDIATION_ROUNDS_PER_SUBJECT: number = 2;

/*
 * Upper bound on the rows the per-cluster circuit breaker and the in-flight
 * round check read for one cluster. The project-wide hourly AI-command cap
 * keeps the real numbers far below this; the bound only stops a runaway
 * read.
 */
const MAX_CLUSTER_ROUND_ROWS: number = 100;

/*
 * How long a Planning unattended round is taken to still be running. A run
 * lasts at most ten minutes; the rest is queue slack. A round stuck in
 * Planning longer than this is the stranded-suggestion sweeper's business,
 * not a reason to keep every other round on the cluster asking.
 */
const IN_FLIGHT_ROUND_WINDOW_HOURS: number = 1;

/*
 * A fix whose verification is still Pending holds its cluster until the
 * verifier settles it. The verifier sweeps every minute, so a deadline this
 * far in the past means the verifier is not running — stop holding.
 */
const PENDING_VERIFICATION_HOLD_GRACE_MINUTES: number = 10;

/*
 * Approved plans can be verified long after their round was created (a
 * human approves hours later), so the in-flight round read looks back this
 * far and lets the verification deadline decide.
 */
const HELD_ROUND_LOOKBACK_HOURS: number = 24;

type SubjectLinkage = {
  incidentId?: ObjectID | undefined;
  alertId?: ObjectID | undefined;
};

export interface ClusterBreakerState {
  autoExecutedInWindow: number;
  hasHeadroom: boolean;
}

/*
 * The round (or rule-driven run) a breaker or in-flight check is made for.
 * Its own row never counts against it, and among unattended rounds still
 * running only the ones created BEFORE it do: when several rounds are
 * announced at once, the earliest ones keep their unattended slot and the
 * later ones ask — instead of every round counting every other one and all
 * of them asking.
 */
export interface ClusterRoundReference {
  suggestionId: ObjectID;
  createdAt?: Date | undefined;
}

/*
 * Another cluster-level round that currently holds a cluster: it is still
 * running unattended, or its fix is still inside its verification window.
 * Two unattended agents changing one cluster at once — each with its own
 * verification and rollback — undo each other's fixes, so a second
 * unattended round on a held cluster asks instead.
 */
export interface ClusterRoundHold {
  suggestionId: string;
  ruleNameSnapshot?: string | undefined;
  // Completes "another OneUptime AI round on this cluster ...".
  description: string;
  isSameSubject: boolean;
}

const CLUSTER_ROUND_NAME_PREFIX: string = "AI remediation for cluster";

/*
 * The name a cluster-level round carries. Server-written, and parsed back
 * by parseClusterRoundNameSnapshot: a cluster delete nulls the round's
 * kubernetesClusterId (ON DELETE SET NULL), and this name is then the only
 * thing left that says the round belonged to a cluster rather than a rule.
 */
export function getClusterRoundNameSnapshot(
  clusterName: string,
  round: number,
): string {
  return `${CLUSTER_ROUND_NAME_PREFIX} "${clusterName}"${
    round > 1 ? ` (round ${round})` : ""
  }`;
}

/*
 * The cluster name inside a cluster round's name snapshot, or null when the
 * snapshot is not one. A rule can in principle be NAMED like a cluster
 * round, so callers only trust this on a row that has neither a rule nor a
 * cluster link left, where it is the best evidence there is.
 */
export function parseClusterRoundNameSnapshot(
  name: unknown,
): { clusterName: string } | null {
  if (typeof name !== "string") {
    return null;
  }

  const match: RegExpMatchArray | null = name.match(
    /^AI remediation for cluster "(.*)"(?: \(round \d+\))?$/,
  );

  if (!match) {
    return null;
  }

  return { clusterName: match[1] || "" };
}

// Is `row` ordered before the reference (createdAt, then id as tie-break)?
function isRoundOrderedBefore(
  row: AutoRemediationSuggestion,
  reference: ClusterRoundReference | undefined,
): boolean {
  if (!reference?.createdAt || !row.createdAt) {
    // Order unknown: count it — the breaker's fail direction.
    return true;
  }

  const rowTime: number = new Date(row.createdAt).getTime();
  const referenceTime: number = new Date(reference.createdAt).getTime();

  if (rowTime !== referenceTime) {
    return rowTime < referenceTime;
  }

  return (row.id?.toString() || "") < (reference.suggestionId.toString() || "");
}

function isSameSubject(
  row: AutoRemediationSuggestion,
  subject: SubjectLinkage,
): boolean {
  if (subject.incidentId && row.incidentId) {
    return row.incidentId.toString() === subject.incidentId.toString();
  }
  if (subject.alertId && row.alertId) {
    return row.alertId.toString() === subject.alertId.toString();
  }
  return false;
}

class AutoRemediationRuleEngineServiceClass {
  /*
   * The per-cluster hourly circuit breaker. It counts distinct unattended
   * AI fixes on the cluster in the last hour, three ways, the larger total
   * winning:
   *   - cluster-level rounds already settled AutoExecuted (their suggestion
   *     carries the cluster id);
   *   - distinct AI runs — cluster-level OR rule-driven — that executed at
   *     least one inline `ai-command-*` kubectl job on the cluster (a
   *     rule-driven run's suggestion carries no cluster id; its jobs do);
   *   - unattended cluster rounds still IN FLIGHT: Planning with a FullAuto
   *     snapshot, created before the asking round. A round that is still
   *     diagnosing has written nothing yet, so without this term every
   *     round announced in the same storm would read the same stale count
   *     and all of them would run unattended.
   * The in-flight rounds and the runs with inline jobs are unioned by
   * suggestion id (a running round that already executed shows up in both).
   *
   * The in-flight rows are read FIRST: a round that settles between the
   * reads moves from Planning to AutoExecuted and is caught by the settled
   * read that follows, never missed by both.
   *
   * Throws on a failed read: every caller fails safe to "no headroom".
   */
  @CaptureSpan()
  public async getClusterBreakerState(data: {
    clusterId: string;
    projectId?: ObjectID | undefined;
    forRound?: ClusterRoundReference | undefined;
  }): Promise<ClusterBreakerState> {
    const since: Date = OneUptimeDate.getSomeHoursAgo(1);
    const clusterId: ObjectID = new ObjectID(data.clusterId);
    const selfId: string | undefined = data.forRound?.suggestionId.toString();

    const inFlightRounds: Array<AutoRemediationSuggestion> =
      await AutoRemediationSuggestionService.findBy({
        query: {
          ...(data.projectId ? { projectId: data.projectId } : {}),
          kubernetesClusterId: clusterId,
          suggestionType: AutoRemediationSuggestionType.CommandPlan,
          status: AutoRemediationSuggestionStatus.Planning,
          executionMode: AutoRemediationExecutionMode.FullAuto,
          createdAt: QueryHelper.greaterThan(since),
        },
        select: {
          _id: true,
          createdAt: true,
        },
        limit: MAX_CLUSTER_ROUND_ROWS,
        skip: 0,
        props: { isRoot: true },
      });

    const settledClusterRounds: number = (
      await AutoRemediationSuggestionService.countBy({
        query: {
          kubernetesClusterId: clusterId,
          suggestionType: AutoRemediationSuggestionType.CommandPlan,
          status: AutoRemediationSuggestionStatus.AutoExecuted,
          createdAt: QueryHelper.greaterThan(since),
        },
        props: { isRoot: true },
      })
    ).toNumber();

    const inlineKubectlJobs: Array<RunnerJob> = await RunnerJobService.findBy({
      query: {
        ...(data.projectId ? { projectId: data.projectId } : {}),
        kubernetesClusterId: clusterId,
        origin: RunnerJobOrigin.AiRemediation,
        stepId: QueryHelper.startsWith(INLINE_COMMAND_STEP_ID_PREFIX),
        createdAt: QueryHelper.greaterThan(since),
      },
      select: {
        _id: true,
        autoRemediationSuggestionId: true,
      },
      limit: MAX_CLUSTER_ROUND_ROWS,
      skip: 0,
      props: { isRoot: true },
    });

    const unattendedRuns: Set<string> = new Set<string>();

    for (const job of inlineKubectlJobs) {
      unattendedRuns.add(
        job.autoRemediationSuggestionId?.toString() || job.id?.toString() || "",
      );
    }

    for (const round of inFlightRounds) {
      if (isRoundOrderedBefore(round, data.forRound)) {
        unattendedRuns.add(round.id?.toString() || "");
      }
    }

    // The asking round never counts against itself.
    if (selfId) {
      unattendedRuns.delete(selfId);
    }

    const autoExecutedInWindow: number = Math.max(
      settledClusterRounds,
      unattendedRuns.size,
    );

    return {
      autoExecutedInWindow,
      hasHeadroom: autoExecutedInWindow < MAX_AUTO_EXECUTIONS_PER_RULE_PER_HOUR,
    };
  }

  /*
   * Another AI run that holds this cluster right now, or null.
   *
   * A cluster-level round holds its cluster while it is still running
   * unattended (Planning with a FullAuto snapshot — only rounds created
   * before the asking one, unless `anyOrder`) and while its executed fix is
   * still being verified (AutoExecuted or Approved, verification Pending) —
   * whatever subject it is for: an alert and an incident of one monitor
   * each get their own round on the same cluster. With `subject`, any
   * round of that same signal still composing (Planning, asking or not)
   * holds it too: a rule-driven run must not change a cluster whose own
   * round is working on the very same signal.
   *
   * A rule-driven run carries no cluster id — its kubectl JOBS do. One that
   * already changed the cluster (an inline or approved kubectl job there)
   * holds it the same way: while it is still running (whatever the order:
   * it has already written), and while its fix is still being verified. So
   * "one unattended round per cluster at a time" holds in both directions,
   * not only for a rule run yielding to a cluster round.
   *
   * Throws on a failed read: callers fail safe to "held".
   */
  @CaptureSpan()
  public async findRoundHoldingCluster(data: {
    projectId: ObjectID;
    clusterId: string;
    forRound?: ClusterRoundReference | undefined;
    anyOrder?: boolean | undefined;
    subject?: SubjectLinkage | undefined;
  }): Promise<ClusterRoundHold | null> {
    const rows: Array<AutoRemediationSuggestion> =
      await AutoRemediationSuggestionService.findBy({
        query: {
          projectId: data.projectId,
          kubernetesClusterId: new ObjectID(data.clusterId),
          suggestionType: AutoRemediationSuggestionType.CommandPlan,
          status: QueryHelper.any([
            AutoRemediationSuggestionStatus.Planning,
            AutoRemediationSuggestionStatus.AutoExecuted,
            AutoRemediationSuggestionStatus.Approved,
          ]),
          createdAt: QueryHelper.greaterThan(
            OneUptimeDate.getSomeHoursAgo(HELD_ROUND_LOOKBACK_HOURS),
          ),
        },
        select: {
          _id: true,
          status: true,
          executionMode: true,
          verificationStatus: true,
          verificationDeadlineAt: true,
          incidentId: true,
          alertId: true,
          ruleNameSnapshot: true,
          createdAt: true,
        },
        limit: MAX_CLUSTER_ROUND_ROWS,
        skip: 0,
        props: { isRoot: true },
      });

    const selfId: string | undefined = data.forRound?.suggestionId.toString();

    for (const row of rows) {
      const rowId: string = row.id?.toString() || "";

      if (!rowId || rowId === selfId) {
        continue;
      }

      const hold: ClusterRoundHold | null = this.getHold({
        row,
        rowId,
        hasChangedCluster: false,
        anyOrder: data.anyOrder === true,
        forRound: data.forRound,
        subject: data.subject,
      });

      if (hold) {
        return hold;
      }
    }

    /*
     * Rule-driven runs that changed this cluster: found through their
     * kubectl jobs on it (inline while the run planned, or an approved
     * plan's), never through a cluster id they do not carry.
     */
    const seen: Set<string> = new Set<string>(
      rows.map((row: AutoRemediationSuggestion) => {
        return row.id?.toString() || "";
      }),
    );

    if (selfId) {
      seen.add(selfId);
    }

    const kubectlJobs: Array<RunnerJob> = await RunnerJobService.findBy({
      query: {
        projectId: data.projectId,
        kubernetesClusterId: new ObjectID(data.clusterId),
        origin: RunnerJobOrigin.AiRemediation,
        createdAt: QueryHelper.greaterThan(
          OneUptimeDate.getSomeHoursAgo(HELD_ROUND_LOOKBACK_HOURS),
        ),
      },
      select: {
        _id: true,
        autoRemediationSuggestionId: true,
        stepId: true,
      },
      limit: MAX_CLUSTER_ROUND_ROWS,
      skip: 0,
      props: { isRoot: true },
    });

    const changedBy: Set<string> = new Set<string>();

    for (const job of kubectlJobs) {
      const suggestionId: string =
        job.autoRemediationSuggestionId?.toString() || "";
      const stepId: string = job.stepId || "";

      // A rollback job belongs to a fix whose verification already failed.
      const isForwardChange: boolean =
        stepId.startsWith(INLINE_COMMAND_STEP_ID_PREFIX) ||
        stepId.startsWith(APPROVED_COMMAND_STEP_ID_PREFIX);

      if (suggestionId && isForwardChange && !seen.has(suggestionId)) {
        changedBy.add(suggestionId);
      }
    }

    if (changedBy.size === 0) {
      return null;
    }

    const runs: Array<AutoRemediationSuggestion> =
      await AutoRemediationSuggestionService.findBy({
        query: {
          projectId: data.projectId,
          _id: QueryHelper.any(Array.from(changedBy)),
          suggestionType: AutoRemediationSuggestionType.CommandPlan,
          status: QueryHelper.any([
            AutoRemediationSuggestionStatus.Planning,
            AutoRemediationSuggestionStatus.AutoExecuted,
            AutoRemediationSuggestionStatus.Approved,
          ]),
        },
        select: {
          _id: true,
          status: true,
          executionMode: true,
          verificationStatus: true,
          verificationDeadlineAt: true,
          incidentId: true,
          alertId: true,
          ruleNameSnapshot: true,
          createdAt: true,
        },
        limit: MAX_CLUSTER_ROUND_ROWS,
        skip: 0,
        props: { isRoot: true },
      });

    for (const run of runs) {
      const runId: string = run.id?.toString() || "";

      if (!changedBy.has(runId)) {
        continue;
      }

      const hold: ClusterRoundHold | null = this.getHold({
        row: run,
        rowId: runId,
        hasChangedCluster: true,
        anyOrder: data.anyOrder === true,
        forRound: data.forRound,
        subject: data.subject,
      });

      if (hold) {
        return hold;
      }
    }

    return null;
  }

  /*
   * Whether one other run holds the cluster — see findRoundHoldingCluster.
   * `hasChangedCluster`: the run already has a kubectl job on the cluster,
   * so while it is still running it holds whatever its order or mode.
   */
  private getHold(data: {
    row: AutoRemediationSuggestion;
    rowId: string;
    hasChangedCluster: boolean;
    anyOrder: boolean;
    forRound?: ClusterRoundReference | undefined;
    subject?: SubjectLinkage | undefined;
  }): ClusterRoundHold | null {
    const { row, rowId } = data;
    const now: number = OneUptimeDate.getCurrentDate().getTime();
    const inFlightSince: number = OneUptimeDate.getSomeHoursAgo(
      IN_FLIGHT_ROUND_WINDOW_HOURS,
    ).getTime();

    const sameSubject: boolean = data.subject
      ? isSameSubject(row, data.subject)
      : false;

    if (
      (row.status === AutoRemediationSuggestionStatus.AutoExecuted ||
        row.status === AutoRemediationSuggestionStatus.Approved) &&
      row.verificationStatus === AutoRemediationVerificationStatus.Pending
    ) {
      const deadline: number | null = row.verificationDeadlineAt
        ? new Date(row.verificationDeadlineAt).getTime()
        : null;

      if (
        deadline === null ||
        deadline > now - PENDING_VERIFICATION_HOLD_GRACE_MINUTES * 60 * 1000
      ) {
        return {
          suggestionId: rowId,
          ruleNameSnapshot: row.ruleNameSnapshot,
          description: "applied a fix that is still being verified",
          isSameSubject: sameSubject,
        };
      }
      return null;
    }

    if (row.status !== AutoRemediationSuggestionStatus.Planning) {
      return null;
    }

    const isRecent: boolean = row.createdAt
      ? new Date(row.createdAt).getTime() > inFlightSince
      : true;

    if (!isRecent) {
      return null;
    }

    if (data.hasChangedCluster) {
      return {
        suggestionId: rowId,
        ruleNameSnapshot: row.ruleNameSnapshot,
        description: "is still changing it",
        isSameSubject: sameSubject,
      };
    }

    if (
      row.executionMode === AutoRemediationExecutionMode.FullAuto &&
      (data.anyOrder || isRoundOrderedBefore(row, data.forRound))
    ) {
      return {
        suggestionId: rowId,
        ruleNameSnapshot: row.ruleNameSnapshot,
        description: "is still running unattended",
        isSameSubject: sameSubject,
      };
    }

    if (sameSubject) {
      return {
        suggestionId: rowId,
        ruleNameSnapshot: row.ruleNameSnapshot,
        description: "is still working on this same signal",
        isSameSubject: true,
      };
    }

    return null;
  }

  /*
   * Reload an incident and run the rules against it. Used by the
   * post-investigation remediation hand-off (RemediationHandoff), which
   * holds only the subject id: the create-hook's in-memory model is long
   * gone by the time the investigation settles, and the reload also picks
   * up edits made while the investigation ran. The select mirrors exactly
   * what doesIncidentMatchRule reads — keep the two in sync.
   */
  @CaptureSpan()
  public async applyRulesToIncidentById(data: {
    incidentId: ObjectID;
    projectId: ObjectID;
  }): Promise<void> {
    const incident: Incident | null = await IncidentService.findOneById({
      id: data.incidentId,
      select: {
        _id: true,
        projectId: true,
        title: true,
        description: true,
        incidentSeverityId: true,
        monitors: { _id: true },
        labels: { _id: true },
      },
      props: { isRoot: true },
    });

    if (!incident) {
      return;
    }

    await this.applyRulesToIncident(incident);
  }

  // The alert twin of applyRulesToIncidentById — mirrors doesAlertMatchRule.
  @CaptureSpan()
  public async applyRulesToAlertById(data: {
    alertId: ObjectID;
    projectId: ObjectID;
  }): Promise<void> {
    const alert: Alert | null = await AlertService.findOneById({
      id: data.alertId,
      select: {
        _id: true,
        projectId: true,
        title: true,
        description: true,
        alertSeverityId: true,
        monitorId: true,
        labels: { _id: true },
      },
      props: { isRoot: true },
    });

    if (!alert) {
      return;
    }

    await this.applyRulesToAlert(alert);
  }

  @CaptureSpan()
  public async applyRulesToIncident(incident: Incident): Promise<void> {
    if (!incident.id || !incident.projectId) {
      return;
    }

    try {
      await this.applyRules({
        projectId: incident.projectId,
        triggerEntityType: AutoRemediationTriggerEntity.Incident,
        incident,
      });
    } catch (error) {
      logger.error(`Error applying auto-remediation rules: ${error}`, {
        projectId: incident.projectId?.toString(),
        incidentId: incident.id?.toString(),
      } as LogAttributes);
    }
  }

  @CaptureSpan()
  public async applyRulesToAlert(alert: Alert): Promise<void> {
    if (!alert.id || !alert.projectId) {
      return;
    }

    try {
      await this.applyRules({
        projectId: alert.projectId,
        triggerEntityType: AutoRemediationTriggerEntity.Alert,
        alert,
      });
    } catch (error) {
      logger.error(`Error applying auto-remediation rules: ${error}`, {
        projectId: alert.projectId?.toString(),
        alertId: alert.id?.toString(),
      } as LogAttributes);
    }
  }

  @CaptureSpan()
  private async applyRules(data: {
    projectId: ObjectID;
    triggerEntityType: AutoRemediationTriggerEntity;
    incident?: Incident | undefined;
    alert?: Alert | undefined;
  }): Promise<void> {
    /*
     * Project-level kill switch. === false so a missing column (older rows,
     * self-hosted defaults) counts as enabled — same semantics as enableAi.
     */
    const project: Project | null = await ProjectService.findOneById({
      id: data.projectId,
      select: {
        enableAi: true,
        enableAutoRemediation: true,
        enableAiCommandExecution: true,
      },
      props: { isRoot: true },
    });

    if (!project || project.enableAutoRemediation === false) {
      return;
    }

    const linkage: SubjectLinkage = {
      incidentId: data.incident?.id || undefined,
      alertId: data.alert?.id || undefined,
    };

    /*
     * Per-subject cap + per-rule dedupe. A rule that already produced a
     * suggestion on this subject never produces another (a dismissal is a
     * human "no" — do not re-ask).
     */
    const existingSuggestions: Array<AutoRemediationSuggestion> =
      await AutoRemediationSuggestionService.findBy({
        query: linkage.incidentId
          ? { incidentId: linkage.incidentId }
          : { alertId: linkage.alertId! },
        props: { isRoot: true },
        select: {
          _id: true,
          autoRemediationRuleId: true,
          kubernetesClusterId: true,
        },
        limit: MAX_SUGGESTIONS_PER_SUBJECT * 10,
        skip: 0,
      });

    let remainingBudget: number =
      MAX_SUGGESTIONS_PER_SUBJECT - existingSuggestions.length;

    if (remainingBudget <= 0) {
      logger.debug(
        `AutoRemediationRuleEngine: suggestion cap reached for subject; skipping.`,
        {
          projectId: data.projectId.toString(),
          incidentId: linkage.incidentId?.toString(),
          alertId: linkage.alertId?.toString(),
        } as LogAttributes,
      );
      return;
    }

    /*
     * Cluster-level remediation first: an operator who set a mode on the
     * cluster's AI page expressed a more specific intent than any project
     * rule, and it needs no rule to fire.
     */
    remainingBudget -= await this.applyClusterLevelRemediation({
      projectId: data.projectId,
      linkage,
      existingSuggestions,
      budget: remainingBudget,
    });

    if (remainingBudget <= 0) {
      return;
    }

    const rules: Array<AutoRemediationRule> =
      await AutoRemediationRuleService.findBy({
        query: {
          projectId: data.projectId,
          isEnabled: true,
          triggerEntityType: data.triggerEntityType,
        },
        props: { isRoot: true },
        select: {
          _id: true,
          name: true,
          executionMode: true,
          aiSelectsRunbook: true,
          aiComposesCommands: true,
          verificationWindowMinutes: true,
          autoResolveOnVerifiedRecovery: true,
          criteria: true,
          titlePattern: true,
          descriptionPattern: true,
          monitors: { _id: true },
          incidentSeverities: { _id: true },
          alertSeverities: { _id: true },
          labels: { _id: true },
          monitorLabels: { _id: true },
          runbooks: { _id: true, name: true },
        },
        limit: MAX_RULES_EVALUATED_PER_PROJECT,
        skip: 0,
      });

    logIfRuleReadWasTruncated({
      ruleKind: "AutoRemediationRule",
      projectId: data.projectId,
      rulesRead: rules.length,
    });

    if (rules.length === 0) {
      return;
    }

    const matchedRules: Array<AutoRemediationRule> = [];

    for (const rule of rules) {
      const isMatch: boolean = data.incident
        ? await this.doesIncidentMatchRule(data.incident, rule)
        : data.alert
          ? await this.doesAlertMatchRule(data.alert, rule)
          : false;

      if (isMatch) {
        matchedRules.push(rule);
      }
    }

    if (matchedRules.length === 0) {
      return;
    }

    const ruleIdsWithExistingSuggestion: Set<string> = new Set<string>(
      existingSuggestions
        .map((s: AutoRemediationSuggestion) => {
          return s.autoRemediationRuleId?.toString() || "";
        })
        .filter((id: string) => {
          return id !== "";
        }),
    );

    // Lazily evaluated once: AI rules need AI enabled and a provider.
    let aiAvailable: boolean | null = null;

    for (const rule of matchedRules) {
      if (remainingBudget <= 0) {
        break;
      }

      if (rule.id && ruleIdsWithExistingSuggestion.has(rule.id.toString())) {
        continue;
      }

      /*
       * Command composition wins over runbook selection when a rule has
       * both flags — one run per rule, never two.
       */
      if (rule.aiComposesCommands) {
        if (aiAvailable === null) {
          aiAvailable =
            project.enableAi !== false &&
            (await LlmProviderService.getLLMProviderForProject(
              data.projectId,
            )) !== null;
        }

        if (!aiAvailable) {
          logger.debug(
            `AutoRemediationRuleEngine: skipping AI command rule ${rule.id?.toString()} — AI disabled or no LLM provider configured.`,
            { projectId: data.projectId.toString() } as LogAttributes,
          );
          continue;
        }

        /*
         * Opt-in semantics (=== true): the project must have explicitly
         * enabled AI command execution, on top of the AI/auto-remediation
         * kill switches.
         */
        if (project.enableAiCommandExecution !== true) {
          logger.debug(
            `AutoRemediationRuleEngine: skipping AI command rule ${rule.id?.toString()} — the project has not enabled AI command execution.`,
            { projectId: data.projectId.toString() } as LogAttributes,
          );
          continue;
        }

        await this.startAiCommandRun({
          projectId: data.projectId,
          rule,
          linkage,
        });
        remainingBudget -= 1;
        continue;
      }

      if (rule.aiSelectsRunbook) {
        if (aiAvailable === null) {
          aiAvailable =
            project.enableAi !== false &&
            (await LlmProviderService.getLLMProviderForProject(
              data.projectId,
            )) !== null;
        }

        if (!aiAvailable) {
          logger.debug(
            `AutoRemediationRuleEngine: skipping AI rule ${rule.id?.toString()} — AI disabled or no LLM provider configured.`,
            { projectId: data.projectId.toString() } as LogAttributes,
          );
          continue;
        }

        await this.startAiPlanning({
          projectId: data.projectId,
          rule,
          linkage,
        });
        remainingBudget -= 1;
        continue;
      }

      // Deterministic rule: propose or start every attached runbook.
      const runbooks: Array<Runbook> = rule.runbooks || [];

      if (runbooks.length === 0) {
        logger.warn(
          `AutoRemediationRuleEngine: rule ${rule.id?.toString()} matched but has no runbooks attached and does not use AI selection; skipping.`,
          { projectId: data.projectId.toString() } as LogAttributes,
        );
        continue;
      }

      if (rule.executionMode === AutoRemediationExecutionMode.FullAuto) {
        remainingBudget -= await this.applyFullAutoRule({
          projectId: data.projectId,
          rule,
          runbooks,
          linkage,
          budget: remainingBudget,
        });
        continue;
      }

      for (const runbook of runbooks) {
        if (remainingBudget <= 0) {
          break;
        }
        if (!runbook.id) {
          continue;
        }

        await this.suggestRunbook({
          projectId: data.projectId,
          rule,
          runbook,
          linkage,
          downgradedByCircuitBreaker: false,
        });
        remainingBudget -= 1;
      }
    }
  }

  /*
   * FullAuto with the hourly circuit breaker. The whole
   * count-decide-execute-record section is serialized per rule through a
   * distributed mutex: concurrent incident creations (flap storm, multiple
   * App pods) would otherwise all read a stale count and blow past the cap
   * together. The AutoExecuted suggestion rows are written inside the lock,
   * so the next holder's count sees them. If the lock cannot be acquired
   * (e.g. Redis unavailable) the engine degrades to the unserialized check
   * rather than dropping remediation entirely — the breaker is
   * defense-in-depth, not a correctness invariant.
   *
   * Returns how many suggestions were consumed from the per-subject budget.
   */
  private async applyFullAutoRule(data: {
    projectId: ObjectID;
    rule: AutoRemediationRule;
    runbooks: Array<Runbook>;
    linkage: SubjectLinkage;
    budget: number;
  }): Promise<number> {
    let mutex: SemaphoreMutex | null = null;
    try {
      mutex = await Semaphore.lock({
        key: `auto-remediation-rule-${data.rule.id?.toString()}`,
        namespace: "AutoRemediationRuleEngine",
        lockTimeout: 60 * 1000,
        acquireTimeout: 20 * 1000,
      });
    } catch (error) {
      logger.warn(
        `AutoRemediationRuleEngine: could not acquire circuit-breaker lock for rule ${data.rule.id?.toString()} — continuing without cross-pod serialization: ${error}`,
        { projectId: data.projectId.toString() } as LogAttributes,
      );
    }

    let consumed: number = 0;

    try {
      /*
       * Count inside the lock, and keep counting in-memory as this
       * invocation executes — a rule with several attached runbooks must
       * not execute all of them off one stale pre-loop count.
       */
      let executedInWindow: number = (
        await AutoRemediationSuggestionService.countBy({
          query: {
            autoRemediationRuleId: data.rule.id!,
            status: AutoRemediationSuggestionStatus.AutoExecuted,
            createdAt: QueryHelper.greaterThan(
              OneUptimeDate.getSomeHoursAgo(1),
            ),
          },
          props: { isRoot: true },
        })
      ).toNumber();

      for (const runbook of data.runbooks) {
        if (consumed >= data.budget) {
          break;
        }
        if (!runbook.id) {
          continue;
        }

        if (executedInWindow >= MAX_AUTO_EXECUTIONS_PER_RULE_PER_HOUR) {
          logger.warn(
            `AutoRemediationRuleEngine: circuit breaker tripped for rule ${data.rule.id?.toString()} (${executedInWindow} auto-executions in the last hour); downgrading to Suggest.`,
            { projectId: data.projectId.toString() } as LogAttributes,
          );
          await this.suggestRunbook({
            projectId: data.projectId,
            rule: data.rule,
            runbook,
            linkage: data.linkage,
            downgradedByCircuitBreaker: true,
          });
        } else {
          await this.autoExecuteRunbook({
            projectId: data.projectId,
            rule: data.rule,
            runbook,
            linkage: data.linkage,
          });
          /*
           * Counted even when the start failed (no row written): within
           * this invocation the fail direction of a breaker is to close
           * early, never to keep firing.
           */
          executedInWindow += 1;
        }
        consumed += 1;
      }
    } finally {
      if (mutex) {
        try {
          await Semaphore.release(mutex);
        } catch (error) {
          logger.error(
            `AutoRemediationRuleEngine: failed to release circuit-breaker lock: ${error}`,
            { projectId: data.projectId.toString() } as LogAttributes,
          );
        }
      }
    }

    return consumed;
  }

  /*
   * Cluster-level remediation: for every cluster this signal is about whose
   * AI page enables remediation (and whose access is ready), start one AI
   * command run with the cluster as its only target. Automatic clusters run
   * FullAuto (safe kubectl without a human; a riskier change never runs on
   * its own — when it is the fix, the round ends by proposing it for
   * one-click approval); BypassApproval clusters run FullAuto for every
   * change the policy allows (a protected-namespace write or a node drain
   * or taint still asks); clusters on "ask for approval" run Suggest. One
   * suggestion per cluster per subject from this hook; and at most one
   * UNATTENDED AI run per cluster at a time, whatever the subject — a round
   * that finds another round, or a rule-driven run, still changing the
   * cluster or being verified on it asks instead (see
   * startClusterCommandRun and findRoundHoldingCluster). Returns how much
   * of the per-subject budget it used.
   */
  private async applyClusterLevelRemediation(data: {
    projectId: ObjectID;
    linkage: SubjectLinkage;
    existingSuggestions: Array<AutoRemediationSuggestion>;
    budget: number;
  }): Promise<number> {
    let consumed: number = 0;

    let statuses: Array<KubernetesClusterAiAccessStatus> = [];

    try {
      statuses = await KubernetesClusterAiAccessService.getStatusesForSubject({
        projectId: data.projectId,
        incidentId: data.linkage.incidentId,
        alertId: data.linkage.alertId,
      });
    } catch (error) {
      logger.error(
        `AutoRemediationRuleEngine: could not resolve cluster access for the subject; skipping cluster-level remediation: ${error}`,
        { projectId: data.projectId.toString() } as LogAttributes,
      );
      return 0;
    }

    for (const status of statuses) {
      if (consumed >= data.budget) {
        break;
      }

      if (!status.isRemediationReady) {
        continue;
      }

      // One round per cluster per subject from the create hook.
      const alreadyHasRound: boolean = data.existingSuggestions.some(
        (suggestion: AutoRemediationSuggestion) => {
          return (
            suggestion.kubernetesClusterId?.toString() === status.clusterId
          );
        },
      );

      if (alreadyHasRound) {
        continue;
      }

      const started: boolean = await this.startClusterCommandRun({
        projectId: data.projectId,
        cluster: status,
        linkage: data.linkage,
        round: 1,
      });

      if (started) {
        consumed += 1;
      }
    }

    return consumed;
  }

  /*
   * A follow-up round after a cluster plan ran and verification failed: the
   * operator asked to be asked again for a NEW set of commands. Suggest for
   * RequireApproval and Automatic clusters (a human approves the second
   * attempt), unattended again for BypassApproval clusters, and capped by
   * MAX_CLUSTER_REMEDIATION_ROUNDS_PER_SUBJECT. `forceSuggest` makes even a
   * BypassApproval follow-up ask first — the verifier sets it when the
   * failed round's rollback did not complete, so round 1's change may still
   * be applied and a human was just told to undo it by hand; an unattended
   * round on top of that state is exactly what must not happen. Called by
   * the verifier; never throws.
   */
  @CaptureSpan()
  public async startFollowUpClusterRemediation(data: {
    projectId: ObjectID;
    kubernetesClusterId: ObjectID;
    incidentId?: ObjectID | undefined;
    alertId?: ObjectID | undefined;
    forceSuggest?: boolean | undefined;
    // Completes "this round asks first because ..." on the feed.
    forceSuggestReason?: string | undefined;
  }): Promise<boolean> {
    try {
      const project: Project | null = await ProjectService.findOneById({
        id: data.projectId,
        select: { enableAutoRemediation: true },
        props: { isRoot: true },
      });

      if (!project || project.enableAutoRemediation === false) {
        return false;
      }

      const linkage: SubjectLinkage = {
        incidentId: data.incidentId,
        alertId: data.alertId,
      };

      if (!linkage.incidentId && !linkage.alertId) {
        return false;
      }

      const priorRounds: number = (
        await AutoRemediationSuggestionService.countBy({
          query: {
            ...(linkage.incidentId
              ? { incidentId: linkage.incidentId }
              : { alertId: linkage.alertId! }),
            kubernetesClusterId: data.kubernetesClusterId,
          },
          props: { isRoot: true },
        })
      ).toNumber();

      if (priorRounds >= MAX_CLUSTER_REMEDIATION_ROUNDS_PER_SUBJECT) {
        logger.debug(
          `AutoRemediationRuleEngine: cluster ${data.kubernetesClusterId.toString()} already used ${priorRounds} remediation round(s) on this subject; not asking again.`,
          { projectId: data.projectId.toString() } as LogAttributes,
        );
        return false;
      }

      const status: KubernetesClusterAiAccessStatus | null =
        await KubernetesClusterAiAccessService.getStatusForCluster({
          clusterId: data.kubernetesClusterId,
          projectId: data.projectId,
        });

      if (!status || !status.isRemediationReady) {
        return false;
      }

      return await this.startClusterCommandRun({
        projectId: data.projectId,
        cluster: status,
        linkage,
        round: priorRounds + 1,
        askFirstReason:
          data.forceSuggest === true
            ? data.forceSuggestReason ||
              "the previous fix's rollback did not complete, so its change may still be applied"
            : undefined,
      });
    } catch (error) {
      logger.error(
        `AutoRemediationRuleEngine: follow-up cluster remediation failed: ${error}`,
        { projectId: data.projectId.toString() } as LogAttributes,
      );
      return false;
    }
  }

  private async startClusterCommandRun(data: {
    projectId: ObjectID;
    cluster: KubernetesClusterAiAccessStatus;
    linkage: SubjectLinkage;
    round: number;
    /*
     * Set when a round that would run unattended must ask first anyway;
     * completes "this round asks first because ...".
     */
    askFirstReason?: string | undefined;
  }): Promise<boolean> {
    const { cluster } = data;

    /*
     * Automatic clusters run their first round unattended and ask a human
     * for the follow-up; a BypassApproval cluster runs every round
     * unattended, follow-ups included — that is what its operator chose.
     * (What needs a human in every mode — a protected-namespace write, a
     * node drain or taint — is still proposed, never run, inside the round.)
     */
    const isBypass: boolean =
      cluster.remediationMode === KubernetesAiRemediationMode.BypassApproval;
    const wantsUnattended: boolean =
      isBypass ||
      (data.round === 1 &&
        cluster.remediationMode === KubernetesAiRemediationMode.Automatic);

    let askFirstReason: string | null = data.askFirstReason || null;

    /*
     * One unattended round per cluster at a time. An alert and an incident
     * of the same monitor each reach this point with their own subject, so
     * the per-subject dedupe above never sees the other one; two unattended
     * agents on one cluster would each verify and roll back on top of the
     * other's change. The execution runner re-checks this when the round
     * starts (rounds announced at the same moment cannot see each other
     * here); this check only keeps the announcement honest.
     */
    if (wantsUnattended && !askFirstReason) {
      try {
        const hold: ClusterRoundHold | null =
          await this.findRoundHoldingCluster({
            projectId: data.projectId,
            clusterId: cluster.clusterId,
            anyOrder: true,
          });

        if (hold) {
          askFirstReason = `another OneUptime AI round on this cluster ${hold.description}`;
        }
      } catch (error) {
        logger.error(
          `AutoRemediationRuleEngine: could not check cluster ${cluster.clusterId} for another AI round in flight; this round asks first: ${error}`,
          { projectId: data.projectId.toString() } as LogAttributes,
        );
        askFirstReason =
          "OneUptime AI could not confirm that no other AI round is changing this cluster";
      }
    }

    const isAutomatic: boolean = wantsUnattended && !askFirstReason;

    const suggestion: AutoRemediationSuggestion =
      new AutoRemediationSuggestion();
    suggestion.projectId = data.projectId;
    suggestion.kubernetesClusterId = new ObjectID(cluster.clusterId);
    suggestion.ruleNameSnapshot = getClusterRoundNameSnapshot(
      cluster.clusterName,
      data.round,
    );
    suggestion.status = AutoRemediationSuggestionStatus.Planning;
    suggestion.suggestionType = AutoRemediationSuggestionType.CommandPlan;
    suggestion.executionMode = isAutomatic
      ? AutoRemediationExecutionMode.FullAuto
      : AutoRemediationExecutionMode.Suggest;
    suggestion.verificationWindowMinutes = DEFAULT_VERIFICATION_WINDOW_MINUTES;
    /*
     * An Automatic cluster's operator asked for the loop to be closed:
     * once the monitors recover the signal resolves itself. With a human
     * approving, the human resolves.
     */
    suggestion.autoResolveOnRecovery = isAutomatic;
    if (data.linkage.incidentId) {
      suggestion.incidentId = data.linkage.incidentId;
    }
    if (data.linkage.alertId) {
      suggestion.alertId = data.linkage.alertId;
    }

    const created: AutoRemediationSuggestion =
      await AutoRemediationSuggestionService.create({
        data: suggestion,
        props: { isRoot: true },
      });

    const aiRunId: ObjectID | null = await AIInvestigationQueue.enqueue({
      projectId: data.projectId,
      subjectIncidentId: data.linkage.incidentId,
      subjectAlertId: data.linkage.alertId,
      subjectAutoRemediationSuggestionId: created.id!,
      remediationRunType: AIRunType.RemediationExecution,
    });

    if (!aiRunId) {
      await AutoRemediationSuggestionService.updateOneById({
        id: created.id!,
        data: {
          status: AutoRemediationSuggestionStatus.NoneApplicable,
          rationaleMarkdown:
            "The AI remediation run could not be started — the daily autonomous AI budget is exhausted or no run could be queued. Re-enable by raising the budget or waiting for the daily reset.",
        },
        props: { isRoot: true },
      });
      return false;
    }

    await AutoRemediationSuggestionService.updateOneById({
      id: created.id!,
      data: { aiRunId },
      props: { isRoot: true },
    });

    /*
     * The feed states exactly what this round does. An Automatic round runs
     * safe changes on its own; a riskier change never runs without a human
     * — when it is the fix, the round ends by proposing it as a one-click
     * approval card (or, when a safe change was tried first and did not
     * recover the service, the follow-up round proposes the next plan).
     * (If the hourly circuit breaker, or another round in flight, turns an
     * unattended round into a proposal once it starts, the execution runner
     * posts its own explanation.)
     */
    let markdown: string;

    if (wantsUnattended && askFirstReason) {
      markdown = `⚡ **OneUptime AI is composing ${
        data.round > 1 ? "another" : "a"
      } kubectl fix for cluster "${cluster.clusterName}"**${
        data.round > 1
          ? ` (round ${data.round}) — the previous fix did not recover the service`
          : ""
      }. This round asks first because ${askFirstReason}: nothing runs until you approve the plan, which will appear here shortly.`;
    } else if (isBypass) {
      markdown =
        data.round > 1
          ? `⚡ **OneUptime AI is applying another kubectl fix on cluster "${cluster.clusterName}"** (round ${data.round}) — the previous fix did not recover the service. Approvals are bypassed for this cluster, so the new fix runs on its own: every kubectl change the policy allows, safe or riskier — except that ${KUBECTL_ALWAYS_ASKS_SUMMARY}, so AI proposes such a change for your approval; destructive commands never run. Progress appears here.`
          : `⚡ **OneUptime AI is fixing cluster "${cluster.clusterName}".** Approvals are bypassed for this cluster: AI is diagnosing with kubectl and will apply whatever fix the policy allows — safe or riskier — on its own, without asking, except that ${KUBECTL_ALWAYS_ASKS_SUMMARY}, so AI proposes such a change for your approval; destructive commands never run. Progress appears here.`;
    } else if (isAutomatic) {
      markdown = `⚡ **OneUptime AI is fixing cluster "${cluster.clusterName}".** Automatic remediation is on for this cluster: AI is diagnosing with kubectl and will apply safe changes (${KUBECTL_SAFE_CHANGES_SUMMARY}), plus anything the cluster's kubectl allowlist names, on its own. A riskier change never runs on its own — AI proposes it for your one-click approval instead. Progress appears here.`;
    } else {
      markdown =
        data.round > 1
          ? `⚡ **OneUptime AI is composing another kubectl fix for cluster "${cluster.clusterName}"** (round ${data.round}) — the previous fix did not recover the service. This round asks first: nothing runs until you approve the new plan, which will appear here shortly.`
          : `⚡ **OneUptime AI is composing a kubectl fix for cluster "${cluster.clusterName}".** Nothing runs until you approve the plan — it will appear here shortly.`;
    }

    await this.postFeedItem({
      projectId: data.projectId,
      linkage: data.linkage,
      markdown,
      pingWorkspace: false,
    });

    return true;
  }

  /*
   * AI path: create a Planning suggestion and enqueue a RemediationPlan run
   * on the durable AI queue. The planning runner fills in the picked runbook
   * and rationale (or NoneApplicable). AI-picked runbooks are always
   * suggest-only — never full-auto.
   */
  private async startAiPlanning(data: {
    projectId: ObjectID;
    rule: AutoRemediationRule;
    linkage: SubjectLinkage;
  }): Promise<void> {
    const suggestion: AutoRemediationSuggestion =
      new AutoRemediationSuggestion();
    suggestion.projectId = data.projectId;
    suggestion.autoRemediationRuleId = data.rule.id!;
    suggestion.ruleNameSnapshot = data.rule.name || "Auto Remediation Rule";
    suggestion.status = AutoRemediationSuggestionStatus.Planning;
    suggestion.executionMode = AutoRemediationExecutionMode.Suggest;
    suggestion.verificationWindowMinutes =
      data.rule.verificationWindowMinutes ||
      DEFAULT_VERIFICATION_WINDOW_MINUTES;
    suggestion.autoResolveOnRecovery =
      data.rule.autoResolveOnVerifiedRecovery === true;
    if (data.linkage.incidentId) {
      suggestion.incidentId = data.linkage.incidentId;
    }
    if (data.linkage.alertId) {
      suggestion.alertId = data.linkage.alertId;
    }

    const created: AutoRemediationSuggestion =
      await AutoRemediationSuggestionService.create({
        data: suggestion,
        props: { isRoot: true },
      });

    const aiRunId: ObjectID | null = await AIInvestigationQueue.enqueue({
      projectId: data.projectId,
      subjectIncidentId: data.linkage.incidentId,
      subjectAlertId: data.linkage.alertId,
      subjectAutoRemediationSuggestionId: created.id!,
    });

    if (!aiRunId) {
      /*
       * Budget exhausted or run creation failed — do not leave the
       * suggestion stuck in Planning forever.
       */
      await AutoRemediationSuggestionService.updateOneById({
        id: created.id!,
        data: {
          status: AutoRemediationSuggestionStatus.NoneApplicable,
          rationaleMarkdown:
            "AI planning could not be started — the daily autonomous AI budget is exhausted or no run could be queued. Re-enable by raising the budget or waiting for the daily reset.",
        },
        props: { isRoot: true },
      });
      return;
    }

    await AutoRemediationSuggestionService.updateOneById({
      id: created.id!,
      data: {
        aiRunId,
      },
      props: { isRoot: true },
    });

    await this.postFeedItem({
      projectId: data.projectId,
      linkage: data.linkage,
      markdown: `⚡ **Auto Remediation Rule "${data.rule.name}" matched.** AI is picking the most applicable runbook — a suggestion will appear here shortly.`,
      pingWorkspace: false,
    });
  }

  /*
   * AI command path (rules with aiComposesCommands): create a Planning
   * CommandPlan suggestion and enqueue a RemediationExecution run. The
   * execution runner decides Suggest vs FullAuto from the rule's execution
   * mode + allowlist + circuit breaker at run time; the suggestion's
   * executionMode snapshots the rule's intent for display.
   */
  private async startAiCommandRun(data: {
    projectId: ObjectID;
    rule: AutoRemediationRule;
    linkage: SubjectLinkage;
  }): Promise<void> {
    const suggestion: AutoRemediationSuggestion =
      new AutoRemediationSuggestion();
    suggestion.projectId = data.projectId;
    suggestion.autoRemediationRuleId = data.rule.id!;
    suggestion.ruleNameSnapshot = data.rule.name || "Auto Remediation Rule";
    suggestion.status = AutoRemediationSuggestionStatus.Planning;
    suggestion.suggestionType = AutoRemediationSuggestionType.CommandPlan;
    suggestion.executionMode =
      data.rule.executionMode === AutoRemediationExecutionMode.FullAuto
        ? AutoRemediationExecutionMode.FullAuto
        : AutoRemediationExecutionMode.Suggest;
    suggestion.verificationWindowMinutes =
      data.rule.verificationWindowMinutes ||
      DEFAULT_VERIFICATION_WINDOW_MINUTES;
    suggestion.autoResolveOnRecovery =
      data.rule.autoResolveOnVerifiedRecovery === true;
    if (data.linkage.incidentId) {
      suggestion.incidentId = data.linkage.incidentId;
    }
    if (data.linkage.alertId) {
      suggestion.alertId = data.linkage.alertId;
    }

    const created: AutoRemediationSuggestion =
      await AutoRemediationSuggestionService.create({
        data: suggestion,
        props: { isRoot: true },
      });

    const aiRunId: ObjectID | null = await AIInvestigationQueue.enqueue({
      projectId: data.projectId,
      subjectIncidentId: data.linkage.incidentId,
      subjectAlertId: data.linkage.alertId,
      subjectAutoRemediationSuggestionId: created.id!,
      remediationRunType: AIRunType.RemediationExecution,
    });

    if (!aiRunId) {
      await AutoRemediationSuggestionService.updateOneById({
        id: created.id!,
        data: {
          status: AutoRemediationSuggestionStatus.NoneApplicable,
          rationaleMarkdown:
            "The AI command run could not be started — the daily autonomous AI budget is exhausted or no run could be queued. Re-enable by raising the budget or waiting for the daily reset.",
        },
        props: { isRoot: true },
      });
      return;
    }

    await AutoRemediationSuggestionService.updateOneById({
      id: created.id!,
      data: {
        aiRunId,
      },
      props: { isRoot: true },
    });

    await this.postFeedItem({
      projectId: data.projectId,
      linkage: data.linkage,
      markdown: `⚡ **Auto Remediation Rule "${data.rule.name}" matched.** AI is diagnosing the signal and composing remediation commands — a suggestion will appear here shortly.`,
      pingWorkspace: false,
    });
  }

  // Deterministic Suggest path: propose the runbook for one-click approval.
  private async suggestRunbook(data: {
    projectId: ObjectID;
    rule: AutoRemediationRule;
    runbook: Runbook;
    linkage: SubjectLinkage;
    downgradedByCircuitBreaker: boolean;
  }): Promise<void> {
    const suggestion: AutoRemediationSuggestion =
      new AutoRemediationSuggestion();
    suggestion.projectId = data.projectId;
    suggestion.autoRemediationRuleId = data.rule.id!;
    suggestion.ruleNameSnapshot = data.rule.name || "Auto Remediation Rule";
    suggestion.runbookId = data.runbook.id!;
    suggestion.runbookNameSnapshot = data.runbook.name || "Runbook";
    suggestion.status = AutoRemediationSuggestionStatus.Suggested;
    suggestion.executionMode = AutoRemediationExecutionMode.Suggest;
    suggestion.verificationWindowMinutes =
      data.rule.verificationWindowMinutes ||
      DEFAULT_VERIFICATION_WINDOW_MINUTES;
    suggestion.autoResolveOnRecovery =
      data.rule.autoResolveOnVerifiedRecovery === true;
    suggestion.rationaleMarkdown = data.downgradedByCircuitBreaker
      ? "Proposed by a FullAuto rule that was downgraded to suggest-only by the hourly circuit breaker (too many recent auto-executions). Approve to start the runbook."
      : "Proposed by a matching auto-remediation rule. Approve to start the runbook.";
    if (data.linkage.incidentId) {
      suggestion.incidentId = data.linkage.incidentId;
    }
    if (data.linkage.alertId) {
      suggestion.alertId = data.linkage.alertId;
    }

    await AutoRemediationSuggestionService.create({
      data: suggestion,
      props: { isRoot: true },
    });

    await this.postFeedItem({
      projectId: data.projectId,
      linkage: data.linkage,
      markdown: `⚡ **Auto Remediation Rule "${data.rule.name}" proposed runbook "${data.runbook.name}".** Review and approve it with one click to start remediation.`,
      pingWorkspace: true,
    });
  }

  /*
   * FullAuto path: start the runbook immediately. startRunbookFor re-checks
   * project ownership, isEnabled and non-empty steps, so a stale or
   * cross-project runbook reference can never execute.
   */
  private async autoExecuteRunbook(data: {
    projectId: ObjectID;
    rule: AutoRemediationRule;
    runbook: Runbook;
    linkage: SubjectLinkage;
  }): Promise<void> {
    const runbookLinkage: { incidentId?: ObjectID; alertId?: ObjectID } = {};
    if (data.linkage.incidentId) {
      runbookLinkage.incidentId = data.linkage.incidentId;
    }
    if (data.linkage.alertId) {
      runbookLinkage.alertId = data.linkage.alertId;
    }

    const execution: RunbookExecution | null =
      await RunbookRuleEngineService.startRunbookFor({
        projectId: data.projectId,
        runbookId: data.runbook.id!,
        linkage: runbookLinkage,
      });

    if (!execution) {
      logger.warn(
        `AutoRemediationRuleEngine: FullAuto rule ${data.rule.id?.toString()} could not start runbook ${data.runbook.id?.toString()} (missing, disabled, cross-project or empty).`,
        { projectId: data.projectId.toString() } as LogAttributes,
      );
      await this.postFeedItem({
        projectId: data.projectId,
        linkage: data.linkage,
        markdown: `⚡ **Auto Remediation Rule "${data.rule.name}" matched, but runbook "${data.runbook.name}" could not be started** (it may be disabled or have no steps).`,
        pingWorkspace: false,
      });
      return;
    }

    const suggestion: AutoRemediationSuggestion =
      new AutoRemediationSuggestion();
    suggestion.projectId = data.projectId;
    suggestion.autoRemediationRuleId = data.rule.id!;
    suggestion.ruleNameSnapshot = data.rule.name || "Auto Remediation Rule";
    suggestion.runbookId = data.runbook.id!;
    suggestion.runbookNameSnapshot = data.runbook.name || "Runbook";
    suggestion.status = AutoRemediationSuggestionStatus.AutoExecuted;
    suggestion.executionMode = AutoRemediationExecutionMode.FullAuto;
    suggestion.runbookExecutionId = execution.id!;
    suggestion.verificationWindowMinutes =
      data.rule.verificationWindowMinutes ||
      DEFAULT_VERIFICATION_WINDOW_MINUTES;
    suggestion.autoResolveOnRecovery =
      data.rule.autoResolveOnVerifiedRecovery === true;
    // The runbook is already running — verification starts now.
    suggestion.verificationStatus = AutoRemediationVerificationStatus.Pending;
    suggestion.verificationDeadlineAt = OneUptimeDate.addRemoveMinutes(
      OneUptimeDate.getCurrentDate(),
      data.rule.verificationWindowMinutes ||
        DEFAULT_VERIFICATION_WINDOW_MINUTES,
    );
    suggestion.rationaleMarkdown =
      "Automatically executed by a FullAuto auto-remediation rule.";
    if (data.linkage.incidentId) {
      suggestion.incidentId = data.linkage.incidentId;
    }
    if (data.linkage.alertId) {
      suggestion.alertId = data.linkage.alertId;
    }

    await AutoRemediationSuggestionService.create({
      data: suggestion,
      props: { isRoot: true },
    });

    await this.postFeedItem({
      projectId: data.projectId,
      linkage: data.linkage,
      markdown: `⚡ **Auto Remediation Rule "${data.rule.name}" automatically started runbook "${data.runbook.name}".** Follow its progress on the runbook execution page.`,
      pingWorkspace: true,
    });
  }

  // Feed posting is best-effort observability — the feed services never throw.
  private async postFeedItem(data: {
    projectId: ObjectID;
    linkage: SubjectLinkage;
    markdown: string;
    pingWorkspace: boolean;
  }): Promise<void> {
    try {
      if (data.linkage.incidentId) {
        await IncidentFeedService.createIncidentFeedItem({
          incidentId: data.linkage.incidentId,
          projectId: data.projectId,
          incidentFeedEventType: IncidentFeedEventType.AutoRemediation,
          displayColor: Indigo500,
          feedInfoInMarkdown: data.markdown,
          workspaceNotification: {
            sendWorkspaceNotification: data.pingWorkspace,
          },
        });
      } else if (data.linkage.alertId) {
        await AlertFeedService.createAlertFeedItem({
          alertId: data.linkage.alertId,
          projectId: data.projectId,
          alertFeedEventType: AlertFeedEventType.AutoRemediation,
          displayColor: Indigo500,
          feedInfoInMarkdown: data.markdown,
          workspaceNotification: {
            sendWorkspaceNotification: data.pingWorkspace,
          },
        });
      }
    } catch (error) {
      logger.error(
        `AutoRemediationRuleEngine: failed to create feed item: ${error}`,
        {
          projectId: data.projectId.toString(),
          incidentId: data.linkage.incidentId?.toString(),
          alertId: data.linkage.alertId?.toString(),
        } as LogAttributes,
      );
    }
  }

  /*
   * Matching. Every criterion is skip-if-empty with AND semantics across
   * criteria — the same shape as IncidentOnCallRuleEngineService.
   */
  public async doesIncidentMatchRule(
    incident: Incident,
    rule: AutoRemediationRule,
  ): Promise<boolean> {
    const monitorCache: MonitorRuleCriteriaCache =
      new MonitorRuleCriteriaCache();

    return await RuleCriteriaMatcher.matchesWithLegacy({
      rule: rule,
      legacyFields: [
        "monitors",
        "incidentSeverities",
        "labels",
        "monitorLabels",
        "titlePattern",
        "descriptionPattern",
      ],
      emptyResult: true,
      matchesLegacyRule: async (
        legacyRule: AutoRemediationRule,
      ): Promise<boolean> => {
        return await this.doesIncidentMatchLegacyRule(
          incident,
          legacyRule,
          monitorCache,
        );
      },
      correlation: {
        fields: ["monitorLabels"],
        getCandidates: (): Array<Monitor> => {
          return incident.monitors || [];
        },
        matchesLegacyRuleForCandidate: async (
          legacyRule: AutoRemediationRule,
          incidentMonitor: Monitor,
        ): Promise<boolean> => {
          const correlatedIncident: Incident = Object.assign(
            new Incident(),
            incident,
          );
          correlatedIncident.monitors = [incidentMonitor];
          return await this.doesIncidentMatchLegacyRule(
            correlatedIncident,
            legacyRule,
            monitorCache,
          );
        },
      },
    });
  }

  private async doesIncidentMatchLegacyRule(
    incident: Incident,
    rule: AutoRemediationRule,
    monitorCache: MonitorRuleCriteriaCache,
  ): Promise<boolean> {
    // Monitors: incident must come from at least one of the rule's monitors.
    if (rule.monitors && rule.monitors.length > 0) {
      if (!incident.monitors || incident.monitors.length === 0) {
        return false;
      }
      const ruleMonitorIds: Array<string> = rule.monitors.map((m: Monitor) => {
        return m.id?.toString() || "";
      });
      const incidentMonitorIds: Array<string> = incident.monitors.map(
        (m: Monitor) => {
          return m.id?.toString() || "";
        },
      );
      const hasMatch: boolean = ruleMonitorIds.some((id: string) => {
        return incidentMonitorIds.includes(id);
      });
      if (!hasMatch) {
        return false;
      }
    }

    // Severity
    if (rule.incidentSeverities && rule.incidentSeverities.length > 0) {
      if (!incident.incidentSeverityId) {
        return false;
      }
      const severityIds: Array<string> = rule.incidentSeverities.map(
        (s: IncidentSeverity) => {
          return s.id?.toString() || "";
        },
      );
      if (!severityIds.includes(incident.incidentSeverityId.toString())) {
        return false;
      }
    }

    // Entity labels
    if (rule.labels && rule.labels.length > 0) {
      if (!incident.labels || incident.labels.length === 0) {
        return false;
      }
      const ruleLabelIds: Array<string> = rule.labels.map((l: Label) => {
        return l.id?.toString() || "";
      });
      const incidentLabelIds: Array<string> = incident.labels.map(
        (l: Label) => {
          return l.id?.toString() || "";
        },
      );
      const hasMatch: boolean = ruleLabelIds.some((id: string) => {
        return incidentLabelIds.includes(id);
      });
      if (!hasMatch) {
        return false;
      }
    }

    // Monitor labels: any of the incident's monitors carrying one is enough.
    if (rule.monitorLabels && rule.monitorLabels.length > 0) {
      if (!incident.monitors || incident.monitors.length === 0) {
        return false;
      }

      let anyMonitorMatches: boolean = false;

      for (const incidentMonitor of incident.monitors) {
        if (!incidentMonitor.id) {
          continue;
        }

        if (
          await this.doesMonitorCarryAnyLabel(
            incidentMonitor.id,
            rule.monitorLabels,
            monitorCache,
          )
        ) {
          anyMonitorMatches = true;
          break;
        }
      }

      if (!anyMonitorMatches) {
        return false;
      }
    }

    if (rule.titlePattern) {
      if (
        !incident.title ||
        !this.testRegex(rule.titlePattern, incident.title, rule)
      ) {
        return false;
      }
    }

    if (rule.descriptionPattern) {
      if (
        !incident.description ||
        !this.testRegex(rule.descriptionPattern, incident.description, rule)
      ) {
        return false;
      }
    }

    return true;
  }

  public async doesAlertMatchRule(
    alert: Alert,
    rule: AutoRemediationRule,
  ): Promise<boolean> {
    const monitorCache: MonitorRuleCriteriaCache =
      new MonitorRuleCriteriaCache();

    return await RuleCriteriaMatcher.matchesWithLegacy({
      rule: rule,
      legacyFields: [
        "monitors",
        "alertSeverities",
        "labels",
        "monitorLabels",
        "titlePattern",
        "descriptionPattern",
      ],
      emptyResult: true,
      matchesLegacyRule: async (
        legacyRule: AutoRemediationRule,
      ): Promise<boolean> => {
        return await this.doesAlertMatchLegacyRule(
          alert,
          legacyRule,
          monitorCache,
        );
      },
    });
  }

  private async doesAlertMatchLegacyRule(
    alert: Alert,
    rule: AutoRemediationRule,
    monitorCache: MonitorRuleCriteriaCache,
  ): Promise<boolean> {
    // Monitors: alerts carry a single scalar monitorId.
    if (rule.monitors && rule.monitors.length > 0) {
      if (!alert.monitorId) {
        return false;
      }
      const monitorIds: Array<string> = rule.monitors.map((m: Monitor) => {
        return m.id?.toString() || "";
      });
      if (!monitorIds.includes(alert.monitorId.toString())) {
        return false;
      }
    }

    // Severity
    if (rule.alertSeverities && rule.alertSeverities.length > 0) {
      if (!alert.alertSeverityId) {
        return false;
      }
      const severityIds: Array<string> = rule.alertSeverities.map(
        (s: AlertSeverity) => {
          return s.id?.toString() || "";
        },
      );
      if (!severityIds.includes(alert.alertSeverityId.toString())) {
        return false;
      }
    }

    // Entity labels
    if (rule.labels && rule.labels.length > 0) {
      if (!alert.labels || alert.labels.length === 0) {
        return false;
      }
      const ruleLabelIds: Array<string> = rule.labels.map((l: Label) => {
        return l.id?.toString() || "";
      });
      const alertLabelIds: Array<string> = alert.labels.map((l: Label) => {
        return l.id?.toString() || "";
      });
      const hasMatch: boolean = ruleLabelIds.some((id: string) => {
        return alertLabelIds.includes(id);
      });
      if (!hasMatch) {
        return false;
      }
    }

    // Monitor labels
    if (rule.monitorLabels && rule.monitorLabels.length > 0) {
      if (!alert.monitorId) {
        return false;
      }
      if (
        !(await this.doesMonitorCarryAnyLabel(
          alert.monitorId,
          rule.monitorLabels,
          monitorCache,
        ))
      ) {
        return false;
      }
    }

    if (rule.titlePattern) {
      if (
        !alert.title ||
        !this.testRegex(rule.titlePattern, alert.title, rule)
      ) {
        return false;
      }
    }

    if (rule.descriptionPattern) {
      if (
        !alert.description ||
        !this.testRegex(rule.descriptionPattern, alert.description, rule)
      ) {
        return false;
      }
    }

    return true;
  }

  private async doesMonitorCarryAnyLabel(
    monitorId: ObjectID,
    ruleMonitorLabels: Array<Label>,
    monitorCache: MonitorRuleCriteriaCache,
  ): Promise<boolean> {
    const monitor: Monitor | null = await monitorCache.getMonitor(monitorId);

    if (!monitor || !monitor.labels || monitor.labels.length === 0) {
      return false;
    }

    const ruleLabelIds: Array<string> = ruleMonitorLabels.map((l: Label) => {
      return l.id?.toString() || "";
    });
    const monitorLabelIds: Array<string> = monitor.labels.map((l: Label) => {
      return l.id?.toString() || "";
    });

    return ruleLabelIds.some((id: string) => {
      return monitorLabelIds.includes(id);
    });
  }

  private testRegex(
    pattern: string,
    value: string,
    rule: AutoRemediationRule,
  ): boolean {
    try {
      const regex: RegExp = new RegExp(pattern, "i");
      return regex.test(value);
    } catch {
      logger.warn(
        `Invalid regex pattern in auto-remediation rule ${rule.id}: ${pattern}`,
      );
      return false;
    }
  }
}

const AutoRemediationRuleEngineService: AutoRemediationRuleEngineServiceClass =
  new AutoRemediationRuleEngineServiceClass();

export default AutoRemediationRuleEngineService;
