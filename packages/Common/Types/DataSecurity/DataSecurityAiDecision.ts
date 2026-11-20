import { JSONObject } from "../JSON";
import {
  DataSecurityAiAskReason,
  DataSecurityAiProposalKind,
  DataSecurityAiWork,
  isDataSecurityAiProposalKind,
  isDataSecurityAiWork,
} from "./DataSecurityAi";

/*
 * WHY ONEUPTIME AI DID, OR DID NOT, ACT ON A DATA SECURITY ISSUE (#10364).
 *
 * Every time the engine evaluates an issue (DataSecurityAiEngine) it writes
 * one record (DataSecurityAiDecision): whether OneUptime AI did anything,
 * and one entry per kind of work - what it did, or why it did nothing: no
 * rule matched, the work is off for this issue, no credits, the daily
 * limit, nothing it may do, a proof that failed. Data Security > AI lists
 * the issues it did nothing for under "Why AI did not act", and an issue's
 * AI card says it in a sentence.
 *
 * As for an incident's remediation decisions (Types/AutoRemediation/
 * AutoRemediationDecision), entries carry reason codes and the names
 * involved, never sentences, so the Dashboard says them in the reader's
 * language; and never a value, a sample or a record. Written once per
 * evaluation and never changed: the newest record of an issue is the one
 * that counts.
 */

/*
 * Why nothing was done for the whole issue, when nothing was. Stored:
 * never rename one.
 */
export enum DataSecurityAiIssueSkipReason {
  // The project's AI rules could not be read.
  RulesUnreadable = "RulesUnreadable",
  // The project has Data Security AI rules, and none matches the issue.
  NoRuleMatched = "NoRuleMatched",
  // OneUptime AI already worked on the most issues of this store it may today.
  StoreDailyLimitReached = "StoreDailyLimitReached",
  // The same, for the whole project.
  ProjectDailyLimitReached = "ProjectDailyLimitReached",
  // Every kind of work said why it did nothing (the entries).
  NothingToDo = "NothingToDo",
  // The evaluation stopped on an error; nothing is assumed done.
  EvaluationFailed = "EvaluationFailed",
}

/*
 * What one kind of work did, or why it did nothing. Stored: never rename
 * one.
 */
export enum DataSecurityAiDecisionReason {
  // --- Any kind of work ---
  // Off for this issue: by a rule, or by the defaults (Medium and Low issues are not analyzed).
  WorkOff = "WorkOff",
  // This kind of work has nothing OneUptime AI can do for this issue's check yet.
  NoActionForIssue = "NoActionForIssue",

  // --- Analyze ---
  Analyzed = "Analyzed",
  // It was analyzed since it last opened.
  AlreadyAnalyzed = "AlreadyAnalyzed",
  // No LLM provider is set up.
  NoLlmProvider = "NoLlmProvider",
  // The project is out of AI credits.
  NoAiCredits = "NoAiCredits",
  // The project reached its daily AI limit.
  AiDailyLimitReached = "AiDailyLimitReached",
  // The model call failed; nothing was written.
  AnalysisFailed = "AnalysisFailed",

  // --- A proposal of Contain, Fix or Judge ---
  // Proposed, waiting for a person (askReason says why, where it wanted to run on its own).
  Proposed = "Proposed",
  // Made without asking.
  AppliedWithoutAsking = "AppliedWithoutAsking",
  // The same change was proposed for this issue before.
  AlreadyProposed = "AlreadyProposed",
  // The action had nothing to change (detail says why).
  NothingToPropose = "NothingToPropose",
  // The action's proof failed, so it was not proposed.
  ProofFailed = "ProofFailed",
  // Making it without asking failed; nothing changed.
  ApplyFailed = "ApplyFailed",
}

export interface DataSecurityAiDecisionEntry {
  work: DataSecurityAiWork;
  reason: DataSecurityAiDecisionReason;
  // The proposal it is about, and its kind.
  kind?: DataSecurityAiProposalKind | undefined;
  proposalId?: string | undefined;
  // The rule that decided the work, when a rule did.
  ruleId?: string | undefined;
  ruleName?: string | undefined;
  // Why a change OneUptime AI wanted to make on its own was proposed.
  askReason?: DataSecurityAiAskReason | undefined;
  /*
   * A short code the action gives for NothingToPropose, ProofFailed or
   * ApplyFailed ("not-telemetry", "already-scrubbed"): a code, never words
   * or anything the store holds.
   */
  detail?: string | undefined;
}

// The reasons that say OneUptime AI did something.
const ACTED_REASONS: ReadonlyArray<DataSecurityAiDecisionReason> = [
  DataSecurityAiDecisionReason.Analyzed,
  DataSecurityAiDecisionReason.Proposed,
  DataSecurityAiDecisionReason.AppliedWithoutAsking,
];

