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
import { DataSecurityIssueGroupFacts } from "../../../../../Types/DataSecurity/DataSecurityIssueGroup";
import {
  ScrubRuleWriterPlace,
  ScrubRuleWriterRuleKind,
} from "../../../../../Types/DataSecurity/ScrubRuleWriterPlace";
import { UnplacedField } from "../../../../../Utils/DataSecurity/UnplacedFields";
import {
  AiAccessRecord,
  AiDataTypeChoice,
  AiEvidenceRequirement,
  AiFindingRecord,
  AiGroupFixStore,
  AiImpactAssessmentDossier,
  AiIssueDossier,
  AiIssueRecord,
  AiRecordDossier,
  AiStoreRecord,
} from "../../DataSecurity/DataSecurityAiInput";
import ComplianceFramework from "../../../../../Types/DataSecurity/ComplianceFramework";
import {
  ImpactAssessmentPart,
  ImpactAssessmentTriggerView,
} from "../../../../../Types/DataSecurity/ImpactAssessment";
import {
  RecordField,
  RecordLegalBasis,
  RecordPeople,
} from "../../../../../Types/DataSecurity/RecordOfProcessing";

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

/*
 * A group's name (#10370): the facts the group rests on, as the grouping
 * keeps them, the group's stores (never told to the model), and what a
 * right name says. The answer is held to its facts as the product holds
 * it before it is scored: a name the product would drop fails.
 */
export interface IssueGroupNameEvalCase extends DataSecurityEvalCaseBase {
  feature: DataSecurityAiFeature.NameIssueGroup;
  facts: DataSecurityIssueGroupFacts;
  issueCount: number;
  storeNames: Array<string>;
  language?: string | undefined;
  expect: DataSecurityEvalWords;
}

/*
 * The pull request that fixes a group's cause once (#10370): the group,
 * the code that declares its stores, and what the changed code must hold -
 * the module's default changed, never each store's resource.
 */
export interface IssueGroupFixEvalCase extends DataSecurityEvalCaseBase {
  feature: DataSecurityAiFeature.FixIssueGroup;
  facts: DataSecurityIssueGroupFacts;
  stores: Array<AiGroupFixStore>;
  files: Record<string, string>;
  expect: Array<FixEvalFileCheck>;
}

/*
 * What a right rule for one place does (#10366): with made-up values of
 * the place, it changes each one that holds the data and none of the
 * others - as the verifier proves a rule on a finding's records - and it
 * is of the kind a right answer writes, where only one kind is right.
 */
export interface ScrubRuleEvalExpectation {
  // Made-up values at the place the rule must change: the model never sees them.
  hides: Array<string>;
  // Made-up values beside them it must leave as they are.
  keeps: Array<string>;
  kind?: ScrubRuleWriterRuleKind | undefined;
  // No rule is right for the place: a right answer leaves it out.
  leftOut?: boolean | undefined;
}

/*
 * OneUptime AI's scrub rules for what Scrub It cannot cover (#10366): the
 * places as it is told them - names and shapes, never a value - and what a
 * right rule for each does, by the place's ref.
 */
export interface ScrubRulesEvalCase extends DataSecurityEvalCaseBase {
  feature: DataSecurityAiFeature.WriteScrubRules;
  places: Array<ScrubRuleWriterPlace>;
  expect: Record<string, ScrubRuleEvalExpectation>;
}

/*
 * What a right draft of one field of a store's record is (#10375): drafted,
 * saying one word of each group; or left empty (null) where no fact says
 * it - a record that guesses is worse than one that asks.
 */
export interface RecordTextEvalExpectation {
  says: Array<Array<string>>;
  // A right answer may also leave it empty: the facts say it only in part.
  mayBeLeftEmpty?: boolean | undefined;
}

export interface RecordDraftEvalExpectation {
  purpose?: RecordTextEvalExpectation | null | undefined;
  retention?: RecordTextEvalExpectation | null | undefined;
  // The bases a right answer may pick: one of these.
  legalBasis?: { oneOf: Array<RecordLegalBasis> } | null | undefined;
  // The categories a right answer names, and those it never does.
  people?:
    | { includes: Array<RecordPeople>; excludes?: Array<RecordPeople> }
    | null
    | undefined;
  // Words no draft of it says: a planted instruction's demand, a made-up recipient.
  never: Array<string>;
}

/*
 * A store's record drafts (#10375): what OneUptime knows of the store, as
 * the dossier the product reads (RecordOfProcessingDossier), the fields
 * asked, and what a right draft of each is. The answer is held to its
 * facts as the product holds it before it is scored.
 */
export interface RecordDraftEvalCase extends DataSecurityEvalCaseBase {
  feature:
    | DataSecurityAiFeature.DraftRecord
    | DataSecurityAiFeature.DraftRecordOnRequest;
  dossier: AiRecordDossier;
  fields: Array<RecordField>;
  language?: string | undefined;
  expect: RecordDraftEvalExpectation;
}

/*
 * A store's impact assessment (#10375): its dossier, why it needs one, and
 * the words each part must say - each group, one of its words.
 */
export interface ImpactAssessmentEvalCase extends DataSecurityEvalCaseBase {
  feature: DataSecurityAiFeature.DraftImpactAssessment;
  dossier: AiImpactAssessmentDossier;
  triggers: Array<ImpactAssessmentTriggerView>;
  language?: string | undefined;
  expect: {
    parts: Partial<Record<ImpactAssessmentPart, Array<Array<string>>>>;
    never: Array<string>;
  };
}

/*
 * A framework's audit evidence (#10375): its requirements' evidence as the
 * reader works it out (AuditEvidenceReader), and the words each
 * requirement's paragraph must say.
 */
export interface AuditEvidenceEvalCase extends DataSecurityEvalCaseBase {
  feature: DataSecurityAiFeature.DraftAuditEvidence;
  framework: ComplianceFramework;
  periodInDays: number;
  requirements: Array<AiEvidenceRequirement>;
  language?: string | undefined;
  expect: {
    paragraphs: Record<string, Array<Array<string>>>;
    never: Array<string>;
  };
}

export type DataSecurityEvalCase =
  | AnalysisEvalCase
  | FieldSuggestionEvalCase
  | FixEvalCase
  | AskAiEvalCase
  | StoreOwnersEvalCase
  | IssueGroupNameEvalCase
  | IssueGroupFixEvalCase
  | ScrubRulesEvalCase
  | RecordDraftEvalCase
  | ImpactAssessmentEvalCase
  | AuditEvidenceEvalCase;
