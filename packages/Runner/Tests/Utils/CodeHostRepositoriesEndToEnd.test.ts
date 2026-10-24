import RepositoryManager, {
  CloneResult,
  RepositoryConfig,
} from "../../Utils/RepositoryManager";
import GitHostGuard from "../../Utils/GitHostGuard";
import PullRequestOpener from "../../Utils/PullRequestOpener";
import PushedBranches, { PushedBranch } from "../../Utils/PushedBranches";
import { RepositoryToken } from "../../Utils/BackendAPI";
import CodeHostHttp, {
  CodeHostHttpResponse,
} from "Common/Server/Utils/CodeRepository/CodeHost/CodeHostHttp";
import { CodeHostRunnerInfo } from "Common/Types/CodeRepository/CodeHost";
import CodeRepositoryType from "Common/Types/CodeRepository/CodeRepositoryType";
import {
  LocalGitHttpServer,
  canRunLocalGitHttpServer,
  startLocalGitHttpServer,
} from "Common/Tests/Server/Utils/CodeRepository/CodeHost/LocalGitHttpServer";
import {
  ForgeAdmin,
  TestForge,
  readTestForges,
} from "Common/Tests/Server/Utils/CodeRepository/CodeHost/ForgeServerSetup";
import fs from "fs";
import os from "os";
import path from "path";

/*
 * A run's whole way through a repository that is not on GitHub, with real
 * git against a real server:
 *
 *   - a plain Git repository (git http-backend behind Basic authentication):
 *     clone with the connection's username and password, branch, commit,
 *     push - the token through the askpass helper, never on disk or in an
 *     address - and the pushed branch the run reports instead of a pull
 *     request;
 *   - Forgejo and Gitea, when the run names real servers (ForgeServerSetup):
 *     the same clone and push with an access token, then the pull request
 *     PullRequestOpener opens there.
 *
 * The servers listen on 127.0.0.1, which GitHostGuard refuses on every
 * Runner, so its options are stubbed here (GitHostGuard.test.ts holds the
 * guard itself) and the API is called through the unguarded transport.
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

const describeWithGit: typeof describe = canRunLocalGitHttpServer()
  ? describe
  : describe.skip;

describeWithGit("a plain Git repository", () => {
  let server: LocalGitHttpServer;

  beforeAll(async () => {
    server = await startLocalGitHttpServer();
  });

  afterAll(async () => {
    await server.close();
  });

  test("is cloned, changed on a new branch and pushed with its own credentials - and the run says where the branch is", async () => {
    const codeHost: CodeHostRunnerInfo = {
      type: CodeRepositoryType.Git,
      hostUrl: server.origin,
      apiUrl: null,
      webUrl: null,
      username: server.username,
      projectId: null,
      hasPullRequests: false,
    };
    const config: RepositoryConfig = {
      organizationName: "team",
      repositoryName: "app",
      token: server.password,
      repositoryUrl: server.cloneUrl,
      baseBranch: "main",
      codeHost,
    };
    const manager: RepositoryManager = new RepositoryManager();
    const workDir: string = makeTempDir("oneuptime-git-run-");

    const clone: CloneResult = await manager.cloneRepository(config, workDir);

    expect(clone.baseBranch).toBe("main");
    expect(
      fs.readFileSync(
        path.join(clone.repositoryPath, "src", "index.ts"),
        "utf8",
      ),
    ).toContain("41");

    // The guard was asked about the address git dialled, with its codeHost.
    expect(GitHostGuard.getGitOptions).toHaveBeenCalledWith(
      `http://${server.username}@${server.cloneUrl.substring("http://".length)}`,
      codeHost,
    );

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
      config,
    );

    const refs: Record<string, string> = server.readRefs();

    expect(refs["refs/heads/oneuptime/fix-answer"]).toBe(
      await manager.getCurrentCommitHash(clone.repositoryPath),
    );

    // The password never reached the clone's files.
    expect(readAll(path.join(clone.repositoryPath, ".git"))).not.toContain(
      server.password,
    );

    // No pull request: the branch, and where it is, are the run's outcome.
    const token: RepositoryToken = {
      token: server.password,
      expiresAt: new Date(Date.now() + 60000),
      repositoryUrl: server.cloneUrl,
      organizationName: "team",
      repositoryName: "app",
      codeHost,
    };

    expect(PullRequestOpener.hasPullRequests(token)).toBe(false);

    const pushed: PushedBranch = PushedBranches.create({
      repositoryId: "repo-1",
      token,
      branchName: "oneuptime/fix-answer",
      baseBranchName: clone.baseBranch,
      summary: "The answer is 42.",
      changes: await manager.getLastCommitChanges(clone.repositoryPath),
    });

    expect(pushed.newPullRequestUrl).toBeNull();
    expect(
      pushed.changes?.files.map((file: { path: string }) => {
        return file.path;
      }),
    ).toEqual(["src/index.ts"]);
    expect(PushedBranches.toOutcome([pushed])?.summary).toContain(
      "Pushed to the branch `oneuptime/fix-answer` of team/app",
    );
  });

  test("a wrong password fails the clone without saying it", async () => {
    const manager: RepositoryManager = new RepositoryManager();
    let caught: Error | null = null;

    try {
      await manager.cloneRepository(
        {
          organizationName: "team",
          repositoryName: "app",
          token: "not-the-password-9876",
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
        makeTempDir("oneuptime-git-refused-"),
      );
    } catch (error) {
      caught = error as Error;
    }

    expect(caught).not.toBeNull();
    expect(caught!.message).not.toContain("not-the-password-9876");
  });
});

const FORGES: Array<TestForge> = readTestForges();

/*
 * jest refuses an empty table even under a skipped describe: one that is
 * never run stands in for it.
 */
