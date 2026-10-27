import {
  Client,
  ClientChannel,
  ConnectConfig,
  ServerHostKeyAlgorithm,
} from "ssh2";
import { MAX_OUTPUT_BYTES } from "../Config";
import { JSONObject } from "Common/Types/JSON";
import { shellQuote } from "Common/Types/Runbook/ShellWord";
import { SSH_FINGERPRINT_PREFIX } from "Common/Types/Runbook/SshHostKey";
import {
  SshPinnedHostKey,
  describeSshHostKey,
  getSshHostKeyAlgorithms,
} from "Common/Utils/Runbook/SshHostKeyFingerprint";

export interface SSHExecResult {
  success: boolean;
  output: string;
  exitCode?: number | undefined;
  errorMessage?: string | undefined;
}

function truncate(s: string): string {
  if (Buffer.byteLength(s, "utf8") <= MAX_OUTPUT_BYTES) {
    return s;
  }

  return (
    Buffer.from(s, "utf8").slice(0, MAX_OUTPUT_BYTES).toString("utf8") +
    "\n... [output truncated]"
  );
}

/*
 * What an SSH step runs on its machine.
 *
 * A step that takes a script (payload.script) runs it with bash there:
 * `bash -c '<script>'`, the script in single quotes (shellQuote), so the
 * machine's login shell hands it to bash exactly as written, and nothing the
 * script reads from its input is taken from the script itself. A step
 * written before scripts, and a command OneUptime AI composed, send their
 * command (payload.command), which is sent as it is, as it always was. A
 * server sends a script step's script as its command too, so a Runner older
 * than scripts runs it with the machine's own login shell.
 */
/*
 * The host keys a claimed step names (`credential.hostKeys`, worked out by
 * the server from the step's Host key), read defensively: only fingerprints
 * as OpenSSH writes them.
 */
export function readPinnedSshHostKeys(raw: unknown): Array<SshPinnedHostKey> {
  if (!Array.isArray(raw)) {
    return [];
  }

  const keys: Array<SshPinnedHostKey> = [];

  for (const item of raw) {
    const fingerprint: unknown =
      item && typeof item === "object"
        ? (item as Record<string, unknown>)["fingerprint"]
        : undefined;
    const keyType: unknown =
      item && typeof item === "object"
        ? (item as Record<string, unknown>)["keyType"]
        : undefined;

    if (
      typeof fingerprint === "string" &&
      fingerprint.startsWith(SSH_FINGERPRINT_PREFIX) &&
      fingerprint.length > SSH_FINGERPRINT_PREFIX.length
    ) {
      keys.push({
        fingerprint,
        ...(typeof keyType === "string" && keyType ? { keyType } : {}),
      });
    }
  }

  return keys;
}

// The key a machine presented, as a step's output and errors name it.
export function describePresentedHostKey(key: SshPinnedHostKey): string {
  return key.keyType ? `${key.fingerprint} (${key.keyType})` : key.fingerprint;
}

/*
 * Why the step did not sign in: the machine presented a key the step does
 * not name. Names the key it presented - a fingerprint is no secret - so
 * the author can tell a key that changed on purpose from someone between
 * the Runner and the machine.
 */
export function getHostKeyMismatchMessage(presented: SshPinnedHostKey): string {
  return `The machine presented the host key ${describePresentedHostKey(presented)}, which is not one this step names, so the step did not sign in. If the machine's key was changed on purpose, put the new one in the step's Host key; if not, something between the Runner and the machine may be pretending to be it.`;
}

/*
 * Why the step did not sign in: it named its keys with their types, and the
 * machine has a key of none of them (ssh2: "no matching host key format").
 */
export function getHostKeyTypeMismatchMessage(keyTypes: Array<string>): string {
  return `The machine has no host key of the type this step names (${keyTypes.join(", ")}), so the step did not sign in. Put the key the machine has in the step's Host key, or its SHA256 fingerprint.`;
}

/*
 * What a step that names no host key says after it ran: the key the machine
 * presented, so the author can name it in the step's Host key and have it
 * checked from then on.
 */
export function getUncheckedHostKeyNote(presented: SshPinnedHostKey): string {
  return `[OneUptime] The machine's host key was not checked: it presented ${describePresentedHostKey(presented)}. Put it in the step's Host key, under More fields, to check it on every run.`;
}

export function getSshCommandToRun(payload: JSONObject): string {
  const script: unknown = payload["script"];

  if (typeof script === "string" && script.trim()) {
    return `bash -c ${shellQuote(script)}`;
  }

  return String(payload["command"] || "");
}

/*
 * Run one command on a remote host over SSH.
 *
 * The connection is opened, used and closed per step — no pooling. A runbook
 * step is an occasional, consequential action, and a pool would keep
 * credentials resident and connections open against hosts that may be exactly
 * the ones misbehaving.
 *
 * Nothing here re-quotes or re-interprets what the author wrote: a script is
 * quoted once, whole, for bash (getSshCommandToRun), and a command is sent
 * verbatim.
 */
