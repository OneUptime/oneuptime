import { CODE_PAGE } from "./AiDocsPages";
import {
  bold,
  englishPage,
  englishSection,
  readRepoFile,
  tableWithHeader,
} from "./InventoryAndApiDocsSupport";
import {
  CODE_CONNECT_COPY,
  CODE_HOST_CHOICES_IN_ORDER,
  CODE_HOST_CHOICE_COPY,
  CODE_REPOSITORY_CONNECTION_COPY,
} from "../../../FeatureSet/Dashboard/src/Components/Code/CodeHostCopy";
import {
  CODE_HOST_FACTS,
  CodeHost,
  CodeHostCapability,
} from "Common/Types/CodeRepository/CodeHost";
import CodeRepositoryType from "Common/Types/CodeRepository/CodeRepositoryType";
import { describe, expect, it } from "@jest/globals";

/*
 * Code's "Connect a repository" section, held to the product: the four
 * places a repository can be, in the order the connect dialog offers them
 * (CodeHostChoices), what each connects with (the dialog's own help), what
 * AI does in each (CodeHost's capabilities - commands and production
 * reviews are GitHub's alone, a Git server pushes a branch), and the words
 * of the repository's settings and of a refused token.
 */

const SECTION: string = "## Connect a repository";

// One line of text: a page's paragraph or a source's statement, unwrapped.
function flat(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function section(): string {
  return flat(englishSection(CODE_PAGE, SECTION));
}

function rows(): Array<Array<string>> {
  return tableWithHeader(
    englishSection(CODE_PAGE, SECTION),
    "Where the code is",
  );
}

describe("Code: Connect a repository", () => {
  it("lists the four places a repository can be, in the order the connect dialog offers them, by the dialog's own names", () => {
    expect(CODE_HOST_CHOICES_IN_ORDER).toEqual([
      CodeRepositoryType.GitHub,
      CodeRepositoryType.GitLab,
      CodeRepositoryType.Forgejo,
      CodeRepositoryType.Git,
    ]);

    const firstCells: Array<string> = rows().map(
      (row: Array<string>): string => {
        return row[0] as string;
      },
    );

    expect(firstCells).toHaveLength(CODE_HOST_CHOICES_IN_ORDER.length);

    CODE_HOST_CHOICES_IN_ORDER.forEach(
      (provider: CodeRepositoryType, index: number): void => {
        expect(firstCells[index]).toContain(
          bold(CODE_HOST_CHOICE_COPY[provider].title),
        );
      },
    );
  });

  it("names the token each host asks for in the dialog's words", () => {
    const [, gitLab, forgejo, git] = rows() as Array<Array<string>>;

    // GitLab: the scopes and the role the token step's help names.
    expect(CODE_CONNECT_COPY.tokenHelpGitLab).toContain("api");
    expect(CODE_CONNECT_COPY.tokenHelpGitLab).toContain("write_repository");
    expect(CODE_CONNECT_COPY.tokenHelpGitLab).toContain("Developer role");
    expect(gitLab![1]).toContain("`api` and `write_repository` scopes");
    expect(gitLab![1]).toContain("at least the Developer role");

    // Forgejo and Gitea: read and write on repositories, read on the user.
    expect(CODE_CONNECT_COPY.tokenHelpForgejo).toBe(
      "An access token with read and write access to repositories, and read access to the user.",
    );
    expect(forgejo![1]).toBe(CODE_CONNECT_COPY.tokenHelpForgejo);

    // Any Git server: the HTTPS clone address, a username, a password or token.
    expect(CODE_CONNECT_COPY.gitUrlHelp).toBe(
      "The HTTPS address you clone it with.",
    );
    expect(CODE_CONNECT_COPY.gitPasswordTitle).toBe("Password or access token");
    expect(git![1]).toContain("The address you clone the repository with");
    expect(git![1]).toContain("a password or access token");
  });

  it("says what AI does on each host as CodeHost's capabilities have it", () => {
    const [gitHub, gitLab, forgejo, git] = rows() as Array<Array<string>>;

    // Commands and production reviews are GitHub's alone.
    for (const type of Object.values(CodeRepositoryType)) {
      const isGitHub: boolean = type === CodeRepositoryType.GitHub;

      expect(CodeHost.can(type, CodeHostCapability.Commands)).toBe(isGitHub);
      expect(CodeHost.can(type, CodeHostCapability.ProductionReview)).toBe(
        isGitHub,
      );
    }

    expect(gitHub![2]).toContain("commands from GitHub");
    expect(gitHub![2]).toContain("production reviews");
    expect(section()).toContain(
      "Commands from comments and production reviews need the GitHub App, so they work in GitHub repositories only, for now",
    );

    // GitLab and Forgejo: pull (merge) requests, branches, code, tracking.
    for (const type of [
      CodeRepositoryType.GitLab,
      CodeRepositoryType.Forgejo,
    ]) {
      for (const capability of [
        CodeHostCapability.PullRequests,
        CodeHostCapability.PullRequestTracking,
        CodeHostCapability.Branches,
        CodeHostCapability.ReadCode,
      ]) {
        expect(CodeHost.can(type, capability)).toBe(true);
      }
    }

    expect(CODE_HOST_FACTS[CodeRepositoryType.GitLab].pullRequestTerm).toBe(
      "merge request",
    );
    expect(gitLab![2]).toContain("each change in a merge request");
    expect(gitLab![2]).toContain("the branch picker");
    expect(gitLab![2]).toContain(
      "the code a stack trace or a profile runs through",
    );
    expect(gitLab![2]).toContain("whether a fix merged");
    expect(forgejo![2]).toContain("each change in a pull request");

    // A Git server: a pushed branch, no pull request of OneUptime's.
    expect(
      CodeHost.can(CodeRepositoryType.Git, CodeHostCapability.PullRequests),
    ).toBe(false);
    expect(git![2]).toContain("pushes each change to a new branch");
    expect(git![2]).toContain("you open the pull request");

    // Where a Git server's pull request is opened: Bitbucket and Azure DevOps.
    expect(
      CodeHost.getNewPullRequestWebUrl({
        type: CodeRepositoryType.Git,
        webUrl: "https://bitbucket.org/acme/app",
        branchName: "oneuptime/fix",
        baseBranchName: "main",
      }),
    ).toBe(
      "https://bitbucket.org/acme/app/pull-requests/new?source=oneuptime%2Ffix&dest=main",
    );
    expect(
      CodeHost.getNewPullRequestWebUrl({
        type: CodeRepositoryType.Git,
        webUrl: "https://dev.azure.com/acme/project/_git/app",
        branchName: "oneuptime/fix",
      }),
    ).toContain("/pullrequestcreate?sourceRef=");
    expect(
      CodeHost.getNewPullRequestWebUrl({
        type: CodeRepositoryType.Git,
        webUrl: "https://git.example.com/acme/app",
        branchName: "oneuptime/fix",
      }),
    ).toBeNull();
    expect(git![2]).toContain(
      "On Bitbucket and Azure DevOps it links to where you open it.",
    );
  });

  it("names the public servers the token step fills in", () => {
    expect(CODE_HOST_FACTS[CodeRepositoryType.GitLab].defaultHostUrl).toBe(
      "https://gitlab.com",
    );
    expect(CODE_HOST_FACTS[CodeRepositoryType.Forgejo].defaultHostUrl).toBe(
      "https://codeberg.org",
    );
    expect(section()).toContain("(GitLab.com and Codeberg are filled in)");
  });

  it("says the list offers only what the token can push to, as the dialog draws it", () => {
    const dialog: string = readRepoFile(
      "App/FeatureSet/Dashboard/src/Components/Code/CodeConnectFlow.ts",
    );

    expect(dialog).toContain("canPush");
    expect(section()).toContain(
      "the list offers only those the token can push to",
    );
  });

  it("names Replace access token and Token refused as the settings draw them", () => {
    expect(CODE_REPOSITORY_CONNECTION_COPY.replaceButton).toBe(
      "Replace access token",
    );
    expect(CODE_REPOSITORY_CONNECTION_COPY.tokenRefused).toBe("Token refused");
    expect(section()).toContain(bold("Replace access token"));
    expect(section()).toContain(bold("Token refused"));
    // The server keeps a token's last characters, never the token itself.
    expect(
      readRepoFile("Common/Server/Services/CodeRepositoryConnectionService.ts"),
    ).toContain("public static getCredentialHint(token: string): string {");
    expect(section()).toContain("the token's last characters");
  });

  it("connects a server OneUptime Cloud cannot reach with the dialog's Connect anyway, for a Runner of the project's own", () => {
    const connector: string = readRepoFile(
      "Common/Server/Utils/CodeRepository/CodeHost/CodeRepositoryConnector.ts",
    );
    const gate: string = readRepoFile(
      "Common/Server/Utils/AI/CodeTask/CodeTaskGate.ts",
    );
    const guard: string = readRepoFile("Runner/Utils/GitHostGuard.ts");
    const private_: string = flat(
      englishSection(CODE_PAGE, "### A Git server on a private network"),
    );

    expect(CODE_CONNECT_COPY.gitConnectAnywayButton).toBe("Connect anyway");
    expect(connector).toContain("needsConfirmation");
    expect(gate).toContain("CodeTaskBlockerType.RepositoryNeedsOwnRunner");
    // A global Runner reaches a private network only where the server may.
    expect(guard).toContain("codeHost?.isPrivateNetworkAllowed === true");
    expect(private_).toContain(bold("Connect anyway"));
    expect(private_).toContain("A global Runner never works in it");
    expect(private_).toContain(
      "A self-hosted OneUptime, and its global Runner, reach the Git servers of its own network.",
    );
  });

  it("no longer says GitLab is on the roadmap", () => {
    expect(englishPage(CODE_PAGE)).not.toContain("## On the roadmap");
    expect(englishPage(CODE_PAGE)).not.toContain("GitLab support.");
  });
});
