import { sha256Hex } from "../AutoRemediation/RemediationPlanFingerprint";
import SecuritySeverity from "../SecuritySeverity";

/*
 * ONEUPTIME AI IN DATA SECURITY: WHAT IT WORKS ON, AND WHAT IT MAY DO
 * WITHOUT ASKING (#10364) - the one reading, for the engine, the rule
 * service, the approval routes, the Dashboard and the docs tests alike.
 *
 * "Make it an AI native product": the work on an issue starts when the
 * issue opens, not when someone finds it. OneUptime AI does four kinds of
 * work on a Data Security issue (DataSecurityAiWork):
 *
 *   - Analyze: what is wrong, what it puts at risk, how to fix it. It
 *     changes nothing, so it either runs on its own or not at all.
 *   - Contain: stop the data spreading while the cause is fixed - a scrub
 *     rule for telemetry, and later a response action on a cloud store.
 *   - Fix: a pull request that fixes the cause in code.
 *   - Judge: a verdict on a finding, an owner for a store (#10374) - and
 *     the owner rule that keeps stores like it owned.
 *
 * Autonomy is a dial per kind of work (DataSecurityAiAutonomy): Off,
 * Suggest (a proposal waits for a person) or Without asking. The project's
 * AI rules set it: an AI rule (AutoRemediationRule) whose trigger is a
 * Data Security issue matches issues by their check, severity, store and
 * data, and sets each kind of work. With no such rule the project's
 * defaults apply (getDefaultDataSecurityAiWork): analyze Critical and High
 * issues, and suggest everything else. With rules, only the issues a rule
 * matches are worked on, each the way its rules say - the careful answer
 * winning where two rules disagree, as for every AI rule.
 *
 * What a kind of work may change without asking is held to what the change
 * is (DataSecurityAiChangeSafety), whatever a rule says:
 *
 *   - a change that only hides data in OneUptime, and is undone by
 *     deleting what it made (a scrub rule), runs without asking where a
 *     rule says so - and, out of the box, only where the action itself can
 *     prove it is safe (a secret no one reads, #10366's conditions);
 *   - a pull request, or a judgement OneUptime records, runs without asking
 *     where a rule says so: nothing merges on its own, and a judgement is
 *     set back with one press;
 *   - a change of who can reach data runs without asking only where a rule
 *     names that very action, never by default;
 *   - deleting or dropping data, paging people, and changing who is told
 *     about a store - an owner, who gets its email and its issues, and to
 *     whom the wrong one leaks what the store holds (#10374) - always ask.
 *
 * A riskier change - one that changes access, deletes or pages - needs two
 * people to approve it where the project asks for two
 * (Project.requireTwoApprovalsForRiskierFixes), as an incident's riskier
 * fix does (Types/AutoRemediation/RemediationApprovals), and then never runs
 * without asking. Changes made without asking stop for the hour after
 * DATA_SECURITY_AI_CHANGES_WITHOUT_ASKING_PER_HOUR of them: the circuit
 * breaker proposes the rest.
 *
 * Checks decide, never OneUptime AI's own word: a change that was made is
 * proven by the issue's own check passing, and an issue resolves only when
 * its check passes, as it always did. Everything OneUptime AI proposes, does
 * and undoes is on the issue's and the store's timelines, and can be undone.
 *
 * With Enable AI off, or "Work on new Data Security issues" off
 * (Project.enableAutomaticDataSecurityAi), nothing here runs on its own;
 * every button that runs when a person presses it keeps working.
 *
 * Pure, so the server and the Dashboard import it alike.
 */

export enum DataSecurityAiWork {
  Analyze = "Analyze",
  Contain = "Contain",
  Fix = "Fix",
  Judge = "Judge",
}

// In the order a person reads them, and the rule form asks them.
export const DATA_SECURITY_AI_WORKS: ReadonlyArray<DataSecurityAiWork> = [
  DataSecurityAiWork.Analyze,
  DataSecurityAiWork.Contain,
  DataSecurityAiWork.Fix,
  DataSecurityAiWork.Judge,
];

/*
 * How far OneUptime AI goes with one kind of work. These strings are
 * stored on AI rules and sent by the API and Terraform, so they are a wire
 * contract: never rename them.
 */
export enum DataSecurityAiAutonomy {
  // Not on its own. The buttons a person presses still work.
  Off = "Off",
  // Proposed, for a person to approve or dismiss.
  Suggest = "Suggest",
  // Done on its own, on the timeline, and undone with one press.
  WithoutAsking = "WithoutAsking",
}

export const DATA_SECURITY_AI_AUTONOMIES: ReadonlyArray<DataSecurityAiAutonomy> =
  [
    DataSecurityAiAutonomy.Off,
    DataSecurityAiAutonomy.Suggest,
    DataSecurityAiAutonomy.WithoutAsking,
  ];

