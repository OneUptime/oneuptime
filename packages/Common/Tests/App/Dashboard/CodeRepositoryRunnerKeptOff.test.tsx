import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";

/*
 * WHERE A REPOSITORY'S RUNNER IS PICKED, ON ONEUPTIME CLOUD (#6115).
 *
 * A GitLab, Forgejo, Gitea or Git repository is reached with its
 * connection's own token, which no global Runner is ever handed on
 * OneUptime Cloud (Common/Types/Runner/GlobalRunnerRepositoryTokens). While
 * such a repository works on the Global Runner, its Runner says so - under
 * the picker, and on the settings card - in the words Code's notice uses.
 * A GitHub repository, and one on a Runner of the project's own, say
 * nothing more. OneUptime Cloud is billing on, so this suite turns it on.
 */

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (value: string): string => {
          return value;
        },
      };
    },
  };
});

jest.mock("../../../UI/Config", () => {
  return {
    ...(jest.requireActual("../../../UI/Config") as Record<string, unknown>),
    BILLING_ENABLED: true,
  };
});

import {
  CODE_REPOSITORY_RUNNER_KEPT_OFF_TEST_ID,
  CODE_REPOSITORY_RUNNER_VALUE_TEST_ID,
  CodeRepositoryRunnerValueView,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Code/CodeRepositoryRunner";
import { RunnerChoices } from "../../../../App/FeatureSet/Dashboard/src/Components/Runner/RunnerChoices";
import { CODE_GLOBAL_RUNNER_KEPT_OFF_TEXT } from "../../../../App/FeatureSet/Dashboard/src/Components/Runner/RunnerPickerModel";
import CodeRepositoryType from "../../../Types/CodeRepository/CodeRepositoryType";
import RunnerLiveStatus from "../../../Types/Runner/RunnerLiveStatus";

const OFFICE_ID: string = "6c7d8e9f-1111-4222-8333-944455556666";

function choices(): RunnerChoices {
  return {
    projectRunners: [
      {
        id: OFFICE_ID,
        name: "office-runner",
        liveStatus: RunnerLiveStatus.Connected,
      },
    ],
    globalRunners: [
      {
        id: "00000000-0000-0000-0000-000000000002",
        name: "Global Runner",
        description: "",
        liveStatus: RunnerLiveStatus.Connected,
        runsRunbooks: true,
        takesCodeFixes: true,
      },
    ],
    projectUsesGlobalRunners: true,
  } as unknown as RunnerChoices;
}

afterEach(() => {
  cleanup();
});

describe("a repository's Runner on OneUptime Cloud", () => {
  test.each([
    CodeRepositoryType.GitLab,
    CodeRepositoryType.Forgejo,
    CodeRepositoryType.Git,
  ])(
    "a %s repository on the Global Runner says it needs one of the project's Runners, in amber",
    (provider: CodeRepositoryType) => {
      render(
        <CodeRepositoryRunnerValueView
          runnerId={null}
          provider={provider}
          choices={choices()}
        />,
      );

      const line: HTMLElement = screen.getByTestId(
        CODE_REPOSITORY_RUNNER_KEPT_OFF_TEST_ID,
      );

      expect(line).toHaveTextContent(CODE_GLOBAL_RUNNER_KEPT_OFF_TEXT);
      expect(line.className).toContain("text-amber-700");
      expect(
        screen.getByTestId(CODE_REPOSITORY_RUNNER_VALUE_TEST_ID),
      ).toHaveTextContent("Global Runner");
    },
  );

  test("a GitHub repository on the Global Runner says nothing more", () => {
    render(
      <CodeRepositoryRunnerValueView
        runnerId={null}
        provider={CodeRepositoryType.GitHub}
        choices={choices()}
      />,
    );

    expect(
      screen.queryByTestId(CODE_REPOSITORY_RUNNER_KEPT_OFF_TEST_ID),
    ).not.toBeInTheDocument();
  });

  test("a GitLab repository on a Runner of the project's own says nothing more", () => {
    render(
      <CodeRepositoryRunnerValueView
        runnerId={OFFICE_ID}
        provider={CodeRepositoryType.GitLab}
        choices={choices()}
      />,
    );

    expect(
      screen.getByTestId(CODE_REPOSITORY_RUNNER_VALUE_TEST_ID),
    ).toHaveTextContent("office-runner");
    expect(
      screen.queryByTestId(CODE_REPOSITORY_RUNNER_KEPT_OFF_TEST_ID),
    ).not.toBeInTheDocument();
  });
});
