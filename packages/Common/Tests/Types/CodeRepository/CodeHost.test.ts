import { describe, expect, test } from "@jest/globals";
import {
  CODE_HOST_FACTS,
  CodeHost,
  CodeHostCapability,
  CodeHostConnectMethod,
  CodeHostUrl,
  CodeHostUrlError,
  CodeHostWebFlavor,
  ForgejoServerProduct,
  GitRemoteAddress,
} from "../../../Types/CodeRepository/CodeHost";
import CodeRepositoryType from "../../../Types/CodeRepository/CodeRepositoryType";

/*
 * Where a repository can be hosted, and what Code can do there: one table
 * the server, the Runner, the Dashboard and the docs read.
 */

describe("what each host can do", () => {
  test("GitHub does everything; GitLab and Forgejo all but commands from comments; a Git server only branches", () => {
    const can: (type: CodeRepositoryType) => Array<CodeHostCapability> = (
      type: CodeRepositoryType,
    ): Array<CodeHostCapability> => {
      return Object.values(CodeHostCapability).filter(
        (capability: CodeHostCapability): boolean => {
          return CodeHost.can(type, capability);
        },
      );
    };

    expect(can(CodeRepositoryType.GitHub).sort()).toEqual(
      Object.values(CodeHostCapability).sort(),
    );

    for (const type of [
      CodeRepositoryType.GitLab,
      CodeRepositoryType.Forgejo,
    ]) {
      // Their pull (merge) requests are reviewed against production too.
      expect(can(type).sort()).toEqual(
        [
          CodeHostCapability.PullRequests,
          CodeHostCapability.PullRequestTracking,
          CodeHostCapability.Branches,
          CodeHostCapability.ReadCode,
          CodeHostCapability.ProductionReview,
        ].sort(),
      );
    }

    expect(can(CodeRepositoryType.Git)).toEqual([CodeHostCapability.Branches]);
  });

  test("each host connects its own way, and names its pull requests its own way", () => {
    expect(CODE_HOST_FACTS[CodeRepositoryType.GitHub].connectMethod).toBe(
      CodeHostConnectMethod.GitHubApp,
    );
    expect(CODE_HOST_FACTS[CodeRepositoryType.GitLab].connectMethod).toBe(
      CodeHostConnectMethod.AccessToken,
    );
    expect(CODE_HOST_FACTS[CodeRepositoryType.Forgejo].connectMethod).toBe(
      CodeHostConnectMethod.AccessToken,
    );
    expect(CODE_HOST_FACTS[CodeRepositoryType.Git].connectMethod).toBe(
      CodeHostConnectMethod.GitCredentials,
    );

    expect(CODE_HOST_FACTS[CodeRepositoryType.GitLab].pullRequestTerm).toBe(
      "merge request",
    );
    expect(CODE_HOST_FACTS[CodeRepositoryType.Forgejo].pullRequestTerm).toBe(
      "pull request",
    );

    expect(CodeHost.usesAccessToken(CodeRepositoryType.GitLab)).toBe(true);
    expect(CodeHost.usesAccessToken(CodeRepositoryType.Forgejo)).toBe(true);
    expect(CodeHost.usesAccessToken(CodeRepositoryType.Git)).toBe(false);
    expect(CodeHost.usesAccessToken(CodeRepositoryType.GitHub)).toBe(false);

    expect(CodeHost.usesConnection(CodeRepositoryType.GitHub)).toBe(false);
    for (const type of [
      CodeRepositoryType.GitLab,
      CodeRepositoryType.Forgejo,
      CodeRepositoryType.Git,
    ]) {
      expect(CodeHost.usesConnection(type)).toBe(true);
    }
  });

  test("every fact is keyed by its own type", () => {
    for (const type of Object.values(CodeRepositoryType)) {
      expect(CODE_HOST_FACTS[type].type).toBe(type);
    }
  });

  test("a stored or sent provider it does not know reads as GitHub, as every repository was before", () => {
    expect(CodeHost.readType(undefined)).toBe(CodeRepositoryType.GitHub);
    expect(CodeHost.readType(null)).toBe(CodeRepositoryType.GitHub);
    expect(CodeHost.readType("Bitbucket")).toBe(CodeRepositoryType.GitHub);
    expect(CodeHost.readType("GitLab")).toBe(CodeRepositoryType.GitLab);
    expect(CodeHost.readType("Git")).toBe(CodeRepositoryType.Git);

    expect(CodeHost.isKnownType("Forgejo")).toBe(true);
    expect(CodeHost.isKnownType("forgejo")).toBe(false);
    expect(CodeHost.isKnownType(1)).toBe(false);
  });

  test("Forgejo writes +gitea into its version; Gitea does not", () => {
    expect(CodeHost.readForgejoServerProduct("9.0.1+gitea-1.22.0")).toBe(
      ForgejoServerProduct.Forgejo,
    );
    expect(CodeHost.readForgejoServerProduct("1.22.3")).toBe(
      ForgejoServerProduct.Gitea,
    );
    expect(CodeHost.readForgejoServerProduct(undefined)).toBe(
      ForgejoServerProduct.Gitea,
    );
  });
});