export function isDataSecurityAiWork(
  value: unknown,
): value is DataSecurityAiWork {
  return (
    typeof value === "string" &&
    (DATA_SECURITY_AI_WORKS as ReadonlyArray<string>).includes(value)
  );
}

export function isDataSecurityAiAutonomy(
  value: unknown,
): value is DataSecurityAiAutonomy {
  return (
    typeof value === "string" &&
    (DATA_SECURITY_AI_AUTONOMIES as ReadonlyArray<string>).includes(value)
  );
}

/*
 * What a Data Security AI rule matches an issue on, besides the service of
 * a store that is a service's telemetry (Types/AI/AiRuleCriteria adds the
 * telemetry rules' service fields): each a column of the rule
 * (AutoRemediationRule), read by Utils/DataSecurity/DataSecurityAiRuleMatch.
 */
export const DATA_SECURITY_AI_RULE_ISSUE_CRITERIA_FIELDS: ReadonlyArray<string> =
  [
    "dataSecurityChecks",
    "dataSecurityCheckGroups",
    "dataSecuritySeverities",
    "dataStoreSensitivities",
    "dataStoreKinds",
    "dataStoreProviders",
    "dataStoreEnvironments",
    "dataStoreLabels",
    "dataCategories",
  ];

// The AI rule column each kind of work is set in (AutoRemediationRule).
export type DataSecurityAiWorkColumn =
  | "dataSecurityAnalyze"
  | "dataSecurityContain"
  | "dataSecurityFix"
  | "dataSecurityJudge";

export const DATA_SECURITY_AI_WORK_COLUMN: Readonly<
  Record<DataSecurityAiWork, DataSecurityAiWorkColumn>
> = {
  [DataSecurityAiWork.Analyze]: "dataSecurityAnalyze",
  [DataSecurityAiWork.Contain]: "dataSecurityContain",
  [DataSecurityAiWork.Fix]: "dataSecurityFix",
  [DataSecurityAiWork.Judge]: "dataSecurityJudge",
};

export const DATA_SECURITY_AI_WORK_COLUMNS: ReadonlyArray<DataSecurityAiWorkColumn> =
  DATA_SECURITY_AI_WORKS.map(
    (work: DataSecurityAiWork): DataSecurityAiWorkColumn => {
      return DATA_SECURITY_AI_WORK_COLUMN[work];
    },
  );

/*
 * The answers a rule may give each kind of work. An analysis changes
 * nothing, so there is nothing to approve: it runs on its own, or not.
 */
export const DATA_SECURITY_AI_WORK_AUTONOMIES: Readonly<
  Record<DataSecurityAiWork, ReadonlyArray<DataSecurityAiAutonomy>>
> = {
  [DataSecurityAiWork.Analyze]: [
    DataSecurityAiAutonomy.Off,
    DataSecurityAiAutonomy.WithoutAsking,
  ],
  [DataSecurityAiWork.Contain]: DATA_SECURITY_AI_AUTONOMIES,
  [DataSecurityAiWork.Fix]: DATA_SECURITY_AI_AUTONOMIES,
  [DataSecurityAiWork.Judge]: DATA_SECURITY_AI_AUTONOMIES,
};

/*
 * What a Data Security AI rule does with a kind of work it says nothing
 * about - an API or Terraform write that leaves a column out: what the
 * project does with no rule at all, for every issue the rule matches. The
 * rule service writes these on create, so every rule says all four.
 */
export const DATA_SECURITY_AI_RULE_DEFAULT_AUTONOMY: Readonly<
  Record<DataSecurityAiWork, DataSecurityAiAutonomy>
> = {
  [DataSecurityAiWork.Analyze]: DataSecurityAiAutonomy.WithoutAsking,
  [DataSecurityAiWork.Contain]: DataSecurityAiAutonomy.Suggest,
  [DataSecurityAiWork.Fix]: DataSecurityAiAutonomy.Suggest,
  [DataSecurityAiWork.Judge]: DataSecurityAiAutonomy.Suggest,
};

// The severities the project analyzes on its own, with no rule.
export const DATA_SECURITY_AI_DEFAULT_ANALYZED_SEVERITIES: ReadonlyArray<SecuritySeverity> =
  [SecuritySeverity.Critical, SecuritySeverity.High];

/*
 * What the change a proposal makes is, for what may run without asking
 * and how many people approve it. Stored on each proposal.
 */
