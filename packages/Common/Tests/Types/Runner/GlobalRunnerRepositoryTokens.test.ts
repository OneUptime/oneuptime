import {
  GLOBAL_RUNNER_GITLAB_TOKEN_NOT_MINTED_REFUSAL,
  GLOBAL_RUNNER_REPOSITORY_TOKEN_REFUSAL,
  GLOBAL_RUNNER_TOO_OLD_FOR_GITLAB_REFUSAL,
  GlobalRunnerKeptOffReason,
  getGlobalRunnerKeptOffReason,
  getGlobalRunnerKeptOffRefusal,
  isRepositoryKeptOffGlobalRunners,
} from "../../../Types/Runner/GlobalRunnerRepositoryTokens";
import GlobalRunnerRepositoryTokens, {
  GLOBAL_RUNNERS_CODE_FIX_GITHUB_ONLY_SETTING,
} from "../../../Server/Utils/Runner/GlobalRunnerRepositoryTokens";
import CodeRepositoryType from "../../../Types/CodeRepository/CodeRepositoryType";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * WHICH REPOSITORIES GLOBAL RUNNERS STAY OUT OF (#6115, #8915, #8912).
 *
 * A Forgejo, Gitea or Git repository is reached with its connection's own
 * token, and neither host lets OneUptime make a narrower one, so where every
 * customer's JavaScript steps run on the same global Runners - OneUptime
 * Cloud, or a self-hosted multi-tenant install with
 * GLOBAL_RUNNERS_CODE_FIX_GITHUB_ONLY on - such a repository's AI work runs
 * on a Runner of the project's own. A GitLab repository's fixes push with a
 * project access token OneUptime makes for each run, so it works on global
 * Runners until GitLab refuses to make one (CodeRepository
 * .mintedTokenRefusedAt). GitHub's token is minted per run for one
 * repository and revoked when the run ends, so GitHub repositories work on
 * global Runners as before; a single-tenant self-hosted OneUptime is left as
 * it was.
 */

describe("isRepositoryKeptOffGlobalRunners", () => {
  test("where tokens are kept off global Runners, Forgejo, Gitea and Git", () => {
    for (const type of [CodeRepositoryType.Forgejo, CodeRepositoryType.Git]) {
      expect(
        isRepositoryKeptOffGlobalRunners({
          repositoryHostedAt: type,
          keepConnectionTokensOffGlobalRunners: true,
        }),
      ).toBe(true);
      expect(
        getGlobalRunnerKeptOffReason({
          repositoryHostedAt: type,
          keepConnectionTokensOffGlobalRunners: true,
        }),
      ).toBe(GlobalRunnerKeptOffReason.ConnectionToken);
    }

    expect(
      isRepositoryKeptOffGlobalRunners({
        repositoryHostedAt: CodeRepositoryType.GitHub,
        keepConnectionTokensOffGlobalRunners: true,
      }),
    ).toBe(false);
  });

  test("a GitLab repository only once GitLab refused to make the token its fixes push with", () => {
    expect(
      isRepositoryKeptOffGlobalRunners({
        repositoryHostedAt: CodeRepositoryType.GitLab,
        keepConnectionTokensOffGlobalRunners: true,
      }),
    ).toBe(false);
    expect(
      isRepositoryKeptOffGlobalRunners({
        repositoryHostedAt: CodeRepositoryType.GitLab,
        keepConnectionTokensOffGlobalRunners: true,
        mintedTokenRefusedAt: null,
      }),
    ).toBe(false);

    for (const refusedAt of [new Date(), "2026-11-16T10:00:00.000Z"]) {
      expect(
        getGlobalRunnerKeptOffReason({
          repositoryHostedAt: CodeRepositoryType.GitLab,
          keepConnectionTokensOffGlobalRunners: true,
          mintedTokenRefusedAt: refusedAt,
        }),
      ).toBe(GlobalRunnerKeptOffReason.TokenNotMinted);
    }

    // A refusal says nothing of a host whose token is never made.
    expect(
      getGlobalRunnerKeptOffReason({
        repositoryHostedAt: CodeRepositoryType.GitHub,
        keepConnectionTokensOffGlobalRunners: true,
        mintedTokenRefusedAt: new Date(),
      }),
    ).toBeNull();
  });

  test("a host that cannot be read is GitHub, as every repository was before the others", () => {
    for (const repositoryHostedAt of [undefined, null, "", "Bitbucket"]) {
      expect(
        isRepositoryKeptOffGlobalRunners({
          repositoryHostedAt,
          keepConnectionTokensOffGlobalRunners: true,
          mintedTokenRefusedAt: new Date(),
        }),
      ).toBe(false);
    }
  });

  test("where tokens are not kept off, none is kept off", () => {
    for (const type of Object.values(CodeRepositoryType)) {
      expect(
        isRepositoryKeptOffGlobalRunners({
          repositoryHostedAt: type,
          keepConnectionTokensOffGlobalRunners: false,
          mintedTokenRefusedAt: new Date(),
        }),
      ).toBe(false);
    }
  });

  test("each refusal says where AI works instead, and what to do, without naming a deployment", () => {
    expect(GLOBAL_RUNNER_REPOSITORY_TOKEN_REFUSAL).toContain(
      "AI works in a Forgejo, Gitea or Git repository on one of your own Runners",
    );
    expect(GLOBAL_RUNNER_REPOSITORY_TOKEN_REFUSAL).not.toContain("GitLab");
    expect(GLOBAL_RUNNER_GITLAB_TOKEN_NOT_MINTED_REFUSAL).toContain(
      "GitLab did not let OneUptime make a short-lived token for this repository",
    );
    expect(GLOBAL_RUNNER_GITLAB_TOKEN_NOT_MINTED_REFUSAL).toContain(
      "Maintainer role and the api scope",
    );
    expect(GLOBAL_RUNNER_TOO_OLD_FOR_GITLAB_REFUSAL).toContain(
      "global Runner of the latest version",
    );

    for (const refusal of [
      GLOBAL_RUNNER_REPOSITORY_TOKEN_REFUSAL,
      GLOBAL_RUNNER_GITLAB_TOKEN_NOT_MINTED_REFUSAL,
    ]) {
      expect(refusal).toContain(
        "one of your Runners in the repository's settings in Code.",
      );
      // Cloud-neutral: it reads right on a self-hosted multi-tenant install too.
      expect(refusal).not.toContain("OneUptime Cloud");
    }

    expect(
      getGlobalRunnerKeptOffRefusal(GlobalRunnerKeptOffReason.ConnectionToken),
    ).toBe(GLOBAL_RUNNER_REPOSITORY_TOKEN_REFUSAL);
    expect(
      getGlobalRunnerKeptOffRefusal(GlobalRunnerKeptOffReason.TokenNotMinted),
    ).toBe(GLOBAL_RUNNER_GITLAB_TOKEN_NOT_MINTED_REFUSAL);
  });
});

describe("GlobalRunnerRepositoryTokens, the server's reading", () => {
  let billing: string | undefined;
  let gitHubOnly: string | undefined;

  beforeEach(() => {
    billing = process.env["BILLING_ENABLED"];
    gitHubOnly = process.env[GLOBAL_RUNNERS_CODE_FIX_GITHUB_ONLY_SETTING];
    delete process.env["BILLING_ENABLED"];
    delete process.env[GLOBAL_RUNNERS_CODE_FIX_GITHUB_ONLY_SETTING];
  });

  afterEach(() => {
    restore("BILLING_ENABLED", billing);
    restore(GLOBAL_RUNNERS_CODE_FIX_GITHUB_ONLY_SETTING, gitHubOnly);
  });

  function restore(name: string, value: string | undefined): void {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }

  test("OneUptime Cloud is billing on, read when asked", () => {
    process.env["BILLING_ENABLED"] = "true";
    expect(
      GlobalRunnerRepositoryTokens.keepsConnectionTokensOffGlobalRunners(),
    ).toBe(true);
    expect(
      GlobalRunnerRepositoryTokens.isRepositoryKeptOff(
        CodeRepositoryType.Forgejo,
      ),
    ).toBe(true);
    // GitLab is kept off only once GitLab refused to make its token.
    expect(
      GlobalRunnerRepositoryTokens.isRepositoryKeptOff(
        CodeRepositoryType.GitLab,
      ),
    ).toBe(false);
    expect(
      GlobalRunnerRepositoryTokens.getKeptOffReason({
        repositoryHostedAt: CodeRepositoryType.GitLab,
        mintedTokenRefusedAt: new Date(),
      }),
    ).toBe(GlobalRunnerKeptOffReason.TokenNotMinted);

    for (const value of ["false", "", "TRUE "]) {
      process.env["BILLING_ENABLED"] = value;
      expect(
        GlobalRunnerRepositoryTokens.keepsConnectionTokensOffGlobalRunners(),
      ).toBe(false);
    }

    delete process.env["BILLING_ENABLED"];
    expect(
      GlobalRunnerRepositoryTokens.isRepositoryKeptOff({
        repositoryHostedAt: CodeRepositoryType.GitLab,
        mintedTokenRefusedAt: new Date(),
      }),
    ).toBe(false);
  });

  /*
   * #8915: a self-hosted multi-tenant install turns the rule on with
   * GLOBAL_RUNNERS_CODE_FIX_GITHUB_ONLY, billing off.
   */
  test("the self-hosted setting keeps the tokens off with billing off, and only for =true", () => {
    process.env[GLOBAL_RUNNERS_CODE_FIX_GITHUB_ONLY_SETTING] = "true";
    expect(
      GlobalRunnerRepositoryTokens.keepsConnectionTokensOffGlobalRunners(),
    ).toBe(true);
    expect(
      GlobalRunnerRepositoryTokens.isRepositoryKeptOff(
        CodeRepositoryType.Forgejo,
      ),
    ).toBe(true);
    // GitHub is unchanged either way.
    expect(
      GlobalRunnerRepositoryTokens.isRepositoryKeptOff(
        CodeRepositoryType.GitHub,
      ),
    ).toBe(false);

    for (const value of ["false", "", "1", "yes"]) {
      process.env[GLOBAL_RUNNERS_CODE_FIX_GITHUB_ONLY_SETTING] = value;
      expect(
        GlobalRunnerRepositoryTokens.keepsConnectionTokensOffGlobalRunners(),
      ).toBe(false);
    }
  });

  test("billing on or the setting on - either keeps them off", () => {
    expect(
      GlobalRunnerRepositoryTokens.keepsConnectionTokensOffGlobalRunners(),
    ).toBe(false);

    process.env["BILLING_ENABLED"] = "true";
    expect(
      GlobalRunnerRepositoryTokens.keepsConnectionTokensOffGlobalRunners(),
    ).toBe(true);

    delete process.env["BILLING_ENABLED"];
    process.env[GLOBAL_RUNNERS_CODE_FIX_GITHUB_ONLY_SETTING] = "true";
    expect(
      GlobalRunnerRepositoryTokens.keepsConnectionTokensOffGlobalRunners(),
    ).toBe(true);
  });
});
