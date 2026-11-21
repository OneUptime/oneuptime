import { AiContextActivity } from "../../../../Types/AI/AiContext";
import { CODE_TASK_LIMITS } from "../../../../Types/AI/CodeTask";
import { SUPPORTED_DASHBOARD_LANGUAGES } from "../../../../Types/Dashboard/DashboardLanguage";
import { DataSecurityAiFeature } from "../../../../Types/DataSecurity/DataSecurityAiFeatures";
import { isTelemetryFindingCheck } from "../../../../Types/DataSecurity/DataSecurityCheckCatalog";
import {
  DATA_SECURITY_AI_VERDICTS,
  DATA_SECURITY_ANALYSIS_LIMITS,
  DATA_SECURITY_ANALYSIS_PARTS,
  DataSecurityAnalysisAnswer,
  DataSecurityAnalysisPart,
} from "../../../../Types/DataSecurity/DataSecurityIssueAnalysis";
import DataTypeNamer from "../../../../Types/DataSecurity/DataTypeNamer";
import DataSecurityAiInput, {
  AiFindingRecord,
  AiIssueDossier,
  AiIssueRecord,
  DataSecurityAiCodeRequest,
  DataSecurityAiPrompt,
} from "./DataSecurityAiInput";
import {
  readStrictAnswer,
  StrictAnswer,
  StrictList,
  StrictNullable,
  StrictObject,
  StrictOptional,
  StrictText,
  StrictValue,
} from "./StrictAnswer";

/*
 * WHAT ONEUPTIME AI IS ASKED ABOUT A DATA SECURITY ISSUE: ITS ANALYSIS
 * (#10369) AND FIX WITH AI (Server/API/DataSecurityAPI).
 *
 * The analysis - Explain with AI, when a person asks; Analyze, when the
 * issue opens - is told what OneUptime knows about the issue, as facts each
 * with an id, as DataSecurityAiInput builds them (analysisFacts): the issue
 * as its check saw it, what the store holds and how exposed it is, who can
 * reach it and when each last used it, the services seen using it, copies,
 * security cases, the response action, OneUptime AI's proposals, the code
 * that declares it, and whether it has an owner - one JSON value of data,
 * never a value, a sample or a record. It answers one strict JSON object:
 * the verdict and one line on each question, each naming the facts it rests
 * on (DataSecurityIssueAnalysis holds it to them).
 *
 * Fix with AI is told the issue as a check saw it, and for a telemetry
 * issue where each kind of data was found - which is what the code writes -
 * and asked for a change to the service's own code (issue #5594); for any
 * other issue, a change to the infrastructure code.
 *
 * This file holds what each is asked, in OneUptime's own words; every fact
 * is the builder's.
 */

export {
  MAX_FINDING_LOCATION_LENGTH,
  MAX_ISSUE_EVIDENCE_LENGTH,
  MAX_ISSUE_FINDINGS_FOR_AI,
  MAX_ISSUE_VALUE_LENGTH,
} from "./DataSecurityAiInput";

/*
 * How the analysis asks: the most its answer may be - one JSON object, five
 * lines in any of the seventeen languages - and how it is sampled: low, so
 * the same facts get the same verdict. The eval asks the same
 * (Eval/DataSecurity), so a score measures what ships.
 */
export const DATA_SECURITY_ANALYSIS_MAX_TOKENS: number = 1500;
export const DATA_SECURITY_ANALYSIS_TEMPERATURE: number = 0.2;

// The language a language code names, in English: "de" is German.
export function getAnalysisLanguageName(language: string): string {
  return (
    SUPPORTED_DASHBOARD_LANGUAGES.find(
      (entry: { code: string; englishName: string }): boolean => {
        return entry.code === language;
      },
    )?.englishName || "English"
  );
}

const ANALYST_ROLE: string =
  "You are OneUptime's data security analyst. OneUptime Data Security found an issue on one of the team's data stores, and a person must decide quickly what to do about it. The user message holds what OneUptime knows about the issue, as facts, each with an id.";

