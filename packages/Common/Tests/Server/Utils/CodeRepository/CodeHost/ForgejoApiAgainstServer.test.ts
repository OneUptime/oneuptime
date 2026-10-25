import { beforeAll, describe, expect, jest, test } from "@jest/globals";
import CodeHostHttp, {
  CodeHostHttpErrorKind,
  CodeHostHttpResponse,
} from "../../../../../Server/Utils/CodeRepository/CodeHost/CodeHostHttp";
import ForgejoApi from "../../../../../Server/Utils/CodeRepository/CodeHost/ForgejoApi";
import GitSmartHttp, {
  GitRefAdvertisement,
} from "../../../../../Server/Utils/CodeRepository/CodeHost/GitSmartHttp";
import {
  CodeHostBranch,
  CodeHostBranchNames,
  CodeHostCiSummary,
  CodeHostFileContent,
  CodeHostPullRequestState,
  CodeHostRepository,
  CodeHostRepositoryPage,
  CodeHostServerInfo,
} from "../../../../../Server/Utils/CodeRepository/CodeHost/CodeHostTypes";
import FixPullRequestCiStatus from "../../../../../Types/AI/FixPullRequestCiStatus";
import PullRequestState from "../../../../../Types/CodeRepository/PullRequestState";
import { ForgejoServerProduct } from "../../../../../Types/CodeRepository/CodeHost";
import { ForgeAdmin, TestForge, readTestForges } from "./ForgeServerSetup";

/*
 * ForgejoApi - the one client for Forgejo, Gitea and Codeberg - against a
 * real server of each, when the run names them (ForgeServerSetup): who a
 * token is, what the server says it is, the repositories a token can push
 * to (and one it can only read), branches, the tree, a file, a pull
 * request's state from open to merged, the CI on a commit, whether a
 * deploy's commit contains a fix's, and a refused token. The plain Git
 * reader (smart HTTP) is read against the same server's clone address.
 *
 * Every request goes through the unguarded transport: the servers listen
 * on 127.0.0.1, which the production transport refuses on every
 * installation (GitSmartHttp.test.ts holds that).
 */

jest.mock("axios", () => {
  return jest.requireActual("axios/dist/node/axios.cjs");
});

const FORGES: Array<TestForge> = readTestForges();

const describeEachForge: (
  name: string,
  body: (forge: TestForge) => void,
) => void = (name: string, body: (forge: TestForge) => void): void => {
  if (FORGES.length === 0) {
    describe.skip(`${name} (no CODE_HOST_TEST_FORGES)`, () => {
      test("skipped", () => {
        // Named by the run, or not at all.
      });
    });
    return;
  }

  for (const forge of FORGES) {
    describe(`${name}: ${forge.name}`, () => {
      body(forge);
    });
  }
};

