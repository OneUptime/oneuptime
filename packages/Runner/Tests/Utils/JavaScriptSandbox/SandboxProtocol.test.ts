import {
  MAX_SANDBOX_ERROR_MESSAGE_LENGTH,
  MAX_SANDBOX_HTTP_CALL_BYTES,
  MAX_SANDBOX_HTTP_CHANNEL_BYTES,
  MAX_SANDBOX_REPLY_BYTES,
  MAX_SANDBOX_REQUEST_BYTES,
  SANDBOX_PROTOCOL_VERSION,
  SandboxChannelOverflow,
  SandboxLineReader,
  SandboxRequest,
  isSandboxNonce,
  parseSandboxHttpCall,
  parseSandboxHttpResult,
  parseSandboxReply,
  parseSandboxRequest,
  serializeSandboxHttpCall,
  serializeSandboxHttpResult,
} from "../../../Utils/JavaScriptSandbox/SandboxProtocol";
import { TRUNCATED_OUTPUT_MARKER } from "../../../Utils/OutputTruncation";

/*
 * What the Runner and a step's sandbox process say to each other: one request
 * and the answers to the step's HTTP each way, of one shape. The step's
 * process refuses a request of any other shape (the Runner built it, so
 * another shape is a mismatch, not something to make the best of); the Runner
 * takes only a well-formed reply to the request it sent, only the step's own
 * HTTP calls on its HTTP channel, and never more output than it asked for.
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
    });
  });

  test("the request carries no egress policy: the Runner, not the step, decides it", () => {
    const request: SandboxRequest = parseSandboxRequest(
      requestOf({ policy: { allowPrivateNetworkRequests: true } }),
    );

    expect(request).not.toHaveProperty("policy");
  });

  test.each([
    ["not JSON", "{"],
    ["not an object", "[]"],
    ["of version 1", requestOf({ version: 1 })],
    ["of another version", requestOf({ version: 3 })],
    ["without a nonce", requestOf({ nonce: undefined })],
    ["with a nonce of another shape", requestOf({ nonce: "short" })],
    ["without a script", requestOf({ code: 42 })],
    ["with args that are a list", requestOf({ args: [] })],
    ["with args that are null", requestOf({ args: null })],
    ["with a timeout of 0", requestOf({ timeoutInMs: 0 })],
    ["with a fractional timeout", requestOf({ timeoutInMs: 1.5 })],
    ["with a timeout as text", requestOf({ timeoutInMs: "5000" })],
    ["with no output limit", requestOf({ maxOutputBytes: undefined })],
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
    ["of version 1", replyOf({ version: 1 })],
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

describe("the step's HTTP calls, as the Runner reads them", () => {
  test("a call the step's worker writes is read back whole, and round-trips", () => {
    const line: string = serializeSandboxHttpCall({
      id: 7,
      call: { method: "get", url: "https://example.com/", arg1: "{}" },
    });

    expect(line.endsWith("\n")).toBe(true);
    expect(parseSandboxHttpCall(line.trim())).toEqual({
      id: 7,
      call: { method: "get", url: "https://example.com/", arg1: "{}" },
    });
  });

  test("the config and body are kept, and absent fields stay absent", () => {
    const line: string = serializeSandboxHttpCall({
      id: 3,
      call: { method: "post", url: "https://x/", arg1: '{"a":1}', arg2: "{}" },
    });

    expect(parseSandboxHttpCall(line.trim())!.call).toEqual({
      method: "post",
      url: "https://x/",
      arg1: '{"a":1}',
      arg2: "{}",
    });

    const requestCall: string = serializeSandboxHttpCall({
      id: 4,
      call: { method: "request", arg1: "{}" },
    });

    expect(parseSandboxHttpCall(requestCall.trim())!.call).toEqual({
      method: "request",
      arg1: "{}",
    });
  });

  test.each([
    ["not JSON", "{"],
    ["no id", JSON.stringify({ method: "get" })],
    ["an id of 0", JSON.stringify({ id: 0, method: "get" })],
    ["a fractional id", JSON.stringify({ id: 1.5, method: "get" })],
    [
      "a method the shim never makes",
      JSON.stringify({ id: 1, method: "trace" }),
    ],
    [
      "a url that is not text",
      JSON.stringify({ id: 1, method: "get", url: 1 }),
    ],
    [
      "an arg1 that is not text",
      JSON.stringify({ id: 1, method: "get", arg1: {} }),
    ],
  ])("a line that is %s is no call", (_label: string, text: string) => {
    expect(parseSandboxHttpCall(text)).toBeNull();
  });

  test("a call past the per-call limit is no call", () => {
    const line: string = JSON.stringify({
      id: 1,
      method: "get",
      url: "x".repeat(MAX_SANDBOX_HTTP_CALL_BYTES),
    });

    expect(parseSandboxHttpCall(line)).toBeNull();
  });
});

describe("the Runner's answer to a call, as the step's process reads it", () => {
  test("an envelope round-trips", () => {
    const line: string = serializeSandboxHttpResult({ id: 2, value: "env" });

    expect(line.endsWith("\n")).toBe(true);
    expect(parseSandboxHttpResult(line.trim())).toEqual({
      id: 2,
      value: "env",
    });
  });

  test("a failure carries its reason, cut to the limit", () => {
    const line: string = serializeSandboxHttpResult({
      id: 2,
      errorMessage: "e".repeat(MAX_SANDBOX_ERROR_MESSAGE_LENGTH + 10),
    });

    const result: ReturnType<typeof parseSandboxHttpResult> =
      parseSandboxHttpResult(line.trim());

    expect(result!.id).toBe(2);
    expect(result!.errorMessage).toHaveLength(MAX_SANDBOX_ERROR_MESSAGE_LENGTH);
  });

  test("a failure with no reason is given one", () => {
    const line: string = serializeSandboxHttpResult({ id: 5 });

    expect(parseSandboxHttpResult(line.trim())).toEqual({
      id: 5,
      errorMessage: "HTTP request failed",
    });
  });

  test.each([
    ["no id", JSON.stringify({ value: "env" })],
    [
      "both a value and an error",
      JSON.stringify({ id: 1, value: "a", errorMessage: "b" }),
    ],
    ["neither", JSON.stringify({ id: 1 })],
    ["a value that is not text", JSON.stringify({ id: 1, value: 1 })],
  ])("an answer with %s is no answer", (_label: string, text: string) => {
    expect(parseSandboxHttpResult(text)).toBeNull();
  });
});

describe("the line reader", () => {
  test("gives whole lines as they close, and holds a partial line", () => {
    const reader: SandboxLineReader = new SandboxLineReader({
      maxLineBytes: 1024,
    });

    expect(reader.push("one\ntw")).toEqual(["one"]);
    expect(reader.hasPartialLine).toBe(true);
    expect(reader.push("o\nthree\n")).toEqual(["two", "three"]);
    expect(reader.hasPartialLine).toBe(false);
  });

  test("a character split across two chunks is read as itself", () => {
    const reader: SandboxLineReader = new SandboxLineReader({
      maxLineBytes: 1024,
    });
    const snowman: Buffer = Buffer.from("☃", "utf8");

    expect(reader.push(snowman.subarray(0, 1))).toEqual([]);
    expect(
      reader.push(Buffer.concat([snowman.subarray(1), Buffer.from("\n")])),
    ).toEqual(["☃"]);
  });

  test("a line longer than its limit throws, and the reader takes nothing more", () => {
    const reader: SandboxLineReader = new SandboxLineReader({
      maxLineBytes: 8,
    });

    expect(() => {
      return reader.push("123456789\n");
    }).toThrow(SandboxChannelOverflow);
    expect(() => {
      return reader.push("ok\n");
    }).toThrow(SandboxChannelOverflow);
  });

  test("more than the channel may send in all throws", () => {
    const reader: SandboxLineReader = new SandboxLineReader({
      maxLineBytes: MAX_SANDBOX_HTTP_CALL_BYTES,
      maxTotalBytes: 16,
    });

    expect(reader.push("a\n")).toEqual(["a"]);
    expect(() => {
      return reader.push("x".repeat(32));
    }).toThrow(SandboxChannelOverflow);
  });

  test("the channel's total limit is the run's, well above one request's", () => {
    expect(MAX_SANDBOX_HTTP_CHANNEL_BYTES).toBeGreaterThan(
      MAX_SANDBOX_HTTP_CALL_BYTES,
    );
  });
});
