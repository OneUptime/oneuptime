import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import "@testing-library/jest-dom";
import fs from "fs";
import path from "path";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import React, { ReactElement } from "react";
import { I18nextProvider, initReactI18next } from "react-i18next";
import AIRunStatus from "../../../Types/AI/AIRunStatus";
import CodeFixTaskType from "../../../Types/AI/CodeFixTaskType";
import {
  CodeTaskListKind,
  CodeTaskOriginJSON,
  CodeTaskOriginType,
  CodeTaskRepositoryJSON,
  CodeTaskState,
  CodeTaskSummaryJSON,
  CodeTaskTurnJSON,
} from "../../../Types/AI/CodeTask";
import Route from "../../../Types/API/Route";
import CodeRepositoryType from "../../../Types/CodeRepository/CodeRepositoryType";
import {
  ProductionReviewOperationMatch,
  ProductionReviewPosting,
  ProductionReviewReport,
  ProductionReviewTrigger,
  ProductionReviewWhere,
} from "../../../Types/CodeRepository/ProductionReview";
import ObjectID from "../../../Types/ObjectID";
import Navigation from "../../../UI/Utils/Navigation";
import englishLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/en.json";
import germanLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/de.json";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { goTo, PROJECT_ID } from "./SideMenuHarness";

/*
 * Production reviews off GitHub, in the Dashboard - GitLab's merge
 * requests, Forgejo's and Gitea's pull requests - drawn for real over a
 * stand-in for the Code API (Components/Code/CodeApi):
 *
 *  - Review a pull request (CodeProductionReviewAsk): the button beside the
 *    list's heading on a repository's Production Reviews page, and its
 *    dialog, which asks for one number as the host writes it ("#12",
 *    GitLab's "!12"), sends it as a number and opens the review's page;
 *    what the server refuses is said in the dialog, which keeps what was
 *    typed. Every host asks this way: GitLab, Forgejo and Gitea read no
 *    command.
 *  - the repository's Production Reviews page on each host, in its words:
 *    GitLab's merge requests; a connection that stopped working; someone
 *    who may only read; a Git server, which has no pull requests.
 *  - a review's page off GitHub: the merge request, the host's mark, what
 *    the merge request shows of it, what never leaves OneUptime in the
 *    host's name, and a comment the host would not let the token post.
 *  - a review's row: "MR !15" on GitLab.
 *  - German.
 */

const getRepositoryMock: MockFunction = getJestMockFunction();
const listTasksMock: MockFunction = getJestMockFunction();
const getTaskMock: MockFunction = getJestMockFunction();
const reviewAgainMock: MockFunction = getJestMockFunction();
const reviewPullRequestMock: MockFunction = getJestMockFunction();

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Code/CodeApi",
  () => {
    return {
      __esModule: true,
      CODE_TASK_API_PATH: "/code-task",
      default: {
        getRepository: (...args: Array<unknown>) => {
          return getRepositoryMock(...args);
        },
        listTasks: (...args: Array<unknown>) => {
          return listTasksMock(...args);
        },
        getTask: (...args: Array<unknown>) => {
          return getTaskMock(...args);
        },
        reviewAgain: (...args: Array<unknown>) => {
          return reviewAgainMock(...args);
        },
        reviewPullRequest: (...args: Array<unknown>) => {
          return reviewPullRequestMock(...args);
        },
      },
    };
  },
);

import CodeProductionReviewAsk, {
  CODE_PRODUCTION_REVIEW_ASK_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Code/CodeProductionReviewAsk";
import CodeProductionReviewTask from "../../../../App/FeatureSet/Dashboard/src/Components/Code/CodeProductionReviewTask";
import {
  PRODUCTION_REVIEW_ASK_COPY,
  PRODUCTION_REVIEW_COPY,
  PRODUCTION_REVIEW_MERGE_REQUEST_COPY,
  getProductionReviewReconnect,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Code/CodeProductionReviewCopy";
import { CODE_REPOSITORY_CONNECTION_COPY } from "../../../../App/FeatureSet/Dashboard/src/Components/Code/CodeHostCopy";
import { CodeTaskResponse } from "../../../../App/FeatureSet/Dashboard/src/Components/Code/CodeApi";
import { CodeTaskRow } from "../../../../App/FeatureSet/Dashboard/src/Components/Code/CodeTaskList";
import { getCodeTaskTrail } from "../../../../App/FeatureSet/Dashboard/src/Components/Code/CodeTaskTrail";
import Link from "../../../Types/Link";
import { createTranslator } from "../../../UI/Utils/TranslateTemplate";
import CodeRepositoryProductionReviews, {
  CODE_PRODUCTION_REVIEWS_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Code/Repository/ProductionReviews";

const REPOSITORY_ID: string = "6c7d8e9f-0a1b-4c2d-9e3f-4a5b6c7d8e9f";
const TASK_ID: string = "7d8e9f0a-1b2c-4d3e-8f4a-5b6c7d8e9f0a";
const ASKED_TASK_ID: string = "8e9f0a1b-2c3d-4e4f-9a5b-6c7d8e9f0a1b";
const SERVICE_ID: string = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const EXCEPTION_ID: string = "3c4d5e6f-7a8b-4c9d-8e0f-2a3b4c5d6e7f";
const HEAD_SHA: string = "4f2a9c1e8b7d6a5f4e3d2c1b0a9f8e7d6c5b4a39";
const MERGE_REQUEST_URL: string =
  "https://gitlab.com/acme/billing-service/-/merge_requests/15";
const NOTE_URL: string = `${MERGE_REQUEST_URL}#note_2001`;
const FORGEJO_PULL_URL: string =
  "https://codeberg.org/acme/status-widgets/pulls/7";
const SETTINGS_PATH: string = `/dashboard/${PROJECT_ID}/code/repositories/${REPOSITORY_ID}/settings`;

const translation: i18n = createInstance();

beforeAll(async () => {
  Element.prototype.scrollIntoView = (): void => {};
  await translation.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: { en: { translation: englishLocale } },
    interpolation: { escapeValue: false },
  });
});

beforeEach(() => {
  for (const mock of [
    getRepositoryMock,
    listTasksMock,
    getTaskMock,
    reviewAgainMock,
    reviewPullRequestMock,
  ]) {
    mock.mockReset();
  }
  jest.spyOn(Navigation, "navigate").mockImplementation((() => {}) as never);
  process.env["GITHUB_APP_NAME"] = "OneUptime";
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  delete process.env["GITHUB_APP_NAME"];
});

const PAGE_PROPS: {
  pageRoute: Route;
  currentProject: null;
  hasPaymentMethod: boolean;
} = {
  pageRoute: new Route("/"),
  currentProject: null,
  hasPaymentMethod: true,
};

function draw(element: ReactElement, with18n: i18n = translation): void {
  render(<I18nextProvider i18n={with18n}>{element}</I18nextProvider>);
}

async function german(): Promise<i18n> {
  const instance: i18n = createInstance();

  await instance.use(initReactI18next).init({
    lng: "de",
    fallbackLng: "en",
    resources: {
      en: { translation: englishLocale },
      de: { translation: germanLocale },
    },
    interpolation: { escapeValue: false },
  });

  return instance;
}

function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60 * 1000).toISOString();
}

