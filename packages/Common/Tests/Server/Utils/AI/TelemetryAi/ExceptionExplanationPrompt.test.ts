import { describe, expect, test } from "@jest/globals";
import {
  buildExceptionExplanationPrompt,
  EXCEPTION_EXPLANATION_SYSTEM_PROMPT,
  ExceptionExplanationEvidence,
  MAX_PROMPT_LOGS,
  MAX_PROMPT_MESSAGE_LENGTH,
  MAX_PROMPT_SPANS,
  MAX_PROMPT_STACK_TRACE_LENGTH,
  parseExceptionExplanationResponse,
  pickExplanationSpanAttributes,
} from "../../../../../Server/Utils/AI/TelemetryAi/ExceptionExplanationPrompt";
import {
  ExceptionAIExplanation,
  ExceptionExplanationCategory,
  ExceptionExplanationConfidence,
} from "../../../../../Types/Telemetry/ExceptionAIExplanation";

/*
 * What OneUptime AI is told about an exception, and how its answer is read
 * (ExceptionExplanationPrompt): the evidence section by section, every value
 * cut and scrubbed - no ID, email or token leaves the platform - and an
 * answer read only for the JSON it holds, a suspect frame kept only when the
 * stack trace has its file.
 */

const STACK_TRACE: string = [
  "TypeError: Cannot read properties of undefined (reading 'items')",
  "    at checkout (/app/src/cart.ts:42:17)",
  "    at processOrder (/app/src/orders.ts:88:5)",
  "    at Layer.handle (/app/node_modules/express/lib/router/layer.js:95:5)",
].join("\n");

function evidence(
  overrides: Partial<ExceptionExplanationEvidence> = {},
): ExceptionExplanationEvidence {
  return {
    exceptionType: "TypeError",
    message:
      "Cannot read properties of undefined (reading 'items') for user priya@example.com order 550e8400-e29b-41d4-a716-446655440000",
    stackTrace: STACK_TRACE,
    resourceName: "checkout-api",
    resourceType: "OpenTelemetry",
    environment: "production",
    occurrenceCount: 412,
    firstSeenAt: new Date("2026-10-30T09:00:00.000Z"),
    lastSeenAt: new Date("2026-10-30T11:55:00.000Z"),
    firstSeenInRelease: "2.3.1",
    lastSeenInRelease: "2.3.2",
    unhandled: true,
    errorClass: "code-fault",
    isResolved: false,
    latestOccurrence: {
      time: new Date("2026-10-30T11:55:00.000Z"),
      release: "2.3.2",
      spanName: "POST /checkout",
      spanAttributes: {
        "http.route": "/checkout",
        "http.response.status_code": "500",
      },
    },
    spans: [
      {
        name: "POST /checkout",
        kind: "Server",
        statusCode: 2,
        durationMs: 1234.4,
        isExceptionSpan: true,
      },
      {
        name: "SELECT orders",
        kind: "Client",
        statusCode: 1,
        durationMs: 12,
        isExceptionSpan: false,
      },
    ],
    logs: [
      {
        time: new Date("2026-10-30T11:54:59.000Z"),
        severity: "Error",
        body: "cart lookup returned nothing for session 9f8e7d6c5b4a39281706f5e4d3c2b1a0",
      },
    ],
    changes: [
      {
        time: new Date("2026-10-30T08:50:00.000Z"),
        eventType: "deployment",
        title: "Deploy checkout-api",
        version: "2.3.1",
        commitSha: "0123456789abcdef0123456789abcdef01234567",
      },
    ],
    ...overrides,
  };
}