describe("a repository's web pages", () => {
  const branch: string = "oneuptime/fix-42";

  test("a file at its line, on each host's own pages", () => {
    expect(
      CodeHost.getFileWebUrl({
        type: CodeRepositoryType.GitHub,
        webUrl: "https://github.com/acme/app/",
        branchName: "main",
        path: "src/a b.ts",
        lineNumber: 12,
      }),
    ).toBe("https://github.com/acme/app/blob/main/src/a%20b.ts#L12");
    expect(
      CodeHost.getFileWebUrl({
        type: CodeRepositoryType.GitLab,
        webUrl: "https://gitlab.com/acme/backend/app",
        branchName: "main",
        path: "src/app.ts",
      }),
    ).toBe("https://gitlab.com/acme/backend/app/-/blob/main/src/app.ts");
    expect(
      CodeHost.getFileWebUrl({
        type: CodeRepositoryType.Forgejo,
        webUrl: "https://codeberg.org/acme/app",
        branchName: "release/1.0",
        path: "src/app.ts",
        lineNumber: 3,
      }),
    ).toBe(
      "https://codeberg.org/acme/app/src/branch/release/1.0/src/app.ts#L3",
    );
    // A Git server on a known service: its pages; any other: none.
    expect(
      CodeHost.getFileWebUrl({
        type: CodeRepositoryType.Git,
        webUrl: "https://bitbucket.org/acme/app",
        branchName: "main",
        path: "src/app.ts",
        lineNumber: 9,
      }),
    ).toBe("https://bitbucket.org/acme/app/src/main/src/app.ts#lines-9");
    expect(
      CodeHost.getFileWebUrl({
        type: CodeRepositoryType.Git,
        webUrl: "https://git.example.com/acme/app",
        branchName: "main",
        path: "src/app.ts",
      }),
    ).toBeNull();
    expect(
      CodeHost.getFileWebUrl({
        type: CodeRepositoryType.GitLab,
        webUrl: null,
        branchName: "main",
        path: "src/app.ts",
      }),
    ).toBeNull();
  });

  test("a branch's page", () => {
    expect(
      CodeHost.getBranchWebUrl({
        type: CodeRepositoryType.GitLab,
        webUrl: "https://gitlab.example.com/acme/app",
        branchName: branch,
      }),
    ).toBe("https://gitlab.example.com/acme/app/-/tree/oneuptime/fix-42");
    expect(
      CodeHost.getBranchWebUrl({
        type: CodeRepositoryType.Forgejo,
        webUrl: "https://git.example.com/acme/app",
        branchName: branch,
      }),
    ).toBe("https://git.example.com/acme/app/src/branch/oneuptime/fix-42");
    expect(
      CodeHost.getBranchWebUrl({
        type: CodeRepositoryType.Git,
        webUrl: "https://dev.azure.com/acme/project/_git/app",
        branchName: branch,
      }),
    ).toBe(
      "https://dev.azure.com/acme/project/_git/app?version=GBoneuptime%2Ffix-42",
    );
    expect(
      CodeHost.getBranchWebUrl({
        type: CodeRepositoryType.Git,
        webUrl: "https://git.example.com/acme/app",
        branchName: branch,
      }),
    ).toBeNull();
  });

  test("where a person opens the pull request of a pushed branch, into the branch it started from", () => {
    expect(
      CodeHost.getNewPullRequestWebUrl({
        type: CodeRepositoryType.GitHub,
        webUrl: "https://github.com/acme/app",
        branchName: branch,
        baseBranchName: "main",
      }),
    ).toBe(
      "https://github.com/acme/app/compare/main...oneuptime/fix-42?expand=1",
    );
    expect(
      CodeHost.getNewPullRequestWebUrl({
        type: CodeRepositoryType.GitLab,
        webUrl: "https://gitlab.com/acme/app",
        branchName: branch,
        baseBranchName: "main",
      }),
    ).toBe(
      "https://gitlab.com/acme/app/-/merge_requests/new?merge_request%5Bsource_branch%5D=oneuptime%2Ffix-42&merge_request%5Btarget_branch%5D=main",
    );
    expect(
      CodeHost.getNewPullRequestWebUrl({
        type: CodeRepositoryType.Forgejo,
        webUrl: "https://codeberg.org/acme/app",
        branchName: branch,
        baseBranchName: "main",
      }),
    ).toBe("https://codeberg.org/acme/app/compare/main...oneuptime/fix-42");
    expect(
      CodeHost.getNewPullRequestWebUrl({
        type: CodeRepositoryType.Git,
        webUrl: "https://bitbucket.org/acme/app",
        branchName: branch,
        baseBranchName: "main",
      }),
    ).toBe(
      "https://bitbucket.org/acme/app/pull-requests/new?source=oneuptime%2Ffix-42&dest=main",
    );
    expect(
      CodeHost.getNewPullRequestWebUrl({
        type: CodeRepositoryType.Git,
        webUrl: "https://acme.visualstudio.com/project/_git/app",
        branchName: branch,
      }),
    ).toBe(
      "https://acme.visualstudio.com/project/_git/app/pullrequestcreate?sourceRef=oneuptime%2Ffix-42",
    );
    expect(
      CodeHost.getNewPullRequestWebUrl({
        type: CodeRepositoryType.Git,
        webUrl: "https://git.example.com/acme/app",
        branchName: branch,
        baseBranchName: "main",
      }),
    ).toBeNull();
    expect(
      CodeHost.getNewPullRequestWebUrl({
        type: CodeRepositoryType.GitLab,
        webUrl: "https://gitlab.com/acme/app",
        branchName: "",
      }),
    ).toBeNull();
  });

  test("a Git server's pages are known only for the public services OneUptime names", () => {
    expect(
      CodeHost.getWebFlavor(CodeRepositoryType.Git, "https://github.com/a/b"),
    ).toBe(CodeHostWebFlavor.GitHub);
    expect(
      CodeHost.getWebFlavor(CodeRepositoryType.Git, "https://gitlab.com/a/b"),
    ).toBe(CodeHostWebFlavor.GitLab);
    expect(
      CodeHost.getWebFlavor(CodeRepositoryType.Git, "https://codeberg.org/a/b"),
    ).toBe(CodeHostWebFlavor.Forgejo);
    expect(
      CodeHost.getWebFlavor(
        CodeRepositoryType.Git,
        "https://gitlab.example.com/a/b",
      ),
    ).toBeNull();
    // A typed host is its own flavor, wherever it runs.
    expect(
      CodeHost.getWebFlavor(
        CodeRepositoryType.GitLab,
        "https://gitlab.example.com/a/b",
      ),
    ).toBe(CodeHostWebFlavor.GitLab);
  });
});

