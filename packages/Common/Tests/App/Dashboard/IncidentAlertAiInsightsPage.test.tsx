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
import {
  getInsightNote,
  getInsightTarget,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AI/ActivityInsights/AiActivityInsightsView";
import { PROJECT_AI_OFF_NOTICE_TEST_ID } from "../../../../App/FeatureSet/Dashboard/src/Components/AISettings/ProjectAiSettingsCopy";
import AlertAIInsights from "../../../../App/FeatureSet/Dashboard/src/Pages/Alerts/AI/Insights";
import IncidentAIInsights from "../../../../App/FeatureSet/Dashboard/src/Pages/Incidents/AI/Insights";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import Project from "../../../Models/DatabaseModels/Project";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Route from "../../../Types/API/Route";
import {
  AiActivityInsight,
  AiActivityInsightKind,
  AiActivityInsightTone,
  AiActivityProblem,
} from "../../../Types/AI/AiActivityInsights";
import { IncidentAlertAiInsights } from "../../../Types/AI/IncidentAlertAiInsights";
import { IncidentAlertAiSubjectKind } from "../../../Types/AI/IncidentAlertAiLogs";
import { InvestigationNotStartedCode } from "../../../Types/AI/InvestigationNotStartedReason";
import OneUptimeDate from "../../../Types/Date";
import { JSONObject } from "../../../Types/JSON";
import Permission from "../../../Types/Permission";
import Timezone from "../../../Types/Timezone";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import PermissionUtil from "../../../UI/Utils/Permission";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import {
  MONITOR_ID,
  MONITOR_NAME,
  NEXT_STEP,
  ONE_OFF_PROBLEM_KEY,
  OTHER_SUBJECT_ID,
  REPORT_FINDING,
  RECURRING_TITLE,
  SERVICE_ID,
  SERVICE_NAME,
  SUBJECT_ID,
  THIRD_SUBJECT_ID,
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
 * route and the AI readiness reads stubbed. It is every scope's AI Insights
 * page - the one a cluster and each resource have
 * (AiActivityInsightsPage.test.tsx) - in the product's own words, with what
 * only a whole product can say: the incident that keeps coming back at the
 * same time of night with what AI found and suggests, the incidents AI did
 * not look into and what would let it, the service behind most of them,
 * that the team approved every fix AI proposed - then the problems the
 * insights do not already tell, the monitors and services that keep
 * failing, and, as a footnote, what AI did, with the fix pull requests and
 * why it skipped the rest.
 */

const WAIT_TIMEOUT: number = 20000;

const PROVIDERS_ROUTE: string = "/ai-chat/providers";

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
  title: string;
  prefix: string;
  coverageStat: string;
  coverageSentence: string;
  openSubject: string;
  subjectLabel: string;
  turnedOffReason: string;
  reviewSettings: string;
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
    title: "Incident",
    prefix: "INC-",
    coverageStat: "Incidents investigated",
    coverageSentence:
      "OneUptime AI investigated 12 of the 20 incidents created in the last 30 days.",
    openSubject: "Open incident",
    subjectLabel: "Incident INC-41: Checkout latency",
    turnedOffReason: "Automatic investigation of new incidents is turned off.",
    reviewSettings: "Review incident AI settings",
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
    title: "Alert",
    prefix: "ALT-",
    coverageStat: "Alerts investigated",
    coverageSentence:
      "OneUptime AI investigated 12 of the 20 alerts created in the last 30 days.",
    openSubject: "Open alert",
    subjectLabel: "Alert ALT-41: Checkout latency",
    turnedOffReason: "Automatic investigation of new alerts is turned off.",
    reviewSettings: "Review alert AI settings",
  },
];

function insights(
  product: Product,
  overrides: Partial<IncidentAlertAiInsights> = {},
): JSONObject {
  return toBody(makeIncidentAlertInsights(product.subjectKind, overrides));
}

