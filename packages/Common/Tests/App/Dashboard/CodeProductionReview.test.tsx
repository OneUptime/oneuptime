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
  CodeTaskOriginType,
  CodeTaskState,
  CodeTaskSummaryJSON,
  CodeTaskTurnJSON,
} from "../../../Types/AI/CodeTask";
import Route from "../../../Types/API/Route";
import {
  LlmProviderActivity,
  LlmProviderFallbackReason,
  LlmProviderSource,
} from "../../../Types/AI/LlmProviderChoice";
import {
  ProductionReviewAiNoteCode,
  ProductionReviewOperationMatch,
  ProductionReviewPosting,
  ProductionReviewReport,
  ProductionReviewSection,
  ProductionReviewTrigger,
  ProductionReviewWhere,
} from "../../../Types/CodeRepository/ProductionReview";
import Link from "../../../Types/Link";
import Navigation from "../../../UI/Utils/Navigation";
import { createTranslator } from "../../../UI/Utils/TranslateTemplate";
import englishLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/en.json";
import germanLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/de.json";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { goTo, PROJECT_ID } from "./SideMenuHarness";

/*
 * A pull request's production review in Code, drawn for real over a
 * stand-in for the Code API (Components/Code/CodeApi):
 *
 *  - the review (CodeProductionReview): OneUptime AI's points, or why there
 *    are none; the services the changed code runs in; then what production
 *    shows of the changed code - exceptions, operations, hot functions,
 *    incidents, deploys - each linked to where it lives in OneUptime, each
 *    row's facts on Code's meta line and the names of code wrapping only
 *    between their parts; what could not be read, before the findings; and,
 *    where the review was posted, that only aggregates left OneUptime. A
 *    review that found nothing says why. Every word of it is drawn as text:
 *    OneUptime AI's points and the names of code never as markup.
 *  - its page (CodeProductionReviewTask, through the task's page): what it
 *    is of - the pull request, the commit, when - and what the pull request
 *    shows of it; while a review runs, the one before it stays; a review
 *    that failed or was not done says why; Review again where a reply box
 *    would be, for those who may ask, and why not for the rest.
 *  - the repository's Production Reviews page: whether reviews are on, how
 *    a pull request gets one (the GitHub command only while the GitHub App
 *    answers commands), the way to Settings, the reviews, and what the list
 *    holds when there are none.
 *  - a review's row in a list, its trail, the repository's menu and trail.
 */

const getRepositoryMock: MockFunction = getJestMockFunction();
const listTasksMock: MockFunction = getJestMockFunction();
const getTaskMock: MockFunction = getJestMockFunction();
const reviewAgainMock: MockFunction = getJestMockFunction();

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
      },
    };
  },
);

