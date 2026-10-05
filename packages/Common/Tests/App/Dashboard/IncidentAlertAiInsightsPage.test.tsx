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
import IncidentAlertAiInsightsPage, {
  AI_INSIGHTS_EMPTY_DESCRIPTIONS,
  AI_INSIGHTS_PAGE_SUBTITLES,
} from "../../../../App/FeatureSet/Dashboard/src/Components/IncidentAlertAi/IncidentAlertAiInsightsPage";
import AlertAIInsights from "../../../../App/FeatureSet/Dashboard/src/Pages/Alerts/AI/Insights";
import IncidentAIInsights from "../../../../App/FeatureSet/Dashboard/src/Pages/Incidents/AI/Insights";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Route from "../../../Types/API/Route";
import {
  AiActivityAttentionKind,
  AiActivityAttentionSeverity,
  AiActivityProblem,
} from "../../../Types/AI/AiActivityInsights";
import { IncidentAlertAiInsights } from "../../../Types/AI/IncidentAlertAiInsights";
import { IncidentAlertAiSubjectKind } from "../../../Types/AI/IncidentAlertAiLogs";
import { JSONObject } from "../../../Types/JSON";
import Permission from "../../../Types/Permission";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import PermissionUtil from "../../../UI/Utils/Permission";
import {
  MONITOR_ID,
  MONITOR_NAME,
  OTHER_SUBJECT_ID,
  REPORT_FINDING,
  RECURRING_TITLE,
  SERVICE_ID,
  SERVICE_NAME,
  SUBJECT_ID,
  makeIncidentAlertInsights,
  makeQuietIncidentAlertInsights,
  toBody,
} from "./IncidentAlertAiInsightsFixtures";
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
 * route stubbed. It is every scope's AI Insights page - the one a cluster
 * and each resource have (AiActivityInsightsPage.test.tsx) - with the
 * product's own sentences and sections: it answers "what has OneUptime AI
 * learned from our incidents, and what needs a look?" - what needs a look
 * and where to act on it, the window at a glance with how much of what came
 * in AI looked at, the problems that keep coming back and what AI found,
 * the monitors and services behind them, how the fixes and fix pull
 * requests turned out, and why AI skipped the rest.
 */

const WAIT_TIMEOUT: number = 20000;

interface Product {
  subjectKind: IncidentAlertAiSubjectKind;
  insightsPage: PageMap;
  logsPage: PageMap;
  settingsPage: PageMap;
  viewPage: PageMap;
  route: string;
  page: React.FunctionComponent<PageComponentProps>;
  noun: string;
  plural: string;
  coverageStat: string;
  coverageSentence: string;
  openSubject: string;
  subjectLabel: string;
  turnedOffReason: string;
  reviewSettings: string;
  notStarted: string;
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
    noun: "incident",
    plural: "incidents",
    coverageStat: "Incidents investigated",
    coverageSentence:
      "OneUptime AI investigated 12 of the 20 incidents created in the last 30 days.",
    openSubject: "Open incident",
    subjectLabel: "Incident INC-41: Checkout latency",
    turnedOffReason: "Automatic investigation of new incidents is turned off.",
    reviewSettings: "Review incident AI settings",
    notStarted:
      "6 incidents created in the last 30 days were not investigated.",
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
    noun: "alert",
    plural: "alerts",
    coverageStat: "Alerts investigated",
    coverageSentence:
      "OneUptime AI investigated 12 of the 20 alerts created in the last 30 days.",
    openSubject: "Open alert",
    subjectLabel: "Alert ALT-41: Checkout latency",
    turnedOffReason: "Automatic investigation of new alerts is turned off.",
    reviewSettings: "Review alert AI settings",
    notStarted: "6 alerts created in the last 30 days were not investigated.",
    emptyDescription:
      "OneUptime AI has not investigated or fixed an alert in the last 30 days.",
  },
];

