import AIInsightType from "./AIInsightType";
import {
  AiRuleFix,
  doesAiRuleFix,
  doesAiRuleInvestigate,
  getAiRuleFix,
} from "./AiRule";
import { TELEMETRY_AI_RULE_CRITERIA_FIELDS } from "./AiRuleCriteria";
import {
  getInvestigationRuleWaitMinutes,
  getShortestInvestigationRuleWait,
} from "./InvestigationRuleWait";
import { getRulesLlmProviderId } from "./LlmProviderChoice";
import AutoRemediationTriggerEntity from "../AutoRemediation/AutoRemediationTriggerEntity";
import ErrorClass from "../Telemetry/ErrorClass";
import {
  CodeRepositoryAllowance,
  EVERY_CODE_REPOSITORY,
  NO_CODE_REPOSITORY,
  getCodeRepositoryAllowance,
} from "../CodeRepository/CodeRepositoryAllowance";
import {
  EVERY_EXTERNAL_MCP_SERVER,
  ExternalMcpServerAllowance,
  NO_EXTERNAL_MCP_SERVER,
  getExternalMcpServerAllowance,
} from "./ExternalMcpServer/ExternalMcpServerAllowance";

/*
 * ONEUPTIME AI IN THE TELEMETRY PRODUCTS: WHAT IT DOES WITH THE PROBLEMS
 * ONEUPTIME FINDS IN THEIR DATA - the one reading, for the insight scanner,
 * the routing, the rule service, the Dashboard and the docs tests alike.
 *
 * "Just like we have remediation rules in incidents, can we have a section
 * for AI, like insights, logs, and settings in the Profiles product? In
 * settings, we can have a rule that is turned on by default, which says,
 * 'Investigate and remediate performance issues automatically.' ...
 * Remediate performance issues with these code repos on these runners ...
 * OneUptime would create PRs for you for that code repo" - the maintainer.
 *
 * Each telemetry product is a lane (TelemetryAiLane): Profiles first, then
 * Traces; Exceptions, Logs and Metrics follow the same way. A lane has:
 *
 *   - the problems OneUptime finds in its data, filed as AI insights of the
 *     lane's own types (insightTypes) by deterministic detectors - no LLM
 *     decides what is a problem (Server/Utils/AI/SRE/Insights/Detectors).
 *     For Profiles: slow code (AIInsightType.ProfileHotspot). For Traces:
 *     slow operations, failing operations, and the ones whose traces cannot
 *     say why (Utils/Traces/TraceInsight);
 *   - one project switch (switchColumn), on for new projects: while it is on
 *     OneUptime looks for those problems and OneUptime AI works on them;
 *   - AI rules of its own: the one AI rule (AutoRemediationRule) with the
 *     lane's triggerEntityType, in the shape incidents' rules have - Match
 *     (which services), Investigate (right away, or only if the problem is
 *     still there after a wait), Fix (don't fix, ask before fixing, fix
 *     without asking) - and, under More fields, the code repositories, the
 *     MCP servers and the LLM provider OneUptime AI may use.
 *
 * Investigating is OneUptime AI's read-only look at the problem - its
 * insight's triage, written onto the insight. Fixing is a pull request: a
 * Code task in the repository that holds the code, with the evidence as its
 * context, that shows in Code with what started it, and whose pull request
 * says why it was opened. Nothing is ever merged. Asking first means the
 * insight offers the pull request, and a person opens it with one click.
 * The code is changed on the Runner the repository picks in Code: only that
 * Runner is ever handed the repository (Types/Runner/CodeRepositoryRunner).
 *
 * With the switch on and no rule, OneUptime AI investigates every problem
 * and opens a pull request for each, in any connected repository - the rule
 * "turned on by default". With rules, only the problems a rule matches are
 * worked on, each as its rules say:
 *
 *   - investigated when a matching rule investigates;
 *   - fixed when a matching rule fixes - asking first when any of them asks
 *     (the careful answer wins) - in the repositories those rules name, or
 *     any connected one when one of them names none;
 *   - after the shortest wait of the matching rules, counted from when the
 *     problem was first found, and only while it is still being found;
 *   - with the LLM provider of the first of them by name that picks one.
 *
 * A kind of problem whose fix is only as good as the verdict on it - a
 * failing operation may fail on purpose (a refused sign-in recorded as an
 * error) - waits for its investigation before OneUptime AI opens a pull
 * request on its own (fixAfterVerdictInsightTypes): only a problem the
 * investigation classified as a fault of the code is fixed without asking,
 * and a person can still ask for the fix from the insight.
 *
 * Enable AI, the project's one AI switch, comes first: with it off, nothing
 * here runs. Pure, so the server and the Dashboard import it alike.
 */

