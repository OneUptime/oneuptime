import AIRunTranscript, {
  MAX_MESSAGE_CONTENT_CHARS,
  MAX_PAYLOAD_CHARS,
  MAX_RESPONSE_CONTENT_CHARS,
  MAX_TOOL_ARGUMENT_CHARS,
  MAX_TOOL_RESULT_CHARS,
} from "../../../../Server/Utils/AI/AIRunTranscript";
import { AIRunEventContentPayload } from "../../../../Types/AI/AIChatTypes";
import { describe, expect, test } from "@jest/globals";

/*
 * The run transcript is the ONE place a code-fix run's LLM content is stored
 * (LlmLog redacts it — it is project-wide readable and these prompts embed
 * customer source code). It stores content verbatim to be worth reading when
 * a run goes wrong, which makes bounding it a storage requirement rather than
 * a nicety: an agent may read large files and run test suites emitting
 * megabytes, up to 40 times per run.
 *
 * These tests pin the two properties that make that safe: every field is
 * capped, and the payload as a whole cannot exceed MAX_PAYLOAD_CHARS no
 * matter WHICH field carries the bulk.
 */

type SerializedLengthFunction = (payload: AIRunEventContentPayload) => number;

const serializedLength: SerializedLengthFunction = (
  payload: AIRunEventContentPayload,
): number => {
  return JSON.stringify(payload).length;
};

describe("AIRunTranscript.clip", () => {
  test("leaves a value under the cap untouched and unflagged", () => {
    expect(AIRunTranscript.clip("short", 100)).toEqual({
      value: "short",
      isTruncated: false,
    });
  });

  test("clips an oversized value and reports the truncation", () => {
    const result: { value: string | undefined; isTruncated: boolean } =
      AIRunTranscript.clip("x".repeat(50), 10);

    expect(result.isTruncated).toBe(true);
    expect(result.value).toContain("truncated");
    expect(result.value!.startsWith("x".repeat(10))).toBe(true);
  });

  test("passes undefined through without inventing a value", () => {
    expect(AIRunTranscript.clip(undefined, 10)).toEqual({
      value: undefined,
      isTruncated: false,
    });
  });
});

describe("AIRunTranscript.clipArguments", () => {
  test("keeps arguments under the cap verbatim", () => {
    const args: { path: string } = { path: "src/Index.ts" };
    expect(AIRunTranscript.clipArguments(args)).toEqual({
      value: args,
      isTruncated: false,
    });
  });

  /*
   * A write_file call carries a whole file in its arguments — the single
   * likeliest way one tool call bloats a row.
   */
  test("replaces oversized arguments with a marker that keeps a preview", () => {
    const result: {
      value: Record<string, unknown> | undefined;
      isTruncated: boolean;
    } = AIRunTranscript.clipArguments({
      content: "y".repeat(MAX_TOOL_ARGUMENT_CHARS + 1000),
    });

    expect(result.isTruncated).toBe(true);
    expect(result.value!["_note"]).toContain("exceeds");
    expect(typeof result.value!["_preview"]).toBe("string");
  });
});

describe("AIRunTranscript.clampPayload", () => {
  test("caps each field independently and stamps isTruncated", () => {
    const clamped: AIRunEventContentPayload = AIRunTranscript.clampPayload({
      requestMessages: [
        { role: "user", content: "a".repeat(MAX_MESSAGE_CONTENT_CHARS + 500) },
      ],
      responseContent: "b".repeat(MAX_RESPONSE_CONTENT_CHARS + 500),
      toolResult: "c".repeat(MAX_TOOL_RESULT_CHARS + 500),
    });

    expect(clamped.isTruncated).toBe(true);
    expect(clamped.requestMessages![0]!.content.length).toBeLessThanOrEqual(
      MAX_MESSAGE_CONTENT_CHARS + 100,
    );
    expect(clamped.responseContent!.length).toBeLessThanOrEqual(
      MAX_RESPONSE_CONTENT_CHARS + 100,
    );
    expect(clamped.toolResult!.length).toBeLessThanOrEqual(
      MAX_TOOL_RESULT_CHARS + 100,
    );
  });

  test("leaves a small payload entirely alone", () => {
    const payload: AIRunEventContentPayload = {
      requestMessages: [{ role: "user", content: "fix the null deref" }],
      responseContent: "Reading the file.",
      responseToolCalls: [{ name: "read_file", arguments: { path: "a.ts" } }],
      totalTokens: 120,
    };

    const clamped: AIRunEventContentPayload =
      AIRunTranscript.clampPayload(payload);

    expect(clamped.isTruncated).toBeUndefined();
    expect(clamped).toEqual(payload);
  });

  /*
   * The regression this file exists for. A single-pass backstop that only
   * dropped requestMessages "succeeded" by deleting a two-character user
   * message while the row stayed ~1.5x over the ceiling, because the bulk was
   * in responseToolCalls. The cap must hold regardless of which field is fat.
   */
  test("holds the ceiling when the bulk is in responseToolCalls, not messages", () => {
    const clamped: AIRunEventContentPayload = AIRunTranscript.clampPayload({
      requestMessages: [{ role: "user", content: "hi" }],
      responseToolCalls: Array.from({ length: 30 }, (_value: unknown, index: number) => {
        return {
          id: `call_${index}`,
          name: "write_file",
          arguments: { content: "z".repeat(MAX_TOOL_ARGUMENT_CHARS - 200) },
        };
      }),
    });

    expect(serializedLength(clamped)).toBeLessThanOrEqual(MAX_PAYLOAD_CHARS);
    expect(clamped.isTruncated).toBe(true);
  });

  test("holds the ceiling when the bulk is a huge tool result", () => {
    const clamped: AIRunEventContentPayload = AIRunTranscript.clampPayload({
      toolResult: "q".repeat(MAX_PAYLOAD_CHARS * 3),
    });

    expect(serializedLength(clamped)).toBeLessThanOrEqual(MAX_PAYLOAD_CHARS);
    expect(clamped.isTruncated).toBe(true);
  });

  /*
   * Bounded ENTRIES are not a bounded ARRAY: with every argument already
   * dropped, enough calls still blow the ceiling. The last resort collapses
   * the array to a count.
   */
  test("holds the ceiling against a pathological number of tool calls", () => {
    const clamped: AIRunEventContentPayload = AIRunTranscript.clampPayload({
      responseToolCalls: Array.from(
        { length: 20000 },
        (_value: unknown, index: number) => {
          return { id: `call_${index}`, name: "read_file" };
        },
      ),
    });

    expect(serializedLength(clamped)).toBeLessThanOrEqual(MAX_PAYLOAD_CHARS);
    expect(clamped.isTruncated).toBe(true);
  });

  // A clipped prompt must never be presented as though it were whole.
  test("never reports a clipped payload as complete", () => {
    const clamped: AIRunEventContentPayload = AIRunTranscript.clampPayload({
      responseContent: "r".repeat(MAX_RESPONSE_CONTENT_CHARS + 1),
    });

    expect(clamped.isTruncated).toBe(true);
  });
});
