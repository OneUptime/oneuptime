import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  RenderResult,
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import React from "react";
import { MemoryRouter, Route as PageRoute, Routes } from "react-router-dom";
import IncidentAlertAiInsightsPage from "../../../../App/FeatureSet/Dashboard/src/Components/IncidentAlertAi/IncidentAlertAiInsightsPage";
import AlertAIInsights from "../../../../App/FeatureSet/Dashboard/src/Pages/Alerts/AI/Insights";
import IncidentAIInsights from "../../../../App/FeatureSet/Dashboard/src/Pages/Incidents/AI/Insights";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Route from "../../../Types/API/Route";
import {
  IncidentAlertAiAttentionKind,
  IncidentAlertAiAttentionSeverity,
} from "../../../Types/AI/IncidentAlertAiInsights";
import { IncidentAlertAiSubjectKind } from "../../../Types/AI/IncidentAlertAiLogs";
import { JSONObject } from "../../../Types/JSON";
import Permission from "../../../Types/Permission";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import PermissionUtil from "../../../UI/Utils/Permission";
import { PROJECT_ID, goTo } from "./SideMenuHarness";

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

/*
 * The AI Insights page of the Incidents and Alerts menus (AI → Insights),
 * rendered for real on its real route for each product, with the insights
 * route stubbed. It answers "what has OneUptime AI learned here, and what
 * needs a look?": the problems that keep coming back and what AI found about
 * them, the monitors and services behind them, how the fixes turned out, how
 * much AI investigated and why it skipped the rest.
 */

const WAIT_TIMEOUT: number = 20000;

const SUBJECT_ID: string = "aaaaaaaa-0000-4000-8000-000000000001";
const OLDER_SUBJECT_ID: string = "aaaaaaaa-0000-4000-8000-000000000002";
const MONITOR_ID: string = "bbbbbbbb-0000-4000-8000-000000000001";
const SERVICE_ID: string = "cccccccc-0000-4000-8000-000000000001";

interface Product {
  subjectKind: IncidentAlertAiSubjectKind;
  insightsPage: PageMap;
  logsPage: PageMap;
  settingsPage: PageMap;
  viewPage: PageMap;
  route: string;
  page: React.FunctionComponent<{
    pageRoute: Route;
    currentProject: null;
    hasPaymentMethod: boolean;
  }>;
  subtitle: string;
  plural: string;
  coverageTile: string;
  coverageSentence: string;
  turnedOffReason: string;
  reviewSettings: string;
  emptyDescription: string;
}

const PRODUCTS: Array<Product> = [
  {
    subjectKind: "incident",
    insightsPage: PageMap.INCIDENTS_AI_INSIGHTS,
    logsPage: PageMap.INCIDENTS_AI_LOGS,
    settingsPage: PageMap.INCIDENTS_SETTINGS_AI,
    viewPage: PageMap.INCIDENT_VIEW,
    route: "/ai-activity/incident/insights",
    page: IncidentAIInsights,
    subtitle:
      "What OneUptime AI learned from your incidents over the last 30 days: what keeps happening, what its investigations found, which monitors and services keep failing, and how its fixes turned out.",
    plural: "incidents",
    coverageTile: "Incidents investigated",
    coverageSentence:
      "OneUptime AI investigated 12 of the 20 incidents created in the last 30 days.",
    turnedOffReason: "Automatic investigation of new incidents is turned off.",
    reviewSettings: "Review incident AI settings",
    emptyDescription:
      "OneUptime AI has not investigated or fixed an incident in the last 30 days.",
  },
  {
    subjectKind: "alert",
    insightsPage: PageMap.ALERTS_AI_INSIGHTS,
    logsPage: PageMap.ALERTS_AI_LOGS,
    settingsPage: PageMap.ALERTS_SETTINGS_AI,
    viewPage: PageMap.ALERT_VIEW,
    route: "/ai-activity/alert/insights",
    page: AlertAIInsights,
    subtitle:
      "What OneUptime AI learned from your alerts over the last 30 days: what keeps happening, what its investigations found, which monitors and services keep failing, and how its fixes turned out.",
    plural: "alerts",
    coverageTile: "Alerts investigated",
    coverageSentence:
      "OneUptime AI investigated 12 of the 20 alerts created in the last 30 days.",
    turnedOffReason: "Automatic investigation of new alerts is turned off.",
    reviewSettings: "Review alert AI settings",
    emptyDescription:
      "OneUptime AI has not investigated or fixed an alert in the last 30 days.",
  },
];

