import { describe, expect, test } from "@jest/globals";
import ColumnLength from "../../../Types/Database/ColumnLength";
import {
  DEFAULT_PRODUCT_ANALYTICS_FUNNEL_WINDOW_MS,
  PRODUCT_ANALYTICS_FUNNEL_MAX_STEPS,
  PRODUCT_ANALYTICS_FUNNEL_MIN_STEPS,
  PRODUCT_ANALYTICS_FUNNEL_WINDOWS_MS,
  PRODUCT_ANALYTICS_MAX_SEGMENT_FILTERS,
  PRODUCT_ANALYTICS_MAX_SEGMENT_VALUE_LENGTH,
  ProductAnalyticsEventField,
  ProductAnalyticsEventRef,
  ProductAnalyticsRetentionPeriod,
  ProductAnalyticsSegmentFilter,
} from "../../../Types/Rum/ProductAnalyticsEventReads";
import { ProductAnalyticsEventKind } from "../../../Types/Rum/ProductAnalyticsEvents";
import {
  PRODUCT_ANALYTICS_SAVED_VIEWS_PER_APPLICATION_MAX,
  PRODUCT_ANALYTICS_SAVED_VIEW_NAME_MAX_LENGTH,
  PRODUCT_ANALYTICS_SAVED_VIEW_PROBLEMS,
  PRODUCT_ANALYTICS_SAVED_VIEW_TYPES,
  PRODUCT_ANALYTICS_SAVED_VIEW_URL_KEY,
  ProductAnalyticsDefinitionRead,
  ProductAnalyticsFunnelDefinition,
  ProductAnalyticsRetentionDefinition,
  ProductAnalyticsSavedViewType,
  getProductAnalyticsSavedViewNameProblem,
  isProductAnalyticsSavedViewType,
  isSameProductAnalyticsDefinition,
  readProductAnalyticsFunnelDefinition,
  readProductAnalyticsRetentionDefinition,
  readProductAnalyticsSavedViewDefinition,
  toProductAnalyticsSavedViewName,
} from "../../../Types/Rum/ProductAnalyticsSavedViews";

/*
 * Saved funnels and retention tables (issue #6630): the one shape the
 * server keeps, the pages compare and the widgets read. A definition comes
 * from a request (the API, Terraform, a script) or a stored row, so it is
 * read as untrusted: it is kept only as the product analytics read routes
 * would take it - the same events, windows, periods and segments - with
 * nothing else a caller sent, and the first thing wrong with it is said in
 * the routes' own words.
 */

const HOUR_MS: number = 60 * 60 * 1000;
const DAY_MS: number = 24 * HOUR_MS;

const SIGN_UP: ProductAnalyticsEventRef = {
  kind: ProductAnalyticsEventKind.Custom,
  name: "Signed up",
};
const PURCHASED: ProductAnalyticsEventRef = {
  kind: ProductAnalyticsEventKind.Custom,
  name: "Purchased",
};
const SESSION: ProductAnalyticsEventRef = {
  kind: ProductAnalyticsEventKind.Session,
  name: "",
};
const PRICING: ProductAnalyticsEventRef = {
  kind: ProductAnalyticsEventKind.Page,
  name: "/pricing",
};

const PLAN_FILTER: ProductAnalyticsSegmentFilter = {
  field: ProductAnalyticsEventField.Property,
  key: "plan",
  value: "pro",
};
const COUNTRY_FILTER: ProductAnalyticsSegmentFilter = {
  field: ProductAnalyticsEventField.Country,
  key: "",
  value: "DE",
};

function readFunnel(
  value: unknown,
): ProductAnalyticsDefinitionRead<ProductAnalyticsFunnelDefinition> {
  return readProductAnalyticsFunnelDefinition(value);
}

function readRetention(
  value: unknown,
): ProductAnalyticsDefinitionRead<ProductAnalyticsRetentionDefinition> {
  return readProductAnalyticsRetentionDefinition(value);
}