export enum TelemetryAiLane {
  Profile = "Profile",
  Trace = "Trace",
}

// The project switch of each lane.
export type TelemetryAiSwitchColumn =
  | "enableAutomaticProfileRemediation"
  | "enableAutomaticTraceRemediation";

export interface TelemetryAiLaneDefinition {
  lane: TelemetryAiLane;
  // Its AI rules: AutoRemediationRule.triggerEntityType.
  triggerEntityType: AutoRemediationTriggerEntity;
  // The problems OneUptime files for it (AIInsight.insightType).
  insightTypes: ReadonlyArray<AIInsightType>;
  // On: OneUptime looks for those problems, and OneUptime AI works on them.
  switchColumn: TelemetryAiSwitchColumn;
  /*
   * How often its detector looks, in minutes. A problem not found again for
   * longer than STILL_FOUND_TICKS of these is no longer being found: it is
   * not worked on until it is found again.
   */
  scanEveryMinutes: number;
  /*
   * Where its product lives in the Dashboard, under the project: its AI
   * section is <dashboardPath>/ai/insights, /ai/logs and /ai/settings.
   */
  dashboardPath: string;
  /*
   * Its insight types whose pull request OneUptime AI opens on its own only
   * once the investigation classified the problem as a fault of the code
   * (see the module comment).
   */
  fixAfterVerdictInsightTypes: ReadonlyArray<AIInsightType>;
}

export const TELEMETRY_AI_LANES: Readonly<
  Record<TelemetryAiLane, TelemetryAiLaneDefinition>
> = {
  [TelemetryAiLane.Profile]: {
    lane: TelemetryAiLane.Profile,
    triggerEntityType: AutoRemediationTriggerEntity.Profile,
    insightTypes: [AIInsightType.ProfileHotspot],
    switchColumn: "enableAutomaticProfileRemediation",
    scanEveryMinutes: 60,
    dashboardPath: "profiles",
    fixAfterVerdictInsightTypes: [],
  },
  [TelemetryAiLane.Trace]: {
    lane: TelemetryAiLane.Trace,
    triggerEntityType: AutoRemediationTriggerEntity.Trace,
    insightTypes: [
      AIInsightType.TraceSlowOperation,
      AIInsightType.TraceFailingOperation,
      AIInsightType.TraceMissingTracing,
    ],
    switchColumn: "enableAutomaticTraceRemediation",
    scanEveryMinutes: 60,
    dashboardPath: "traces",
    fixAfterVerdictInsightTypes: [AIInsightType.TraceFailingOperation],
  },
};

export const TELEMETRY_AI_LANE_LIST: ReadonlyArray<TelemetryAiLane> =
  Object.values(TelemetryAiLane);

/*
 * A problem is still being found while its detector found it on one of
 * this many of its last looks: one missed look (a slow scan, a restart) is
 * not the problem going away.
 */
export const STILL_FOUND_TICKS: number = 2;

/*
 * The most pull requests OneUptime AI opens on its own for a project's
 * telemetry problems in a day (UTC), whatever its rules say: a project that
 * connects its profiles for the first time may hold many findings at once,
 * and a team reviews a few pull requests a day, not a queue of them. Each
 * repository's own cap on open AI pull requests applies too, and the
 * project's daily AI limits. A person can always open more from an insight.
 */