import CodeProductionReview, {
  getHotFunctionRoute,
  getOperationTracesRoute,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Code/CodeProductionReview";
import CodeProductionReviewTask, {
  getLatestProductionReview,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Code/CodeProductionReviewTask";
import {
  PRODUCTION_REVIEW_PROVIDER_COPY,
  getProductionReviewProviderLine,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Code/CodeProductionReviewCopy";
import { CodeTaskResponse } from "../../../../App/FeatureSet/Dashboard/src/Components/Code/CodeApi";
import { CodeTaskRow } from "../../../../App/FeatureSet/Dashboard/src/Components/Code/CodeTaskList";
import { getCodeTaskTrail } from "../../../../App/FeatureSet/Dashboard/src/Components/Code/CodeTaskTrail";
import CodeRepositoryProductionReviews, {
  CODE_PRODUCTION_REVIEWS_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Code/Repository/ProductionReviews";
import CodeRepositorySideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/Code/Repository/SideMenu";
import CodeTaskConversation from "../../../../App/FeatureSet/Dashboard/src/Pages/Code/Task/Conversation";
import { getCodeBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/CodeBreadcrumbs";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import { RouteUtil } from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import ObjectID from "../../../Types/ObjectID";

const REPOSITORY_ID: string = "6c7d8e9f-0a1b-4c2d-9e3f-4a5b6c7d8e9f";
const TASK_ID: string = "7d8e9f0a-1b2c-4d3e-8f4a-5b6c7d8e9f0a";
const SERVICE_ID: string = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const OTHER_SERVICE_ID: string = "2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e";
const EXCEPTION_ID: string = "3c4d5e6f-7a8b-4c9d-8e0f-2a3b4c5d6e7f";
const INCIDENT_ID: string = "4d5e6f7a-8b9c-4d0e-9f1a-3b4c5d6e7f8a";
const OTHER_INCIDENT_ID: string = "5e6f7a8b-9c0d-4e1f-8a2b-4c5d6e7f8a9b";
const HEAD_SHA: string = "4f2a9c1e8b7d6a5f4e3d2c1b0a9f8e7d6c5b4a39";
const PULL_REQUEST_URL: string = "https://github.com/acme/checkout-api/pull/42";
const COMMENT_URL: string =
  "https://github.com/acme/checkout-api/pull/42#issuecomment-1001";

const translation: i18n = createInstance();

// A class that puts a gap above an element: mt-1, mt-1.5, mt-[9px]...
const TOP_MARGIN: RegExp = /(^|\s)mt-/;

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
  ]) {
    mock.mockReset();
  }
  jest.spyOn(Navigation, "navigate").mockImplementation((() => {}) as never);
  process.env["GITHUB_APP_NAME"] = "OneUptime";
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
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

function draw(element: ReactElement): void {
  render(<I18nextProvider i18n={translation}>{element}</I18nextProvider>);
}

function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60 * 1000).toISOString();
}

// A review that found something in every part, as the server keeps it.
function report(
  data: Partial<ProductionReviewReport> = {},
): ProductionReviewReport {
  return {
    pullRequest: {
      number: 42,
      title: "Retry charges when the gateway times out",
      url: PULL_REQUEST_URL,
      authorLogin: "ada",
      headSha: HEAD_SHA,
      baseRefName: "main",
      isFromFork: false,
    },
    reviewedAt: minutesAgo(5),
    trigger: ProductionReviewTrigger.PullRequestChanged,
    changedFileCount: 4,
    codeFileCount: 3,
    services: [
      { id: SERVICE_ID, name: "checkout-api", requestCount: 12840, p99Ms: 840 },
      { id: OTHER_SERVICE_ID, name: "payments-worker" },
    ],
    exceptions: [
      {
        exceptionId: EXCEPTION_ID,
        type: "GatewayTimeoutError",
        serviceId: SERVICE_ID,
        serviceName: "checkout-api",
        path: "src/payments/charge.ts",
        line: 88,
        functionName: "chargeCard",
        where: ProductionReviewWhere.ChangedLine,
        occurrences: 1240,
        isWindowCount: true,
        lastSeenAt: minutesAgo(12),
        isUnhandled: true,
        isNew: true,
      },
      {
        exceptionId: "not-an-id",
        type: "RangeError",
        serviceId: SERVICE_ID,
        serviceName: "checkout-api",
        path: "src/payments/retry.ts",
        where: ProductionReviewWhere.ChangedFile,
        occurrences: 17,
        isWindowCount: false,
        isUnhandled: false,
        isNew: false,
      },
    ],
    operations: [
      {
        name: "POST /api/charges",
        serviceId: SERVICE_ID,
        serviceName: "checkout-api",
        path: "src/payments/charge.ts",
        matchedBy: ProductionReviewOperationMatch.Route,
        requestCount: 9300,
        errorCount: 93,
        p95Ms: 1240,
      },
    ],
    hotFunctions: [
      {
        functionName: "chargeCard",
        path: "src/payments/charge.ts",
        serviceId: SERVICE_ID,
        serviceName: "checkout-api",
        totalPercent: 18.4,
        selfPercent: 2.5,
        isChangedFunction: true,
        profileKind: "CPU time",
      },
    ],
    incidents: {
      total: 4,
      open: 1,
      items: [
        {
          incidentId: INCIDENT_ID,
          label: "INC-45",
          severity: "Critical",
          state: "Investigating",
          isOpen: true,
          declaredAt: minutesAgo(90),
        },
        {
          incidentId: OTHER_INCIDENT_ID,
          label: "INC-31",
          severity: "Major",
          state: "Resolved",
          isOpen: false,
          declaredAt: minutesAgo(60 * 24 * 9),
          mentions: "chargeCard",
        },
        {
          incidentId: "6f7a8b9c-0d1e-4f2a-9b3c-5d6e7f8a9b0c",
          label: "INC-12",
          isOpen: false,
          declaredAt: minutesAgo(60 * 24 * 20),
        },
      ],
    },
    suspectDeploys: [
      {
        serviceId: SERVICE_ID,
        serviceName: "checkout-api",
        at: minutesAgo(180),
        version: "v2.14.0",
        impact:
          "p95 latency of POST /api/charges rose from 420 ms to 1.2 s after it.",
      },
    ],
    points: [
      {
        text: "This change retries `chargeCard()` on a timeout, the line that threw 1,240 times this week: make sure a retried charge cannot be charged twice.",
      },
      { text: "INC-45 is open on checkout-api." },
    ],
    unreadSections: [],
    posting: ProductionReviewPosting.Review,
    isPublicRepository: false,
    commentUrl: COMMENT_URL,
    ...data,
  };
}

// A review that found nothing at all.
function emptyReport(
  data: Partial<ProductionReviewReport> = {},
): ProductionReviewReport {
  return report({
    exceptions: [],
    operations: [],
    hotFunctions: [],
    incidents: { total: 0, open: 0, items: [] },
    suspectDeploys: [],
    points: [],
    posting: ProductionReviewPosting.None,
    ...data,
  });
}

function summary(data: Partial<CodeTaskSummaryJSON> = {}): CodeTaskSummaryJSON {
  return {
    id: TASK_ID,
    title: "Retry charges when the gateway times out",
    recipe: CodeFixTaskType.GitHubPullRequestProductionReview,
    state: CodeTaskState.Done,
    isQueued: false,
    createdAt: minutesAgo(60),
    lastActivityAt: minutesAgo(5),
    origin: {
      type: CodeTaskOriginType.GitHubPullRequest,
      label: "#42",
      url: PULL_REQUEST_URL,
    },
    turnCount: 1,
    codeRepositoryId: REPOSITORY_ID,
    ...data,
  };
}

// A review whose pull request's title is not known yet: an empty title.
function untitled(
  data: Partial<CodeTaskSummaryJSON> = {},
): CodeTaskSummaryJSON {
  return summary({ ...data, title: "" });
}

function turn(data: Partial<CodeTaskTurnJSON> = {}): CodeTaskTurnJSON {
  return {
    runId: TASK_ID,
    recipe: CodeFixTaskType.GitHubPullRequestProductionReview,
    status: AIRunStatus.Completed,
    state: CodeTaskState.Done,
    createdAt: minutesAgo(60),
    startedAt: minutesAgo(6),
    completedAt: minutesAgo(5),
    steps: [],
    pullRequests: [],
    needsInput: false,
    outcome: {
      summary: "Production review: 2 exceptions in or around the changed code.",
      filesChanged: [],
      productionReview: report(),
    },
    ...data,
  };
}

function taskAnswer(data: Partial<CodeTaskResponse> = {}): CodeTaskResponse {
  return {
    task: summary(),
    turns: [turn()],
    repository: {
      id: REPOSITORY_ID,
      name: "checkout-api",
      organizationName: "acme",
      repositoryName: "checkout-api",
      mainBranchName: "main",
      isConnected: true,
      isProductionReviewEnabled: true,
    },
    canAsk: true,
    canSeeChanges: true,
    canReadLogContent: true,
    blocker: null,
    ...data,
  };
}

function drawReview(value: ProductionReviewReport): HTMLElement {
  draw(<CodeProductionReview report={value} />);

  return screen.getByTestId("production-review");
}

describe("the review: what production shows of the changed code", () => {
  beforeEach(() => {
    goTo(`/dashboard/${PROJECT_ID}/code/tasks/${TASK_ID}`);
  });

  test("OneUptime AI's points come first, the names of code in them drawn as code - and never as markup", () => {
    drawReview(
      report({
        points: [
          {
            text: "Retrying `chargeCard()` can charge twice. <img src=x onerror=alert(1)> **not bold**",
          },
        ],
      }),
    );

    const points: HTMLElement = screen.getByTestId("production-review-points");
    expect(within(points).getByRole("heading")).toHaveTextContent(
      "What to watch",
    );
    const point: HTMLElement = within(points).getByTestId(
      "production-review-point",
    );
    expect(within(point).getByText("chargeCard()").tagName).toBe("CODE");
    // Markup in its words is text: no image, no bold.
    expect(point.querySelector("img")).toBeNull();
    expect(point.querySelector("strong")).toBeNull();
    expect(point).toHaveTextContent("<img src=x onerror=alert(1)>");
    expect(point).toHaveTextContent("**not bold**");
    expect(points).toHaveTextContent(
      "OneUptime AI read the facts below and the diff.",
    );
    // First, before the facts.
    const review: HTMLElement = screen.getByTestId("production-review");
    expect(review.firstElementChild).toBe(points);
  });

  test.each([
    [
      ProductionReviewAiNoteCode.AiOff,
      "OneUptime AI did not read this review: AI is turned off for this project. The facts below are read without it.",
    ],
    [
      ProductionReviewAiNoteCode.DailyLimit,
      "OneUptime AI already read this pull request, or this repository, as often as it may today. The facts below are read every time.",
    ],
    [
      ProductionReviewAiNoteCode.Failed,
      "OneUptime AI could not read this review this time. The facts below are complete.",
    ],
  ])(
    "with no points, it says why OneUptime AI did not read it (%s)",
    (code: ProductionReviewAiNoteCode, sentence: string) => {
      drawReview(report({ points: [], aiNote: { code } }));

      expect(screen.queryByTestId("production-review-points")).toBeNull();
      const note: HTMLElement = screen.getByTestId("production-review-ai-note");
      expect(note).toHaveTextContent(sentence);
      expect(note).toHaveAttribute("data-ai-note", code);
    },
  );

  test("no points and no note: nothing about OneUptime AI at all", () => {
    drawReview(report({ points: [] }));

    expect(screen.queryByTestId("production-review-points")).toBeNull();
    expect(screen.queryByTestId("production-review-ai-note")).toBeNull();
  });

  test("the services the changed code runs in, each linked to its page, with how busy and slow it is when known", () => {
    drawReview(report());

    const services: Array<HTMLElement> = screen.getAllByTestId(
      "production-review-service",
    );
    expect(screen.getByTestId("production-review-services")).toHaveTextContent(
      "The changed code runs in",
    );
    expect(services).toHaveLength(2);
    expect(services[0]).toHaveTextContent("checkout-api");
    expect(services[0]).toHaveTextContent("12,840 spans in the last hour");
    expect(services[0]).toHaveTextContent("p99 840 ms");
    expect(within(services[0]!).getByRole("link")).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/service/${SERVICE_ID}`,
    );
    // Only what is known: a service that sends no traces is just named.
    expect(services[1]).toHaveTextContent("payments-worker");
    expect(services[1]).not.toHaveTextContent("spans");
    expect(services[1]).not.toHaveTextContent("p99");
  });

  test("exceptions thrown in the changed code: the type linked to its page, new and unhandled, the count, where it is thrown and how close to the change", () => {
    drawReview(report());

    const section: HTMLElement = screen.getByTestId(
      "production-review-exceptions",
    );
    expect(within(section).getByRole("heading")).toHaveTextContent(
      "Exceptions in the changed code",
    );
    expect(section).toHaveTextContent("Last 7 days");

    const [first, second] = within(section).getAllByTestId(
      "production-review-exception",
    );
    expect(within(first!).getByRole("link")).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/exceptions/${EXCEPTION_ID}`,
    );
    expect(first).toHaveTextContent("GatewayTimeoutError");
    expect(
      within(first!).getByTestId("production-review-exception-new"),
    ).toHaveTextContent("New");
    expect(
      within(first!).getByTestId("production-review-exception-unhandled"),
    ).toHaveTextContent("Unhandled");
    expect(
      within(first!).getByTestId("production-review-exception-count"),
    ).toHaveTextContent("1,240");
    expect(within(first!).getByText("src/payments/charge.ts:88").tagName).toBe(
      "CODE",
    );
    expect(within(first!).getByText("chargeCard").tagName).toBe("CODE");
    expect(first).toHaveTextContent("At a changed line");
    expect(first).toHaveTextContent("checkout-api");
    expect(first).toHaveTextContent("Last thrown 12 minutes ago");

    // An id that is not one opens nothing; a count the window could not read is the group's own.
    expect(within(second!).queryByRole("link")).toBeNull();
    expect(
      within(second!).getByTestId("production-review-exception-count"),
    ).toHaveTextContent("17 in all");
    expect(second).toHaveTextContent("In a changed file");
    expect(
      within(second!).queryByTestId("production-review-exception-new"),
    ).toBeNull();
    expect(
      within(second!).queryByTestId("production-review-exception-unhandled"),
    ).toBeNull();
  });

  test("operations that run the changed code open their service's traces in the hour the review read", () => {
    const value: ProductionReviewReport = report({
      reviewedAt: "2026-10-22T08:00:00.000Z",
    });
    drawReview(value);

    const section: HTMLElement = screen.getByTestId(
      "production-review-operations",
    );
    expect(section).toHaveTextContent("Operations that run the changed code");
    expect(section).toHaveTextContent("Last hour");

    const row: HTMLElement = within(section).getByTestId(
      "production-review-operation",
    );
    expect(within(row).getByText("POST /api/charges").tagName).toBe("CODE");
    expect(row).toHaveTextContent("p95 1.2 s");
    expect(row).toHaveTextContent("9,300 spans");
    expect(row).toHaveTextContent("93 errors (1%)");
    expect(row).toHaveTextContent("Serves a changed route");

    const href: string = within(row).getByRole("link").getAttribute("href")!;
    const url: URL = new URL(href, "http://dashboard.test");
    expect(url.pathname).toBe(`/dashboard/${PROJECT_ID}/traces`);
    expect(JSON.parse(url.searchParams.get("filters")!)).toEqual([
      ["primaryEntityId", SERVICE_ID],
    ]);
    expect(url.searchParams.get("range")).toBe("Custom");
    expect(href).toBe(
      getOperationTracesRoute(value.operations[0]!, value).toString(),
    );
  });

  test("an operation with no errors says nothing about errors", () => {
    drawReview(
      report({
        operations: [
          { ...report().operations[0]!, errorCount: 0, requestCount: 1 },
        ],
      }),
    );

    const row: HTMLElement = screen.getByTestId("production-review-operation");
    expect(row).toHaveTextContent("1 span");
    expect(row).not.toHaveTextContent("error");
  });

  test("hot functions of the changed code open the Profiler on the function, in the hour the review read", () => {
    const value: ProductionReviewReport = report({
      reviewedAt: "2026-10-22T08:00:00.000Z",
    });
    drawReview(value);

    const section: HTMLElement = screen.getByTestId(
      "production-review-hot-code",
    );
    expect(section).toHaveTextContent("Hot functions in the changed code");

    const row: HTMLElement = within(section).getByTestId(
      "production-review-hot-function",
    );
    expect(
      within(row).getByTestId("production-review-hot-function-share"),
    ).toHaveTextContent("18%");
    // Said once: the figure is its share with what it calls; the facts add its own.
    expect(row).not.toHaveTextContent("with what it calls");
    expect(
      within(row).getByTestId("production-review-hot-function-facts"),
    ).toHaveTextContent("2.5% in its own code");
    expect(row).toHaveTextContent("CPU time");

    const url: URL = new URL(
      within(row).getByRole("link").getAttribute("href")!,
      "http://dashboard.test",
    );
    expect(url.pathname).toBe(`/dashboard/${PROJECT_ID}/profiles`);
    expect(url.searchParams.get("serviceId")).toBe(SERVICE_ID);
    expect(url.searchParams.get("function")).toBe("chargeCard");
    expect(url.searchParams.get("file")).toBe("src/payments/charge.ts");
    expect(url.searchParams.get("startTime")).toBe("2026-10-22T07:00:00.000Z");
    expect(url.searchParams.get("endTime")).toBe("2026-10-22T08:00:00.000Z");
    expect(within(row).getByRole("link").getAttribute("href")).toBe(
      getHotFunctionRoute(value.hotFunctions[0]!, value).toString(),
    );
  });

  test("incidents: only those open on the services or naming the change, each linked, then how many there were in all", () => {
    drawReview(report());

    const section: HTMLElement = screen.getByTestId(
      "production-review-incidents",
    );
    expect(section).toHaveTextContent("Last 30 days");

    const rows: Array<HTMLElement> = within(section).getAllByTestId(
      "production-review-incident",
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("INC-45");
    expect(rows[0]).toHaveTextContent("Critical");
    expect(rows[0]).toHaveTextContent("Investigating");
    expect(within(rows[0]!).getByRole("link")).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/incidents/${INCIDENT_ID}`,
    );
    expect(rows[1]).toHaveTextContent("INC-31");
    const mentions: HTMLElement = within(rows[1]!).getByTestId(
      "production-review-incident-mentions",
    );
    expect(mentions).toHaveTextContent(
      "Its root cause or postmortem names chargeCard",
    );
    expect(within(mentions).getByText("chargeCard").tagName).toBe("CODE");
    // A closed incident that names nothing of the change is counted, not listed.
    expect(section).not.toHaveTextContent("INC-12");
    expect(
      within(section).getByTestId("production-review-incidents-total"),
    ).toHaveTextContent("4 incidents on these services in all");
  });

  test("suspect deploys: the service, its version, when, and what got worse", () => {
    drawReview(report());

    const deploy: HTMLElement = screen.getByTestId("production-review-deploy");
    expect(screen.getByTestId("production-review-deploys")).toHaveTextContent(
      "Recent deploys",
    );
    expect(deploy).toHaveTextContent("checkout-api");
    expect(within(deploy).getByText("v2.14.0").tagName).toBe("CODE");
    expect(deploy).toHaveTextContent("Deployed 3 hours ago");
    expect(deploy).toHaveTextContent(
      "p95 latency of POST /api/charges rose from 420 ms to 1.2 s after it.",
    );
  });

  test("a part that found nothing is not drawn at all", () => {
    drawReview(
      report({
        operations: [],
        hotFunctions: [],
        suspectDeploys: [],
        incidents: { total: 0, open: 0, items: [] },
      }),
    );

    expect(screen.getByTestId("production-review-exceptions")).toBeTruthy();
    for (const part of [
      "production-review-operations",
      "production-review-hot-code",
      "production-review-incidents",
      "production-review-deploys",
      "production-review-nothing-found",
    ]) {
      expect(screen.queryByTestId(part)).toBeNull();
    }
  });

  test("a review that found nothing says so, and why: nothing where it runs, no code changed, or no service known", () => {
    drawReview(emptyReport());

    let nothing: HTMLElement = screen.getByTestId(
      "production-review-nothing-found",
    );
    expect(nothing).toHaveTextContent("Nothing found in production");
    expect(nothing).toHaveTextContent(
      "Nothing in production runs through this pull request's changes: no exception thrown in them in the last 7 days",
    );

    cleanup();
    drawReview(emptyReport({ codeFileCount: 0 }));
    nothing = screen.getByTestId("production-review-nothing-found");
    expect(nothing).toHaveTextContent(
      "This pull request changes no code production runs, so production has nothing to say about it.",
    );

    cleanup();
    drawReview(
      emptyReport({ services: [], noServicesReason: "NoServicesInProject" }),
    );
    nothing = screen.getByTestId("production-review-nothing-found");
    expect(nothing).toHaveTextContent(
      "No service OneUptime monitors is known to run this repository's code yet.",
    );
    expect(screen.queryByTestId("production-review-services")).toBeNull();
  });

  test("an open incident alone is something production says, and is drawn", () => {
    drawReview(
      emptyReport({
        incidents: {
          total: 1,
          open: 1,
          items: [
            {
              incidentId: INCIDENT_ID,
              label: "INC-45",
              isOpen: true,
              declaredAt: minutesAgo(30),
            },
          ],
        },
      }),
    );

    expect(screen.queryByTestId("production-review-nothing-found")).toBeNull();
    expect(screen.getByTestId("production-review-incident")).toHaveTextContent(
      "INC-45",
    );
  });

  test("the parts that could not be read are named, and read again next time", () => {
    drawReview(
      report({
        unreadSections: [
          ProductionReviewSection.Operations,
          ProductionReviewSection.Profiles,
        ],
      }),
    );

    const unread: HTMLElement = screen.getByTestId("production-review-unread");
    expect(unread).toHaveTextContent("Not read this time");
    expect(
      within(unread)
        .getAllByTestId("production-review-unread-section")
        .map((chip: HTMLElement): string => {
          return chip.textContent || "";
        }),
    ).toEqual(["Traces", "Profiles"]);
    expect(unread).toHaveTextContent(
      "These parts of production could not be read. They are read again on the next review.",
    );
  });

  test("where the review was posted, it says what never leaves OneUptime - and nowhere else", () => {
    drawReview(report());
    expect(
      screen.getByTestId("production-review-aggregates"),
    ).toHaveTextContent(
      "Only counts, durations and the names of code are posted on GitHub: never an exception's message, a log line, an incident's title or personal data.",
    );

    // A link posts nothing of production, and nothing posted posts nothing.
    for (const posting of [
      ProductionReviewPosting.Link,
      ProductionReviewPosting.None,
    ]) {
      cleanup();
      drawReview(report({ posting }));
      expect(screen.queryByTestId("production-review-aggregates")).toBeNull();
    }

    cleanup();
    drawReview(emptyReport());
    expect(screen.queryByTestId("production-review-aggregates")).toBeNull();
  });

  test("what could not be read is said before the findings, so none is read without it", () => {
    drawReview(
      report({ unreadSections: [ProductionReviewSection.Exceptions] }),
    );

    const unread: HTMLElement = screen.getByTestId("production-review-unread");
    const findings: HTMLElement = screen.getByTestId(
      "production-review-operations",
    );
    expect(
      unread.compareDocumentPosition(findings) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    // Before "nothing found" too.
    cleanup();
    drawReview(
      emptyReport({ unreadSections: [ProductionReviewSection.Exceptions] }),
    );
    expect(
      screen
        .getByTestId("production-review-unread")
        .compareDocumentPosition(
          screen.getByTestId("production-review-nothing-found"),
        ) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  test("a row's facts are Code's meta line: a dot between facts, never one that starts a line", () => {
    drawReview(report());

    const row: HTMLElement = screen.getAllByTestId(
      "production-review-exception",
    )[0]!;
    const facts: HTMLElement = within(row).getByTestId(
      "production-review-exception-facts",
    );
    // Path, function, closeness, service, last seen: a dot before each but the first.
    expect(within(facts).getAllByTestId("code-meta-dot")).toHaveLength(4);
    // The meta line clips a wrapped fact's dot: its box hides what overflows.
    expect(facts.className).toContain("overflow-hidden");

    const service: HTMLElement = screen.getAllByTestId(
      "production-review-service",
    )[0]!;
    // The service's name, its spans and its p99: two dots, inside the chip.
    expect(within(service).getAllByTestId("code-meta-dot")).toHaveLength(2);
  });

  test("the names of code wrap between their parts on a narrow screen - after a folder, or a dot before a long part - never inside one", () => {
    drawReview(
      report({
        operations: [
          {
            ...report().operations[0]!,
            name: "PaymentClient.chargeWithRetries",
          },
        ],
      }),
    );

    const operation: HTMLElement = within(
      screen.getByTestId("production-review-operation"),
    ).getByText((_content: string, element: Element | null): boolean => {
      return (
        element?.tagName === "CODE" &&
        element.textContent === "PaymentClient.chargeWithRetries"
      );
    });
    expect(operation.querySelectorAll("wbr")).toHaveLength(1);
    expect(operation.innerHTML).toContain(
      "PaymentClient.<wbr>chargeWithRetries",
    );

    // A path at its folders; "charge.ts:88" stays whole.
    const where: HTMLElement = within(
      screen.getAllByTestId("production-review-exception")[0]!,
    ).getByText((_content: string, element: Element | null): boolean => {
      return (
        element?.tagName === "CODE" &&
        element.textContent === "src/payments/charge.ts:88"
      );
    });
    expect(where.innerHTML).toBe("src/<wbr>payments/<wbr>charge.ts:88");
  });
});

describe("a review's page", () => {
  beforeEach(() => {
    goTo(`/dashboard/${PROJECT_ID}/code/tasks/${TASK_ID}`);
  });

  function drawTask(
    data: CodeTaskResponse,
    options: {
      onReviewAgain?: () => void;
      isAskingAgain?: boolean;
      actionError?: string;
    } = {},
  ): void {
    draw(
      <CodeProductionReviewTask
        data={data}
        onReviewAgain={options.onReviewAgain || ((): void => {})}
        isAskingAgain={Boolean(options.isAskingAgain)}
        actionError={options.actionError}
      />,
    );
  }

  test("what it is of: the kind, the pull request's title, the pull request (in a new tab), the repository, the branch, the commit and when", () => {
    drawTask(taskAnswer());

    const header: HTMLElement = screen.getByTestId("code-task-header");
    expect(within(header).getByTestId("code-task-state")).toHaveTextContent(
      "Done",
    );
    expect(header).toHaveTextContent("Production Review");
    expect(screen.getByTestId("code-task-title")).toHaveTextContent(
      "Retry charges when the gateway times out",
    );

    const pullRequest: HTMLElement = screen.getByTestId(
      "production-review-pull-request",
    );
    expect(pullRequest).toHaveAttribute("href", PULL_REQUEST_URL);
    expect(pullRequest).toHaveAttribute("target", "_blank");
    expect(pullRequest).toHaveTextContent("Pull request #42");

    expect(within(header).getByTestId("code-task-repository")).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/code/repositories/${REPOSITORY_ID}`,
    );
    expect(
      within(header).getByTestId("code-task-repository"),
    ).toHaveTextContent("acme/checkout-api");
    expect(
      screen.getByTestId("production-review-base-branch"),
    ).toHaveTextContent("main");
    const commit: HTMLElement = screen.getByTestId("production-review-commit");
    expect(commit).toHaveTextContent("Commit 4f2a9c1");
    expect(commit).toHaveAttribute("title", HEAD_SHA);
    expect(
      screen.getByTestId("production-review-reviewed-at"),
    ).toHaveTextContent("Reviewed 5 minutes ago");

    // And the review itself, below.
    expect(screen.getByTestId("production-review")).toBeTruthy();
  });

  test("what the pull request shows of it: posted, with the comment to open", () => {
    drawTask(taskAnswer());

    const posting: HTMLElement = screen.getByTestId(
      "production-review-posting",
    );
    expect(posting).toHaveAttribute("data-posting", "Review");
    expect(posting).toHaveTextContent("Posted on the pull request.");
    const comment: HTMLElement = within(posting).getByTestId(
      "production-review-comment",
    );
    expect(comment).toHaveAttribute("href", COMMENT_URL);
    expect(comment).toHaveAttribute("target", "_blank");
    expect(comment).toHaveTextContent("View comment");
  });

  test("a public repository's pull request only links here; nothing posted has no comment to open", () => {
    drawTask(
      taskAnswer({
        turns: [
          turn({
            outcome: {
              summary: "",
              filesChanged: [],
              productionReview: report({
                posting: ProductionReviewPosting.Link,
                isPublicRepository: true,
              }),
            },
          }),
        ],
      }),
    );
    expect(screen.getByTestId("production-review-posting")).toHaveTextContent(
      "This repository is public, so the pull request only links to this review.",
    );

    cleanup();
    drawTask(
      taskAnswer({
        turns: [
          turn({
            outcome: {
              summary: "",
              filesChanged: [],
              productionReview: emptyReport({ commentUrl: undefined }),
            },
          }),
        ],
      }),
    );
    const posting: HTMLElement = screen.getByTestId(
      "production-review-posting",
    );
    expect(posting).toHaveAttribute("data-posting", "None");
    // Said once: the review below says why.
    expect(posting).toHaveTextContent(
      "Nothing was posted on the pull request.",
    );
    expect(posting).not.toHaveTextContent("production shows nothing");
    expect(screen.queryByTestId("production-review-comment")).toBeNull();
  });

  test("waiting to start, it says when it starts - true after a push and after Review again alike", () => {
    drawTask(
      taskAnswer({
        task: summary({ state: CodeTaskState.Working, isQueued: true }),
        turns: [turn({ state: CodeTaskState.Working, outcome: undefined })],
      }),
    );

    expect(screen.getByTestId("production-review-working")).toHaveTextContent(
      "Starting in a minute or so.",
    );
    expect(screen.queryByTestId("production-review")).toBeNull();
    /*
     * A first review on its way has nothing to ask again yet, and promises
     * nothing of the pull request's next pushes: whether its author can
     * write is what the review reads - one asked for from a fork, with
     * Review a pull request, is not reviewed again on its own.
     */
    expect(screen.queryByTestId("production-review-footer-bar")).toBeNull();
    expect(screen.queryByTestId("production-review-again")).toBeNull();
    expect(screen.getByTestId("code-task-footer")).not.toHaveTextContent(
      "Reviewed again each time the pull request changes.",
    );

    // Asked again, the last review stays - and Review again waits for it.
    cleanup();
    drawTask(
      taskAnswer({
        task: summary({ state: CodeTaskState.Working, isQueued: true }),
        turns: [
          turn(),
          turn({ state: CodeTaskState.Working, outcome: undefined }),
        ],
      }),
    );
    expect(screen.getByTestId("production-review-working")).toHaveTextContent(
      "Starting in a minute or so.",
    );
    expect(screen.getByTestId("production-review")).toBeTruthy();
    // While it works, Review again waits too: the line above says why.
    expect(screen.getByTestId("production-review-again")).toBeDisabled();
    expect(screen.getByTestId("production-review-again")).toHaveTextContent(
      "Review again",
    );
    expect(screen.getByTestId("production-review-updates")).toHaveTextContent(
      "Reviewed again each time the pull request changes.",
    );
  });

  test("the first review running says so; one run again keeps the last review on screen", () => {
    drawTask(
      taskAnswer({
        task: summary({ state: CodeTaskState.Working }),
        turns: [turn({ state: CodeTaskState.Working, outcome: undefined })],
      }),
    );
    expect(screen.getByTestId("production-review-working")).toHaveTextContent(
      "Reviewing against production…",
    );

    cleanup();
    drawTask(
      taskAnswer({
        task: summary({ state: CodeTaskState.Working }),
        turns: [turn({ state: CodeTaskState.Working })],
      }),
    );
    expect(screen.getByTestId("production-review-working")).toHaveTextContent(
      "Reviewing again…",
    );
    expect(screen.getByTestId("production-review")).toBeTruthy();
  });

  test("a review that failed says so once - the server's sentence, with what starts a new one", () => {
    const sentence: string =
      "OneUptime could not finish this production review, even after trying again. A push to the pull request, or Review again, starts a new one.";
    drawTask(
      taskAnswer({
        task: summary({ state: CodeTaskState.Failed }),
        turns: [
          turn({
            state: CodeTaskState.Failed,
            errorMessage: sentence,
          }),
        ],
      }),
    );

    const failed: HTMLElement = screen.getByTestId("production-review-failed");
    expect(failed).toHaveTextContent(sentence);
    // Not said twice over it.
    expect(failed).not.toHaveTextContent("The review could not finish.");
    // The review before it stays, below.
    expect(screen.getByTestId("production-review")).toBeTruthy();

    cleanup();
    drawTask(
      taskAnswer({
        task: summary({ state: CodeTaskState.Failed }),
        turns: [turn({ state: CodeTaskState.Failed, outcome: undefined })],
      }),
    );
    expect(screen.getByTestId("production-review-failed")).toHaveTextContent(
      "The review could not finish.",
    );
    /*
     * A first review that failed: Review again, at the end of its bar -
     * with no word on its next pushes, which no review has read yet.
     */
    expect(screen.getByTestId("production-review-again")).toBeEnabled();
    expect(screen.getByTestId("production-review-again")).toHaveClass(
      "ml-auto",
    );
    expect(screen.queryByTestId("production-review-updates")).toBeNull();
  });

  test("a review that was not done - a closed pull request, a draft - says why, quietly", () => {
    drawTask(
      taskAnswer({
        turns: [
          turn({
            outcome: undefined,
            errorMessage: "The pull request is closed, so it was not reviewed.",
          }),
        ],
      }),
    );

    expect(screen.getByTestId("production-review-skipped")).toHaveTextContent(
      "The pull request is closed, so it was not reviewed.",
    );
    expect(screen.queryByTestId("production-review-failed")).toBeNull();
  });

  test("Review again sits where a reply box would, saying when it is reviewed on its own", () => {
    const onReviewAgain: MockFunction = getJestMockFunction();
    drawTask(taskAnswer(), {
      onReviewAgain: onReviewAgain as unknown as () => void,
    });

    const footer: HTMLElement = screen.getByTestId("code-task-footer");
    expect(footer).toHaveTextContent(
      "Reviewed again each time the pull request changes.",
    );
    const button: HTMLElement = within(footer).getByTestId(
      "production-review-again",
    );
    expect(button).toHaveTextContent("Review again");
    expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(onReviewAgain).toHaveBeenCalledTimes(1);
    // No reply box: a review is not a conversation.
    expect(screen.queryByTestId("code-task-composer")).toBeNull();
  });

  test("with production review off, it says the pull request is reviewed again only when asked", () => {
    drawTask(
      taskAnswer({
        repository: {
          ...taskAnswer().repository!,
          isProductionReviewEnabled: false,
        },
      }),
    );

    expect(screen.getByTestId("code-task-footer")).toHaveTextContent(
      "Production review is off for this repository, so this pull request is reviewed again only when someone asks.",
    );
  });

  test("a pull request whose author cannot write to the repository says it is reviewed again only when asked, as its comment does", () => {
    drawTask(
      taskAnswer({
        turns: [
          turn({
            outcome: {
              summary: "",
              filesChanged: [],
              productionReview: report({
                pullRequest: {
                  ...report().pullRequest,
                  isFromFork: true,
                  isAuthorTrusted: false,
                },
              }),
            },
          }),
        ],
      }),
    );

    expect(screen.getByTestId("production-review-updates")).toHaveTextContent(
      "Its author cannot write to this repository, so it is reviewed again only when someone asks.",
    );
    // Review again is right there for those who may ask.
    expect(screen.getByTestId("production-review-again")).toBeEnabled();
  });

  test("the commit is named in words, its sha drawn as code", () => {
    drawTask(taskAnswer());

    const commit: HTMLElement = screen.getByTestId("production-review-commit");
    expect(commit).toHaveTextContent("Commit 4f2a9c1");
    expect(within(commit).getByText("4f2a9c1").className).toContain(
      "font-mono",
    );
    expect(within(commit).getByText("4f2a9c1")).not.toBe(commit);
  });

  test("someone who may only read is told why they cannot review it again; a repository no longer connected says so", () => {
    drawTask(taskAnswer({ canAsk: false }));
    expect(screen.queryByTestId("production-review-again")).toBeNull();
    expect(screen.getByTestId("production-review-read-only")).toHaveTextContent(
      "You can read this review. Reviewing it again takes permission to edit the repository - ask a project admin for it.",
    );

    cleanup();
    drawTask(
      taskAnswer({
        repository: { ...taskAnswer().repository!, isConnected: false },
      }),
    );
    expect(screen.queryByTestId("production-review-again")).toBeNull();
    const notConnected: HTMLElement = screen.getByTestId(
      "production-review-not-connected",
    );
    expect(notConnected).toHaveTextContent(
      "This repository is no longer connected through the GitHub App, so its pull requests cannot be reviewed again.",
    );
    // With its one fix beside it, as the Production Reviews page has it.
    const reconnect: HTMLElement = within(notConnected).getByTestId(
      "production-review-reconnect",
    );
    expect(reconnect).toHaveTextContent("Connect GitHub");
    expect(reconnect).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/code/repositories`,
    );
  });

  test("a refused Review again says why, at the top", () => {
    drawTask(taskAnswer(), {
      actionError:
        "Reviewing a pull request again takes permission to edit its repository - ask a project admin for it.",
    });

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Reviewing a pull request again takes permission to edit its repository",
    );
  });

  test("a pull request whose title is not known yet is named by its number", () => {
    drawTask(
      taskAnswer({
        task: untitled(),
        turns: [turn({ outcome: undefined })],
      }),
    );

    expect(screen.getByTestId("code-task-title")).toHaveTextContent(
      "Pull request #42",
    );
  });

  test("the latest review the task holds is read from its newest turn that has one", () => {
    const older: ProductionReviewReport = report({
      reviewedAt: minutesAgo(90),
    });
    const newer: ProductionReviewReport = report({ reviewedAt: minutesAgo(1) });

    expect(getLatestProductionReview([])).toBeNull();
    expect(
      getLatestProductionReview([
        turn({
          outcome: { summary: "", filesChanged: [], productionReview: older },
        }),
        turn({
          outcome: { summary: "", filesChanged: [], productionReview: newer },
        }),
        turn({ outcome: undefined }),
      ]),
    ).toBe(newer);
  });
});

describe("the task's page draws a production review as a review, not a conversation", () => {
  beforeEach(() => {
    goTo(`/dashboard/${PROJECT_ID}/code/tasks/${TASK_ID}`);
  });

  test("it reads the task and draws the review, with no reply box", async () => {
    getTaskMock.mockResolvedValue(taskAnswer() as never);

    draw(<CodeTaskConversation {...PAGE_PROPS} />);

    expect(await screen.findByTestId("production-review")).toBeTruthy();
    expect(screen.queryByTestId("code-task-composer")).toBeNull();
    expect(screen.queryByTestId("code-turn-request")).toBeNull();
    expect(getTaskMock).toHaveBeenCalledWith(TASK_ID);
  });

  test("Review again asks the server, then reads the task again", async () => {
    getTaskMock.mockResolvedValue(taskAnswer() as never);
    reviewAgainMock.mockResolvedValue(undefined as never);

    draw(<CodeTaskConversation {...PAGE_PROPS} />);

    fireEvent.click(await screen.findByTestId("production-review-again"));

    await waitFor(() => {
      expect(reviewAgainMock).toHaveBeenCalledWith(TASK_ID);
    });
    await waitFor(() => {
      expect(getTaskMock).toHaveBeenCalledTimes(2);
    });
  });

  test("a refused Review again says why", async () => {
    getTaskMock.mockResolvedValue(taskAnswer() as never);
    reviewAgainMock.mockRejectedValue(
      new Error(
        "Reviewing a pull request again takes permission to edit its repository - ask a project admin for it.",
      ) as never,
    );

    draw(<CodeTaskConversation {...PAGE_PROPS} />);

    fireEvent.click(await screen.findByTestId("production-review-again"));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Reviewing a pull request again takes permission to edit its repository",
    );
    // The button comes back once the answer is in.
    await waitFor(() => {
      expect(screen.getByTestId("production-review-again")).toBeEnabled();
    });
  });
});

describe("a repository's Production Reviews", () => {
  beforeEach(() => {
    goTo(
      `/dashboard/${PROJECT_ID}/code/repositories/${REPOSITORY_ID}/production-reviews`,
    );
    jest
      .spyOn(Navigation, "getLastParamAsObjectID")
      .mockReturnValue(new ObjectID(REPOSITORY_ID));
  });

  function repositoryAnswer(
    data: {
      isProductionReviewEnabled?: boolean;
      isGitHubCommandsEnabled?: boolean;
      isConnected?: boolean;
      canAsk?: boolean;
    } = {},
  ): Record<string, unknown> {
    return {
      repository: {
        id: REPOSITORY_ID,
        name: "checkout-api",
        organizationName: "acme",
        repositoryName: "checkout-api",
        isConnected: data.isConnected ?? true,
        isProductionReviewEnabled: data.isProductionReviewEnabled ?? true,
        isGitHubCommandsEnabled: data.isGitHubCommandsEnabled ?? true,
      },
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

  test("on: what it does, that it is on, the way to Settings, and the reviews - read as reviews, not tasks", async () => {
    getRepositoryMock.mockResolvedValue(repositoryAnswer() as never);
    listTasksMock.mockResolvedValue(
      listAnswer([
        summary({
          productionReview: {
            hasSignal: true,
            exceptionCount: 2,
            operationCount: 1,
            hotFunctionCount: 0,
            incidentCount: 0,
            suspectDeployCount: 0,
            headSha: HEAD_SHA,
            reviewedAt: minutesAgo(5),
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
      "OneUptime reviews pull requests against what production shows of the code they change, posts each review on its pull request and keeps it here.",
    );

    const status: HTMLElement = screen.getByTestId(
      "code-production-reviews-status",
    );
    expect(status).toHaveAttribute("data-production-review", "on");
    expect(status).toHaveTextContent("On");
    expect(status).toHaveTextContent(
      "A pull request from someone with write access is reviewed when it opens and each time it changes.",
    );
    // And how anyone else's is: the command, drawn as code.
    const others: HTMLElement = within(status).getByTestId(
      "code-production-reviews-status-others",
    );
    expect(others).toHaveTextContent(
      "A pull request from anyone else is reviewed when someone with write access comments @oneuptime production review on it.",
    );
    expect(
      within(others).getByText("@oneuptime production review").tagName,
    ).toBe("CODE");
    /*
     * The way to Settings lands on the switch itself: it is under More
     * settings, which opens there.
     */
    const settings: HTMLElement = within(status).getByTestId(
      "code-production-reviews-settings",
    );
    expect(settings).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/code/repositories/${REPOSITORY_ID}/settings#production-review`,
    );
    expect(settings).toHaveTextContent("Change in Settings");

    await waitFor(() => {
      expect(listTasksMock).toHaveBeenCalled();
    });
    expect(listTasksMock.mock.calls[0]![0]).toMatchObject({
      scope: { repositoryId: REPOSITORY_ID },
      kind: CodeTaskListKind.ProductionReviews,
      skip: 0,
    });

    // The list is of pull requests: its heading says so, not the page's name again.
    expect(
      within(screen.getByTestId("code-production-reviews-list")).getByRole(
        "heading",
      ),
    ).toHaveTextContent(/^Pull Requests/);

    const row: HTMLElement = await screen.findByTestId("code-task-row");
    expect(row).toHaveTextContent("Retry charges when the gateway times out");
    expect(row).toHaveTextContent("PR #42");
    expect(row).toHaveTextContent("2 exceptions");
    expect(row).toHaveTextContent("1 operation");
    // A row opens the review's page.
    expect(within(row).getByRole("link")).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/code/tasks/${TASK_ID}`,
    );
    expect(
      await screen.findByTestId("code-production-reviews-count"),
    ).toHaveTextContent("1");
  });

  test("off: it says how a pull request is still reviewed - the GitHub command, drawn as code", async () => {
    getRepositoryMock.mockResolvedValue(
      repositoryAnswer({ isProductionReviewEnabled: false }) as never,
    );
    listTasksMock.mockResolvedValue(listAnswer([]) as never);

    draw(<CodeRepositoryProductionReviews {...PAGE_PROPS} />);

    const status: HTMLElement = await screen.findByTestId(
      "code-production-reviews-status",
    );
    expect(status).toHaveAttribute("data-production-review", "off");
    expect(status).toHaveTextContent("Off");
    expect(status).toHaveTextContent(
      "A pull request is reviewed only when someone with write access comments @oneuptime production review on it.",
    );
    expect(
      within(status).getByText("@oneuptime production review").tagName,
    ).toBe("CODE");

    // Off, the one thing to do is to turn it on; nobody is told twice how to ask.
    expect(
      within(status).getByTestId("code-production-reviews-settings"),
    ).toHaveTextContent("Turn on in Settings");
    // At the switch, with More settings open there.
    expect(
      within(status).getByTestId("code-production-reviews-settings"),
    ).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/code/repositories/${REPOSITORY_ID}/settings#production-review`,
    );
    expect(
      screen.queryByTestId("code-production-reviews-status-others"),
    ).toBeNull();

    const empty: HTMLElement = await screen.findByTestId(
      "code-production-reviews-empty",
    );
    expect(empty).toHaveTextContent("No pull request reviewed yet");
    expect(empty).toHaveTextContent(
      "Each pull request's latest review shows up here.",
    );
    expect(empty).not.toHaveTextContent("production review");
    expect(screen.queryByTestId("code-production-reviews-count")).toBeNull();
  });

  test("on with none yet: the list says what it will hold; the status line says how a review comes", async () => {
    getRepositoryMock.mockResolvedValue(repositoryAnswer() as never);
    listTasksMock.mockResolvedValue(listAnswer([]) as never);

    draw(<CodeRepositoryProductionReviews {...PAGE_PROPS} />);

    expect(
      await screen.findByTestId("code-production-reviews-empty"),
    ).toHaveTextContent("Each pull request's latest review shows up here.");
  });

  test("with the GitHub App answering no command, the page never offers the command", async () => {
    getRepositoryMock.mockResolvedValue(
      repositoryAnswer({
        isProductionReviewEnabled: false,
        isGitHubCommandsEnabled: false,
      }) as never,
    );
    listTasksMock.mockResolvedValue(listAnswer([]) as never);

    draw(<CodeRepositoryProductionReviews {...PAGE_PROPS} />);

    const status: HTMLElement = await screen.findByTestId(
      "code-production-reviews-status",
    );
    /*
     * Review a pull request, on this page, still asks for one - for anyone
     * who may edit the repository in OneUptime, so "someone", not "someone
     * with write access" (which reads as access on GitHub).
     */
    expect(status).toHaveTextContent(
      "Pull requests are reviewed only when someone asks for one here.",
    );
    expect(status).not.toHaveTextContent("write access asks");
    expect(status).not.toHaveTextContent("production review on it");
    expect(status.querySelector("code")).toBeNull();
    expect(
      within(status).getByTestId("code-production-reviews-settings"),
    ).toHaveTextContent("Turn on in Settings");

    // On: anyone else's pull request is asked for here, never by command.
    cleanup();
    getRepositoryMock.mockResolvedValue(
      repositoryAnswer({ isGitHubCommandsEnabled: false }) as never,
    );
    draw(<CodeRepositoryProductionReviews {...PAGE_PROPS} />);
    expect(
      await screen.findByTestId("code-production-reviews-status"),
    ).toHaveTextContent(
      "A pull request from someone with write access is reviewed when it opens and each time it changes.",
    );
    const others: HTMLElement = screen.getByTestId(
      "code-production-reviews-status-others",
    );
    expect(others).toHaveTextContent(
      "A pull request from anyone else is reviewed only when someone asks for it here.",
    );
    expect(others.querySelector("code")).toBeNull();
  });

  test("a repository the GitHub App no longer reaches says nothing is reviewed, whatever its switch - and links to connect it", async () => {
    getRepositoryMock.mockResolvedValue(
      repositoryAnswer({ isConnected: false, canAsk: false }) as never,
    );
    listTasksMock.mockResolvedValue(listAnswer([]) as never);

    draw(<CodeRepositoryProductionReviews {...PAGE_PROPS} />);

    const status: HTMLElement = await screen.findByTestId(
      "code-production-reviews-status",
    );
    expect(status).toHaveAttribute("data-production-review", "not-connected");
    expect(status).toHaveTextContent("Not connected");
    expect(status).toHaveTextContent(
      "This repository is not connected through the GitHub App, so its pull requests are not reviewed.",
    );
    // Not "On", and no command that nothing would answer.
    expect(status).not.toHaveTextContent("each time it changes");
    expect(status.querySelector("code")).toBeNull();
    expect(
      within(status).getByTestId("code-production-reviews-connect"),
    ).toHaveAttribute("href", `/dashboard/${PROJECT_ID}/code/repositories`);
    expect(screen.queryByTestId("code-production-reviews-settings")).toBeNull();
  });

  test("the command names the app this OneUptime was set up with", async () => {
    process.env["GITHUB_APP_NAME"] = "Acme Code Bot";
    getRepositoryMock.mockResolvedValue(
      repositoryAnswer({ isProductionReviewEnabled: false }) as never,
    );
    listTasksMock.mockResolvedValue(listAnswer([]) as never);

    draw(<CodeRepositoryProductionReviews {...PAGE_PROPS} />);

    expect(
      await screen.findByTestId("code-production-reviews-status"),
    ).toHaveTextContent("@acme-code-bot production review");
  });

  test("someone who may only read gets no way to Settings", async () => {
    getRepositoryMock.mockResolvedValue(
      repositoryAnswer({ canAsk: false }) as never,
    );
    listTasksMock.mockResolvedValue(listAnswer([]) as never);

    draw(<CodeRepositoryProductionReviews {...PAGE_PROPS} />);

    await screen.findByTestId("code-production-reviews-status");
    expect(screen.queryByTestId("code-production-reviews-settings")).toBeNull();
  });

  test("a repository that cannot be read says why, with Try again", async () => {
    getRepositoryMock.mockRejectedValueOnce(
      new Error("The repository cannot be read right now.") as never,
    );
    getRepositoryMock.mockResolvedValue(repositoryAnswer() as never);
    listTasksMock.mockResolvedValue(listAnswer([]) as never);

    draw(<CodeRepositoryProductionReviews {...PAGE_PROPS} />);

    expect(
      await screen.findByText("The repository cannot be read right now."),
    ).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: /try again|refresh/i }),
      );
    });

    expect(
      await screen.findByTestId(CODE_PRODUCTION_REVIEWS_TEST_ID),
    ).toBeTruthy();
  });
});