describe("the prompt", () => {
  test("states the exception, its stack and its own frames", () => {
    const prompt: string = buildExceptionExplanationPrompt(evidence());

    expect(prompt).toContain("## Exception");
    expect(prompt).toContain("Type: TypeError");
    expect(prompt).toContain(
      "Where: checkout-api (OpenTelemetry), environment production",
    );
    expect(prompt).toContain("Occurrences so far: 412");
    expect(prompt).toContain(
      "First seen: 2026-10-30T09:00:00.000Z in release 2.3.1",
    );
    expect(prompt).toContain(
      "Handled by the application: no (at least one occurrence escaped uncaught)",
    );
    expect(prompt).toContain("## Stack trace");
    expect(prompt).toContain("at checkout (/app/src/cart.ts:42:17)");
    // The application's own frames, never the library's.
    expect(prompt).toContain("- /app/src/cart.ts:42 in checkout");
    expect(prompt).toContain("- /app/src/orders.ts:88 in processOrder");
    expect(prompt).not.toContain("- /app/node_modules/express");
  });

  test("scrubs the message, logs and names: no email, UUID or ID leaves", () => {
    const prompt: string = buildExceptionExplanationPrompt(evidence());

    expect(prompt).not.toContain("priya@example.com");
    expect(prompt).not.toContain("550e8400-e29b-41d4-a716-446655440000");
    expect(prompt).not.toContain("9f8e7d6c5b4a39281706f5e4d3c2b1a0");
    expect(prompt).toContain("<EMAIL>");
    expect(prompt).toContain("<UUID>");
  });

  test("tells the trace in order, marking where the exception was recorded", () => {
    const prompt: string = buildExceptionExplanationPrompt(evidence());

    expect(prompt).toContain(
      "- POST /checkout (Server, error, 1234 ms) <- the exception was recorded here",
    );
    expect(prompt).toContain("- SELECT orders (Client, ok, 12 ms)");
    expect(prompt.indexOf("POST /checkout (Server")).toBeLessThan(
      prompt.indexOf("SELECT orders (Client"),
    );
    expect(prompt).toContain("http.route: /checkout");
    expect(prompt).toContain("http.response.status_code: 500");
  });

  test("names the logs and the deploys around the time it started", () => {
    const prompt: string = buildExceptionExplanationPrompt(evidence());

    expect(prompt).toContain("## Logs written in that trace");
    expect(prompt).toContain("2026-10-30T11:54:59.000Z Error: cart lookup");
    expect(prompt).toContain(
      "## Deploys and changes around the time it started",
    );
    expect(prompt).toContain(
      "deployment: Deploy checkout-api, version 2.3.1, commit 0123456789ab",
    );
  });

  test("says when a resolved exception came back", () => {
    expect(
      buildExceptionExplanationPrompt(
        evidence({ regressedAt: new Date("2026-10-30T10:00:00.000Z") }),
      ),
    ).toContain(
      "It was resolved, and came back at 2026-10-30T10:00:00.000Z: the earlier fix did not hold.",
    );
    // Resolved again: not a regression any more.
    expect(
      buildExceptionExplanationPrompt(
        evidence({
          isResolved: true,
          regressedAt: new Date("2026-10-30T10:00:00.000Z"),
        }),
      ),
    ).not.toContain("came back");
  });

  test("an exception with nothing but its type still makes a prompt", () => {
    const prompt: string = buildExceptionExplanationPrompt(
      evidence({
        message: "",
        stackTrace: "",
        latestOccurrence: undefined,
        spans: [],
        logs: [],
        changes: [],
        resourceName: undefined,
        firstSeenAt: undefined,
      }),
    );

    expect(prompt).toContain("Message: (no message)");
    expect(prompt).toContain("(no stack trace was recorded)");
    expect(prompt).toContain("First seen: unknown");
    expect(prompt).not.toContain("## Logs");
    expect(prompt).not.toContain("## The trace");
  });

  test("holds every source to its size", () => {
    const prompt: string = buildExceptionExplanationPrompt(
      evidence({
        message: "m".repeat(50000),
        stackTrace: `Error: x\n${"    at f (/app/src/a.ts:1:1)\n".repeat(5000)}`,
        spans: Array.from({ length: 200 }, (_: unknown, i: number) => {
          return {
            name: `span-${i}`,
            kind: "Internal",
            isExceptionSpan: false,
          };
        }),
        logs: Array.from({ length: 200 }, (_: unknown, i: number) => {
          return { severity: "Info", body: `log line ${i}` };
        }),
      }),
    );

    const messageLine: string = prompt
      .split("\n")
      .find((line: string): boolean => {
        return line.startsWith("Message: ");
      })!;

    expect(messageLine.length).toBeLessThanOrEqual(
      "Message: ".length + MAX_PROMPT_MESSAGE_LENGTH,
    );
    expect(prompt).toContain(`span-${MAX_PROMPT_SPANS - 1} `);
    expect(prompt).not.toContain(`span-${MAX_PROMPT_SPANS} `);
    expect(prompt).toContain(`log line ${MAX_PROMPT_LOGS - 1}`);
    expect(prompt).not.toContain(`log line ${MAX_PROMPT_LOGS}\n`);
    // The whole prompt stays a few tens of KB however big the input.
    expect(prompt.length).toBeLessThan(
      MAX_PROMPT_STACK_TRACE_LENGTH + MAX_PROMPT_MESSAGE_LENGTH + 20000,
    );
  });

  test("only the allowed span attributes are picked, each cut short", () => {
    expect(
      pickExplanationSpanAttributes({
        "http.route": "/checkout",
        "http.status_code": 500,
        "user.email": "priya@example.com",
        "enduser.id": "42",
        "db.system": "x".repeat(1000),
        "http.method": { nested: true },
      }),
    ).toEqual({
      "http.route": "/checkout",
      "http.status_code": "500",
      "db.system": "x".repeat(200),
    });
  });

  test("the system prompt asks for the JSON the parser reads", () => {
    for (const field of [
      "summary",
      "rootCause",
      "suggestedFix",
      "confidence",
      "category",
      "suspectFrames",
      "nextSteps",
    ]) {
      expect(EXCEPTION_EXPLANATION_SYSTEM_PROMPT).toContain(`"${field}"`);
    }

    for (const category of Object.values(ExceptionExplanationCategory)) {
      expect(EXCEPTION_EXPLANATION_SYSTEM_PROMPT).toContain(`"${category}"`);
    }

    for (const confidence of Object.values(ExceptionExplanationConfidence)) {
      expect(EXCEPTION_EXPLANATION_SYSTEM_PROMPT).toContain(`"${confidence}"`);
    }
  });
});

