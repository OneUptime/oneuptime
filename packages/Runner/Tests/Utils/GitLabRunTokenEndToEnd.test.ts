import RepositoryManager, {
  CloneResult,
  RepositoryConfig,
} from "../../Utils/RepositoryManager";
import GitHostGuard from "../../Utils/GitHostGuard";
import PullRequestOpener from "../../Utils/PullRequestOpener";
import CodeHostRunnerToken, {
  CodeHostRunnerDecision,
  CodeHostRunnerGrant,
} from "Common/Server/Utils/CodeRepository/CodeHost/CodeHostRunnerToken";
import CodeRepositoryMintedTokens from "Common/Server/Utils/CodeRepository/CodeHost/CodeRepositoryMintedTokens";
import CodeFixPullRequestOpener, {
  OpenedFixPullRequest,
} from "Common/Server/Utils/AI/CodeFix/CodeFixPullRequestOpener";
import CodeHostAccess from "Common/Server/Utils/CodeRepository/CodeHost/CodeHostAccess";
import CodeHostHttp, {
  CodeHostTransport,
} from "Common/Server/Utils/CodeRepository/CodeHost/CodeHostHttp";
import CodeRepositoryConnectionService, {
  Service as CodeRepositoryConnectionServiceClass,
} from "Common/Server/Services/CodeRepositoryConnectionService";
import CodeRepository from "Common/Models/DatabaseModels/CodeRepository";
import CodeRepositoryConnection from "Common/Models/DatabaseModels/CodeRepositoryConnection";
import CodeRepositoryType from "Common/Types/CodeRepository/CodeRepositoryType";
import RunnerCodeFixCapability from "Common/Types/Runner/RunnerCodeFixCapability";
import { CodeWorkerKind } from "Common/Types/Runner/CodeRepositoryRunner";
import URL from "Common/Types/API/URL";
import ObjectID from "Common/Types/ObjectID";
import { canRunLocalGitHttpServer } from "Common/Tests/Server/Utils/CodeRepository/CodeHost/LocalGitHttpServer";
import {
  FakeGitLabServer,
  startFakeGitLabServer,
} from "Common/Tests/Server/Utils/CodeRepository/CodeHost/FakeGitLabServer";
import { mockMintedTokenStore } from "Common/Tests/Server/Utils/CodeRepository/CodeHost/MintedTokenStore";
import fs from "fs";
import os from "os";
import path from "path";

/*
 * A GITLAB FIX'S WHOLE WAY, WITH A TOKEN MADE FOR ITS RUN (#8912, #8916).
 *
 * Real git against a GitLab faked faithfully enough to hold the token to
 * GitLab's rules (FakeGitLabServer: its API, and each project a real bare
 * repository behind Git over HTTP, signed in to with a token as GitLab
 * signs Git in):
 *
 *   1. OneUptime makes the run a project access token with the connection's
 *      token, and hands the Runner that - never the connection's own;
 *   2. the Runner clones and pushes the fix's branch with it;
 *   3. the token reaches no other project, and calls no API: it cannot open
 *      the merge request itself;
 *   4. OneUptime opens the merge request with the connection's token, so its
 *      author is the connection's account, not the token's bot;
 *   5. the run ends: OneUptime revokes the token, and it clones and pushes
 *      nothing any more.
 *
 * Not a real GitLab: GitLab's own server was not available to verify
 * against (see the pull request). The fake holds what its documentation
 * says of project access tokens and merge requests.
 */

jest.setTimeout(180000);

const CONNECTION_TOKEN: string = "glpat-the-connections-own-0009";
const PROJECT_ID: ObjectID = ObjectID.generate();
const CONNECTION_ID: ObjectID = ObjectID.generate();
const REPOSITORY_ID: ObjectID = ObjectID.generate();
const RUN_ID: ObjectID = ObjectID.generate();
const BRANCH: string = `oneuptime-fix-exception-${RUN_ID.toString().substring(0, 8)}`;

const temporaryPaths: Array<string> = [];

function makeTempDir(prefix: string): string {
  const dir: string = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  temporaryPaths.push(dir);
  return dir;
}

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

