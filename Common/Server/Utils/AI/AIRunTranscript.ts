import { AIRunEventContentPayload } from "../../../Types/AI/AIChatTypes";
import { JSONObject } from "../../../Types/JSON";

/*
 * Write-time caps for AIRunEvent.contentPayload — the run transcript.
 *
 * The transcript exists to debug a bad run, so it stores content verbatim
 * rather than summarized. That makes bounding it a storage requirement, not a
 * nicety: a code-fix agent may read large files and run test suites that emit
 * megabytes, and it does so up to 40 times per run.
 *
 * Only NEW messages are recorded per call (never the whole replayed history),
 * so a run's transcript grows linearly with its turns rather than
 * quadratically. These caps then bound each turn.
 */
export const MAX_MESSAGE_CONTENT_CHARS: number = 20000;
export const MAX_RESPONSE_CONTENT_CHARS: number = 20000;
export const MAX_TOOL_RESULT_CHARS: number = 20000;
export const MAX_TOOL_ARGUMENT_CHARS: number = 10000;
// Belt and braces: a hard ceiling on the serialized payload.
export const MAX_PAYLOAD_CHARS: number = 200000;

const TRUNCATION_SUFFIX: string = "\n… [truncated]";

export default class AIRunTranscript {
  /*
   * Clip one string to a cap. Returns the value and whether it was clipped,
   * so the payload can honestly report truncation to the reader rather than
   * silently presenting a partial prompt as complete.
   */
  public static clip(
    value: string | undefined,
    maxChars: number,
  ): { value: string | undefined; isTruncated: boolean } {
    if (value === undefined || value === null) {
      return { value: undefined, isTruncated: false };
    }

    if (value.length <= maxChars) {
      return { value, isTruncated: false };
    }

    return {
      value: value.substring(0, maxChars) + TRUNCATION_SUFFIX,
      isTruncated: true,
    };
  }

  /*
   * Clip tool arguments by serializing them, so a single huge argument (a
   * write_file `content`, say) cannot blow the row up. Unparseable or
   * oversized arguments degrade to a marker object rather than being dropped
   * — knowing a tool was called with arguments too big to store is itself a
   * useful debugging signal.
   */
  public static clipArguments(args: JSONObject | undefined): {
    value: JSONObject | undefined;
    isTruncated: boolean;
  } {
    if (!args) {
      return { value: undefined, isTruncated: false };
    }

    let serialized: string = "";

    try {
      serialized = JSON.stringify(args);
    } catch {
      return {
        value: { _note: "Arguments could not be serialized." },
        isTruncated: true,
      };
    }

    if (serialized.length <= MAX_TOOL_ARGUMENT_CHARS) {
      return { value: args, isTruncated: false };
    }

    return {
      value: {
        _note: `Arguments omitted — ${serialized.length} characters exceeds the ${MAX_TOOL_ARGUMENT_CHARS} character cap.`,
        _preview: serialized.substring(0, 2000),
      },
      isTruncated: true,
    };
  }

  /*
   * Apply every cap to a payload and stamp isTruncated if anything was
   * clipped. The final MAX_PAYLOAD_CHARS check is a backstop for a payload
   * that is under the per-field caps but still large in aggregate (many
   * messages); it drops the request messages first, since the response and
   * tool result are the more valuable half when debugging.
   */
  public static clampPayload(
    payload: AIRunEventContentPayload,
  ): AIRunEventContentPayload {
    let isTruncated: boolean = payload.isTruncated === true;

    const clamped: AIRunEventContentPayload = { ...payload };

    if (payload.requestMessages) {
      clamped.requestMessages = payload.requestMessages.map(
        (message: { role: string; content: string }) => {
          const clipped: { value: string | undefined; isTruncated: boolean } =
            this.clip(message.content, MAX_MESSAGE_CONTENT_CHARS);

          if (clipped.isTruncated) {
            isTruncated = true;
          }

          return { role: message.role, content: clipped.value || "" };
        },
      );
    }

    if (payload.responseContent !== undefined) {
      const clipped: { value: string | undefined; isTruncated: boolean } =
        this.clip(payload.responseContent, MAX_RESPONSE_CONTENT_CHARS);
      clamped.responseContent = clipped.value;
      isTruncated = isTruncated || clipped.isTruncated;
    }

    if (payload.toolResult !== undefined) {
      const clipped: { value: string | undefined; isTruncated: boolean } =
        this.clip(payload.toolResult, MAX_TOOL_RESULT_CHARS);
      clamped.toolResult = clipped.value;
      isTruncated = isTruncated || clipped.isTruncated;
    }

    if (payload.responseToolCalls) {
      clamped.responseToolCalls = payload.responseToolCalls.map(
        (toolCall: {
          id?: string | undefined;
          name: string;
          arguments?: JSONObject | undefined;
        }) => {
          const clipped: {
            value: JSONObject | undefined;
            isTruncated: boolean;
          } = this.clipArguments(toolCall.arguments);

          if (clipped.isTruncated) {
            isTruncated = true;
          }

          return {
            ...(toolCall.id ? { id: toolCall.id } : {}),
            name: toolCall.name,
            ...(clipped.value ? { arguments: clipped.value } : {}),
          };
        },
      );
    }

    if (this.serializedLength(clamped) > MAX_PAYLOAD_CHARS) {
      const messageCount: number = clamped.requestMessages?.length || 0;

      clamped.requestMessages = [
        {
          role: "system",
          content: `[${messageCount} request message(s) omitted — the transcript for this step exceeded the ${MAX_PAYLOAD_CHARS} character cap.]`,
        },
      ];
      isTruncated = true;
    }

    if (isTruncated) {
      clamped.isTruncated = true;
    }

    return clamped;
  }

  private static serializedLength(payload: AIRunEventContentPayload): number {
    try {
      return JSON.stringify(payload).length;
    } catch {
      return Number.MAX_SAFE_INTEGER;
    }
  }
}