export enum DataSecurityAiChangeSafety {
  // Changes nothing: an analysis.
  ReadOnly = "ReadOnly",
  // Hides data in OneUptime only, undone by deleting what it made.
  MaskOnly = "MaskOnly",
  // A pull request for review: nothing merges on its own.
  OpensPullRequest = "OpensPullRequest",
  // A judgement OneUptime records - a verdict - set back with one press.
  RecordsJudgement = "RecordsJudgement",
  // Changes who can reach data: a cloud store's access.
  ChangesAccess = "ChangesAccess",
  // Deletes or drops data, or what holds it.
  Deletes = "Deletes",
  // Pages or messages people.
  Pages = "Pages",
  /*
   * Changes who is told about a store: an owner, or the owner rule that
   * makes owners (#10374). An owner gets the store's email and is who its
   * issues are routed to, so the wrong one is told what the store holds:
   * a person always approves it. It is no riskier change - it reaches no
   * data and is undone with one press - so one approval is enough.
   */
  ChangesWhoIsTold = "ChangesWhoIsTold",
  /*
   * Changes a cloud store's settings through its cloud connection - its
   * versioning, its recovery, how it takes connections - for the stores of
   * a group of issues one mistake made (#10370). It reaches the customer's
   * own cloud, so a person always approves it. A change of who can reach
   * the data through the cloud (Block public access, Revoke sharing) is
   * ChangesAccess instead, and asks for the same reason.
   */
  ChangesCloudSettings = "ChangesCloudSettings",
}

// The changes that never run without asking, whatever a rule says.
export const DATA_SECURITY_AI_ALWAYS_ASKS: ReadonlyArray<DataSecurityAiChangeSafety> =
  [
    DataSecurityAiChangeSafety.Deletes,
    DataSecurityAiChangeSafety.Pages,
    DataSecurityAiChangeSafety.ChangesWhoIsTold,
    DataSecurityAiChangeSafety.ChangesCloudSettings,
  ];

/*
 * The riskier changes: two people approve one where the project asks for
 * two, and a rule must name one before it runs without asking.
 */
export const DATA_SECURITY_AI_RISKIER_CHANGES: ReadonlyArray<DataSecurityAiChangeSafety> =
  [
    DataSecurityAiChangeSafety.ChangesAccess,
    DataSecurityAiChangeSafety.Deletes,
    DataSecurityAiChangeSafety.Pages,
  ];

export function isRiskierDataSecurityAiChange(
  safety: DataSecurityAiChangeSafety | string | undefined,
): boolean {
  return (
    DATA_SECURITY_AI_RISKIER_CHANGES as ReadonlyArray<string | undefined>
  ).includes(safety);
}

/*
 * The changes OneUptime AI makes without asking in one project in an hour,
 * at most: the rest are proposed (the circuit breaker).
 */
export const DATA_SECURITY_AI_CHANGES_WITHOUT_ASKING_PER_HOUR: number = 10;

/*
 * How many issues of one store, and of one project, OneUptime AI works on
 * in a day (UTC), at most: a store whose checks flap, or a scan that opens
 * hundreds of issues at once, never runs the project's AI dry.
 */
export const DATA_SECURITY_AI_ISSUES_PER_STORE_PER_DAY: number = 25;
export const DATA_SECURITY_AI_ISSUES_PER_PROJECT_PER_DAY: number = 500;

/*
 * A proposal's life. These strings are stored, read by the API and shown
 * in the Dashboard: never rename them.
 */
export enum DataSecurityAiProposalStatus {
  // Waiting for a person: approve or dismiss.
  Proposed = "Proposed",
  // Approved; the change is being made, as the person who approved it.
  Approved = "Approved",
  // Made, after a person approved it.
  Applied = "Applied",
  // Made by OneUptime AI on its own, as a rule (or the defaults) allows.
  AppliedWithoutAsking = "AppliedWithoutAsking",
  // A person said no, with a reason.
  Dismissed = "Dismissed",
  // No longer needed: its issue resolved, or was accepted or set aside.
  Expired = "Expired",
  // Made, then undone.
  Undone = "Undone",
  // Making it failed: the reason is on it, and nothing changed.
  Failed = "Failed",
}

export const DATA_SECURITY_AI_PROPOSAL_STATUSES: ReadonlyArray<DataSecurityAiProposalStatus> =
  Object.values(DataSecurityAiProposalStatus);

// Waiting for a person, in the inbox's Waiting for you.
export function isDataSecurityAiProposalWaiting(
  status: DataSecurityAiProposalStatus | string | undefined,
): boolean {
  return status === DataSecurityAiProposalStatus.Proposed;
}

// A change that was made and stands: Undo takes it back.
export function isDataSecurityAiProposalUndoable(
  status: DataSecurityAiProposalStatus | string | undefined,
): boolean {
  return (
    status === DataSecurityAiProposalStatus.Applied ||
    status === DataSecurityAiProposalStatus.AppliedWithoutAsking
  );
}

/*
 * The kinds of change OneUptime AI proposes for a Data Security issue. One
 * per action the engine knows (Server/Utils/AI/DataSecurity/Actions): a new
 * kind is a value here, its definition below, and its action registered on
 * the server - that is all the engine, the routes and the inbox need.
 * Stored, and sent by the API: never rename one.
 */
