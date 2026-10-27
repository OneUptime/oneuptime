/*
 * ---------------------------------------------------------------------------
 * An SSH step checks the machine's host key (SSHExecutor, hostVerifier).
 *
 * A step that names the machine's host keys (credential.hostKeys, worked out
 * by the server from the step's Host key) signs in only when the machine
 * presents one of them: ssh2 hands the key to hostVerifier during the key
 * exchange, before the password or the key's signature is sent. A step that
 * names none signs in as before, and its output says which key the machine
 * presented, so its author can name it.
 *
 * ssh2's Client is a fake here, and the tests call the hostVerifier the
 * executor hands it with the key a machine would present.
 * SSHExecutorScriptOverSsh runs the same against a real SSH server.
 * ---------------------------------------------------------------------------
 */

import SSHExecutor, {
  SSHExecResult,
  describePresentedHostKey,
  getHostKeyMismatchMessage,
  getUncheckedHostKeyNote,
  readPinnedSshHostKeys,
} from "../../Services/SSHExecutor";
import { Client } from "ssh2";
import { JSONObject } from "Common/Types/JSON";

jest.mock("ssh2", () => {
  /* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
  const { EventEmitter } = require("events");
  /* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */

  const instances: Array<unknown> = [];

  class MockStream extends EventEmitter {
    public stderr: unknown = new EventEmitter();
  }

  class MockClient extends EventEmitter {
    public connectConfig: Record<string, unknown> | null = null;
    public stream: MockStream | null = null;
    public execCommand: string | null = null;

    public connect(config: Record<string, unknown>): void {
      this.connectConfig = config;
    }

    public exec(
      command: string,
      cb: (err: Error | undefined, stream: MockStream) => void,
    ): void {
      this.execCommand = command;
      this.stream = new MockStream();
      cb(undefined, this.stream);
    }

    public end(): void {
      return;
    }
  }

  function ClientCtor(): MockClient {
    const c: MockClient = new MockClient();
    instances.push(c);
    return c;
  }
  ClientCtor.__instances = instances;
  ClientCtor.__reset = (): void => {
    instances.length = 0;
  };

  return { Client: ClientCtor };
});

interface MockClientLike {
  connectConfig: Record<string, unknown> | null;
  stream: { emit(event: string, arg?: unknown): boolean } | null;
  execCommand: string | null;
  emit(event: string, arg?: unknown): boolean;
}

const sshMock: {
  __instances: Array<MockClientLike>;
  __reset: () => void;
} = Client as unknown as {
  __instances: Array<MockClientLike>;
  __reset: () => void;
};

function lastClient(): MockClientLike {
  return sshMock.__instances[sshMock.__instances.length - 1]!;
}

// Throwaway host keys; each fingerprint is the one ssh-keygen -l printed.
const ED25519_KEY: Buffer = Buffer.from(
  "AAAAC3NzaC1lZDI1NTE5AAAAIFtux8m1u+wimvaBoFQoXsFnlH+H+VfhMAHNjDNrl2Q0",
  "base64",
);
const ED25519_FINGERPRINT: string =
  "SHA256:gwsSZuUZNvG/8pOZ2G715I2GTVbDlhL4EKu6z7WLKNM";

const RSA_FINGERPRINT: string =
  "SHA256:RbcFlZhe2wka/JUlPW5q7w6NacLcWWpI8xpwc4rkGgw";

function credential(hostKeys?: unknown): JSONObject {
  return {
    hostname: "db-1.internal",
    username: "deploy",
    port: 22,
    password: "correct horse battery staple",
    ...(hostKeys === undefined ? {} : { hostKeys: hostKeys as never }),
  };
}

// The key exchange: the machine presents its key; true goes on to sign in.
function presentHostKey(client: MockClientLike, key: Buffer): boolean {
  const verifier: (key: Buffer) => boolean = client.connectConfig![
    "hostVerifier"
  ] as (key: Buffer) => boolean;

  return verifier(key);
}

beforeEach(() => {
  sshMock.__reset();
});