describe("reading the answer", () => {
  const ANSWER: string = JSON.stringify({
    summary: "Checkout fails when the cart is empty.",
    rootCause: "`cart.items` is undefined.",
    suggestedFix: "Guard against an empty cart.",
    confidence: "medium",
    category: "code",
    suspectFrames: [
      { file: "/app/src/cart.ts", line: 42, function: "checkout" },
      { file: "/app/src/made-up.ts", line: 7, function: "ghost" },
    ],
    nextSteps: ["Add a test."],
  });

  test("a bare JSON answer", () => {
    const explanation: ExceptionAIExplanation | null =
      parseExceptionExplanationResponse(ANSWER, STACK_TRACE);

    expect(explanation?.summary).toBe("Checkout fails when the cart is empty.");
    expect(explanation?.confidence).toBe(ExceptionExplanationConfidence.Medium);
  });

  test("a fenced answer, and one with prose around it", () => {
    expect(
      parseExceptionExplanationResponse(
        `\`\`\`json\n${ANSWER}\n\`\`\``,
        STACK_TRACE,
      )?.summary,
    ).toBe("Checkout fails when the cart is empty.");
    expect(
      parseExceptionExplanationResponse(
        `Here is the explanation:\n${ANSWER}\nHope this helps.`,
        STACK_TRACE,
      )?.summary,
    ).toBe("Checkout fails when the cart is empty.");
  });

  test("a frame the stack trace does not hold is dropped", () => {
    expect(
      parseExceptionExplanationResponse(ANSWER, STACK_TRACE)?.suspectFrames,
    ).toEqual([{ file: "/app/src/cart.ts", line: 42, function: "checkout" }]);
    // No stack trace: no frame can be shown as the exception's own.
    expect(
      parseExceptionExplanationResponse(ANSWER, "")?.suspectFrames,
    ).toEqual([]);
  });

  test("an answer with no explanation in it is none", () => {
    expect(
      parseExceptionExplanationResponse(
        "I cannot help with that.",
        STACK_TRACE,
      ),
    ).toBeNull();
    expect(
      parseExceptionExplanationResponse("{not json}", STACK_TRACE),
    ).toBeNull();
    expect(
      parseExceptionExplanationResponse('{"rootCause": "x"}', STACK_TRACE),
    ).toBeNull();
    expect(parseExceptionExplanationResponse("", STACK_TRACE)).toBeNull();
  });
});
