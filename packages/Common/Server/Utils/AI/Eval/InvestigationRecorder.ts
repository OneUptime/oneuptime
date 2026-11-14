import { JSONObject } from "../../../../Types/JSON";
import {
  INVESTIGATION_RECORDING_MAX_ARGUMENT_CHARACTERS,
  INVESTIGATION_RECORDING_MAX_RESULT_CHARACTERS,
  INVESTIGATION_RECORDING_MAX_TOOL_CALLS,
  INVESTIGATION_RECORDING_MAX_TOTAL_CHARACTERS,
  INVESTIGATION_RECORDING_VERSION,
  InvestigationRecordedToolCall,
  InvestigationRecording,
  InvestigationRecordingInputs,
} from "../../../../Types/AI/InvestigationRecording";
import { ObservabilityAssistantToolOutcome } from "../Chat/ObservabilityAssistant";

/*
 * Collects what one investigation attempt was shown, tool call by tool call,
 * as the agent loop hands it over (ObservabilityAssistant onToolOutcome), and
 * turns it into the recording AIRunRecording keeps (Types/AI/
 * InvestigationRecording). In memory only: the engine writes the recording
 * once the attempt has settled its run, so an attempt that lost its run to
 * another leaves nothing behind.
 *
 * Held to the recording's caps as it goes: past the most tool calls, or
 * with arguments too long to keep, a call is only counted; a result too
 * long, or past what the recording keeps together, is kept without its text.
 * A replay answers both as not recorded, and says how many it met.
 */
export default class InvestigationRecorder {
  private readonly toolCalls: Array<InvestigationRecordedToolCall> = [];
  private toolCallsNotKept: number = 0;
  private keptCharacters: number = 0;

  public add(outcome: ObservabilityAssistantToolOutcome): void {
    if (this.toolCalls.length >= INVESTIGATION_RECORDING_MAX_TOOL_CALLS) {
      this.toolCallsNotKept++;
      return;
    }

    const toolArguments: JSONObject | null =
      InvestigationRecorder.copyArguments(outcome.toolArguments);

    if (!toolArguments) {
      this.toolCallsNotKept++;
      return;
    }

    const text: string =
      typeof outcome.textForLlm === "string" ? outcome.textForLlm : "";

    const keepsText: boolean =
      text.length <= INVESTIGATION_RECORDING_MAX_RESULT_CHARACTERS &&
      this.keptCharacters + text.length <=
        INVESTIGATION_RECORDING_MAX_TOTAL_CHARACTERS;

    if (keepsText) {
      this.keptCharacters += text.length;
    }

    const toolCall: InvestigationRecordedToolCall = {
      toolName: outcome.toolName,
      arguments: toolArguments,
      success: outcome.success,
      text: keepsText ? text : null,
    };

    if (typeof outcome.rowCount === "number") {
      toolCall.rowCount = outcome.rowCount;
    }

    if (outcome.citationLabel !== undefined) {
      toolCall.citationLabel = outcome.citationLabel;
    }

    if (outcome.citationTarget !== undefined) {
      toolCall.citationTarget = outcome.citationTarget;
    }

    if (outcome.isTruncated !== undefined) {
      toolCall.isTruncated = outcome.isTruncated;
    }

    if (typeof outcome.durationMs === "number") {
      toolCall.durationMs = outcome.durationMs;
    }

    this.toolCalls.push(toolCall);
  }

  // How many tool calls the recording holds so far.
  public getToolCallCount(): number {
    return this.toolCalls.length;
  }

  public getRecording(
    inputs: InvestigationRecordingInputs,
  ): InvestigationRecording {
    return {
      version: INVESTIGATION_RECORDING_VERSION,
      inputs,
      toolCalls: [...this.toolCalls],
      toolCallsNotKept: this.toolCallsNotKept,
    };
  }

  /*
   * The arguments as they were when the call ran - a copy, so nothing that
   * changes them later changes the recording - or null when they are too
   * long to keep or cannot be written as JSON.
   */
  private static copyArguments(toolArguments: unknown): JSONObject | null {
    if (toolArguments === undefined || toolArguments === null) {
      return {};
    }

    let json: string | undefined;

    try {
      json = JSON.stringify(toolArguments);
    } catch {
      return null;
    }

    if (
      typeof json !== "string" ||
      json.length > INVESTIGATION_RECORDING_MAX_ARGUMENT_CHARACTERS
    ) {
      return null;
    }

    const copy: unknown = JSON.parse(json);

    if (!copy || typeof copy !== "object" || Array.isArray(copy)) {
      return null;
    }

    return copy as JSONObject;
  }
}
