import { JSONObject } from "../JSON";
import { AIAgentRunLimits } from "./AIAgentRunLimits";
import { AIChatCitationTarget } from "./AIChatTypes";
import { AiContextActivity } from "./AiContext";

/*
 * What an AI investigation saw, kept so it can be run again later on exactly
 * the same data with another prompt or another model (issue #6800): the
 * starting context the model was given, and every tool call it made with
 * the text it was handed back. A replay (Server/Utils/AI/Eval/
 * ReplayInvestigation) builds today's prompt around the same context and
 * answers each tool call from here - never from the project's live data,
 * which has moved on or aged out by then - so a change is scored on the
 * evidence the original run had.
 *
 * Kept by the server only (AIRunRecording: no API reads it, no person can),
 * for INVESTIGATION_RECORDING_RETENTION_IN_DAYS, and held to the caps below.
 * What the model read is what the toolbox already redacted and cut to size,
 * so nothing is kept that the model was not shown.
 */

// The shape of a recording; a replay reads only the versions it knows.
export const INVESTIGATION_RECORDING_VERSION: number = 1;

/*
 * How long a recording is kept. Long enough to replay last month's
 * investigations after a prompt or model change; short enough that what the
 * tools returned does not outlive the telemetry it came from by much.
 */
export const INVESTIGATION_RECORDING_RETENTION_IN_DAYS: number = 30;

/*
 * The caps. A run is recorded until one is reached; a tool call past them is
 * kept without its text, or not kept at all, and a replay that comes to it
 * counts it as not recorded rather than inventing an answer.
 */
// The most tool calls one recording keeps.
export const INVESTIGATION_RECORDING_MAX_TOOL_CALLS: number = 300;
/*
 * The most characters of one tool result: well above what the toolbox hands
 * the model (64 KB, Toolbox/Serializer), so a normal result always fits.
 */
export const INVESTIGATION_RECORDING_MAX_RESULT_CHARACTERS: number = 100000;
// The most characters of tool results one recording keeps, together.
export const INVESTIGATION_RECORDING_MAX_TOTAL_CHARACTERS: number = 1000000;
// The most characters of one tool call's arguments, as JSON.
export const INVESTIGATION_RECORDING_MAX_ARGUMENT_CHARACTERS: number = 10000;

// A tool the run offered the model besides the toolbox's (an MCP server's, a cluster's).
export interface InvestigationRecordedToolDefinition {
  name: string;
  description: string;
  // JSON Schema for the tool's arguments.
  inputSchema: JSONObject;
}

/*
 * What the run was given before it called a tool. The prompt itself is not
 * kept: a replay builds today's, which is the point of one.
 */
export interface InvestigationRecordingInputs {
  /*
   * The subject's context as the model read it: the runner's summary of the
   * incident or alert, with anything embedded in it left out.
   */
  contextText: string;
  // What the runner added to the persona (the clusters it may inspect...).
  additionalInstructions?: string | undefined;
  // Set only by engine users that are not investigations.
  personaOverride?: string | undefined;
  questionOverride?: string | undefined;
  // The project's and its rules' AI context, as the run read it; null: none.
  aiContext: AiContextActivity | null;
  // The time the prompt named as now, as an ISO 8601 string.
  promptTime: string;
  // How far the run was allowed to go.
  runLimits: AIAgentRunLimits;
  maxOutputTokens: number;
  // The toolbox's tools the run kept from the model.
  excludedToolNames: Array<string>;
  // Tools the run offered besides the toolbox's.
  extraTools: Array<InvestigationRecordedToolDefinition>;
  // The provider and model that answered, as the run's AI Logs name them.
  providerName?: string | undefined;
  modelName?: string | undefined;
}

// One tool call the model made, and what it was handed back.
export interface InvestigationRecordedToolCall {
  toolName: string;
  arguments: JSONObject;
  // False: the call failed, and text is the error the model read.
  success: boolean;
  /*
   * What the model read, before OneUptime framed it with its citation.
   * Null when it was too long to keep: a replay answers that call as not
   * recorded.
   */
  text: string | null;
  rowCount?: number | undefined;
  citationLabel?: string | undefined;
  citationTarget?: AIChatCitationTarget | undefined;
  isTruncated?: boolean | undefined;
  durationMs?: number | undefined;
}

export interface InvestigationRecording {
  version: number;
  inputs: InvestigationRecordingInputs;
  // In the order the model made them.
  toolCalls: Array<InvestigationRecordedToolCall>;
  /*
   * Tool calls the run made once the recording was full, or whose arguments
   * were too long to keep: a replay cannot answer them.
   */
  toolCallsNotKept: number;
}