describe("a review's row, trail and the repository's menu", () => {
  beforeEach(() => {
    goTo(`/dashboard/${PROJECT_ID}/code/repositories/${REPOSITORY_ID}`);
  });

  test("a row is its pull request: its title and number, what the latest review found - and no kind", () => {
    draw(
      <CodeTaskRow
        task={summary({
          productionReview: {
            hasSignal: false,
            exceptionCount: 0,
            operationCount: 0,
            hotFunctionCount: 0,
            incidentCount: 0,
            suspectDeployCount: 0,
            headSha: HEAD_SHA,
            reviewedAt: minutesAgo(5),
            posting: ProductionReviewPosting.None,
          },
        })}
      />,
    );

    const row: HTMLElement = screen.getByTestId("code-task-row");
    expect(row).toHaveTextContent("Retry charges when the gateway times out");
    expect(
      within(row).getByTestId("code-task-row-reviewed-pull-request"),
    ).toHaveTextContent("PR #42");
    expect(within(row).getByTestId("code-task-row-glance")).toHaveTextContent(
      "Nothing found",
    );
    expect(row).not.toHaveTextContent("Production Review");
  });

  test("a row whose review runs says Reviewing…; one with no title is named by its pull request", () => {
    draw(<CodeTaskRow task={untitled({ state: CodeTaskState.Working })} />);

    const row: HTMLElement = screen.getByTestId("code-task-row");
    expect(row).toHaveTextContent("Reviewing…");
    expect(row).toHaveTextContent("Pull request #42");
  });

  test("the trail of a review: Project, Code, the repository, Production Reviews, the pull request", () => {
    const trail: Array<Link> = getCodeTaskTrail({
      taskId: TASK_ID,
      response: taskAnswer(),
      translator: createTranslator(undefined, "en"),
    });

    expect(
      trail.map((link: Link): string => {
        return link.title;
      }),
    ).toEqual([
      "Project",
      "Code",
      "checkout-api",
      "Production Reviews",
      "Pull request #42",
    ]);
    expect(trail[3]!.to.toString()).toBe(
      `/dashboard/${PROJECT_ID}/code/repositories/${REPOSITORY_ID}/production-reviews`,
    );
    expect(trail[4]!.to.toString()).toBe(
      `/dashboard/${PROJECT_ID}/code/tasks/${TASK_ID}`,
    );
  });

  test("the repository's menu: Tasks, Production Reviews, Settings", () => {
    draw(<CodeRepositorySideMenu modelId={new ObjectID(REPOSITORY_ID)} />);

    const links: Array<[string, string | null]> = screen
      .getAllByRole("link")
      .map((link: HTMLElement): [string, string | null] => {
        return [link.textContent?.trim() || "", link.getAttribute("href")];
      });
    const titles: Array<string> = links.map(
      (link: [string, string | null]): string => {
        return link[0];
      },
    );

    expect(titles.indexOf("Production Reviews")).toBe(
      titles.indexOf("Tasks") + 1,
    );
    expect(titles.indexOf("Settings")).toBe(
      titles.indexOf("Production Reviews") + 1,
    );
    expect(
      links.find((link: [string, string | null]): boolean => {
        return link[0] === "Production Reviews";
      })![1],
    ).toBe(
      `/dashboard/${PROJECT_ID}/code/repositories/${REPOSITORY_ID}/production-reviews`,
    );
  });

  test("the page's trail: Project, Code, Repositories, the repository, Production Reviews", () => {
    const pattern: string = RouteUtil.getRouteString(
      PageMap.CODE_REPOSITORY_VIEW_PRODUCTION_REVIEWS,
    );
    const trail: Array<Link> | undefined = getCodeBreadcrumbs(pattern);

    expect(pattern).toBe(
      "/dashboard/:projectId/code/repositories/:id/production-reviews",
    );

    expect(
      (trail || []).map((link: Link): string => {
        return link.title;
      }),
    ).toEqual([
      "Project",
      "Code",
      "Repositories",
      "Repository",
      "Production Reviews",
    ]);
  });
});

