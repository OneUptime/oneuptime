import { describe, expect, test } from "@jest/globals";
import { getBlockerCopy } from "../../../../App/FeatureSet/Dashboard/src/Components/Code/CodeBlockerNotice";
import {
  CODE_TASK_BLOCKER_FIXES,
  CODE_TASK_BLOCKER_SENTENCES,
  CODE_TASK_GITLAB_TOKEN_NOT_MINTED,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Code/CodeTaskCopy";
import {
  CODE_GLOBAL_RUNNER_GITLAB_TOKEN_NOT_MINTED_TEXT,
  CODE_GLOBAL_RUNNER_KEPT_OFF_TEXT,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Runner/RunnerPickerModel";
import { CodeTaskBlockerType } from "../../../Types/AI/CodeTask";
import CodeRepositoryType from "../../../Types/CodeRepository/CodeRepositoryType";

/*
 * Code's notice for a repository no global Runner may be handed the token of
 * (#6115, #8912), in the words its Runner picker uses: a Forgejo, Gitea or
 * Git repository's connection token is never handed to one; a GitLab
 * repository's fixes push with a token OneUptime makes for each run, so its
 * notice says GitLab refused to make one, and what to do. Either way the fix
 * is the repository's Runner setting.
 */

describe("the notice for a repository that needs one of the project's own Runners", () => {
  test("a Forgejo, Gitea or Git repository: its connection's token is never handed to a global Runner", () => {
    for (const provider of [
      CodeRepositoryType.Forgejo,
      CodeRepositoryType.Git,
      undefined,
    ]) {
      expect(
        getBlockerCopy({
          type: CodeTaskBlockerType.RepositoryTokenNeedsOwnRunner,
          provider,
        }).sentence,
      ).toBe(
        CODE_TASK_BLOCKER_SENTENCES[
          CodeTaskBlockerType.RepositoryTokenNeedsOwnRunner
        ],
      );
    }

    // The same sentence as the line under the Runner picker.
    expect(
      CODE_TASK_BLOCKER_SENTENCES[
        CodeTaskBlockerType.RepositoryTokenNeedsOwnRunner
      ],
    ).toBe(CODE_GLOBAL_RUNNER_KEPT_OFF_TEXT);
  });

  test("a GitLab repository: GitLab did not let OneUptime make a short-lived token, and the fix is still the Runner setting", () => {
    const copy: ReturnType<typeof getBlockerCopy> = getBlockerCopy({
      type: CodeTaskBlockerType.RepositoryTokenNeedsOwnRunner,
      provider: CodeRepositoryType.GitLab,
    });

    expect(copy.sentence).toBe(CODE_TASK_GITLAB_TOKEN_NOT_MINTED);
    expect(copy.fix).toBe(
      CODE_TASK_BLOCKER_FIXES[
        CodeTaskBlockerType.RepositoryTokenNeedsOwnRunner
      ],
    );

    // The same sentence as the line under the Runner picker.
    expect(CODE_TASK_GITLAB_TOKEN_NOT_MINTED).toBe(
      CODE_GLOBAL_RUNNER_GITLAB_TOKEN_NOT_MINTED_TEXT,
    );
  });

  test("every other blocker on GitLab reads as it always did", () => {
    expect(
      getBlockerCopy({
        type: CodeTaskBlockerType.NoAgent,
        provider: CodeRepositoryType.GitLab,
      }).sentence,
    ).toBe(CODE_TASK_BLOCKER_SENTENCES[CodeTaskBlockerType.NoAgent]);
  });
});