const ANALYST_QUESTIONS: Array<string> = [
  "Answer from the facts alone:",
  '- verdict: is the issue real? One of: "Real" - the risk is there, and nothing in the facts says it is meant to be; "LikelyByDesign" - the facts say it is meant to be so, such as a public website\'s images, a public dataset or a store marked public by design, and nothing sensitive is at risk; "LikelyWrongFinding" - the facts say the check misread the store, such as a field a detector misread, or a data type the store\'s name, kind or tags show it cannot hold; "CannotTell" - the facts do not say. Never answer "LikelyByDesign" for a store of Restricted data: secrets, card numbers, health records.',
  "- reason: why that verdict, in one sentence.",
  "- risk: what the issue puts at risk: the data and about how many records, who can reach it (the riskiest first), copies of its data in other stores, and the security cases on it.",
  "- breaks: what the fix would break: the services seen using the store and how recently, the identities that used their access in the last 90 days, and the grants the fix removes that something still uses. When nothing uses it, say that nothing OneUptime can see uses it.",
  "- path: the shortest path to fixed: what contains it now (the response action and whether it can run, or the change OneUptime AI proposed), then what fixes the cause (the code that declares the store), and who should do it (the store's owners, or that nobody owns it).",
  '- draft: only when the verdict is "LikelyByDesign" or "LikelyWrongFinding", the reason a person would give for accepting the risk, or for saying it is not an issue, in one sentence. Otherwise null.',
];

const TELEMETRY_NOTE: string =
  "This issue is in a service's telemetry. Its fix is a scrub rule at ingest, then a change to the code that writes the data. A scrub rule hides the data in OneUptime only, so anything that searches or charts by that attribute sees it masked.";

function getAnalystRules(languageName: string): Array<string> {
  return [
    `Write reason, risk, breaks, path and draft each as one or two plain sentences of at most ${DATA_SECURITY_ANALYSIS_LIMITS.maxLineLength - 100} characters, in ${languageName}. No Markdown, no links, and no fact ids in the text.`,
    "Name stores, identities, services and repositories as the facts name them, and copy numbers exactly. Never invent a fact: say only what the facts say.",
    "Each of them lists, in facts, the ids of the facts it rests on, such as I1, S1 or R2. A line that rests on no fact is dropped.",
    `Answer with JSON only, exactly: {"verdict": "${DATA_SECURITY_AI_VERDICTS[0]}", "reason": {"text": "...", "facts": ["S2"]}, "risk": {"text": "...", "facts": ["S1", "R0"]}, "breaks": {"text": "...", "facts": ["U1"]}, "path": {"text": "...", "facts": ["A1", "D1", "O1"]}, "draft": null}`,
  ];
}

/*
 * What the analysis is asked, in OneUptime's words: the four questions, the
 * verdicts, how to write each line and in which language, and that every
 * line names its facts. A telemetry issue's fix is said for what it is.
 */
export function getDataSecurityAnalystInstructions(data: {
  checkId: string | undefined;
  language: string;
}): string {
  return [
    ANALYST_ROLE,
    ...(isTelemetryFindingCheck(data.checkId) ? [TELEMETRY_NOTE] : []),
    ...ANALYST_QUESTIONS,
    ...getAnalystRules(getAnalysisLanguageName(data.language)),
  ].join("\n");
}

/*
 * The analysis's prompt: the analyst's instructions after the team's AI
 * context, and the issue's facts as data, under the feature that asks -
 * Explain with AI (a person) or Analyze (the issue opening). `dataTypeNamer`
 * names the data types the project's way (ProjectDataTypeNames); with none,
 * a custom type is named as one, never by its id.
 */
export function buildIssueAnalysisPrompt(data: {
  feature:
    | DataSecurityAiFeature.ExplainIssue
    | DataSecurityAiFeature.AnalyzeIssue;
  dossier: AiIssueDossier;
  language: string;
  dataTypeNamer?: DataTypeNamer | undefined;
  aiContext?: AiContextActivity | null | undefined;
}): DataSecurityAiPrompt {
  return DataSecurityAiInput.buildAnalyzeIssuePrompt({
    feature: data.feature,
    instructions: getDataSecurityAnalystInstructions({
      checkId: data.dossier.issue.checkId,
      language: data.language,
    }),
    dossier: data.dossier,
    dataTypeNamer: data.dataTypeNamer,
    aiContext: data.aiContext,
  });
}

// The most a line of the answer may be before it is cut, and the ids it may name.
const MAX_ANSWER_LINE_LENGTH: number = 1000;
const MAX_ANSWER_FACT_IDS: number = 24;

type AnswerLineShape = StrictObject<{
  text: StrictText;
  facts: StrictList<StrictText>;
}>;

const ANSWER_LINE: AnswerLineShape = StrictAnswer.object({
  text: StrictAnswer.text({
    maxLength: MAX_ANSWER_LINE_LENGTH,
    isOneLine: true,
  }),
  facts: StrictAnswer.list(
    StrictAnswer.text({
      maxLength: 12,
      whenTooLong: "refuse",
      isOneLine: true,
    }),
    { maxItems: MAX_ANSWER_FACT_IDS },
  ),
});