interface Host {
  provider: CodeRepositoryType;
  hostProduct?: string;
}

const GITLAB: Host = { provider: CodeRepositoryType.GitLab };
const FORGEJO: Host = {
  provider: CodeRepositoryType.Forgejo,
  hostProduct: "Forgejo",
};
const GITEA: Host = {
  provider: CodeRepositoryType.Forgejo,
  hostProduct: "Gitea",
};
const GIT: Host = { provider: CodeRepositoryType.Git };

// A repository as Code's reads answer it, on a host, through its connection.
function repositoryJSON(
  host: Host,
  data: {
    isConnected?: boolean;
    isProductionReviewEnabled?: boolean;
    /*
     * Not connected because its server refused the token (the default for
     * a repository not connected), or because its connection is gone.
     */
    isTokenRefused?: boolean;
  } = {},
): CodeTaskRepositoryJSON {
  return {
    id: REPOSITORY_ID,
    name: "billing-service",
    organizationName: "acme",
    repositoryName: "billing-service",
    mainBranchName: "main",
    isConnected: data.isConnected ?? true,
    isProductionReviewEnabled: data.isProductionReviewEnabled ?? true,
    provider: host.provider,
    connection: {
      hostUrl:
        host.provider === CodeRepositoryType.GitLab
          ? "https://gitlab.com"
          : "https://codeberg.org",
      ...(host.hostProduct ? { hostProduct: host.hostProduct } : {}),
      accountLogin: "ada",
      credentialHint: "x7Kq",
      isTokenRefused: data.isTokenRefused ?? data.isConnected === false,
      isReachableFromServer: true,
    },
  };
}

// The origin a review is stamped with: GitLab's "!15", the others' "#7".
function originOf(host: Host): CodeTaskOriginJSON {
  return host.provider === CodeRepositoryType.GitLab
    ? {
        type: CodeTaskOriginType.GitLabMergeRequest,
        label: "!15",
        url: MERGE_REQUEST_URL,
      }
    : {
        type: CodeTaskOriginType.CodeHostPullRequest,
        label: "#7",
        url: FORGEJO_PULL_URL,
      };
}

// A review of GitLab's merge request !15 (or Forgejo's #7) that found something.
function report(
  host: Host,
  data: Partial<ProductionReviewReport> = {},
): ProductionReviewReport {
  const isGitLab: boolean = host.provider === CodeRepositoryType.GitLab;

  return {
    pullRequest: {
      number: isGitLab ? 15 : 7,
      title: "Charge VAT on reverse-charge invoices",
      url: isGitLab ? MERGE_REQUEST_URL : FORGEJO_PULL_URL,
      authorLogin: "grace",
      headSha: HEAD_SHA,
      baseRefName: "main",
      isFromFork: false,
      isAuthorTrusted: true,
    },
    reviewedAt: minutesAgo(8),
    trigger: ProductionReviewTrigger.PullRequestChanged,
    changedFileCount: 2,
    codeFileCount: 2,
    services: [
      { id: SERVICE_ID, name: "billing-api", requestCount: 4210, p99Ms: 320 },
    ],
    exceptions: [
      {
        exceptionId: EXCEPTION_ID,
        type: "LedgerMismatchError",
        serviceId: SERVICE_ID,
        serviceName: "billing-api",
        path: "src/invoices/vat.ts",
        line: 41,
        functionName: "applyVat",
        where: ProductionReviewWhere.ChangedLine,
        occurrences: 38,
        isWindowCount: true,
        lastSeenAt: minutesAgo(25),
        isUnhandled: false,
        isNew: false,
      },
    ],
    operations: [
      {
        name: "POST /api/invoices",
        serviceId: SERVICE_ID,
        serviceName: "billing-api",
        path: "src/invoices/vat.ts",
        matchedBy: ProductionReviewOperationMatch.Route,
        requestCount: 4100,
        errorCount: 12,
        p95Ms: 280,
      },
    ],
    hotFunctions: [],
    incidents: { total: 0, open: 0, items: [] },
    suspectDeploys: [],
    points: [
      {
        text: "`applyVat()` threw `LedgerMismatchError` 38 times this week, at the line this change edits.",
      },
    ],
    unreadSections: [],
    posting: ProductionReviewPosting.Review,
    isPublicRepository: false,
    commentUrl: isGitLab ? NOTE_URL : `${FORGEJO_PULL_URL}#issuecomment-31`,
    ...data,
  };
}

function summary(
  host: Host,
  data: Partial<CodeTaskSummaryJSON> = {},
): CodeTaskSummaryJSON {
  return {
    id: TASK_ID,
    title: "Charge VAT on reverse-charge invoices",
    recipe: CodeFixTaskType.GitHubPullRequestProductionReview,
    state: CodeTaskState.Done,
    isQueued: false,
    createdAt: minutesAgo(120),
    lastActivityAt: minutesAgo(8),
    origin: originOf(host),
    turnCount: 1,
    codeRepositoryId: REPOSITORY_ID,
    ...data,
  };
}

function turn(
  host: Host,
  data: Partial<CodeTaskTurnJSON> = {},
): CodeTaskTurnJSON {
  return {
    runId: TASK_ID,
    recipe: CodeFixTaskType.GitHubPullRequestProductionReview,
    status: AIRunStatus.Completed,
    state: CodeTaskState.Done,
    createdAt: minutesAgo(120),
    startedAt: minutesAgo(9),
    completedAt: minutesAgo(8),
    steps: [],
    pullRequests: [],
    needsInput: false,
    outcome: {
      summary: "Production review: 1 exception and 1 operation.",
      filesChanged: [],
      productionReview: report(host),
    },
    ...data,
  };
}

function taskAnswer(
  host: Host,
  data: {
    report?: ProductionReviewReport | null;
    isConnected?: boolean;
    isProductionReviewEnabled?: boolean;
    canAsk?: boolean;
    title?: string;
  } = {},
): CodeTaskResponse {
  const reviewed: ProductionReviewReport | null =
    data.report === undefined ? report(host) : data.report;

  return {
    task: summary(host, data.title === undefined ? {} : { title: data.title }),
    turns: [
      turn(host, {
        outcome: reviewed
          ? {
              summary: "Production review.",
              filesChanged: [],
              productionReview: reviewed,
            }
          : undefined,
      }),
    ],
    repository: repositoryJSON(host, {
      ...(data.isConnected === undefined
        ? {}
        : { isConnected: data.isConnected }),
      ...(data.isProductionReviewEnabled === undefined
        ? {}
        : { isProductionReviewEnabled: data.isProductionReviewEnabled }),
    }),
    canAsk: data.canAsk ?? true,
    canSeeChanges: true,
    canReadLogContent: true,
    blocker: null,
  };
}

function drawTask(data: CodeTaskResponse, with18n: i18n = translation): void {
  draw(
    <CodeProductionReviewTask
      data={data}
      onReviewAgain={(): void => {}}
      isAskingAgain={false}
    />,
    with18n,
  );
}

// The dialog Review a pull request opens, with its field and its Review now.
interface AskDialog {
  dialog: HTMLElement;
  input: HTMLElement;
  submit: HTMLElement;
}