function funnelProblem(value: unknown): string | null {
  return readFunnel(value).problem;
}

function retentionProblem(value: unknown): string | null {
  return readRetention(value).problem;
}

describe("what a saved view is", () => {
  test("a funnel or a retention table, matched exactly", () => {
    expect([...PRODUCT_ANALYTICS_SAVED_VIEW_TYPES]).toEqual([
      ProductAnalyticsSavedViewType.Funnel,
      ProductAnalyticsSavedViewType.Retention,
    ]);
    expect(ProductAnalyticsSavedViewType.Funnel).toBe("funnel");
    expect(ProductAnalyticsSavedViewType.Retention).toBe("retention");

    expect(isProductAnalyticsSavedViewType("funnel")).toBe(true);
    expect(isProductAnalyticsSavedViewType("retention")).toBe(true);

    for (const notAKind of [
      "Funnel",
      "RETENTION",
      " funnel",
      "funnel ",
      "funnels",
      "",
      null,
      undefined,
      1,
      ["funnel"],
      { viewType: "funnel" },
    ]) {
      expect([notAKind, isProductAnalyticsSavedViewType(notAKind)]).toEqual([
        notAKind,
        false,
      ]);
    }
  });

  test("a page opens one by `?view=`, and an application keeps at most 100 of each kind", () => {
    expect(PRODUCT_ANALYTICS_SAVED_VIEW_URL_KEY).toBe("view");
    expect(PRODUCT_ANALYTICS_SAVED_VIEWS_PER_APPLICATION_MAX).toBe(100);
  });

  test("a name fits the model's short text column", () => {
    expect(PRODUCT_ANALYTICS_SAVED_VIEW_NAME_MAX_LENGTH).toBe(100);
    expect(PRODUCT_ANALYTICS_SAVED_VIEW_NAME_MAX_LENGTH).toBeLessThanOrEqual(
      ColumnLength.ShortText,
    );
  });

  test("the problems name the limits the read routes hold to", () => {
    expect(PRODUCT_ANALYTICS_SAVED_VIEW_PROBLEMS.steps).toBe(
      `A funnel has ${PRODUCT_ANALYTICS_FUNNEL_MIN_STEPS} to ${PRODUCT_ANALYTICS_FUNNEL_MAX_STEPS} steps.`,
    );
    expect(PRODUCT_ANALYTICS_SAVED_VIEW_PROBLEMS.filters).toBe(
      `A segment has at most ${PRODUCT_ANALYTICS_MAX_SEGMENT_FILTERS} filters.`,
    );

    for (const windowMs of PRODUCT_ANALYTICS_FUNNEL_WINDOWS_MS) {
      expect(PRODUCT_ANALYTICS_SAVED_VIEW_PROBLEMS.window).toContain(
        String(windowMs),
      );
    }

    expect(PRODUCT_ANALYTICS_SAVED_VIEW_PROBLEMS.period).toBe(
      "period must be one of day, week, month.",
    );
    expect(PRODUCT_ANALYTICS_SAVED_VIEW_PROBLEMS.viewType).toBe(
      "viewType must be one of funnel, retention.",
    );
    expect(PRODUCT_ANALYTICS_SAVED_VIEW_PROBLEMS.tooMany).toContain(
      "at most 100 saved funnels and 100 saved retention tables",
    );
    expect(PRODUCT_ANALYTICS_SAVED_VIEW_PROBLEMS.nameTooLong).toBe(
      "A name has at most 100 characters.",
    );
  });
});

