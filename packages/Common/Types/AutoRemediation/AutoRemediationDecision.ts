import { JSONObject } from "../JSON";

/*
 * WHY AUTO-REMEDIATION DID, OR DID NOT, ACT ON AN INCIDENT OR ALERT.
 *
 * Four things can fix a signal: the AI fix of a Kubernetes cluster it is
 * linked to (the cluster's AI page), the AI fix of an infrastructure
 * resource it is linked to (the resource's AI page), and the project's Auto
 * Remediation Rules. When none of them acted, the incident used to say
 * nothing at all - the remediation card hid itself - and people could not
 * tell "fixes are off on that cluster" from "this incident is not linked to
 * any cluster" from "no rule matched".
 *
 * The rule engine now writes down, every time it evaluates a signal, one
 * entry per fix path: what it did, or why it did nothing. The dashboard
 * turns each entry into one sentence on the incident's or alert's
 * Remediation card. Entries carry reason codes and the names involved, not
 * sentences, so the dashboard can say them in the reader's language; the
 * one exception is a cluster's or resource's readiness gaps, whose title and
 * next step the server already writes in English for the AI agent pages.
 *
 * Written once per evaluation and never changed: the latest record of a
 * subject is the one that counts (an Evaluated record always wins over a
 * WaitingForInvestigation one, whatever their order).
 */

export enum AutoRemediationDecisionStage {
  /*
   * An AI investigation was queued for the signal, and remediation waits
   * for it to settle so the planner has the root cause analysis in hand
   * (RCA-first ordering, see RemediationHandoff).
   */
  WaitingForInvestigation = "WaitingForInvestigation",
  // Every fix path was evaluated; the entries say what happened.
  Evaluated = "Evaluated",
}

export enum AutoRemediationDecisionLane {
  // Project-wide: Enable AI, the per-signal suggestion cap, a failed run.
  Project = "Project",
  // A Kubernetes cluster the signal is linked to (the cluster's AI page).
  KubernetesCluster = "KubernetesCluster",
  // An infrastructure resource the signal is linked to (its AI page).
  Resource = "Resource",
  // The project's Auto Remediation Rules.
  Rule = "Rule",
}

export enum AutoRemediationDecisionReason {
  /*
   * --- Project ---
   * Enable AI (Project Settings > AI > AI Features) is off: nothing ran.
   */
  EnableAiOff = "EnableAiOff",
  /*
   * "Fix new incidents automatically" (or alerts) is off - the default -
   * so nothing ran.
   */
  RemediationOff = "RemediationOff",
  // The signal already holds the most suggestions one signal may get.
  SuggestionLimitReached = "SuggestionLimitReached",
  // The evaluation stopped on an error; the entries before it still hold.
  EvaluationFailed = "EvaluationFailed",

  /*
   * --- Kubernetes cluster ---
   * The signal is linked to no Kubernetes cluster.
   */
  ClusterNoneLinked = "ClusterNoneLinked",
  // The clusters the signal is about could not be read.
  ClusterLookupFailed = "ClusterLookupFailed",
  // An infrastructure resource's AI fix already took this signal.
  ClusterSkippedForResourceRound = "ClusterSkippedForResourceRound",
  // Fixes are Off on the cluster's AI page.
  ClusterFixesOff = "ClusterFixesOff",
  // Fixes are on, but something blocks them (see gaps).
  ClusterNotReady = "ClusterNotReady",
  // The cluster already has an AI fix round for this signal.
  ClusterAlreadyHasRound = "ClusterAlreadyHasRound",
  // OneUptime AI started a fix round on the cluster.
  ClusterRoundStarted = "ClusterRoundStarted",
  // The round could not be queued (the daily AI budget, most often).
  ClusterRoundNotStarted = "ClusterRoundNotStarted",
  // The signal ran out of suggestions before this cluster's turn.
  ClusterSkippedLimit = "ClusterSkippedLimit",

  /*
   * --- Infrastructure resource ---
   * A Kubernetes cluster's AI fix took the signal: one AI fix per signal.
   */
  ResourceSkippedForClusterRound = "ResourceSkippedForClusterRound",
  // An earlier evaluation already gave the signal an AI fix round.
  ResourceSkippedForOtherRound = "ResourceSkippedForOtherRound",
  // The signal ran out of suggestions before the resources' turn.
  ResourceSkippedLimit = "ResourceSkippedLimit",
  // The resources the signal is about could not be read.
  ResourceLookupFailed = "ResourceLookupFailed",
  // The signal is linked to no resource that has an AI agent.
  ResourceNoneLinked = "ResourceNoneLinked",
  // Fixes are Off on the resource's AI page.
  ResourceFixesOff = "ResourceFixesOff",
  // Fixes are on, but something blocks them (see gaps).
  ResourceNotReady = "ResourceNotReady",
  // OneUptime AI started a fix round on the resource.
  ResourceRoundStarted = "ResourceRoundStarted",
  // The round could not be queued (the daily AI budget, most often).
  ResourceRoundNotStarted = "ResourceRoundNotStarted",
  // Ready, but another linked resource got the signal's one AI fix round.
  ResourceNotChosen = "ResourceNotChosen",