function openAsk(): AskDialog {
  fireEvent.click(screen.getByTestId(CODE_PRODUCTION_REVIEW_ASK_TEST_ID));
  const dialog: HTMLElement = screen.getByRole("dialog");

  return {
    dialog,
    input: within(dialog).getByTestId("code-production-review-ask-number"),
    submit: within(dialog).getByTestId("modal-footer-submit-button"),
  };
}

function type(input: HTMLElement, value: string): void {
  fireEvent.change(input, { target: { value } });
}

describe("Review a pull request: any of the repository's pull requests, by its number", () => {
  beforeEach(() => {
    goTo(
      `/dashboard/${PROJECT_ID}/code/repositories/${REPOSITORY_ID}/production-reviews`,
    );
  });

  test("on GitHub: a button, then a dialog that asks for the pull request's number - Review now waits for one", () => {
    draw(
      <CodeProductionReviewAsk
        repositoryId={REPOSITORY_ID}
        provider={CodeRepositoryType.GitHub}
      />,
    );

    const button: HTMLElement = screen.getByTestId(
      CODE_PRODUCTION_REVIEW_ASK_TEST_ID,
    );
    expect(button).toHaveTextContent("Review a pull request");
    expect(button).toHaveAttribute("type", "button");
    // Nothing is asked of anyone until the button is pressed.
    expect(screen.queryByRole("dialog")).toBeNull();

    const { dialog, input, submit } = openAsk();
    expect(within(dialog).getByTestId("modal-title")).toHaveTextContent(
      "Review a pull request",
    );
    // The field is named, and its name is its label.
    const label: Element | null = dialog.querySelector(
      "label[for='code-production-review-ask-number']",
    );
    expect(label).toHaveTextContent("Pull request number");
    expect(input).toHaveAttribute("id", "code-production-review-ask-number");
    expect(dialog).toHaveTextContent(
      "Any open pull request in this repository, even one from a fork or a bot.",
    );
    // The field's help describes it to a screen reader too.
    const help: HTMLElement | null = dialog.querySelector(
      "#code-production-review-ask-number-help",
    );
    expect(help).toHaveTextContent(
      "Any open pull request in this repository, even one from a fork or a bot.",
    );
    expect(input.getAttribute("aria-describedby")).toContain(
      "code-production-review-ask-number-help",
    );
    // A phone offers its number keys.
    expect(input).toHaveAttribute("inputmode", "numeric");
    expect(input).toHaveAttribute("autocomplete", "off");
    expect(input).toHaveAttribute("spellcheck", "false");

    // "Review now": it starts a review, it does not show one.
    expect(submit).toHaveTextContent("Review now");
    expect(submit).toBeDisabled();

    // Anything but one whole number from 1, of at most nine digits, waits.
    for (const typed of [
      "",
      "   ",
      "abc",
      "0",
      "#",
      "!",
      "#0",
      "12a",
      "1.5",
      "-3",
      "+12",
      "1e3",
      "##12",
      "1234567890",
    ]) {
      type(input, typed);
      expect(submit).toBeDisabled();
    }

    // As the host writes it, or not.
    for (const typed of ["12", "#12", "!12", " 12 ", "# 12", "123456789"]) {
      type(input, typed);
      expect(submit).toBeEnabled();
    }

    expect(reviewPullRequestMock).not.toHaveBeenCalled();
  });

  test("on GitLab: a merge request, in GitLab's words", () => {
    draw(
      <CodeProductionReviewAsk
        repositoryId={REPOSITORY_ID}
        provider={CodeRepositoryType.GitLab}
      />,
    );

    expect(
      screen.getByTestId(CODE_PRODUCTION_REVIEW_ASK_TEST_ID),
    ).toHaveTextContent("Review a merge request");

    const { dialog, submit } = openAsk();
    expect(within(dialog).getByTestId("modal-title")).toHaveTextContent(
      "Review a merge request",
    );
    expect(
      dialog.querySelector("label[for='code-production-review-ask-number']"),
    ).toHaveTextContent("Merge request number");
    expect(dialog).toHaveTextContent(
      "Any open merge request in this repository, even one from a fork or a bot.",
    );
    expect(dialog).not.toHaveTextContent("pull request");
    expect(submit).toHaveTextContent("Review now");
  });

  test("Forgejo and Gitea say pull request, as GitHub does", () => {
    for (const host of [FORGEJO, GITEA]) {
      draw(
        <CodeProductionReviewAsk
          repositoryId={REPOSITORY_ID}
          provider={host.provider}
        />,
      );

      expect(
        screen.getByTestId(CODE_PRODUCTION_REVIEW_ASK_TEST_ID),
      ).toHaveTextContent("Review a pull request");
      const { dialog } = openAsk();
      expect(dialog).toHaveTextContent("Pull request number");

      cleanup();
    }
  });

  test("the number is sent as a number, and the review's page opens", async () => {
    reviewPullRequestMock.mockResolvedValue(ASKED_TASK_ID as never);

    draw(
      <CodeProductionReviewAsk
        repositoryId={REPOSITORY_ID}
        provider={CodeRepositoryType.GitLab}
      />,
    );

    const { input, submit } = openAsk();
    type(input, " !18 ");
    fireEvent.click(submit);

    await waitFor(() => {
      expect(Navigation.navigate).toHaveBeenCalledTimes(1);
    });
    expect(reviewPullRequestMock).toHaveBeenCalledTimes(1);
    expect(reviewPullRequestMock.mock.calls[0]![0]).toEqual({
      repositoryId: REPOSITORY_ID,
      number: 18,
    });
    expect(
      (
        Navigation.navigate as unknown as MockFunction
      ).mock.calls[0]![0]!.toString(),
    ).toBe(`/dashboard/${PROJECT_ID}/code/tasks/${ASKED_TASK_ID}`);
  });

  test("Enter asks too - but only with a number", async () => {
    reviewPullRequestMock.mockResolvedValue(ASKED_TASK_ID as never);

    draw(
      <CodeProductionReviewAsk
        repositoryId={REPOSITORY_ID}
        provider={CodeRepositoryType.GitHub}
      />,
    );

    const { input } = openAsk();
    type(input, "next week");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(reviewPullRequestMock).not.toHaveBeenCalled();

    type(input, "#64");
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      expect(Navigation.navigate).toHaveBeenCalledTimes(1);
    });
    expect(reviewPullRequestMock.mock.calls[0]![0]).toEqual({
      repositoryId: REPOSITORY_ID,
      number: 64,
    });
  });

  test("what the server refuses is said in the dialog, which keeps the number - and the next ask goes through", async () => {
    reviewPullRequestMock.mockRejectedValueOnce(
      new Error("There is no merge request !99 in this repository.") as never,
    );
    reviewPullRequestMock.mockResolvedValueOnce(ASKED_TASK_ID as never);

    draw(
      <CodeProductionReviewAsk
        repositoryId={REPOSITORY_ID}
        provider={CodeRepositoryType.GitLab}
      />,
    );

    const { dialog, input, submit } = openAsk();
    type(input, "!99");
    fireEvent.click(submit);

    expect(await within(dialog).findByTestId("modal-error")).toHaveTextContent(
      "There is no merge request !99 in this repository.",
    );
    expect(input).toHaveValue("!99");
    expect(Navigation.navigate).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(
        within(screen.getByRole("dialog")).getByTestId(
          "modal-footer-submit-button",
        ),
      ).toBeEnabled();
    });

    type(input, "!18");
    fireEvent.click(
      within(screen.getByRole("dialog")).getByTestId(
        "modal-footer-submit-button",
      ),
    );

    await waitFor(() => {
      expect(Navigation.navigate).toHaveBeenCalledTimes(1);
    });
    expect(reviewPullRequestMock.mock.calls[1]![0]).toEqual({
      repositoryId: REPOSITORY_ID,
      number: 18,
    });
  });

  test("asked once: pressing again while the ask is on its way sends nothing more", async () => {
    let answer!: (taskId: string) => void;
    reviewPullRequestMock.mockReturnValue(
      new Promise<string>((resolve: (taskId: string) => void) => {
        answer = resolve;
      }) as never,
    );

    draw(
      <CodeProductionReviewAsk
        repositoryId={REPOSITORY_ID}
        provider={CodeRepositoryType.GitHub}
      />,
    );

    const { input, submit } = openAsk();
    type(input, "12");
    fireEvent.click(submit);
    fireEvent.click(
      within(screen.getByRole("dialog")).getByTestId(
        "modal-footer-submit-button",
      ),
    );
    fireEvent.keyDown(input, { key: "Enter" });

    expect(reviewPullRequestMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      answer(ASKED_TASK_ID);
    });
    expect(Navigation.navigate).toHaveBeenCalledTimes(1);
  });

  test("closed and opened again: the refusal is gone, the number kept", async () => {
    reviewPullRequestMock.mockRejectedValue(
      new Error(
        "The merge request is closed, so it was not reviewed.",
      ) as never,
    );

    draw(
      <CodeProductionReviewAsk
        repositoryId={REPOSITORY_ID}
        provider={CodeRepositoryType.GitLab}
      />,
    );

    const first: AskDialog = openAsk();
    type(first.input, "!7");
    fireEvent.click(first.submit);
    expect(
      await within(first.dialog).findByTestId("modal-error"),
    ).toHaveTextContent("The merge request is closed, so it was not reviewed.");

    fireEvent.click(
      within(first.dialog).getByTestId("modal-footer-close-button"),
    );
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });

    const again: AskDialog = openAsk();
    expect(within(again.dialog).queryByTestId("modal-error")).toBeNull();
    expect(again.input).toHaveValue("!7");
    expect(again.submit).toBeEnabled();
  });

  test("what can never be a number is said under the field - in the host's words - and never for a lone # or ! on its way to one", () => {
    draw(
      <CodeProductionReviewAsk
        repositoryId={REPOSITORY_ID}
        provider={CodeRepositoryType.GitHub}
      />,
    );

    const { dialog, input, submit } = openAsk();

    // Nothing typed, or only the mark a number is written after: no word.
    for (const typed of ["", "  ", "#", "!", "\uFF03", "\uFF01", " # "]) {
      type(input, typed);
      expect(within(dialog).queryByTestId("error-message")).toBeNull();
      expect(input).not.toHaveAttribute("aria-invalid");
      expect(submit).toBeDisabled();
    }

    // Typed, and no number: said at once, the field marked as wrong.
    for (const typed of ["abc", "12a", "0", "-3", "1.5", "1234567890"]) {
      type(input, typed);
      const hint: HTMLElement = within(dialog).getByTestId("error-message");
      expect(hint).toHaveTextContent(
        "Enter the number of a pull request, such as 12.",
      );
      expect(input).toHaveAttribute("aria-invalid", "true");
      expect(input.getAttribute("aria-describedby")).toContain(hint.id);
      // The field's help is still read with it.
      expect(input.getAttribute("aria-describedby")).toContain(
        "code-production-review-ask-number-help",
      );
      expect(submit).toBeDisabled();
    }

    // A number takes the word away again.
    type(input, "#12");
    expect(within(dialog).queryByTestId("error-message")).toBeNull();
    expect(submit).toBeEnabled();
    expect(reviewPullRequestMock).not.toHaveBeenCalled();

    // GitLab's merge request.
    cleanup();
    draw(
      <CodeProductionReviewAsk
        repositoryId={REPOSITORY_ID}
        provider={CodeRepositoryType.GitLab}
      />,
    );
    const gitLab: AskDialog = openAsk();
    type(gitLab.input, "next");
    expect(
      within(gitLab.dialog).getByTestId("error-message"),
    ).toHaveTextContent("Enter the number of a merge request, such as 12.");
  });

  test("digits as a Persian keyboard or a Japanese input method types them are a number too, sent as one", async () => {
    reviewPullRequestMock.mockResolvedValue(ASKED_TASK_ID as never);

    draw(
      <CodeProductionReviewAsk
        repositoryId={REPOSITORY_ID}
        provider={CodeRepositoryType.GitLab}
      />,
    );

    const { dialog, input, submit } = openAsk();

    type(input, "\u0021\u06F1\u06F8");
    expect(within(dialog).queryByTestId("error-message")).toBeNull();
    expect(submit).toBeEnabled();

    type(input, "\uFF03\uFF11\uFF18");
    expect(within(dialog).queryByTestId("error-message")).toBeNull();
    expect(submit).toBeEnabled();
    fireEvent.click(submit);

    await waitFor(() => {
      expect(Navigation.navigate).toHaveBeenCalledTimes(1);
    });
    expect(reviewPullRequestMock.mock.calls[0]![0]).toEqual({
      repositoryId: REPOSITORY_ID,
      number: 18,
    });
  });

  test("every sentence it says is a Dashboard sentence, in both hosts' words", () => {
    const english: Record<string, string> = englishLocale as unknown as Record<
      string,
      string
    >;

    for (const sentence of Object.values(PRODUCTION_REVIEW_ASK_COPY)) {
      expect(english[sentence]).toBe(sentence);
    }

    for (const sentence of [
      PRODUCTION_REVIEW_ASK_COPY.button,
      PRODUCTION_REVIEW_ASK_COPY.numberTitle,
      PRODUCTION_REVIEW_ASK_COPY.numberDescription,
      PRODUCTION_REVIEW_ASK_COPY.numberHint,
    ]) {
      const merged: string | undefined =
        PRODUCTION_REVIEW_MERGE_REQUEST_COPY[sentence];
      expect(merged).toBeDefined();
      expect(english[merged!]).toBe(merged);
    }

    // Review now is no host's word: it is the same on every host.
    expect(
      PRODUCTION_REVIEW_MERGE_REQUEST_COPY[PRODUCTION_REVIEW_ASK_COPY.submit],
    ).toBeUndefined();
  });
});