function readTestForgesOrPlaceholder(): Array<TestForge> {
  return [{ name: "none", hostUrl: "", adminUser: "", adminPassword: "" }];
}

if (FORGES.length === 0) {
  describe.skip("Forgejo and Gitea, against a real server (no CODE_HOST_TEST_FORGES)", () => {
    test("skipped", () => {
      // Named by the run, or not at all.
    });
  });
}

(FORGES.length > 0 ? describe : describe.skip)(
  "Forgejo and Gitea, against a real server",
  () => {
    test.each(
      (FORGES.length > 0 ? FORGES : readTestForgesOrPlaceholder()).map(
        (forge: TestForge): [string, TestForge] => {
          return [forge.name, forge];
        },
      ),
    )(
      "%s: clone and push with an access token, then open the pull request there",
      async (_name: string, forge: TestForge) => {
        const admin: ForgeAdmin = new ForgeAdmin(forge);
        const name: string = `run-${Date.now()}`;
        const token: string = await admin.createToken({
          user: { name: forge.adminUser, password: forge.adminPassword },
          scopes: ["write:repository", "read:user"],
        });

        await admin.ok({
          method: "POST",
          path: "/user/repos",
          body: { name, auto_init: true, default_branch: "main" },
        });

        const codeHost: CodeHostRunnerInfo = {
          type: CodeRepositoryType.Forgejo,
          hostUrl: forge.hostUrl,
          apiUrl: `${forge.hostUrl}/api/v1`,
          webUrl: `${forge.hostUrl}/${forge.adminUser}/${name}`,
          username: forge.adminUser,
          projectId: null,
          hasPullRequests: true,
        };
        const config: RepositoryConfig = {
          organizationName: forge.adminUser,
          repositoryName: name,
          token,
          repositoryUrl: `${forge.hostUrl}/${forge.adminUser}/${name}.git`,
          baseBranch: "main",
          codeHost,
        };
        const manager: RepositoryManager = new RepositoryManager();
        const clone: CloneResult = await manager.cloneRepository(
          config,
          makeTempDir("oneuptime-forge-run-"),
        );

        await manager.createBranch(clone.repositoryPath, "oneuptime/fix-1");
        fs.writeFileSync(path.join(clone.repositoryPath, "FIX.md"), "fixed\n");
        await manager.addAllChanges(clone.repositoryPath);
        await manager.commitChanges(clone.repositoryPath, "Fix it");
        await manager.pushBranch(
          clone.repositoryPath,
          "oneuptime/fix-1",
          config,
        );

        const result: { number: number; htmlUrl: string } =
          await new PullRequestOpener(
            undefined,
            CodeHostHttp.createUnguardedTransportForTests(),
          ).open({
            token: {
              token,
              expiresAt: new Date(Date.now() + 60000),
              repositoryUrl: config.repositoryUrl!,
              organizationName: forge.adminUser,
              repositoryName: name,
              codeHost,
            },
            baseBranch: "main",
            headBranch: "oneuptime/fix-1",
            title: "Fix it",
            body: "What changed, and why.",
          });

        expect(result.number).toBeGreaterThan(0);
        expect(result.htmlUrl).toBe(
          `${forge.hostUrl}/${forge.adminUser}/${name}/pulls/${result.number}`,
        );

        const read: CodeHostHttpResponse = await admin.ok({
          method: "GET",
          path: `/repos/${forge.adminUser}/${name}/pulls/${result.number}`,
        });
        const pull: Record<string, unknown> = read.bodyJson as Record<
          string,
          unknown
        >;

        expect(pull["title"]).toBe("Fix it");
        expect(pull["body"]).toBe("What changed, and why.");
        expect((pull["head"] as Record<string, unknown>)["ref"]).toBe(
          "oneuptime/fix-1",
        );
        expect((pull["base"] as Record<string, unknown>)["ref"]).toBe("main");
      },
    );
  },
);
