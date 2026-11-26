import { DataSecurityAiFeature } from "../../../../../Types/DataSecurity/DataSecurityAiFeatures";
import DataCategory from "../../../../../Types/DataSecurity/DataCategory";
import DataSensitivity from "../../../../../Types/DataSecurity/DataSensitivity";
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
  DataStoreFindingPrecedent,
  DataStoreFindingVerdict,
  FindingWrongMatchSign,
} from "../../../../../Types/DataSecurity/DataStoreFindingVerdict";
import {
  ScrubRuleWriterPlace,
  ScrubRuleWriterRuleKind,
} from "../../../../../Types/DataSecurity/ScrubRuleWriterPlace";
import { UnplacedField } from "../../../../../Utils/DataSecurity/UnplacedFields";
import type { TelemetryLeakEvalCase } from "./TelemetryLeakEvalSet";
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
  AiVerdictFindingRecord,
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
import { ExposureDraftPart } from "../../../../../Types/DataSecurity/ExposureAssessment";
import { ExposureEvalExposure } from "./DataSecurityExposureEvalSet";
import { DataSecurityRuleKind } from "../../../../../Types/DataSecurity/DataSecurityRuleDraft";

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
 * A pull request's Sensitive data section (#10376): a made-up diff, and
 * what OneUptime AI should keep of the points the rules find in it. The
 * case's input is built as a review builds it - the rules over the diff
 * (SensitiveDataRules), the points they make, the read's own prompt
 * (PullRequestLeakReview) - and the answer is held to the points as the
 * review holds it: one it was not given, or one it would drop that fails
 * the check, counts for nothing.
 */
export interface PullRequestReviewEvalCase extends DataSecurityEvalCaseBase {
  feature: DataSecurityAiFeature.ReviewPullRequests;
  pullRequestTitle: string;
  files: Array<{ filename: string; status: string; patch: string }>;
  // The repository fails its check on a leak: such a point cannot be dropped.
  isFailOn?: boolean | undefined;
  expect: {
    // By a point's subject, as the rules name it: whether a right answer keeps it.
    keeps: Record<string, boolean>;
    // Words the kept points' fixes say together (each group, one of its words).
    fixMentions?: Array<Array<string>> | undefined;
    // Words no point's text or fix says.
    never?: Array<string> | undefined;
  };
}

/*
 * One finding OneUptime AI judges (#10372): its facts, its signs of a wrong
 * match, its precedent - the team's earlier decisions, P1 first - and the
 * verdict a right answer gives it: one of `expect`. A right Confirm or Not
 * sensitive cites at least one of `cites` (refs of its precedent), when the
 * case names any.
 */
export interface FindingVerdictEvalFinding {
  finding: AiVerdictFindingRecord;
  signs: Array<FindingWrongMatchSign>;
  nameSaysInstead?: Array<string> | undefined;
  precedent: Array<
    DataStoreFindingPrecedent & {
      storeKind?: string | undefined;
      storeEnvironment?: string | undefined;
    }
  >;
  expect: Array<DataStoreFindingVerdict>;
  cites?: Array<string> | undefined;
}

/*
 * The verdicts on a store's findings that wait for a person (#10372): the
 * store, and each finding with what it is judged from. The answer is held
 * to its facts as the product holds it (holdFindingVerdictToFacts) before
 * it is scored, so a precedent it was not given counts for nothing.
 */
export interface FindingVerdictEvalCase extends DataSecurityEvalCaseBase {
  feature: DataSecurityAiFeature.JudgeFindings;
  store: AiStoreRecord;
  findings: Array<FindingVerdictEvalFinding>;
  language?: string | undefined;
}

/*
 * A service's telemetry leaks fixed in its code (#10367): a case of the eval
 * set of recorded findings (TelemetryLeakEvalSet) - the records each finding
 * was seen in and the repository they lead to - and what the changed code
 * must hold. The request is the one the product builds from those records,
 * answered in one call; the code agent's benchmark runs the agent's loop on
 * the same cases.
 */