export enum DataSecurityAiProposalKind {
  /*
   * Scrub It, for a telemetry issue: the scrub rules that hide its data
   * type at each place it was found, from now on (TelemetryScrubCoverage).
   */
  ScrubTelemetry = "ScrubTelemetry",
  /*
   * Owners for one store that has none (#10374): the people and teams the
   * evidence names - its cloud tags, the services that use it, the code
   * owners of the file that declares it, who changed it - as OneUptime AI
   * picks them from it. A sensitive store's is for its "Nobody owns this
   * sensitive store" issue; another store's is for the store alone.
   */
  SetStoreOwners = "SetStoreOwners",
  /*
   * An owner rule (DataStoreOwnerRule) for the fact several stores'
   * owners rest on - a cloud tag, a name prefix - so the next store like
   * them is owned too (#10374). It is for no one issue or store.
   */
  CreateOwnerRule = "CreateOwnerRule",
  /*
   * The cause of a group of issues one mistake made, fixed once (#10370):
   * one pull request to the module or file that declares the group's
   * stores. It is for the group, and names no one issue.
   */
  FixIssueGroupInCode = "FixIssueGroupInCode",
  /*
   * ...and, for the group's stores made in the console, the response action
   * that fixes the check, on every one of them through its cloud connection:
   * one approval. A store marked Public By Design, or one the fix would
   * break, is left out.
   */
  FixIssueGroupInCloud = "FixIssueGroupInCloud",
}

// The kinds of change that fix a group of issues' cause, for the group alone (#10370).
export const DATA_SECURITY_AI_ISSUE_GROUP_PROPOSAL_KINDS: ReadonlyArray<DataSecurityAiProposalKind> =
  [
    DataSecurityAiProposalKind.FixIssueGroupInCode,
    DataSecurityAiProposalKind.FixIssueGroupInCloud,
  ];

export function isDataSecurityAiIssueGroupProposalKind(
  kind: DataSecurityAiProposalKind | string | undefined,
): boolean {
  return (
    DATA_SECURITY_AI_ISSUE_GROUP_PROPOSAL_KINDS as ReadonlyArray<
      string | undefined
    >
  ).includes(kind);
}

/*
 * The kinds of change about who owns the project's stores (#10374): Owners
 * to review lists them, apart from what waits for an issue. A store's
 * owners are proposed for its "Nobody owns this sensitive store" issue
 * where it has one, and for the store alone where it has none; an owner
 * rule is for no one issue or store.
 */
export const DATA_SECURITY_AI_OWNER_PROPOSAL_KINDS: ReadonlyArray<DataSecurityAiProposalKind> =
  [
    DataSecurityAiProposalKind.SetStoreOwners,
    DataSecurityAiProposalKind.CreateOwnerRule,
  ];

export function isDataSecurityAiOwnerProposalKind(
  kind: DataSecurityAiProposalKind | string | undefined,
): boolean {
  return (
    DATA_SECURITY_AI_OWNER_PROPOSAL_KINDS as ReadonlyArray<string | undefined>
  ).includes(kind);
}

export interface DataSecurityAiProposalKindDefinition {
  kind: DataSecurityAiProposalKind;
  // The kind of work it is, whose autonomy decides it.
  work: DataSecurityAiWork;
  // What it changes, for what may run without asking.
  safety: DataSecurityAiChangeSafety;
}

export const DATA_SECURITY_AI_PROPOSAL_KINDS: Readonly<
  Record<DataSecurityAiProposalKind, DataSecurityAiProposalKindDefinition>
> = {
  [DataSecurityAiProposalKind.ScrubTelemetry]: {
    kind: DataSecurityAiProposalKind.ScrubTelemetry,
    work: DataSecurityAiWork.Contain,
    safety: DataSecurityAiChangeSafety.MaskOnly,
  },
  [DataSecurityAiProposalKind.SetStoreOwners]: {
    kind: DataSecurityAiProposalKind.SetStoreOwners,
    work: DataSecurityAiWork.Judge,
    safety: DataSecurityAiChangeSafety.ChangesWhoIsTold,
  },
  [DataSecurityAiProposalKind.CreateOwnerRule]: {
    kind: DataSecurityAiProposalKind.CreateOwnerRule,
    work: DataSecurityAiWork.Judge,
    safety: DataSecurityAiChangeSafety.ChangesWhoIsTold,
  },
  [DataSecurityAiProposalKind.FixIssueGroupInCode]: {
    kind: DataSecurityAiProposalKind.FixIssueGroupInCode,
    work: DataSecurityAiWork.Fix,
    safety: DataSecurityAiChangeSafety.OpensPullRequest,
  },
  /*
   * A plan of Block public access or Revoke sharing says ChangesAccess
   * (DataSecurityAiPlannedChange.safety); any other cloud setting is this.
   */
  [DataSecurityAiProposalKind.FixIssueGroupInCloud]: {
    kind: DataSecurityAiProposalKind.FixIssueGroupInCloud,
    work: DataSecurityAiWork.Fix,
    safety: DataSecurityAiChangeSafety.ChangesCloudSettings,
  },
};