describe("a saved funnel's definition", () => {
  test("is kept as the page shows it: its steps, its time to finish and its segment", () => {
    const read: ProductAnalyticsDefinitionRead<ProductAnalyticsFunnelDefinition> =
      readFunnel({
        steps: [SESSION, PRICING, SIGN_UP, PURCHASED],
        windowMs: 7 * DAY_MS,
        filters: [PLAN_FILTER, COUNTRY_FILTER],
      });

    expect(read.problem).toBeNull();
    expect(read.definition).toEqual({
      steps: [SESSION, PRICING, SIGN_UP, PURCHASED],
      windowMs: 7 * DAY_MS,
      filters: [PLAN_FILTER, COUNTRY_FILTER],
    });
  });

  test("keeps nothing a caller sent beside its own fields", () => {
    const read: ProductAnalyticsDefinitionRead<ProductAnalyticsFunnelDefinition> =
      readFunnel({
        steps: [
          { ...SIGN_UP, people: 400, sql: "DROP TABLE" },
          { ...PURCHASED, note: "secret" },
        ],
        windowMs: HOUR_MS,
        filters: [{ ...PLAN_FILTER, extra: { nested: true } }],
        startTime: "2026-01-01",
        rumApplicationId: "another application",
      });

    expect(read.problem).toBeNull();
    expect(JSON.stringify(read.definition)).toBe(
      JSON.stringify({
        steps: [SIGN_UP, PURCHASED],
        windowMs: HOUR_MS,
        filters: [PLAN_FILTER],
      }),
    );
    expect(Object.keys(read.definition!)).toEqual([
      "steps",
      "windowMs",
      "filters",
    ]);
  });

  test("takes the page's default time to finish, and no segment, when none is named", () => {
    for (const absent of [{}, { windowMs: null, filters: null }]) {
      expect(
        readFunnel({ steps: [SIGN_UP, PURCHASED], ...absent }).definition,
      ).toEqual({
        steps: [SIGN_UP, PURCHASED],
        windowMs: DEFAULT_PRODUCT_ANALYTICS_FUNNEL_WINDOW_MS,
        filters: [],
      });
    }

    expect(DEFAULT_PRODUCT_ANALYTICS_FUNNEL_WINDOW_MS).toBe(DAY_MS);
  });

  test("has two to six steps", () => {
    const steps: Array<ProductAnalyticsEventRef> = [
      SESSION,
      PRICING,
      SIGN_UP,
      PURCHASED,
      { kind: ProductAnalyticsEventKind.Custom, name: "Invited a teammate" },
      { kind: ProductAnalyticsEventKind.Page, name: "/settings" },
      { kind: ProductAnalyticsEventKind.Custom, name: "Upgraded" },
    ];

    expect(PRODUCT_ANALYTICS_FUNNEL_MIN_STEPS).toBe(2);
    expect(PRODUCT_ANALYTICS_FUNNEL_MAX_STEPS).toBe(6);

    for (let count: number = 0; count <= steps.length; count++) {
      const problem: string | null = funnelProblem({
        steps: steps.slice(0, count),
      });

      expect([count, problem]).toEqual([
        count,
        count >= 2 && count <= 6
          ? null
          : PRODUCT_ANALYTICS_SAVED_VIEW_PROBLEMS.steps,
      ]);
    }

    for (const notSteps of [undefined, null, "session", { 0: SESSION }, 2]) {
      expect(funnelProblem({ steps: notSteps })).toBe(
        PRODUCT_ANALYTICS_SAVED_VIEW_PROBLEMS.steps,
      );
    }
  });

  test("each step is an event the reads count: a kind, and a name for a page or a custom event", () => {
    for (const badStep of [
      null,
      "Signed up",
      ["custom", "Signed up"],
      { kind: "click", name: "Buy" },
      { kind: "Custom", name: "Signed up" },
      { kind: ProductAnalyticsEventKind.Custom },
      { kind: ProductAnalyticsEventKind.Custom, name: "   " },
      { kind: ProductAnalyticsEventKind.Custom, name: 42 },
      { kind: ProductAnalyticsEventKind.Page, name: "" },
      { kind: ProductAnalyticsEventKind.Page },
      { name: "Signed up" },
    ]) {
      expect([badStep, funnelProblem({ steps: [SIGN_UP, badStep] })]).toEqual([
        badStep,
        PRODUCT_ANALYTICS_SAVED_VIEW_PROBLEMS.step,
      ]);
    }
  });

  test("keeps a step as the reads name it: a session start unnamed, a page by its path alone", () => {
    expect(
      readFunnel({
        steps: [
          { kind: ProductAnalyticsEventKind.Session, name: "anything" },
          {
            kind: ProductAnalyticsEventKind.Page,
            name: "https://shop.example.com/checkout?email=alice@example.com#pay",
          },
          { kind: ProductAnalyticsEventKind.Custom, name: "  Purchased  " },
        ],
      }).definition?.steps,
    ).toEqual([
      SESSION,
      { kind: ProductAnalyticsEventKind.Page, name: "/checkout" },
      PURCHASED,
    ]);
  });

  test("finishes in one of the times the page offers", () => {
    for (const windowMs of PRODUCT_ANALYTICS_FUNNEL_WINDOWS_MS) {
      expect(
        readFunnel({ steps: [SIGN_UP, PURCHASED], windowMs: windowMs })
          .definition?.windowMs,
      ).toBe(windowMs);
    }

    for (const badWindow of [
      0,
      -DAY_MS,
      2 * HOUR_MS,
      DAY_MS + 1,
      String(DAY_MS),
      Number.NaN,
      Number.POSITIVE_INFINITY,
      [DAY_MS],
      { ms: DAY_MS },
      true,
    ]) {
      expect([
        badWindow,
        funnelProblem({ steps: [SIGN_UP, PURCHASED], windowMs: badWindow }),
      ]).toEqual([badWindow, PRODUCT_ANALYTICS_SAVED_VIEW_PROBLEMS.window]);
    }
  });

  test("has a segment of at most five filters, each one the reads take", () => {
    const filters: Array<ProductAnalyticsSegmentFilter> = [
      COUNTRY_FILTER,
      PLAN_FILTER,
      { field: ProductAnalyticsEventField.Browser, key: "", value: "Firefox" },
      {
        field: ProductAnalyticsEventField.DeviceType,
        key: "",
        value: "mobile",
      },
      {
        field: ProductAnalyticsEventField.UserProperty,
        key: "role",
        value: "admin",
      },
      { field: ProductAnalyticsEventField.AppVersion, key: "", value: "2.0" },
    ];

    expect(PRODUCT_ANALYTICS_MAX_SEGMENT_FILTERS).toBe(5);
    expect(
      readFunnel({ steps: [SIGN_UP, PURCHASED], filters: filters.slice(0, 5) })
        .definition?.filters,
    ).toEqual(filters.slice(0, 5));
    expect(
      funnelProblem({ steps: [SIGN_UP, PURCHASED], filters: filters }),
    ).toBe(PRODUCT_ANALYTICS_SAVED_VIEW_PROBLEMS.filters);

    for (const notFilters of ["plan=pro", { 0: PLAN_FILTER }, 3]) {
      expect(
        funnelProblem({ steps: [SIGN_UP, PURCHASED], filters: notFilters }),
      ).toBe(PRODUCT_ANALYTICS_SAVED_VIEW_PROBLEMS.filters);
    }

    for (const badFilter of [
      null,
      "plan=pro",
      { field: "plan", key: "", value: "pro" },
      { field: ProductAnalyticsEventField.Property, key: "", value: "pro" },
      { field: ProductAnalyticsEventField.UserProperty, value: "admin" },
      { field: ProductAnalyticsEventField.Country, key: "", value: 7 },
      { field: ProductAnalyticsEventField.Country, key: "" },
    ]) {
      expect([
        badFilter,
        funnelProblem({ steps: [SIGN_UP, PURCHASED], filters: [badFilter] }),
      ]).toEqual([badFilter, PRODUCT_ANALYTICS_SAVED_VIEW_PROBLEMS.filter]);
    }
  });

  test("keeps a filter as the reads do: an unkeyed field's key empty, a value no longer than a trait", () => {
    const read: ProductAnalyticsDefinitionRead<ProductAnalyticsFunnelDefinition> =
      readFunnel({
        steps: [SIGN_UP, PURCHASED],
        filters: [
          {
            field: ProductAnalyticsEventField.Country,
            key: "ignored for a country",
            value: "DE",
          },
          {
            field: ProductAnalyticsEventField.Property,
            key: "  plan  ",
            value: "x".repeat(PRODUCT_ANALYTICS_MAX_SEGMENT_VALUE_LENGTH + 50),
          },
        ],
      });

    expect(read.definition?.filters).toEqual([
      COUNTRY_FILTER,
      {
        field: ProductAnalyticsEventField.Property,
        key: "plan",
        value: "x".repeat(PRODUCT_ANALYTICS_MAX_SEGMENT_VALUE_LENGTH),
      },
    ]);
  });

  test("is an object", () => {
    for (const notAnObject of [null, undefined, "steps", 7, true, [SIGN_UP]]) {
      expect([notAnObject, funnelProblem(notAnObject)]).toEqual([
        notAnObject,
        PRODUCT_ANALYTICS_SAVED_VIEW_PROBLEMS.notAnObject,
      ]);
    }
  });

  test("a retention table's definition is not a funnel's", () => {
    expect(
      funnelProblem({
        startEvent: SIGN_UP,
        returnEvent: SESSION,
        period: ProductAnalyticsRetentionPeriod.Week,
      }),
    ).toBe(PRODUCT_ANALYTICS_SAVED_VIEW_PROBLEMS.steps);
  });
});