describe("a repository's Production Reviews, off GitHub", () => {
  beforeEach(() => {
    goTo(
      `/dashboard/${PROJECT_ID}/code/repositories/${REPOSITORY_ID}/production-reviews`,
    );
    jest
      .spyOn(Navigation, "getLastParamAsObjectID")
      .mockReturnValue(new ObjectID(REPOSITORY_ID));
  });

  function repositoryAnswer(
    host: Host,
    data: {
      isProductionReviewEnabled?: boolean;
      isConnected?: boolean;
      isTokenRefused?: boolean;
      canAsk?: boolean;
    } = {},
  ): Record<string, unknown> {
    return {
      repository: repositoryJSON(host, {
        ...(data.isConnected === undefined
          ? {}
          : { isConnected: data.isConnected }),
        ...(data.isTokenRefused === undefined
          ? {}
          : { isTokenRefused: data.isTokenRefused }),
        ...(data.isProductionReviewEnabled === undefined
          ? {}
          : { isProductionReviewEnabled: data.isProductionReviewEnabled }),
      }),
      stats: {
        working: 0,
        waitingForYou: 0,
        openPullRequests: 0,
        taskCount: 0,
      },
      canAsk: data.canAsk ?? true,
      blocker: null,
    };
  }

  function listAnswer(
    tasks: Array<CodeTaskSummaryJSON>,
  ): Record<string, unknown> {
    return { tasks, count: tasks.length, skip: 0, limit: 20 };
  }

  test("GitLab, on: merge requests - each reviewed as it changes, anyone else's asked for here, never by a command - and Review a merge request beside the list's heading", async () => {
    getRepositoryMock.mockResolvedValue(repositoryAnswer(GITLAB) as never);
    listTasksMock.mockResolvedValue(
      listAnswer([
        summary(GITLAB, {
          productionReview: {
            hasSignal: true,
            exceptionCount: 1,
            operationCount: 1,
            hotFunctionCount: 0,
            incidentCount: 0,
            suspectDeployCount: 0,
            headSha: HEAD_SHA,
            reviewedAt: minutesAgo(8),
            posting: ProductionReviewPosting.Review,
          },
        }),
      ]) as never,
    );

    draw(<CodeRepositoryProductionReviews {...PAGE_PROPS} />);

    const page: HTMLElement = await screen.findByTestId(
      CODE_PRODUCTION_REVIEWS_TEST_ID,
    );
    expect(page).toHaveTextContent(
      "OneUptime reviews merge requests against what production shows of the code they change, posts each review on its merge request and keeps it here.",
    );

    const status: HTMLElement = screen.getByTestId(
      "code-production-reviews-status",
    );
    expect(status).toHaveAttribute("data-production-review", "on");
    expect(status).toHaveTextContent(
      "A merge request from someone with write access is reviewed when it opens and each time it changes.",
    );
    expect(
      within(status).getByTestId("code-production-reviews-status-others"),
    ).toHaveTextContent(
      "A merge request from anyone else is reviewed only when someone asks for it here.",
    );
    // GitLab reads no command: none is offered, drawn as code or not.
    expect(page.querySelector("code")).toBeNull();
    expect(page).not.toHaveTextContent("@oneuptime");
    expect(
      within(status).getByTestId("code-production-reviews-settings"),
    ).toHaveTextContent("Change in Settings");

    const list: HTMLElement = screen.getByTestId(
      "code-production-reviews-list",
    );
    expect(within(list).getByRole("heading")).toHaveTextContent(
      /^Merge Requests/,
    );
    // Beside the list's heading, for those who may ask.
    expect(
      within(list).getByTestId(CODE_PRODUCTION_REVIEW_ASK_TEST_ID),
    ).toHaveTextContent("Review a merge request");

    const row: HTMLElement = await screen.findByTestId("code-task-row");
    expect(row).toHaveTextContent("Charge VAT on reverse-charge invoices");
    expect(
      within(row).getByTestId("code-task-row-reviewed-pull-request"),
    ).toHaveTextContent("MR !15");
    expect(row).toHaveTextContent("1 exception");

    await waitFor(() => {
      expect(listTasksMock).toHaveBeenCalled();
    });
    expect(listTasksMock.mock.calls[0]![0]).toMatchObject({
      scope: { repositoryId: REPOSITORY_ID },
      kind: CodeTaskListKind.ProductionReviews,
    });
    // Nothing on the page names a pull request: GitLab's word is merge request.
    expect(page).not.toHaveTextContent(/pull request/i);
  });

  test("GitLab, off: merge requests are reviewed only when someone asks for one here - Turn on in Settings, and the empty list in GitLab's words", async () => {
    getRepositoryMock.mockResolvedValue(
      repositoryAnswer(GITLAB, { isProductionReviewEnabled: false }) as never,
    );
    listTasksMock.mockResolvedValue(listAnswer([]) as never);

    draw(<CodeRepositoryProductionReviews {...PAGE_PROPS} />);

    const status: HTMLElement = await screen.findByTestId(
      "code-production-reviews-status",
    );
    expect(status).toHaveAttribute("data-production-review", "off");
    expect(status).toHaveTextContent(
      "Merge requests are reviewed only when someone asks for one here.",
    );
    expect(
      screen.queryByTestId("code-production-reviews-status-others"),
    ).toBeNull();
    expect(
      within(status).getByTestId("code-production-reviews-settings"),
    ).toHaveTextContent("Turn on in Settings");
    // Off, a merge request can still be asked for.
    expect(
      screen.getByTestId(CODE_PRODUCTION_REVIEW_ASK_TEST_ID),
    ).toHaveTextContent("Review a merge request");

    const empty: HTMLElement = await screen.findByTestId(
      "code-production-reviews-empty",
    );
    expect(empty).toHaveTextContent("No merge request reviewed yet");
    expect(empty).toHaveTextContent(
      "Each merge request's latest review shows up here.",
    );
  });

  test("Forgejo and Gitea: pull requests, as GitHub says - asked for here, never by a command", async () => {
    for (const host of [FORGEJO, GITEA]) {
      getRepositoryMock.mockResolvedValue(repositoryAnswer(host) as never);
      listTasksMock.mockResolvedValue(listAnswer([]) as never);

      draw(<CodeRepositoryProductionReviews {...PAGE_PROPS} />);

      const status: HTMLElement = await screen.findByTestId(
        "code-production-reviews-status",
      );
      expect(status).toHaveTextContent(
        "A pull request from someone with write access is reviewed when it opens and each time it changes.",
      );
      expect(
        within(status).getByTestId("code-production-reviews-status-others"),
      ).toHaveTextContent(
        "A pull request from anyone else is reviewed only when someone asks for it here.",
      );
      expect(
        screen
          .getByTestId(CODE_PRODUCTION_REVIEWS_TEST_ID)
          .querySelector("code"),
      ).toBeNull();
      expect(
        within(screen.getByTestId("code-production-reviews-list")).getByRole(
          "heading",
        ),
      ).toHaveTextContent(/^Pull Requests/);
      expect(
        screen.getByTestId(CODE_PRODUCTION_REVIEW_ASK_TEST_ID),
      ).toHaveTextContent("Review a pull request");

      cleanup();
    }
  });

  test("a connection that stopped working: nothing is reviewed, said in the host's name and words - Replace access token, as its Tasks name the fix, and nothing to ask", async () => {
    getRepositoryMock.mockResolvedValue(
      repositoryAnswer(GITLAB, { isConnected: false }) as never,
    );
    listTasksMock.mockResolvedValue(listAnswer([]) as never);

    draw(<CodeRepositoryProductionReviews {...PAGE_PROPS} />);

    const status: HTMLElement = await screen.findByTestId(
      "code-production-reviews-status",
    );
    expect(status).toHaveAttribute("data-production-review", "not-connected");
    expect(status).toHaveTextContent(
      "This repository's connection to GitLab does not work, so its merge requests are not reviewed.",
    );
    // GitLab refused its token: the fix, by its name, where it is made.
    const connect: HTMLElement = within(status).getByTestId(
      "code-production-reviews-connect",
    );
    expect(connect).toHaveTextContent("Replace access token");
    expect(connect).toHaveAttribute("href", SETTINGS_PATH);
    expect(screen.queryByTestId(CODE_PRODUCTION_REVIEW_ASK_TEST_ID)).toBeNull();

    // A connection that is gone: its Settings say how to connect it again.
    cleanup();
    getRepositoryMock.mockResolvedValue(
      repositoryAnswer(GITLAB, {
        isConnected: false,
        isTokenRefused: false,
      }) as never,
    );
    draw(<CodeRepositoryProductionReviews {...PAGE_PROPS} />);
    const gone: HTMLElement = within(
      await screen.findByTestId("code-production-reviews-status"),
    ).getByTestId("code-production-reviews-connect");
    expect(gone).toHaveTextContent("Go to Settings");
    expect(gone).toHaveAttribute("href", SETTINGS_PATH);

    // Gitea's name on a Gitea server, in pull request words.
    cleanup();
    getRepositoryMock.mockResolvedValue(
      repositoryAnswer(GITEA, { isConnected: false }) as never,
    );
    draw(<CodeRepositoryProductionReviews {...PAGE_PROPS} />);
    expect(
      await screen.findByTestId("code-production-reviews-status"),
    ).toHaveTextContent(
      "This repository's connection to Gitea does not work, so its pull requests are not reviewed.",
    );
  });

  test("someone who may only read: no Review a merge request, and no way to Settings", async () => {
    getRepositoryMock.mockResolvedValue(
      repositoryAnswer(GITLAB, { canAsk: false }) as never,
    );
    listTasksMock.mockResolvedValue(listAnswer([]) as never);

    draw(<CodeRepositoryProductionReviews {...PAGE_PROPS} />);

    expect(
      await screen.findByTestId("code-production-reviews-status"),
    ).toBeTruthy();
    expect(screen.queryByTestId(CODE_PRODUCTION_REVIEW_ASK_TEST_ID)).toBeNull();
    expect(screen.queryByTestId("code-production-reviews-settings")).toBeNull();
  });

  test("a Git server has no pull requests: said plainly, with no status, no list and nothing to ask", async () => {
    getRepositoryMock.mockResolvedValue(repositoryAnswer(GIT) as never);

    draw(<CodeRepositoryProductionReviews {...PAGE_PROPS} />);

    expect(
      await screen.findByTestId("code-production-reviews-no-pull-requests"),
    ).toHaveTextContent(
      "A Git server has no pull requests for OneUptime to review: production reviews work in GitHub, GitLab, Forgejo and Gitea repositories. Ask AI about a change in this repository from its Tasks.",
    );
    expect(screen.queryByTestId("code-production-reviews-status")).toBeNull();
    expect(screen.queryByTestId("code-production-reviews-list")).toBeNull();
    expect(screen.queryByTestId(CODE_PRODUCTION_REVIEW_ASK_TEST_ID)).toBeNull();
    expect(listTasksMock).not.toHaveBeenCalled();
  });
});

