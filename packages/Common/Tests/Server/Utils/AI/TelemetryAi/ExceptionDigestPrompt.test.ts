import { describe, expect, test } from "@jest/globals";
import {
  buildExceptionDigestPrompt,
  DigestException,
  EXCEPTION_DIGEST_SYSTEM_PROMPT,
  MAX_DIGEST_PROMPT_MESSAGE_LENGTH,
  parseExceptionDigestResponse,
} from "../../../../../Server/Utils/AI/TelemetryAi/ExceptionDigestPrompt";
import {
  ExceptionAIDigest,
  ExceptionDigestItem,
  ExceptionDigestKind,
  ExceptionDigestPriority,
  MAX_DIGEST_EXCEPTIONS,
} from "../../../../../Types/Telemetry/ExceptionAIDigest";

/*
 * What OneUptime AI is told about a day's new and regressed exceptions, and
 * how its answer is read: each exception is a reference (E1, E2, ...), never
 * an id; values are cut and scrubbed; an item about a reference the prompt
 * did not hold is dropped, and an exception the model left out is still
 * listed.
 */

const STACK_TRACE: string =
  "TypeError: x\n    at checkout (/app/src/cart.ts:42:17)\n    at run (/app/node_modules/x/index.js:1:1)";

function exception(
  index: number,
  overrides: Partial<DigestException> = {},
): DigestException {
  return {
    telemetryExceptionId: `00000000-0000-4000-8000-00000000000${index}`,
    kind: ExceptionDigestKind.New,
    exceptionType: "TypeError",
    message: `Cannot read properties of undefined (reading 'items') #${index}`,
    stackTrace: STACK_TRACE,
    resourceName: "checkout",
    environment: "production",
    occurrenceCount: 10 + index,
    firstSeenAt: new Date("2026-10-30T09:00:00.000Z"),
    release: "2.3.2",
    unhandled: true,
    ...overrides,
  };
}

describe("buildExceptionDigestPrompt", () => {
  test("names each exception by a reference, with what it is and where", () => {
    const prompt: string = buildExceptionDigestPrompt([
      exception(1),
      exception(2, {
        kind: ExceptionDigestKind.Regressed,
        regressedAt: new Date("2026-10-30T10:00:00.000Z"),
        unhandled: false,
      }),
    ]);

    expect(prompt).toContain("## E1 (new)");
    expect(prompt).toContain("## E2 (regressed: resolved before, came back)");
    expect(prompt).toContain("Where: checkout, environment production");
    expect(prompt).toContain("First seen: 2026-10-30T09:00:00.000Z");
    expect(prompt).toContain("Came back: 2026-10-30T10:00:00.000Z");
    expect(prompt).toContain("Release: 2.3.2");
    expect(prompt).toContain("Top frame: checkout (/app/src/cart.ts:42)");
    expect(prompt).toContain("Handled by the application: no");
    expect(prompt).toContain("Handled by the application: yes, or unknown");
    // Never an id.
    expect(prompt).not.toContain("00000000-0000-4000-8000-000000000001");
  });

  test("scrubs what it sends, and cuts it first", () => {
    const prompt: string = buildExceptionDigestPrompt([
      exception(1, {
        message: `Payment for priya@example.com failed ${"x".repeat(5000)}`,
      }),
    ]);

    expect(prompt).not.toContain("priya@example.com");
    const messageLine: string =
      prompt.split("\n").find((line: string): boolean => {
        return line.startsWith("Message: ");
      }) || "";
    expect(messageLine.length).toBeLessThanOrEqual(
      "Message: ".length + MAX_DIGEST_PROMPT_MESSAGE_LENGTH,
    );
  });

  test("holds at most the most exceptions a digest is written from", () => {
    const prompt: string = buildExceptionDigestPrompt(
      Array.from({ length: MAX_DIGEST_EXCEPTIONS + 3 }, (_value: unknown) => {
        return exception(1);
      }),
    );

    expect(prompt).toContain(`## E${MAX_DIGEST_EXCEPTIONS} (new)`);
    expect(prompt).not.toContain(`## E${MAX_DIGEST_EXCEPTIONS + 1} `);
  });

  test("the system prompt asks for JSON with references only", () => {
    expect(EXCEPTION_DIGEST_SYSTEM_PROMPT).toContain('"headline"');
    expect(EXCEPTION_DIGEST_SYSTEM_PROMPT).toContain('"ref": "E1"');
    expect(EXCEPTION_DIGEST_SYSTEM_PROMPT).toContain(
      "Never invent a reference.",
    );
  });
});

describe("parseExceptionDigestResponse", () => {
  const given: Array<DigestException> = [
    exception(1),
    exception(2, { kind: ExceptionDigestKind.Regressed }),
    exception(3),
  ];

  test("maps each reference back to its exception, the most urgent first", () => {
    const digest: ExceptionAIDigest | null = parseExceptionDigestResponse(
      "```json\n" +
        JSON.stringify({
          headline: "Checkout broke after 2.3.2.",
          items: [
            {
              ref: "E1",
              summary: "Empty carts crash checkout.",
              priority: "medium",
            },
            { ref: "e2", summary: "The cart bug is back.", priority: "high" },
            { ref: "E3", summary: "Noise from a bot.", priority: "low" },
          ],
        }) +
        "\n```",
      given,
    );

    expect(digest?.headline).toBe("Checkout broke after 2.3.2.");
    expect(
      digest?.items.map((item: ExceptionDigestItem) => {
        return [item.telemetryExceptionId, item.kind, item.priority];
      }),
    ).toEqual([
      [given[1]!.telemetryExceptionId, ExceptionDigestKind.Regressed, "high"],
      [given[0]!.telemetryExceptionId, ExceptionDigestKind.New, "medium"],
      [given[2]!.telemetryExceptionId, ExceptionDigestKind.New, "low"],
    ]);
  });

  test("drops what the prompt did not hold, keeps what the model left out", () => {
    const digest: ExceptionAIDigest | null = parseExceptionDigestResponse(
      JSON.stringify({
        headline: "Headline",
        items: [
          { ref: "E9", summary: "An exception it made up.", priority: "high" },
          { ref: "E1", summary: "First.", priority: "high" },
          { ref: "E1", summary: "First, again.", priority: "low" },
          { ref: "E2", summary: "", priority: "high" },
        ],
      }),
      given,
    );

    const ids: Array<string> = (digest?.items || []).map(
      (item: ExceptionDigestItem): string => {
        return item.telemetryExceptionId;
      },
    );

    expect(ids).toEqual([
      given[0]!.telemetryExceptionId,
      given[1]!.telemetryExceptionId,
      given[2]!.telemetryExceptionId,
    ]);
    expect(digest?.items[0]?.summary).toBe("First.");
    // Left out by the model: its message, at medium.
    expect(digest?.items[1]?.summary).toBe(given[1]!.message);
    expect(digest?.items[1]?.priority).toBe(ExceptionDigestPriority.Medium);
  });

  test("no headline, no digest", () => {
    expect(
      parseExceptionDigestResponse(JSON.stringify({ items: [] }), given),
    ).toBe(null);
    expect(
      parseExceptionDigestResponse("I cannot help with that.", given),
    ).toBe(null);
    expect(parseExceptionDigestResponse("", given)).toBe(null);
  });
});