describeEachForge("ForgejoApi against a real server", (forge: TestForge) => {
  const admin: ForgeAdmin = new ForgeAdmin(forge);
  const suffix: string = `${Date.now()}`;
  const repositoryName: string = `app-${suffix}`;
  const organizationName: string = `acme-${suffix}`;
  const readerUser: { name: string; password: string } = {
    name: `reader${suffix}`,
    password: "Reader-pass-123",
  };
  let token: string = "";
  let readerToken: string = "";
  let api: ForgejoApi;
  let accountId: string = "";

  const noWait: () => Promise<void> = async (): Promise<void> => {
    // No waiting in tests.
  };

  beforeAll(async () => {
    const adminUser: { name: string; password: string } = {
      name: forge.adminUser,
      password: forge.adminPassword,
    };

    token = await admin.createToken({
      user: adminUser,
      scopes: ["write:repository", "read:user"],
    });

    await admin.ok({
      method: "POST",
      path: "/user/repos",
      body: {
        name: repositoryName,
        auto_init: true,
        default_branch: "main",
        readme: "Default",
        private: true,
      },
    });

    // A branch with a change of its own, for a pull request.
    await admin.ok({
      method: "POST",
      path: `/repos/${forge.adminUser}/${repositoryName}/branches`,
      body: { new_branch_name: "feature/login", old_branch_name: "main" },
    });
    await admin.ok({
      method: "POST",
      path: `/repos/${forge.adminUser}/${repositoryName}/contents/src/login.ts`,
      body: {
        branch: "feature/login",
        message: "Log in",
        content: Buffer.from("export const login = true;\n").toString("base64"),
      },
    });

    // A repository the reader can read but not push to.
    await admin.ok({
      method: "POST",
      path: "/orgs",
      body: { username: organizationName },
    });
    await admin.ok({
      method: "POST",
      path: `/orgs/${organizationName}/repos`,
      body: { name: "readonly", auto_init: true, default_branch: "main" },
    });
    await admin.ok({
      method: "POST",
      path: "/admin/users",
      body: {
        username: readerUser.name,
        email: `${readerUser.name}@example.com`,
        password: readerUser.password,
        must_change_password: false,
      },
    });
    await admin.ok({
      method: "PUT",
      path: `/repos/${organizationName}/readonly/collaborators/${readerUser.name}`,
      body: { permission: "read" },
    });

    readerToken = await admin.createToken({
      user: readerUser,
      scopes: ["write:repository", "read:user"],
    });

    api = new ForgejoApi({
      hostUrl: forge.hostUrl,
      token,
      transport: CodeHostHttp.createUnguardedTransportForTests(),
      backOff: noWait,
    });

    accountId = (await api.getAccount()).id;
  }, 120000);

  test("says who the token is", async () => {
    const account: { login: string; name: string; id: string } =
      await api.getAccount();

    expect(account.login).toBe(forge.adminUser);
    expect(account.id).toMatch(/^\d+$/);
  });

  test("says whether it is Forgejo or Gitea, as its version does", async () => {
    const info: CodeHostServerInfo = await api.getServerInfo();

    expect(info.version).toBeTruthy();
    expect(info.product).toBe(
      forge.name === "gitea"
        ? ForgejoServerProduct.Gitea
        : ForgejoServerProduct.Forgejo,
    );
  });

  test("lists the repositories the token can push to, private ones too", async () => {
    const page: CodeHostRepositoryPage = await api.listRepositories({
      accountId,
      page: 1,
    });
    const found: CodeHostRepository | undefined = page.repositories.find(
      (repository: CodeHostRepository): boolean => {
        return repository.name === repositoryName;
      },
    );

    expect(found).toBeDefined();
    expect(found!.ownerPath).toBe(forge.adminUser);
    expect(found!.fullName).toBe(`${forge.adminUser}/${repositoryName}`);
    expect(found!.defaultBranch).toBe("main");
    expect(found!.isPrivate).toBe(true);
    expect(found!.canPush).toBe(true);
    expect(found!.cloneUrl).toBe(
      `${forge.hostUrl}/${forge.adminUser}/${repositoryName}.git`,
    );

    const searched: CodeHostRepositoryPage = await api.listRepositories({
      accountId,
      search: repositoryName,
      page: 1,
    });

    expect(
      searched.repositories.map((repository: CodeHostRepository): string => {
        return repository.name;
      }),
    ).toEqual([repositoryName]);
  });

  test("a repository the token may only read is listed as one it cannot push to", async () => {
    const reader: ForgejoApi = new ForgejoApi({
      hostUrl: forge.hostUrl,
      token: readerToken,
      transport: CodeHostHttp.createUnguardedTransportForTests(),
      backOff: noWait,
    });
    const readOnly: CodeHostRepository = await reader.getRepository(
      organizationName,
      "readonly",
    );

    expect(readOnly.canPush).toBe(false);

    // The owner's token can.
    expect(
      (await api.getRepository(organizationName, "readonly")).canPush,
    ).toBe(true);
  });

  test("reads the branches, a branch's head, the tree and a file", async () => {
    const names: CodeHostBranchNames = await api.listBranchNames({
      owner: forge.adminUser,
      name: repositoryName,
      limit: 20,
    });

    expect(names.names.sort()).toEqual(["feature/login", "main"]);
    expect(names.isComplete).toBe(true);

    const searched: CodeHostBranchNames = await api.listBranchNames({
      owner: forge.adminUser,
      name: repositoryName,
      search: "feat",
      limit: 20,
    });

    expect(searched.names).toEqual(["feature/login"]);

    const branch: CodeHostBranch | null = await api.getBranch(
      forge.adminUser,
      repositoryName,
      "feature/login",
    );

    expect(branch?.headSha).toMatch(/^[0-9a-f]{40}$/);
    expect(
      await api.getBranch(forge.adminUser, repositoryName, "no-such-branch"),
    ).toBeNull();

    const paths: Array<string> = await api.getTreePaths({
      owner: forge.adminUser,
      name: repositoryName,
      ref: "feature/login",
    });

    expect(paths.sort()).toEqual(["README.md", "src/login.ts"]);

    const file: CodeHostFileContent | null = await api.getFileContent({
      owner: forge.adminUser,
      name: repositoryName,
      ref: "feature/login",
      filePath: "src/login.ts",
    });

    expect(file?.content).toBe("export const login = true;\n");
    expect(file?.totalLines).toBe(1);
    expect(file?.htmlUrl).toContain("src/login.ts");
    expect(
      await api.getFileContent({
        owner: forge.adminUser,
        name: repositoryName,
        ref: "main",
        filePath: "src/login.ts",
      }),
    ).toBeNull();
  });

  test("follows a pull request from open to merged, and knows which commits contain the merge", async () => {
    const opened: CodeHostHttpResponse = await admin.ok({
      method: "POST",
      path: `/repos/${forge.adminUser}/${repositoryName}/pulls`,
      body: { title: "Log in", head: "feature/login", base: "main" },
    });
    const number: number = Number(
      (opened.bodyJson as Record<string, unknown>)["number"],
    );

    const open: CodeHostPullRequestState = await api.getPullRequestState({
      owner: forge.adminUser,
      name: repositoryName,
      number,
    });

    expect(open.state).toBe(PullRequestState.Open);

    const head: string = (await api.getBranch(
      forge.adminUser,
      repositoryName,
      "feature/login",
    ))!.headSha;
    const mainBefore: string = (await api.getBranch(
      forge.adminUser,
      repositoryName,
      "main",
    ))!.headSha;

    // The CI on its head, as commit statuses say it.
    await admin.ok({
      method: "POST",
      path: `/repos/${forge.adminUser}/${repositoryName}/statuses/${head}`,
      body: { state: "pending", context: "ci/test" },
    });

    const pending: CodeHostCiSummary = await api.getCiSummary({
      owner: forge.adminUser,
      name: repositoryName,
      ref: head,
    });

    expect(pending.conclusion).toBe(FixPullRequestCiStatus.Pending);

    await admin.ok({
      method: "POST",
      path: `/repos/${forge.adminUser}/${repositoryName}/statuses/${head}`,
      body: { state: "success", context: "ci/test" },
    });

    expect(
      (
        await api.getCiSummary({
          owner: forge.adminUser,
          name: repositoryName,
          ref: head,
        })
      ).conclusion,
    ).toBe(FixPullRequestCiStatus.Green);

    // Not merged yet: main does not contain the change.
    expect(
      await api.containsCommit({
        owner: forge.adminUser,
        name: repositoryName,
        commit: head,
        containing: mainBefore,
      }),
    ).toBe(false);

    /*
     * A server checks a new pull request's mergeability in the background,
     * answering "Please try again later" (405) until it has.
     */
    for (let attempt: number = 0; ; attempt++) {
      const merge: CodeHostHttpResponse = await admin.call({
        method: "POST",
        path: `/repos/${forge.adminUser}/${repositoryName}/pulls/${number}/merge`,
        body: { Do: "merge" },
      });

      if (merge.statusCode >= 200 && merge.statusCode < 300) {
        break;
      }

      if (merge.statusCode !== 405 || attempt >= 20) {
        throw new Error(
          `The merge answered ${merge.statusCode}: ${merge.bodyText.substring(0, 300)}`,
        );
      }

      await new Promise<void>((resolve: () => void): void => {
        setTimeout(resolve, 500);
      });
    }

    const merged: CodeHostPullRequestState = await api.getPullRequestState({
      owner: forge.adminUser,
      name: repositoryName,
      number,
    });

    expect(merged.state).toBe(PullRequestState.Merged);
    expect(merged.mergeCommitSha).toMatch(/^[0-9a-f]{40}$/);
    expect(merged.mergedAt).toBeInstanceOf(Date);

    const mainAfter: string = (await api.getBranch(
      forge.adminUser,
      repositoryName,
      "main",
    ))!.headSha;

    // A deploy of main now contains the fix and its merge.
    expect(
      await api.containsCommit({
        owner: forge.adminUser,
        name: repositoryName,
        commit: merged.mergeCommitSha!,
        containing: mainAfter,
      }),
    ).toBe(true);
    expect(
      await api.containsCommit({
        owner: forge.adminUser,
        name: repositoryName,
        commit: head,
        containing: mainAfter,
      }),
    ).toBe(true);
    // An older deploy does not.
    expect(
      await api.containsCommit({
        owner: forge.adminUser,
        name: repositoryName,
        commit: merged.mergeCommitSha!,
        containing: mainBefore,
      }),
    ).toBe(false);
  });

  test("a revoked or wrong token is a credential refusal that never says the token", async () => {
    const wrong: ForgejoApi = new ForgejoApi({
      hostUrl: forge.hostUrl,
      token: "0000000000000000000000000000000000000000",
      transport: CodeHostHttp.createUnguardedTransportForTests(),
      backOff: noWait,
    });

    await expect(wrong.getAccount()).rejects.toMatchObject({
      kind: CodeHostHttpErrorKind.Unauthorized,
    });
  });

  test("the plain Git reader reads the same repository over smart HTTP with the token", async () => {
    const git: GitSmartHttp = new GitSmartHttp({
      cloneUrl: `${forge.hostUrl}/${forge.adminUser}/${repositoryName}.git`,
      username: forge.adminUser,
      password: token,
      transport: CodeHostHttp.createUnguardedTransportForTests(),
      backOff: noWait,
    });
    const refs: GitRefAdvertisement = await git.getRefs();

    expect(refs.defaultBranch).toBe("main");
    expect(
      refs.branches
        .map((branch: { name: string }): string => {
          return branch.name;
        })
        .sort(),
    ).toEqual(["feature/login", "main"]);

    await expect(
      new GitSmartHttp({
        cloneUrl: `${forge.hostUrl}/${forge.adminUser}/${repositoryName}.git`,
        username: forge.adminUser,
        password: "not-the-token",
        transport: CodeHostHttp.createUnguardedTransportForTests(),
        backOff: noWait,
      }).getRefs(),
    ).rejects.toMatchObject({ kind: CodeHostHttpErrorKind.Unauthorized });
  });
});