export const TELEMETRY_AI_MAX_AUTOMATIC_FIXES_PER_DAY: number = 5;

/*
 * How many problems of a lane one look works on, newest first: the rest
 * wait for the next look.
 */
export const TELEMETRY_AI_MAX_PROBLEMS_PER_SWEEP: number = 50;

// How often the insight scanner looks (Workers' AIInsight:ScanForInsights).
export const INSIGHT_SCAN_EVERY_MINUTES: number = 15;

/*
 * Whether the scanner's look at this moment is the lane's: a lane that
 * looks once an hour looks on the scanner's first look of each hour (UTC).
 * Its detectors and the work on its problems both run then.
 */
export function isTelemetryAiLaneScanTick(
  lane: TelemetryAiLane,
  now: Date,
): boolean {
  const every: number = TELEMETRY_AI_LANES[lane].scanEveryMinutes;
  const minuteOfDay: number = now.getUTCHours() * 60 + now.getUTCMinutes();

  return minuteOfDay % every < INSIGHT_SCAN_EVERY_MINUTES;
}

/*
 * The wait a rule's form starts on when "Only if still found after a wait"
 * is picked: one look of the lane - slow code found again on the next look.
 * A shorter wait reads as more than the lane can tell apart: nothing is
 * looked at again before then.
 */
export function getTelemetryAiDefaultWaitMinutes(
  lane: TelemetryAiLane,
): number {
  return TELEMETRY_AI_LANES[lane].scanEveryMinutes;
}

/*
 * The triage verdict that lets a waiting fix open, as the triage writes it
 * onto the insight (ExceptionAIClassification, the same vocabulary).
 */
export const TELEMETRY_AI_CODE_FAULT_CLASSIFICATION: string = ErrorClass.CodeFault;

/*
 * Whether OneUptime AI opens the pull request for an insight of this type on
 * its own only after the investigation's verdict (the lane's
 * fixAfterVerdictInsightTypes). False for a type no lane works on.
 */
export function doesTelemetryAiFixWaitForVerdict(insightType: unknown): boolean {
  const lane: TelemetryAiLane | null =
    getTelemetryAiLaneOfInsightType(insightType);

  return Boolean(
    lane &&
      (
        TELEMETRY_AI_LANES[lane]
          .fixAfterVerdictInsightTypes as ReadonlyArray<unknown>
      ).includes(insightType),
  );
}

/*
 * Where a problem's automatic fix stands with the investigation's verdict:
 * it needs none (NotNeeded), the verdict is not in yet (Pending), or the
 * investigation classified the problem as a fault of the code (CodeFault)
 * or as anything else (NotCodeFault - a person may still ask for the fix).
 */
export enum TelemetryAiFixVerdict {
  NotNeeded = "NotNeeded",
  Pending = "Pending",
  CodeFault = "CodeFault",
  NotCodeFault = "NotCodeFault",
}

/*
 * The verdict a problem's fix waits on, from its type and what its
 * investigation concluded: the triage's classification (ExceptionAI
 * Classification - "code-fault" is the one that lets the fix open), or none
 * while the triage has not completed.
 */
export function getTelemetryAiFixVerdict(data: {
  insightType: unknown;
  hasTriageCompleted: boolean;
  classification: unknown;
}): TelemetryAiFixVerdict {
  if (!doesTelemetryAiFixWaitForVerdict(data.insightType)) {
    return TelemetryAiFixVerdict.NotNeeded;
  }

  if (!data.hasTriageCompleted) {
    return TelemetryAiFixVerdict.Pending;
  }

  return data.classification === TELEMETRY_AI_CODE_FAULT_CLASSIFICATION
    ? TelemetryAiFixVerdict.CodeFault
    : TelemetryAiFixVerdict.NotCodeFault;
}

// What every lane's rules match on: the service the problem is in.
export const TELEMETRY_AI_CRITERIA_FIELDS: ReadonlyArray<string> =
  TELEMETRY_AI_RULE_CRITERIA_FIELDS;

