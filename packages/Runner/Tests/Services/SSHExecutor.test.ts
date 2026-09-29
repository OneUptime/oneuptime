/*
 * ---------------------------------------------------------------------------
 * Unit tests for SSHExecutor.
 *
 * SSHExecutor runs one runbook command on a remote host and closes the
 * connection per step. The tests here never touch a real host: ssh2's Client
 * is replaced with a controllable EventEmitter-backed fake so every case
 * asserts on the executor's contract — what it validates before dialing, the
 * ConnectConfig it hands ssh2, that it sends the author's command verbatim,
 * how it maps exit codes to success, how connection/exec/timeout failures are
 * surfaced, and that runaway output is bounded to MAX_OUTPUT_BYTES.
 *
 * The failure branches matter most: a step that hangs or a host that refuses
 * the connection must resolve to a clean failure result, never leave the
 * promise pending.
 * ---------------------------------------------------------------------------
 */

import SSHExecutor, { SSHExecResult } from "../../Services/SSHExecutor";
import { Client } from "ssh2";
import { JSONObject } from "Common/Types/JSON";
import type { EventEmitter as NodeEventEmitter } from "events";

/*
 * A self-contained ssh2 mock. Everything the tests reach for lives inside the
 * factory (jest hoists jest.mock above imports, so out-of-scope references
 * would hit the temporal dead zone); the created client instances and a small
 * control object are exposed back through statics on the mocked Client.
 */
jest.mock("ssh2", () => {
  /* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
  const { EventEmitter } = require("events");
  /* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */

  const control: { connectThrows: Error | null } = { connectThrows: null };
  const instances: Array<unknown> = [];

  class MockStream extends EventEmitter {
    public stderr: NodeEventEmitter = new EventEmitter();
  }

  class MockClient extends EventEmitter {
    public connectConfig: Record<string, unknown> | null = null;
    public execCommand: string | null = null;
    public ended: boolean = false;
    public stream: MockStream | null = null;
    public execError: Error | null = null;

    public connect(config: Record<string, unknown>): void {
      this.connectConfig = config;
      if (control.connectThrows) {
        throw control.connectThrows;
      }
    }

    public exec(
      command: string,
      cb: (err: Error | undefined, stream: MockStream) => void,
    ): void {
      this.execCommand = command;
      if (this.execError) {
        cb(this.execError, undefined as unknown as MockStream);
        return;
      }
      this.stream = new MockStream();
      cb(undefined, this.stream);
    }

    public end(): void {
      this.ended = true;
    }
  }

  function ClientCtor(): MockClient {
    const c: MockClient = new MockClient();
    instances.push(c);
    return c;
  }
  ClientCtor.__instances = instances;
  ClientCtor.__control = control;
  ClientCtor.__reset = (): void => {
    instances.length = 0;
    control.connectThrows = null;
  };

  return { Client: ClientCtor };
});

interface MockStreamLike {
  emit(event: string, arg?: unknown): boolean;
  stderr: { emit(event: string, arg?: unknown): boolean };
}

interface MockClientLike {
  connectConfig: Record<string, unknown> | null;
  execCommand: string | null;
  ended: boolean;
  stream: MockStreamLike | null;
  execError: Error | null;
  emit(event: string, arg?: unknown): boolean;
}

const sshMock: {
  __instances: Array<MockClientLike>;
  __control: { connectThrows: Error | null };
  __reset: () => void;
} = Client as unknown as {
  __instances: Array<MockClientLike>;
  __control: { connectThrows: Error | null };
  __reset: () => void;
};

function lastClient(): MockClientLike {
  return sshMock.__instances[sshMock.__instances.length - 1]!;
}

const GOOD_CREDENTIAL: JSONObject = {
  hostname: "host.example.com",
  username: "deploy",
  port: 2222,
  privateKey: "----KEY----",
};

beforeEach(() => {
  sshMock.__reset();
});