function insights(
  product: Product,
  overrides: Partial<IncidentAlertAiInsights> = {},
): JSONObject {
  return toBody(makeIncidentAlertInsights(product.subjectKind, overrides));
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
  PRODUCTS.map((product: Product): [IncidentAlertAiSubjectKind, Product] => {
    return [product.subjectKind, product];
  }),
)(
  "the %s AI Insights page",
  (_name: IncidentAlertAiSubjectKind, product: Product) => {
    test("says what it is in the product's words, points at the record behind it, and asks this product's insights route", async () => {
      serve(ok(insights(product)));
      openPage(product);

      const heading: HTMLElement = await findTestId("ai-insights-page-heading");

      expect(heading).toHaveTextContent("AI Insights");
      expect(heading).toHaveTextContent(
        AI_INSIGHTS_PAGE_SUBTITLES[product.subjectKind],
      );
      expect(hrefOf(within(heading).getByTestId("ai-insights-logs-link"))).toBe(
        pathOf(product.logsPage),
      );

      await findTestId("ai-insights-summary");

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
      expect(
        screen.queryByTestId("ai-insights-summary"),
      ).not.toBeInTheDocument();

      await act(async () => {
        pending.release(insights(product));
      });

      await findTestId("ai-insights-summary");
      expect(
        screen.queryByTestId("ai-insights-loading"),
      ).not.toBeInTheDocument();
    });

    test("the window at a glance: investigations, how much of what came in, problems, fixes and commands", async () => {
      serve(ok(insights(product)));
      openPage(product);

      const summary: HTMLElement = await findTestId("ai-insights-summary");
      const stat: (name: string) => HTMLElement = (name: string) => {
        return within(summary).getByTestId(`ai-insights-stat-${name}`);
      };

      expect(stat("investigations")).toHaveTextContent("Investigations");
      expect(stat("investigations")).toHaveTextContent("12");
      expect(stat("investigations")).toHaveTextContent("2 failed or timed out");

      expect(stat("coverage")).toHaveTextContent(product.coverageStat);
      expect(stat("coverage")).toHaveTextContent("12 of 20");
      expect(stat("coverage")).toHaveTextContent("Created in the last 30 days");

      expect(stat("problems")).toHaveTextContent("4");
      expect(stat("problems")).toHaveTextContent("2 recurring");

      expect(stat("fixes")).toHaveTextContent("5");
      expect(stat("fixes")).toHaveTextContent("2 verified");

      expect(stat("commands")).toHaveTextContent("30");
      expect(stat("commands")).toHaveTextContent("2 failed, 1 never ran");

      // A day of the window per bar, the busiest one tallest.
      expect(
        within(summary).getAllByTestId("ai-insights-trend-day"),
      ).toHaveLength(30);
      expect(
        within(summary).getByTestId("ai-insights-trend-weeks"),
      ).toHaveTextContent(
        "4 investigations in the last 7 days (0 the 7 days before).",
      );
    });

    test("needs attention: in the server's order, each in its own words, with where to act", async () => {
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
        [AiActivityAttentionKind.FixesFailed, AiActivityAttentionSeverity.High],
        [
          AiActivityAttentionKind.InvestigationsNotStarted,
          AiActivityAttentionSeverity.High,
        ],
        [
          AiActivityAttentionKind.RecurringProblem,
          AiActivityAttentionSeverity.High,
        ],
        [
          AiActivityAttentionKind.CommandsTimedOut,
          AiActivityAttentionSeverity.Medium,
        ],
        [
          AiActivityAttentionKind.MonitorHotspot,
          AiActivityAttentionSeverity.Low,
        ],
      ]);

      const [failedFixes, notStarted, recurring, commands, hotspot] = items as [
        HTMLElement,
        HTMLElement,
        HTMLElement,
        HTMLElement,
        HTMLElement,
      ];

      expect(failedFixes).toHaveTextContent(
        "1 fix OneUptime AI applied did not resolve the problem it was for.",
      );
      expect(hrefOf(within(failedFixes).getByText(product.openSubject))).toBe(
        pathOf(product.viewPage, SUBJECT_ID),
      );

      expect(notStarted).toHaveTextContent(product.notStarted);
      expect(
        within(notStarted).getByTestId("ai-insights-attention-detail"),
      ).toHaveTextContent("There is no LLM provider OneUptime AI can use.");
      expect(
        hrefOf(within(notStarted).getByText("Configure an AI provider")),
      ).toBe(pathOf(PageMap.SETTINGS_AI_LLM_PROVIDERS));

      expect(recurring).toHaveTextContent(
        `${RECURRING_TITLE} keeps coming back: OneUptime AI investigated it 5 times in the last 30 days. 3 of those were in the last 7 days.`,
      );
      expect(hrefOf(within(recurring).getByText(product.openSubject))).toBe(
        pathOf(product.viewPage, SUBJECT_ID),
      );

      // No AI agent page of their own: the commands are in the logs.
      expect(commands).toHaveTextContent(
        "1 command OneUptime AI sent was never picked up by the agent.",
      );
      expect(hrefOf(within(commands).getByText("Open AI Logs"))).toBe(
        pathOf(product.logsPage),
      );

      expect(hotspot).toHaveTextContent(
        `${MONITOR_NAME} was behind 7 of the 12 investigations here.`,
      );
      expect(hrefOf(within(hotspot).getByText("Open monitor"))).toBe(
        pathOf(PageMap.MONITOR_VIEW, MONITOR_ID),
      );
    });

    test("a skip the settings decide is fixed in this product's AI settings, by who may change them", async () => {
      setPermissions([Permission.ProjectAdmin]);
      serve(
        ok(
          insights(product, {
            attention: [
              {
                kind: AiActivityAttentionKind.InvestigationsNotStarted,
                severity: AiActivityAttentionSeverity.Low,
                count: 6,
                reason: "automatic_investigation_disabled",
              },
            ],
          }),
        ),
      );
      openPage(product);

      await findTestId("ai-insights-attention");

      const [item] = attentionItems() as [HTMLElement];

      expect(item).toHaveTextContent(product.turnedOffReason);
      expect(hrefOf(within(item).getByText(product.reviewSettings))).toBe(
        pathOf(product.settingsPage),
      );
    });

    test("anyone else is told who can act; a check that failed on its own offers nothing", async () => {
      setPermissions([Permission.ProjectMember]);
      serve(
        ok(
          insights(product, {
            attention: [
              {
                kind: AiActivityAttentionKind.InvestigationsNotStarted,
                severity: AiActivityAttentionSeverity.Low,
                count: 6,
                reason: "automatic_investigation_disabled",
              },
              {
                kind: AiActivityAttentionKind.InvestigationsNotStarted,
                severity: AiActivityAttentionSeverity.Medium,
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

      expect(unchecked).toHaveTextContent(
        "The daily AI token limit could not be checked.",
      );
      expect(within(unchecked).queryByRole("link")).not.toBeInTheDocument();
      expect(
        within(unchecked).queryByTestId("ai-insights-attention-who-can-act"),
      ).not.toBeInTheDocument();
    });

    test("with nothing to look at, says so", async () => {
      serve(ok(insights(product, { attention: [] })));
      openPage(product);

      expect(
        await findTestId("ai-insights-nothing-needs-attention"),
      ).toHaveTextContent("Nothing here needs your attention right now.");
      expect(attentionItems()).toEqual([]);
    });

    test("the problems: what keeps happening, its monitors and parts, what AI found and how fixes went", async () => {
      serve(ok(insights(product)));
      openPage(product);

      await findTestId("ai-insights-summary");

      const [recurring, oneOff] = screen.getAllByTestId(
        "ai-insights-problem",
      ) as [HTMLElement, HTMLElement];

      expect(hrefOf(within(recurring).getByText(RECURRING_TITLE))).toBe(
        pathOf(product.viewPage, SUBJECT_ID),
      );
      expect(recurring).toHaveTextContent(
        `Investigated 5 times · 4 ${product.plural}`,
      );
      expect(
        within(recurring).getByTestId("ai-insights-recurring"),
      ).toBeInTheDocument();

      const monitors: HTMLElement = within(recurring).getByTestId(
        "ai-insights-problem-monitors",
      );
      expect(hrefOf(within(monitors).getByText(MONITOR_NAME))).toBe(
        pathOf(PageMap.MONITOR_VIEW, MONITOR_ID),
      );
      expect(
        within(recurring).getByTestId("ai-insights-problem-objects"),
      ).toHaveTextContent("Host: db-1 ×3");

      const finding: HTMLElement = within(recurring).getByTestId(
        "ai-insights-problem-finding",
      );
      expect(finding).toHaveTextContent(REPORT_FINDING);
      expect(finding).toHaveTextContent("(from the investigation's report)");

      expect(
        within(recurring).getByTestId("ai-insights-problem-fixes"),
      ).toHaveTextContent(
        "2 fixes proposed · 1 applied · 1 did not help · 1 waiting for approval",
      );
      expect(
        within(recurring).getByTestId("ai-insights-problem-verdicts"),
      ).toHaveTextContent(
        "your team confirmed 1 finding · 2 findings matched the root cause recorded later",
      );

      // A one-off: named the way every AI page names it, nothing recorded yet.
      expect(hrefOf(within(oneOff).getByText("Checkout latency"))).toBe(
        pathOf(product.viewPage, OTHER_SUBJECT_ID),
      );
      expect(oneOff).toHaveTextContent("Investigated 1 time");
      expect(oneOff).not.toHaveTextContent(product.plural);
      expect(oneOff).toHaveTextContent(
        "No finding recorded for this problem yet.",
      );
      expect(
        within(oneOff).queryByTestId("ai-insights-problem-monitors"),
      ).not.toBeInTheDocument();
      expect(
        within(oneOff).queryByTestId("ai-insights-recurring"),
      ).not.toBeInTheDocument();
    });

    test("an untitled problem is named by its latest subject", async () => {
      const [, oneOff] = makeIncidentAlertInsights(product.subjectKind)
        .problems as [AiActivityProblem, AiActivityProblem];

      serve(ok(insights(product, { problems: [{ ...oneOff, title: "" }] })));
      openPage(product);

      await findTestId("ai-insights-summary");

      expect(hrefOf(screen.getByText(product.subjectLabel))).toBe(
        pathOf(product.viewPage, OTHER_SUBJECT_ID),
      );
    });

    test("what the server wrote is shown as text, never as markup", async () => {
      const markup: string = '<img src="x" onerror="window.hacked=1">';
      const [recurring] = makeIncidentAlertInsights(product.subjectKind)
        .problems as [AiActivityProblem];

      serve(
        ok(
          insights(product, {
            problems: [
              {
                ...recurring,
                title: markup,
                monitors: [{ id: MONITOR_ID, name: markup }],
                latestFinding: {
                  aiRunId: "run-1",
                  text: markup,
                  source: "tldr",
                },
              },
            ],
          }),
        ),
      );
      openPage(product);

      const problem: HTMLElement = (
        await screen.findAllByTestId(
          "ai-insights-problem",
          {},
          {
            timeout: WAIT_TIMEOUT,
          },
        )
      )[0]!;

      expect(problem).toHaveTextContent(markup);
      expect(problem.querySelector("img")).toBeNull();
    });

    test("the monitors and services that keep failing link to their own pages, in place of a cluster's hotspots", async () => {
      serve(ok(insights(product)));
      openPage(product);

      await findTestId("ai-insights-summary");

      const monitors: HTMLElement = screen.getByTestId("ai-insights-monitors");
      expect(hrefOf(within(monitors).getByText(MONITOR_NAME))).toBe(
        pathOf(PageMap.MONITOR_VIEW, MONITOR_ID),
      );
      expect(monitors).toHaveTextContent(
        `4 ${product.plural} investigated · 1 problem · last seen`,
      );

      const services: HTMLElement = screen.getByTestId("ai-insights-services");
      expect(hrefOf(within(services).getByText(SERVICE_NAME))).toBe(
        pathOf(PageMap.SERVICE_VIEW, SERVICE_ID),
      );
      expect(services).toHaveTextContent(
        `2 ${product.plural} investigated · 2 problems · last seen`,
      );

      // A project has no parts of its own: no hotspots card.
      expect(screen.queryByText("Hotspots")).not.toBeInTheDocument();
      expect(
        screen.queryByTestId("ai-insights-no-hotspots"),
      ).not.toBeInTheDocument();
    });

    test("an empty list of monitors or services says so", async () => {
      serve(ok(insights(product, { monitors: [], services: [] })));
      openPage(product);

      expect(await findTestId("ai-insights-monitors-empty")).toHaveTextContent(
        "No monitor came up more than once.",
      );
      expect(
        screen.getByTestId("ai-insights-services-empty"),
      ).toHaveTextContent("No service came up more than once.");
    });

    test("the fixes: where they ended up, whether they worked, and the fix pull requests", async () => {
      serve(ok(insights(product)));
      openPage(product);

      const fixes: HTMLElement = await findTestId("ai-insights-fixes");

      expect(fixes).toHaveTextContent("Applied automatically (2)");
      expect(fixes).toHaveTextContent("Applied after approval (1)");
      expect(fixes).toHaveTextContent("Waiting for approval (1)");
      expect(fixes).toHaveTextContent("Dismissed (1)");
      expect(
        within(fixes).getByTestId("ai-insights-fix-verification"),
      ).toHaveTextContent(
        "Verification: 2 resolved the problem, 1 did not, 0 still being checked.",
      );

      const tasks: HTMLElement = within(fixes).getByTestId(
        "ai-insights-fix-tasks",
      );
      expect(tasks).toHaveTextContent("Fix pull requests");
      expect(tasks).toHaveTextContent("Pull request opened (1)");
      expect(tasks).toHaveTextContent("No fix found (1)");
      expect(tasks).not.toHaveTextContent("In progress");
    });

    test("a role that may not read fixes sees no fix numbers, and is told why", async () => {
      serve(
        ok(
          insights(product, {
            fixesHidden: true,
            totals: {
              ...makeIncidentAlertInsights(product.subjectKind).totals,
              fixes: 0,
            },
            fixOutcomes: makeQuietIncidentAlertInsights(product.subjectKind)
              .fixOutcomes,
          }),
        ),
      );
      openPage(product);

      const summary: HTMLElement = await findTestId("ai-insights-summary");
      const fixesStat: HTMLElement = within(summary).getByTestId(
        "ai-insights-stat-fixes",
      );

      expect(fixesStat).toHaveTextContent("—");
      expect(fixesStat).toHaveTextContent("Not shown to your role");
      expect(fixesStat).not.toHaveTextContent("0");

      expect(screen.getByTestId("ai-insights-fixes-hidden")).toHaveTextContent(
        "Fix numbers are not shown: seeing them needs permission to read auto-remediation suggestions.",
      );
      expect(
        screen.queryByTestId("ai-insights-fix-verification"),
      ).not.toBeInTheDocument();

      // A day's bar never says "0 fixes" to a reader who may not see them.
      for (const day of within(summary).getAllByTestId(
        "ai-insights-trend-day",
      )) {
        expect(day.getAttribute("title")).not.toContain("fixes");
      }

      // The fix pull requests are AI runs, shown as before.
      expect(screen.getByTestId("ai-insights-fix-tasks")).toHaveTextContent(
        "Pull request opened (1)",
      );
    });

    test("with no fix and no pull request, there is no fixes card", async () => {
      const quiet: IncidentAlertAiInsights = makeQuietIncidentAlertInsights(
        product.subjectKind,
      );

      serve(
        ok(
          insights(product, {
            fixOutcomes: quiet.fixOutcomes,
            fixTaskOutcomes: quiet.fixTaskOutcomes,
            totals: { ...quiet.totals, investigations: 3 },
          }),
        ),
      );
      openPage(product);

      await findTestId("ai-insights-summary");

      expect(screen.queryByTestId("ai-insights-fixes")).not.toBeInTheDocument();
    });

    test("what AI looked at: how much it investigated, why not the rest, and the way to AI → Settings", async () => {
      serve(ok(insights(product)));
      openPage(product);

      const coverage: HTMLElement = await findTestId("ai-insights-coverage");

      expect(coverage).toHaveTextContent(product.coverageSentence);

      const reasons: HTMLElement = within(coverage).getByTestId(
        "ai-insights-not-investigated",
      );
      const rows: Array<HTMLElement> = Array.from(
        reasons.querySelectorAll("li"),
      );

      expect(
        rows.map((row: HTMLElement): [string | null, string] => {
          return [row.getAttribute("data-code"), row.textContent || ""];
        }),
      ).toEqual([
        ["provider_missing", "There is no LLM provider OneUptime AI can use.6"],
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
        "There was more AI activity here than these insights read: they cover the newest of it.",
      );
    });

    test("with no AI work at all: one empty state, and still why nothing was investigated", async () => {
      serve(ok(toBody(makeQuietIncidentAlertInsights(product.subjectKind))));
      openPage(product);

      const empty: HTMLElement = await findTestId("ai-insights-empty");

      expect(empty).toHaveTextContent("No AI activity in the last 30 days");
      expect(empty).toHaveTextContent(
        AI_INSIGHTS_EMPTY_DESCRIPTIONS[product.subjectKind],
      );
      expect(empty).toHaveTextContent(product.emptyDescription);
      expect(hrefOf(within(empty).getByText("Open AI Logs"))).toBe(
        pathOf(product.logsPage),
      );

      const coverage: HTMLElement = screen.getByTestId("ai-insights-coverage");
      expect(coverage).toHaveTextContent(
        `OneUptime AI investigated 0 of the 7 ${product.plural} created in the last 30 days.`,
      );
      expect(coverage).toHaveTextContent(
        "There is no LLM provider OneUptime AI can use.",
      );

      expect(
        screen.queryByTestId("ai-insights-summary"),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId("ai-insights-attention"),
      ).not.toBeInTheDocument();
    });

    test("an error says what went wrong, and Retry loads the insights again", async () => {
      serve(httpError(500, "The database is asleep."), ok(insights(product)));
      openPage(product);

      const error: HTMLElement = await findTestId("ai-insights-error");

      expect(error).toHaveTextContent("The database is asleep.");

      fireEvent.click(within(error).getByRole("button"));

      await findTestId("ai-insights-summary");
      expect(requestsTo(product.route)).toHaveLength(2);
    });

    test("a body the page cannot read is an error, not an empty page", async () => {
      serve(ok({ entries: [] }));
      openPage(product);

      expect(await findTestId("ai-insights-error")).toHaveTextContent(
        "The server returned AI insights this page cannot read.",
      );
      expect(screen.queryByTestId("ai-insights-empty")).not.toBeInTheDocument();
    });
  },
);

describe("the AI Insights page between products", () => {
  test("an answer for the product the page has left never paints over the one it shows", async () => {
    const [incident, alert] = PRODUCTS as [Product, Product];
    const slow: { answer: Answer; release: (body: unknown) => void } =
      deferred();
    const [recurring] = makeIncidentAlertInsights("alert").problems as [
      AiActivityProblem,
    ];

    serve(
      slow.answer,
      ok(
        insights(alert, {
          problems: [{ ...recurring, title: "Queue backlog" }],
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
    expect(screen.queryByText(RECURRING_TITLE)).not.toBeInTheDocument();
    expect(requestsTo(incident.route)).toHaveLength(1);
    expect(requestsTo(alert.route)).toHaveLength(1);
  });
});
