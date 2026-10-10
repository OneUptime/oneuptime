import { describe, expect, test } from "@jest/globals";
import {
  LLM_CONVERSATION_DEFAULT_RANGE,
  LLM_CONVERSATION_LIST_URL_PARAMS,
  LlmConversationListView,
  getDefaultLlmConversationListView,
  isLlmConversationListFiltered,
  readLlmConversationListView,
  toLlmConversationListUrlParams,
} from "../../../../App/FeatureSet/Dashboard/src/Components/LlmConversations/LlmConversationListUrlState";
import TimeRange from "../../../Types/Time/TimeRange";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import Dictionary from "../../../Types/Dictionary";
import {
  LLM_CONVERSATION_MAX_FILTER_LENGTH,
  LlmConversationSort,
} from "../../../Types/Telemetry/LlmConversationApi";
import { LlmAnswerIssue } from "../../../Types/Telemetry/LlmAnswerIssue";

/*
 * The conversation list keeps its view in the URL: open a conversation, come
 * back, and the same list is there - same range, search, app, chip, sort and
 * page; share the link and a teammate sees it too. The query string is
 * untrusted input, so every part of it that cannot be read falls back to its
 * default instead of failing the page.
 */

const APP_ID: string = "6f1e2d3c-4b5a-4968-8776-655443322110";

function reader(params: Dictionary<string>): (name: string) => string | null {
  return (name: string): string | null => {
    return name in params ? (params[name] as string) : null;
  };
}

function read(params: Dictionary<string>): LlmConversationListView {
  return readLlmConversationListView(reader(params));
}

// What a written view reads back as, through a real URLSearchParams.
function roundTrip(view: LlmConversationListView): LlmConversationListView {
  const params: Dictionary<string | null> = toLlmConversationListUrlParams(view);
  const search: URLSearchParams = new URLSearchParams();

  for (const [name, value] of Object.entries(params)) {
    if (value !== null) {
      search.set(name, value);
    }
  }

  return readLlmConversationListView((name: string): string | null => {
    return new URLSearchParams(search.toString()).get(name);
  });
}

describe("the default view", () => {
  test("the past week, newest first, nothing narrowing it, first page", () => {
    expect(getDefaultLlmConversationListView()).toEqual({
      range: { range: TimeRange.PAST_ONE_WEEK },
      search: "",
      serviceId: "",
      issue: undefined,
      sort: LlmConversationSort.Newest,
      page: 0,
    });
    expect(LLM_CONVERSATION_DEFAULT_RANGE).toBe(TimeRange.PAST_ONE_WEEK);
  });

  test("an empty query string reads as the default view", () => {
    expect(read({})).toEqual(getDefaultLlmConversationListView());
  });

  test("the default view writes nothing into the URL", () => {
    const params: Dictionary<string | null> = toLlmConversationListUrlParams(
      getDefaultLlmConversationListView(),
    );

    expect(Object.keys(params).sort()).toEqual(
      [...LLM_CONVERSATION_LIST_URL_PARAMS].sort(),
    );

    for (const value of Object.values(params)) {
      expect(value).toBeNull();
    }
  });
});

describe("reading the time range", () => {
  test("a named range is kept", () => {
    expect(read({ range: TimeRange.PAST_ONE_DAY }).range).toEqual({
      range: TimeRange.PAST_ONE_DAY,
    });
    expect(read({ range: TimeRange.PAST_ONE_MONTH }).range).toEqual({
      range: TimeRange.PAST_ONE_MONTH,
    });
  });

  test("a range the Dashboard does not know reads as the past week", () => {
    expect(read({ range: "PAST_TEN_YEARS" }).range).toEqual({
      range: TimeRange.PAST_ONE_WEEK,
    });
    expect(read({ range: "" }).range).toEqual({ range: TimeRange.PAST_ONE_WEEK });
  });

  test("a custom range reads its start and end", () => {
    const view: LlmConversationListView = read({
      range: TimeRange.CUSTOM,
      start: "2026-10-01T00:00:00.000Z",
      end: "2026-10-02T12:00:00.000Z",
    });

    expect(view.range.range).toBe(TimeRange.CUSTOM);
    expect(view.range.startAndEndDate).toBeInstanceOf(InBetween);
    expect(view.range.startAndEndDate?.startValue.toISOString()).toBe(
      "2026-10-01T00:00:00.000Z",
    );
    expect(view.range.startAndEndDate?.endValue.toISOString()).toBe(
      "2026-10-02T12:00:00.000Z",
    );
  });

  test.each([
    [{ start: "2026-10-02T00:00:00.000Z", end: "2026-10-01T00:00:00.000Z" }],
    [{ start: "2026-10-01T00:00:00.000Z", end: "2026-10-01T00:00:00.000Z" }],
    [{ start: "yesterday", end: "2026-10-01T00:00:00.000Z" }],
    [{ start: "2026-10-01T00:00:00.000Z" }],
    [{}],
  ])(
    "a custom range that cannot be a range reads as the past week: %p",
    (dates: Dictionary<string>) => {
      expect(read({ range: TimeRange.CUSTOM, ...dates }).range).toEqual({
        range: TimeRange.PAST_ONE_WEEK,
      });
    },
  );
});