export function isDataSecurityAiProposalKind(
  value: unknown,
): value is DataSecurityAiProposalKind {
  return (
    typeof value === "string" &&
    (Object.values(DataSecurityAiProposalKind) as Array<string>).includes(value)
  );
}

/*
 * What a rule says about one kind of work: its column's answer, or the
 * rule's default for one it does not hold (a value no build of OneUptime
 * wrote reads as the default too, never as a wider answer). An answer the
 * work does not offer - Suggest for an analysis - reads as what it means
 * there: an analysis a person would approve is one that runs.
 */
export function getDataSecurityAiRuleAutonomy(
  rule: Partial<Record<DataSecurityAiWorkColumn, unknown>>,
  work: DataSecurityAiWork,
): DataSecurityAiAutonomy {
  const value: unknown = rule[DATA_SECURITY_AI_WORK_COLUMN[work]];

  if (!isDataSecurityAiAutonomy(value)) {
    return DATA_SECURITY_AI_RULE_DEFAULT_AUTONOMY[work];
  }

  if (
    work === DataSecurityAiWork.Analyze &&
    value === DataSecurityAiAutonomy.Suggest
  ) {
    return DataSecurityAiAutonomy.WithoutAsking;
  }

  return value;
}

/*
 * Why a Data Security AI rule cannot be saved like this, or null when it
 * can: each kind of work it sets is one of the answers the work offers,
 * and at least one is on - a rule that does nothing would still narrow
 * what OneUptime AI works on. `values` is what the write says, over the
 * rule as stored (an update), else over the defaults (a create).
 */
export const DATA_SECURITY_AI_RULE_DOES_NOTHING_MESSAGE: string =
  "A Data Security AI rule must turn on at least one kind of work: analyze, contain, fix or judge.";

export function getDataSecurityAiRuleProblem(
  values: Partial<Record<DataSecurityAiWorkColumn, unknown>>,
): string | null {
  for (const work of DATA_SECURITY_AI_WORKS) {
    const column: DataSecurityAiWorkColumn = DATA_SECURITY_AI_WORK_COLUMN[work];
    const value: unknown = values[column];

    if (value === undefined || value === null) {
      continue;
    }

    if (
      !isDataSecurityAiAutonomy(value) ||
      !DATA_SECURITY_AI_WORK_AUTONOMIES[work].includes(value)
    ) {
      return `${DATA_SECURITY_AI_WORK_TITLES[work]} must be one of ${DATA_SECURITY_AI_WORK_AUTONOMIES[
        work
      ].join(", ")}.`;
    }
  }

  const doesSomething: boolean = DATA_SECURITY_AI_WORKS.some(
    (work: DataSecurityAiWork): boolean => {
      return (
        getDataSecurityAiRuleAutonomy(values, work) !==
        DataSecurityAiAutonomy.Off
      );
    },
  );

  return doesSomething ? null : DATA_SECURITY_AI_RULE_DOES_NOTHING_MESSAGE;
}

// What a refusal calls each kind of work: its column's title in the API docs.
export const DATA_SECURITY_AI_WORK_TITLES: Readonly<
  Record<DataSecurityAiWork, string>
> = {
  [DataSecurityAiWork.Analyze]: "Data Security: Analyze",
  [DataSecurityAiWork.Contain]: "Data Security: Contain",
  [DataSecurityAiWork.Fix]: "Data Security: Fix",
  [DataSecurityAiWork.Judge]: "Data Security: Judge",
};

// What the decision reads off a Data Security AI rule that matched an issue.
export interface DataSecurityAiRuleFacts
  extends Partial<Record<DataSecurityAiWorkColumn, unknown>> {
  _id?: unknown;
  name?: unknown;
  llmProviderId?: unknown;
}

// Why OneUptime AI does nothing at all with an issue.
export enum DataSecurityAiSkip {
  // Enable AI, the project's one AI switch, is off.
  AiOff = "AiOff",
  // "Work on new Data Security issues" is off.
  AutomaticOff = "AutomaticOff",
  // The rules could not be read: nothing is done that a rule may keep out.
  RulesUnreadable = "RulesUnreadable",
  // The project has Data Security AI rules, and none matches the issue.
  NoMatchingRule = "NoMatchingRule",
}