describe("a review off GitHub, on its page", () => {
  beforeEach(() => {
    goTo(`/dashboard/${PROJECT_ID}/code/tasks/${TASK_ID}`);
  });

  test("its trail names it in its host's words: Merge request !15 on GitLab, Pull request #7 on Forgejo and Gitea", () => {
    const trailOf: (data: CodeTaskResponse) => Array<string> = (
      data: CodeTaskResponse,
    ): Array<string> => {
      return getCodeTaskTrail({
        taskId: TASK_ID,
        response: data,
        translator: createTranslator(undefined, "en"),
      }).map((link: Link): string => {
        return link.title;
      });
    };

    expect(trailOf(taskAnswer(GITLAB, { title: "" }))).toEqual([
      "Project",
      "Code",
      "billing-service",
      "Production Reviews",
      "Merge request !15",
    ]);
    expect(trailOf(taskAnswer(GITEA, { title: "" })).slice(-1)).toEqual([
      "Pull request #7",
    ]);
    expect(trailOf(taskAnswer(FORGEJO))).not.toContain("Merge request #7");
  });

  test("a review asked for from a fork promises nothing about its next pushes until it is in - then says it is reviewed again only when asked", () => {
    const asked: CodeTaskResponse = taskAnswer(GITLAB, { report: null });
    const queued: CodeTaskResponse = {
      ...asked,
      task: { ...asked.task, state: CodeTaskState.Working, isQueued: true },
      turns: [
        turn(GITLAB, {
          status: AIRunStatus.Queued,
          state: CodeTaskState.Working,
          outcome: undefined,
        }),
      ],
    };

    drawTask(queued);
    expect(screen.getByTestId("production-review-working")).toHaveTextContent(
      "Starting in a minute or so.",
    );
    // Nothing to ask again yet, and no word on what comes next.
    expect(screen.queryByTestId("production-review-footer-bar")).toBeNull();
    expect(screen.getByTestId("code-task-footer")).not.toHaveTextContent(
      "Reviewed again each time the merge request changes.",
    );

    // In: its author cannot write to the repository, as the review read.
    cleanup();
    drawTask(
      taskAnswer(GITLAB, {
        report: report(GITLAB, {
          pullRequest: {
            ...report(GITLAB).pullRequest,
            isFromFork: true,
            isAuthorTrusted: false,
          },
        }),
      }),
    );
    expect(screen.getByTestId("production-review-updates")).toHaveTextContent(
      "Its author cannot write to this repository, so it is reviewed again only when someone asks.",
    );
    expect(screen.getByTestId("production-review-again")).toBeEnabled();
  });

  test("GitLab: Merge request !15 with GitLab's mark, posted on the merge request with its comment to open - and what never leaves OneUptime, in GitLab's name", () => {
    drawTask(taskAnswer(GITLAB));

    const pullRequest: HTMLElement = screen.getByTestId(
      "production-review-pull-request",
    );
    expect(pullRequest).toHaveTextContent("Merge request !15");
    expect(pullRequest).toHaveAttribute("href", MERGE_REQUEST_URL);
    expect(pullRequest).toHaveAttribute("target", "_blank");
    expect(within(pullRequest).getByTestId("code-host-mark")).toHaveAttribute(
      "data-provider",
      CodeRepositoryType.GitLab,
    );
    expect(
      within(screen.getByTestId("code-task-repository")).getByTestId(
        "code-host-mark",
      ),
    ).toHaveAttribute("data-provider", CodeRepositoryType.GitLab);

    const posting: HTMLElement = screen.getByTestId(
      "production-review-posting",
    );
    expect(posting).toHaveTextContent("Posted on the merge request.");
    expect(
      within(posting).getByTestId("production-review-comment"),
    ).toHaveAttribute("href", NOTE_URL);
    expect(
      screen.getByTestId("production-review-aggregates"),
    ).toHaveTextContent(
      "Only counts, durations and the names of code are posted on GitLab: never an exception's message, a log line, an incident's title or personal data.",
    );
    expect(
      screen.queryByTestId("production-review-comment-refused"),
    ).toBeNull();
    expect(screen.getByTestId("production-review-updates")).toHaveTextContent(
      "Reviewed again each time the merge request changes.",
    );
  });

  test("GitLab, its switch off: reviewed again only when someone asks, in GitLab's words; a review with no title yet is named by its merge request", () => {
    drawTask(
      taskAnswer(GITLAB, {
        isProductionReviewEnabled: false,
        report: null,
        title: "",
      }),
    );

    expect(screen.getByTestId("production-review-updates")).toHaveTextContent(
      "Production review is off for this repository, so this merge request is reviewed again only when someone asks.",
    );
    expect(screen.getByTestId("code-task-title")).toHaveTextContent(
      "Merge request !15",
    );
    // Before its first review, the merge request is still linked, by its number.
    expect(
      screen.getByTestId("production-review-pull-request"),
    ).toHaveTextContent("Merge request !15");
  });

  test("Forgejo would not let the token comment: said where the review would be posted, with what lets it comment and Go to Settings - for those who may change it", () => {
    drawTask(
      taskAnswer(FORGEJO, {
        report: report(FORGEJO, {
          posting: ProductionReviewPosting.None,
          isCommentRefused: true,
          commentUrl: undefined,
        }),
      }),
    );

    const refusal: HTMLElement = screen.getByTestId(
      "production-review-comment-refused",
    );
    expect(refusal).toHaveTextContent(
      "Forgejo did not let the access token comment on this pull request, so this review is only here. Replace the access token with one that can also write issues. Go to Settings",
    );
    expect(
      within(refusal).getByTestId("production-review-comment-refused-settings"),
    ).toHaveAttribute("href", SETTINGS_PATH);
    // In place of where it was posted: nothing was.
    expect(screen.queryByTestId("production-review-posting")).toBeNull();
    expect(screen.queryByTestId("production-review-aggregates")).toBeNull();
    // What it found is all here.
    expect(screen.getByTestId("production-review")).toHaveTextContent(
      "LedgerMismatchError",
    );

    cleanup();
    drawTask(
      taskAnswer(FORGEJO, {
        canAsk: false,
        report: report(FORGEJO, {
          posting: ProductionReviewPosting.None,
          isCommentRefused: true,
          commentUrl: undefined,
        }),
      }),
    );
    expect(
      screen.getByTestId("production-review-comment-refused"),
    ).toHaveTextContent(
      "Replace the access token with one that can also write issues.",
    );
    expect(
      screen.queryByTestId("production-review-comment-refused-settings"),
    ).toBeNull();
  });

  test("GitLab refused the comment: in GitLab's words, with no word of issues - a locked discussion is a reason there too", () => {
    drawTask(
      taskAnswer(GITLAB, {
        report: report(GITLAB, {
          posting: ProductionReviewPosting.None,
          isCommentRefused: true,
          commentUrl: undefined,
        }),
      }),
    );

    const refusal: HTMLElement = screen.getByTestId(
      "production-review-comment-refused",
    );
    expect(refusal).toHaveTextContent(
      "GitLab did not let the access token comment on this merge request, so this review is only here.",
    );
    expect(refusal).not.toHaveTextContent("issues");
  });

  test("a Gitea server is named Gitea, not Forgejo: where the review was posted, and what never left OneUptime", () => {
    drawTask(taskAnswer(GITEA));

    expect(
      screen.getByTestId("production-review-aggregates"),
    ).toHaveTextContent(
      "Only counts, durations and the names of code are posted on Gitea:",
    );
    expect(
      within(screen.getByTestId("production-review-pull-request")).getByTestId(
        "code-host-mark",
      ),
    ).toHaveAttribute("data-provider", CodeRepositoryType.Forgejo);

    cleanup();
    drawTask(
      taskAnswer(GITEA, {
        report: report(GITEA, {
          posting: ProductionReviewPosting.None,
          isCommentRefused: true,
          commentUrl: undefined,
        }),
      }),
    );
    expect(
      screen.getByTestId("production-review-comment-refused"),
    ).toHaveTextContent(
      "Gitea did not let the access token comment on this pull request, so this review is only here.",
    );
  });

  test("a connection that stopped working: it cannot be reviewed again, said in the host's name and words - with Replace access token beside it", () => {
    drawTask(taskAnswer(GITLAB, { isConnected: false }));

    const notConnected: HTMLElement = screen.getByTestId(
      "production-review-not-connected",
    );
    expect(notConnected).toHaveTextContent(
      "This repository's connection to GitLab does not work now, so its merge requests cannot be reviewed again.",
    );
    const reconnect: HTMLElement = within(notConnected).getByTestId(
      "production-review-reconnect",
    );
    expect(reconnect).toHaveTextContent("Replace access token");
    expect(reconnect).toHaveAttribute("href", SETTINGS_PATH);
    expect(screen.queryByTestId("production-review-again")).toBeNull();
    // The review it has stays to read.
    expect(screen.getByTestId("production-review")).toBeTruthy();
  });
});

