import { ASK_AI, CODE_PAGE } from "./AiDocsPages";
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
 * AI does in each (CodeHost's capabilities - commands are GitHub's alone,
 * production reviews every host's with pull requests, a Git server pushes
 * a branch, and on Azure DevOps has its code read too), and the words of
 * the repository's settings and of a refused token.
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

    /*
     * Forgejo and Gitea: read and write on repositories and issues - a
     * production review's comment is its pull request's issue's - and read
     * on the user.
     */
    expect(CODE_CONNECT_COPY.tokenHelpForgejo).toBe(
      "An access token with read and write access to repositories and issues, and read access to the user.",
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

    /*
     * Commands are GitHub's alone; production reviews are every host's with
     * pull requests - a Git server has none.
     */
    for (const type of Object.values(CodeRepositoryType)) {
      expect(CodeHost.can(type, CodeHostCapability.Commands)).toBe(
        type === CodeRepositoryType.GitHub,
      );
      expect(CodeHost.can(type, CodeHostCapability.ProductionReview)).toBe(
        type !== CodeRepositoryType.Git,
      );
    }

    expect(gitHub![2]).toContain("commands from GitHub");
    // GitHub's own: a check on the pull request's commit.
    expect(gitHub![2]).toContain(
      "a check on each [production review](#production-review-of-pull-requests)",
    );
    expect(section()).toContain(
      "Commands from comments need the GitHub App, so they work in GitHub repositories only, for now, and the repository's **Settings** say so. A Git server has no pull requests, so it has no production review either.",
    );
    expect(section()).not.toContain("production reviews need the GitHub App");

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
    expect(gitLab![2]).toContain(
      "[production reviews](#production-review-of-pull-requests)",
    );
    expect(gitLab![2]).toContain("a deploy's commits");
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

    /*
     * On Azure DevOps - Services, or a Server of its own - a Git
     * repository's code is read, with the credentials Git signs in with, in
     * api-version 5.0: Azure DevOps Server 2019's, which every later one
     * takes. Anywhere else, a Git repository's code is not read.
     */
    for (const repositoryUrl of [
      "https://dev.azure.com/acme/project/_git/app",
      "https://acme.visualstudio.com/project/_git/app",
      "https://tfs.example.com/tfs/DefaultCollection/project/_git/app",
      "https://tfs.example.com/DefaultCollection/project/_git/app",
    ]) {
      expect(
        CodeHost.canReadRepositoryCode({
          type: CodeRepositoryType.Git,
          repositoryUrl,
        }),
      ).toBe(true);
    }

    expect(
      CodeHost.canReadRepositoryCode({
        type: CodeRepositoryType.Git,
        repositoryUrl: "https://git.example.com/acme/app.git",
      }),
    ).toBe(false);
    expect(
      CodeHost.can(CodeRepositoryType.Git, CodeHostCapability.ReadCode),
    ).toBe(false);
    expect(
      readRepoFile(
        "Common/Server/Utils/CodeRepository/CodeHost/AzureDevOpsApi.ts",
      ),
    ).toContain('export const AZURE_DEVOPS_API_VERSION: string = "5.0";');
    expect(git![2]).toContain(
      "On Azure DevOps (Services, or Server 2019 and later), OneUptime also reads the code, with the same credentials: the code a stack trace or a profile runs through, and the files OneUptime AI reads.",
    );
    // The same words as the GitLab row's, for the same reads.
    expect(gitLab![2]).toContain(
      "the code a stack trace or a profile runs through",
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

/*
 * How OneUptime signs in to a repository on any Git server, what OneUptime
 * AI reads in one, and what a task says when the server refuses the
 * credentials (issue #6144: an Azure DevOps Server repository connected as
 * Git, whose clones failed although the connection said it worked, and
 * whose code Ask AI said was not connected at all).
 */
describe("Code: signing in to a Git server, and what AI reads in one", () => {
  function signIn(): string {
    return flat(englishSection(CODE_PAGE, "### Sign in to a Git server"));
  }

  function reads(): string {
    return flat(
      englishSection(CODE_PAGE, "### What AI reads in a Git repository"),
    );
  }

  it("checks the credentials with the request every clone starts with, before the repository connects", () => {
    const smartHttp: string = readRepoFile(
      "Common/Server/Utils/CodeRepository/CodeHost/GitSmartHttp.ts",
    );
    const connector: string = readRepoFile(
      "Common/Server/Utils/CodeRepository/CodeHost/CodeRepositoryConnector.ts",
    );

    // One request for the branches, with the credentials sent up front.
    expect(smartHttp).toContain("/info/refs?service=git-upload-pack");
    expect(smartHttp).toContain("Authorization: `Basic ${");
    expect(connector).toContain("}).getRefs();");

    expect(signIn()).toContain(
      "Unless only your own Runners reach the server, OneUptime checks them before it connects the repository, by asking the server for its branches: the request every clone starts with.",
    );
  });

  it("says a Runner sends the credentials with Git's first request, as HTTP Basic, for that server alone, and nowhere the code agent reads", () => {
    const credentials: string = flat(
      readRepoFile("Runner/Utils/GitCredentials.ts"),
    );
    const manager: string = flat(
      readRepoFile("Runner/Utils/RepositoryManager.ts"),
    );

    /*
     * An http.<origin>/.extraHeader that git reads from its environment,
     * scoped to the remote's own server, carrying HTTP Basic.
     */
    expect(credentials).toContain("GIT_CONFIG_VALUE_");
    expect(credentials).toContain("/.extraHeader`");
    expect(credentials).toContain(
      "`Authorization: ${GitCredentials.getBasicAuthorization(",
    );
    expect(credentials).toContain("return `Basic ${Buffer.from(");
    // The clone and the push both sign in so.
    expect(
      manager.split(
        "GitCredentials.create( config.token, { username: RepositoryManager.getUsername(config), remoteUrl, }, );",
      ).length - 1,
    ).toBe(2);

    expect(signIn()).toContain(
      "A Runner sends them the same way, with Git's first request to the server, as HTTP Basic, so a server that offers Windows sign-in first, such as Azure DevOps Server, takes a personal access token too.",
    );
    expect(signIn()).toContain(
      "Git is given them through its environment, for that one server: never on its command line, and never in the clone's `.git/config`, where the code agent works.",
    );
  });

  it("says OneUptime reads a Git repository's branches and not its files - but on Azure DevOps its code too - as the hosts' capabilities and the code tools have it", () => {
    const tools: string = flat(
      readRepoFile("Common/Server/Utils/AI/Toolbox/CodeTools.ts"),
    );

    expect(
      CodeHost.can(CodeRepositoryType.Git, CodeHostCapability.Branches),
    ).toBe(true);
    expect(
      CodeHost.can(CodeRepositoryType.Git, CodeHostCapability.ReadCode),
    ).toBe(false);

    for (const type of [
      CodeRepositoryType.GitHub,
      CodeRepositoryType.GitLab,
      CodeRepositoryType.Forgejo,
    ]) {
      expect(CodeHost.can(type, CodeHostCapability.ReadCode)).toBe(true);
    }

    // A Git repository on Azure DevOps has its code read; any other does not.
    expect(
      CodeHost.canReadRepositoryCode({
        type: CodeRepositoryType.Git,
        repositoryUrl:
          "https://tfs.example.com/tfs/DefaultCollection/Shop/_git/checkout",
      }),
    ).toBe(true);
    expect(
      CodeHost.canReadRepositoryCode({
        type: CodeRepositoryType.Git,
        repositoryUrl: "https://git.example.com/team/checkout.git",
      }),
    ).toBe(false);

    // What the code tools tell the model, for it to pass on.
    expect(tools).toContain(
      "files, so search_code and read_code_file cannot open",
    );
    expect(tools).toContain("A task in Code still works in");
    expect(tools).toContain(
      "GitHub, GitLab, Forgejo, Gitea and Azure DevOps repositories are read",
    );

    expect(reads()).toContain(
      "A Git server has no API to read a repository's files through, so OneUptime reads only the branches of a repository on one, for the branch picker.",
    );
    expect(reads()).toContain(
      "Azure DevOps is the exception: on Azure DevOps Services, and on Azure DevOps Server 2019 and later, OneUptime reads a repository's code too, through Azure DevOps' own API and with the same credentials.",
    );
    expect(reads()).toContain(
      "read the code of GitHub, GitLab, Forgejo, Gitea and Azure DevOps repositories; asked about another Git repository's code, they say they cannot open it.",
    );
    expect(reads()).toContain(
      "A task in Code still works in a Git repository: the Runner clones it",
    );

    // Ask AI's own page names the same hosts, and links here.
    expect(flat(englishSection(ASK_AI, "## What it can see"))).toContain(
      "the code of connected repositories on GitHub, GitLab, Forgejo, Gitea and Azure DevOps (see [What AI reads in a Git repository](/docs/ai/ai-agent#what-ai-reads-in-a-git-repository)).",
    );
  });

  it("says a refused sign-in fails the task without a second try on the default branch, and where to give new credentials", () => {
    const manager: string = flat(
      readRepoFile("Runner/Utils/RepositoryManager.ts"),
    );
    const fails: string = flat(
      englishSection(CODE_PAGE, "## When a fix fails"),
    );

    expect(manager).toContain(
      "refused the credentials OneUptime signed in with, so",
    );
    // A refused sign-in is not taken for a missing branch, so not tried again.
    expect(manager).toContain(
      "return !( error.isSignInRefusal() || error.isServerUnreachable() || error.isTimeout );",
    );
    expect(manager).toContain(
      "Check that the OneUptime GitHub App is still installed with access to the repository.",
    );
    expect(CODE_REPOSITORY_CONNECTION_COPY.replaceButton).toBe(
      "Replace access token",
    );

    expect(fails).toContain(
      ":::details The server refuses the credentials The task fails and says which server refused the credentials OneUptime signed in with, and which repository it could not clone or push its branch to. It is not tried again on the repository's default branch",
    );
    expect(fails).toContain(
      "On GitHub, check that the OneUptime GitHub App is still installed with access to the repository.",
    );
    expect(fails).toContain(
      `give it new ones with ${bold("Replace access token")} on the repository's ${bold("Settings")} page.`,
    );
  });
});