// What one kind of work comes to for an issue, and who decided it.
export interface DataSecurityAiWorkDecision {
  autonomy: DataSecurityAiAutonomy;
  /*
   * Decided by the project's defaults (no Data Security AI rule is set
   * up), rather than by a rule: an action then runs without asking only
   * where it can prove it is safe (meetsDefaultConditions).
   */
  fromDefaults: boolean;
  // The rule that decided it, when a rule did.
  ruleId?: string | undefined;
  ruleName?: string | undefined;
}

export interface DataSecurityAiPlan {
  // Why nothing is done, or null.
  skip: DataSecurityAiSkip | null;
  works: Record<DataSecurityAiWork, DataSecurityAiWorkDecision>;
  // The rules' pick of LLM provider: "" for the project's default.
  llmProviderId: string;
  // The matching rules, by name: what a log line and the inbox say.
  rules: Array<DataSecurityAiRuleFacts>;
}

// What the decision reads off the issue.
export interface DataSecurityAiIssueFacts {
  severity?: SecuritySeverity | string | undefined;
}

const OFF: DataSecurityAiWorkDecision = {
  autonomy: DataSecurityAiAutonomy.Off,
  fromDefaults: false,
};

function nothing(skip: DataSecurityAiSkip): DataSecurityAiPlan {
  return {
    skip,
    works: {
      [DataSecurityAiWork.Analyze]: OFF,
      [DataSecurityAiWork.Contain]: OFF,
      [DataSecurityAiWork.Fix]: OFF,
      [DataSecurityAiWork.Judge]: OFF,
    },
    llmProviderId: "",
    rules: [],
  };
}

/*
 * What the project does with an issue when it has no Data Security AI rule:
 * analyze it when it is Critical or High, and suggest everything else. A
 * contain action may still run without asking where it proves it is safe
 * (fromDefaults: the action's own default conditions decide).
 */
export function getDefaultDataSecurityAiWork(
  issue: DataSecurityAiIssueFacts,
): Record<DataSecurityAiWork, DataSecurityAiWorkDecision> {
  const analyzes: boolean = (
    DATA_SECURITY_AI_DEFAULT_ANALYZED_SEVERITIES as ReadonlyArray<unknown>
  ).includes(issue.severity);

  return {
    [DataSecurityAiWork.Analyze]: {
      autonomy: analyzes
        ? DataSecurityAiAutonomy.WithoutAsking
        : DataSecurityAiAutonomy.Off,
      fromDefaults: true,
    },
    [DataSecurityAiWork.Contain]: {
      autonomy: DataSecurityAiAutonomy.WithoutAsking,
      fromDefaults: true,
    },
    [DataSecurityAiWork.Fix]: {
      autonomy: DataSecurityAiAutonomy.Suggest,
      fromDefaults: true,
    },
    [DataSecurityAiWork.Judge]: {
      autonomy: DataSecurityAiAutonomy.Suggest,
      fromDefaults: true,
    },
  };
}

function readText(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  return value &&
    typeof (value as { toString?: unknown }).toString === "function"
    ? String(value)
    : "";
}

/*
 * What the matching rules say about one kind of work: Off when none turns
 * it on; otherwise the careful answer wins - Suggest when any rule that
 * turns it on asks first. The rule that decided is the first by name that
 * gave the winning answer.
 */
function combine(
  rules: ReadonlyArray<DataSecurityAiRuleFacts>,
  work: DataSecurityAiWork,
): DataSecurityAiWorkDecision {
  const on: Array<{
    rule: DataSecurityAiRuleFacts;
    autonomy: DataSecurityAiAutonomy;
  }> = rules
    .map((rule: DataSecurityAiRuleFacts) => {
      return { rule, autonomy: getDataSecurityAiRuleAutonomy(rule, work) };
    })
    .filter((answer: { autonomy: DataSecurityAiAutonomy }): boolean => {
      return answer.autonomy !== DataSecurityAiAutonomy.Off;
    });

  if (on.length === 0) {
    return OFF;
  }

  const winning: DataSecurityAiAutonomy = on.some(
    (answer: { autonomy: DataSecurityAiAutonomy }): boolean => {
      return answer.autonomy === DataSecurityAiAutonomy.Suggest;
    },
  )
    ? DataSecurityAiAutonomy.Suggest
    : DataSecurityAiAutonomy.WithoutAsking;

  const decidedBy: DataSecurityAiRuleFacts = on.find(
    (answer: { autonomy: DataSecurityAiAutonomy }): boolean => {
      return answer.autonomy === winning;
    },
  )!.rule;

  return {
    autonomy: winning,
    fromDefaults: false,
    ruleId: readText(decidedBy._id) || undefined,
    ruleName: readText(decidedBy.name) || undefined,
  };
}

/*
 * What OneUptime AI does with one issue, from the project's two switches
 * and its Data Security AI rules (see the module comment). `rules` is null
 * when they could not be read; `rulesSetUp` is whether the project has any
 * enabled one, and `matchingRules` the enabled ones the issue matches,
 * sorted by name.
 */