describe("a step that names the machine's host keys", () => {
  test("signs in when the machine presents one of them", async () => {
    const promise: Promise<SSHExecResult> = SSHExecutor.execute({
      payload: { script: "hostname" },
      credential: credential([
        { fingerprint: RSA_FINGERPRINT },
        { fingerprint: ED25519_FINGERPRINT },
      ]),
      timeoutInMs: 5000,
    });

    const client: MockClientLike = lastClient();

    expect(presentHostKey(client, ED25519_KEY)).toBe(true);

    client.emit("ready");
    client.stream!.emit("data", Buffer.from("db-1"));
    client.stream!.emit("close", 0);

    // Checked: nothing is said about it.
    expect(await promise).toEqual({
      success: true,
      output: "db-1",
      exitCode: 0,
    });
  });

  test("does not sign in when the machine presents another, and says which it presented", async () => {
    const promise: Promise<SSHExecResult> = SSHExecutor.execute({
      payload: { script: "hostname" },
      credential: credential([{ fingerprint: RSA_FINGERPRINT }]),
      timeoutInMs: 5000,
    });

    const client: MockClientLike = lastClient();

    // ssh2 ends the handshake when the verifier says no, and reports it.
    expect(presentHostKey(client, ED25519_KEY)).toBe(false);
    client.emit("error", new Error("Host denied (verification failed)"));

    const result: SSHExecResult = await promise;

    expect(result.success).toBe(false);
    expect(result.errorMessage).toBe(
      `The machine presented the host key ${ED25519_FINGERPRINT} (ssh-ed25519), which is not one this step names, so the step did not sign in. If the machine's key was changed on purpose, put the new one in the step's Host key; if not, something between the Runner and the machine may be pretending to be it.`,
    );
    // Nothing was run.
    expect(client.execCommand).toBe(null);
  });

  test("an error after a key it names is the error ssh2 gave", async () => {
    const promise: Promise<SSHExecResult> = SSHExecutor.execute({
      payload: { script: "hostname" },
      credential: credential([{ fingerprint: ED25519_FINGERPRINT }]),
      timeoutInMs: 5000,
    });

    const client: MockClientLike = lastClient();

    presentHostKey(client, ED25519_KEY);
    client.emit(
      "error",
      new Error("All configured authentication methods failed"),
    );

    expect((await promise).errorMessage).toBe(
      "All configured authentication methods failed",
    );
  });

  test("asks the machine for the types of the keys it names, RSA with SHA-2 first", () => {
    void SSHExecutor.execute({
      payload: { script: "hostname" },
      credential: credential([
        { fingerprint: RSA_FINGERPRINT, keyType: "ssh-rsa" },
        { fingerprint: ED25519_FINGERPRINT, keyType: "ssh-ed25519" },
      ]),
      timeoutInMs: 5000,
    });

    expect(lastClient().connectConfig!["algorithms"]).toEqual({
      serverHostKey: ["rsa-sha2-512", "rsa-sha2-256", "ssh-rsa", "ssh-ed25519"],
    });
  });

  test("named by fingerprint alone, the machine presents the key it prefers", () => {
    void SSHExecutor.execute({
      payload: { script: "hostname" },
      credential: credential([{ fingerprint: ED25519_FINGERPRINT }]),
      timeoutInMs: 5000,
    });

    expect(lastClient().connectConfig).not.toHaveProperty("algorithms");
  });
});

describe("a step that names no host key", () => {
  test("signs in whatever the machine presents, and its output says which key that was", async () => {
    const promise: Promise<SSHExecResult> = SSHExecutor.execute({
      payload: { script: "hostname" },
      credential: credential(),
      timeoutInMs: 5000,
    });

    const client: MockClientLike = lastClient();

    expect(presentHostKey(client, ED25519_KEY)).toBe(true);
    expect(client.connectConfig).not.toHaveProperty("algorithms");

    client.emit("ready");
    client.stream!.emit("data", Buffer.from("db-1"));
    client.stream!.emit("close", 0);

    const result: SSHExecResult = await promise;

    expect(result.success).toBe(true);
    expect(result.output).toBe(
      `db-1\n[OneUptime] The machine's host key was not checked: it presented ${ED25519_FINGERPRINT} (ssh-ed25519). Put it in the step's Host key, under More fields, to check it on every run.`,
    );
  });

  test("a script that prints nothing still says it", async () => {
    const promise: Promise<SSHExecResult> = SSHExecutor.execute({
      payload: { script: "true" },
      credential: credential([]),
      timeoutInMs: 5000,
    });

    const client: MockClientLike = lastClient();

    presentHostKey(client, ED25519_KEY);
    client.emit("ready");
    client.stream!.emit("close", 0);

    expect((await promise).output).toBe(
      getUncheckedHostKeyNote({
        fingerprint: ED25519_FINGERPRINT,
        keyType: "ssh-ed25519",
      }),
    );
  });
});

describe("the host keys a claim hands over, read defensively", () => {
  test("only fingerprints as OpenSSH writes them, each with its type when it has one", () => {
    expect(
      readPinnedSshHostKeys([
        { fingerprint: ED25519_FINGERPRINT, keyType: "ssh-ed25519" },
        { fingerprint: RSA_FINGERPRINT },
        { fingerprint: "MD5:6e:39:52" },
        { fingerprint: "SHA256:" },
        { fingerprint: 7 },
        "SHA256:abc",
        null,
      ]),
    ).toEqual([
      { fingerprint: ED25519_FINGERPRINT, keyType: "ssh-ed25519" },
      { fingerprint: RSA_FINGERPRINT },
    ]);
  });

  test("anything but a list names none", () => {
    expect(readPinnedSshHostKeys(undefined)).toEqual([]);
    expect(readPinnedSshHostKeys(ED25519_FINGERPRINT)).toEqual([]);
    expect(readPinnedSshHostKeys({ fingerprint: ED25519_FINGERPRINT })).toEqual(
      [],
    );
  });

  test("a key named in an error or a note is its fingerprint, and its type when known", () => {
    expect(describePresentedHostKey({ fingerprint: ED25519_FINGERPRINT })).toBe(
      ED25519_FINGERPRINT,
    );
    expect(
      getHostKeyMismatchMessage({ fingerprint: RSA_FINGERPRINT }),
    ).toContain(`presented the host key ${RSA_FINGERPRINT}, which`);
  });
});