describe("a review's row off GitHub", () => {
  beforeEach(() => {
    goTo(`/dashboard/${PROJECT_ID}/code/repositories/${REPOSITORY_ID}`);
  });

  test("GitLab's row is its merge request: MR !15 - and one with no title yet is Merge request !15", () => {
    draw(
      <CodeTaskRow
        task={summary(GITLAB)}
        repositoryHost={{ provider: CodeRepositoryType.GitLab }}
      />,
    );

    const row: HTMLElement = screen.getByTestId("code-task-row");
    expect(
      within(row).getByTestId("code-task-row-reviewed-pull-request"),
    ).toHaveTextContent("MR !15");

    cleanup();
    draw(
      <CodeTaskRow
        task={summary(GITLAB, { title: "" })}
        repositoryHost={{ provider: CodeRepositoryType.GitLab }}
      />,
    );
    expect(screen.getByTestId("code-task-row")).toHaveTextContent(
      "Merge request !15",
    );
  });

  test("Forgejo's row: PR #7", () => {
    draw(
      <CodeTaskRow
        task={summary(FORGEJO)}
        repositoryHost={{
          provider: CodeRepositoryType.Forgejo,
          hostProduct: "Forgejo",
        }}
      />,
    );

    expect(
      within(screen.getByTestId("code-task-row")).getByTestId(
        "code-task-row-reviewed-pull-request",
      ),
    ).toHaveTextContent("PR #7");
  });
});