describe("SSHExecutor.execute input validation (never dials the host)", () => {
  test("fails when the credential has no hostname", async () => {
    const result: SSHExecResult = await SSHExecutor.execute({
      payload: { command: "ls" },
      credential: { username: "deploy", privateKey: "k" },
      timeoutInMs: 1000,
    });

    expect(result.success).toBe(false);
    expect(result.errorMessage).toContain("hostname or username");
    expect(sshMock.__instances).toHaveLength(0);
  });

  test("fails when the credential has no username", async () => {
    const result: SSHExecResult = await SSHExecutor.execute({
      payload: { command: "ls" },
      credential: { hostname: "h", privateKey: "k" },
      timeoutInMs: 1000,
    });

    expect(result.success).toBe(false);
    expect(result.errorMessage).toContain("hostname or username");
    expect(sshMock.__instances).toHaveLength(0);
  });

  test("fails when there is no command to run", async () => {
    const result: SSHExecResult = await SSHExecutor.execute({
      payload: {},
      credential: GOOD_CREDENTIAL,
      timeoutInMs: 1000,
    });

    expect(result.success).toBe(false);
    expect(result.errorMessage).toContain("no command");
    expect(sshMock.__instances).toHaveLength(0);
  });

  test("fails when the credential has neither a private key nor a password", async () => {
    const result: SSHExecResult = await SSHExecutor.execute({
      payload: { command: "ls" },
      credential: { hostname: "h", username: "u" },
      timeoutInMs: 1000,
    });

    expect(result.success).toBe(false);
    expect(result.errorMessage).toContain(
      "neither a private key nor a password",
    );
    expect(sshMock.__instances).toHaveLength(0);
  });
});

describe("SSHExecutor.execute connection config", () => {
  test("passes host, port, username and the private key through to ssh2", async () => {
    const promise: Promise<SSHExecResult> = SSHExecutor.execute({
      payload: { command: "uptime" },
      credential: GOOD_CREDENTIAL,
      timeoutInMs: 5000,
    });

    const client: MockClientLike = lastClient();
    expect(client.connectConfig).toMatchObject({
      host: "host.example.com",
      port: 2222,
      username: "deploy",
      privateKey: "----KEY----",
      readyTimeout: 5000,
    });

    // Drive to completion so the promise resolves and the connection closes.
    client.emit("ready");
    client.stream!.emit("close", 0);
    await promise;
    expect(client.ended).toBe(true);
  });

  test("defaults the port to 22 and supports password auth", async () => {
    const promise: Promise<SSHExecResult> = SSHExecutor.execute({
      payload: { command: "uptime" },
      credential: { hostname: "h", username: "u", password: "secret" },
      timeoutInMs: 5000,
    });

    const client: MockClientLike = lastClient();
    expect(client.connectConfig).toMatchObject({
      port: 22,
      password: "secret",
    });
    expect(client.connectConfig).not.toHaveProperty("privateKey");

    client.emit("ready");
    client.stream!.emit("close", 0);
    await promise;
  });

  test("sends the command verbatim, without re-quoting", async () => {
    const command: string = "echo 'hi' && rm -rf --dry-run \"$HOME/x\"";
    const promise: Promise<SSHExecResult> = SSHExecutor.execute({
      payload: { command },
      credential: GOOD_CREDENTIAL,
      timeoutInMs: 5000,
    });

    const client: MockClientLike = lastClient();
    client.emit("ready");
    expect(client.execCommand).toBe(command);

    client.stream!.emit("close", 0);
    await promise;
  });
});