describe("reading the filters", () => {
  test("the search is trimmed and cut to the server's limit", () => {
    expect(read({ q: "  refund policy  " }).search).toBe("refund policy");
    expect(read({ q: "x".repeat(500) }).search).toHaveLength(
      LLM_CONVERSATION_MAX_FILTER_LENGTH,
    );
    expect(read({ q: "   " }).search).toBe("");
  });

  test("the app is kept only when it is an id", () => {
    expect(read({ app: APP_ID }).serviceId).toBe(APP_ID);
    expect(read({ app: "checkout" }).serviceId).toBe("");
    expect(read({ app: "' OR 1=1 --" }).serviceId).toBe("");
  });

  test("the issue chip: every problem, one problem, or none", () => {
    expect(read({ issue: "any" }).issue).toBe("any");

    for (const issue of Object.values(LlmAnswerIssue)) {
      expect(read({ issue: issue }).issue).toBe(issue);
    }

    expect(read({ issue: "slow" }).issue).toBeUndefined();
    expect(read({ issue: "" }).issue).toBeUndefined();
  });

  test("the sort is one the list knows, else newest first", () => {
    for (const sort of Object.values(LlmConversationSort)) {
      expect(read({ sort: sort }).sort).toBe(sort);
    }

    expect(read({ sort: "cheapest" }).sort).toBe(LlmConversationSort.Newest);
  });

  test.each([
    ["3", 3],
    ["9999", 9999],
    ["0", 0],
    ["-1", 0],
    ["1.5", 0],
    ["10000", 0],
    ["abc", 0],
    ["", 0],
  ])("?page=%p reads as page %p", (value: string, expected: number) => {
    expect(read({ page: value }).page).toBe(expected);
  });
});

describe("writing the view into the URL", () => {
  test("every part that is not the default is written", () => {
    const params: Dictionary<string | null> = toLlmConversationListUrlParams({
      range: { range: TimeRange.PAST_ONE_DAY },
      search: "  refund ",
      serviceId: APP_ID,
      issue: LlmAnswerIssue.Refused,
      sort: LlmConversationSort.MostExpensive,
      page: 2,
    });

    expect(params).toEqual({
      range: TimeRange.PAST_ONE_DAY,
      start: null,
      end: null,
      q: "refund",
      app: APP_ID,
      issue: LlmAnswerIssue.Refused,
      sort: LlmConversationSort.MostExpensive,
      page: "2",
    });
  });

  test("a custom range writes its start and end", () => {
    const params: Dictionary<string | null> = toLlmConversationListUrlParams({
      ...getDefaultLlmConversationListView(),
      range: {
        range: TimeRange.CUSTOM,
        startAndEndDate: new InBetween<Date>(
          new Date("2026-10-01T00:00:00.000Z"),
          new Date("2026-10-03T00:00:00.000Z"),
        ),
      },
    });

    expect(params["range"]).toBe(TimeRange.CUSTOM);
    expect(params["start"]).toBe("2026-10-01T00:00:00.000Z");
    expect(params["end"]).toBe("2026-10-03T00:00:00.000Z");
  });

  test.each<[string, LlmConversationListView]>([
    ["the default", getDefaultLlmConversationListView()],
    [
      "everything set",
      {
        range: { range: TimeRange.PAST_ONE_MONTH },
        search: "why was my order cancelled?",
        serviceId: APP_ID,
        issue: "any",
        sort: LlmConversationSort.Slowest,
        page: 4,
      },
    ],
    [
      "a custom range on a later page",
      {
        range: {
          range: TimeRange.CUSTOM,
          startAndEndDate: new InBetween<Date>(
            new Date("2026-09-30T08:00:00.000Z"),
            new Date("2026-09-30T09:30:00.000Z"),
          ),
        },
        search: "",
        serviceId: "",
        issue: LlmAnswerIssue.Flagged,
        sort: LlmConversationSort.Oldest,
        page: 1,
      },
    ],
    [
      "a search with characters the URL must escape",
      {
        ...getDefaultLlmConversationListView(),
        search: "a&b=c?#100% \"quoted\" ünïcødé",
      },
    ],
  ])("%s reads back as the same view", (_name: string, view: LlmConversationListView) => {
    const back: LlmConversationListView = roundTrip(view);

    expect(back.range.range).toBe(view.range.range);
    expect(back.range.startAndEndDate?.startValue.toISOString()).toBe(
      view.range.startAndEndDate?.startValue.toISOString(),
    );
    expect(back.range.startAndEndDate?.endValue.toISOString()).toBe(
      view.range.startAndEndDate?.endValue.toISOString(),
    );
    expect({ ...back, range: null }).toEqual({ ...view, range: null });
  });
});

describe("isLlmConversationListFiltered", () => {
  test("the time range and the sort do not narrow the list", () => {
    expect(isLlmConversationListFiltered(getDefaultLlmConversationListView())).toBe(false);
    expect(
      isLlmConversationListFiltered({
        ...getDefaultLlmConversationListView(),
        range: { range: TimeRange.PAST_ONE_DAY },
        sort: LlmConversationSort.MostCalls,
        page: 3,
      }),
    ).toBe(false);
  });

  test("a search, an app or a chip does", () => {
    const view: LlmConversationListView = getDefaultLlmConversationListView();

    expect(isLlmConversationListFiltered({ ...view, search: "refund" })).toBe(true);
    expect(isLlmConversationListFiltered({ ...view, search: "   " })).toBe(false);
    expect(isLlmConversationListFiltered({ ...view, serviceId: APP_ID })).toBe(true);
    expect(isLlmConversationListFiltered({ ...view, issue: "any" })).toBe(true);
    expect(
      isLlmConversationListFiltered({ ...view, issue: LlmAnswerIssue.Empty }),
    ).toBe(true);
  });
});