// The product's insights with only the given ones in the lead.
function withInsights(
  product: Product,
  items: Array<AiActivityInsight>,
): JSONObject {
  return insights(product, { insights: items });
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
// Project.enableAi, as the AI readiness read finds it.
let isAiOn: boolean = true;

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

// The links inside an element, as "text → href".
function linksIn(element: HTMLElement): Array<string> {
  return Array.from(element.querySelectorAll("a")).map(
    (anchor: HTMLAnchorElement): string => {
      return `${anchor.textContent?.trim()} → ${anchor.getAttribute("href")}`;
    },
  );
}

async function findInsightItems(): Promise<Array<HTMLElement>> {
  const list: HTMLElement = await findTestId("ai-insights-insights");
  return within(list).getAllByTestId("ai-insights-insight");
}

async function findInsight(kind: AiActivityInsightKind): Promise<HTMLElement> {
  const item: HTMLElement | undefined = (await findInsightItems()).find(
    (candidate: HTMLElement): boolean => {
      return candidate.getAttribute("data-kind") === kind;
    },
  );

  if (!item) {
    throw new Error(`No ${kind} insight on the page.`);
  }

  return item;
}

function setPermissions(permissions: Array<Permission>): void {
  jest.spyOn(PermissionUtil, "getAllPermissions").mockReturnValue(permissions);
}

function skipped(
  reason: InvestigationNotStartedCode,
  count: number = 6,
): AiActivityInsight {
  return {
    kind: AiActivityInsightKind.NotInvestigated,
    tone: AiActivityInsightTone.Pattern,
    count,
    total: 20,
    reason,
  };
}

beforeEach(() => {
  window.localStorage.clear();
  PermissionGate.clearPermissionPropsCache();
  answers = [];
  isAiOn = true;

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

      if (url.endsWith(PROVIDERS_ROUTE)) {
        return new HTTPResponse<JSONObject>(
          200,
          {
            isAIEnabledForProject: true,
            defaultProviderId: "9d9d9d9d-0000-4000-8000-000000000001",
            providers: [
              {
                id: "9d9d9d9d-0000-4000-8000-000000000001",
                name: "OneUptime AI",
                isGlobal: true,
                isDefault: false,
              },
            ],
          },
          {},
        );
      }

      throw new Error(`Unexpected request to ${url}`);
    },
  );
  jest
    .spyOn(ModelAPI, "getItem")
    .mockImplementation(async (): Promise<Project> => {
      return Object.assign(new Project(), {
        _id: PROJECT_ID,
        enableAi: isAiOn,
      });
    });
  jest.spyOn(ModelAPI, "getCommonHeaders").mockReturnValue({});
  jest
    .spyOn(OneUptimeDate, "getCurrentTimezone")
    .mockReturnValue("UTC" as Timezone);
  jest
    .spyOn(OneUptimeDate, "getUserPrefers12HourFormat")
    .mockReturnValue(false);
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
    const subjectHref: string = pathOf(product.viewPage, SUBJECT_ID);
    const oneOffHref: string = pathOf(product.viewPage, OTHER_SUBJECT_ID);
    const olderHref: string = pathOf(product.viewPage, THIRD_SUBJECT_ID);
    const monitorHref: string = pathOf(PageMap.MONITOR_VIEW, MONITOR_ID);
    const serviceHref: string = pathOf(PageMap.SERVICE_VIEW, SERVICE_ID);
    const logsHref: string = pathOf(product.logsPage);
    const settingsHref: string = pathOf(product.settingsPage);

    test("says what it is in the product's words, points at the record behind it, and asks this product's insights route", async () => {
      serve(ok(insights(product)));
      openPage(product);

      const heading: HTMLElement = await findTestId("ai-insights-page-heading");

      expect(heading).toHaveTextContent("AI Insights");
      expect(heading).toHaveTextContent(
        AI_INSIGHTS_PAGE_SUBTITLES[product.subjectKind],
      );
      expect(hrefOf(within(heading).getByTestId("ai-insights-logs-link"))).toBe(
        logsHref,
      );

      await findTestId("ai-insights-insights");

      expect(requestsTo(product.route)).toEqual([{}]);
      // The only other reads are the AI readiness notice's.
      expect(
        postSpy.mock.calls
          .map((call: Array<unknown>): string => {
            return String((call[0] as JSONObject)["url"]);
          })
          .filter((url: string): boolean => {
            return !url.endsWith(product.route) && !url.endsWith(PROVIDERS_ROUTE);
          }),
      ).toEqual([]);
    });

    test("shows a loader while the insights load", async () => {
      const pending: { answer: Answer; release: (body: unknown) => void } =
        deferred();
      serve(pending.answer);
      openPage(product);

      expect(await findTestId("ai-insights-loading")).toBeInTheDocument();
      expect(
        screen.queryByTestId("ai-insights-insights"),
      ).not.toBeInTheDocument();

      await act(async () => {
        pending.release(insights(product));
      });

      await findTestId("ai-insights-insights");
      expect(
        screen.queryByTestId("ai-insights-loading"),
      ).not.toBeInTheDocument();
    });

    test("leads with what is worth knowing about the product's own, most important first", async () => {
      serve(ok(insights(product)));
      openPage(product);

      const items: Array<HTMLElement> = await findInsightItems();

      expect(
        items.map((item: HTMLElement): string => {
          return `${item.getAttribute("data-kind")}/${item.getAttribute("data-tone")}`;
        }),
      ).toEqual([
        "RecurringProblem/Critical",
        "FixesDidNotHelp/Critical",
        "NotInvestigated/Pattern",
        "Hotspot/Pattern",
        "ReadyForAutomaticFixes/Positive",
      ]);
      expect(
        items.map((item: HTMLElement): string => {
          return within(item).getByTestId("ai-insights-insight-headline")
            .textContent as string;
        }),
      ).toEqual([
        `${RECURRING_TITLE} keeps coming back`,
        "A fix did not solve the problem it was for",
        `OneUptime AI did not look into 8 ${product.plural}`,
        `The ${SERVICE_NAME} service is behind 2 different problems`,
        "Your team approved every fix OneUptime AI proposed here",
      ]);
    });

    test("the one that keeps coming back: getting worse, at the same time of night, what AI found and suggests, its monitor, and what is behind it", async () => {
      serve(ok(insights(product)));
      openPage(product);

      const item: HTMLElement = await findInsight(
        AiActivityInsightKind.RecurringProblem,
      );

      expect(within(item).getByTestId("ai-insights-badge")).toHaveTextContent(
        "Getting worse",
      );
      expect(
        within(item).getByTestId("ai-insights-insight-facts"),
      ).toHaveTextContent(
        `It happened 12 times in the last 30 days. 4 of them were in the last 7 days, up from 1 the 7 days before. That is 12 of the 20 ${product.plural} created in the last 30 days.`,
      );
      expect(
        within(item).getByTestId("ai-insights-time-of-day"),
      ).toHaveTextContent(
        "It usually starts between 02:00 and 05:00 (UTC): on 6 of the 7 days it happened.",
      );
      // Its TL;DR call failed: the finding is what its report said.
      const finding: HTMLElement = within(item).getByTestId(
        "ai-insights-finding",
      );
      expect(finding).toHaveTextContent(REPORT_FINDING);
      expect(finding).toHaveTextContent("(from the investigation's report)");
      expect(
        within(item).getByTestId("ai-insights-next-step"),
      ).toHaveTextContent(`What it suggests${NEXT_STEP}`);
      expect(
        linksIn(within(item).getByTestId("ai-insights-insight-monitors")),
      ).toEqual([`${MONITOR_NAME} → ${monitorHref}`]);

      const evidence: HTMLElement = within(item).getByTestId(
        "ai-insights-evidence",
      );
      expect(linksIn(evidence)).toEqual([
        `${product.title} ${product.prefix}42 → ${subjectHref}`,
        `${product.title} ${product.prefix}39 → ${olderHref}`,
      ]);
      expect(evidence).toHaveTextContent("and 10 more");

      expect(
        within(item).getByTestId("ai-insights-insight-fixes"),
      ).toHaveTextContent(
        "2 fixes proposed · 1 applied · 1 did not help · 1 waiting for approval",
      );
      expect(
        within(item).getByTestId("ai-insights-insight-verdicts"),
      ).toHaveTextContent(
        "your team confirmed 1 finding · 2 findings matched the root cause recorded later",
      );
      expect(
        linksIn(within(item).getByTestId("ai-insights-next-step-link")),
      ).toEqual([`${product.openSubject} → ${subjectHref}`]);
    });

    test("the service behind the trouble opens its own page", async () => {
      serve(ok(insights(product)));
      openPage(product);

      const item: HTMLElement = await findInsight(
        AiActivityInsightKind.Hotspot,
      );

      expect(
        within(item).getByTestId("ai-insights-insight-facts"),
      ).toHaveTextContent(
        `It was part of 7 of the 20 ${product.plural} created in the last 30 days. Problems that share one place often share one cause: look there first.`,
      );
      expect(
        linksIn(within(item).getByTestId("ai-insights-next-step-link")),
      ).toEqual([`Open service → ${serviceHref}`]);
      expect(linksIn(within(item).getByTestId("ai-insights-evidence"))).toEqual(
        [
          `${product.title} ${product.prefix}41 → ${oneOffHref}`,
          `${product.title} ${product.prefix}42 → ${subjectHref}`,
        ],
      );
    });

    test("a monitor behind the trouble opens its own page", async () => {
      serve(
        ok(
          withInsights(product, [
            {
              kind: AiActivityInsightKind.Hotspot,
              tone: AiActivityInsightTone.Pattern,
              count: 12,
              total: 20,
              problemCount: 2,
              monitor: { id: MONITOR_ID, name: MONITOR_NAME },
            },
          ]),
        ),
      );
      openPage(product);

      const item: HTMLElement = await findInsight(
        AiActivityInsightKind.Hotspot,
      );
      expect(
        within(item).getByTestId("ai-insights-insight-headline"),
      ).toHaveTextContent(
        `The ${MONITOR_NAME} monitor is behind 2 different problems`,
      );
      expect(
        linksIn(within(item).getByTestId("ai-insights-next-step-link")),
      ).toEqual([`Open monitor → ${monitorHref}`]);
    });

    test("a team that approved every fix is sent to choose what AI may fix on its own, in this product's AI settings", async () => {
      serve(ok(insights(product)));
      openPage(product);

      const item: HTMLElement = await findInsight(
        AiActivityInsightKind.ReadyForAutomaticFixes,
      );

      expect(
        within(item).getByTestId("ai-insights-insight-facts"),
      ).toHaveTextContent(
        "That is 4 fixes in the last 30 days, and none dismissed. 3 of them were checked afterwards and solved the problem. Let OneUptime AI apply fixes like these on its own, and they run the moment the problem starts.",
      );
      expect(
        linksIn(within(item).getByTestId("ai-insights-next-step-link")),
      ).toEqual([`Choose what AI may fix on its own → ${settingsHref}`]);
      expect(
        within(item).getByTestId("ai-insights-insight-icon"),
      ).toHaveAttribute("aria-label", "Good news");
    });

    describe("what AI did not look into", () => {
      test("says why, out of how many, and links to where it is fixed, for someone who may", async () => {
        serve(ok(insights(product)));
        openPage(product);

        const item: HTMLElement = await findInsight(
          AiActivityInsightKind.NotInvestigated,
        );

        expect(
          within(item).getByTestId("ai-insights-insight-facts"),
        ).toHaveTextContent(
          `There is no LLM provider OneUptime AI can use. That is 8 of the 20 ${product.plural} created in the last 30 days.`,
        );
        expect(
          linksIn(within(item).getByTestId("ai-insights-next-step-link")),
        ).toEqual([
          `Configure an AI provider → ${pathOf(PageMap.SETTINGS_AI_LLM_PROVIDERS)}`,
        ]);
      });

      test("a skip the settings decide is fixed in this product's AI settings, by who may change them", async () => {
        setPermissions([Permission.ProjectAdmin]);
        serve(
          ok(
            withInsights(product, [skipped("automatic_investigation_disabled")]),
          ),
        );
        openPage(product);

        const item: HTMLElement = await findInsight(
          AiActivityInsightKind.NotInvestigated,
        );

        expect(item).toHaveTextContent(product.turnedOffReason);
        expect(
          linksIn(within(item).getByTestId("ai-insights-next-step-link")),
        ).toEqual([`${product.reviewSettings} → ${settingsHref}`]);
      });

      test("a skip because the project reached its own daily AI limit points at Project Settings → AI Features", async () => {
        serve(
          ok(withInsights(product, [skipped("project_daily_limit_reached", 3)])),
        );
        openPage(product);

        const item: HTMLElement = await findInsight(
          AiActivityInsightKind.NotInvestigated,
        );

        expect(
          within(item).getByTestId("ai-insights-insight-facts"),
        ).toHaveTextContent("The project had reached its own daily AI limit.");
        expect(
          linksIn(within(item).getByTestId("ai-insights-next-step-link")),
        ).toEqual([
          `Go to Project Settings → AI Features → ${pathOf(PageMap.SETTINGS_AI_FEATURES)}`,
        ]);
      });

      test("anyone else is told who can act; a check that failed on its own offers nothing", async () => {
        setPermissions([Permission.ProjectMember]);
        serve(
          ok(
            withInsights(product, [
              skipped("automatic_investigation_disabled"),
              skipped("budget_check_failed", 2),
            ]),
          ),
        );
        openPage(product);

        const [turnedOff, unchecked] = (await findInsightItems()) as [
          HTMLElement,
          HTMLElement,
        ];

        expect(turnedOff).toHaveTextContent(product.turnedOffReason);
        expect(
          within(turnedOff).queryByText(product.reviewSettings),
        ).not.toBeInTheDocument();
        expect(
          within(turnedOff).getByTestId("ai-insights-who-can-act"),
        ).toHaveTextContent(
          "A project administrator can review these settings.",
        );

        expect(unchecked).toHaveTextContent(
          "The daily AI token limit could not be checked.",
        );
        expect(within(unchecked).queryByRole("link")).not.toBeInTheDocument();
        expect(
          within(unchecked).queryByTestId("ai-insights-who-can-act"),
        ).not.toBeInTheDocument();
      });

      test("the link and the note follow the same rule as the page", () => {
        goTo(pathOf(product.insightsPage));
        const routes: {
          logsRoute: Route;
          settingsRoute: Route;
          subjectKind: IncidentAlertAiSubjectKind;
        } = {
          logsRoute: new Route(logsHref),
          settingsRoute: new Route(settingsHref),
          subjectKind: product.subjectKind,
        };

        setPermissions([Permission.ProjectAdmin]);
        expect(
          getInsightTarget(skipped("no_investigation_rule_matched"), routes)!
            .label,
        ).toBe(product.reviewSettings);
        expect(
          getInsightNote(skipped("no_investigation_rule_matched"), routes),
        ).toBeNull();

        setPermissions([Permission.ProjectMember]);
        expect(
          getInsightTarget(skipped("no_investigation_rule_matched"), routes),
        ).toBeNull();
        expect(
          getInsightNote(skipped("no_investigation_rule_matched"), routes),
        ).toBe("A project administrator can review these settings.");

        // A record created already resolved: no setting would have changed it.
        expect(
          getInsightTarget(skipped("created_resolved"), routes),
        ).toBeNull();
        expect(getInsightNote(skipped("created_resolved"), routes)).toBeNull();
      });
    });

    test("with nothing that stands out, says so", async () => {
      serve(ok(insights(product, { insights: [] })));
      openPage(product);

      expect(
        await findTestId("ai-insights-nothing-stands-out"),
      ).toHaveTextContent("Nothing stands out right now");
      expect(
        screen.queryByTestId("ai-insights-insights"),
      ).not.toBeInTheDocument();
    });

    test("the other problems: the one-off, named the way every AI page names it, with nothing recorded yet", async () => {
      serve(ok(insights(product)));
      openPage(product);

      await findTestId("ai-insights-summary");

      expect(screen.getByText("Other problems")).toBeInTheDocument();
      const problems: Array<HTMLElement> = screen.getAllByTestId(
        "ai-insights-problem",
      );
      expect(
        problems.map((problem: HTMLElement): string | null => {
          return problem.getAttribute("data-problem-key");
        }),
      ).toEqual([ONE_OFF_PROBLEM_KEY]);

      const oneOff: HTMLElement = problems[0]!;
      expect(hrefOf(within(oneOff).getByText("Checkout latency"))).toBe(
        oneOffHref,
      );
      expect(
        within(oneOff).getByTestId("ai-insights-problem-count"),
      ).toHaveTextContent(/^1 time · investigated 1 time · last seen /);
      expect(oneOff).toHaveTextContent(
        "No finding recorded for this problem yet.",
      );
      expect(
        within(oneOff).queryByTestId("ai-insights-problem-monitors"),
      ).not.toBeInTheDocument();
      expect(
        within(oneOff).queryByTestId("ai-insights-badge"),
      ).not.toBeInTheDocument();
    });

    test("a problem nothing above tells is listed with its monitors and parts", async () => {
      serve(ok(insights(product, { insights: [] })));
      openPage(product);

      await findTestId("ai-insights-summary");

      const [recurring] = screen.getAllByTestId("ai-insights-problem") as [
        HTMLElement,
      ];
      expect(hrefOf(within(recurring).getByText(RECURRING_TITLE))).toBe(
        subjectHref,
      );
      expect(
        within(recurring).getByTestId("ai-insights-problem-count"),
      ).toHaveTextContent(
        /^12 times · 4 in the last 7 days · investigated 5 times · last seen /,
      );
      expect(
        linksIn(within(recurring).getByTestId("ai-insights-problem-monitors")),
      ).toEqual([`${MONITOR_NAME} → ${monitorHref}`]);
      expect(
        within(recurring).getByTestId("ai-insights-problem-objects"),
      ).toHaveTextContent("Host: db-1 ×3");
      expect(
        within(recurring).getByTestId("ai-insights-next-step"),
      ).toHaveTextContent(NEXT_STEP);
    });

    test("an untitled problem is named by its latest subject", async () => {
      const [, oneOff] = makeIncidentAlertInsights(product.subjectKind)
        .problems as [AiActivityProblem, AiActivityProblem];

      serve(ok(insights(product, { problems: [{ ...oneOff, title: "" }] })));
      openPage(product);

      await findTestId("ai-insights-summary");

      expect(hrefOf(screen.getByText(product.subjectLabel))).toBe(oneOffHref);
    });

    test("what the server wrote is shown as text, never as markup", async () => {
      const markup: string = '<img src="x" onerror="window.hacked=1">';
      const body: IncidentAlertAiInsights = makeIncidentAlertInsights(
        product.subjectKind,
      );
      body.insights[0] = {
        ...body.insights[0]!,
        title: markup,
        nextStep: markup,
        monitors: [{ id: MONITOR_ID, name: markup }],
        finding: { aiRunId: "run-1", text: markup, source: "tldr" },
      };
      body.insights[3] = {
        ...body.insights[3]!,
        service: { id: SERVICE_ID, name: markup },
      };
      body.problems[1] = { ...body.problems[1]!, title: markup };
      serve(ok(toBody(body)));
      openPage(product);

      const items: Array<HTMLElement> = await findInsightItems();

      expect(items[0]).toHaveTextContent(`${markup} keeps coming back`);
      expect(
        within(items[0]!).getByTestId("ai-insights-finding"),
      ).toHaveTextContent(markup);
      expect(
        within(items[0]!).getByTestId("ai-insights-next-step"),
      ).toHaveTextContent(markup);
      expect(items[3]).toHaveTextContent(
        `The ${markup} service is behind 2 different problems`,
      );
      expect(screen.getByTestId("ai-insights-problem")).toHaveTextContent(
        markup,
      );
      expect(document.querySelector("img")).toBeNull();
      expect((window as unknown as { hacked?: number }).hacked).toBeUndefined();
    });

    test("the monitors and services that keep failing link to their own pages, in place of a cluster's parts", async () => {
      serve(ok(insights(product)));
      openPage(product);

      await findTestId("ai-insights-summary");

      expect(screen.getByText("Monitors that keep failing")).toBeInTheDocument();
      const monitors: HTMLElement = screen.getByTestId("ai-insights-monitors");
      expect(linksIn(monitors)).toEqual([`${MONITOR_NAME} → ${monitorHref}`]);
      expect(monitors).toHaveTextContent(
        `12 ${product.plural} · 1 problem · last seen`,
      );

      expect(screen.getByText("Services that keep failing")).toBeInTheDocument();
      const services: HTMLElement = screen.getByTestId("ai-insights-services");
      expect(linksIn(services)).toEqual([`${SERVICE_NAME} → ${serviceHref}`]);
      expect(services).toHaveTextContent(
        `7 ${product.plural} · 2 problems · last seen`,
      );

      // A project has no parts of its own: no parts card.
      expect(
        screen.queryByText("Where problems happen"),
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

    describe("what OneUptime AI did: the footnote", () => {
      test("the window at a glance: investigations, how much of what came in, fixes and commands", async () => {
        serve(ok(insights(product)));
        openPage(product);

        const summary: HTMLElement = await findTestId("ai-insights-summary");
        expect(
          follows(screen.getByTestId("ai-insights-insights"), summary),
        ).toBe(true);
        const stat: (name: string) => HTMLElement = (name: string) => {
          return within(summary).getByTestId(`ai-insights-stat-${name}`);
        };

        expect(stat("investigations")).toHaveTextContent(
          "Investigations122 failed or timed out",
        );
        expect(stat("coverage")).toHaveTextContent(
          `${product.coverageStat}12 of 20Created in the last 30 days`,
        );
        expect(stat("fixes")).toHaveTextContent("Fixes52 verified");
        expect(stat("commands")).toHaveTextContent(
          "Commands302 failed, 1 never ran",
        );

        // A day of the window per bar.
        expect(screen.getAllByTestId("ai-insights-trend-day")).toHaveLength(30);
        expect(screen.getByTestId("ai-insights-trend-weeks")).toHaveTextContent(
          "4 investigations in the last 7 days (0 the 7 days before).",
        );
      });

      test("what went wrong with its own work points at AI Logs: these pages have no AI agent page", async () => {
        serve(ok(insights(product)));
        openPage(product);

        const health: HTMLElement = await findTestId("ai-insights-health");
        const notes: Array<HTMLElement> = within(health).getAllByTestId(
          "ai-insights-health-note",
        );

        expect(
          notes.map((note: HTMLElement): Array<string> => {
            return [note.textContent || "", ...linksIn(note)];
          }),
        ).toEqual([
          [
            "2 investigations failed or timed out in the last 30 days.Open AI Logs",
            `Open AI Logs → ${logsHref}`,
          ],
          [
            "1 command OneUptime AI sent was never picked up by the agent.Open AI Logs",
            `Open AI Logs → ${logsHref}`,
          ],
        ]);
        expect(within(health).getByTestId("ai-insights-trust")).toHaveTextContent(
          "3 findings were confirmed by your team or matched the root cause recorded later.",
        );
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

        expect(
          screen.getByTestId("ai-insights-fixes-hidden"),
        ).toHaveTextContent(
          "Fix numbers are not shown: seeing them needs permission to read auto-remediation suggestions.",
        );
        expect(
          screen.queryByTestId("ai-insights-fix-verification"),
        ).not.toBeInTheDocument();

        // A day's bar never says "0 fixes" to a reader who may not see them.
        for (const day of screen.getAllByTestId("ai-insights-trend-day")) {
          expect(day.getAttribute("title")).not.toContain("fixes");
        }

        // The fix pull requests are AI runs, shown as before.
        expect(screen.getByTestId("ai-insights-fix-tasks")).toHaveTextContent(
          "Pull request opened (1)",
        );
      });

      test("with no fix and no pull request, there is no fixes section", async () => {
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

        expect(
          screen.queryByTestId("ai-insights-fixes"),
        ).not.toBeInTheDocument();
      });

      test("what AI looked at: how much it investigated, why not the rest, and the way to AI → Settings", async () => {
        serve(ok(insights(product)));
        openPage(product);

        const coverage: HTMLElement = await findTestId("ai-insights-coverage");

        expect(coverage).toHaveTextContent(product.coverageSentence);

        const rows: Array<HTMLElement> = Array.from(
          within(coverage)
            .getByTestId("ai-insights-not-investigated")
            .querySelectorAll("li"),
        );

        expect(
          rows.map((row: HTMLElement): [string | null, string] => {
            return [row.getAttribute("data-code"), row.textContent || ""];
          }),
        ).toEqual([
          [
            "provider_missing",
            "There is no LLM provider OneUptime AI can use.6",
          ],
          [
            "severity_below_threshold",
            "They were below the minimum severity to investigate.2",
          ],
        ]);

        expect(linksIn(coverage)).toEqual([
          `Choose what OneUptime AI does on its own in AI → Settings → ${settingsHref}`,
        ]);
      });

      test("says when the insights cover only the newest of what happened", async () => {
        serve(ok(insights(product, { isPartial: true })));
        openPage(product);

        expect(await findTestId("ai-insights-partial")).toHaveTextContent(
          "There was more here than these insights read: they cover the newest of it.",
        );
      });
    });

    test("with no AI work at all: one empty state, and still why nothing was investigated", async () => {
      serve(ok(toBody(makeQuietIncidentAlertInsights(product.subjectKind))));
      openPage(product);

      const empty: HTMLElement = await findTestId("ai-insights-empty");

      expect(empty).toHaveTextContent("Nothing to show yet");
      expect(empty).toHaveTextContent(
        AI_INSIGHTS_EMPTY_DESCRIPTIONS[product.subjectKind],
      );
      expect(hrefOf(within(empty).getByText("Open AI Logs"))).toBe(logsHref);

      expect(screen.getByText("What OneUptime AI looked at")).toBeInTheDocument();
      const coverage: HTMLElement = screen.getByTestId("ai-insights-coverage");
      expect(coverage).toHaveTextContent(
        `OneUptime AI investigated 0 of the 7 ${product.plural} created in the last 30 days.`,
      );
      expect(coverage).toHaveTextContent(
        "There is no LLM provider OneUptime AI can use.",
      );
      expect(follows(empty, coverage)).toBe(true);

      expect(
        screen.queryByTestId("ai-insights-summary"),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId("ai-insights-insights"),
      ).not.toBeInTheDocument();
    });

    test("with AI off for the project, a notice says nothing new shows up here", async () => {
      isAiOn = false;
      setPermissions([Permission.ProjectMember]);
      serve(ok(insights(product)));
      openPage(product);

      const notice: HTMLElement = await findTestId(
        PROJECT_AI_OFF_NOTICE_TEST_ID,
      );
      expect(notice).toHaveTextContent(
        "OneUptime AI is off for this project, so nothing new is investigated or fixed, and nothing new shows up on this page.",
      );
      expect(follows(notice, await findTestId("ai-insights-insights"))).toBe(
        true,
      );
    });

    test("an error says what went wrong, and Retry loads the insights again", async () => {
      serve(httpError(500, "The database is asleep."), ok(insights(product)));
      openPage(product);

      const error: HTMLElement = await findTestId("ai-insights-error");

      expect(error).toHaveTextContent("The database is asleep.");

      fireEvent.click(within(error).getByRole("button"));

      await findTestId("ai-insights-insights");
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

function follows(first: HTMLElement, second: HTMLElement): boolean {
  return Boolean(
    first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING,
  );
}

describe("the AI Insights page between products", () => {
  test("an answer for the product the page has left never paints over the one it shows", async () => {
    const [incident, alert] = PRODUCTS as [Product, Product];
    const slow: { answer: Answer; release: (body: unknown) => void } =
      deferred();

    serve(
      slow.answer,
      ok(
        insights(alert, {
          insights: [
            {
              kind: AiActivityInsightKind.RecurringProblem,
              tone: AiActivityInsightTone.Critical,
              count: 4,
              title: "Queue backlog",
            },
          ],
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
      await screen.findByText(
        "Queue backlog keeps coming back",
        {},
        { timeout: WAIT_TIMEOUT },
      ),
    ).toBeInTheDocument();

    await act(async () => {
      slow.release(insights(incident));
    });

    expect(
      screen.getByText("Queue backlog keeps coming back"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(`${RECURRING_TITLE} keeps coming back`),
    ).not.toBeInTheDocument();
    expect(requestsTo(incident.route)).toHaveLength(1);
    expect(requestsTo(alert.route)).toHaveLength(1);
  });
});