describe("SSHExecutor.execute result mapping", () => {
  test("exit code 0 is success and carries stdout", async () => {
    const promise: Promise<SSHExecResult> = SSHExecutor.execute({
      payload: { command: "echo hi" },
      credential: GOOD_CREDENTIAL,
      timeoutInMs: 5000,
    });

    const client: MockClientLike = lastClient();
    client.emit("ready");
    client.stream!.emit("data", Buffer.from("hello world"));
    client.stream!.emit("close", 0);

    const result: SSHExecResult = await promise;
    expect(result).toEqual({
      success: true,
      output: "hello world",
      exitCode: 0,
    });
  });

  test("a non-zero exit code is a failure with the code in the message", async () => {
    const promise: Promise<SSHExecResult> = SSHExecutor.execute({
      payload: { command: "false" },
      credential: GOOD_CREDENTIAL,
      timeoutInMs: 5000,
    });

    const client: MockClientLike = lastClient();
    client.emit("ready");
    client.stream!.emit("close", 2);

    const result: SSHExecResult = await promise;
    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(2);
    expect(result.errorMessage).toBe("Command exited with code 2.");
  });

  test("stderr is appended to stdout in the output", async () => {
    const promise: Promise<SSHExecResult> = SSHExecutor.execute({
      payload: { command: "build" },
      credential: GOOD_CREDENTIAL,
      timeoutInMs: 5000,
    });

    const client: MockClientLike = lastClient();
    client.emit("ready");
    client.stream!.emit("data", Buffer.from("out"));
    client.stream!.stderr.emit("data", Buffer.from("warn"));
    client.stream!.emit("close", 0);

    const result: SSHExecResult = await promise;
    expect(result.output).toBe("out\nwarn");
  });

  test("a null exit code (channel died) is treated as failure code 1", async () => {
    const promise: Promise<SSHExecResult> = SSHExecutor.execute({
      payload: { command: "x" },
      credential: GOOD_CREDENTIAL,
      timeoutInMs: 5000,
    });

    const client: MockClientLike = lastClient();
    client.emit("ready");
    client.stream!.emit("close", null);

    const result: SSHExecResult = await promise;
    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(1);
  });
});

describe("SSHExecutor.execute failure handling", () => {
  test("a connection error resolves to a failure result, not a rejection", async () => {
    const promise: Promise<SSHExecResult> = SSHExecutor.execute({
      payload: { command: "ls" },
      credential: GOOD_CREDENTIAL,
      timeoutInMs: 5000,
    });

    const client: MockClientLike = lastClient();
    client.emit("error", new Error("ECONNREFUSED"));

    const result: SSHExecResult = await promise;
    expect(result.success).toBe(false);
    expect(result.errorMessage).toBe("ECONNREFUSED");
  });

  test("an exec error is surfaced as the failure message", async () => {
    const promise: Promise<SSHExecResult> = SSHExecutor.execute({
      payload: { command: "ls" },
      credential: GOOD_CREDENTIAL,
      timeoutInMs: 5000,
    });

    const client: MockClientLike = lastClient();
    client.execError = new Error("channel open failure");
    client.emit("ready");

    const result: SSHExecResult = await promise;
    expect(result.success).toBe(false);
    expect(result.errorMessage).toBe("channel open failure");
  });

  test("a synchronous connect() throw resolves to a failure result", async () => {
    sshMock.__control.connectThrows = new Error("bad config");

    const result: SSHExecResult = await SSHExecutor.execute({
      payload: { command: "ls" },
      credential: GOOD_CREDENTIAL,
      timeoutInMs: 5000,
    });

    expect(result.success).toBe(false);
    expect(result.errorMessage).toBe("bad config");
  });

  test("a command that never finishes fails once the deadline passes", async () => {
    /*
     * A short real deadline rather than fake timers: jest 28's timer faking
     * cannot redefine the `performance` global on newer Node, and the executor
     * only needs its own setTimeout to fire — which a real 20ms wait does.
     */
    const promise: Promise<SSHExecResult> = SSHExecutor.execute({
      payload: { command: "sleep 999" },
      credential: GOOD_CREDENTIAL,
      timeoutInMs: 20,
    });

    const client: MockClientLike = lastClient();
    client.emit("ready"); // connected, but the stream never closes

    const result: SSHExecResult = await promise;
    expect(result.success).toBe(false);
    expect(result.errorMessage).toBe("SSH step timed out after 20ms.");
  });
});

describe("SSHExecutor.execute output bounding", () => {
  test("output larger than MAX_OUTPUT_BYTES (50000) is truncated with a marker", async () => {
    const promise: Promise<SSHExecResult> = SSHExecutor.execute({
      payload: { command: "cat huge" },
      credential: GOOD_CREDENTIAL,
      timeoutInMs: 5000,
    });

    const client: MockClientLike = lastClient();
    client.emit("ready");
    client.stream!.emit("data", Buffer.from("x".repeat(60000)));
    client.stream!.emit("close", 0);

    const result: SSHExecResult = await promise;
    expect(result.output.endsWith("... [output truncated]")).toBe(true);
    // 50000 kept bytes + the appended marker.
    expect(result.output.length).toBe(
      50000 + "\n... [output truncated]".length,
    );
  });
});
