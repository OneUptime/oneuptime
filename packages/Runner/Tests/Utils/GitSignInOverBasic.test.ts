import RepositoryManager, {
  CloneResult,
  RepositoryConfig,
} from "../../Utils/RepositoryManager";
import GitCredentials from "../../Utils/GitCredentials";
import GitHostGuard from "../../Utils/GitHostGuard";
import TaskLogger from "../../Utils/TaskLogger";
import Execute from "Common/Server/Utils/Execute";
import { CodeHostRunnerInfo } from "Common/Types/CodeRepository/CodeHost";
import CodeRepositoryType from "Common/Types/CodeRepository/CodeRepositoryType";
import {
  LocalGitHttpRequest,
  LocalGitHttpServer,
  WINDOWS_AUTHENTICATION_CHALLENGES,
  canRunLocalGitHttpServer,
  startLocalGitHttpServer,
} from "Common/Tests/Server/Utils/CodeRepository/CodeHost/LocalGitHttpServer";
import fs from "fs";
import os from "os";
import path from "path";

/*
 * A Git server that offers Windows sign-in before Basic - Azure DevOps
 * Server (TFS) on IIS - with real git (issue #6144).
 *
 * Such a server takes a personal access token over HTTP Basic, which is how
 * OneUptime's server checks a Git repository's credentials when it is
 * connected (GitSmartHttp), so the repository read as connected. But its 401
 * offers Negotiate and NTLM before Basic, and git, left to itself, signed in
 * with the strongest of them: the username and token went as a Windows
 * sign-in, the server refused them, and every task in the repository failed
 * its clone with "Authentication failed". The Runner now sends the
 * credentials with git's first request, as Basic, through the git process's
 * environment - never argv, the remote's address or .git/config.
 *
 * The server here is git's own http-backend behind exactly that challenge,
 * and takes nothing but Basic with the right username and token. It listens
 * on 127.0.0.1, which GitHostGuard refuses on every Runner, so the guard's
 * options are stubbed (GitHostGuard.test.ts holds the guard itself).
 */

jest.setTimeout(180000);

const temporaryPaths: Array<string> = [];

function makeTempDir(prefix: string): string {
  const dir: string = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  temporaryPaths.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of temporaryPaths) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

beforeEach(() => {
  jest
    .spyOn(GitHostGuard, "getGitOptions")
    .mockResolvedValue(["-c", "http.followRedirects=false"]);
});

afterEach(() => {
  jest.restoreAllMocks();
});

// Every file under a directory, as one string, to search for a secret.
function readAll(directory: string): string {
  let text: string = "";

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const child: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      text += readAll(child);
    } else if (entry.isFile()) {
      text += fs.readFileSync(child, "latin1");
    }
  }

  return text;
}

// A logger that keeps what a run's log would show.
function recordingLogger(): { logger: TaskLogger; lines: Array<string> } {
  const lines: Array<string> = [];
  const logger: TaskLogger = {
    info: async (message: string): Promise<void> => {
      lines.push(message);
    },
  } as unknown as TaskLogger;

  return { logger, lines };
}

const describeWithGit: typeof describe = canRunLocalGitHttpServer()
  ? describe
  : describe.skip;

