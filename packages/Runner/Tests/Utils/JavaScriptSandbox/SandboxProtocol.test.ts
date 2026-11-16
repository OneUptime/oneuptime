import {
  MAX_SANDBOX_ERROR_MESSAGE_LENGTH,
  MAX_SANDBOX_REPLY_BYTES,
  MAX_SANDBOX_REQUEST_BYTES,
  SANDBOX_PROTOCOL_VERSION,
  SandboxRequest,
  isSandboxNonce,
  parseSandboxReply,
  parseSandboxRequest,
} from "../../../Utils/JavaScriptSandbox/SandboxProtocol";
import { TRUNCATED_OUTPUT_MARKER } from "../../../Utils/OutputTruncation";

/*
 * What the Runner and a step's sandbox process say to each other: one
 * request each way, of one shape. The step's process refuses a request of
 * any other shape (the Runner built it, so another shape is a mismatch, not
 * something to make the best of); the Runner takes only a well-formed reply
 * to the request it sent, and never more output than it asked for.
 */

const NONCE: string = "0123456789abcdef0123456789abcdef";

function requestOf(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    version: SANDBOX_PROTOCOL_VERSION,
    nonce: NONCE,
    code: "return 1;",
    args: { inputs: { host: "web-1" } },
    timeoutInMs: 5_000,
    maxOutputBytes: 50_000,
    policy: {
      allowPrivateNetworkRequests: false,
      privateNetworkAccessIsAllowed: false,
      privateNetworkHint: " Use a Bash step.",
      includeResolutionDetailInError: false,
    },
    ...overrides,
  });
}

describe("the request, as the step's process reads it", () => {
  test("a well-formed request is read whole", () => {
    const request: SandboxRequest = parseSandboxRequest(requestOf());

    expect(request).toEqual({
      version: SANDBOX_PROTOCOL_VERSION,
      nonce: NONCE,
      code: "return 1;",
      args: { inputs: { host: "web-1" } },
      timeoutInMs: 5_000,
      maxOutputBytes: 50_000,
      policy: {
        allowPrivateNetworkRequests: false,
        privateNetworkAccessIsAllowed: false,
        privateNetworkHint: " Use a Bash step.",
        includeResolutionDetailInError: false,
      },
    });
  });

  test("a policy that says nothing keeps the sandbox's own strict default", () => {
    expect(parseSandboxRequest(requestOf({ policy: {} })).policy).toEqual({});
  });

  test("the policy takes only the names VMRunner reads", () => {
    const request: SandboxRequest = parseSandboxRequest(
      requestOf({
        policy: { allowPrivateNetworkRequests: false, somethingElse: true },
      }),
    );

    expect(request.policy).toEqual({ allowPrivateNetworkRequests: false });
  });

  test.each([
    ["not JSON", "{"],
    ["not an object", "[]"],
    ["of another version", requestOf({ version: 2 })],
    ["without a nonce", requestOf({ nonce: undefined })],
    ["with a nonce of another shape", requestOf({ nonce: "short" })],
    ["without a script", requestOf({ code: 42 })],
    ["with args that are a list", requestOf({ args: [] })],
    ["with args that are null", requestOf({ args: null })],
    ["with a timeout of 0", requestOf({ timeoutInMs: 0 })],
    ["with a fractional timeout", requestOf({ timeoutInMs: 1.5 })],
    ["with a timeout as text", requestOf({ timeoutInMs: "5000" })],
    ["with no output limit", requestOf({ maxOutputBytes: undefined })],
    ["with a policy that is not an object", requestOf({ policy: "strict" })],
    [
      "with a policy switch that is not a boolean",
      requestOf({ policy: { allowPrivateNetworkRequests: "false" } }),
    ],
    [
      "with a hint that is not text",
      requestOf({ policy: { privateNetworkHint: 1 } }),
    ],
  ])("a request %s is refused", (_label: string, text: string) => {
    expect(() => {
      return parseSandboxRequest(text);
    }).toThrow();
  });

  test("a request past the size limit is refused before it is parsed", () => {
    const text: string = requestOf({
      code: "x".repeat(MAX_SANDBOX_REQUEST_BYTES),
    });

    expect(() => {
      return parseSandboxRequest(text);
    }).toThrow("The sandbox request is too large.");
  });

  test("a nonce is 32 lowercase hex digits", () => {
    expect(isSandboxNonce(NONCE)).toBe(true);
    expect(isSandboxNonce(NONCE.toUpperCase())).toBe(false);
    expect(isSandboxNonce(`${NONCE}0`)).toBe(false);
    expect(isSandboxNonce(undefined)).toBe(false);
  });
});

describe("the reply, as the Runner reads it", () => {
  function replyOf(overrides: Record<string, unknown> = {}): string {
    return JSON.stringify({
      version: SANDBOX_PROTOCOL_VERSION,
      nonce: NONCE,
      success: true,
      output: "Return: 1",
      ...overrides,
    });
  }

  test("a reply to this request is read", () => {
    expect(
      parseSandboxReply({ text: replyOf(), nonce: NONCE, maxOutputBytes: 100 }),
    ).toEqual({
      version: SANDBOX_PROTOCOL_VERSION,
      nonce: NONCE,
      success: true,
      output: "Return: 1",
    });
  });

  test("a failed step's reply keeps its error", () => {
    expect(
      parseSandboxReply({
        text: replyOf({ success: false, errorMessage: "boom" }),
        nonce: NONCE,
        maxOutputBytes: 100,
      }),
    ).toMatchObject({ success: false, errorMessage: "boom" });
  });

  test.each([
    ["not JSON", "nope"],
    ["empty", ""],
    ["for another request", replyOf({ nonce: "f".repeat(32) })],
    ["of another version", replyOf({ version: 2 })],
    ["without a verdict", replyOf({ success: "yes" })],
    ["without output", replyOf({ output: undefined })],
    ["with an error that is not text", replyOf({ errorMessage: {} })],
  ])("a reply %s is no reply", (_label: string, text: string) => {
    expect(
      parseSandboxReply({ text, nonce: NONCE, maxOutputBytes: 100 }),
    ).toBeNull();
  });

  test("a reply past the size limit is no reply", () => {
    expect(
      parseSandboxReply({
        text: replyOf({ output: "x".repeat(MAX_SANDBOX_REPLY_BYTES) }),
        nonce: NONCE,
        maxOutputBytes: 100,
      }),
    ).toBeNull();
  });

  test("output past what the request allowed is cut again, and the error to its limit", () => {
    const reply: ReturnType<typeof parseSandboxReply> = parseSandboxReply({
      text: replyOf({
        output: "y".repeat(500),
        errorMessage: "e".repeat(MAX_SANDBOX_ERROR_MESSAGE_LENGTH + 50),
      }),
      nonce: NONCE,
      maxOutputBytes: 100,
    });

    const allowed: number =
      100 + Buffer.byteLength(TRUNCATED_OUTPUT_MARKER, "utf8");

    expect(Buffer.byteLength(reply!.output, "utf8")).toBe(
      allowed + Buffer.byteLength(TRUNCATED_OUTPUT_MARKER, "utf8"),
    );
    expect(reply!.errorMessage).toHaveLength(MAX_SANDBOX_ERROR_MESSAGE_LENGTH);
  });

  test("output the step's process already cut, its marker included, is kept as it is", () => {
    const cut: string = `${"z".repeat(100)}${TRUNCATED_OUTPUT_MARKER}`;

    expect(
      parseSandboxReply({
        text: replyOf({ output: cut }),
        nonce: NONCE,
        maxOutputBytes: 100,
      })!.output,
    ).toBe(cut);
  });
});