export function decideDataSecurityAiWork(data: {
  isAiEnabled: boolean;
  isAutomaticOn: boolean;
  rules: {
    rulesSetUp: boolean;
    matchingRules: ReadonlyArray<DataSecurityAiRuleFacts>;
  } | null;
  issue: DataSecurityAiIssueFacts;
}): DataSecurityAiPlan {
  if (!data.isAiEnabled) {
    return nothing(DataSecurityAiSkip.AiOff);
  }

  if (!data.isAutomaticOn) {
    return nothing(DataSecurityAiSkip.AutomaticOff);
  }

  if (!data.rules) {
    return nothing(DataSecurityAiSkip.RulesUnreadable);
  }

  if (!data.rules.rulesSetUp) {
    return {
      skip: null,
      works: getDefaultDataSecurityAiWork(data.issue),
      llmProviderId: "",
      rules: [],
    };
  }

  const matching: Array<DataSecurityAiRuleFacts> = [
    ...data.rules.matchingRules,
  ];

  if (matching.length === 0) {
    return nothing(DataSecurityAiSkip.NoMatchingRule);
  }

  const provider: DataSecurityAiRuleFacts | undefined = matching.find(
    (rule: DataSecurityAiRuleFacts): boolean => {
      return readText(rule.llmProviderId).length > 0;
    },
  );

  return {
    skip: null,
    works: {
      [DataSecurityAiWork.Analyze]: combine(
        matching,
        DataSecurityAiWork.Analyze,
      ),
      [DataSecurityAiWork.Contain]: combine(
        matching,
        DataSecurityAiWork.Contain,
      ),
      [DataSecurityAiWork.Fix]: combine(matching, DataSecurityAiWork.Fix),
      [DataSecurityAiWork.Judge]: combine(matching, DataSecurityAiWork.Judge),
    },
    llmProviderId: provider ? readText(provider.llmProviderId) : "",
    rules: matching,
  };
}

// Whether the decision has OneUptime AI do anything at all.
export function isDataSecurityAiWorkToDo(plan: DataSecurityAiPlan): boolean {
  return (
    plan.skip === null &&
    DATA_SECURITY_AI_WORKS.some((work: DataSecurityAiWork): boolean => {
      return plan.works[work].autonomy !== DataSecurityAiAutonomy.Off;
    })
  );
}

/*
 * Why a change OneUptime AI wanted to make on its own was proposed
 * instead. Stored on the decision's entries: never rename one.
 */
export enum DataSecurityAiAskReason {
  // The kind of work is set to Suggest: every change waits for a person.
  WorkAsksFirst = "WorkAsksFirst",
  // Deleting data and paging people always ask.
  AlwaysAsks = "AlwaysAsks",
  // A change of access runs on its own only where a rule names it.
  NotNamedByRule = "NotNamedByRule",
  /*
   * Out of the box, only a change that proves it is safe runs on its own
   * (a secret's scrub rule no one reads, #10366); this one could not.
   */
  NotProvenSafe = "NotProvenSafe",
  // Two people approve a riskier change in this project.
  TwoApprovals = "TwoApprovals",
  // OneUptime AI already made the most changes it may make in an hour.
  CircuitBreaker = "CircuitBreaker",
}

export interface DataSecurityAiWithoutAskingVerdict {
  runWithoutAsking: boolean;
  // Why it is proposed instead, when it is.
  askReason: DataSecurityAiAskReason | null;
}

/*
 * Whether a change runs without asking, or is proposed for a person: the
 * kind of work's autonomy, then what the change is (see the module
 * comment), then the project's two-approval rule and the hour's circuit
 * breaker. The safest answer wins at every step.
 */
