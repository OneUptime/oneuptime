import { describe, expect, test } from "@jest/globals";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import { JSONObject } from "Common/Types/JSON";
import JSONFunctions from "Common/Types/JSONFunctions";
import TelemetrySavedViewState from "Common/Types/Telemetry/TelemetrySavedViewState";
import RangeStartAndEndDateTime from "Common/Types/Time/RangeStartAndEndDateTime";
import TimeRange from "Common/Types/Time/TimeRange";
import { serializeSavedViewTimeRange } from "Common/Utils/Telemetry/SavedViewTimeRange";
import { generatedTexts } from "Common/Tests/Helpers/GeneratedTexts";
import { SeededRandom, seededRandom } from "Common/Tests/Helpers/SeededRandom";
import {
  DEFAULT_EXCEPTION_LIST_SORT,
  ExceptionListSort,
} from "../../FeatureSet/Dashboard/src/Utils/ExceptionAssignment";
import {
  ExceptionsListViewDefaults,
  ExceptionsListViewState,
  ExceptionsSavedViewClassScope,
  ExceptionsSavedViewStatus,
  buildExceptionsUrlScopeOverrides,
  captureExceptionsSavedViewState,
  readExceptionsSavedViewState,
} from "../../FeatureSet/Dashboard/src/Utils/ExceptionSavedView";

/*
 * The exceptions list's saved views (Utils/ExceptionSavedView): what Save
 * keeps of the list, what applying a view gives it back - its own defaults
 * for whatever the view leaves out, so Clear view (the empty state) opens
 * it as it opens for anyone - and what a link naming a view lays over it.
 */

const DEFAULTS: ExceptionsListViewDefaults = {
  timeRange: { range: TimeRange.PAST_ONE_DAY },
  pageSize: 25,
  status: "unresolved",
  classScope: "issues",
};

const CHECKOUT_VIEW: ExceptionsListViewState = {
  search: "type:TypeError",
  filters: [
    ["resource.service.name", "checkout"],
    ["attributes.deployment.environment", "production"],
  ],
  timeRange: { range: TimeRange.PAST_ONE_WEEK },
  pageSize: 50,
  status: "resolved",
  classScope: "all",
  assignedToMe: true,
  sort: ExceptionListSort.MostEvents,
};

/*
 * Save and apply the way the Dashboard does: the browser serializes the
 * view onto the wire, the JSON column keeps it, and it comes back through
 * the same serializer (SavedViewJSONColumnTuples.test).
 */
function throughStorage(
  saved: TelemetrySavedViewState,
): TelemetrySavedViewState {
  return JSONFunctions.deserialize(
    JSON.parse(JSON.stringify(JSONFunctions.serialize(saved as JSONObject))),
  ) as TelemetrySavedViewState;
}

// Two windows are the same selection when they serialize the same.
function comparable(state: ExceptionsListViewState): Record<string, unknown> {
  return {
    ...state,
    timeRange: serializeSavedViewTimeRange(state.timeRange),
  };
}

