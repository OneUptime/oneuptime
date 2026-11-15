import { RefusalWithValues } from "../Exception/RefusalWithValues";
import { translationKey } from "../Translator";

/*
 * WHY A DATA CHECK OR A RECONCILIATION WAS NOT WRITTEN, ADDED OR SET UP
 * (#7530).
 *
 * The server refuses in these English sentences: an API client, the CLI
 * and Terraform read them as they are. Write a Check from a Sentence,
 * Suggested Checks and the Reconciliations page show them under their
 * buttons, where they read English on every page. Each is a key of the
 * Dashboard's locales now (this file is a "keys" root of its string
 * extractor), so the Dashboard says it in the reader's language
 * (ErrorLine, Common/UI/Utils/ErrorInSentence).
 *
 * Two carry a value: why the model could not make the rule a check, and
 * why its answer could not be run. They are RefusalWithValues: the
 * Dashboard reads the value back out of the English and says the sentence
 * in the reader's language around it. The model writes its own why in the
 * reader's language (DataCheckFromSentence's language line), and a why of
 * OneUptime's own - one of the sentences below - is looked up as a key.
 *
 * React-free and server-safe: the server throws these, the Dashboard reads
 * them.
 */

// Write a Check from a Sentence (DataCheckFromSentence).
export const DataCheckFromSentenceRefusal: {
  noRule: string;
  tableNotFound: string;
  engineNotChecked: string;
  answerNotACheck: string;
  queryNamesNoValue: string;
  pipelineNamesNoValue: string;
} = {
  noRule: translationKey("Say the rule the check should hold to."),
  tableNotFound: translationKey("The table was not found."),
  engineNotChecked: translationKey(
    "Data Observability does not run checks on this table's database.",
  ),
  answerNotACheck: translationKey(
    "The AI's answer was not a check. Say the rule another way, or write the check yourself.",
  ),
  queryNamesNoValue: translationKey(
    "The AI's query does not name its number value. Say the rule another way, or write the check yourself.",
  ),
  pipelineNamesNoValue: translationKey(
    "The AI's pipeline does not name its number value. Say the rule another way, or write the check yourself.",
  ),
};

/*
 * The model said the rule cannot be checked with the table's columns, and
 * why: in the reader's language, as it was asked to write it.
 */
export const RULE_NOT_A_CHECK_REFUSAL: RefusalWithValues = {
  template: translationKey("The rule could not be made a check: {{reason}}"),
  terms: [],
};

/*
 * The model answered twice with something OneUptime cannot run. The reason
 * is OneUptime's own sentence for what was wrong with the last answer (one
 * of the sentences in this file), said in the reader's language too.
 */
export const CHECK_NOT_WRITTEN_REFUSAL: RefusalWithValues = {
  template: translationKey(
    "OneUptime AI could not write a check OneUptime can run for that rule ({{reason}}) Say it another way, or write the check yourself.",
  ),
  terms: ["reason"],
};

// Why a Custom SQL check's query is refused before it is sent (checkCustomSql).
export const CustomSqlRefusal: {
  noQuery: string;
  tooLong: string;
  notSingleQuery: string;
  notARead: string;
  writes: string;
  dataverseNoWith: string;
} = {
  noQuery: translationKey("Custom SQL needs a query."),
  tooLong: translationKey("Custom SQL is too long."),
  notSingleQuery: translationKey("Custom SQL must be a single query."),
  notARead: translationKey("Custom SQL must start with SELECT or WITH."),
  writes: translationKey("Custom SQL may only read."),
  dataverseNoWith: translationKey(
    "Dataverse's SQL has no WITH: write the query as one SELECT, with a subquery where it needs one.",
  ),
};

// Why a MongoDB custom check's pipeline is refused (checkMongoPipeline).
export const MongoPipelineRefusal: {
  noPipeline: string;
  tooLong: string;
  notJson: string;
  writes: string;
} = {
  noPipeline: translationKey("A custom check needs an aggregation pipeline."),
  tooLong: translationKey("The aggregation pipeline is too long."),
  notJson: translationKey(
    'A MongoDB custom check is an aggregation pipeline as JSON: [{ "$match": ... }, { "$count": "value" }].',
  ),
  writes: translationKey(
    "The aggregation pipeline may only read: no $out, $merge, $function, $accumulator or $where.",
  ),
};

// Why a reconciliation's checks and monitor were not set up (DataReconciliationSync).
export const DataReconciliationRefusal: {
  notFound: string;
  sourceNeedsTable: string;
  targetNeedsTable: string;
  missingStatuses: string;
} = {
  notFound: translationKey("Reconciliation not found."),
  sourceNeedsTable: translationKey(
    "The reconciliation's source needs a table.",
  ),
  targetNeedsTable: translationKey(
    "The reconciliation's target needs a table.",
  ),
  missingStatuses: translationKey(
    "This project is missing an operational or offline monitor status, or an incident or alert severity. Add them in Settings, then save the reconciliation again.",
  ),
};

// The refusals with a value in them, for the Dashboard to read back.
export const DATA_CHECK_REFUSALS_WITH_VALUES: ReadonlyArray<RefusalWithValues> =
  [RULE_NOT_A_CHECK_REFUSAL, CHECK_NOT_WRITTEN_REFUSAL];