describe("a saved retention table's definition", () => {
  test("is kept as the page shows it: its start and return events, its period and its segment", () => {
    for (const period of [
      ProductAnalyticsRetentionPeriod.Day,
      ProductAnalyticsRetentionPeriod.Week,
      ProductAnalyticsRetentionPeriod.Month,
    ]) {
      const read: ProductAnalyticsDefinitionRead<ProductAnalyticsRetentionDefinition> =
        readRetention({
          startEvent: SIGN_UP,
          returnEvent: SESSION,
          period: period,
          filters: [PLAN_FILTER],
        });

      expect(read.problem).toBeNull();
      expect(read.definition).toEqual({
        startEvent: SIGN_UP,
        returnEvent: SESSION,
        period: period,
        filters: [PLAN_FILTER],
      });
    }
  });

  test("keeps nothing a caller sent beside its own fields", () => {
    const read: ProductAnalyticsDefinitionRead<ProductAnalyticsRetentionDefinition> =
      readRetention({
        startEvent: { ...SIGN_UP, people: 12 },
        returnEvent: { ...PURCHASED, extra: "x" },
        period: ProductAnalyticsRetentionPeriod.Month,
        filters: [{ ...COUNTRY_FILTER, more: 1 }],
        timeZone: "Europe/Berlin",
        cohorts: [{ people: 400 }],
      });

    expect(JSON.stringify(read.definition)).toBe(
      JSON.stringify({
        startEvent: SIGN_UP,
        returnEvent: PURCHASED,
        period: ProductAnalyticsRetentionPeriod.Month,
        filters: [COUNTRY_FILTER],
      }),
    );
  });

  test("is read by the week, with no segment, when none is named", () => {
    for (const absent of [{}, { period: null, filters: null }]) {
      expect(
        readRetention({ startEvent: SIGN_UP, returnEvent: SESSION, ...absent })
          .definition,
      ).toEqual({
        startEvent: SIGN_UP,
        returnEvent: SESSION,
        period: ProductAnalyticsRetentionPeriod.Week,
        filters: [],
      });
    }
  });

  test("names each of its events, and a period the reads take", () => {
    for (const badEvent of [
      undefined,
      null,
      "Signed up",
      { kind: "click" },
      { kind: ProductAnalyticsEventKind.Custom, name: "" },
      { kind: ProductAnalyticsEventKind.Page },
    ]) {
      expect(
        retentionProblem({ startEvent: badEvent, returnEvent: SESSION }),
      ).toBe(PRODUCT_ANALYTICS_SAVED_VIEW_PROBLEMS.startEvent);
      expect(
        retentionProblem({ startEvent: SIGN_UP, returnEvent: badEvent }),
      ).toBe(PRODUCT_ANALYTICS_SAVED_VIEW_PROBLEMS.returnEvent);
    }

    for (const badPeriod of ["year", "Week", "WEEK", " week", 7, ["week"]]) {
      expect([
        badPeriod,
        retentionProblem({
          startEvent: SIGN_UP,
          returnEvent: SESSION,
          period: badPeriod,
        }),
      ]).toEqual([badPeriod, PRODUCT_ANALYTICS_SAVED_VIEW_PROBLEMS.period]);
    }
  });

  test("has a segment the reads take", () => {
    expect(
      retentionProblem({
        startEvent: SIGN_UP,
        returnEvent: SESSION,
        filters: new Array<ProductAnalyticsSegmentFilter>(6).fill(
          COUNTRY_FILTER,
        ),
      }),
    ).toBe(PRODUCT_ANALYTICS_SAVED_VIEW_PROBLEMS.filters);
    expect(
      retentionProblem({
        startEvent: SIGN_UP,
        returnEvent: SESSION,
        filters: [{ field: ProductAnalyticsEventField.Property, value: "pro" }],
      }),
    ).toBe(PRODUCT_ANALYTICS_SAVED_VIEW_PROBLEMS.filter);
  });

  test("is an object, and a funnel's definition is not one", () => {
    for (const notAnObject of [null, "retention", 1, [SIGN_UP, SESSION]]) {
      expect(retentionProblem(notAnObject)).toBe(
        PRODUCT_ANALYTICS_SAVED_VIEW_PROBLEMS.notAnObject,
      );
    }

    expect(retentionProblem({ steps: [SIGN_UP, PURCHASED] })).toBe(
      PRODUCT_ANALYTICS_SAVED_VIEW_PROBLEMS.startEvent,
    );
  });
});

