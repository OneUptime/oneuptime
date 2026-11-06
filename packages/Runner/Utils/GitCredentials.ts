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
 *
 * HOW GIT SIGNS IN: UP FRONT, AS HTTP BASIC.
 *
 * Left to itself, git sends no credentials on its first request, reads the
 * schemes the server's 401 offers, and lets libcurl pick the "strongest" of
 * them: Negotiate or NTLM before Basic. A server behind Windows
 * authentication - Azure DevOps Server (TFS) on IIS, which takes a personal
 * access token over Basic but offers Negotiate and NTLM first - is then sent
 * the username and the token as a Windows sign-in, refuses it, and the clone
 * fails with "Authentication failed" although the token is good (issue
 * #6144). OneUptime's server checks a repository's credentials with Basic
 * (GitSmartHttp, CodeHostRunnerToken) and so said they worked.
 *
 * So the credentials go with the first request, as Basic - what the server
 * checked, what Microsoft documents for a token with git, and what GitHub,
 * GitLab, Forgejo and Gitea take: an `http.<origin>/.extraHeader`, scoped to
 * the remote's own server, handed to git through its environment
 * (GIT_CONFIG_COUNT / GIT_CONFIG_KEY_n / GIT_CONFIG_VALUE_n, git 2.31+) - not
 * argv, not .git/config, and not this process's environment. The askpass
 * helper stays for a git too old to read configuration from its
 * environment, which then signs in as it always did.
 */

// Environment variable the askpass script reads the token from.
const TOKEN_ENV_NAME: string = "ONEUPTIME_GIT_ACCESS_TOKEN";

/*
 * The username a GitHub App installation token signs in with. Every other
 * host's comes with its token (CodeHostRunnerInfo.username).
 */
export const GITHUB_TOKEN_USERNAME: string = "x-access-token";

// The configuration git reads from its environment (git 2.31+).
const GIT_CONFIG_COUNT_ENV_NAME: string = "GIT_CONFIG_COUNT";

/*
 * Who git signs in as, and where: the header carrying the credentials is
 * sent to this remote's server and no other.
 */
export interface GitSignIn {
  username: string;
  remoteUrl: string;
}

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
   * With `signIn`, git sends the username and token with its first request
   * to the remote's server, as HTTP Basic (getBasicAuthEnv); without it,
   * only when asked, through the askpass helper.
   *
   * The caller owns the handle and must dispose() it — RepositoryManager
   * does so in a finally block so a thrown git command still cleans up.
   */
  public static async create(
    token: string,
    signIn?: GitSignIn | undefined,
  ): Promise<GitCredentialHandle> {
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

    const basicAuthEnv: Record<string, string> = signIn
      ? GitCredentials.getBasicAuthEnv({
          remoteUrl: signIn.remoteUrl,
          username: signIn.username,
          token,
          inheritedEnv: process.env,
        })
      : {};

    return {
      env: {
        ...basicAuthEnv,
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
   * The value of the Authorization header that signs in as `username` with
   * `token`: HTTP Basic, the pair base64-encoded as UTF-8 - exactly what
   * OneUptime's server sends when it checks the same credentials
   * (GitSmartHttp).
   */
  public static getBasicAuthorization(username: string, token: string): string {
    return `Basic ${Buffer.from(`${username}:${token}`, "utf8").toString("base64")}`;
  }

  /*
   * The environment that makes git send the credentials with its first
   * request to the remote's server, as HTTP Basic: one more entry of the
   * configuration git reads from its environment, after any the Runner was
   * started with (an operator's proxy or CA settings stay as they are), so
   * nothing secret is in argv or .git/config. Scoped to the remote's origin
   * - scheme, host and port - so no other server is ever sent it. Nothing
   * for a remote that is not http(s), which has no HTTP to sign in to.
   */
  public static getBasicAuthEnv(data: {
    remoteUrl: string;
    username: string;
    token: string;
    inheritedEnv: NodeJS.ProcessEnv;
  }): Record<string, string> {
    let url: URL;

    try {
      url = new URL(data.remoteUrl);
    } catch {
      return {};
    }

    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return {};
    }

    const index: number = GitCredentials.readInheritedConfigCount(
      data.inheritedEnv,
    );

    return {
      [GIT_CONFIG_COUNT_ENV_NAME]: String(index + 1),
      [`GIT_CONFIG_KEY_${index}`]: `http.${url.protocol}//${url.host}/.extraHeader`,
      [`GIT_CONFIG_VALUE_${index}`]: `Authorization: ${GitCredentials.getBasicAuthorization(
        data.username,
        data.token,
      )}`,
    };
  }

  /*
   * How many configuration entries the Runner's own environment already
   * gives git: ours goes after them. A count git could not read either is
   * read as none, and ours replaces it.
   */
  private static readInheritedConfigCount(env: NodeJS.ProcessEnv): number {
    const raw: string = (env[GIT_CONFIG_COUNT_ENV_NAME] || "").trim();

    if (!raw) {
      return 0;
    }

    for (let index: number = 0; index < raw.length; index++) {
      const code: number = raw.charCodeAt(index);

      if (code < 48 || code > 57) {
        return 0;
      }
    }

    const count: number = Number(raw);

    return Number.isSafeInteger(count) ? count : 0;
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
    /*
     * The username Git signs in with: a GitLab, Forgejo or Gitea token's
     * account, or a Git repository's own username (CodeHostRunnerInfo).
     * GitHub's installation tokens take "x-access-token".
     */
    username?: string | undefined;
  }): string {
    if (data.repositoryUrl) {
      const url: URL = new URL(data.repositoryUrl);
      url.username = encodeURIComponent(data.username || GITHUB_TOKEN_USERNAME);
      // Explicitly clear any password the caller's URL already carried.
      url.password = "";
      return url.toString();
    }

    return `https://${GITHUB_TOKEN_USERNAME}@github.com/${data.organizationName}/${data.repositoryName}.git`;
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