describeWithGit(
  "a Git server that offers Negotiate and NTLM before Basic, as Azure DevOps Server does",
  () => {
    let server: LocalGitHttpServer;

    beforeAll(async () => {
      server = await startLocalGitHttpServer({
        username: "DOMAIN\\deploy",
        password: "azdo-personal-access-token-4f1c9a",
        challenges: WINDOWS_AUTHENTICATION_CHALLENGES,
      });
    });

    afterAll(async () => {
      await server.close();
    });

    beforeEach(() => {
      server.requestLog.length = 0;
    });

    function codeHost(): CodeHostRunnerInfo {
      return {
        type: CodeRepositoryType.Git,
        hostUrl: server.origin,
        apiUrl: null,
        webUrl: null,
        username: server.username,
        projectId: null,
        hasPullRequests: false,
      };
    }

    function config(overrides?: Partial<RepositoryConfig>): RepositoryConfig {
      return {
        organizationName: "DefaultCollection/ScriptVault/_git",
        repositoryName: "app",
        token: server.password,
        repositoryUrl: server.cloneUrl,
        baseBranch: "main",
        codeHost: codeHost(),
        ...overrides,
      };
    }

    function schemesSent(): Array<string | null> {
      return server.requestLog.map(
        (request: LocalGitHttpRequest): string | null => {
          return request.authorizationScheme;
        },
      );
    }

    test("a clone and a push sign in with the token as Basic from the first request, and never answer Negotiate or NTLM", async () => {
      const manager: RepositoryManager = new RepositoryManager();
      const clone: CloneResult = await manager.cloneRepository(
        config(),
        makeTempDir("oneuptime-azdo-run-"),
      );

      expect(clone.baseBranch).toBe("main");
      expect(
        fs.readFileSync(
          path.join(clone.repositoryPath, "src", "index.ts"),
          "utf8",
        ),
      ).toContain("41");

      await manager.createBranch(clone.repositoryPath, "oneuptime/fix-answer");
      fs.writeFileSync(
        path.join(clone.repositoryPath, "src", "index.ts"),
        "export const answer: number = 42;\n",
      );
      await manager.addAllChanges(clone.repositoryPath);
      await manager.commitChanges(clone.repositoryPath, "Fix the answer");
      await manager.pushBranch(
        clone.repositoryPath,
        "oneuptime/fix-answer",
        config(),
      );

      expect(server.readRefs()["refs/heads/oneuptime/fix-answer"]).toBe(
        await manager.getCurrentCommitHash(clone.repositoryPath),
      );

      // Every request git made - the clone's and the push's - was signed in.
      expect(server.requestLog.length).toBeGreaterThan(0);
      expect(
        server.requestLog.every((request: LocalGitHttpRequest): boolean => {
          return request.isSignedIn;
        }),
      ).toBe(true);
      expect(schemesSent()).not.toContain(null);
      expect(schemesSent()).not.toContain("Negotiate");
      expect(schemesSent()).not.toContain("NTLM");

      // Neither the token nor the header carrying it reached the clone.
      const gitDirectory: string = readAll(
        path.join(clone.repositoryPath, ".git"),
      );
      const header: string = GitCredentials.getBasicAuthorization(
        server.username,
        server.password,
      );

      expect(gitDirectory).not.toContain(server.password);
      expect(gitDirectory).not.toContain(header.substring("Basic ".length));
    });

    /*
     * A setup command (`npm ci` installing husky) points core.hooksPath at
     * the repository's committed hooks. A pre-push hook there would run
     * inside the push, with the credentials in its environment, and could
     * fail it - after the whole run.
     */
    test("a pre-push hook of the repository never runs in the push: it neither sees the credentials nor stops the push", async () => {
      const manager: RepositoryManager = new RepositoryManager();
      const clone: CloneResult = await manager.cloneRepository(
        config(),
        makeTempDir("oneuptime-azdo-hooks-"),
      );
      const witness: string = path.join(
        makeTempDir("oneuptime-azdo-hook-witness-"),
        "pre-push-env.txt",
      );
      const hooks: string = path.join(clone.repositoryPath, ".husky");

      fs.mkdirSync(hooks, { recursive: true });
      fs.writeFileSync(
        path.join(hooks, "pre-push"),
        `#!/bin/sh\nenv > '${witness}'\necho 'refusing every push' >&2\nexit 1\n`,
        { mode: 0o755 },
      );
      fs.writeFileSync(path.join(clone.repositoryPath, "HOOKED.md"), "x\n");

      await manager.createBranch(clone.repositoryPath, "oneuptime/hooked");
      await manager.addAllChanges(clone.repositoryPath);
      await manager.commitChanges(clone.repositoryPath, "Add a file");

      // What husky does during `npm ci`.
      await Execute.executeCommandFile({
        command: "git",
        args: ["config", "core.hooksPath", ".husky"],
        cwd: clone.repositoryPath,
      });

      await manager.pushBranch(
        clone.repositoryPath,
        "oneuptime/hooked",
        config(),
      );

      expect(fs.existsSync(witness)).toBe(false);
      expect(server.readRefs()["refs/heads/oneuptime/hooked"]).toBe(
        await manager.getCurrentCommitHash(clone.repositoryPath),
      );
    });

    test("the credentials go in git's environment, not its arguments, and the remote names only the username", async () => {
      const execute: jest.SpyInstance = jest.spyOn(
        Execute,
        "executeCommandFile",
      );

      await new RepositoryManager().cloneRepository(
        config(),
        makeTempDir("oneuptime-azdo-argv-"),
      );

      const cloneCall: { args: Array<string>; env?: NodeJS.ProcessEnv } =
        execute.mock.calls
          .map((call: Array<unknown>) => {
            return call[0] as { args: Array<string>; env?: NodeJS.ProcessEnv };
          })
          .find((call: { args: Array<string> }) => {
            return call.args.includes("clone");
          })!;

      expect(cloneCall).toBeDefined();

      const argv: string = cloneCall.args.join(" ");
      const encodedToken: string = Buffer.from(
        `${server.username}:${server.password}`,
      ).toString("base64");

      expect(argv).not.toContain(server.password);
      expect(argv).not.toContain(encodedToken);
      expect(argv).toContain(
        `http://${encodeURIComponent(server.username)}@127.0.0.1`,
      );

      const env: NodeJS.ProcessEnv = cloneCall.env || {};
      const values: Array<string> = Object.keys(env)
        .filter((name: string): boolean => {
          return name.startsWith("GIT_CONFIG_VALUE_");
        })
        .map((name: string): string => {
          return env[name] || "";
        });

      expect(values).toContain(
        `Authorization: ${GitCredentials.getBasicAuthorization(server.username, server.password)}`,
      );

      // And never in this process's own environment, which the agent inherits.
      expect(JSON.stringify(process.env)).not.toContain(encodedToken);
      expect(process.env["ONEUPTIME_GIT_ACCESS_TOKEN"]).toBeUndefined();
    });

    test("a refused token fails the clone at once - no second sign-in for the default branch - and says what to check, never the token", async () => {
      const execute: jest.SpyInstance = jest.spyOn(
        Execute,
        "executeCommandFile",
      );
      const { logger, lines } = recordingLogger();
      let caught: Error | null = null;

      try {
        await new RepositoryManager(logger).cloneRepository(
          config({ token: "not-the-token-0000-9876" }),
          makeTempDir("oneuptime-azdo-refused-"),
        );
      } catch (error) {
        caught = error as Error;
      }

      expect(caught).not.toBeNull();

      const message: string = caught!.message;

      expect(message.startsWith(`${new URL(server.origin).host} `)).toBe(true);
      expect(message).toContain(
        "refused the credentials OneUptime signed in with, so DefaultCollection/ScriptVault/_git/app could not be cloned.",
      );
      expect(message).toContain(
        "Check the username and the password or token it is connected with in Code",
      );
      expect(message).toContain("Git said: ");
      expect(message).toContain("fatal: Authentication failed");
      expect(message).not.toContain("not-the-token-0000-9876");
      expect(message).not.toContain("Command failed");
      expect(message).not.toContain("http.followRedirects");
      // Short enough that what git said survives where the run keeps it.
      expect(message.length).toBeLessThan(500);

      // One clone, not a second one of the default branch with the same token.
      const clones: number = execute.mock.calls.filter(
        (call: Array<unknown>): boolean => {
          return (call[0] as { args: Array<string> }).args.includes("clone");
        },
      ).length;

      expect(clones).toBe(1);
      expect(lines.join("\n")).not.toContain("default branch instead");
    });

    test("a base branch the server does not have still falls back to its default branch, and says so", async () => {
      const { logger, lines } = recordingLogger();

      const clone: CloneResult = await new RepositoryManager(
        logger,
      ).cloneRepository(
        config({ baseBranch: "master" }),
        makeTempDir("oneuptime-azdo-stale-branch-"),
      );

      expect(clone.baseBranch).toBe("main");
      expect(lines.join("\n")).toContain(
        'Branch "master" was not found on the remote — cloning the repository\'s default branch instead.',
      );
    });

    test("configuration the Runner was started with still applies beside the sign-in", async () => {
      const saved: Record<string, string | undefined> = {
        GIT_CONFIG_COUNT: process.env["GIT_CONFIG_COUNT"],
        GIT_CONFIG_KEY_0: process.env["GIT_CONFIG_KEY_0"],
        GIT_CONFIG_VALUE_0: process.env["GIT_CONFIG_VALUE_0"],
      };

      process.env["GIT_CONFIG_COUNT"] = "1";
      process.env["GIT_CONFIG_KEY_0"] = "http.userAgent";
      process.env["GIT_CONFIG_VALUE_0"] = "operator-proxy-agent/1.0";

      try {
        await new RepositoryManager().cloneRepository(
          config(),
          makeTempDir("oneuptime-azdo-inherited-"),
        );
      } finally {
        for (const name of Object.keys(saved)) {
          if (saved[name] === undefined) {
            delete process.env[name];
          } else {
            process.env[name] = saved[name];
          }
        }
      }

      expect(server.requestLog.length).toBeGreaterThan(0);

      for (const request of server.requestLog) {
        expect(request.userAgent).toBe("operator-proxy-agent/1.0");
        expect(request.isSignedIn).toBe(true);
      }
    });
  },
);

describeWithGit(
  "a Git server that offers Basic alone, as GitHub, GitLab, Forgejo and Gitea do",
  () => {
    let server: LocalGitHttpServer;

    beforeAll(async () => {
      server = await startLocalGitHttpServer();
    });

    afterAll(async () => {
      await server.close();
    });

    test("is signed in to with the first request too, rather than after a 401", async () => {
      server.requestLog.length = 0;

      await new RepositoryManager().cloneRepository(
        {
          organizationName: "team",
          repositoryName: "app",
          token: server.password,
          repositoryUrl: server.cloneUrl,
          baseBranch: "main",
          codeHost: {
            type: CodeRepositoryType.Git,
            hostUrl: server.origin,
            apiUrl: null,
            webUrl: null,
            username: server.username,
            projectId: null,
            hasPullRequests: false,
          },
        },
        makeTempDir("oneuptime-basic-run-"),
      );

      expect(server.requestLog[0]?.isSignedIn).toBe(true);
      expect(
        server.requestLog.some((request: LocalGitHttpRequest): boolean => {
          return !request.isSignedIn;
        }),
      ).toBe(false);
    });
  },
);