  /*
   * --- Auto Remediation Rules ---
   * The signal ran out of suggestions before the rules' turn.
   */
  RulesSkippedLimit = "RulesSkippedLimit",
  // The project has no enabled rule for this kind of signal.
  NoRulesConfigured = "NoRulesConfigured",
  // Enabled rules exist, and none matched (rulesChecked says how many).
  NoRuleMatched = "NoRuleMatched",
  // The rule already proposed something for this signal.
  RuleAlreadyProposed = "RuleAlreadyProposed",
  // An AI rule matched, but the project has no LLM provider.
  RuleSkippedNoLlmProvider = "RuleSkippedNoLlmProvider",
  // An AI rule matched: AI is composing remediation commands.
  RuleAiComposingCommands = "RuleAiComposingCommands",
  // An AI rule matched: AI is picking the runbook.
  RuleAiPickingRunbook = "RuleAiPickingRunbook",
  // An AI rule matched, but its AI run could not be queued.
  RuleAiRunNotStarted = "RuleAiRunNotStarted",
  // The rule proposed a runbook for one-click approval.
  RuleRunbookProposed = "RuleRunbookProposed",
  /*
   * A Full Auto rule proposed instead of starting: it had already started
   * the most runbooks it may start in an hour.
   */
  RuleRunbookProposedByCircuitBreaker = "RuleRunbookProposedByCircuitBreaker",
  // A Full Auto rule started the runbook.
  RuleRunbookStarted = "RuleRunbookStarted",
  // A Full Auto rule could not start the runbook (disabled or no steps).
  RuleRunbookNotStarted = "RuleRunbookNotStarted",
  // The rule matched, but has no runbook and does not use AI.
  RuleHasNoRunbooks = "RuleHasNoRunbooks",
  // The rule matched after the signal ran out of suggestions.
  RuleSkippedLimit = "RuleSkippedLimit",
  /*
   * Auto Remediation Rules are set up, and none matched: with rules, only
   * the signals that match one are fixed (rulesChecked says how many).
   */
  NotMatchedByAnyRule = "NotMatchedByAnyRule",
  /*
   * Rules matched, and none of them fixes with OneUptime AI (each runs its
   * runbooks, or does what a rule saved before rules were simplified did):
   * no cluster or resource round was tried.
   */
  NoAiFixRuleMatched = "NoAiFixRuleMatched",
  // The rule matched: OneUptime AI fixes the signal on what it is linked to.
  RuleMatchedAiFix = "RuleMatchedAiFix",
  // The same, and the rule asks before fixing: every fix waits for approval.
  RuleMatchedAiFixAsks = "RuleMatchedAiFixAsks",
}

/*
 * A readiness gap as the cluster's or resource's AI agent page words it.
 * Server-written English, as on those pages and the investigation panel.
 */
export interface AutoRemediationDecisionGap {
  code: string;
  title: string;
  description?: string | undefined;
  nextStep: string;
}

// A monitor named in an entry, so the card can link to it.
export interface AutoRemediationDecisionMonitor {
  id: string;
  name: string;
}

export interface AutoRemediationDecisionEntry {
  lane: AutoRemediationDecisionLane;
  reason: AutoRemediationDecisionReason;

  // KubernetesCluster lane.
  kubernetesClusterId?: string | undefined;
  kubernetesClusterName?: string | undefined;

  // Resource lane. resourceType is an AiResourceType.
  resourceType?: string | undefined;
  resourceId?: string | undefined;
  resourceName?: string | undefined;

  /*
   * The fix mode of the cluster or resource when it was evaluated: a
   * KubernetesAiRemediationMode or a ResourceAiRemediationMode (the two
   * share their values).
   */
  remediationMode?: string | undefined;
  // What blocks a cluster's or resource's fixes (ClusterNotReady, ...).
  gaps?: Array<AutoRemediationDecisionGap> | undefined;

  // Rule lane.
  ruleId?: string | undefined;
  ruleName?: string | undefined;
  runbookId?: string | undefined;
  runbookName?: string | undefined;
  // NoRuleMatched: how many enabled rules were checked.
  rulesChecked?: number | undefined;

  /*
   * ClusterNoneLinked / ResourceNoneLinked: the signal's monitors, so the
   * card can send the reader to link them to what they watch.
   */
  monitors?: Array<AutoRemediationDecisionMonitor> | undefined;
}

// The most monitors an entry names; the card links each one.
export const MAX_DECISION_MONITORS: number = 5;

const LANES: Array<string> = Object.values(AutoRemediationDecisionLane);
const REASONS: Array<string> = Object.values(AutoRemediationDecisionReason);

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readGaps(value: unknown): Array<AutoRemediationDecisionGap> {
  if (!Array.isArray(value)) {
    return [];
  }

  const gaps: Array<AutoRemediationDecisionGap> = [];

  for (const item of value) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const gap: JSONObject = item as JSONObject;
    const code: string | undefined = readString(gap["code"]);
    const title: string | undefined = readString(gap["title"]);

    if (!code || !title) {
      continue;
    }

    gaps.push({
      code,
      title,
      description: readString(gap["description"]),
      nextStep: readString(gap["nextStep"]) || "",
    });
  }

  return gaps;
}