describe("saving the list and applying the view", () => {
  test("a saved view gives the list back everything it kept", () => {
    const applied: ExceptionsListViewState = readExceptionsSavedViewState(
      throughStorage(captureExceptionsSavedViewState(CHECKOUT_VIEW)),
      DEFAULTS,
    );

    expect(comparable(applied)).toEqual(comparable(CHECKOUT_VIEW));
  });

  test("it keeps the status, what counts as an issue, Assigned to me and the order", () => {
    expect(captureExceptionsSavedViewState(CHECKOUT_VIEW)).toEqual({
      search: "type:TypeError",
      filters: [
        ["resource.service.name", "checkout"],
        ["attributes.deployment.environment", "production"],
      ],
      timeRange: { range: TimeRange.PAST_ONE_WEEK },
      pageSize: 50,
      exceptionStatus: "resolved",
      exceptionClassScope: "all",
      exceptionAssignedToMe: true,
      exceptionSort: "most-events",
    });
  });

  test("a rolling window stays rolling, and a custom one keeps its dates", () => {
    const start: Date = new Date("2026-10-01T08:00:00.000Z");
    const end: Date = new Date("2026-10-02T08:00:00.000Z");
    const custom: RangeStartAndEndDateTime = {
      range: TimeRange.CUSTOM,
      startAndEndDate: new InBetween<Date>(start, end),
    };

    const rolling: TelemetrySavedViewState = captureExceptionsSavedViewState({
      ...CHECKOUT_VIEW,
      timeRange: { range: TimeRange.PAST_ONE_HOUR },
    });
    expect(rolling.timeRange).toEqual({ range: TimeRange.PAST_ONE_HOUR });

    const applied: ExceptionsListViewState = readExceptionsSavedViewState(
      throughStorage(
        captureExceptionsSavedViewState({
          ...CHECKOUT_VIEW,
          timeRange: custom,
        }),
      ),
      DEFAULTS,
    );

    expect(applied.timeRange.range).toBe(TimeRange.CUSTOM);
    expect(
      new Date(applied.timeRange.startAndEndDate!.startValue).toISOString(),
    ).toBe(start.toISOString());
    expect(
      new Date(applied.timeRange.startAndEndDate!.endValue).toISOString(),
    ).toBe(end.toISOString());
  });

  test("an empty state - Clear view - is the list as it opens", () => {
    expect(readExceptionsSavedViewState({}, DEFAULTS)).toEqual({
      search: "",
      filters: [],
      timeRange: { range: TimeRange.PAST_ONE_DAY },
      pageSize: 25,
      status: "unresolved",
      classScope: "issues",
      assignedToMe: false,
      sort: DEFAULT_EXCEPTION_LIST_SORT,
    });
    expect(readExceptionsSavedViewState(null, DEFAULTS)).toEqual(
      readExceptionsSavedViewState({}, DEFAULTS),
    );
  });

  test("what it leaves out comes from the page it is applied on", () => {
    // The Resolved address kept from before the one list opens resolved.
    const resolvedPage: ExceptionsListViewDefaults = {
      ...DEFAULTS,
      status: "resolved",
    };

    expect(readExceptionsSavedViewState({}, resolvedPage).status).toBe(
      "resolved",
    );
  });

  test("a view with no window it can use opens the list's past day, not the explorers' hour", () => {
    for (const timeRange of [
      undefined,
      { range: "Past 9 Fortnights" },
      { range: TimeRange.CUSTOM },
      { range: TimeRange.CUSTOM, startValue: "soon", endValue: "later" },
    ]) {
      expect(
        readExceptionsSavedViewState(
          { timeRange: timeRange } as TelemetrySavedViewState,
          DEFAULTS,
        ).timeRange,
      ).toEqual({ range: TimeRange.PAST_ONE_DAY });
    }
  });

  test("a value the list does not know is dropped, never guessed at", () => {
    const applied: ExceptionsListViewState = readExceptionsSavedViewState(
      {
        search: 42,
        pageSize: 12.5,
        exceptionStatus: "deleted",
        exceptionClassScope: "bugs",
        exceptionAssignedToMe: "yes",
        exceptionSort: "random",
      } as unknown as TelemetrySavedViewState,
      DEFAULTS,
    );

    expect(applied).toEqual(readExceptionsSavedViewState({}, DEFAULTS));

    for (const pageSize of [0, -10, "50", Number.NaN]) {
      expect(
        readExceptionsSavedViewState(
          { pageSize } as unknown as TelemetrySavedViewState,
          DEFAULTS,
        ).pageSize,
      ).toBe(25);
    }
  });

  test("filters written before the serializer kept tuples still apply", () => {
    const applied: ExceptionsListViewState = readExceptionsSavedViewState(
      {
        filters: [{ "0": "resource.service.name", "1": "checkout" }],
      } as unknown as TelemetrySavedViewState,
      DEFAULTS,
    );

    expect(applied.filters).toEqual([["resource.service.name", "checkout"]]);
  });

  test("every status, lens and order a view can hold comes back as saved", () => {
    const statuses: Array<ExceptionsSavedViewStatus> = [
      "unresolved",
      "resolved",
      "archived",
      "all",
    ];
    const scopes: Array<ExceptionsSavedViewClassScope> = [
      "issues",
      "user-errors",
      "all",
    ];

    for (const status of statuses) {
      for (const classScope of scopes) {
        for (const sort of Object.values(ExceptionListSort)) {
          for (const assignedToMe of [true, false]) {
            const view: ExceptionsListViewState = {
              ...CHECKOUT_VIEW,
              status,
              classScope,
              sort,
              assignedToMe,
            };

            expect(
              comparable(
                readExceptionsSavedViewState(
                  throughStorage(captureExceptionsSavedViewState(view)),
                  DEFAULTS,
                ),
              ),
            ).toEqual(comparable(view));
          }
        }
      }
    }
  });
});

