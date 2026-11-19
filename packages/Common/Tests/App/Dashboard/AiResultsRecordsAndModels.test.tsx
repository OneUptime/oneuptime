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
  act,
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
  AiOutcomesPart,
  AiOutcomesRecords,
} from "../../../Types/AI/AiOutcomes";
import AIRunAutoGrade from "../../../Types/AI/AIRunAutoGrade";
import AIRunHumanVerdict from "../../../Types/AI/AIRunHumanVerdict";
import OneUptimeDate from "../../../Types/Date";
import { JSONObject } from "../../../Types/JSON";
import Permission from "../../../Types/Permission";
import Timezone from "../../../Types/Timezone";
import { APP_API_URL } from "../../../UI/Config";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import PermissionUtil from "../../../UI/Utils/Permission";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import { makeModels, makeOutcomes, toBody } from "./AiResultsFixtures";
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
 * Settings → AI → AI Results, rendered for real on its real route:
 *
 *   - #7768: each part of a card's breakdown is a button that opens the
 *     records it counts - the incidents and alerts behind "Paged: the hold
 *     time ran out (2)", the investigations behind "Missed the root cause
 *     (3)", the pull requests behind "Still happening after the fix (2)" -
 *     read from POST /ai-activity/outcomes/records for the window the page
 *     counted, a page at a time;
 *   - #7762: By model on Root Causes Confirmed and Fixes Verified, once two
 *     models ran, and the week the investigations moved to another model
 *     marked on every card's weeks.
 */

const WAIT_TIMEOUT: number = 20000;

const OUTCOMES_ROUTE: string = "/ai-activity/outcomes";
const RECORDS_ROUTE: string = "/ai-activity/outcomes/records";
const PROVIDERS_ROUTE: string = "/ai-chat/providers";

const INCIDENT_ID: string = "55555555-5555-4555-8555-555555555555";
const ALERT_ID: string = "66666666-6666-4666-8666-666666666666";

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

let postSpy: ReturnType<typeof jest.spyOn>;
let outcomesBody: JSONObject = toBody(makeOutcomes());
let recordAnswers: Array<Answer> = [];