describe("a definition read as its kind's", () => {
  test("a funnel's as a funnel's, a retention table's as a retention table's", () => {
    expect(
      readProductAnalyticsSavedViewDefinition(
        ProductAnalyticsSavedViewType.Funnel,
        { steps: [SIGN_UP, PURCHASED] },
      ),
    ).toEqual(readFunnel({ steps: [SIGN_UP, PURCHASED] }));

    expect(
      readProductAnalyticsSavedViewDefinition(
        ProductAnalyticsSavedViewType.Retention,
        { startEvent: SIGN_UP, returnEvent: SESSION },
      ),
    ).toEqual(readRetention({ startEvent: SIGN_UP, returnEvent: SESSION }));

    // Each kind refuses the other's.
    expect(
      readProductAnalyticsSavedViewDefinition(
        ProductAnalyticsSavedViewType.Funnel,
        { startEvent: SIGN_UP, returnEvent: SESSION },
      ).problem,
    ).toBe(PRODUCT_ANALYTICS_SAVED_VIEW_PROBLEMS.steps);
    expect(
      readProductAnalyticsSavedViewDefinition(
        ProductAnalyticsSavedViewType.Retention,
        { steps: [SIGN_UP, PURCHASED] },
      ).problem,
    ).toBe(PRODUCT_ANALYTICS_SAVED_VIEW_PROBLEMS.startEvent);
  });

  test("of a kind this version does not know, is no definition", () => {
    expect(
      readProductAnalyticsSavedViewDefinition(
        "paths" as ProductAnalyticsSavedViewType,
        { steps: [SIGN_UP, PURCHASED] },
      ),
    ).toEqual({
      definition: null,
      problem: PRODUCT_ANALYTICS_SAVED_VIEW_PROBLEMS.viewType,
    });
  });
});