export function isTelemetryAiLane(value: unknown): value is TelemetryAiLane {
  return (
    typeof value === "string" &&
    (TELEMETRY_AI_LANE_LIST as ReadonlyArray<string>).includes(value)
  );
}

// The lane an insight type belongs to, or null for one no lane works on.
export function getTelemetryAiLaneOfInsightType(
  insightType: unknown,
): TelemetryAiLane | null {
  for (const lane of TELEMETRY_AI_LANE_LIST) {
    if (
      (
        TELEMETRY_AI_LANES[lane].insightTypes as ReadonlyArray<unknown>
      ).includes(insightType)
    ) {
      return lane;
    }
  }

  return null;
}

/*
 * Where an insight opens in the Dashboard, after the Dashboard's own
 * address: in its lane's product (the Profiler's AI section for slow code),
 * or in AI Insights for every other kind.
 */
export function getAiInsightDashboardPath(data: {
  projectId: string;
  insightId: string;
  insightType?: unknown;
}): string {
  const lane: TelemetryAiLane | null = getTelemetryAiLaneOfInsightType(
    data.insightType,
  );

  return lane
    ? `/${data.projectId}/${TELEMETRY_AI_LANES[lane].dashboardPath}/ai/insights/${data.insightId}`
    : `/${data.projectId}/ai/insights/${data.insightId}`;
}

// The lane of an AI rule's triggerEntityType, or null for incidents and alerts.
export function getTelemetryAiLaneOfTrigger(
  triggerEntityType: unknown,
): TelemetryAiLane | null {
  for (const lane of TELEMETRY_AI_LANE_LIST) {
    if (TELEMETRY_AI_LANES[lane].triggerEntityType === triggerEntityType) {
      return lane;
    }
  }

  return null;
}

// Every insight type some lane works on.
export function getTelemetryAiInsightTypes(): Array<AIInsightType> {
  return TELEMETRY_AI_LANE_LIST.flatMap(
    (lane: TelemetryAiLane): ReadonlyArray<AIInsightType> => {
      return TELEMETRY_AI_LANES[lane].insightTypes;
    },
  );
}

// What the decision reads off an AI rule of the lane that matched.
export interface TelemetryAiRuleFacts {
  _id?: unknown;
  name?: unknown;
  investigates?: unknown;
  fixes?: unknown;
  executionMode?: unknown;
  onlyIfOpenAfterMinutes?: unknown;
  codeRepositories?: unknown;
  externalMcpServers?: unknown;
  llmProviderId?: unknown;
}

// Why OneUptime AI does nothing with a problem.
export enum TelemetryAiSkip {
  // Enable AI, the project's one AI switch, is off.
  AiOff = "AiOff",
  // The lane's switch is off.
  LaneOff = "LaneOff",
  /*
   * The rules could not be read: nothing is done that a rule may have kept
   * out.
   */
  RulesUnreadable = "RulesUnreadable",
  // The lane has rules, and none of them matches the problem.
  NoMatchingRule = "NoMatchingRule",
}

export interface TelemetryAiWork {
  // Why nothing is done, or null.
  skip: TelemetryAiSkip | null;
  investigate: boolean;
  fix: AiRuleFix;
  // From when the problem was first found; 0 is right away.
  waitMinutes: number;
  // What the investigation may read: the matching rules' repositories.
  investigationRepositories: CodeRepositoryAllowance;
  // The MCP servers the investigation may use (their tools that read).
  mcpServers: ExternalMcpServerAllowance;
  // Where a pull request may open: the fixing rules' repositories.
  repositories: CodeRepositoryAllowance;
  // The rules' pick: "" for the project's default, else the global one.
  llmProviderId: string;
  // The matching rules that decided, for what a log line says.
  rules: Array<TelemetryAiRuleFacts>;
}