function subject(product: Product, overrides: JSONObject = {}): JSONObject {
  return {
    kind: product.subjectKind,
    id: SUBJECT_ID,
    title: "Disk full on db-1",
    number: 42,
    numberWithPrefix: "#42",
    ...overrides,
  };
}

function problem(product: Product, overrides: JSONObject = {}): JSONObject {
  return {
    key: "problem-00000001",
    title: "Disk full on db-1",
    investigationCount: 5,
    subjectCount: 4,
    isRecurring: true,
    firstSeenAt: "2026-09-20T00:00:00.000Z",
    lastSeenAt: "2026-10-04T00:00:00.000Z",
    latestSubject: subject(product),
    monitors: [{ id: MONITOR_ID, name: "Database disk" }],
    latestFinding: {
      aiRunId: "run-1",
      text: "Application logs filled the data volume.",
      at: "2026-10-04T00:01:00.000Z",
    },
    verdicts: {
      confirmed: 1,
      rejected: 0,
      matched: 2,
      partlyMatched: 0,
      mismatched: 0,
    },
    fixes: {
      proposed: 2,
      applied: 1,
      verified: 1,
      failed: 0,
      awaitingApproval: 1,
    },
    ...overrides,
  };
}

function insights(product: Product, overrides: JSONObject = {}): JSONObject {
  return {
    subjectKind: product.subjectKind,
    windowInDays: 30,
    windowStart: "2026-09-06T00:00:00.000Z",
    generatedAt: "2026-10-05T10:00:00.000Z",
    totals: {
      investigations: 12,
      completedInvestigations: 10,
      failedInvestigations: 2,
      activeInvestigations: 0,
      problems: 4,
      recurringProblems: 2,
      fixes: 5,
      fixTasks: 2,
      commands: 30,
      failedCommands: 2,
      timedOutCommands: 1,
    },
    coverage: {
      subjects: 20,
      investigatedSubjects: 12,
      notInvestigated: [
        { code: "automatic_investigation_disabled", count: 6 },
        { code: "severity_below_threshold", count: 2 },
      ],
    },
    attention: [
      {
        kind: IncidentAlertAiAttentionKind.FixesFailed,
        severity: IncidentAlertAiAttentionSeverity.High,
        count: 1,
        total: 3,
      },
      {
        kind: IncidentAlertAiAttentionKind.InvestigationsNotStarted,
        severity: IncidentAlertAiAttentionSeverity.High,
        count: 6,
        reason: "provider_missing",
      },
      {
        kind: IncidentAlertAiAttentionKind.RecurringProblem,
        severity: IncidentAlertAiAttentionSeverity.High,
        count: 5,
        recentCount: 3,
        problemKey: "problem-00000001",
        title: "Disk full on db-1",
        subject: subject(product),
      },
      {
        kind: IncidentAlertAiAttentionKind.MonitorHotspot,
        severity: IncidentAlertAiAttentionSeverity.Medium,
        count: 6,
        total: 12,
        monitor: { id: MONITOR_ID, name: "Database disk" },
      },
    ],
    problems: [
      problem(product),
      problem(product, {
        key: "problem-00000002",
        title: "Checkout latency",
        investigationCount: 1,
        subjectCount: 1,
        isRecurring: false,
        latestSubject: subject(product, {
          id: OLDER_SUBJECT_ID,
          title: "Checkout latency",
          number: 41,
          numberWithPrefix: "#41",
        }),
        monitors: [],
        latestFinding: null,
        verdicts: {},
        fixes: {},
      }),
    ],
    monitors: [
      {
        id: MONITOR_ID,
        name: "Database disk",
        subjectCount: 4,
        investigationCount: 5,
        problemCount: 1,
        lastSeenAt: "2026-10-04T00:00:00.000Z",
      },
    ],
    services: [
      {
        id: SERVICE_ID,
        name: "Payments",
        subjectCount: 1,
        investigationCount: 2,
        problemCount: 1,
        lastSeenAt: "2026-10-03T00:00:00.000Z",
      },
    ],
    fixOutcomes: {
      total: 5,
      planning: 0,
      awaitingApproval: 1,
      appliedAutomatically: 2,
      appliedAfterApproval: 1,
      dismissed: 1,
      noFixFound: 0,
      verified: 2,
      failed: 1,
      verifying: 0,
    },
    fixTaskOutcomes: {
      total: 2,
      pullRequestsOpened: 1,
      noFixFound: 1,
      inProgress: 0,
      failed: 0,
      cancelled: 0,
    },
    verdicts: {
      confirmed: 1,
      rejected: 0,
      matched: 2,
      partlyMatched: 0,
      mismatched: 0,
    },
    trend: [
      {
        date: "2026-10-03",
        investigations: 1,
        failedInvestigations: 0,
        fixes: 0,
      },
      {
        date: "2026-10-04",
        investigations: 3,
        failedInvestigations: 1,
        fixes: 2,
      },
      {
        date: "2026-10-05",
        investigations: 0,
        failedInvestigations: 0,
        fixes: 0,
      },
    ],
    isPartial: false,
    ...overrides,
  };
}

