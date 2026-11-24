import { AiContextActivity } from "../../../../Types/AI/AiContext";
import { CODE_TASK_LIMITS } from "../../../../Types/AI/CodeTask";
import { isTelemetryFindingCheck } from "../../../../Types/DataSecurity/DataSecurityCheckCatalog";
import DataTypeNamer from "../../../../Types/DataSecurity/DataTypeNamer";
import DataSecurityAiInput, {
  AiFindingRecord,
  AiIssueRecord,
  DataSecurityAiCodeRequest,
  DataSecurityAiPrompt,
} from "./DataSecurityAiInput";

/*
 * WHAT ONEUPTIME AI IS ASKED ABOUT A DATA SECURITY ISSUE: EXPLAIN AND FIX
 * WITH AI (Server/API/DataSecurityAPI).
 *
 * Both are told the issue as a check saw it, as DataSecurityAiInput builds
 * it (#10365): its title, severity and evidence, the store's name, kind,
 * region and cloud id, its sensitivity, the data types found in it by their
 * names (the project's own by the name it gave them, #10363), why the check
 * matters and how to fix it on the store's cloud - one JSON value of data,
 * never a finding's samples, nor a record.
 *
 * A telemetry issue is fixed in the code that writes the data, not in
 * infrastructure code: OneUptime AI is told where each kind of data was
 * found - the data type and the attribute, the log body or the prompt it
 * sits in, which is what the code writes - and asked for a change to the
 * service's own code (issue #5594).
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

export const DATA_SECURITY_EXPLAIN_SYSTEM_PROMPT: string =
  "You are a data security engineer. Explain the issue to the store's owner in plain words: what is wrong, what could happen, and the exact steps to fix it on their cloud. Be brief and concrete. Never invent facts that are not in the issue.";

export const DATA_SECURITY_TELEMETRY_EXPLAIN_SYSTEM_PROMPT: string =
  "You are a data security engineer. Explain the issue to the service's owner in plain words: what sensitive data reaches their telemetry, where it sits in it, what could happen, and the exact steps to stop it - scrub it at ingest, then change the code that writes it. Be brief and concrete. Never invent facts that are not in the issue.";

export const DATA_SECURITY_FIX_INSTRUCTION: string =
  "Fix this data security issue in the infrastructure code (Terraform, CloudFormation, Bicep or similar), with the smallest change that makes the check pass. Open a pull request.";

export const DATA_SECURITY_TELEMETRY_FIX_INSTRUCTION: string =
  "Fix this data security issue in the code of the service that writes this data to its telemetry: find where it logs the value, or sets it on a span, an exception or an AI call, at each place listed, and stop sending it - leave it out, or mask or hash it first - with the smallest change. Open a pull request.";

/*
 * How Explain with AI asks: the most its explanation may be, and how it is
 * sampled (the model calls' own default). The eval asks the same
 * (Eval/DataSecurity), so a score measures what ships.
 */
export const DATA_SECURITY_EXPLAIN_MAX_TOKENS: number = 900;
export const DATA_SECURITY_EXPLAIN_TEMPERATURE: number = 0.7;

/*
 * One place a telemetry issue's data was found (a DataStoreFinding): what
 * the code writes there, never a sample of what it wrote.
 */
export type DataSecurityFindingForAi = AiFindingRecord;

// What OneUptime AI is told when it explains an issue.
export function getDataSecurityExplainSystemPrompt(
  checkId: string | undefined,
): string {
  return isTelemetryFindingCheck(checkId)
    ? DATA_SECURITY_TELEMETRY_EXPLAIN_SYSTEM_PROMPT
    : DATA_SECURITY_EXPLAIN_SYSTEM_PROMPT;
}

/*
 * Explain with AI's prompt: the team's AI context and what it is asked, as
 * the system message, and the issue as data. `dataTypeNamer` names the data
 * types the project's way (ProjectDataTypeNames); with none, a custom type
 * is named as one, never by its id.
 */
export function buildExplainIssuePrompt(data: {
  issue: AiIssueRecord;
  findings?: ReadonlyArray<DataSecurityFindingForAi> | undefined;
  dataTypeNamer?: DataTypeNamer | undefined;
  aiContext?: AiContextActivity | null | undefined;
}): DataSecurityAiPrompt {
  return DataSecurityAiInput.buildExplainIssuePrompt({
    instructions: getDataSecurityExplainSystemPrompt(data.issue.checkId),
    issue: data.issue,
    findings: data.findings,
    dataTypeNamer: data.dataTypeNamer,
    aiContext: data.aiContext,
  });
}

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