type OptionalLine = StrictOptional<StrictNullable<AnswerLineShape>>;

function optionalLine(): OptionalLine {
  return StrictAnswer.optional(StrictAnswer.nullable(ANSWER_LINE));
}

/*
 * The analysis's answer, exactly as it is asked for: a verdict of the
 * four, and each line as its text and the ids of the facts it rests on. A
 * line may be null or left out; anything else is no answer (StrictAnswer).
 */
export const DATA_SECURITY_ANALYSIS_ANSWER: StrictObject<{
  verdict: StrictText;
  reason: OptionalLine;
  risk: OptionalLine;
  breaks: OptionalLine;
  path: OptionalLine;
  draft: OptionalLine;
}> = StrictAnswer.object({
  verdict: StrictAnswer.text({
    maxLength: 40,
    whenTooLong: "refuse",
    isOneLine: true,
    oneOf: DATA_SECURITY_AI_VERDICTS,
  }),
  reason: optionalLine(),
  risk: optionalLine(),
  breaks: optionalLine(),
  path: optionalLine(),
  draft: optionalLine(),
});

/*
 * OneUptime AI's answer as the analysis reads it - before it is held to
 * its facts (holdAnalysisToFacts) - or null: not one JSON object of the
 * shape asked for. Shared by the analysis and the eval, so a score
 * measures what ships.
 */
export function readDataSecurityAnalysisAnswer(
  content: string | null | undefined,
): DataSecurityAnalysisAnswer | null {
  const answer: StrictValue<typeof DATA_SECURITY_ANALYSIS_ANSWER> | null =
    readStrictAnswer(content, DATA_SECURITY_ANALYSIS_ANSWER);

  if (!answer) {
    return null;
  }

  const lines: DataSecurityAnalysisAnswer["lines"] = {};

  for (const part of DATA_SECURITY_ANALYSIS_PARTS) {
    const line: { text: string; facts: Array<string> } | null | undefined = (
      answer as Record<
        DataSecurityAnalysisPart,
        { text: string; facts: Array<string> } | null | undefined
      >
    )[part];

    if (line) {
      lines[part] = { text: line.text, facts: line.facts };
    }
  }

  return { verdict: answer.verdict, lines };
}

export const DATA_SECURITY_FIX_INSTRUCTION: string =
  "Fix this data security issue in the infrastructure code (Terraform, CloudFormation, Bicep or similar), with the smallest change that makes the check pass. Open a pull request.";

export const DATA_SECURITY_TELEMETRY_FIX_INSTRUCTION: string =
  "Fix this data security issue in the code of the service that writes this data to its telemetry: find where it logs the value, or sets it on a span, an exception or an AI call, at each place listed, and stop sending it - leave it out, or mask or hash it first - with the smallest change. Open a pull request.";

/*
 * One place a telemetry issue's data was found (a DataStoreFinding): what
 * the code writes there, never a sample of what it wrote.
 */
export type DataSecurityFindingForAi = AiFindingRecord;

/*
 * The most a fix's request holds: what Code takes in a request
 * (CodeTaskRuns.readMessage), which refuses a longer one whole.
 */
export const MAX_FIX_REQUEST_LENGTH: number = CODE_TASK_LIMITS.maxMessageLength;

/*
 * What Fix with AI asks the coding agent to do: the instruction - in the
 * service's code for a telemetry issue, in infrastructure code for any
 * other - then the issue as data, with the places a telemetry issue's data
 * sits. Held to MAX_FIX_REQUEST_LENGTH: the places matched least are left
 * out first (DataSecurityAiInput.buildFixIssueRequest), so the instruction
 * and what the check saw always go.
 */
export function buildDataSecurityFixRequest(
  issue: AiIssueRecord,
  findings: ReadonlyArray<DataSecurityFindingForAi> = [],
  dataTypeNamer: DataTypeNamer = DataTypeNamer.withoutCustomTypes(),
): DataSecurityAiCodeRequest {
  return DataSecurityAiInput.buildFixIssueRequest({
    instruction: isTelemetryFindingCheck(issue.checkId)
      ? DATA_SECURITY_TELEMETRY_FIX_INSTRUCTION
      : DATA_SECURITY_FIX_INSTRUCTION,
    issue,
    findings,
    dataTypeNamer,
    maxLength: MAX_FIX_REQUEST_LENGTH,
  });
}