function readMonitors(value: unknown): Array<AutoRemediationDecisionMonitor> {
  if (!Array.isArray(value)) {
    return [];
  }

  const monitors: Array<AutoRemediationDecisionMonitor> = [];

  for (const item of value) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const id: string | undefined = readString((item as JSONObject)["id"]);

    if (!id) {
      continue;
    }

    monitors.push({
      id,
      name: readString((item as JSONObject)["name"]) || "",
    });
  }

  return monitors.slice(0, MAX_DECISION_MONITORS);
}

export class AutoRemediationDecisionHelper {
  /*
   * The entries of a stored record, read defensively: the column is JSON,
   * and a record written by a newer server can carry a reason this build
   * does not know. Unknown or malformed entries are left out rather than
   * drawn as something they are not.
   */
  public static parseEntries(
    value: unknown,
  ): Array<AutoRemediationDecisionEntry> {
    if (!Array.isArray(value)) {
      return [];
    }

    const entries: Array<AutoRemediationDecisionEntry> = [];

    for (const item of value) {
      if (!item || typeof item !== "object") {
        continue;
      }

      const raw: JSONObject = item as JSONObject;
      const lane: unknown = raw["lane"];
      const reason: unknown = raw["reason"];

      if (
        typeof lane !== "string" ||
        typeof reason !== "string" ||
        !LANES.includes(lane) ||
        !REASONS.includes(reason)
      ) {
        continue;
      }

      const rulesChecked: unknown = raw["rulesChecked"];

      entries.push({
        lane: lane as AutoRemediationDecisionLane,
        reason: reason as AutoRemediationDecisionReason,
        kubernetesClusterId: readString(raw["kubernetesClusterId"]),
        kubernetesClusterName: readString(raw["kubernetesClusterName"]),
        resourceType: readString(raw["resourceType"]),
        resourceId: readString(raw["resourceId"]),
        resourceName: readString(raw["resourceName"]),
        remediationMode: readString(raw["remediationMode"]),
        gaps: readGaps(raw["gaps"]),
        ruleId: readString(raw["ruleId"]),
        ruleName: readString(raw["ruleName"]),
        runbookId: readString(raw["runbookId"]),
        runbookName: readString(raw["runbookName"]),
        rulesChecked:
          typeof rulesChecked === "number" &&
          Number.isFinite(rulesChecked) &&
          rulesChecked >= 0
            ? Math.floor(rulesChecked)
            : undefined,
        monitors: readMonitors(raw["monitors"]),
      });
    }

    return entries;
  }

  /*
   * An entry as stored: undefined fields and empty lists dropped, so a
   * record holds only what it says.
   */
  public static toJSON(entry: AutoRemediationDecisionEntry): JSONObject {
    const json: JSONObject = {};

    for (const [key, value] of Object.entries(entry)) {
      if (value === undefined || value === null) {
        continue;
      }

      if (Array.isArray(value) && value.length === 0) {
        continue;
      }

      json[key] = value as JSONObject[keyof JSONObject];
    }

    return json;
  }

  // Whether this entry says a fix path acted: proposed or started something.
  public static isActed(entry: AutoRemediationDecisionEntry): boolean {
    return ACTED_REASONS.includes(entry.reason);
  }

  // Whether this entry is something the reader can fix (a setting, a link).
  public static needsAttention(entry: AutoRemediationDecisionEntry): boolean {
    return ATTENTION_REASONS.includes(entry.reason);
  }
}

const ACTED_REASONS: Array<AutoRemediationDecisionReason> = [
  AutoRemediationDecisionReason.ClusterRoundStarted,
  AutoRemediationDecisionReason.ResourceRoundStarted,
  AutoRemediationDecisionReason.RuleAiComposingCommands,
  AutoRemediationDecisionReason.RuleAiPickingRunbook,
  AutoRemediationDecisionReason.RuleRunbookProposed,
  AutoRemediationDecisionReason.RuleRunbookProposedByCircuitBreaker,
  AutoRemediationDecisionReason.RuleRunbookStarted,
];

const ATTENTION_REASONS: Array<AutoRemediationDecisionReason> = [
  AutoRemediationDecisionReason.EnableAiOff,
  AutoRemediationDecisionReason.EvaluationFailed,
  AutoRemediationDecisionReason.ClusterLookupFailed,
  AutoRemediationDecisionReason.ClusterNotReady,
  AutoRemediationDecisionReason.ClusterRoundNotStarted,
  AutoRemediationDecisionReason.ResourceLookupFailed,
  AutoRemediationDecisionReason.ResourceNotReady,
  AutoRemediationDecisionReason.ResourceRoundNotStarted,
  AutoRemediationDecisionReason.RuleSkippedNoLlmProvider,
  AutoRemediationDecisionReason.RuleAiRunNotStarted,
  AutoRemediationDecisionReason.RuleRunbookNotStarted,
  AutoRemediationDecisionReason.RuleHasNoRunbooks,
];
