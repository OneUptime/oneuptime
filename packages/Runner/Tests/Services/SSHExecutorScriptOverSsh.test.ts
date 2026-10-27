import SSHExecutor, { SSHExecResult } from "../../Services/SSHExecutor";
import { JSONObject } from "Common/Types/JSON";
import { getSshHostKeyFingerprint } from "Common/Utils/Runbook/SshHostKeyFingerprint";
import { ChildProcess, spawn } from "child_process";
import { AddressInfo } from "net";
import {
  AuthContext,
  Connection,
  ParsedKey,
  Server,
  ServerChannel,
  Session,
  utils,
} from "ssh2";

/*
 * ---------------------------------------------------------------------------
 * An SSH step's script, run on a real SSH server.
 *
 * An SSH step signs in to a machine and runs the runbook author's bash
 * script there. The machine's sshd hands what the Runner sends to the
 * user's login shell - often not bash - so the Runner sends
 * `bash -c '<script>'`, the script quoted once, whole (getSshCommandToRun).
 *
 * The server here is a real ssh2 server on 127.0.0.1 that does what sshd
 * does: it signs the user in with a password or a key, and runs what it is
 * sent with `sh -c` - dash on most Linux hosts, which has no arrays or [[ ]].
 * So these show, end to end, that:
 *
 *   - a script reaches bash exactly as written - several lines, quotes of
 *     both kinds, $variables, $(commands) - with nothing expanded on the way;
 *   - bash runs it, whatever the login shell is;
 *   - what it prints, on stdout and stderr, comes back, and its exit code
 *     decides the step;
 *   - it signs in with a password, or with a key;
 *   - a step written before scripts still sends its command as it is;
 *   - a step that names the machine's host key signs in to it, and one
 *     that names another key does not even try to sign in - nothing of its
 *     password reaches the machine - while one that names none signs in
 *     and says which key the machine presented.
 * ---------------------------------------------------------------------------
 */

const USERNAME: string = "deploy";
const PASSWORD: string = "correct horse battery staple";

const HOST_KEY: string = utils.generateKeyPairSync("ed25519").private;
const USER_KEY: { private: string; public: string } =
  utils.generateKeyPairSync("ed25519");

const parsedUserKey: ParsedKey = utils.parseKey(USER_KEY.public) as ParsedKey;

// The server's host key, as a step names it: its fingerprint, and its public key line.
const parsedHostKey: ParsedKey = utils.parseKey(HOST_KEY) as ParsedKey;
const HOST_KEY_FINGERPRINT: string = getSshHostKeyFingerprint(
  parsedHostKey.getPublicSSH(),
);

// Another machine's key, which the server never presents.
const OTHER_HOST_KEY_FINGERPRINT: string = getSshHostKeyFingerprint(
  (
    utils.parseKey(utils.generateKeyPairSync("ed25519").public) as ParsedKey
  ).getPublicSSH(),
);

// How many times a client tried to sign in: none, when a host key is refused.
let signInAttempts: number = 0;

let server: Server;
let port: number;
// What the server was asked to run, in order.
const commandsRun: Array<string> = [];
const children: Array<ChildProcess> = [];

function isUserKey(context: AuthContext): boolean {
  if (context.method !== "publickey") {
    return false;
  }

  const offered: {
    algo: string;
    data: Buffer;
  } = context.key as { algo: string; data: Buffer };

  if (
    offered.algo !== parsedUserKey.type ||
    !offered.data.equals(parsedUserKey.getPublicSSH())
  ) {
    return false;
  }

  // The client first asks whether the key would do, then signs.
  if (!context.signature) {
    return true;
  }

  return parsedUserKey.verify(
    context.blob as Buffer,
    context.signature,
    context.hashAlgo,
  ) as boolean;
}

