import {
  GLOBAL_RUNNER_REPOSITORY_TOKEN_REFUSAL,
  isRepositoryKeptOffGlobalRunners,
} from "../../../Types/Runner/GlobalRunnerRepositoryTokens";
import GlobalRunnerRepositoryTokens, {
  GLOBAL_RUNNERS_CODE_FIX_GITHUB_ONLY_SETTING,
} from "../../../Server/Utils/Runner/GlobalRunnerRepositoryTokens";
import CodeRepositoryType from "../../../Types/CodeRepository/CodeRepositoryType";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * WHICH REPOSITORIES GLOBAL RUNNERS STAY OUT OF (#6115, #8915).
 *
 * A GitLab, Forgejo, Gitea or Git repository is reached with its
 * connection's own token, and none of those hosts lets OneUptime make a
 * narrower one, so where every customer's JavaScript steps run on the same
 * global Runners - OneUptime Cloud, or a self-hosted multi-tenant install
 * with GLOBAL_RUNNERS_CODE_FIX_GITHUB_ONLY on - such a repository's AI work
 * runs on a Runner of the project's own. GitHub's token is minted per run
 * for one repository and revoked when the run ends, so GitHub repositories
 * work on global Runners as before; a single-tenant self-hosted OneUptime is
 * left as it was.
 */

describe("isRepositoryKeptOffGlobalRunners", () => {
  test("where tokens are kept off global Runners, every host but GitHub", () => {
    for (const type of [
      CodeRepositoryType.GitLab,
      CodeRepositoryType.Forgejo,
      CodeRepositoryType.Git,
    ]) {
      expect(
        isRepositoryKeptOffGlobalRunners({
          repositoryHostedAt: type,
          keepConnectionTokensOffGlobalRunners: true,
        }),
      ).toBe(true);
    }

    expect(
      isRepositoryKeptOffGlobalRunners({
        repositoryHostedAt: CodeRepositoryType.GitHub,
        keepConnectionTokensOffGlobalRunners: true,
      }),
    ).toBe(false);
  });

  test("a host that cannot be read is GitHub, as every repository was before the others", () => {
    for (const repositoryHostedAt of [undefined, null, "", "Bitbucket"]) {
      expect(
        isRepositoryKeptOffGlobalRunners({
          repositoryHostedAt,
          keepConnectionTokensOffGlobalRunners: true,
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
        }),
      ).toBe(false);
    }
  });

  test("the refusal says where AI works instead, and what to do, without naming a deployment", () => {
    expect(GLOBAL_RUNNER_REPOSITORY_TOKEN_REFUSAL).toContain(
      "AI works in a GitLab, Forgejo, Gitea or Git repository on one of your own Runners",
    );
    expect(GLOBAL_RUNNER_REPOSITORY_TOKEN_REFUSAL).toContain(
      "Pick one of your Runners in the repository's settings in Code.",
    );
    // Cloud-neutral: it reads right on a self-hosted multi-tenant install too.
    expect(GLOBAL_RUNNER_REPOSITORY_TOKEN_REFUSAL).not.toContain(
      "OneUptime Cloud",
    );
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
        CodeRepositoryType.GitLab,
      ),
    ).toBe(true);

    for (const value of ["false", "", "TRUE "]) {
      process.env["BILLING_ENABLED"] = value;
      expect(
        GlobalRunnerRepositoryTokens.keepsConnectionTokensOffGlobalRunners(),
      ).toBe(false);
    }

    delete process.env["BILLING_ENABLED"];
    expect(
      GlobalRunnerRepositoryTokens.isRepositoryKeptOff(
        CodeRepositoryType.GitLab,
      ),
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