// The insights of a window in which AI did nothing at all.
function quiet(product: Product, overrides: JSONObject = {}): JSONObject {
  return insights(product, {
    totals: {
      investigations: 0,
      completedInvestigations: 0,
      failedInvestigations: 0,
      activeInvestigations: 0,
      problems: 0,
      recurringProblems: 0,
      fixes: 0,
      fixTasks: 0,
      commands: 0,
      failedCommands: 0,
      timedOutCommands: 0,
    },
    coverage: {
      subjects: 7,
      investigatedSubjects: 0,
      notInvestigated: [{ code: "provider_missing", count: 7 }],
    },
    attention: [],
    problems: [],
    monitors: [],
    services: [],
    fixOutcomes: null,
    trend: [],
    ...overrides,
  });
}

type Answer = () => Promise<HTTPResponse<JSONObject> | HTTPErrorResponse>;

function ok(body: unknown): Answer {
  return async (): Promise<HTTPResponse<JSONObject>> => {
    return new HTTPResponse<JSONObject>(200, body as JSONObject, {});
  };
}

function httpError(statusCode: number, message: string): Answer {
  return async (): Promise<HTTPErrorResponse> => {
    return new HTTPErrorResponse(statusCode, { message }, {});
  };
}

// An answer the test releases when it wants: a request still in flight.
function deferred(): {
  answer: Answer;
  release: (body: unknown) => void;
} {
  let release: (body: unknown) => void = (): void => {
    return undefined;
  };
  const promise: Promise<HTTPResponse<JSONObject>> = new Promise<
    HTTPResponse<JSONObject>
  >((resolve: (value: HTTPResponse<JSONObject>) => void) => {
    release = (body: unknown): void => {
      resolve(new HTTPResponse<JSONObject>(200, body as JSONObject, {}));
    };
  });

  return {
    answer: (): Promise<HTTPResponse<JSONObject>> => {
      return promise;
    },
    release: (body: unknown): void => {
      release(body);
    },
  };
}

let postSpy: ReturnType<typeof jest.spyOn>;
let answers: Array<Answer> = [];

function serve(...queue: Array<Answer>): void {
  answers = [...queue];
}

function requestsTo(route: string): Array<JSONObject> {
  return postSpy.mock.calls
    .map((call: Array<unknown>): JSONObject => {
      return (call[0] || {}) as JSONObject;
    })
    .filter((request: JSONObject): boolean => {
      return String(request["url"]).endsWith(route);
    })
    .map((request: JSONObject): JSONObject => {
      return (request["data"] || {}) as JSONObject;
    });
}

function pathOf(page: PageMap, modelId?: string): string {
  return RouteMap[page]!.toString()
    .replace(":projectId", PROJECT_ID)
    .replace(":id", modelId || ":id");
}