const NOTHING: (skip: TelemetryAiSkip) => TelemetryAiWork = (
  skip: TelemetryAiSkip,
): TelemetryAiWork => {
  return {
    skip,
    investigate: false,
    fix: AiRuleFix.DoNotFix,
    waitMinutes: 0,
    investigationRepositories: NO_CODE_REPOSITORY,
    mcpServers: NO_EXTERNAL_MCP_SERVER,
    repositories: NO_CODE_REPOSITORY,
    llmProviderId: "",
    rules: [],
  };
};

/*
 * What OneUptime AI does with one problem a lane found, from the project's
 * two switches and the lane's rules (see the module comment). `rules` is
 * null when they could not be read; `rulesSetUp` is whether the lane has any
 * enabled rule, and `matchingRules` the enabled ones the problem matches.
 */
export function decideTelemetryAiWork(data: {
  isAiEnabled: boolean;
  isLaneOn: boolean;
  rules: {
    rulesSetUp: boolean;
    matchingRules: ReadonlyArray<TelemetryAiRuleFacts>;
  } | null;
}): TelemetryAiWork {
  if (!data.isAiEnabled) {
    return NOTHING(TelemetryAiSkip.AiOff);
  }

  if (!data.isLaneOn) {
    return NOTHING(TelemetryAiSkip.LaneOff);
  }

  if (!data.rules) {
    return NOTHING(TelemetryAiSkip.RulesUnreadable);
  }

  // The rule turned on by default: investigate and fix, anywhere, now.
  if (!data.rules.rulesSetUp) {
    return {
      skip: null,
      investigate: true,
      fix: AiRuleFix.WithoutAsking,
      waitMinutes: 0,
      investigationRepositories: EVERY_CODE_REPOSITORY,
      mcpServers: EVERY_EXTERNAL_MCP_SERVER,
      repositories: EVERY_CODE_REPOSITORY,
      llmProviderId: "",
      rules: [],
    };
  }

  const matching: Array<TelemetryAiRuleFacts> = [...data.rules.matchingRules];

  if (matching.length === 0) {
    return NOTHING(TelemetryAiSkip.NoMatchingRule);
  }

  const investigating: Array<TelemetryAiRuleFacts> = matching.filter(
    (rule: TelemetryAiRuleFacts): boolean => {
      return doesAiRuleInvestigate(rule);
    },
  );

  const fixing: Array<TelemetryAiRuleFacts> = matching.filter(
    (rule: TelemetryAiRuleFacts): boolean => {
      return doesAiRuleFix(rule);
    },
  );

  const asksFirst: boolean = fixing.some(
    (rule: TelemetryAiRuleFacts): boolean => {
      return getAiRuleFix(rule) === AiRuleFix.AskFirst;
    },
  );

  const fix: AiRuleFix =
    fixing.length === 0
      ? AiRuleFix.DoNotFix
      : asksFirst
        ? AiRuleFix.AskFirst
        : AiRuleFix.WithoutAsking;

  return {
    skip: null,
    investigate: investigating.length > 0,
    fix,
    waitMinutes: getShortestInvestigationRuleWait(
      matching.map((rule: TelemetryAiRuleFacts): unknown => {
        return rule.onlyIfOpenAfterMinutes;
      }),
    ),
    investigationRepositories:
      investigating.length === 0
        ? NO_CODE_REPOSITORY
        : getCodeRepositoryAllowance({
            rulesSetUp: true,
            matchingRules: investigating,
          }),
    mcpServers:
      investigating.length === 0
        ? NO_EXTERNAL_MCP_SERVER
        : getExternalMcpServerAllowance({
            rulesSetUp: true,
            matchingRules: investigating,
          }),
    repositories:
      fixing.length === 0
        ? NO_CODE_REPOSITORY
        : getCodeRepositoryAllowance({
            rulesSetUp: true,
            matchingRules: fixing,
          }),
    llmProviderId: getRulesLlmProviderId(matching),
    rules: matching,
  };
}

// Whether the work does anything at all.
export function isTelemetryAiWorkToDo(work: TelemetryAiWork): boolean {
  return (
    work.skip === null && (work.investigate || work.fix !== AiRuleFix.DoNotFix)
  );
}