describe("a saved view's name", () => {
  test("is kept trimmed", () => {
    expect(
      toProductAnalyticsSavedViewName("  Sign-up to first purchase \n"),
    ).toBe("Sign-up to first purchase");
    expect(toProductAnalyticsSavedViewName(undefined)).toBe("");
    expect(toProductAnalyticsSavedViewName(42)).toBe("");
    expect(toProductAnalyticsSavedViewName({ name: "x" })).toBe("");
  });

  test("is there, and fits in 100 characters once trimmed", () => {
    for (const blank of ["", "   ", "\n\t", undefined, null, 7, ["Name"]]) {
      expect([blank, getProductAnalyticsSavedViewNameProblem(blank)]).toEqual([
        blank,
        PRODUCT_ANALYTICS_SAVED_VIEW_PROBLEMS.name,
      ]);
    }

    expect(getProductAnalyticsSavedViewNameProblem("a".repeat(100))).toBeNull();
    expect(
      getProductAnalyticsSavedViewNameProblem(`  ${"a".repeat(100)}  `),
    ).toBeNull();
    expect(getProductAnalyticsSavedViewNameProblem("a".repeat(101))).toBe(
      PRODUCT_ANALYTICS_SAVED_VIEW_PROBLEMS.nameTooLong,
    );
    expect(getProductAnalyticsSavedViewNameProblem("Weekly return")).toBeNull();
  });
});