function openPage(product: Product): void {
  const path: string = pathOf(product.insightsPage);
  goTo(path);
  const Page: Product["page"] = product.page;

  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <PageRoute
          path={String(RouteMap[product.insightsPage])}
          element={
            <Page
              pageRoute={RouteMap[product.insightsPage] as Route}
              currentProject={null}
              hasPaymentMethod={true}
            />
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

async function findTestId(testId: string): Promise<HTMLElement> {
  return await screen.findByTestId(testId, {}, { timeout: WAIT_TIMEOUT });
}

function hrefOf(element: HTMLElement): string {
  return element.closest("a")?.getAttribute("href") || "";
}

function attentionItems(): Array<HTMLElement> {
  return screen.queryAllByTestId("ai-insights-attention-item");
}

function setPermissions(permissions: Array<Permission>): void {
  jest.spyOn(PermissionUtil, "getAllPermissions").mockReturnValue(permissions);
}

beforeEach(() => {
  window.localStorage.clear();
  answers = [];

  postSpy = jest.spyOn(API, "post");
  postSpy.mockImplementation(
    async (
      request: unknown,
    ): Promise<HTTPResponse<JSONObject> | HTTPErrorResponse> => {
      const url: string = String((request as JSONObject)["url"]);

      if (url.includes("/ai-activity/")) {
        const answer: Answer | undefined =
          answers.length > 1 ? answers.shift() : answers[0];

        if (!answer) {
          throw new Error(`No answer queued for ${url}`);
        }

        return await answer();
      }

      throw new Error(`Unexpected request to ${url}`);
    },
  );
  jest.spyOn(ModelAPI, "getCommonHeaders").mockReturnValue({});
  setPermissions([Permission.ProjectOwner]);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe.each(
  PRODUCTS.map((product: Product) => {
    return [product.subjectKind, product];
  }),
)("the %s AI Insights page", (_name: unknown, product: Product) => {
  test("says what it is, points at the record behind it, and asks this product's insights route", async () => {
    serve(ok(insights(product)));
    openPage(product);

    const heading: HTMLElement = await findTestId("ai-insights-page-heading");

    expect(heading).toHaveTextContent("AI Insights");
    expect(heading).toHaveTextContent(product.subtitle);
    expect(
      hrefOf(within(heading).getByText("See everything AI did in AI → Logs")),
    ).toBe(pathOf(product.logsPage));

    await findTestId("ai-insights-tiles");

    expect(requestsTo(product.route)).toEqual([{}]);
    expect(
      postSpy.mock.calls.every((call: Array<unknown>): boolean => {
        return String((call[0] as JSONObject)["url"]).endsWith(product.route);
      }),
    ).toBe(true);
  });

  test("shows a loader while the insights load", async () => {
    const pending: { answer: Answer; release: (body: unknown) => void } =
      deferred();
    serve(pending.answer);
    openPage(product);

    expect(await findTestId("ai-insights-loading")).toBeInTheDocument();
    expect(screen.queryByTestId("ai-insights-tiles")).not.toBeInTheDocument();

    await act(async () => {
      pending.release(insights(product));
    });

    await findTestId("ai-insights-tiles");
    expect(screen.queryByTestId("ai-insights-loading")).not.toBeInTheDocument();
  });

  test("the tiles: how much AI investigated, how much of what came in, the fixes that went in, and what keeps coming back", async () => {
    serve(ok(insights(product)));
    openPage(product);

    await findTestId("ai-insights-tiles");

    const investigations: HTMLElement = screen.getByTestId(
      "ai-insights-tile-investigations",
    );
    expect(investigations).toHaveTextContent("Investigations");
    expect(investigations).toHaveTextContent("12");
    expect(investigations).toHaveTextContent("Failed: 2");

    const coverage: HTMLElement = screen.getByTestId(
      "ai-insights-tile-coverage",
    );
    expect(coverage).toHaveTextContent(product.coverageTile);
    expect(coverage).toHaveTextContent("12 of 20");
    expect(coverage).toHaveTextContent("Created in the last 30 days");

    const fixes: HTMLElement = screen.getByTestId("ai-insights-tile-fixes");
    // Two applied on their own, one after approval, out of five.
    expect(fixes).toHaveTextContent("Fixes applied");
    expect(fixes).toHaveTextContent("3 of 5");
    expect(fixes).toHaveTextContent("Worked: 2");

    const recurring: HTMLElement = screen.getByTestId(
      "ai-insights-tile-recurring",
    );
    expect(recurring).toHaveTextContent("Recurring problems");
    expect(recurring).toHaveTextContent("2");
    expect(recurring).toHaveTextContent("Out of 4 problems");
  });

  test("needs attention: in the server's order, each in its own words, with where to go", async () => {
    serve(ok(insights(product)));
    openPage(product);

    await findTestId("ai-insights-attention");

    const items: Array<HTMLElement> = attentionItems();

    expect(
      items.map((item: HTMLElement): Array<string | null> => {
        return [
          item.getAttribute("data-kind"),
          item.getAttribute("data-severity"),
        ];
      }),
    ).toEqual([
      [
        IncidentAlertAiAttentionKind.FixesFailed,
        IncidentAlertAiAttentionSeverity.High,
      ],
      [
        IncidentAlertAiAttentionKind.InvestigationsNotStarted,
        IncidentAlertAiAttentionSeverity.High,
      ],
      [
        IncidentAlertAiAttentionKind.RecurringProblem,
        IncidentAlertAiAttentionSeverity.High,
      ],
      [
        IncidentAlertAiAttentionKind.MonitorHotspot,
        IncidentAlertAiAttentionSeverity.Medium,
      ],
    ]);

    const [failedFixes, notStarted, recurring, hotspot] = items as [
      HTMLElement,
      HTMLElement,
      HTMLElement,
      HTMLElement,
    ];

    expect(failedFixes).toHaveTextContent(
      "1 fix OneUptime AI applied did not fix the problem",
    );
    expect(failedFixes).toHaveTextContent(
      "Out of 3 fixes applied in the last 30 days.",
    );

    expect(notStarted).toHaveTextContent(
      `6 ${product.plural} were not investigated`,
    );
    expect(notStarted).toHaveTextContent(
      "There is no LLM provider OneUptime AI can use.",
    );
    expect(
      hrefOf(within(notStarted).getByText("Configure an AI provider")),
    ).toBe(pathOf(PageMap.SETTINGS_AI_LLM_PROVIDERS));

    expect(recurring).toHaveTextContent(
      "“Disk full on db-1” was investigated 5 times",
    );
    expect(recurring).toHaveTextContent("3 of them in the last 7 days.");
    expect(hrefOf(within(recurring).getByText("#42 Disk full on db-1"))).toBe(
      pathOf(product.viewPage, SUBJECT_ID),
    );

    expect(hotspot).toHaveTextContent(
      "Database disk was behind 6 investigations",
    );
    expect(hotspot).toHaveTextContent(
      "Out of 12 investigations in the last 30 days.",
    );
    expect(hrefOf(within(hotspot).getByText("Database disk"))).toBe(
      pathOf(PageMap.MONITOR_VIEW, MONITOR_ID),
    );
  });

  test("the way to fix a skipped investigation is offered to who may take it; anyone else is told who can", async () => {
    setPermissions([Permission.ProjectMember]);
    serve(
      ok(
        insights(product, {
          attention: [
            {
              kind: IncidentAlertAiAttentionKind.InvestigationsNotStarted,
              severity: IncidentAlertAiAttentionSeverity.Low,
              count: 6,
              reason: "automatic_investigation_disabled",
            },
            {
              kind: IncidentAlertAiAttentionKind.InvestigationsNotStarted,
              severity: IncidentAlertAiAttentionSeverity.Medium,
              count: 2,
              reason: "budget_check_failed",
            },
          ],
        }),
      ),
    );
    openPage(product);

    await findTestId("ai-insights-attention");

    const [turnedOff, unchecked] = attentionItems() as [
      HTMLElement,
      HTMLElement,
    ];

    expect(turnedOff).toHaveTextContent(product.turnedOffReason);
    expect(
      within(turnedOff).queryByText(product.reviewSettings),
    ).not.toBeInTheDocument();
    expect(
      within(turnedOff).getByTestId("ai-insights-attention-who-can-act"),
    ).toHaveTextContent("A project administrator can review these settings.");

    // Nothing to change when the check itself failed: no link, no one to ask.
    expect(unchecked).toHaveTextContent(
      "The daily AI token limit could not be checked.",
    );
    expect(within(unchecked).queryByRole("link")).not.toBeInTheDocument();
    expect(
      within(unchecked).queryByTestId("ai-insights-attention-who-can-act"),
    ).not.toBeInTheDocument();
  });

  test("a project admin gets the link to this product's AI settings", async () => {
    setPermissions([Permission.ProjectAdmin]);
    serve(
      ok(
        insights(product, {
          attention: [
            {
              kind: IncidentAlertAiAttentionKind.InvestigationsNotStarted,
              severity: IncidentAlertAiAttentionSeverity.Low,
              count: 6,
              reason: "automatic_investigation_disabled",
            },
          ],
        }),
      ),
    );
    openPage(product);

    await findTestId("ai-insights-attention");

    expect(
      hrefOf(within(attentionItems()[0]!).getByText(product.reviewSettings)),
    ).toBe(pathOf(product.settingsPage));
  });

  test("no attention card when nothing needs a look", async () => {
    serve(ok(insights(product, { attention: [] })));
    openPage(product);

    await findTestId("ai-insights-problems");

    expect(
      screen.queryByTestId("ai-insights-attention"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Needs attention")).not.toBeInTheDocument();
  });

  test("what keeps happening: each problem with how often, what AI found, its monitors and the latest one", async () => {
    serve(ok(insights(product)));
    openPage(product);

    const problems: Array<HTMLElement> = within(
      await findTestId("ai-insights-problems"),
    ).getAllByTestId("ai-insights-problem");

    expect(problems).toHaveLength(2);

    const [diskFull, latency] = problems as [HTMLElement, HTMLElement];

    expect(diskFull).toHaveTextContent("Disk full on db-1");
    expect(diskFull).toHaveTextContent("Recurring");
    expect(diskFull).toHaveTextContent("Investigated 5 times");
    expect(diskFull).toHaveTextContent(`4 ${product.plural}`);
    expect(diskFull.querySelector("time")?.getAttribute("dateTime")).toBe(
      "2026-10-04T00:00:00.000Z",
    );
    expect(diskFull).toHaveTextContent(/Last seen /);
    expect(
      within(diskFull).getByTestId("ai-insights-problem-finding"),
    ).toHaveTextContent(
      "What AI found: Application logs filled the data volume.",
    );
    expect(hrefOf(within(diskFull).getByText("Database disk"))).toBe(
      pathOf(PageMap.MONITOR_VIEW, MONITOR_ID),
    );
    expect(diskFull).toHaveTextContent("Confirmed by your team: 1");
    expect(diskFull).toHaveTextContent(
      "Fixes: 2 proposed, 1 applied, 1 worked",
    );
    expect(diskFull).not.toHaveTextContent("Rejected by your team");
    expect(hrefOf(within(diskFull).getByText("#42 Disk full on db-1"))).toBe(
      pathOf(product.viewPage, SUBJECT_ID),
    );

    expect(latency).toHaveTextContent("Checkout latency");
    expect(latency).not.toHaveTextContent("Recurring");
    expect(latency).toHaveTextContent("Investigated 1 time");
    expect(latency).toHaveTextContent(`1 ${product.plural.replace(/s$/, "")}`);
    expect(latency).toHaveTextContent("No finding was recorded yet.");
    expect(
      within(latency).queryByTestId("ai-insights-problem-finding"),
    ).not.toBeInTheDocument();
    expect(latency).not.toHaveTextContent("Fixes:");
    expect(hrefOf(within(latency).getByText("#41 Checkout latency"))).toBe(
      pathOf(product.viewPage, OLDER_SUBJECT_ID),
    );
  });

  test("what the server wrote is shown as text, never as markup", async () => {
    const markup: string = '<img src="x" onerror="window.hacked=1">';

    serve(
      ok(
        insights(product, {
          problems: [
            problem(product, {
              title: markup,
              latestFinding: { aiRunId: "run-1", text: markup },
            }),
          ],
        }),
      ),
    );
    openPage(product);

    const problems: HTMLElement = await findTestId("ai-insights-problems");

    expect(problems).toHaveTextContent(markup);
    expect(problems.querySelector("img")).toBeNull();
  });

  test("with fixes but no investigation, the problems card says nothing was investigated", async () => {
    serve(
      ok(
        insights(product, {
          totals: {
            investigations: 0,
            problems: 0,
            recurringProblems: 0,
            fixes: 1,
            fixTasks: 0,
          },
          attention: [],
          problems: [],
          monitors: [],
          services: [],
        }),
      ),
    );
    openPage(product);

    expect(await findTestId("ai-insights-no-problems")).toHaveTextContent(
      "OneUptime AI has not investigated anything in the last 30 days.",
    );
    expect(screen.queryByTestId("ai-insights-empty")).not.toBeInTheDocument();
  });

  test("the monitors and services that keep failing link to their own pages; an empty list says so", async () => {
    serve(ok(insights(product)));
    openPage(product);

    const monitors: HTMLElement = await findTestId("ai-insights-monitors");

    expect(hrefOf(within(monitors).getByText("Database disk"))).toBe(
      pathOf(PageMap.MONITOR_VIEW, MONITOR_ID),
    );
    expect(monitors).toHaveTextContent(`4 ${product.plural} investigated`);

    const services: HTMLElement = screen.getByTestId("ai-insights-services");

    expect(hrefOf(within(services).getByText("Payments"))).toBe(
      pathOf(PageMap.SERVICE_VIEW, SERVICE_ID),
    );
    expect(services).toHaveTextContent(
      `1 ${product.plural.replace(/s$/, "")} investigated`,
    );

    cleanup();
    serve(ok(insights(product, { monitors: [], services: [] })));
    openPage(product);

    expect(await findTestId("ai-insights-monitors-empty")).toHaveTextContent(
      "No monitor came up more than once.",
    );
    expect(screen.getByTestId("ai-insights-services-empty")).toHaveTextContent(
      "No service came up more than once.",
    );
  });

  test("how the fixes turned out, and the fix pull requests", async () => {
    serve(ok(insights(product)));
    openPage(product);

    const outcomes: HTMLElement = await findTestId("ai-insights-fix-outcomes");
    const rows: Array<string> = within(outcomes)
      .getAllByRole("listitem")
      .map((row: HTMLElement): string => {
        return row.textContent || "";
      });

    expect(rows).toEqual([
      "Proposed5",
      "Applied automatically2",
      "Applied after approval1",
      "Waiting for approval1",
      "Dismissed1",
      "No fix found0",
      "Worked2",
      "Did not work1",
      "Still checking0",
    ]);

    const tasks: Array<string> = within(
      screen.getByTestId("ai-insights-fix-task-outcomes"),
    )
      .getAllByRole("listitem")
      .map((row: HTMLElement): string => {
        return row.textContent || "";
      });

    expect(tasks).toEqual([
      "Asked for2",
      "Pull request opened1",
      "No fix found1",
      "In progress0",
      "Failed0",
    ]);
    expect(
      screen.queryByTestId("ai-insights-fixes-hidden"),
    ).not.toBeInTheDocument();
  });

  test("a role that may not read fixes sees no fix numbers, and is told why", async () => {
    serve(
      ok(
        insights(product, {
          totals: {
            ...((insights(product)["totals"] as JSONObject) || {}),
            fixes: null,
          },
          fixOutcomes: null,
        }),
      ),
    );
    openPage(product);

    expect(await findTestId("ai-insights-fixes-hidden")).toHaveTextContent(
      "Fix numbers are not shown: seeing them needs permission to read auto-remediation suggestions.",
    );
    expect(
      screen.queryByTestId("ai-insights-fix-outcomes"),
    ).not.toBeInTheDocument();

    const tile: HTMLElement = screen.getByTestId("ai-insights-tile-fixes");

    expect(tile).toHaveTextContent("—");
    expect(tile).toHaveTextContent("Not shown to your role");
    expect(tile).not.toHaveTextContent("0 of 0");
  });

  test("day by day: a bar for each day, and the window's totals for a screen reader", async () => {
    serve(ok(insights(product)));
    openPage(product);

    const trend: HTMLElement = await findTestId("ai-insights-trend");

    expect(trend).toHaveAttribute("role", "img");
    expect(trend).toHaveAttribute(
      "aria-label",
      "Over the last 30 days: 4 investigations, 1 of them failed, and 2 fixes.",
    );
    expect(
      within(trend)
        .getAllByTestId("ai-insights-trend-day")
        .map((day: HTMLElement): string | null => {
          return day.getAttribute("data-date");
        }),
    ).toEqual(["2026-10-03", "2026-10-04", "2026-10-05"]);

    const busiest: HTMLElement = within(trend).getAllByTestId(
      "ai-insights-trend-day",
    )[1]!;

    expect(busiest).toHaveAttribute(
      "title",
      "2026-10-04: investigations 3, failed 1, fixes 2",
    );
  });

  test("what AI looked at: how much it investigated, why not the rest, and the way to AI → Settings", async () => {
    serve(ok(insights(product)));
    openPage(product);

    const coverage: HTMLElement = await findTestId("ai-insights-coverage");

    expect(coverage).toHaveTextContent(product.coverageSentence);

    const reasons: Array<HTMLElement> = within(
      within(coverage).getByTestId("ai-insights-not-investigated"),
    ).getAllByRole("listitem");

    expect(
      reasons.map((reason: HTMLElement): Array<string | null> => {
        return [reason.getAttribute("data-code"), reason.textContent];
      }),
    ).toEqual([
      ["automatic_investigation_disabled", `${product.turnedOffReason}6`],
      [
        "severity_below_threshold",
        "They were below the minimum severity to investigate.2",
      ],
    ]);
    expect(
      hrefOf(
        within(coverage).getByText(
          "Choose what OneUptime AI does on its own in AI → Settings",
        ),
      ),
    ).toBe(pathOf(product.settingsPage));
  });

  test("says when the insights cover only the most recent work", async () => {
    serve(ok(insights(product, { isPartial: true })));
    openPage(product);

    expect(await findTestId("ai-insights-partial")).toHaveTextContent(
      "There was more AI work in the last 30 days than these insights read at once, so they cover the most recent of it.",
    );

    cleanup();
    serve(ok(insights(product)));
    openPage(product);

    await findTestId("ai-insights-tiles");
    expect(screen.queryByTestId("ai-insights-partial")).not.toBeInTheDocument();
  });

  test("with no AI work at all: says so, and still says why nothing was investigated", async () => {
    serve(ok(quiet(product)));
    openPage(product);

    const empty: HTMLElement = await findTestId("ai-insights-empty");

    expect(empty).toHaveTextContent("Nothing to learn from yet");
    expect(empty).toHaveTextContent(product.emptyDescription);

    const coverage: HTMLElement = screen.getByTestId("ai-insights-coverage");

    expect(coverage).toHaveTextContent(
      `OneUptime AI investigated 0 of the 7 ${product.plural} created in the last 30 days.`,
    );
    expect(coverage).toHaveTextContent(
      "There is no LLM provider OneUptime AI can use.",
    );
    expect(screen.queryByTestId("ai-insights-tiles")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("ai-insights-problems"),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("ai-insights-trend")).not.toBeInTheDocument();
  });

  test("an error says what went wrong, and Retry loads the insights again", async () => {
    serve(
      httpError(500, "The AI insights are not available right now."),
      ok(insights(product)),
    );
    openPage(product);

    const error: HTMLElement = await findTestId("ai-insights-error");

    expect(error).toHaveTextContent(
      "The AI insights are not available right now.",
    );
    expect(screen.queryByTestId("ai-insights-tiles")).not.toBeInTheDocument();

    fireEvent.click(within(error).getByRole("button"));

    await findTestId("ai-insights-tiles");
    expect(requestsTo(product.route)).toHaveLength(2);
    expect(screen.queryByTestId("ai-insights-error")).not.toBeInTheDocument();
  });

  test("a body the page cannot read is an error, not an empty page", async () => {
    serve(ok({ entries: [] }));
    openPage(product);

    expect(await findTestId("ai-insights-error")).toHaveTextContent(
      "The server returned AI insights this page cannot read.",
    );
    expect(screen.queryByTestId("ai-insights-empty")).not.toBeInTheDocument();
  });
});

describe("the AI Insights page between products", () => {
  test("an answer for the product the page has left never paints over the one it shows", async () => {
    const [incident, alert] = PRODUCTS as [Product, Product];
    const slow: { answer: Answer; release: (body: unknown) => void } =
      deferred();
    serve(
      slow.answer,
      ok(
        insights(alert, {
          problems: [problem(alert, { title: "Queue backlog" })],
        }),
      ),
    );

    const path: string = pathOf(incident.insightsPage);
    goTo(path);

    const view: RenderResult = render(
      <MemoryRouter initialEntries={[path]}>
        <IncidentAlertAiInsightsPage
          pageRoute={RouteMap[incident.insightsPage] as Route}
          currentProject={null}
          hasPaymentMethod={true}
          subjectKind="incident"
        />
      </MemoryRouter>,
    );

    await findTestId("ai-insights-loading");

    view.rerender(
      <MemoryRouter initialEntries={[path]}>
        <IncidentAlertAiInsightsPage
          pageRoute={RouteMap[alert.insightsPage] as Route}
          currentProject={null}
          hasPaymentMethod={true}
          subjectKind="alert"
        />
      </MemoryRouter>,
    );

    expect(
      await screen.findByText("Queue backlog", {}, { timeout: WAIT_TIMEOUT }),
    ).toBeInTheDocument();

    await act(async () => {
      slow.release(insights(incident));
    });

    expect(screen.getByText("Queue backlog")).toBeInTheDocument();
    expect(screen.queryByText("Disk full on db-1")).not.toBeInTheDocument();
    expect(requestsTo(incident.route)).toHaveLength(1);
    expect(requestsTo(alert.route)).toHaveLength(1);
  });
});