function serveRecords(...queue: Array<Answer>): void {
  recordAnswers = [...queue];
}

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
  return (element.textContent || "")
    .replace(/\u00A0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// The legend button of a part, by its words, in a card.
function partButton(cardTestId: string, label: string): HTMLElement {
  const buttons: Array<HTMLElement> = within(
    screen.getByTestId(cardTestId),
  ).getAllByTestId("stacked-progress-bar-legend-button");
  const button: HTMLElement | undefined = buttons.find(
    (candidate: HTMLElement): boolean => {
      return textOf(candidate).startsWith(label);
    },
  );

  if (!button) {
    throw new Error(`No part "${label}" in ${cardTestId}.`);
  }

  return button;
}

function records(
  overrides: Partial<AiOutcomesRecords> = {},
): AiOutcomesRecords {
  return {
    part: AiOutcomesPart.Pages,
    outcome: "holdTimeRanOut",
    total: 2,
    records: [
      {
        id: "11111111-aaaa-4aaa-8aaa-000000000001",
        at: "2026-11-10T09:00:00.000Z",
        subject: {
          kind: "incident",
          id: INCIDENT_ID,
          title: "Checkout is down",
          numberWithPrefix: "INC-42",
        },
      },
      {
        id: "11111111-aaaa-4aaa-8aaa-000000000002",
        at: "2026-11-02T09:00:00.000Z",
        subject: {
          kind: "alert",
          id: ALERT_ID,
          title: "Disk is full",
          number: 7,
        },
      },
    ],
    nextSkip: null,
    ...overrides,
  };
}

beforeEach(() => {
  window.localStorage.clear();
  PermissionGate.clearPermissionPropsCache();
  recordAnswers = [];
  outcomesBody = toBody(makeOutcomes());

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
        const answer: Answer | undefined =
          recordAnswers.length > 1 ? recordAnswers.shift() : recordAnswers[0];

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

describe("each part of a breakdown opens what it counts (#7768)", () => {
  test("every part of every card is a button that says what it shows, and opens a dialog", async () => {
    await openWith(makeOutcomes());

    const buttons: Array<HTMLElement> = screen.getAllByTestId(
      "stacked-progress-bar-legend-button",
    );

    // Every part with something in it: 6 page outcomes, 4 + 5 fixes, 3 judgements.
    expect(buttons).toHaveLength(18);

    for (const button of buttons) {
      expect(button.tagName).toBe("BUTTON");
      expect(button).toHaveAttribute("type", "button");
      expect(button).toHaveAttribute("aria-haspopup", "dialog");
    }

    expect(
      partButton(
        "ai-results-card-pages-avoided",
        "Paged: the hold time ran out",
      ),
    ).toHaveAttribute("title", "Show the incidents and alerts");
    expect(
      partButton(
        "ai-results-card-fixes-verified",
        "Still happening after the fix",
      ),
    ).toHaveAttribute("title", "Show the pull requests");
    expect(
      partButton(
        "ai-results-card-root-causes-confirmed",
        "Missed the root cause",
      ),
    ).toHaveAttribute("title", "Show the incidents and alerts");
  });

  test("a part asks for its records in the window the page counted, and lists each incident and alert, linked to it", async () => {
    serveRecords(ok(records()));
    await openWith(makeOutcomes());

    fireEvent.click(
      partButton(
        "ai-results-card-pages-avoided",
        "Paged: the hold time ran out",
      ),
    );

    const dialog: HTMLElement = await findTestId("ai-results-records");
    const list: HTMLElement = await findTestId("ai-results-records-list");

    const requests: Array<JSONObject> = recordsRequests();
    expect(requests).toHaveLength(1);
    expect(String(requests[0]!["url"])).toBe(
      `${APP_API_URL.toString()}${RECORDS_ROUTE}`,
    );
    expect(requests[0]!["data"]).toEqual({
      part: "pages",
      outcome: "holdTimeRanOut",
      windowEnd: makeOutcomes().windowEnd,
    });
    expect(requests[0]!["headers"]).toEqual({ tenantid: PROJECT_ID });

    expect(dialog).toHaveAttribute("data-part", "pages");
    expect(dialog).toHaveAttribute("data-outcome", "holdTimeRanOut");
    expect(
      screen.getByRole("dialog", { name: /Paged: the hold time ran out/ }),
    ).toBeInTheDocument();
    expect(
      textOf(screen.getByRole("dialog")).includes(
        "2 held pages over the last 12 weeks, newest first.",
      ),
    ).toBe(true);

    const subjects: Array<HTMLElement> = within(list).getAllByTestId(
      "ai-results-records-subject",
    );

    expect(subjects.map(textOf)).toEqual([
      "Incident INC-42: Checkout is down",
      "Alert #7: Disk is full",
    ]);
    expect(subjects[0]!.closest("a") || subjects[0]).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/incidents/${INCIDENT_ID}`,
    );
    expect(subjects[1]!.closest("a") || subjects[1]).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/alerts/${ALERT_ID}`,
    );
    // When each one's work started, in the reader's clock.
    expect(
      within(list).getAllByRole("listitem")[0]!.querySelector("time"),
    ).toHaveAttribute("dateTime", "2026-11-10T09:00:00.000Z");
  });

  test("an investigation says what it found and how it was judged", async () => {
    serveRecords(
      ok(
        records({
          part: AiOutcomesPart.RootCauses,
          outcome: "wrong",
          total: 1,
          records: [
            {
              id: "11111111-aaaa-4aaa-8aaa-000000000003",
              at: "2026-11-10T09:00:00.000Z",
              subject: {
                kind: "incident",
                id: INCIDENT_ID,
                title: "Checkout is down",
                numberWithPrefix: "INC-42",
              },
              summary: "The database ran out of connections.",
              humanVerdict: AIRunHumanVerdict.Rejected,
              autoGrade: AIRunAutoGrade.Mismatch,
            },
          ],
        }),
      ),
    );
    await openWith(makeOutcomes());

    fireEvent.click(
      partButton(
        "ai-results-card-root-causes-confirmed",
        "Missed the root cause",
      ),
    );

    const list: HTMLElement = await findTestId("ai-results-records-list");

    expect(recordsRequests()[0]!["data"]).toMatchObject({
      part: "rootCauses",
      outcome: "wrong",
    });
    expect(textOf(within(list).getByTestId("ai-results-records-summary"))).toBe(
      "The database ran out of connections.",
    );
    expect(
      Array.from(
        within(list).getByTestId("ai-results-records-facts").children,
      ).map((fact: Element): string => {
        return textOf(fact as HTMLElement);
      }),
    ).toEqual([
      "Rejected by your team",
      "Did not match the recorded root cause",
    ]);
    expect(
      textOf(screen.getByRole("dialog")).includes(
        "1 investigation OneUptime AI finished over the last 12 weeks.",
      ),
    ).toBe(true);
  });

  test("a fix pull request links to itself, in a new tab, with its title; one about no incident has no incident link", async () => {
    serveRecords(
      ok(
        records({
          part: AiOutcomesPart.PullRequestFixes,
          outcome: "regressed",
          total: 1,
          records: [
            {
              id: "11111111-aaaa-4aaa-8aaa-000000000004",
              at: "2026-11-10T09:00:00.000Z",
              pullRequestNumber: 42,
              pullRequestTitle: "Raise the checkout timeout",
              pullRequestUrl: "https://github.com/acme/shop/pull/42",
            },
          ],
        }),
      ),
    );
    await openWith(makeOutcomes());

    fireEvent.click(
      partButton(
        "ai-results-card-fixes-verified",
        "Still happening after the fix",
      ),
    );

    const list: HTMLElement = await findTestId("ai-results-records-list");
    const pullRequest: HTMLElement = within(list).getByTestId(
      "ai-results-records-pull-request",
    );

    expect(textOf(pullRequest)).toBe(
      "Pull request #42 · Raise the checkout timeout",
    );

    const link: HTMLElement = within(pullRequest).getByText("Pull request #42");
    const anchor: HTMLElement = (link.closest("a") || link) as HTMLElement;

    expect(anchor).toHaveAttribute(
      "href",
      "https://github.com/acme/shop/pull/42",
    );
    expect(anchor).toHaveAttribute("target", "_blank");
    expect(
      within(list).queryByTestId("ai-results-records-subject"),
    ).not.toBeInTheDocument();
  });

  test("a fix OneUptime AI ran names its runbook", async () => {
    serveRecords(
      ok(
        records({
          part: AiOutcomesPart.RemediationFixes,
          outcome: "failed",
          total: 1,
          records: [
            {
              id: "11111111-aaaa-4aaa-8aaa-000000000005",
              at: "2026-11-10T09:00:00.000Z",
              subject: {
                kind: "alert",
                id: ALERT_ID,
                title: "Disk is full",
                number: 7,
              },
              runbookName: "Clear the tmp folder",
            },
          ],
        }),
      ),
    );
    await openWith(makeOutcomes());

    fireEvent.click(
      partButton(
        "ai-results-card-fixes-verified",
        "It did not fix the problem",
      ),
    );

    const list: HTMLElement = await findTestId("ai-results-records-list");

    expect(textOf(within(list).getByTestId("ai-results-records-facts"))).toBe(
      "Runbook: Clear the tmp folder",
    );
  });

  test("Show more reads the next page and adds it under the first", async () => {
    const second: AiOutcomesRecords = records({
      total: 3,
      records: [
        {
          id: "11111111-aaaa-4aaa-8aaa-000000000009",
          at: "2026-10-01T09:00:00.000Z",
          subject: {
            kind: "incident",
            id: INCIDENT_ID,
            title: "Checkout is down again",
            numberWithPrefix: "INC-43",
          },
        },
      ],
      nextSkip: null,
    });

    serveRecords(ok(records({ total: 3, nextSkip: 2 })), ok(second));
    await openWith(makeOutcomes());

    fireEvent.click(
      partButton(
        "ai-results-card-pages-avoided",
        "Paged: the hold time ran out",
      ),
    );

    await findTestId("ai-results-records-list");

    await act(async () => {
      fireEvent.click(await findTestId("ai-results-records-more"));
    });

    await screen.findByText(
      "Incident INC-43: Checkout is down again",
      {},
      { timeout: WAIT_TIMEOUT },
    );

    expect(recordsRequests()[1]!["data"]).toEqual({
      part: "pages",
      outcome: "holdTimeRanOut",
      windowEnd: makeOutcomes().windowEnd,
      skip: 2,
    });
    expect(
      within(screen.getByTestId("ai-results-records-list")).getAllByTestId(
        "ai-results-records-item",
      ),
    ).toHaveLength(3);
    // The last page: no more to show.
    expect(
      screen.queryByTestId("ai-results-records-more"),
    ).not.toBeInTheDocument();
  });

  test("a read that failed says why, and Try again reads again", async () => {
    serveRecords(httpError(500, "The records are asleep."), ok(records()));
    await openWith(makeOutcomes());

    fireEvent.click(
      partButton(
        "ai-results-card-pages-avoided",
        "Paged: the hold time ran out",
      ),
    );

    const error: HTMLElement = await findTestId("ai-results-records-error");

    expect(error).toHaveTextContent("The records are asleep.");

    fireEvent.click(within(error).getByRole("button"));

    expect(await findTestId("ai-results-records-list")).toBeInTheDocument();
    expect(recordsRequests()).toHaveLength(2);
  });

  test("nothing counts under it any more: it says so, and how to see the latest numbers", async () => {
    serveRecords(ok(records({ total: 0, records: [] })));
    await openWith(makeOutcomes());

    fireEvent.click(
      partButton(
        "ai-results-card-pages-avoided",
        "Paged: the hold time ran out",
      ),
    );

    expect(textOf(await findTestId("ai-results-records-empty"))).toBe(
      "None any more: this changed after the page counted it. Reload the page for the latest numbers.",
    );
  });

  test("Close leaves the page as it was", async () => {
    serveRecords(ok(records()));
    await openWith(makeOutcomes());

    fireEvent.click(
      partButton(
        "ai-results-card-pages-avoided",
        "Paged: the hold time ran out",
      ),
    );

    await findTestId("ai-results-records-list");

    // The dialog's own Close, at its foot; the header's X closes it too.
    const closes: Array<HTMLElement> = screen.getAllByRole("button", {
      name: "Close",
    });

    fireEvent.click(closes[closes.length - 1]!);

    expect(screen.queryByTestId("ai-results-records")).not.toBeInTheDocument();
    expect(
      screen.getByTestId("ai-results-card-pages-avoided"),
    ).toBeInTheDocument();
  });
});

describe("By model and changes of model (#7762)", () => {
  test("Root Causes Confirmed and Fixes Verified say how each model did; Pages Avoided does not", async () => {
    await openWith(makeOutcomes({ models: makeModels() }));

    const rootCauses: HTMLElement = within(
      screen.getByTestId("ai-results-card-root-causes-confirmed"),
    ).getByTestId("ai-results-by-model");
    const fixes: HTMLElement = within(
      screen.getByTestId("ai-results-card-fixes-verified"),
    ).getByTestId("ai-results-by-model");

    const rowsOf: (section: HTMLElement) => Array<string> = (
      section: HTMLElement,
    ): Array<string> => {
      return within(section)
        .getAllByTestId("ai-results-by-model-row")
        .map(textOf);
    };

    expect(rowsOf(rootCauses)).toEqual([
      "chat-large6 of 8",
      "chat-medium4 of 5",
      "Model not recorded1 of 3",
    ]);
    expect(rowsOf(fixes)).toEqual(["chat-large4 of 5", "chat-medium2 of 4"]);
    expect(textOf(within(fixes).getByTestId("ai-results-by-model-note"))).toBe(
      "Each fix counts under the model of the investigation it came from.",
    );
    expect(
      within(screen.getByTestId("ai-results-card-pages-avoided")).queryByTestId(
        "ai-results-by-model",
      ),
    ).not.toBeInTheDocument();
  });

  test("a model's name is drawn as written, left to right", async () => {
    await openWith(makeOutcomes({ models: makeModels() }));

    const row: HTMLElement = within(
      screen.getByTestId("ai-results-card-root-causes-confirmed"),
    ).getAllByTestId("ai-results-by-model-row")[0]!;

    expect(within(row).getByText("chat-large")).toHaveAttribute("dir", "ltr");
  });

  test("no models for the reader, or one model only: no By model", async () => {
    await openWith(makeOutcomes({ models: null }));

    expect(screen.queryByTestId("ai-results-by-model")).not.toBeInTheDocument();

    cleanup();

    await openWith(
      makeOutcomes({
        models: makeModels({
          rootCauses: [{ modelName: "chat-large", value: 11, total: 16 }],
          fixes: [{ modelName: "chat-large", value: 6, total: 9 }],
        }),
      }),
    );

    expect(screen.queryByTestId("ai-results-by-model")).not.toBeInTheDocument();
  });

  test("the week the investigations moved to another model is marked on every card, named under the bars and said in words", async () => {
    await openWith(makeOutcomes({ models: makeModels() }));

    for (const cardTestId of [
      "ai-results-card-pages-avoided",
      "ai-results-card-fixes-verified",
      "ai-results-card-root-causes-confirmed",
    ]) {
      const card: HTMLElement = screen.getByTestId(cardTestId);
      const marked: Array<HTMLElement> = within(card)
        .getAllByTestId("ai-results-week")
        .filter((week: HTMLElement): boolean => {
          return week.getAttribute("data-model-change") === "true";
        });

      expect(
        marked.map((week: HTMLElement): string | null => {
          return week.getAttribute("data-week-start");
        }),
      ).toEqual(["2026-10-17"]);
      expect(
        within(marked[0]!).getByTestId("ai-results-week-model-change"),
      ).toHaveAttribute("aria-hidden", "true");
      expect(
        textOf(
          within(card).getByTestId("ai-results-weeks-legend-model-change"),
        ),
      ).toBe("Investigations moved to another model");

      const sentence: string = textOf(
        within(card).getByTestId("ai-results-model-change"),
      );

      expect(sentence).toMatch(
        /^From the week of .+, most investigations ran on chat-medium\.$/,
      );
      // A screen reader hears it with the weeks.
      expect(
        within(card).getByRole("img").getAttribute("aria-label"),
      ).toContain("most investigations ran on chat-medium.");
    }
  });

  test("no change: no mark, no legend entry, no sentence", async () => {
    await openWith(makeOutcomes({ models: makeModels({ changes: [] }) }));

    expect(
      screen.queryByTestId("ai-results-week-model-change"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("ai-results-weeks-legend-model-change"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("ai-results-model-change"),
    ).not.toBeInTheDocument();
  });
});
