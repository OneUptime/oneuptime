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
import {
  AI_RESULTS_EMPTY_DESCRIPTION,
  AI_RESULTS_EMPTY_TITLE,
  AI_RESULTS_LOAD_ERROR,
  AI_RESULTS_NOT_READABLE_DESCRIPTION,
  AI_RESULTS_NOT_READABLE_TITLE,
  AI_RESULTS_UNREADABLE_RESPONSE,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AI/Results/AiResultsData";
import { PROJECT_AI_OFF_NOTICE_TEST_ID } from "../../../../App/FeatureSet/Dashboard/src/Components/AISettings/ProjectAiSettingsCopy";
import SettingsAIResults from "../../../../App/FeatureSet/Dashboard/src/Pages/Settings/AIResults";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import Project from "../../../Models/DatabaseModels/Project";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Route from "../../../Types/API/Route";
import { AiOutcomes } from "../../../Types/AI/AiOutcomes";
import OneUptimeDate from "../../../Types/Date";
import { JSONObject } from "../../../Types/JSON";
import Permission from "../../../Types/Permission";
import Timezone from "../../../Types/Timezone";
import { APP_API_URL } from "../../../UI/Config";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import PermissionUtil from "../../../UI/Utils/Permission";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import {
  FIXES_CHECKED_BY_WEEK,
  FIXES_VERIFIED_BY_WEEK,
  PAGES_AVOIDED_BY_WEEK,
  PAGES_HELD_BY_WEEK,
  ROOT_CAUSES_CONFIRMED_BY_WEEK,
  ROOT_CAUSES_JUDGED_BY_WEEK,
  AI_RESULTS_WEEK_STARTS,
  makeEmptyOutcomes,
  makeOutcomes,
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
 * Settings → AI → AI Results (issue #6800), rendered for real on its real
 * route with the outcomes call and the AI readiness reads stubbed: a
 * loader, then one card per part the reader may read - its number drawn
 * large out of what it counts, its twelve weeks one bar a week, its
 * breakdown - or the empty state, the "nothing you can see" state, or an
 * error with a retry.
 */

const WAIT_TIMEOUT: number = 20000;

const OUTCOMES_ROUTE: string = "/ai-activity/outcomes";
const PROVIDERS_ROUTE: string = "/ai-chat/providers";

const CARD_TEST_IDS: Array<string> = [
  "ai-results-card-pages-avoided",
  "ai-results-card-fixes-verified",
  "ai-results-card-root-causes-confirmed",
];

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

function thrown(error: Error): Answer {
  return async (): Promise<HTTPResponse<JSONObject>> => {
    throw error;
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

function outcomesRequests(): Array<JSONObject> {
  return postSpy.mock.calls
    .map((call: Array<unknown>): JSONObject => {
      return (call[0] || {}) as JSONObject;
    })
    .filter((request: JSONObject): boolean => {
      return String(request["url"]).endsWith(OUTCOMES_ROUTE);
    });
}

const PAGE_PATH: string = RouteMap[
  PageMap.SETTINGS_AI_RESULTS
]!.toString().replace(":projectId", PROJECT_ID);

function openPage(): void {
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
}

async function findTestId(testId: string): Promise<HTMLElement> {
  return await screen.findByTestId(testId, {}, { timeout: WAIT_TIMEOUT });
}

async function openWith(outcomes: AiOutcomes): Promise<void> {
  serve(ok(toBody(outcomes)));
  openPage();
  await findTestId("ai-results-window");
}

// The whole card a result card's body is in: its header and its body.
function cardRoot(testId: string): HTMLElement {
  let element: HTMLElement | null = screen.getByTestId(testId);

  while (element && !element.querySelector('[data-testid="card-header"]')) {
    element = element.parentElement;
  }

  if (!element) {
    throw new Error(`No card around ${testId}.`);
  }

  return element;
}

function cardTitles(): Array<string> {
  return screen
    .getAllByTestId("card-header-title-block")
    .map((block: HTMLElement): string => {
      return block.querySelector("h2")?.textContent?.trim() || "";
    });
}

function textOf(element: HTMLElement): string {
  return (element.textContent || "").replace(/\s+/g, " ").trim();
}

function barsIn(testId: string): Array<[string, number, number]> {
  return within(screen.getByTestId(testId))
    .getAllByTestId("ai-results-week")
    .map((bar: HTMLElement): [string, number, number] => {
      return [
        bar.getAttribute("data-week-start") || "",
        Number(bar.getAttribute("data-value")),
        Number(bar.getAttribute("data-total")),
      ];
    });
}

function zip(
  values: Array<number>,
  totals: Array<number>,
): Array<[string, number, number]> {
  return AI_RESULTS_WEEK_STARTS.map(
    (weekStart: string, index: number): [string, number, number] => {
      return [weekStart, values[index]!, totals[index]!];
    },
  );
}

function legendCountsIn(element: HTMLElement): Array<string> {
  return within(element)
    .queryAllByTestId("stacked-progress-bar-count")
    .map(textOf);
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

      if (url.endsWith(OUTCOMES_ROUTE)) {
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

describe("loading the outcomes", () => {
  test("a loader while the outcomes are on their way, then the cards", async () => {
    const pending: ReturnType<typeof deferred> = deferred();
    serve(pending.answer);
    openPage();

    expect(await findTestId("ai-results-loading")).toBeInTheDocument();
    expect(screen.queryByTestId(CARD_TEST_IDS[0]!)).not.toBeInTheDocument();

    await act(async () => {
      pending.release(toBody(makeOutcomes()));
    });

    expect(await findTestId(CARD_TEST_IDS[0]!)).toBeInTheDocument();
    expect(screen.queryByTestId("ai-results-loading")).not.toBeInTheDocument();
  });

  test("asks the project's outcomes once: POST /ai-activity/outcomes, with the project's headers and nothing else", async () => {
    await openWith(makeOutcomes());

    const requests: Array<JSONObject> = outcomesRequests();

    expect(requests).toHaveLength(1);
    expect(String(requests[0]!["url"])).toBe(
      `${APP_API_URL.toString()}${OUTCOMES_ROUTE}`,
    );
    expect(requests[0]!["data"]).toEqual({});
    expect(requests[0]!["headers"]).toEqual({ tenantid: PROJECT_ID });
  });

  test("an error says what went wrong, and its button asks again", async () => {
    serve(
      httpError(500, "The database is asleep."),
      ok(toBody(makeOutcomes())),
    );
    openPage();

    const error: HTMLElement = await findTestId("ai-results-error");

    expect(error).toHaveTextContent("The database is asleep.");
    expect(screen.queryByTestId(CARD_TEST_IDS[0]!)).not.toBeInTheDocument();
    expect(outcomesRequests()).toHaveLength(1);

    fireEvent.click(within(error).getByRole("button"));

    expect(await findTestId(CARD_TEST_IDS[0]!)).toBeInTheDocument();
    expect(screen.queryByTestId("ai-results-error")).not.toBeInTheDocument();
    expect(outcomesRequests()).toHaveLength(2);
  });

  test("a retry shows the loader again while it asks", async () => {
    const second: ReturnType<typeof deferred> = deferred();
    serve(httpError(503, "Try later."), second.answer);
    openPage();

    fireEvent.click(
      within(await findTestId("ai-results-error")).getByRole("button"),
    );

    expect(await findTestId("ai-results-loading")).toBeInTheDocument();

    await act(async () => {
      second.release(toBody(makeOutcomes()));
    });

    expect(await findTestId(CARD_TEST_IDS[2]!)).toBeInTheDocument();
  });

  test("a request that never reached the server says so", async () => {
    serve(thrown(new Error("Network Error")));
    openPage();

    const error: HTMLElement = await findTestId("ai-results-error");

    expect(textOf(error).length).toBeGreaterThan(0);
    expect(screen.queryByTestId("ai-results-window")).not.toBeInTheDocument();
  });

  test("an answer the page cannot read is an error, not an empty page", async () => {
    serve(ok({ ...toBody(makeOutcomes()), weeks: "twelve" }));
    openPage();

    const error: HTMLElement = await findTestId("ai-results-error");

    expect(error).toHaveTextContent(AI_RESULTS_UNREADABLE_RESPONSE);
    expect(screen.queryByTestId("ai-results-empty")).not.toBeInTheDocument();
    // The general error, for when nothing better is known, is a sentence too.
    expect(AI_RESULTS_LOAD_ERROR).toBe("Could not load AI results.");
  });
});

describe("the cards", () => {
  test("one per question, in the page's order, each titled", async () => {
    await openWith(makeOutcomes());

    for (const testId of CARD_TEST_IDS) {
      expect(screen.getByTestId(testId)).toBeInTheDocument();
    }
    expect(cardTitles()).toEqual([
      "Pages Avoided",
      "Fixes Verified",
      "Root Causes Confirmed",
    ]);
    // Each card's own description is under its title.
    expect(cardRoot(CARD_TEST_IDS[0]!)).toHaveTextContent(
      "Pages held while OneUptime AI worked on the incident or alert, over the last 12 weeks, and how each one ended.",
    );
  });

  test("each says its number large, out of what it counts", async () => {
    await openWith(makeOutcomes());

    const values: Array<string> = screen
      .getAllByTestId("ai-results-value")
      .map(textOf);

    expect(values).toEqual(["17", "11", "11"]);
    expect(screen.getAllByTestId("ai-results-headline").map(textOf)).toEqual([
      "17 of 35 held pages ended with OneUptime AI's fix, before anyone was paged.",
      "11 of 16 checked fixes worked.",
      "11 of 16 judged investigations found the right root cause.",
    ]);
  });

  test("a count of one reads as one", async () => {
    await openWith(
      makeOutcomes({
        pages: {
          resolvedByAi: 1,
          recoveredOnItsOwn: 0,
          handledByPerson: 0,
          handedOff: 0,
          holdTimeRanOut: 0,
          pageNowPressed: 0,
          holding: 0,
        },
      }),
    );

    expect(
      textOf(
        within(screen.getByTestId(CARD_TEST_IDS[0]!)).getByTestId(
          "ai-results-headline",
        ),
      ),
    ).toBe(
      "1 of 1 held page ended with OneUptime AI's fix, before anyone was paged.",
    );
  });

  test("each draws its twelve weeks, one bar a week, with what went well and what it is out of", async () => {
    await openWith(makeOutcomes());

    expect(barsIn(CARD_TEST_IDS[0]!)).toEqual(
      zip(PAGES_AVOIDED_BY_WEEK, PAGES_HELD_BY_WEEK),
    );
    expect(barsIn(CARD_TEST_IDS[1]!)).toEqual(
      zip(FIXES_VERIFIED_BY_WEEK, FIXES_CHECKED_BY_WEEK),
    );
    expect(barsIn(CARD_TEST_IDS[2]!)).toEqual(
      zip(ROOT_CAUSES_CONFIRMED_BY_WEEK, ROOT_CAUSES_JUDGED_BY_WEEK),
    );
  });

  test("a bar says its week and its counts on hover, and its height is its share of the busiest week", async () => {
    await openWith(makeOutcomes());

    const bars: Array<HTMLElement> = within(
      screen.getByTestId(CARD_TEST_IDS[0]!),
    ).getAllByTestId("ai-results-week");

    expect(bars[10]).toHaveAttribute(
      "title",
      "Week of 31 Oct: 4 of 6 held pages ended with OneUptime AI's fix",
    );
    expect(bars[3]).toHaveAttribute("title", "Week of 12 Sep: no held pages");

    // The busiest week (6 held) is the full height; its green part is 4 of 6.
    const busiest: HTMLElement = bars[10]!.firstElementChild as HTMLElement;
    expect(busiest.style.height).toBe("100%");
    expect((busiest.firstElementChild as HTMLElement).style.height).toBe(
      `${(4 / 6) * 100}%`,
    );
    // A week of 3 is half as tall.
    expect((bars[11]!.firstElementChild as HTMLElement).style.height).toBe(
      "50%",
    );
    // A week with nothing held is a line, not a bar.
    expect(bars[3]!.firstElementChild).toHaveClass("h-px");
  });

  test("under the bars, the first and last week, and the last four weeks against the four before", async () => {
    await openWith(makeOutcomes());

    const pages: HTMLElement = screen.getByTestId(CARD_TEST_IDS[0]!);

    expect(textOf(within(pages).getByTestId("ai-results-weeks-ends"))).toBe(
      "22 Aug07 Nov",
    );
    expect(textOf(within(pages).getByTestId("ai-results-recent-weeks"))).toBe(
      "Last 4 weeks: 10 of 15. The 4 weeks before: 6 of 14.",
    );
    // The bars, as one picture, are told to a screen reader by that line.
    expect(within(pages).getByRole("img")).toHaveAttribute(
      "aria-label",
      "Last 4 weeks: 10 of 15. The 4 weeks before: 6 of 14.",
    );
    expect(
      screen.getAllByTestId("ai-results-recent-weeks").map(textOf),
    ).toEqual([
      "Last 4 weeks: 10 of 15. The 4 weeks before: 6 of 14.",
      "Last 4 weeks: 5 of 6. The 4 weeks before: 4 of 6.",
      "Last 4 weeks: 6 of 8. The 4 weeks before: 3 of 4.",
    ]);
  });

  test("under the bars, a legend names the green part and the whole bar, in the colours they are drawn in", async () => {
    await openWith(makeOutcomes());

    const legends: Array<HTMLElement> = screen.getAllByTestId(
      "ai-results-weeks-legend",
    );

    expect(
      legends.map((legend: HTMLElement): Array<string> => {
        return within(legend).getAllByRole("listitem").map(textOf);
      }),
    ).toEqual([
      ["Resolved by OneUptime AI", "All held pages"],
      ["Fixes that worked", "All checked fixes"],
      ["Found the root cause", "All judged investigations"],
    ]);

    for (const legend of legends) {
      const swatches: Array<Element> = Array.from(
        legend.querySelectorAll("li > span"),
      );

      // The bar's own colours: its green part, on its grey track.
      expect(swatches).toHaveLength(2);
      expect(swatches[0]).toHaveClass("bg-emerald-500");
      expect(swatches[1]).toHaveClass("bg-gray-200");
      // The words say it; a swatch is not read out on its own.
      for (const swatch of swatches) {
        expect(swatch).toHaveAttribute("aria-hidden", "true");
      }
    }

    // The same colours as each week's bar draws.
    const bar: HTMLElement = screen.getAllByTestId("ai-results-week")[0]!;
    expect(bar.firstElementChild).toHaveClass("bg-gray-200");
    expect(bar.firstElementChild!.firstElementChild).toHaveClass(
      "bg-emerald-500",
    );
  });

  test("a card without results draws no bars and so no legend", async () => {
    await openWith(
      makeEmptyOutcomes({
        rootCauses: {
          confirmed: 0,
          partial: 0,
          wrong: 0,
          judgedByPeople: 0,
          completed: 2,
        },
      }),
    );

    expect(
      screen.getByTestId("ai-results-card-root-causes-confirmed"),
    ).toBeInTheDocument();
    expect(screen.queryAllByTestId("ai-results-weeks")).toEqual([]);
    expect(screen.queryAllByTestId("ai-results-weeks-legend")).toEqual([]);
  });

  test("Pages Avoided breaks down how every held page ended, and says how many are still held", async () => {
    await openWith(makeOutcomes());

    const pages: HTMLElement = screen.getByTestId(CARD_TEST_IDS[0]!);
    const breakdowns: Array<HTMLElement> = within(pages).getAllByTestId(
      "ai-results-breakdown",
    );

    expect(breakdowns).toHaveLength(1);
    expect(legendCountsIn(breakdowns[0]!)).toEqual([
      "(17)",
      "(5)",
      "(4)",
      "(6)",
      "(2)",
      "(1)",
    ]);
    expect(breakdowns[0]).toHaveTextContent("Resolved by OneUptime AI");
    expect(breakdowns[0]).toHaveTextContent("Paged: the hold time ran out");
    expect(within(pages).getAllByTestId("ai-results-fact").map(textOf)).toEqual(
      ["Still held2"],
    );
  });

  test("Fixes Verified has a titled bar for each kind of fix", async () => {
    await openWith(makeOutcomes());

    const fixes: HTMLElement = screen.getByTestId(CARD_TEST_IDS[1]!);
    const breakdowns: Array<HTMLElement> = within(fixes).getAllByTestId(
      "ai-results-breakdown",
    );

    expect(breakdowns).toHaveLength(2);
    expect(breakdowns[0]).toHaveTextContent("Fixes OneUptime AI ran");
    expect(legendCountsIn(breakdowns[0]!)).toEqual([
      "(7)",
      "(3)",
      "(1)",
      "(2)",
    ]);
    expect(breakdowns[1]).toHaveTextContent("Fix pull requests");
    expect(legendCountsIn(breakdowns[1]!)).toEqual([
      "(4)",
      "(2)",
      "(1)",
      "(1)",
      "(1)",
    ]);
    expect(within(fixes).queryByTestId("ai-results-facts")).toBeNull();
  });

  test("Root Causes Confirmed breaks the judged down, and says how they were judged", async () => {
    await openWith(makeOutcomes());

    const rootCauses: HTMLElement = screen.getByTestId(CARD_TEST_IDS[2]!);

    expect(
      legendCountsIn(within(rootCauses).getByTestId("ai-results-breakdown")),
    ).toEqual(["(11)", "(2)", "(3)"]);
    expect(
      within(rootCauses).getAllByTestId("ai-results-fact").map(textOf),
    ).toEqual([
      "Judged by a responder6",
      "Graded against the incident's root cause10",
      "Not judged yet4",
    ]);
  });

  test("a legend leaves out what came to nothing", async () => {
    await openWith(
      makeOutcomes({
        remediationFixes: { verified: 2, failed: 0, pending: 0, skipped: 0 },
        pullRequestFixes: null,
      }),
    );

    const fixes: HTMLElement = screen.getByTestId(CARD_TEST_IDS[1]!);

    expect(legendCountsIn(fixes)).toEqual(["(2)"]);
    // One kind: its bar is the card's own, untitled.
    expect(fixes).not.toHaveTextContent("Fixes OneUptime AI ran");
  });

  test("under the cards, the twelve weeks they count", async () => {
    await openWith(makeOutcomes());

    expect(textOf(screen.getByTestId("ai-results-window"))).toBe(
      "Counted from 22 Aug to today. Each week counts the work OneUptime AI started that week, however long its check took.",
    );
  });

  test("a partial count says so above the cards; a whole one says nothing", async () => {
    await openWith(makeOutcomes({ isPartial: true }));

    const note: HTMLElement = screen.getByTestId("ai-results-partial");

    expect(note).toHaveTextContent(
      "There was more than this page counts: each number counts the newest 5,000 of its kind.",
    );
    expect(
      note.compareDocumentPosition(screen.getByTestId(CARD_TEST_IDS[0]!)) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    cleanup();
    await openWith(makeOutcomes());

    expect(screen.queryByTestId("ai-results-partial")).not.toBeInTheDocument();
  });
});

describe("only the parts the reader may read", () => {
  test.each([
    ["on-call pages", { pages: null }, [CARD_TEST_IDS[1], CARD_TEST_IDS[2]]],
    [
      "either kind of fix",
      { remediationFixes: null, pullRequestFixes: null },
      [CARD_TEST_IDS[0], CARD_TEST_IDS[2]],
    ],
    [
      "incidents or alerts",
      { remediationFixes: null, rootCauses: null },
      [CARD_TEST_IDS[0], CARD_TEST_IDS[1]],
    ],
  ] as Array<[string, Partial<AiOutcomes>, Array<string>]>)(
    "a reader who may not read %s sees the other cards only",
    async (
      _name: string,
      overrides: Partial<AiOutcomes>,
      shown: Array<string>,
    ) => {
      await openWith(makeOutcomes(overrides));

      for (const testId of CARD_TEST_IDS) {
        expect({
          testId,
          shown: screen.queryByTestId(testId) !== null,
        }).toEqual({ testId, shown: shown.includes(testId) });
      }
    },
  );

  test("a reader who may read none of it is told so, and who can change that", async () => {
    serve(
      ok(
        toBody(
          makeOutcomes({
            pages: null,
            remediationFixes: null,
            pullRequestFixes: null,
            rootCauses: null,
          }),
        ),
      ),
    );
    openPage();

    const notReadable: HTMLElement = await findTestId(
      "ai-results-not-readable",
    );

    expect(notReadable).toHaveTextContent(AI_RESULTS_NOT_READABLE_TITLE);
    expect(notReadable).toHaveTextContent(AI_RESULTS_NOT_READABLE_DESCRIPTION);
    expect(screen.queryByTestId("ai-results-empty")).not.toBeInTheDocument();
    for (const testId of CARD_TEST_IDS) {
      expect(screen.queryByTestId(testId)).not.toBeInTheDocument();
    }
  });
});

describe("before there is anything to count", () => {
  test("with nothing held, run or finished: the empty state says what will show up here", async () => {
    serve(ok(toBody(makeEmptyOutcomes())));
    openPage();

    const empty: HTMLElement = await findTestId("ai-results-empty");

    expect(empty).toHaveTextContent(AI_RESULTS_EMPTY_TITLE);
    expect(empty).toHaveTextContent(AI_RESULTS_EMPTY_DESCRIPTION);
    expect(screen.queryByTestId("ai-results-window")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("ai-results-not-readable"),
    ).not.toBeInTheDocument();
  });

  test("a card with nothing finished yet says how it starts, without a number or bars", async () => {
    await openWith(
      makeEmptyOutcomes({
        pages: {
          resolvedByAi: 0,
          recoveredOnItsOwn: 0,
          handledByPerson: 0,
          handedOff: 0,
          holdTimeRanOut: 0,
          pageNowPressed: 0,
          holding: 3,
        },
      }),
    );

    const pages: HTMLElement = screen.getByTestId(CARD_TEST_IDS[0]!);

    expect(textOf(within(pages).getByTestId("ai-results-start"))).toBe(
      "3 pages are held right now while OneUptime AI works on them. How they end will show up here.",
    );
    expect(within(pages).queryByTestId("ai-results-value")).toBeNull();
    expect(within(pages).queryByTestId("ai-results-weeks")).toBeNull();
    expect(within(pages).queryByTestId("ai-results-breakdown")).toBeNull();
    // The other cards are there too, each with its own start, a sentence a line.
    expect(
      Array.from(
        within(screen.getByTestId(CARD_TEST_IDS[2]!))
          .getByTestId("ai-results-start")
          .querySelectorAll("p"),
      ).map(textOf),
    ).toEqual([
      "No judged investigations yet.",
      "An investigation is judged when a responder confirms or rejects it on its AI card, or when someone writes the root cause as they resolve its incident.",
    ]);
  });

  test("a card with results beside one without: each draws its own way", async () => {
    await openWith(
      makeOutcomes({
        rootCauses: {
          confirmed: 0,
          partial: 0,
          wrong: 0,
          judgedByPeople: 0,
          completed: 4,
        },
      }),
    );

    expect(screen.getAllByTestId("ai-results-value")).toHaveLength(2);
    expect(screen.getAllByTestId("ai-results-weeks")).toHaveLength(2);
    expect(
      textOf(
        within(screen.getByTestId(CARD_TEST_IDS[2]!)).getByTestId(
          "ai-results-start",
        ),
      ),
    ).toContain(
      "OneUptime AI finished 4 investigations, and none has been judged yet.",
    );
  });
});

describe("with AI off for the project", () => {
  test("a notice says so above the results, which are still shown", async () => {
    isAiOn = false;
    jest
      .spyOn(PermissionUtil, "getAllPermissions")
      .mockReturnValue([Permission.ProjectMember]);
    serve(ok(toBody(makeOutcomes())));
    openPage();

    const notice: HTMLElement = await findTestId(PROJECT_AI_OFF_NOTICE_TEST_ID);
    const firstCard: HTMLElement = await findTestId(CARD_TEST_IDS[0]!);

    expect(notice).toHaveTextContent("OneUptime AI is off for this project");
    expect(
      notice.compareDocumentPosition(firstCard) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  test("with AI on, no notice", async () => {
    await openWith(makeOutcomes());

    expect(
      screen.queryByTestId(PROJECT_AI_OFF_NOTICE_TEST_ID),
    ).not.toBeInTheDocument();
  });
});