export default class SSHExecutor {
  public static execute(data: {
    payload: JSONObject;
    credential: JSONObject;
    timeoutInMs: number;
  }): Promise<SSHExecResult> {
    const command: string = getSshCommandToRun(data.payload);
    const hostname: string = String(data.credential["hostname"] || "");
    const username: string = String(data.credential["username"] || "");
    const port: number = Number(data.credential["port"] || 22);

    if (!hostname || !username) {
      return Promise.resolve({
        success: false,
        output: "",
        errorMessage: "SSH credential is missing a hostname or username.",
      });
    }

    if (!command) {
      return Promise.resolve({
        success: false,
        output: "",
        errorMessage: "SSH step has no script to run.",
      });
    }

    const privateKey: string | undefined = data.credential["privateKey"]
      ? String(data.credential["privateKey"])
      : undefined;
    const passphrase: string | undefined = data.credential["passphrase"]
      ? String(data.credential["passphrase"])
      : undefined;
    const password: string | undefined = data.credential["password"]
      ? String(data.credential["password"])
      : undefined;

    if (!privateKey && !password) {
      return Promise.resolve({
        success: false,
        output: "",
        errorMessage:
          "SSH credential has neither a private key nor a password.",
      });
    }

    /*
     * The host keys the step names: the machine must present one of them
     * before anything is sent to it - the password or the key's signature
     * included. With none named, any key is accepted, as before, and the
     * output says which one the machine presented.
     */
    const pinnedHostKeys: Array<SshPinnedHostKey> = readPinnedSshHostKeys(
      data.credential["hostKeys"],
    );
    const hostKeyAlgorithms: Array<string> | null =
      getSshHostKeyAlgorithms(pinnedHostKeys);

    return new Promise<SSHExecResult>((resolve: (v: SSHExecResult) => void) => {
      const conn: Client = new Client();

      let stdout: string = "";
      let stderr: string = "";
      let settled: boolean = false;
      // The key the machine presented, once it has.
      let presentedHostKey: SshPinnedHostKey | null = null;
      let isHostKeyRefused: boolean = false;

      // What the step printed, and the unchecked host key it signed in to.
      const withHostKeyNote: (output: string) => string = (
        output: string,
      ): string => {
        if (pinnedHostKeys.length > 0 || !presentedHostKey) {
          return output;
        }

        const note: string = getUncheckedHostKeyNote(presentedHostKey);

        return output ? `${output}\n${note}` : note;
      };

      const finish: (result: SSHExecResult) => void = (
        result: SSHExecResult,
      ): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);

        try {
          conn.end();
        } catch {
          // The connection is already gone; the result stands either way.
        }

        resolve(result);
      };

      /*
       * One deadline covers connect, auth and execution together. ssh2's own
       * readyTimeout only covers the handshake, which would leave a command
       * that hangs forever holding the step open past its timeout.
       */
      const timer: ReturnType<typeof setTimeout> = setTimeout(() => {
        finish({
          success: false,
          output: truncate(stdout + stderr),
          errorMessage: `SSH step timed out after ${data.timeoutInMs}ms.`,
        });
      }, data.timeoutInMs);

      conn.on("ready", () => {
        conn.exec(command, (err: Error | undefined, stream: ClientChannel) => {
          if (err) {
            return finish({
              success: false,
              output: "",
              errorMessage: err.message,
            });
          }

          stream.on("data", (chunk: Buffer) => {
            if (Buffer.byteLength(stdout, "utf8") < MAX_OUTPUT_BYTES) {
              stdout += chunk.toString("utf8");
            }
          });

          stream.stderr.on("data", (chunk: Buffer) => {
            if (Buffer.byteLength(stderr, "utf8") < MAX_OUTPUT_BYTES) {
              stderr += chunk.toString("utf8");
            }
          });

          stream.on("close", (code: number | null) => {
            const exitCode: number = typeof code === "number" ? code : 1;
            const output: string = withHostKeyNote(
              truncate(stdout + (stderr ? `\n${stderr}` : "")),
            );

            finish({
              success: exitCode === 0,
              output,
              exitCode,
              ...(exitCode === 0
                ? {}
                : { errorMessage: `Command exited with code ${exitCode}.` }),
            });
          });

          return undefined;
        });
      });

      conn.on("error", (err: Error) => {
        let errorMessage: string = err.message;

        if (isHostKeyRefused && presentedHostKey) {
          errorMessage = getHostKeyMismatchMessage(presentedHostKey);
        } else if (
          hostKeyAlgorithms &&
          !presentedHostKey &&
          err.message.toLowerCase().includes("no matching host key format")
        ) {
          errorMessage = getHostKeyTypeMismatchMessage(
            pinnedHostKeys
              .map((key: SshPinnedHostKey): string => {
                return key.keyType || "";
              })
              .filter((keyType: string, index: number, all: Array<string>) => {
                return keyType && all.indexOf(keyType) === index;
              }),
          );
        }

        finish({
          success: false,
          output: truncate(stdout + stderr),
          errorMessage,
        });
      });

      const connectConfig: ConnectConfig = {
        host: hostname,
        port,
        username,
        readyTimeout: data.timeoutInMs,
        ...(privateKey ? { privateKey } : {}),
        ...(passphrase ? { passphrase } : {}),
        ...(password ? { password } : {}),
        /*
         * Called during the key exchange with the key the machine
         * presents, before anything of the step is sent; ssh2 checks that
         * the machine holds that key's private half on its own.
         */
        hostVerifier: (key: Buffer): boolean => {
          presentedHostKey = describeSshHostKey(key);

          if (pinnedHostKeys.length === 0) {
            return true;
          }

          const isNamed: boolean = pinnedHostKeys.some(
            (pinned: SshPinnedHostKey): boolean => {
              return pinned.fingerprint === presentedHostKey!.fingerprint;
            },
          );

          isHostKeyRefused = !isNamed;

          return isNamed;
        },
        // Ask for a key the step names, when it names their types.
        ...(hostKeyAlgorithms
          ? {
              algorithms: {
                serverHostKey:
                  hostKeyAlgorithms as Array<ServerHostKeyAlgorithm>,
              },
            }
          : {}),
      };

      try {
        conn.connect(connectConfig);
      } catch (err) {
        finish({
          success: false,
          output: "",
          errorMessage: err instanceof Error ? err.message : String(err),
        });
      }
    });
  }
}