describe("in German", () => {
  test("Review a merge request asks in German, in GitLab's words; Review now is Jetzt prüfen", async () => {
    goTo(
      `/dashboard/${PROJECT_ID}/code/repositories/${REPOSITORY_ID}/production-reviews`,
    );
    draw(
      <CodeProductionReviewAsk
        repositoryId={REPOSITORY_ID}
        provider={CodeRepositoryType.GitLab}
      />,
      await german(),
    );

    expect(
      screen.getByTestId(CODE_PRODUCTION_REVIEW_ASK_TEST_ID),
    ).toHaveTextContent("Merge Request prüfen");
    const { dialog, submit } = openAsk();
    expect(within(dialog).getByTestId("modal-title")).toHaveTextContent(
      "Merge Request prüfen",
    );
    expect(dialog).toHaveTextContent("Nummer des Merge Requests");
    expect(dialog).toHaveTextContent(
      "Jeder offene Merge Request in diesem Repository, auch einer aus einem Fork oder von einem Bot.",
    );
    // Not "Ansehen" (look at): it starts a review.
    expect(submit).toHaveTextContent("Jetzt prüfen");
  });

  test("a Forgejo review its token could not post says so in German", async () => {
    goTo(`/dashboard/${PROJECT_ID}/code/tasks/${TASK_ID}`);
    drawTask(
      taskAnswer(FORGEJO, {
        report: report(FORGEJO, {
          posting: ProductionReviewPosting.None,
          isCommentRefused: true,
          commentUrl: undefined,
        }),
      }),
      await german(),
    );

    expect(
      screen.getByTestId("production-review-comment-refused"),
    ).toHaveTextContent(
      "Forgejo hat dem Zugriffstoken nicht erlaubt, diesen Pull Request zu kommentieren, daher ist diese Prüfung nur hier. Ersetzen Sie das Zugriffstoken durch eines, das auch Issues schreiben darf. Zu den Einstellungen",
    );
  });
});

