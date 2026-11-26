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
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import React from "react";
import { MemoryRouter, Route as PageRoute, Routes } from "react-router-dom";
import SettingsAIResults from "../../../../App/FeatureSet/Dashboard/src/Pages/Settings/AIResults";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import Project from "../../../Models/DatabaseModels/Project";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Route from "../../../Types/API/Route";
import {
  AiOutcomes,
  AiOutcomesDataSecurity,
  AiOutcomesPart,
  AiOutcomesRecords,
} from "../../../Types/AI/AiOutcomes";
import { DataSecurityAiProposalKind } from "../../../Types/DataSecurity/DataSecurityAi";
import OneUptimeDate from "../../../Types/Date";
import { JSONObject } from "../../../Types/JSON";
import Permission from "../../../Types/Permission";
import Timezone from "../../../Types/Timezone";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import PermissionUtil from "../../../UI/Utils/Permission";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";
import {
  makeDataSecurity,
  makeEmptyOutcomes,
  makeOutcomes,
  makeQuietWeeks,
  toBody,
} from "./AiResultsFixtures";
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
 * Settings → AI → AI Results counts Data Security (#10364), rendered for
 * real on its real route: the card - what worked of the changes OneUptime
 * AI made, what came of the others, the proposals your team decided on,
 * the issues it analyzed and how long an issue took to pass its check -
 * and the records each of its numbers opens, every one linked to its
 * issue's page.
 */

const WAIT_TIMEOUT: number = 20000;

const OUTCOMES_ROUTE: string = "/ai-activity/outcomes";
const RECORDS_ROUTE: string = "/ai-activity/outcomes/records";
const PROVIDERS_ROUTE: string = "/ai-chat/providers";

const CARD_TEST_ID: string = "ai-results-card-data-security";
const ISSUE_ID: string = "77777777-7777-4777-8777-777777777777";
const OTHER_ISSUE_ID: string = "88888888-8888-4888-8888-888888888888";

let postSpy: ReturnType<typeof jest.spyOn>;
let outcomesBody: JSONObject = toBody(makeOutcomes());
let recordsBody: JSONObject | null = null;

function recordsRequests(): Array<JSONObject> {
  return postSpy.mock.calls
    .map((call: Array<unknown>): JSONObject => {
      return (call[0] || {}) as JSONObject;
    })
    .filter((request: JSONObject): boolean => {
      return String(request["url"]).endsWith(RECORDS_ROUTE);
    });
}

const PAGE_PATH: string = RouteMap[
  PageMap.SETTINGS_AI_RESULTS
]!.toString().replace(":projectId", PROJECT_ID);

function withDataSecurity(
  overrides: Partial<AiOutcomesDataSecurity> = {},
  outcomes: Partial<AiOutcomes> = {},
): AiOutcomes {
  return makeOutcomes({
    dataSecurity: makeDataSecurity(overrides),
    ...outcomes,
  });
}

async function openWith(outcomes: AiOutcomes): Promise<void> {
  outcomesBody = toBody(outcomes);
  goTo(PAGE_PATH);

  render(
    <MemoryRouter initialEntries={[PAGE_PATH]}>
      <Routes>
        <PageRoute
          path={RouteMap[PageMap.SETTINGS_AI_RESULTS]!.toString()}
          element={
            <SettingsAIResults
              pageRoute={RouteMap[PageMap.SETTINGS_AI_RESULTS] as Route}
              currentProject={null}
              hasPaymentMethod={true}
            />
          }
        />
      </Routes>
    </MemoryRouter>,
  );

  await screen.findByTestId("ai-results-window", {}, { timeout: WAIT_TIMEOUT });
}

async function findTestId(testId: string): Promise<HTMLElement> {
  return await screen.findByTestId(testId, {}, { timeout: WAIT_TIMEOUT });
}

function textOf(element: HTMLElement): string {
  return withoutIsolateMarks(element.textContent || "")
    .replace(/\u00A0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function theCard(): HTMLElement {
  return screen.getByTestId(CARD_TEST_ID);
}

// A part's legend button, by its words, on the Data Security card.
function partButton(label: string): HTMLElement {
  const button: HTMLElement | undefined = within(theCard())
    .getAllByTestId("stacked-progress-bar-legend-button")
    .find((candidate: HTMLElement): boolean => {
      return textOf(candidate).startsWith(label);
    });

  if (!button) {
    throw new Error(`No part "${label}" on the Data Security card.`);
  }

  return button;
}

// The records as the server's JSON body carries them.
function recordsJson(recordsToSend: AiOutcomesRecords): JSONObject {
  return JSON.parse(JSON.stringify(recordsToSend)) as JSONObject;
}

function records(
  overrides: Partial<AiOutcomesRecords> = {},
): AiOutcomesRecords {
  return {
    part: AiOutcomesPart.DataSecurityChanges,
    outcome: "proven",
    total: 2,
    records: [
      {
        id: "11111111-aaaa-4aaa-8aaa-000000000001",
        at: "2026-11-10T09:00:00.000Z",
        dataSecurityIssue: { id: ISSUE_ID, title: "Secrets in telemetry" },
        proposalTitle: "Scrub API Key in attributes of checkout-logs",
        proposalKind: DataSecurityAiProposalKind.ScrubTelemetry,
      },
      {
        id: "11111111-aaaa-4aaa-8aaa-000000000002",
        at: "2026-11-02T09:00:00.000Z",
        dataSecurityIssue: { id: OTHER_ISSUE_ID },
        proposalKind: DataSecurityAiProposalKind.ScrubTelemetry,
      },
    ],
    nextSkip: null,
    ...overrides,
  };
}

beforeEach(() => {
  window.localStorage.clear();
  PermissionGate.clearPermissionPropsCache();
  outcomesBody = toBody(makeOutcomes());
  recordsBody = null;

  jest
    .spyOn(API, "get")
    .mockImplementation(
      async (request: unknown): Promise<HTTPResponse<JSONObject>> => {
        const url: string = String((request as JSONObject)["url"]);

        if (url.endsWith("/ai-chat/ratings")) {
          return new HTTPResponse<JSONObject>(
            200,
            { sinceDays: 90, helpful: 0, notHelpful: 0, ratedDownDrewOn: [] },
            {},
          );
        }

        throw new Error(`Unexpected request to ${url}`);
      },
    );

  postSpy = jest.spyOn(API, "post");
  postSpy.mockImplementation(
    async (
      request: unknown,
    ): Promise<HTTPResponse<JSONObject> | HTTPErrorResponse> => {
      const url: string = String((request as JSONObject)["url"]);

      if (url.endsWith(OUTCOMES_ROUTE)) {
        return new HTTPResponse<JSONObject>(200, outcomesBody, {});
      }

      if (url.endsWith(RECORDS_ROUTE)) {
        if (!recordsBody) {
          throw new Error(`No answer queued for ${url}`);
        }

        return new HTTPResponse<JSONObject>(200, recordsBody, {});
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
        enableAi: true,
      });
    });
  jest
    .spyOn(ModelAPI, "getCommonHeaders")
    .mockReturnValue({ tenantid: PROJECT_ID });
  jest
    .spyOn(OneUptimeDate, "getCurrentTimezone")
    .mockReturnValue("UTC" as Timezone);
  jest
    .spyOn(OneUptimeDate, "getUserPrefers12HourFormat")
    .mockReturnValue(false);
  jest
    .spyOn(PermissionUtil, "getAllPermissions")
    .mockReturnValue([Permission.ProjectOwner]);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("the Data Security card", () => {
  test("comes after the other cards, titled Data Security, with what worked of the changes made", async () => {
    await openWith(withDataSecurity());

    const cards: Array<string> = screen
      .getAllByTestId(/^ai-results-card-/)
      .map((element: HTMLElement): string => {
        return element.getAttribute("data-testid") || "";
      });

    expect(cards[cards.length - 1]).toBe(CARD_TEST_ID);
    expect(screen.getAllByText("Data Security").length).toBeGreaterThan(0);
    expect(textOf(within(theCard()).getByTestId("ai-results-headline"))).toBe(
      "9 of 13 changes OneUptime AI made worked.",
    );
    expect(textOf(within(theCard()).getByTestId("ai-results-value"))).toBe("9");
  });

  test("its parts are buttons that show the issues: the changes, then the proposals your team decided on", async () => {
    await openWith(withDataSecurity());

    const buttons: Array<HTMLElement> = within(theCard()).getAllByTestId(
      "stacked-progress-bar-legend-button",
    );

    // Each one's words and count, then what it shows, read by a screen reader.
    expect(buttons.map(textOf)).toEqual([
      "It worked: the issue's check passed (9) Show the issues",
      "Waiting for the issue's check to pass (3) Show the issues",
      "Undone by a person (1) Show the issues",
      "Could not be made: nothing changed (2) Show the issues",
      "Approved (5) Show the issues",
      "Dismissed (2) Show the issues",
    ]);

    for (const button of buttons) {
      expect(button).toHaveAttribute("title", "Show the issues");
      expect(button).toHaveAttribute("aria-haspopup", "dialog");
    }

    expect(
      within(theCard()).getByText("Changes OneUptime AI made"),
    ).toBeInTheDocument();
    expect(
      within(theCard()).getByText("Proposals your team decided on"),
    ).toBeInTheDocument();
  });

  test("beside the bars: the issues it analyzed, as a button, and how long an issue took, in hours and minutes", async () => {
    await openWith(withDataSecurity());

    const facts: Array<HTMLElement> =
      within(theCard()).getAllByTestId("ai-results-fact");

    expect(
      facts.map((fact: HTMLElement): [string, string] => {
        return [
          textOf(fact.querySelector("dt") as HTMLElement),
          textOf(fact.querySelector("dd") as HTMLElement),
        ];
      }),
    ).toEqual([
      ["Issues OneUptime AI analyzed", "14"],
      ["Median time from an issue opening to its check passing", "3 h 25 min"],
    ]);

    const button: HTMLElement = within(facts[0]!).getByTestId(
      "ai-results-fact-button",
    );

    expect(button.tagName).toBe("BUTTON");
    expect(button).toHaveAttribute("type", "button");
    expect(button).toHaveAttribute("title", "Show the issues");
    expect(
      within(facts[1]!).queryByTestId("ai-results-fact-button"),
    ).toBeNull();
  });

  test("its weeks: what worked of the changes made, and the last four against the four before", async () => {
    await openWith(withDataSecurity());

    const legend: HTMLElement = within(theCard()).getByTestId(
      "ai-results-weeks-legend",
    );

    expect(textOf(legend)).toContain("Changes that worked");
    expect(textOf(legend)).toContain("All changes made");
    expect(
      textOf(within(theCard()).getByTestId("ai-results-recent-weeks")),
    ).toBe("Last 4 weeks: 6 of 9. The 4 weeks before: 2 of 3.");
    expect(within(theCard()).getAllByTestId("ai-results-week")).toHaveLength(
      12,
    );
  });

  test("By kind, once two kinds of change were made", async () => {
    await openWith(
      withDataSecurity({
        kinds: [
          {
            kind: DataSecurityAiProposalKind.ScrubTelemetry,
            proven: 7,
            waiting: 2,
            undone: 1,
            failed: 2,
            approved: 4,
            dismissed: 2,
          },
          {
            kind: "RevokeAccess",
            proven: 2,
            waiting: 1,
            undone: 0,
            failed: 0,
            approved: 1,
            dismissed: 0,
          },
        ],
      }),
    );

    const rows: Array<HTMLElement> = within(
      within(theCard()).getByTestId("ai-results-by-kind"),
    ).getAllByTestId("ai-results-by-kind-row");

    expect(rows.map(textOf)).toEqual([
      "Scrub rules7 of 10",
      "RevokeAccess2 of 3",
    ]);
    expect(
      rows.map((row: HTMLElement) => {
        return row.getAttribute("data-kind");
      }),
    ).toEqual([DataSecurityAiProposalKind.ScrubTelemetry, "RevokeAccess"]);
  });

  test("one kind alone: no By kind", async () => {
    await openWith(withDataSecurity());

    expect(within(theCard()).queryByTestId("ai-results-by-kind")).toBeNull();
  });

  test("with no change made: how a change comes to count, and nothing to open", async () => {
    await openWith(
      makeEmptyOutcomes({
        weeks: makeQuietWeeks(),
        dataSecurity: makeDataSecurity({
          issuesAnalyzed: 2,
          changes: { proven: 0, waiting: 0, undone: 0, failed: 0 },
          proposals: { approved: 0, dismissed: 0 },
          kinds: [],
          medianMinutesToCheckPassed: null,
          issuesCheckPassed: 0,
        }),
      }),
    );

    expect(
      Array.from(
        within(theCard()).getByTestId("ai-results-start").querySelectorAll("p"),
      ).map(textOf),
    ).toEqual([
      "OneUptime AI analyzed 2 Data Security issues.",
      "When OneUptime AI makes a change for a Data Security issue, on its own or once your team approves it, whether the issue's own check then passes shows up here.",
    ]);
    expect(
      within(theCard()).queryAllByTestId("stacked-progress-bar-legend-button"),
    ).toEqual([]);
    expect(within(theCard()).queryByTestId("ai-results-weeks")).toBeNull();
  });

  test("a reader who may not read Data Security sees no card", async () => {
    await openWith(makeOutcomes({ dataSecurity: null }));

    expect(screen.queryByTestId(CARD_TEST_ID)).toBeNull();
  });

  test("Data Security alone is something to show: no empty page", async () => {
    await openWith(
      makeOutcomes({
        pages: null,
        remediationFixes: null,
        pullRequestFixes: null,
        rootCauses: null,
        dataSecurity: makeDataSecurity(),
      }),
    );

    expect(screen.queryByTestId("ai-results-empty")).toBeNull();
    expect(screen.queryByTestId("ai-results-not-readable")).toBeNull();
    expect(theCard()).toBeInTheDocument();
  });
});

describe("what each Data Security number opens", () => {
  test("a part asks for its records in the window the page counted, and lists each issue, linked to its page, with the change made for it", async () => {
    recordsBody = recordsJson(records());
    await openWith(withDataSecurity());

    fireEvent.click(partButton("It worked: the issue's check passed"));

    const dialog: HTMLElement = await findTestId("ai-results-records");
    const list: HTMLElement = await findTestId("ai-results-records-list");
    const requests: Array<JSONObject> = recordsRequests();

    expect(requests).toHaveLength(1);
    expect(requests[0]!["data"]).toEqual({
      part: "dataSecurityChanges",
      outcome: "proven",
      windowEnd: makeOutcomes().windowEnd,
    });
    expect(dialog).toHaveAttribute("data-part", "dataSecurityChanges");
    expect(dialog).toHaveAttribute("data-outcome", "proven");
    expect(
      screen.getByRole("dialog", {
        name: /It worked: the issue's check passed/,
      }),
    ).toBeInTheDocument();
    expect(
      textOf(screen.getByRole("dialog")).includes(
        "2 changes for Data Security issues over the last 12 weeks, newest first.",
      ),
    ).toBe(true);

    const issues: Array<HTMLElement> = within(list).getAllByTestId(
      "ai-results-records-issue",
    );

    // Its title, else what it is.
    expect(issues.map(textOf)).toEqual([
      "Secrets in telemetry",
      "Data Security Issue",
    ]);
    expect(issues[0]!.closest("a") || issues[0]).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/data-security/issues/${ISSUE_ID}`,
    );
    expect(issues[1]!.closest("a") || issues[1]).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/data-security/issues/${OTHER_ISSUE_ID}`,
    );
    // What OneUptime AI changed, as it wrote it; its kind when nothing says.
    expect(
      within(list).getAllByTestId("ai-results-records-proposal").map(textOf),
    ).toEqual(["Scrub API Key in attributes of checkout-logs"]);
    expect(
      within(list).getAllByTestId("ai-results-records-facts").map(textOf),
    ).toEqual(["Scrub rules"]);
    // No incident or alert is named.
    expect(within(list).queryByTestId("ai-results-records-subject")).toBeNull();
  });

  test("the issues analyzed open from their count, under its label", async () => {
    recordsBody = recordsJson(
      records({
        part: AiOutcomesPart.DataSecurityAnalyses,
        outcome: "analyzed",
        total: 1,
        records: [
          {
            id: "11111111-aaaa-4aaa-8aaa-000000000003",
            at: "2026-11-10T09:00:00.000Z",
            dataSecurityIssue: { id: ISSUE_ID, title: "Secrets in telemetry" },
          },
        ],
      }),
    );
    await openWith(withDataSecurity());

    fireEvent.click(within(theCard()).getByTestId("ai-results-fact-button"));

    const dialog: HTMLElement = await findTestId("ai-results-records");
    await findTestId("ai-results-records-list");

    expect(recordsRequests()[0]!["data"]).toEqual({
      part: "dataSecurityAnalyses",
      outcome: "analyzed",
      windowEnd: makeOutcomes().windowEnd,
    });
    expect(dialog).toHaveAttribute("data-part", "dataSecurityAnalyses");
    expect(
      screen.getByRole("dialog", { name: /Issues OneUptime AI analyzed/ }),
    ).toBeInTheDocument();
    expect(
      textOf(screen.getByRole("dialog")).includes(
        "1 Data Security issue OneUptime AI analyzed over the last 12 weeks.",
      ),
    ).toBe(true);
  });

  test("the proposals your team dismissed open too", async () => {
    recordsBody = recordsJson(
      records({
        part: AiOutcomesPart.DataSecurityProposals,
        outcome: "dismissed",
        total: 1,
        records: [records().records[0]!],
      }),
    );
    await openWith(withDataSecurity());

    fireEvent.click(partButton("Dismissed"));

    await findTestId("ai-results-records-list");

    expect(recordsRequests()[0]!["data"]).toEqual({
      part: "dataSecurityProposals",
      outcome: "dismissed",
      windowEnd: makeOutcomes().windowEnd,
    });
    expect(
      textOf(screen.getByRole("dialog")).includes(
        "1 proposal by OneUptime AI over the last 12 weeks.",
      ),
    ).toBe(true);
  });
});
