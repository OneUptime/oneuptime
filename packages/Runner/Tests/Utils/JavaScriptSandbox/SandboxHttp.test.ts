jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    },
  };
});

import VMHttpBridge, {
  MAX_PENDING_HTTP_REQUESTS,
  TOO_MANY_PENDING_HTTP_REQUESTS_MESSAGE,
  VMHttpCall,
} from "Common/Server/Utils/VM/VMHttpBridge";
import SandboxHttpChannel from "../../../Utils/JavaScriptSandbox/SandboxHttp";
import {
  serializeSandboxHttpCall,
  parseSandboxHttpResult,
} from "../../../Utils/JavaScriptSandbox/SandboxProtocol";

/*
 * The Runner's side of a step's HTTP: it reads the step's calls off the HTTP
 * channel, makes each through a VMHttpBridge of the step's own (the SSRF
 * guard, the run's limits), and writes one answer to the step's standard
 * input. A line that is not a call - or a call whose number is already in
 * flight - is not the step's worker, and the channel says the Runner should
 * stop the process. When the step ends, every call in flight is aborted.
 *
 * The bridge is faked here: SandboxProcess's real tests run the real one. A
 * fake records its reserve/execute calls and resolves each when the test says.
 */

interface Deferred {
  call: VMHttpCall;
  signal: AbortSignal;
  resolve: (value: string) => void;
  reject: (error: Error) => void;
}

class FakeBridge {
  public readonly reserved: Array<VMHttpCall> = [];
  public readonly executed: Array<Deferred> = [];
  public reserveError: Error | null = null;

  public reserve(call: VMHttpCall): void {
    if (this.reserveError) {
      throw this.reserveError;
    }
    this.reserved.push(call);
  }

  public execute(call: VMHttpCall, signal: AbortSignal): Promise<string> {
    return new Promise<string>(
      (resolve: (value: string) => void, reject: (error: Error) => void) => {
        this.executed.push({ call, signal, resolve, reject });
      },
    );
  }
}

function channelOf(fake: FakeBridge): {
  channel: SandboxHttpChannel;
  answers: Array<ReturnType<typeof parseSandboxHttpResult>>;
} {
  const answers: Array<ReturnType<typeof parseSandboxHttpResult>> = [];

  const channel: SandboxHttpChannel = new SandboxHttpChannel({
    policy: {},
    bridge: fake as unknown as VMHttpBridge,
    send: (line: string): void => {
      answers.push(parseSandboxHttpResult(line.trim()));
    },
  });

  return { channel, answers };
}

function callLine(id: number, url: string = "https://example.com/"): string {
  return serializeSandboxHttpCall({ id, call: { method: "get", url } }).trim();
}

describe("the Runner makes a step's HTTP", () => {
  test("a call is reserved, made, and its envelope answered to the step", async () => {
    const fake: FakeBridge = new FakeBridge();
    const { channel, answers } = channelOf(fake);

    expect(channel.handle(callLine(1))).toBe(true);
    expect(fake.reserved).toHaveLength(1);
    expect(fake.executed).toHaveLength(1);
    expect(channel.pending).toBe(1);

    fake.executed[0]!.resolve("the-envelope");
    await Promise.resolve();

    expect(answers).toEqual([{ id: 1, value: "the-envelope" }]);
    expect(channel.pending).toBe(0);
  });

  test("a failed request answers with its reason", async () => {
    const fake: FakeBridge = new FakeBridge();
    const { channel, answers } = channelOf(fake);

    channel.handle(callLine(2));
    fake.executed[0]!.reject(new Error("refused"));
    await Promise.resolve();

    expect(answers).toEqual([{ id: 2, errorMessage: "refused" }]);
  });

  test("a request the run's limits refuse is answered, never made", () => {
    const fake: FakeBridge = new FakeBridge();
    fake.reserveError = new Error("too large");
    const { channel, answers } = channelOf(fake);

    expect(channel.handle(callLine(3))).toBe(true);
    expect(fake.executed).toHaveLength(0);
    expect(answers).toEqual([{ id: 3, errorMessage: "too large" }]);
  });

  test("more calls in flight than the limit are refused, never made", () => {
    const fake: FakeBridge = new FakeBridge();
    const { channel, answers } = channelOf(fake);

    for (let id: number = 1; id <= MAX_PENDING_HTTP_REQUESTS; id++) {
      channel.handle(callLine(id));
    }

    expect(channel.pending).toBe(MAX_PENDING_HTTP_REQUESTS);

    channel.handle(callLine(MAX_PENDING_HTTP_REQUESTS + 1));

    expect(fake.executed).toHaveLength(MAX_PENDING_HTTP_REQUESTS);
    expect(answers).toEqual([
      {
        id: MAX_PENDING_HTTP_REQUESTS + 1,
        errorMessage: TOO_MANY_PENDING_HTTP_REQUESTS_MESSAGE,
      },
    ]);
  });

  test.each([
    ["a line that is not a call", JSON.stringify({ not: "a call" })],
    ["a line that is not JSON", "garbage"],
  ])(
    "%s says the process should be stopped",
    (_label: string, line: string) => {
      const fake: FakeBridge = new FakeBridge();
      const { channel } = channelOf(fake);

      expect(channel.handle(line)).toBe(false);
      expect(fake.executed).toHaveLength(0);
    },
  );

  test("a call whose number is already in flight says the process should be stopped", () => {
    const fake: FakeBridge = new FakeBridge();
    const { channel } = channelOf(fake);

    expect(channel.handle(callLine(1))).toBe(true);
    expect(channel.handle(callLine(1))).toBe(false);
  });

  test("when the step ends, every call in flight is aborted and none more answered", async () => {
    const fake: FakeBridge = new FakeBridge();
    const { channel, answers } = channelOf(fake);

    channel.handle(callLine(1));
    const aborted: Promise<void> = new Promise<void>((resolve: () => void) => {
      fake.executed[0]!.signal.addEventListener("abort", () => {
        resolve();
      });
    });

    channel.close();
    await aborted;

    // A late resolution after close reaches the step no more.
    fake.executed[0]!.resolve("too late");
    await Promise.resolve();

    expect(fake.executed[0]!.signal.aborted).toBe(true);
    expect(answers).toEqual([]);
  });
});
