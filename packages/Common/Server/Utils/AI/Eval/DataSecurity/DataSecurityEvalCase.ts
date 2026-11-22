import { DataSecurityAiFeature } from "../../../../../Types/DataSecurity/DataSecurityAiFeatures";
import {
  DataSecurityAiVerdict,
  DataSecurityAnalysisPart,
} from "../../../../../Types/DataSecurity/DataSecurityIssueAnalysis";
import {
  DataStoreOwnerCandidate,
  DataStoreOwnerConfidence,
  DataStoreOwnerEvidence,
} from "../../../../../Types/DataSecurity/DataStoreOwnerProposal";
import { UnplacedField } from "../../../../../Utils/DataSecurity/UnplacedFields";
import {
  AiAccessRecord,
  AiDataTypeChoice,
  AiFindingRecord,
  AiIssueDossier,
  AiIssueRecord,
  AiStoreRecord,
} from "../../DataSecurity/DataSecurityAiInput";

/*
 * A CASE OF THE DATA SECURITY EVAL (#10365): ONE INPUT A FEATURE WOULD
 * SEND, AND WHAT A GOOD ANSWER IS.
 *
 * Every case is made up - a store, an issue, the fields of a table - in the
 * shapes the product reads (DataSecurityAiInput's records), never copied
 * from a customer. The eval builds each case's input with the very builder
 * the feature uses, so a change to a prompt is measured as it ships.
 *
 * A good answer is said in words a check can read, not by a judge: the
 * words it must say (each group, one of its words), the words it must not
 * say - a wrong cloud's command, a planted instruction's demand - and, for
 * a structured answer, the value each part must have.
 */

export interface DataSecurityEvalCaseBase {
  // Unique and stable: --case names it, and a series of runs is read by it.
  id: string;
  title: string;
  feature: DataSecurityAiFeature;
}

/*
 * What a written answer must and must not say. Words are matched in lower
 * case, anywhere in the answer.
 */
export interface DataSecurityEvalWords {
  // Each group is a fact: the answer says at least one of its words.
  mentions: Array<Array<string>>;
  // Words a right answer never says.
  never: Array<string>;
}

/*
 * What a right analysis of an issue is (#10369): the verdict it gives - one
 * of a few where the facts allow more than one - and, for each line, the
 * words it says (each group, one of its words) and the facts it rests on;
 * the words no line says (a planted instruction's demand, a wrong cloud's
 * command); and whether it drafts the reason a person could give.
 */
export interface AnalysisEvalExpectation {
  verdicts: Array<DataSecurityAiVerdict>;
  says?: Partial<Record<DataSecurityAnalysisPart, Array<Array<string>>>>;
  restsOn?: Partial<Record<DataSecurityAnalysisPart, Array<string>>>;
  never: Array<string>;
  drafts?: boolean | undefined;
}

/*
 * An issue's analysis: Explain with AI when a person asks, Analyze when the
 * issue opens - asked the same, from what OneUptime knows about the issue
 * (the dossier its facts are made of, DataSecurityAiInput.analysisFacts),
 * in the language given (English by default).
 */
export interface AnalysisEvalCase extends DataSecurityEvalCaseBase {
  feature:
    | DataSecurityAiFeature.ExplainIssue
    | DataSecurityAiFeature.AnalyzeIssue;
  dossier: AiIssueDossier;
  language?: string | undefined;
  expect: AnalysisEvalExpectation;
}

/*
 * The field suggestions: one request's fields, and the type each should
 * get - a listed id, or null where nothing points to one.
 */
export interface FieldSuggestionEvalCase extends DataSecurityEvalCaseBase {
  feature: DataSecurityAiFeature.SuggestFieldTypes;
  storeKind: string;
  dataTypes: Array<AiDataTypeChoice>;
  fields: Array<UnplacedField>;
  // By the field's location: the id it should get, or null.
  expect: Record<string, string | null>;
}

/*
 * A file a fix must change, and what it must and must not hold after: each
 * a regular expression's source, matched across the file.
 */
export interface FixEvalFileCheck {
  path: string;
  mustMatch: Array<string>;
  mustNotMatch: Array<string>;
}

/*
 * Fix with AI: an issue, the code its fix is in, and what the changed code
 * must hold. The request is the one Fix with AI hands the coding agent; the
 * eval asks for the changed files in one call, so it measures the request,
 * not the coding agent's loop (the Code agent benchmark measures that).
 */
export interface FixEvalCase extends DataSecurityEvalCaseBase {
  feature: DataSecurityAiFeature.FixIssue;
  issue: AiIssueRecord;
  findings?: Array<AiFindingRecord> | undefined;
  // The repository's files the request is about: path to content.
  files: Record<string, string>;
  expect: Array<FixEvalFileCheck>;
}

/*
 * Ask AI: a question about Data Security, the rows its tools would read
 * (made by the builder, as the tools make them), and what the answer must
 * say.
 */
export interface AskAiEvalCase extends DataSecurityEvalCaseBase {
  feature: DataSecurityAiFeature.AskAi;
  question: string;
  stores: Array<AiStoreRecord>;
  findings?: Array<AiFindingRecord & { store: string }> | undefined;
  access?: Array<AiAccessRecord & { store: string }> | undefined;
  issues?: Array<AiIssueRecord> | undefined;
  expect: DataSecurityEvalWords;
}

/*
 * Owners for a store (#10374): the store, the candidates and the evidence
 * as the product reads them, and the owners each should get - by the refs
 * OneUptime AI is told ("T1", "P1"). The answer is held to the evidence as
 * the product holds it before it is scored, so a made-up owner counts
 * against it.
 */
export interface StoreOwnersEvalCase extends DataSecurityEvalCaseBase {
  feature: DataSecurityAiFeature.ProposeStoreOwners;
  store: AiStoreRecord;
  candidates: Array<DataStoreOwnerCandidate>;
  evidence: Array<DataStoreOwnerEvidence>;
  servicesUsingIt: number;
  expect: {
    // The owners a right answer names: exactly one of these sets.
    ownersOneOf: Array<Array<string>>;
    // It says the evidence disagrees.
    disagrees?: boolean | undefined;
    // It is no surer than this: Low where the evidence is weak or disagrees.
    atMostConfidence?: DataStoreOwnerConfidence | undefined;
  };
}

export type DataSecurityEvalCase =
  | AnalysisEvalCase
  | FieldSuggestionEvalCase
  | FixEvalCase
  | AskAiEvalCase
  | StoreOwnersEvalCase;