export function getDataSecurityAiWithoutAskingVerdict(data: {
  work: DataSecurityAiWorkDecision;
  safety: DataSecurityAiChangeSafety;
  // The action proves it is safe enough to run out of the box (#10366).
  meetsDefaultConditions: boolean;
  // The deciding rule names this very action (a change of access).
  isNamedByRule: boolean;
  // Project.requireTwoApprovalsForRiskierFixes.
  requireTwoApprovalsForRiskierChanges: boolean;
  // Changes made without asking in the project in the last hour.
  changesWithoutAskingThisHour: number;
}): DataSecurityAiWithoutAskingVerdict {
  const ask: (
    reason: DataSecurityAiAskReason,
  ) => DataSecurityAiWithoutAskingVerdict = (
    reason: DataSecurityAiAskReason,
  ): DataSecurityAiWithoutAskingVerdict => {
    return { runWithoutAsking: false, askReason: reason };
  };

  if (data.safety === DataSecurityAiChangeSafety.ReadOnly) {
    return data.work.autonomy === DataSecurityAiAutonomy.Off
      ? ask(DataSecurityAiAskReason.WorkAsksFirst)
      : { runWithoutAsking: true, askReason: null };
  }

  if (data.work.autonomy !== DataSecurityAiAutonomy.WithoutAsking) {
    return ask(DataSecurityAiAskReason.WorkAsksFirst);
  }

  if (DATA_SECURITY_AI_ALWAYS_ASKS.includes(data.safety)) {
    return ask(DataSecurityAiAskReason.AlwaysAsks);
  }

  if (
    data.safety === DataSecurityAiChangeSafety.ChangesAccess &&
    (data.work.fromDefaults || !data.isNamedByRule)
  ) {
    return ask(DataSecurityAiAskReason.NotNamedByRule);
  }

  if (data.work.fromDefaults && !data.meetsDefaultConditions) {
    return ask(DataSecurityAiAskReason.NotProvenSafe);
  }

  if (
    data.requireTwoApprovalsForRiskierChanges &&
    isRiskierDataSecurityAiChange(data.safety)
  ) {
    return ask(DataSecurityAiAskReason.TwoApprovals);
  }

  if (
    data.changesWithoutAskingThisHour >=
    DATA_SECURITY_AI_CHANGES_WITHOUT_ASKING_PER_HOUR
  ) {
    return ask(DataSecurityAiAskReason.CircuitBreaker);
  }

  return { runWithoutAsking: true, askReason: null };
}

/*
 * How many people approve a proposal: two for a riskier change where the
 * project asks two people to approve one, one otherwise - the rule an
 * incident's fix follows (Types/AutoRemediation/RemediationApprovals).
 */
export function getDataSecurityAiApprovalsNeeded(data: {
  requireTwoApprovalsForRiskierChanges: boolean;
  safety: DataSecurityAiChangeSafety | string | undefined;
}): number {
  return data.requireTwoApprovalsForRiskierChanges &&
    isRiskierDataSecurityAiChange(data.safety)
    ? 2
    : 1;
}

/*
 * How the inbox orders what waits for a person: the riskiest first - the
 * riskier changes, then by the issue's risk score - and, of equals, the
 * oldest first.
 */
export function compareDataSecurityAiProposalsByRisk(
  a: {
    safety?: string | undefined;
    riskScore?: number | undefined;
    createdAt?: Date | undefined;
  },
  b: {
    safety?: string | undefined;
    riskScore?: number | undefined;
    createdAt?: Date | undefined;
  },
): number {
  const riskierA: number = isRiskierDataSecurityAiChange(a.safety) ? 1 : 0;
  const riskierB: number = isRiskierDataSecurityAiChange(b.safety) ? 1 : 0;

  if (riskierA !== riskierB) {
    return riskierB - riskierA;
  }

  const scoreA: number = a.riskScore || 0;
  const scoreB: number = b.riskScore || 0;

  if (scoreA !== scoreB) {
    return scoreB - scoreA;
  }

  return (a.createdAt?.getTime() || 0) - (b.createdAt?.getTime() || 0);
}

/*
 * A JSON value as one text with every object's keys in order, so two reads
 * of the same plan - whatever order its keys came back in - give the same
 * text.
 */
export function toStableJsonText(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value
      .map((item: unknown): string => {
        return toStableJsonText(item);
      })
      .join(",")}]`;
  }

  if (value && typeof value === "object" && !(value instanceof Date)) {
    const record: Record<string, unknown> = value as Record<string, unknown>;

    return `{${Object.keys(record)
      .filter((key: string): boolean => {
        return record[key] !== undefined;
      })
      .sort()
      .map((key: string): string => {
        return `${JSON.stringify(key)}:${toStableJsonText(record[key])}`;
      })
      .join(",")}}`;
  }

  return JSON.stringify(value === undefined ? null : value);
}

export const DATA_SECURITY_AI_PLAN_FINGERPRINT_LENGTH: number = 16;

const PLAN_FINGERPRINT_PATTERN: RegExp = /^[0-9a-f]{16}$/;

export function isDataSecurityAiPlanFingerprint(
  value: unknown,
): value is string {
  return typeof value === "string" && PLAN_FINGERPRINT_PATTERN.test(value);
}

/*
 * What a proposal changes, in sixteen hex digits: its kind and its plan.
 * An approval names the fingerprint of the proposal its person was shown,
 * and a proposal whose plan changed since is not approved; the first of two
 * approvals records it, and the second makes only that change. Shared by
 * the server and the Dashboard (the same SHA-256 as Node's crypto).
 */
export function getDataSecurityAiPlanFingerprint(proposal: {
  kind?: unknown;
  plan?: unknown;
}): string {
  return sha256Hex(
    toStableJsonText({
      kind: typeof proposal.kind === "string" ? proposal.kind : "",
      plan: proposal.plan ?? null,
    }),
  ).slice(0, DATA_SECURITY_AI_PLAN_FINGERPRINT_LENGTH);
}