describe("a server's address, as a person types it", () => {
  test("is kept as https, its host lowercased, its install path kept, with no trailing slash", () => {
    expect(CodeHostUrl.normalizeHostUrl("GitLab.Example.com/")).toBe(
      "https://gitlab.example.com",
    );
    expect(CodeHostUrl.normalizeHostUrl("https://git.example.com/forge/")).toBe(
      "https://git.example.com/forge",
    );
    expect(CodeHostUrl.normalizeHostUrl("  https://codeberg.org  ")).toBe(
      "https://codeberg.org",
    );
  });

  test("drops the API's own path, pasted from the host's docs", () => {
    expect(CodeHostUrl.normalizeHostUrl("https://gitlab.com/api/v4")).toBe(
      "https://gitlab.com",
    );
    expect(
      CodeHostUrl.normalizeHostUrl("https://git.example.com/gitea/api/v1/"),
    ).toBe("https://git.example.com/gitea");
  });

  test("refuses credentials in the address, plain http unless allowed, and what is not a web address", () => {
    expect(() => {
      return CodeHostUrl.normalizeHostUrl("https://user:secret@gitlab.com");
    }).toThrow(CodeHostUrlError);
    expect(() => {
      return CodeHostUrl.normalizeHostUrl("http://gitlab.internal");
    }).toThrow(CodeHostUrlError);
    expect(
      CodeHostUrl.normalizeHostUrl("http://gitlab.internal", {
        allowHttp: true,
      }),
    ).toBe("http://gitlab.internal");
    expect(() => {
      return CodeHostUrl.normalizeHostUrl("ftp://gitlab.com");
    }).toThrow(CodeHostUrlError);
    expect(() => {
      return CodeHostUrl.normalizeHostUrl("   ");
    }).toThrow("Enter the server's address.");
    expect(() => {
      return CodeHostUrl.normalizeHostUrl(`https://a.com/${"x".repeat(3000)}`);
    }).toThrow("That address is too long.");
  });
});