describeWithGit(
  "a GitLab fix, with the token OneUptime made for its run",
  () => {
    let server: FakeGitLabServer;
    let transport: CodeHostTransport;
    let connection: CodeRepositoryConnection;
    let repository: CodeRepository;

    beforeAll(async () => {
      server = await startFakeGitLabServer({
        connectionToken: CONNECTION_TOKEN,
      });
      transport = CodeHostHttp.createUnguardedTransportForTests();
    });

    afterAll(async () => {
      await server.close();

      for (const dir of temporaryPaths) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    beforeEach(() => {
      connection = new CodeRepositoryConnection();
      connection._id = CONNECTION_ID.toString();
      connection.projectId = PROJECT_ID;
      connection.provider = CodeRepositoryType.GitLab;
      connection.hostUrl = server.origin;
      connection.accountLogin = "alice";
      connection.credentials =
        CodeRepositoryConnectionServiceClass.writeCredentials({
          token: CONNECTION_TOKEN,
          username: "alice",
        });
      connection.isReachableFromServer = true;

      repository = new CodeRepository();
      repository._id = REPOSITORY_ID.toString();
      repository.projectId = PROJECT_ID;
      repository.repositoryHostedAt = CodeRepositoryType.GitLab;
      repository.organizationName = "acme/backend";
      repository.repositoryName = "checkout";
      repository.repositoryUrl = URL.fromString(
        `${server.origin}/acme/backend/checkout`,
      );
      repository.gitLabProjectId = "4217";
      repository.codeRepositoryConnectionId = CONNECTION_ID;

      mockMintedTokenStore();

      jest
        .spyOn(CodeHostAccess, "readConnections")
        .mockImplementation((async (): Promise<
          Map<string, CodeRepositoryConnection>
        > => {
          return new Map([[CONNECTION_ID.toString(), connection]]);
        }) as never);
      jest
        .spyOn(CodeRepositoryConnectionService, "markAccepted")
        .mockResolvedValue(undefined);
      jest
        .spyOn(CodeRepositoryConnectionService, "markRefused")
        .mockResolvedValue(undefined);

      // The server's API calls reach the fake on 127.0.0.1.
      CodeHostAccess.setTransportForTests(transport);

      // The Runner's Git guard refuses 127.0.0.1: GitHostGuard.test.ts holds it.
      jest
        .spyOn(GitHostGuard, "getGitOptions")
        .mockResolvedValue(["-c", "http.followRedirects=false"]);
    });

    afterEach(() => {
      CodeHostAccess.setTransportForTests(null);
      jest.restoreAllMocks();
    });

    async function handTheRunnerAToken(): Promise<CodeHostRunnerGrant> {
      const decision: CodeHostRunnerDecision = await CodeHostRunnerToken.decide(
        {
          repository,
          worker: {
            kind: CodeWorkerKind.ProjectRunner,
            id: ObjectID.generate().toString(),
          },
          supportedCodeHosts: [CodeRepositoryType.GitLab],
          capabilities: [RunnerCodeFixCapability.ServerOpensPullRequests],
          runId: RUN_ID,
          transport,
        },
      );

      expect(decision.refusal).toBeUndefined();

      return decision.grant!;
    }

    function configFor(
      grant: CodeHostRunnerGrant,
      overrides: Partial<RepositoryConfig> = {},
    ): RepositoryConfig {
      return {
        organizationName: grant.organizationName,
        repositoryName: grant.repositoryName,
        token: grant.token,
        repositoryUrl: grant.cloneUrl,
        baseBranch: "main",
        codeHost: grant.codeHost,
        ...overrides,
      };
    }

    test("the run's token clones and pushes its branch, reaches no other project, opens nothing - OneUptime opens the merge request - and ends with the run", async () => {
      // 1. A token made for the run: never the connection's.
      const grant: CodeHostRunnerGrant = await handTheRunnerAToken();

      expect(grant.isMintedForRun).toBe(true);
      expect(grant.serverOpensPullRequest).toBe(true);
      expect(grant.token).not.toBe(CONNECTION_TOKEN);
      expect(JSON.stringify(grant)).not.toContain(CONNECTION_TOKEN);
      expect(server.gitLab.minted).toHaveLength(1);
      expect(server.gitLab.minted[0]!.scopes).toEqual(["write_repository"]);

      // 2. The Runner clones and pushes the fix's branch with it.
      const manager: RepositoryManager = new RepositoryManager();
      const clone: CloneResult = await manager.cloneRepository(
        configFor(grant),
        makeTempDir("oneuptime-gitlab-run-"),
      );

      expect(clone.baseBranch).toBe("main");

      await manager.createBranch(clone.repositoryPath, BRANCH);
      fs.writeFileSync(
        path.join(clone.repositoryPath, "src", "index.ts"),
        'export const project: string = "fixed";\n',
      );
      await manager.addAllChanges(clone.repositoryPath);
      await manager.commitChanges(clone.repositoryPath, "Fix the project");
      await manager.pushBranch(clone.repositoryPath, BRANCH, configFor(grant));

      expect(
        server.readRefs("acme/backend/checkout")[`refs/heads/${BRANCH}`],
      ).toBe(await manager.getCurrentCommitHash(clone.repositoryPath));

      // Every Git request was signed in with the run's token, never the connection's.
      for (const request of server.gitRequests) {
        expect(request.token).not.toBe(CONNECTION_TOKEN);
      }

      // Neither token reached the clone's files.
      const written: string = readAll(path.join(clone.repositoryPath, ".git"));
      expect(written).not.toContain(grant.token);
      expect(written).not.toContain(CONNECTION_TOKEN);

      // 3. It reaches no other project of the connection's account...
      await expect(
        new RepositoryManager().cloneRepository(
          configFor(grant, {
            repositoryName: "billing",
            repositoryUrl: server.cloneUrlOf("acme/backend/billing"),
          }),
          makeTempDir("oneuptime-gitlab-other-"),
        ),
      ).rejects.toThrow();

      // ...and calls no API: the Runner could not open the merge request itself.
      await expect(
        new PullRequestOpener(undefined, transport).open({
          token: {
            token: grant.token,
            expiresAt: grant.expiresAt,
            repositoryUrl: grant.cloneUrl,
            organizationName: grant.organizationName,
            repositoryName: grant.repositoryName,
            codeHost: grant.codeHost,
          },
          baseBranch: "main",
          headBranch: BRANCH,
          title: "fix",
          body: "body",
        }),
      ).rejects.toThrow("did not let the access token do this");
      expect(server.gitLab.mergeRequests).toHaveLength(0);

      // 4. OneUptime opens it, as the connection's account.
      const opened: OpenedFixPullRequest = await CodeFixPullRequestOpener.open({
        repository,
        request: {
          codeRepositoryId: REPOSITORY_ID,
          headRefName: BRANCH,
          baseRefName: "main",
          title: "fix: the project",
          body: "## Exception Fix",
        },
      });

      expect(opened.number).toBe(1);
      expect(opened.htmlUrl).toBe(
        "https://gitlab.example.com/acme/backend/checkout/-/merge_requests/1",
      );
      expect(server.gitLab.mergeRequests[0]!.authorUserId).toBe(
        server.gitLab.connectionUserId,
      );
      expect(server.gitLab.mergeRequests[0]!.authorUserId).not.toBe(
        server.gitLab.minted[0]!.botUserId,
      );

      // 5. The run ends: the token is revoked, and does nothing any more.
      expect(
        await CodeRepositoryMintedTokens.revokeForRun({
          runId: RUN_ID,
          transport,
        }),
      ).toBe(1);
      expect(server.gitLab.minted[0]!.revoked).toBe(true);

      await expect(
        new RepositoryManager().cloneRepository(
          configFor(grant),
          makeTempDir("oneuptime-gitlab-after-"),
        ),
      ).rejects.toThrow();

      fs.writeFileSync(
        path.join(clone.repositoryPath, "src", "index.ts"),
        'export const project: string = "after the run";\n',
      );
      await manager.addAllChanges(clone.repositoryPath);
      await manager.commitChanges(clone.repositoryPath, "After the run");

      await expect(
        manager.pushBranch(clone.repositoryPath, BRANCH, configFor(grant)),
      ).rejects.toThrow();

      // The merge request OneUptime opened stays: the token never wrote it.
      expect(server.gitLab.mergeRequests).toHaveLength(1);
    });
  },
);
