import { readPage } from "./DocsContentSupport";
import AIAgentDataAPI, {
  GitHubRunnerTokenScope,
} from "Common/Server/API/AIAgentDataAPI";
import CodeRepositoryMintedTokens, {
  MINTED_TOKEN_ACCESS_LEVEL,
  MINTED_TOKEN_SCOPES,
} from "Common/Server/Utils/CodeRepository/CodeHost/CodeRepositoryMintedTokens";
import {
  GLOBAL_RUNNER_GITLAB_TOKEN_NOT_MINTED_REFUSAL,
  isRepositoryKeptOffGlobalRunners,
} from "Common/Types/Runner/GlobalRunnerRepositoryTokens";
import CodeRepositoryType from "Common/Types/CodeRepository/CodeRepositoryType";
import RunnerCodeFixCapability from "Common/Types/Runner/RunnerCodeFixCapability";
import { describe, expect, it } from "@jest/globals";

/*
 * What the English docs say about the token a code fix's Runner is handed
 * (#8912, #8916), held to the code that makes it true:
 *
 *   - OneUptime opens the fix's pull request, so a GitHub repository's token
 *     reaches the one repository and pushes to it but opens no pull request
 *     (runbooks/agents, ai/ai-agent). Neither page says it pushes the fix's
 *     branch only: contents write pushes any branch the repository does not
 *     protect, as write_repository does on GitLab;
 *   - a GitLab repository's is a project access token made for the one fix:
 *     the one project, push and no API (write_repository), as a Developer,
 *     ending on its own by the end of the next day in UTC, revoked when the
 *     fix ends;
 *   - GitLab makes one only for a Maintainer's token with the api scope, on
 *     GitLab self-managed or GitLab.com Premium or Ultimate, and on OneUptime
 *     Cloud a GitLab repository works on global Runners only while it does;
 *     a Forgejo, Gitea or Git repository never does.
 *
 * The translations are held to these English pages by RunbookDocsTranslations
 * and AiDocsTranslations.
 */

const AGENTS: string = readPage("en", "runbooks/agents");
const CODE: string = readPage("en", "ai/ai-agent");

describe("the docs on the token a code fix's Runner is handed", () => {
  it("say OneUptime opens the pull request, so a GitHub repository's token opens none", () => {
    expect(AGENTS).toContain(
      "It writes each fix and pushes its branch, and OneUptime opens the pull request",
    );
    expect(AGENTS).toContain(
      "A GitHub repository's token reaches that one repository and pushes to it, but opens no pull request",
    );
    expect(CODE).toContain(
      "OneUptime opens each task's pull request itself, so the token a Runner gets for a GitHub repository reaches that one repository and pushes to it but opens no pull request",
    );

    // A token that may push pushes any branch the host does not protect.
    for (const page of [AGENTS, CODE]) {
      expect(page).not.toContain("only pushes the fix's branch");
      expect(page).not.toContain("only pushes the task's branch");
    }

    // What a Runner of this release, which says OneUptime opens it, gets.
    const scope: GitHubRunnerTokenScope =
      AIAgentDataAPI.getGitHubRunnerTokenScope({
        run: null,
        capabilities: [RunnerCodeFixCapability.ServerOpensPullRequests],
      });

    expect(scope.permissions).toEqual({ contents: "write", metadata: "read" });
    expect(scope.serverOpensPullRequest).toBe(true);
  });

  it("say a GitLab repository's is made for the one fix, pushes and calls no API, as the code makes it", () => {
    expect(AGENTS).toContain(
      "a GitLab repository's, where GitLab lets OneUptime make it, is a project access token made for that one fix, which reaches that one project, pushes and calls no API",
    );
    expect(CODE).toContain(
      "is a project access token made for that task: it reaches that one project, pushes and calls no API",
    );

    // Push and pull over Git, and no API scope at all.
    expect([...MINTED_TOKEN_SCOPES]).toEqual(["write_repository"]);
    // Developer: pushes to the branches the project does not protect.
    expect(MINTED_TOKEN_ACCESS_LEVEL).toBe(30);
  });

  it("say when it ends on its own, as the code asks GitLab", () => {
    expect(AGENTS).toContain(
      "ends on its own by the end of the next day in UTC",
    );
    expect(CODE).toContain("ends on its own by the end of the next day in UTC");

    for (const now of [
      "2026-11-16T00:00:00.000Z",
      "2026-11-16T20:59:59.000Z",
      "2026-11-16T21:00:00.000Z",
      "2026-11-16T23:59:59.000Z",
    ]) {
      const at: Date = new Date(now);
      const endOfNextDay: Date = new Date(
        Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate() + 2),
      );

      expect(
        CodeRepositoryMintedTokens.getExpiry(at).endsAt.getTime(),
      ).toBeLessThanOrEqual(endOfNextDay.getTime());
    }
  });

  it("say what GitLab needs to make one, as the refusal the product shows does", () => {
    for (const page of [AGENTS, CODE]) {
      expect(page).toContain("Maintainer role");
      expect(page).toContain(
        "GitLab self-managed or GitLab.com Premium or Ultimate",
      );
    }

    expect(GLOBAL_RUNNER_GITLAB_TOKEN_NOT_MINTED_REFUSAL).toContain(
      "Maintainer role and the api scope (GitLab self-managed, or GitLab.com Premium or Ultimate)",
    );
  });

  it("say which repositories global Runners work in on OneUptime Cloud, as the rule has it", () => {
    expect(AGENTS).toContain(
      "On OneUptime Cloud, global Runners work in GitHub and GitLab repositories only, with the token made for each fix: a Forgejo, Gitea or Git repository is reached with its connection's own token",
    );
    expect(AGENTS).toContain(
      "and so do a GitLab repository's when GitLab does not let OneUptime make that token",
    );

    const keptOff: (
      type: CodeRepositoryType,
      refusedAt?: Date | undefined,
    ) => boolean = (
      type: CodeRepositoryType,
      refusedAt?: Date | undefined,
    ): boolean => {
      return isRepositoryKeptOffGlobalRunners({
        repositoryHostedAt: type,
        keepConnectionTokensOffGlobalRunners: true,
        mintedTokenRefusedAt: refusedAt,
      });
    };

    expect(keptOff(CodeRepositoryType.GitHub)).toBe(false);
    expect(keptOff(CodeRepositoryType.GitLab)).toBe(false);
    expect(keptOff(CodeRepositoryType.GitLab, new Date())).toBe(true);
    expect(keptOff(CodeRepositoryType.Forgejo)).toBe(true);
    expect(keptOff(CodeRepositoryType.Git)).toBe(true);
  });
});