describe("a Git repository's address, as a person pastes it", () => {
  test("is read into its clone address, its page and its organization and name", () => {
    const address: GitRemoteAddress = CodeHostUrl.readGitRemoteUrl(
      "https://Git.Example.com/team/sub/app.git",
    );

    expect(address).toEqual({
      cloneUrl: "https://git.example.com/team/sub/app.git",
      webUrl: "https://git.example.com/team/sub/app",
      origin: "https://git.example.com",
      host: "git.example.com",
      organizationName: "team/sub",
      repositoryName: "app",
      username: null,
    });

    // A username in the address is kept as the username, never a password.
    expect(
      CodeHostUrl.readGitRemoteUrl("https://deploy@bitbucket.org/acme/app.git")
        .username,
    ).toBe("deploy");
  });

  test("refuses SSH in every form, with what to use instead", () => {
    for (const address of [
      "ssh://git@git.example.com/team/app.git",
      "git://git.example.com/team/app.git",
      "git@git.example.com:team/app.git",
    ]) {
      expect(() => {
        return CodeHostUrl.readGitRemoteUrl(address);
      }).toThrow("OneUptime connects Git repositories over HTTPS.");
    }
  });

  test("refuses a password, a query or a fragment, and a path that names no repository", () => {
    expect(() => {
      return CodeHostUrl.readGitRemoteUrl(
        "https://deploy:secret@git.example.com/team/app.git",
      );
    }).toThrow("Leave the password out of the address.");
    expect(() => {
      return CodeHostUrl.readGitRemoteUrl(
        "https://git.example.com/team/app.git?ref=main",
      );
    }).toThrow(CodeHostUrlError);
    expect(() => {
      return CodeHostUrl.readGitRemoteUrl("https://git.example.com/");
    }).toThrow(CodeHostUrlError);
    // A dot segment is resolved as git and every browser resolve it.
    expect(
      CodeHostUrl.readGitRemoteUrl("https://git.example.com/team/../app.git")
        .cloneUrl,
    ).toBe("https://git.example.com/app.git");
    expect(() => {
      return CodeHostUrl.readGitRemoteUrl("https://git.example.com/team/.git");
    }).toThrow("The address needs the repository's name at its end.");
    expect(() => {
      return CodeHostUrl.readGitRemoteUrl("http://git.internal/team/app.git");
    }).toThrow(CodeHostUrlError);
    expect(
      CodeHostUrl.readGitRemoteUrl("http://git.internal/team/app.git", {
        allowHttp: true,
      }).cloneUrl,
    ).toBe("http://git.internal/team/app.git");
  });

  test("encodes a path segment by segment, keeping the slashes", () => {
    expect(CodeHostUrl.encodePath("a b/c#d")).toBe("a%20b/c%23d");
    expect(CodeHostUrl.trimTrailingSlashes("a///")).toBe("a");
    expect(CodeHostUrl.getHostName("https://GitLab.com/x")).toBe("gitlab.com");
    expect(CodeHostUrl.getHostName("not an address")).toBe("");
  });
});