export interface TelemetryLeakFixEvalCase extends DataSecurityEvalCaseBase {
  feature: DataSecurityAiFeature.FixTelemetryLeaks;
  evalSetCase: TelemetryLeakEvalCase;
  expect: Array<FixEvalFileCheck>;
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

/*
 * The data type a group of fields, or a person's sentence, should become
 * (#10371): the type a person would write - null where there is none of
 * the company's own - and made-up values a right pattern finds and leaves
 * alone. The model never sees a value: the case's input is the names and
 * shapes the product sends.
 */
export interface DataTypeEvalExpectation {
  becomes: {
    name: string;
    category: DataCategory;
    sensitivity: DataSensitivity;
    pattern: string;
    validator?: string | undefined;
  } | null;
  // Made-up values a right pattern finds whole.
  finds: Array<string>;
  // Made-up values beside them it never finds.
  keeps: Array<string>;
  // What a right answer may call it besides the type it becomes.
  categories?: Array<DataCategory> | undefined;
  sensitivities?: Array<DataSensitivity> | undefined;
}

// A group of fields scans could not place, as OneUptime AI is told it.
export interface DraftDataTypesEvalCase extends DataSecurityEvalCaseBase {
  feature: DataSecurityAiFeature.DraftDataTypes;
  fields: Array<{ storeKind: string; field: UnplacedField }>;
  storeCount: number;
  expect: DataTypeEvalExpectation;
}

// Describe It: a sentence, and made-up examples sent only as their shapes.
export interface DescribeDataTypeEvalCase extends DataSecurityEvalCaseBase {
  feature: DataSecurityAiFeature.DescribeDataType;
  sentence: string;
  examples: Array<string>;
  expect: DataTypeEvalExpectation;
}

/*
 * An exposure's write-up (#10377): a made-up exposure, worked out by the
 * product's plain code into its assessment (DataSecurityExposureEvalSet),
 * and the words each part of OneUptime AI's write-up must say once it is
 * held to its facts - each group, one of its words.
 */
export interface ExposureAssessmentEvalCase extends DataSecurityEvalCaseBase {
  feature:
    | DataSecurityAiFeature.DraftExposureAssessment
    | DataSecurityAiFeature.DraftExposureAssessmentOnRequest;
  exposure: ExposureEvalExposure;
  language?: string | undefined;
  expect: {
    parts: Partial<Record<ExposureDraftPart, Array<Array<string>>>>;
    never: Array<string>;
  };
}

/*
 * A rule from a person's sentence (#10378): the words, the project's
 * labels and teams by name, and what the draft must be - its kind, the
 * regions it allows and refuses, what its patterns match and miss, and
 * who and what it names. A sentence that holds no rule must draft none.
 */
export interface RuleFromSentenceEvalCase extends DataSecurityEvalCaseBase {
  feature: DataSecurityAiFeature.DraftRuleFromSentence;
  sentence: string;
  labels: Array<string>;
  teams: Array<string>;
  expect: {
    kind: DataSecurityRuleKind | null;
    allowsRegions?: Array<string> | undefined;
    refusesRegions?: Array<string> | undefined;
    dataCategories?: Array<DataCategory> | undefined;
    subjectCountries?: Array<string> | undefined;
    // Store names its name pattern must match, and must not.
    matchesStoreNames?: Array<string> | undefined;
    missesStoreNames?: Array<string> | undefined;
    owners?: Array<string> | undefined;
    labelsToAdd?: Array<string> | undefined;
  };
}

export type DataSecurityEvalCase =
  | AnalysisEvalCase
  | FindingVerdictEvalCase
  | FieldSuggestionEvalCase
  | FixEvalCase
  | AskAiEvalCase
  | StoreOwnersEvalCase
  | IssueGroupNameEvalCase
  | IssueGroupFixEvalCase
  | ScrubRulesEvalCase
  | PullRequestReviewEvalCase
  | TelemetryLeakFixEvalCase
  | RecordDraftEvalCase
  | ImpactAssessmentEvalCase
  | AuditEvidenceEvalCase
  | DraftDataTypesEvalCase
  | DescribeDataTypeEvalCase
  | ExposureAssessmentEvalCase
  | RuleFromSentenceEvalCase;
