import {
  GLOBAL_RUNNER_REPOSITORY_TOKEN_REFUSAL,
  isRepositoryKeptOffGlobalRunners,
} from "../../../Types/Runner/GlobalRunnerRepositoryTokens";
import GlobalRunnerRepositoryTokens from "../../../Server/Utils/Runner/GlobalRunnerRepositoryTokens";
import CodeRepositoryType from "../../../Types/CodeRepository/CodeRepositoryType";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * WHICH REPOSITORIES GLOBAL RUNNERS STAY OUT OF (#6115).
 *
 * A GitLab, Forgejo, Gitea or Git repository is reached with its
 * connection's own token, and none of those hosts lets OneUptime make a
 * narrower one, so on OneUptime Cloud - where every customer's JavaScript
 * steps run on the same global Runners - such a repository's AI work runs
 * on a Runner of the project's own. GitHub's token is minted per run for
 * one repository and revoked when the run ends, so GitHub repositories work
 * on global Runners as before; a self-hosted OneUptime is left as it was.
 */

describe("isRepositoryKeptOffGlobalRunners", () => {
  test("on OneUptime Cloud, every host but GitHub", () => {
    for (const type of [
      CodeRepositoryType.GitLab,
      CodeRepositoryType.Forgejo,
      CodeRepositoryType.Git,
    ]) {
      expect(
        isRepositoryKeptOffGlobalRunners({
          repositoryHostedAt: type,
          isOneUptimeCloud: true,
        }),
      ).toBe(true);
    }

    expect(
      isRepositoryKeptOffGlobalRunners({
        repositoryHostedAt: CodeRepositoryType.GitHub,
        isOneUptimeCloud: true,
      }),
    ).toBe(false);
  });

  test("a host that cannot be read is GitHub, as every repository was before the others", () => {
    for (const repositoryHostedAt of [undefined, null, "", "Bitbucket"]) {
      expect(
        isRepositoryKeptOffGlobalRunners({
          repositoryHostedAt,
          isOneUptimeCloud: true,
        }),
      ).toBe(false);
    }
  });

  test("a self-hosted OneUptime keeps none off", () => {
    for (const type of Object.values(CodeRepositoryType)) {
      expect(
        isRepositoryKeptOffGlobalRunners({
          repositoryHostedAt: type,
          isOneUptimeCloud: false,
        }),
      ).toBe(false);
    }
  });

  test("the refusal says where AI works instead, and what to do", () => {
    expect(GLOBAL_RUNNER_REPOSITORY_TOKEN_REFUSAL).toContain("OneUptime Cloud");
    expect(GLOBAL_RUNNER_REPOSITORY_TOKEN_REFUSAL).toContain(
      "Pick one of your Runners in the repository's settings in Code.",
    );
  });
});

describe("GlobalRunnerRepositoryTokens, the server's reading", () => {
  let saved: string | undefined;

  beforeEach(() => {
    saved = process.env["BILLING_ENABLED"];
  });

  afterEach(() => {
    if (saved === undefined) {
      delete process.env["BILLING_ENABLED"];
    } else {
      process.env["BILLING_ENABLED"] = saved;
    }
  });

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
});