describe("whether two definitions read the same", () => {
  test("a stored one, read again, is the one the page shows", () => {
    const onScreen: ProductAnalyticsFunnelDefinition = readFunnel({
      steps: [SIGN_UP, PURCHASED],
      windowMs: 7 * DAY_MS,
      filters: [PLAN_FILTER],
    }).definition!;

    // The same definition, its keys in another order, as JSON stores them.
    const stored: unknown = JSON.parse(
      JSON.stringify({
        filters: [{ value: "pro", key: "plan", field: "property" }],
        windowMs: 7 * DAY_MS,
        steps: [
          { name: "Signed up", kind: "custom" },
          { name: "Purchased", kind: "custom" },
        ],
      }),
    );

    expect(
      isSameProductAnalyticsDefinition(readFunnel(stored).definition, onScreen),
    ).toBe(true);
  });

  test("a step, a window, a period or a filter apart is another", () => {
    const funnel: ProductAnalyticsFunnelDefinition = readFunnel({
      steps: [SIGN_UP, PURCHASED],
    }).definition!;

    expect(
      isSameProductAnalyticsDefinition(
        funnel,
        readFunnel({ steps: [PURCHASED, SIGN_UP] }).definition,
      ),
    ).toBe(false);
    expect(
      isSameProductAnalyticsDefinition(
        funnel,
        readFunnel({ steps: [SIGN_UP, PURCHASED], windowMs: HOUR_MS })
          .definition,
      ),
    ).toBe(false);
    expect(
      isSameProductAnalyticsDefinition(
        funnel,
        readFunnel({ steps: [SIGN_UP, PURCHASED], filters: [PLAN_FILTER] })
          .definition,
      ),
    ).toBe(false);

    const weekly: ProductAnalyticsRetentionDefinition = readRetention({
      startEvent: SIGN_UP,
      returnEvent: SESSION,
    }).definition!;

    expect(
      isSameProductAnalyticsDefinition(
        weekly,
        readRetention({
          startEvent: SIGN_UP,
          returnEvent: SESSION,
          period: ProductAnalyticsRetentionPeriod.Week,
        }).definition,
      ),
    ).toBe(true);
    expect(
      isSameProductAnalyticsDefinition(
        weekly,
        readRetention({
          startEvent: SIGN_UP,
          returnEvent: SESSION,
          period: ProductAnalyticsRetentionPeriod.Day,
        }).definition,
      ),
    ).toBe(false);
  });
});