/*
 * GitLab's words are the pull request sentences with GitLab's word in them,
 * and every sentence a review off GitHub says - the page, the dialog, the
 * review - is worded in all sixteen Dashboard languages, its placeholders
 * kept: Code never reads half in English for a GitLab, Forgejo or Gitea
 * repository. A word a language keeps as English ("Merge Requests" in
 * German) is on its list of those (i18n/Progress), as the i18n check reads
 * it.
 */
describe("the words of production reviews off GitHub", () => {
  const LOCALES_DIRECTORY: string = path.resolve(
    __dirname,
    "../../../../App/FeatureSet/Dashboard/src/Locales",
  );
  const I18N_DIRECTORY: string = path.resolve(
    __dirname,
    "../../../../App/FeatureSet/Dashboard/i18n",
  );
  const SAME_IN_EVERY_LANGUAGE: Set<string> = new Set<string>(
    JSON.parse(
      fs.readFileSync(path.join(I18N_DIRECTORY, "SameAsEnglish.json"), "utf8"),
    ) as Array<string>,
  );
  const PLACEHOLDER: RegExp = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;

  function inGitLabWords(sentence: string): string {
    return sentence
      .split("pull request")
      .join("merge request")
      .split("Pull request")
      .join("Merge request")
      .split("Pull Request")
      .join("Merge Request");
  }

  function placeholdersOf(text: string): Array<string> {
    return Array.from(text.matchAll(PLACEHOLDER))
      .map((match: RegExpMatchArray): string => {
        return match[1] || "";
      })
      .sort();
  }

  const SENTENCES: Array<string> = Array.from(
    new Set<string>([
      ...Object.values(PRODUCTION_REVIEW_ASK_COPY),
      ...Object.keys(PRODUCTION_REVIEW_MERGE_REQUEST_COPY),
      ...Object.values(PRODUCTION_REVIEW_MERGE_REQUEST_COPY),
      PRODUCTION_REVIEW_COPY.statusOffNoCommands,
      PRODUCTION_REVIEW_COPY.statusOnOthersAsk,
      PRODUCTION_REVIEW_COPY.statusNotConnectedHost,
      PRODUCTION_REVIEW_COPY.noPullRequests,
      PRODUCTION_REVIEW_COPY.goToSettings,
      PRODUCTION_REVIEW_COPY.commentRefused,
      PRODUCTION_REVIEW_COPY.commentRefusedIssues,
      PRODUCTION_REVIEW_COPY.aggregatesOnlyHost,
      PRODUCTION_REVIEW_COPY.notConnectedHost,
      CODE_REPOSITORY_CONNECTION_COPY.replaceButton,
    ]),
  );

  test("a repository not reached is connected again where its host's fix is, named as the fix", () => {
    // GitHub's from Code's Repositories, where GitHub is connected.
    expect(getProductionReviewReconnect({})).toEqual({
      title: "Connect GitHub",
      place: "repositories",
    });
    expect(
      getProductionReviewReconnect({
        provider: CodeRepositoryType.GitHub,
        connection: { isTokenRefused: true },
      }),
    ).toEqual({ title: "Connect GitHub", place: "repositories" });
    // A token its server refused: replaced on the repository's Settings.
    for (const provider of [
      CodeRepositoryType.GitLab,
      CodeRepositoryType.Forgejo,
    ]) {
      expect(
        getProductionReviewReconnect({
          provider,
          connection: { isTokenRefused: true },
        }),
      ).toEqual({ title: "Replace access token", place: "settings" });
    }
    // A connection that is gone: its Settings say how to connect it again.
    expect(
      getProductionReviewReconnect({
        provider: CodeRepositoryType.GitLab,
        connection: { isTokenRefused: false },
      }),
    ).toEqual({ title: "Go to Settings", place: "settings" });
    expect(
      getProductionReviewReconnect({ provider: CodeRepositoryType.Forgejo }),
    ).toEqual({ title: "Go to Settings", place: "settings" });
  });

  test("each merge request sentence is its pull request sentence, in GitLab's word", () => {
    const pairs: Array<[string, string]> = Object.entries(
      PRODUCTION_REVIEW_MERGE_REQUEST_COPY,
    );

    expect(pairs.length).toBeGreaterThan(20);
    for (const [pullRequest, mergeRequest] of pairs) {
      expect(mergeRequest).toBe(inGitLabWords(pullRequest));
      expect(mergeRequest).not.toBe(pullRequest);
    }
  });

  test.each(
    fs
      .readdirSync(LOCALES_DIRECTORY)
      .filter((name: string): boolean => {
        return name.endsWith(".json") && name !== "en.json";
      })
      .map((name: string): string => {
        return name.replace(".json", "");
      })
      .sort(),
  )(
    "%s words every one of them, keeping its placeholders",
    (locale: string) => {
      const translations: Record<string, string> = JSON.parse(
        fs.readFileSync(path.join(LOCALES_DIRECTORY, `${locale}.json`), "utf8"),
      ) as Record<string, string>;
      const sameInLocale: Set<string> = new Set<string>(
        (
          JSON.parse(
            fs.readFileSync(
              path.join(I18N_DIRECTORY, "Progress", `${locale}.json`),
              "utf8",
            ),
          ) as { sameAsEnglish?: Array<string> }
        ).sameAsEnglish || [],
      );

      const untranslated: Array<string> = SENTENCES.filter(
        (sentence: string): boolean => {
          return (
            typeof translations[sentence] !== "string" ||
            (translations[sentence] === sentence &&
              !SAME_IN_EVERY_LANGUAGE.has(sentence) &&
              !sameInLocale.has(sentence))
          );
        },
      );
      expect(untranslated).toEqual([]);

      for (const sentence of SENTENCES) {
        expect(placeholdersOf(translations[sentence]!)).toEqual(
          placeholdersOf(sentence),
        );
      }
    },
  );
});