beforeAll(async () => {
  server = new Server({ hostKeys: [HOST_KEY] }, (client: Connection): void => {
    client.on("authentication", (context: AuthContext): void => {
      signInAttempts++;

      if (context.username !== USERNAME) {
        context.reject();
        return;
      }

      if (
        context.method === "password" &&
        (context as unknown as { password: string }).password === PASSWORD
      ) {
        context.accept();
        return;
      }

      if (isUserKey(context)) {
        context.accept();
        return;
      }

      context.reject(["password", "publickey"]);
    });

    client.on("ready", (): void => {
      client.on("session", (accept: () => Session): void => {
        const session: Session = accept();

        session.once(
          "exec",
          (
            acceptExec: () => ServerChannel,
            _reject: () => void,
            info: { command: string },
          ): void => {
            const channel: ServerChannel = acceptExec();
            commandsRun.push(info.command);

            // As sshd does: the login shell runs what it was sent.
            const child: ChildProcess = spawn("sh", ["-c", info.command], {
              env: { PATH: process.env["PATH"] || "/usr/bin:/bin" },
            });
            children.push(child);

            child.stdout?.on("data", (chunk: Buffer) => {
              channel.write(chunk);
            });
            child.stderr?.on("data", (chunk: Buffer) => {
              channel.stderr.write(chunk);
            });
            child.on("close", (code: number | null) => {
              channel.exit(code ?? 1);
              channel.end();
            });
          },
        );
      });
    });

    client.on("error", (): void => {
      // A client that went away mid-handshake: nothing to do.
    });
  });

  await new Promise<void>((resolve: () => void) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  for (const child of children) {
    if (child.exitCode === null) {
      child.kill("SIGKILL");
    }
  }

  await new Promise<void>((resolve: () => void) => {
    server.close(() => {
      resolve();
    });
  });
});

beforeEach(() => {
  commandsRun.length = 0;
  signInAttempts = 0;
});

// The step names the machine's host key, so it is checked on every run below.
function withPassword(): JSONObject {
  return {
    hostname: "127.0.0.1",
    port,
    username: USERNAME,
    password: PASSWORD,
    hostKeys: [{ fingerprint: HOST_KEY_FINGERPRINT, keyType: "ssh-ed25519" }],
  };
}

function run(
  payload: JSONObject,
  credential: JSONObject = withPassword(),
): Promise<SSHExecResult> {
  return SSHExecutor.execute({
    payload,
    credential,
    timeoutInMs: 20_000,
  });
}

describe("an SSH step's script, on the machine", () => {
  test("reaches bash exactly as written: lines, quotes, variables and commands", async () => {
    const script: string = [
      "greeting='hello world'",
      'echo "$greeting"',
      "echo 'single $quotes stay as they are'",
      'echo "it\'s $(echo nested) and `echo old-style`"',
      "echo \"a b c\" | awk '{print NF}'",
    ].join("\n");

    const result: SSHExecResult = await run({ script });

    expect(result).toEqual({
      success: true,
      output: [
        "hello world",
        "single $quotes stay as they are",
        "it's nested and old-style",
        "3",
        "",
      ].join("\n"),
      exitCode: 0,
    });

    // One command: bash, and the script as one quoted word.
    expect(commandsRun).toHaveLength(1);
    expect(commandsRun[0]!.startsWith("bash -c '")).toBe(true);
  });

  test("runs with bash whatever the login shell is: arrays and [[ ]] work", async () => {
    const result: SSHExecResult = await run({
      script: [
        "servers=(web-1 web-2 web-3)",
        'echo "${#servers[@]} servers"',
        '[[ "${servers[1]}" == web-* ]] && echo "bash it is"',
      ].join("\n"),
    });

    expect(result.success).toBe(true);
    expect(result.output).toBe("3 servers\nbash it is\n");
  });

  test("a script that exits non-zero fails the step, with what it printed before", async () => {
    const result: SSHExecResult = await run({
      script: "echo checking\necho 'disk full' >&2\nexit 3",
    });

    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(3);
    expect(result.errorMessage).toBe("Command exited with code 3.");
    expect(result.output).toBe("checking\n\ndisk full\n");
  });

  test("signs in with a key as well as with a password", async () => {
    const result: SSHExecResult = await run(
      { script: "whoami >/dev/null && echo signed-in-with-a-key" },
      {
        hostname: "127.0.0.1",
        port,
        username: USERNAME,
        privateKey: USER_KEY.private,
        hostKeys: [{ fingerprint: HOST_KEY_FINGERPRINT }],
      },
    );

    expect(result).toEqual({
      success: true,
      output: "signed-in-with-a-key\n",
      exitCode: 0,
    });
  });

  test("a wrong password fails the step, and nothing runs", async () => {
    const result: SSHExecResult = await run(
      { script: "echo never" },
      { ...withPassword(), password: "wrong" },
    );

    expect(result.success).toBe(false);
    expect(result.errorMessage).toMatch(/authentication/i);
    expect(commandsRun).toEqual([]);
  });

  test("a step written before scripts sends its command as it is, to the login shell", async () => {
    const result: SSHExecResult = await run({
      command: "echo legacy && echo $((6 * 7))",
    });

    expect(result).toEqual({
      success: true,
      output: "legacy\n42\n",
      exitCode: 0,
    });
    expect(commandsRun).toEqual(["echo legacy && echo $((6 * 7))"]);
  });
});

describe("the machine's host key", () => {
  test("a step that names another key does not sign in: no password reaches the machine, and nothing runs", async () => {
    const result: SSHExecResult = await run(
      { script: "echo never" },
      {
        ...withPassword(),
        hostKeys: [{ fingerprint: OTHER_HOST_KEY_FINGERPRINT }],
      },
    );

    expect(result.success).toBe(false);
    expect(result.errorMessage).toBe(
      `The machine presented the host key ${HOST_KEY_FINGERPRINT} (ssh-ed25519), which is not one this step names, so the step did not sign in. If the machine's key was changed on purpose, put the new one in the step's Host key; if not, something between the Runner and the machine may be pretending to be it.`,
    );
    expect(signInAttempts).toBe(0);
    expect(commandsRun).toEqual([]);
  });

  test("a step that names its RSA key alone asks the machine for an RSA key - which this one has not - and does not sign in", async () => {
    const result: SSHExecResult = await run(
      { script: "echo never" },
      {
        ...withPassword(),
        hostKeys: [
          { fingerprint: OTHER_HOST_KEY_FINGERPRINT, keyType: "ssh-rsa" },
        ],
      },
    );

    expect(result.success).toBe(false);
    expect(result.errorMessage).toBe(
      "The machine has no host key of the type this step names (ssh-rsa), so the step did not sign in. Put the key the machine has in the step's Host key, or its SHA256 fingerprint.",
    );
    expect(signInAttempts).toBe(0);
    expect(commandsRun).toEqual([]);
  });

  test("a step that names its key among others signs in", async () => {
    const result: SSHExecResult = await run(
      { script: "echo checked" },
      {
        ...withPassword(),
        hostKeys: [
          { fingerprint: OTHER_HOST_KEY_FINGERPRINT },
          { fingerprint: HOST_KEY_FINGERPRINT },
        ],
      },
    );

    expect(result).toEqual({
      success: true,
      output: "checked\n",
      exitCode: 0,
    });
  });

  test("a step that names none signs in as before, and says which key the machine presented", async () => {
    const credential: JSONObject = { ...withPassword() };
    delete credential["hostKeys"];

    const result: SSHExecResult = await run(
      { script: "echo unchecked" },
      credential,
    );

    expect(result.success).toBe(true);
    expect(result.output).toBe(
      `unchecked\n\n[OneUptime] The machine's host key was not checked: it presented ${HOST_KEY_FINGERPRINT} (ssh-ed25519). Put it in the step's Host key, under More fields, to check it on every run.`,
    );
  });
});