/*
 * A problem as the routing reads it off its insight: when it was first and
 * last found, and what OneUptime AI already did for it.
 */
export interface TelemetryAiProblemState {
  firstSeenAt: Date;
  lastSeenAt: Date;
  // A triage run was started (whatever came of it).
  hasInvestigation: boolean;
  // A fix (a Code task) was started, or a person already opened one.
  hasFix: boolean;
  // Resolved or dismissed by a person: never worked on again.
  isClosed: boolean;
  /*
   * Where its automatic fix stands with the investigation's verdict
   * (getTelemetryAiFixVerdict); absent is NotNeeded.
   */
  fixVerdict?: TelemetryAiFixVerdict | undefined;
}

export interface TelemetryAiNextSteps {
  // Start the triage now.
  startInvestigation: boolean;
  // Start the fix - a Code task in a repository - now.
  startFix: boolean;
  // The insight offers the fix: a person opens the pull request.
  offerFix: boolean;
  // The rules' wait is not over yet: look again on a later scan.
  isWaiting: boolean;
  // The problem is no longer being found: nothing starts for it.
  isNoLongerFound: boolean;
  /*
   * The pull request OneUptime AI would open on its own waits for the
   * investigation's verdict: looked at again on a later scan.
   */
  isWaitingForVerdict: boolean;
}

const NO_STEPS: TelemetryAiNextSteps = {
  startInvestigation: false,
  startFix: false,
  offerFix: false,
  isWaiting: false,
  isNoLongerFound: false,
  isWaitingForVerdict: false,
};

// The minutes after which a problem not found again is no longer found.
export function getStillFoundMinutes(lane: TelemetryAiLane): number {
  return TELEMETRY_AI_LANES[lane].scanEveryMinutes * STILL_FOUND_TICKS;
}

/*
 * What to do for one problem now, from the work its rules decided and what
 * was already done: one triage and one fix per problem, ever - a problem
 * found again refreshes its insight and changes nothing else. A fix that
 * waits for the investigation's verdict opens on its own only once the
 * verdict says the code is at fault, and is investigated for that verdict
 * even when its rules would only fix.
 */
export function getTelemetryAiNextSteps(data: {
  lane: TelemetryAiLane;
  work: TelemetryAiWork;
  problem: TelemetryAiProblemState;
  now: Date;
}): TelemetryAiNextSteps {
  if (data.problem.isClosed || !isTelemetryAiWorkToDo(data.work)) {
    return NO_STEPS;
  }

  const sinceLastFoundMs: number =
    data.now.getTime() - data.problem.lastSeenAt.getTime();

  if (sinceLastFoundMs > getStillFoundMinutes(data.lane) * 60 * 1000) {
    return { ...NO_STEPS, isNoLongerFound: true };
  }

  const waitMs: number =
    getInvestigationRuleWaitMinutes(data.work.waitMinutes) * 60 * 1000;

  if (data.now.getTime() - data.problem.firstSeenAt.getTime() < waitMs) {
    return { ...NO_STEPS, isWaiting: true };
  }

  const verdict: TelemetryAiFixVerdict =
    data.problem.fixVerdict || TelemetryAiFixVerdict.NotNeeded;
  const wantsFixWithoutAsking: boolean =
    data.work.fix === AiRuleFix.WithoutAsking && !data.problem.hasFix;
  const needsVerdict: boolean =
    wantsFixWithoutAsking && verdict !== TelemetryAiFixVerdict.NotNeeded;

  return {
    startInvestigation:
      (data.work.investigate || needsVerdict) &&
      !data.problem.hasInvestigation,
    startFix:
      wantsFixWithoutAsking &&
      (verdict === TelemetryAiFixVerdict.NotNeeded ||
        verdict === TelemetryAiFixVerdict.CodeFault),
    offerFix: data.work.fix === AiRuleFix.AskFirst && !data.problem.hasFix,
    isWaiting: false,
    isNoLongerFound: false,
    isWaitingForVerdict:
      wantsFixWithoutAsking && verdict === TelemetryAiFixVerdict.Pending,
  };
}