describe("a link that names a view", () => {
  const NOTHING: Parameters<typeof buildExceptionsUrlScopeOverrides>[0] = {
    search: "",
    filters: [],
    timeRange: { range: TimeRange.PAST_ONE_DAY },
    hasRange: false,
    status: null,
    classScope: null,
    assignedToMe: false,
    sort: DEFAULT_EXCEPTION_LIST_SORT,
  };

  // What the control applies: the view, with the link's fields over it.
  function opened(
    overrides: Partial<TelemetrySavedViewState> | undefined,
  ): ExceptionsListViewState {
    const saved: TelemetrySavedViewState = throughStorage(
      captureExceptionsSavedViewState(CHECKOUT_VIEW),
    );

    return readExceptionsSavedViewState(
      overrides ? { ...saved, ...overrides } : saved,
      DEFAULTS,
    );
  }

  test("and says nothing else opens the view as saved", () => {
    expect(buildExceptionsUrlScopeOverrides(NOTHING)).toBeUndefined();
    expect(comparable(opened(undefined))).toEqual(comparable(CHECKOUT_VIEW));
  });

  test("lays over the view only what it spelled out", () => {
    const overrides: Partial<TelemetrySavedViewState> | undefined =
      buildExceptionsUrlScopeOverrides({
        ...NOTHING,
        timeRange: { range: TimeRange.PAST_TWO_DAYS },
        hasRange: true,
        status: "archived",
      });

    expect(overrides).toEqual({
      timeRange: { range: TimeRange.PAST_TWO_DAYS },
      exceptionStatus: "archived",
    });

    const view: ExceptionsListViewState = opened(overrides);

    // The link's window and status ...
    expect(view.timeRange).toEqual({ range: TimeRange.PAST_TWO_DAYS });
    expect(view.status).toBe("archived");
    // ... and the view's everything else.
    expect(view.search).toBe(CHECKOUT_VIEW.search);
    expect(view.filters).toEqual(CHECKOUT_VIEW.filters);
    expect(view.classScope).toBe("all");
    expect(view.assignedToMe).toBe(true);
    expect(view.sort).toBe(ExceptionListSort.MostEvents);
    expect(view.pageSize).toBe(50);
  });

  test("a window the link fell back to is not the link's", () => {
    expect(
      buildExceptionsUrlScopeOverrides({
        ...NOTHING,
        timeRange: { range: TimeRange.PAST_ONE_DAY },
        hasRange: false,
      }),
    ).toBeUndefined();
  });

  test("the lens, Assigned to me and the order, each on its own", () => {
    expect(
      buildExceptionsUrlScopeOverrides({ ...NOTHING, classScope: "issues" }),
    ).toEqual({ exceptionClassScope: "issues" });
    expect(
      buildExceptionsUrlScopeOverrides({ ...NOTHING, assignedToMe: true }),
    ).toEqual({ exceptionAssignedToMe: true });
    expect(
      buildExceptionsUrlScopeOverrides({
        ...NOTHING,
        sort: ExceptionListSort.FirstSeen,
      }),
    ).toEqual({ exceptionSort: "first-seen" });
    expect(
      buildExceptionsUrlScopeOverrides({
        ...NOTHING,
        search: "env:staging",
        filters: [["resource.service.name", "billing"]],
      }),
    ).toEqual({
      search: "env:staging",
      filters: [["resource.service.name", "billing"]],
    });
  });

  /*
   * Any link over any view: each field is the link's where it spelled the
   * field out, and the view's where it did not.
   */
  test("a seeded sweep of links over views", () => {
    const random: SeededRandom = seededRandom(20261031);
    const searches: Array<string> = generatedTexts(400, 31, [
      "type:",
      "TypeError",
      " ",
      "env:production",
      '"quoted"',
      "é",
      "日本",
      "-",
    ]);
    const statuses: Array<ExceptionsSavedViewStatus> = [
      "unresolved",
      "resolved",
      "archived",
      "all",
    ];
    const scopes: Array<ExceptionsSavedViewClassScope> = [
      "issues",
      "user-errors",
      "all",
    ];
    const sorts: Array<ExceptionListSort> = Object.values(ExceptionListSort);
    const ranges: Array<TimeRange> = Object.values(TimeRange).filter(
      (range: TimeRange): boolean => {
        return range !== TimeRange.CUSTOM;
      },
    );
    const filterValues: Array<[string, string]> = [
      ["resource.service.name", "checkout"],
      ["resource.service.name", "billing"],
      ["attributes.deployment.environment", "production"],
      ["exceptionType", "TypeError"],
    ];

    function pick<T>(items: ReadonlyArray<T>): T {
      return items[random(items.length)] as T;
    }

    function someFilters(): Array<[string, string]> {
      return filterValues.filter((): boolean => {
        return random(2) === 1;
      });
    }

    for (let index: number = 0; index < searches.length; index++) {
      const view: ExceptionsListViewState = {
        search: pick(searches),
        filters: someFilters(),
        timeRange: { range: pick(ranges) },
        pageSize: pick([10, 25, 50, 100]),
        status: pick(statuses),
        classScope: pick(scopes),
        assignedToMe: random(2) === 1,
        sort: pick(sorts),
      };

      const link: Parameters<typeof buildExceptionsUrlScopeOverrides>[0] = {
        search: random(2) === 1 ? (searches[index] as string) : "",
        filters: someFilters(),
        timeRange: { range: pick(ranges) },
        hasRange: random(2) === 1,
        status: random(2) === 1 ? pick(statuses) : null,
        classScope: random(2) === 1 ? pick(scopes) : null,
        assignedToMe: random(2) === 1,
        sort: pick(sorts),
      };

      const overrides: Partial<TelemetrySavedViewState> | undefined =
        buildExceptionsUrlScopeOverrides(link);
      const saved: TelemetrySavedViewState = throughStorage(
        captureExceptionsSavedViewState(view),
      );
      const opened: ExceptionsListViewState = readExceptionsSavedViewState(
        overrides ? { ...saved, ...overrides } : saved,
        DEFAULTS,
      );

      expect(comparable(opened)).toEqual(
        comparable({
          search: link.search.length > 0 ? link.search : view.search,
          filters: link.filters.length > 0 ? link.filters : view.filters,
          timeRange: link.hasRange ? link.timeRange : view.timeRange,
          pageSize: view.pageSize,
          status: link.status || view.status,
          classScope: link.classScope || view.classScope,
          assignedToMe: link.assignedToMe || view.assignedToMe,
          sort:
            link.sort !== DEFAULT_EXCEPTION_LIST_SORT ? link.sort : view.sort,
        }),
      );
    }
  });
});
