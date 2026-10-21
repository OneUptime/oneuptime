import SSHExecutor, { SSHExecResult } from "../../Services/SSHExecutor";
import { JSONObject } from "Common/Types/JSON";
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
 *   - a step written before scripts still sends its command as it is.
 * ---------------------------------------------------------------------------
 */

const USERNAME: string = "deploy";
const PASSWORD: string = "correct horse battery staple";

const HOST_KEY: string = utils.generateKeyPairSync("ed25519").private;
const USER_KEY: { private: string; public: string } =
  utils.generateKeyPairSync("ed25519");

const parsedUserKey: ParsedKey = utils.parseKey(USER_KEY.public) as ParsedKey;

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
});

function withPassword(): JSONObject {
  return {
    hostname: "127.0.0.1",
    port,
    username: USERNAME,
    password: PASSWORD,
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