/*
 * The reasons a person can do something about: a setting, credits, a limit
 * that lifts, a failure worth a look.
 */
const ATTENTION_REASONS: ReadonlyArray<DataSecurityAiDecisionReason> = [
  DataSecurityAiDecisionReason.NoLlmProvider,
  DataSecurityAiDecisionReason.NoAiCredits,
  DataSecurityAiDecisionReason.AiDailyLimitReached,
  DataSecurityAiDecisionReason.AnalysisFailed,
  DataSecurityAiDecisionReason.ProofFailed,
  DataSecurityAiDecisionReason.ApplyFailed,
];

const REASONS: ReadonlyArray<string> = Object.values(
  DataSecurityAiDecisionReason,
);
const ASK_REASONS: ReadonlyArray<string> = Object.values(
  DataSecurityAiAskReason,
);
const SKIP_REASONS: ReadonlyArray<string> = Object.values(
  DataSecurityAiIssueSkipReason,
);

// The longest detail code an entry keeps.
export const MAX_DECISION_DETAIL_LENGTH: number = 60;

/*
 * A detail code: lower-case words joined by dashes, each starting with a
 * letter - so a number written in groups ("4111-1111-1111-1111") is never
 * one.
 */
const DETAIL_PATTERN: RegExp = /^[a-z][a-z0-9]*(?:-[a-z][a-z0-9]*)*$/;

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function isDataSecurityAiIssueSkipReason(
  value: unknown,
): value is DataSecurityAiIssueSkipReason {
  return typeof value === "string" && SKIP_REASONS.includes(value);
}

export class DataSecurityAiDecisionHelper {
  /*
   * The entries of a stored record, read defensively: the column is JSON,
   * and a record a newer server wrote can carry a reason this build does
   * not know. Unknown or malformed entries are left out rather than drawn
   * as something they are not.
   */
  public static parseEntries(
    value: unknown,
  ): Array<DataSecurityAiDecisionEntry> {
    if (!Array.isArray(value)) {
      return [];
    }

    const entries: Array<DataSecurityAiDecisionEntry> = [];

    for (const item of value) {
      if (!item || typeof item !== "object") {
        continue;
      }

      const raw: JSONObject = item as JSONObject;
      const work: unknown = raw["work"];
      const reason: unknown = raw["reason"];

      if (
        !isDataSecurityAiWork(work) ||
        typeof reason !== "string" ||
        !REASONS.includes(reason)
      ) {
        continue;
      }

      const kind: unknown = raw["kind"];
      const askReason: unknown = raw["askReason"];
      const detail: string | undefined = readString(raw["detail"]);

      entries.push({
        work,
        reason: reason as DataSecurityAiDecisionReason,
        kind: isDataSecurityAiProposalKind(kind) ? kind : undefined,
        proposalId: readString(raw["proposalId"]),
        ruleId: readString(raw["ruleId"]),
        ruleName: readString(raw["ruleName"]),
        askReason:
          typeof askReason === "string" && ASK_REASONS.includes(askReason)
            ? (askReason as DataSecurityAiAskReason)
            : undefined,
        detail: DataSecurityAiDecisionHelper.readDetail(detail),
      });
    }

    return entries;
  }

  /*
   * A detail code as it is kept: a short code of lower-case words, or
   * nothing - so an entry can never carry text an action did not mean to.
   */
  public static readDetail(value: unknown): string | undefined {
    if (typeof value !== "string") {
      return undefined;
    }

    const code: string = value.trim().toLowerCase();

    return code.length > 0 &&
      code.length <= MAX_DECISION_DETAIL_LENGTH &&
      DETAIL_PATTERN.test(code)
      ? code
      : undefined;
  }

  // An entry as stored: undefined fields dropped, so a record holds only what it says.
  public static toJSON(entry: DataSecurityAiDecisionEntry): JSONObject {
    const json: JSONObject = {};

    for (const [key, value] of Object.entries({
      ...entry,
      detail: DataSecurityAiDecisionHelper.readDetail(entry.detail),
    })) {
      if (value === undefined || value === null || value === "") {
        continue;
      }

      json[key] = value as JSONObject[keyof JSONObject];
    }

    return json;
  }

  // Whether this entry says OneUptime AI did something.
  public static isActed(entry: DataSecurityAiDecisionEntry): boolean {
    return ACTED_REASONS.includes(entry.reason);
  }

  // Whether any entry of an evaluation says OneUptime AI did something.
  public static didAct(entries: ReadonlyArray<DataSecurityAiDecisionEntry>): boolean {
    return entries.some(DataSecurityAiDecisionHelper.isActed);
  }

  // Whether this entry is something a person can act on.
  public static needsAttention(entry: DataSecurityAiDecisionEntry): boolean {
    return ATTENTION_REASONS.includes(entry.reason);
  }
}