/*
 * Which LLM provider read the review, when the repository picks one for its
 * production reviews (the follow-up #5398 left: the page did not say when
 * the pick was not used and the default ran instead). The pick, named where
 * What to watch says OneUptime AI read the facts; a pick that could not be
 * used, a warning saying which provider read it instead and why - wherever
 * the review says what AI did. No pick: nothing new.
 */
describe("the LLM provider that read the review", () => {
  beforeEach(() => {
    goTo(`/dashboard/${PROJECT_ID}/code/tasks/${TASK_ID}`);
  });

  test("the repository's pick, when it was used, is named under What to watch", () => {
    drawReview(
      report({
        llmProvider: {
          source: LlmProviderSource.RulePick,
          providerName: "Azure GPT-5",
        },
      }),
    );

    const points: HTMLElement = screen.getByTestId("production-review-points");
    const line: HTMLElement = within(points).getByTestId(
      "production-review-llm-provider",
    );

    expect(line).toHaveTextContent(
      "OneUptime AI read the facts below and the diff, with Azure GPT-5.",
    );
    expect(line).toHaveAttribute("data-llm-provider", "picked");
    expect(line).toHaveClass("text-gray-500");
    // It says what the plain line says, with the provider: never both.
    expect(points).not.toHaveTextContent(
      "OneUptime AI read the facts below and the diff.",
    );
  });

  test.each([
    [
      "deleted: the project's default read it",
      {
        source: LlmProviderSource.ProjectDefault,
        providerName: "Team OpenAI",
        fallbackReason: LlmProviderFallbackReason.Unavailable,
      },
      "This repository's LLM provider for production reviews is no longer available, so Team OpenAI, the project's default, read this review.",
    ],
    [
      "deleted, no default: the global provider read it",
      {
        source: LlmProviderSource.Global,
        providerName: "OneUptime AI",
        fallbackReason: LlmProviderFallbackReason.Unavailable,
      },
      "This repository's LLM provider for production reviews is no longer available, so OneUptime AI, the global LLM provider, read this review.",
    ],
    [
      "AI credits used up",
      {
        source: LlmProviderSource.ProjectDefault,
        providerName: "Team OpenAI",
        fallbackReason: LlmProviderFallbackReason.CreditsUsedUp,
      },
      "This repository's LLM provider for production reviews runs on AI credits, which are used up, so Team OpenAI, the project's default, read this review.",
    ],
    [
      "the daily AI spend limit",
      {
        source: LlmProviderSource.ProjectDefault,
        providerName: "Team OpenAI",
        fallbackReason: LlmProviderFallbackReason.SpendLimitReached,
      },
      "The daily AI spend limit stops this repository's LLM provider for production reviews, so Team OpenAI, the project's default, read this review.",
    ],
  ] as Array<[string, LlmProviderActivity, string]>)(
    "a pick that could not be used says which provider read it instead, and why: %s",
    (_label: string, activity: LlmProviderActivity, sentence: string) => {
      drawReview(report({ llmProvider: activity }));

      const points: HTMLElement = screen.getByTestId(
        "production-review-points",
      );
      const line: HTMLElement = within(points).getByTestId(
        "production-review-llm-provider",
      );

      expect(line).toHaveTextContent(sentence);
      expect(line).toHaveAttribute("data-llm-provider", "fell-back");
      expect(line).toHaveClass("text-amber-700");
      // Under the plain line, which still says what AI read.
      expect(points).toHaveTextContent(
        "OneUptime AI read the facts below and the diff.",
      );
    },
  );

  test("a pick with nothing to fall back to says so, and names no provider", () => {
    drawReview(
      report({
        points: [],
        aiNote: { code: ProductionReviewAiNoteCode.Failed },
        llmProvider: { fallbackReason: LlmProviderFallbackReason.Unavailable },
      }),
    );

    const note: HTMLElement = screen.getByTestId("production-review-ai-note");

    expect(note).toHaveTextContent(
      "OneUptime AI could not read this review this time. The facts below are complete.",
    );
    expect(
      within(note).getByTestId("production-review-llm-provider"),
    ).toHaveTextContent(
      "This repository's LLM provider for production reviews is no longer available, and there is no other to use.",
    );
  });

  test("a read that had nothing to watch still says when the pick was not used", () => {
    drawReview(
      report({
        points: [],
        llmProvider: {
          source: LlmProviderSource.ProjectDefault,
          providerName: "Team OpenAI",
          fallbackReason: LlmProviderFallbackReason.Unavailable,
        },
      }),
    );

    const note: HTMLElement = screen.getByTestId("production-review-ai-note");

    expect(note).not.toHaveAttribute("data-ai-note");
    const line: HTMLElement = within(note).getByTestId(
      "production-review-llm-provider",
    );
    expect(line).toHaveTextContent(
      "This repository's LLM provider for production reviews is no longer available, so Team OpenAI, the project's default, read this review.",
    );
    // Alone in its box: the box's own size, and no gap above it.
    expect(line).toHaveClass("text-sm");
    expect(line.className).not.toMatch(TOP_MARGIN);
  });

  test("a pick that was used says nothing when the read had nothing to watch", () => {
    drawReview(
      report({
        points: [],
        llmProvider: {
          source: LlmProviderSource.RulePick,
          providerName: "Azure GPT-5",
        },
      }),
    );

    expect(screen.queryByTestId("production-review-ai-note")).toBeNull();
    expect(screen.queryByTestId("production-review-llm-provider")).toBeNull();
  });

  test("no pick: nothing new - the plain line, and no provider named", () => {
    drawReview(report());

    expect(screen.queryByTestId("production-review-llm-provider")).toBeNull();
    expect(screen.getByTestId("production-review-points")).toHaveTextContent(
      "OneUptime AI read the facts below and the diff.",
    );
  });

  test("a provider's name is drawn as text, never as markup", () => {
    drawReview(
      report({
        llmProvider: {
          source: LlmProviderSource.RulePick,
          providerName: "<b>GPT</b> {{provider}}",
        },
      }),
    );

    const line: HTMLElement = screen.getByTestId(
      "production-review-llm-provider",
    );

    expect(line.querySelector("b")).toBeNull();
    expect(line).toHaveTextContent(
      "OneUptime AI read the facts below and the diff, with <b>GPT</b> {{provider}}.",
    );
  });

  test("a pick that could not be used is marked as a warning, not by its colour alone - with Change in Settings where it is picked again", () => {
    const settings: Route = new Route(
      `/dashboard/${PROJECT_ID}/code/repositories/${REPOSITORY_ID}/settings#production-review-llm-provider`,
    );

    draw(
      <CodeProductionReview
        report={report({
          llmProvider: {
            source: LlmProviderSource.ProjectDefault,
            providerName: "Team OpenAI",
            fallbackReason: LlmProviderFallbackReason.Unavailable,
          },
        })}
        llmProviderSettingsRoute={settings}
      />,
    );

    const line: HTMLElement = screen.getByTestId(
      "production-review-llm-provider",
    );
    // A warning mark beside the words.
    expect(line.querySelector("svg")).not.toBeNull();
    const link: HTMLElement = within(line).getByTestId(
      "production-review-llm-provider-settings",
    );
    expect(link).toHaveTextContent("Change in Settings");
    expect(link).toHaveAttribute("href", settings.toString());
    expect(line).toHaveTextContent(
      "This repository's LLM provider for production reviews is no longer available, so Team OpenAI, the project's default, read this review. Change in Settings",
    );
  });

  test("a pick that was used links nowhere and is marked as nothing: there is nothing to fix", () => {
    draw(
      <CodeProductionReview
        report={report({
          llmProvider: {
            source: LlmProviderSource.RulePick,
            providerName: "Azure GPT-5",
          },
        })}
        llmProviderSettingsRoute={
          new Route(
            `/dashboard/${PROJECT_ID}/code/repositories/${REPOSITORY_ID}/settings#production-review-llm-provider`,
          )
        }
      />,
    );

    const line: HTMLElement = screen.getByTestId(
      "production-review-llm-provider",
    );
    expect(line.querySelector("svg")).toBeNull();
    expect(
      screen.queryByTestId("production-review-llm-provider-settings"),
    ).toBeNull();
  });

  test("the review's page links a pick that could not be used to the repository's setting - for those who may change it", () => {
    const fellBack: CodeTaskTurnJSON = turn({
      outcome: {
        summary: "",
        filesChanged: [],
        productionReview: report({
          llmProvider: {
            source: LlmProviderSource.ProjectDefault,
            providerName: "Team OpenAI",
            fallbackReason: LlmProviderFallbackReason.Unavailable,
          },
        }),
      },
    });

    draw(
      <CodeProductionReviewTask
        data={taskAnswer({ turns: [fellBack] })}
        onReviewAgain={(): void => {}}
        isAskingAgain={false}
      />,
    );

    expect(
      screen.getByTestId("production-review-llm-provider-settings"),
    ).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/code/repositories/${REPOSITORY_ID}/settings#production-review-llm-provider`,
    );

    // Someone who may only read is told what happened, with no way to it.
    cleanup();
    draw(
      <CodeProductionReviewTask
        data={taskAnswer({ turns: [fellBack], canAsk: false })}
        onReviewAgain={(): void => {}}
        isAskingAgain={false}
      />,
    );
    expect(
      screen.getByTestId("production-review-llm-provider"),
    ).toHaveAttribute("data-llm-provider", "fell-back");
    expect(
      screen.queryByTestId("production-review-llm-provider-settings"),
    ).toBeNull();
  });

  test("in German the line is German, and the provider keeps the name the project gave it", async () => {
    const german: i18n = createInstance();

    await german.use(initReactI18next).init({
      lng: "de",
      fallbackLng: "en",
      resources: {
        en: { translation: englishLocale },
        de: { translation: germanLocale },
      },
      interpolation: { escapeValue: false },
    });

    render(
      <I18nextProvider i18n={german}>
        <CodeProductionReview
          report={report({
            llmProvider: {
              source: LlmProviderSource.ProjectDefault,
              providerName: "Team OpenAI",
              fallbackReason: LlmProviderFallbackReason.CreditsUsedUp,
            },
          })}
        />
      </I18nextProvider>,
    );

    expect(
      screen.getByTestId("production-review-llm-provider"),
    ).toHaveTextContent(
      "Der LLM-Anbieter dieses Repositorys für Produktionsprüfungen läuft mit KI-Guthaben, das aufgebraucht ist, daher hat Team OpenAI, der Standard-Anbieter des Projekts, diese Prüfung gelesen.",
    );
  });

  test("getProductionReviewProviderLine: one sentence per outcome, a warning whenever the pick was not used", () => {
    expect(getProductionReviewProviderLine(undefined)).toBeNull();
    expect(getProductionReviewProviderLine(null)).toBeNull();
    expect(
      getProductionReviewProviderLine({
        source: LlmProviderSource.RulePick,
        providerName: "Azure GPT-5",
      }),
    ).toEqual({
      template: PRODUCTION_REVIEW_PROVIDER_COPY.readWith,
      providerName: "Azure GPT-5",
      isWarning: false,
    });
    expect(
      getProductionReviewProviderLine({
        source: LlmProviderSource.ProjectDefault,
        providerName: "Team OpenAI",
        fallbackReason: LlmProviderFallbackReason.Unavailable,
      }),
    ).toEqual({
      template: PRODUCTION_REVIEW_PROVIDER_COPY.unavailableToProjectDefault,
      providerName: "Team OpenAI",
      isWarning: true,
    });
    expect(
      getProductionReviewProviderLine({
        source: LlmProviderSource.Global,
        providerName: "OneUptime AI",
        fallbackReason: LlmProviderFallbackReason.Unavailable,
      })!.template,
    ).toBe(PRODUCTION_REVIEW_PROVIDER_COPY.unavailableToGlobal);
    expect(
      getProductionReviewProviderLine({
        fallbackReason: LlmProviderFallbackReason.Unavailable,
      }),
    ).toEqual({
      template: PRODUCTION_REVIEW_PROVIDER_COPY.unavailableToNone,
      providerName: "",
      isWarning: true,
    });

    // Every sentence is one key the locales word, with the slot it fills.
    const sentences: Array<string> = Object.values(
      PRODUCTION_REVIEW_PROVIDER_COPY,
    );

    expect(new Set(sentences).size).toBe(sentences.length);
    for (const sentence of sentences) {
      expect(
        (englishLocale as unknown as Record<string, string>)[sentence],
      ).toBe(sentence);
      expect(sentence.includes("{{provider}}")).toBe(
        sentence !== PRODUCTION_REVIEW_PROVIDER_COPY.unavailableToNone,
      );
    }
  });
});
