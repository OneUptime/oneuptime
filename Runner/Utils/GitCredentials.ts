import LocalFile from "Common/Server/Utils/LocalFile";
import logger from "Common/Server/Utils/Logger";
import ObjectID from "Common/Types/ObjectID";
import fs from "fs/promises";
import os from "os";
import path from "path";

/*
 * How the code-fix pipeline authenticates git without ever writing the
 * repository token somewhere it can be read back.
 *
 * The obvious approach — `git clone https://x-access-token:<TOKEN>@github.com/...` —
 * leaks the token three ways, and all three are reachable in a normal run:
 *
 *   1. ARGV. Node's execFile puts the full command line into the rejected
 *      Error's message, so any git failure produces
 *      "Command failed: git clone https://x-access-token:ghs_...@github.com/...".
 *      That message is logged, and the task handler forwards it to the
 *      server as the run's statusMessage, where it is stored and rendered.
 *      It is also visible to anything that can read /proc or run `ps` on
 *      the Runner host — including the code agent's own `run_command`.
 *   2. .git/config. Clone persists the authenticated URL as the origin
 *      remote. The agent then works in that repository for up to thirty
 *      minutes with `read_file` and `run_command`, so a single
 *      `cat .git/config` hands the live installation token to the model —
 *      and from there to the transcript, which is shipped to the server.
 *   3. The push, which re-embeds the token in the remote all over again.
 *
 * GIT_ASKPASS closes all three. Git invokes the named program whenever it
 * needs a password and uses its stdout, so the URL carries only the
 * username, argv carries no secret, and nothing authenticated is persisted
 * to .git/config. The token reaches the helper through the environment of
 * the git child process only — not through this process's own environment,
 * so the agent's `run_command` (which inherits process.env) cannot see it
 * either.
 *
 * The helper script itself contains no secret: it echoes an environment
 * variable. It still lives outside the cloned repository, in a 0700
 * directory, so the agent's workspace-scoped tools cannot reach it at all.
 */

// Environment variable the askpass script reads the token from.
const TOKEN_ENV_NAME: string = "ONEUPTIME_GIT_ACCESS_TOKEN";

/*
 * The askpass program. Git calls it with a prompt argument ("Password for
 * ...") and takes the first line of stdout as the answer. Both the username
 * and the password prompt get the same treatment: the username is already in
 * the URL, so git only ever asks for the password here.
 */
const ASKPASS_SCRIPT: string = [
  "#!/bin/sh",
  "# Written by the OneUptime Runner. Contains no secret: the value is",
  "# supplied through the environment of the git process that runs this.",
  `printf '%s' "$${TOKEN_ENV_NAME}"`,
  "",
].join("\n");

export interface GitCredentialHandle {
  /*
   * Environment to pass to git child processes. Carries the token; must
   * never be merged into this process's own environment, because the code
   * agent's run_command inherits that.
   */
  env: Record<string, string>;
  // Remove the askpass script. Safe to call more than once.
  dispose: () => Promise<void>;
}

export default class GitCredentials {
  /*
   * Base directory for askpass scripts — deliberately NOT inside the run's
   * workspace, which is the directory the code agent is given.
   */
  private static readonly BASE_DIR: string = path.join(
    os.tmpdir(),
    "oneuptime-runner-git-askpass",
  );

  public static getBaseDir(): string {
    return this.BASE_DIR;
  }

  /*
   * Build an authenticated git environment for one repository.
   *
   * The caller owns the handle and must dispose() it — RepositoryManager
   * does so in a finally block so a thrown git command still cleans up.
   */
  public static async create(token: string): Promise<GitCredentialHandle> {
    await LocalFile.makeDirectory(this.BASE_DIR);

    /*
     * 0700 on the directory as well as the file: the file is created inside
     * a shared os.tmpdir(), where another local user could otherwise list
     * and read it.
     */
    await fs.chmod(this.BASE_DIR, 0o700).catch(() => {
      // Best effort — an existing directory may be owned differently.
    });

    const scriptPath: string = path.join(
      this.BASE_DIR,
      `askpass-${ObjectID.generate().toString()}.sh`,
    );

    await fs.writeFile(scriptPath, ASKPASS_SCRIPT, { mode: 0o700 });

    return {
      env: {
        GIT_ASKPASS: scriptPath,
        [TOKEN_ENV_NAME]: token,
        /*
         * Without this, a git command whose credentials are refused falls
         * back to prompting on the terminal and blocks until the command
         * timeout instead of failing immediately.
         */
        GIT_TERMINAL_PROMPT: "0",
        /*
         * Never let a system credential helper cache or answer for these
         * repositories: the Runner is long-lived and shared across
         * projects, so a cached credential is a cross-tenant leak.
         */
        GIT_CONFIG_NOSYSTEM: "1",
      },
      dispose: async (): Promise<void> => {
        try {
          await fs.rm(scriptPath, { force: true });
        } catch (error) {
          logger.warn(`Could not remove git askpass helper: ${error}`);
        }
      },
    };
  }

  /*
   * The remote URL to use with the askpass helper: the username only, never
   * the token. This is what ends up in .git/config, where the agent can
   * read it — and it must be harmless there.
   */
  public static buildRemoteUrl(data: {
    repositoryUrl?: string | undefined;
    organizationName: string;
    repositoryName: string;
  }): string {
    if (data.repositoryUrl) {
      const url: URL = new URL(data.repositoryUrl);
      url.username = "x-access-token";
      // Explicitly clear any password the caller's URL already carried.
      url.password = "";
      return url.toString();
    }

    return `https://x-access-token@github.com/${data.organizationName}/${data.repositoryName}.git`;
  }

  /*
   * Sweep askpass scripts left behind by a Runner that was killed before it
   * could dispose them. Called at startup; the scripts hold no secret, but
   * they should not accumulate.
   */
  public static async cleanupOrphans(): Promise<number> {
    let removed: number = 0;

    try {
      const entries: Array<string> = await fs.readdir(this.BASE_DIR);

      for (const entry of entries) {
        if (!entry.startsWith("askpass-")) {
          continue;
        }

        await fs.rm(path.join(this.BASE_DIR, entry), { force: true });
        removed++;
      }
    } catch {
      // No directory yet, or not readable — nothing to sweep.
    }

    return removed;
  }
}
