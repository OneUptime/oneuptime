import {
  expect,
  Locator,
  Page,
  Route as PlaywrightRoute,
  test,
} from "@playwright/test";
import { formatFacetCount } from "Common/UI/Components/TelemetryViewer/FacetCount";

/*
 * "I'm not able to uncheck when I click on this. Please check if we have the
 * same issue everywhere and fix it."
 *
 * A checked value in a telemetry explorer's filter sidebar did nothing when
 * clicked on Traces, Metrics and Exceptions: their handlers only ever added a
 * filter, so the value stayed checked and the only way out was the chip's x.
 * The Traces "Root spans" value could not be cleared from its row at all, and
 * the exclude button beside every value did nothing on any of the four.
 *
 * Here the production explorers run on the offline fixture
 * (Fixture/Fixture.js), which records every request in order, and a value is
 * clicked on and off by its row, as a reader does: the row is a checkbox that
 * says whether it is checked, the chip comes and goes with it, and the
 * explorer's reads carry the filter, then do not.
 */

const PORT: string = process.env["CHART_TIME_ZOOM_FIXTURE_PORT"] || "4233";
const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const NOW: Date = new Date("2026-09-21T12:00:00.000Z");

const TRACES_PATH: string = `/dashboard/${PROJECT_ID}/traces`;
const LOGS_PATH: string = `/dashboard/${PROJECT_ID}/logs`;
const EXCEPTIONS_PATH: string = `/dashboard/${PROJECT_ID}/exceptions/unresolved`;
const METRICS_PATH: string = `/dashboard/${PROJECT_ID}/metrics`;

const LOG_TABLE: string = "LogItemV3";
const METRIC_TYPE_TABLE: string = "MetricType";

interface RecordedRequest {
  seq: number;
  kind: string;
  modelName?: string | undefined;
  url?: string | undefined;
  body?: Record<string, unknown> | undefined;
  query?: Record<string, unknown> | undefined;
}

interface SpecWindow {
  __chartTimeZoomFixture: {
    requests: Array<RecordedRequest>;
    unhandled: Array<Record<string, unknown>>;
    dataset: { services: Array<{ id: string; name: string }> };
  };
}

const pageErrors: Map<Page, Array<string>> = new Map();
const abortedRequests: Map<Page, Array<string>> = new Map();

test.beforeEach(async ({ page }: { page: Page }) => {
  const errors: Array<string> = [];
  const aborted: Array<string> = [];
  pageErrors.set(page, errors);
  abortedRequests.set(page, aborted);
  page.on("pageerror", (error: Error) => {
    errors.push(error.message);
  });

  // Nothing may leave the fixture server.
  await page.route("**/*", async (route: PlaywrightRoute) => {
    const target: URL = new URL(route.request().url());
    if (target.hostname === "127.0.0.1" && target.port === PORT) {
      await route.continue();
      return;
    }
    aborted.push(route.request().url());
    await route.abort();
  });

  // The fixture's moment, and a clock that keeps ticking from it.
  await page.clock.install({ time: NOW });
});

test.afterEach(async ({ page }: { page: Page }) => {
  expect(pageErrors.get(page) || [], "uncaught page errors").toEqual([]);
  expect(
    abortedRequests.get(page) || [],
    "requests that left the fixture server",
  ).toEqual([]);

  const unhandled: Array<Record<string, unknown>> = await page
    .evaluate((): Array<Record<string, unknown>> => {
      const state: SpecWindow["__chartTimeZoomFixture"] | undefined = (
        window as unknown as Partial<SpecWindow>
      ).__chartTimeZoomFixture;
      return state
        ? (JSON.parse(JSON.stringify(state.unhandled)) as Array<
            Record<string, unknown>
          >)
        : [];
    })
    .catch((): Array<Record<string, unknown>> => {
      return [];
    });
  expect(unhandled, "requests the fixture does not model").toEqual([]);
});

async function open(page: Page, path: string): Promise<void> {
  await page.goto(path);
  // The first load parses a large bundle.
  await expect(page.getByTestId("synthetic-banner")).toBeVisible({
    timeout: 60000,
  });
}

async function requests(page: Page): Promise<Array<RecordedRequest>> {
  return page.evaluate((): Array<RecordedRequest> => {
    return JSON.parse(
      JSON.stringify(
        (window as unknown as SpecWindow).__chartTimeZoomFixture.requests,
      ),
    ) as Array<RecordedRequest>;
  });
}

// The body of the newest request to an explorer endpoint.
/*
 * Whether a facets request counted one chosen facet on its own, without its
 * selection (FacetCountPlan): the rest of a read's facets are counted in one
 * request that carries every filter.
 */
function isOwnSelectionCount(body: Record<string, unknown>): boolean {
  const keys: unknown = body["facetKeys"];
  return Array.isArray(keys) && keys.length === 1;
}

/*
 * The newest body sent to an endpoint. For a facets endpoint, the newest
 * request that carries every filter: a facet with a value chosen is also
 * counted on its own, without its selection, and the two requests may land
 * in either order.
 */
async function lastBodyTo(
  page: Page,
  path: string,
): Promise<Record<string, unknown> | null> {
  const calls: Array<RecordedRequest> = (await requests(page)).filter(
    (request: RecordedRequest): boolean => {
      return (
        request.kind === "api" &&
        Boolean(request.url?.endsWith(path)) &&
        !(path.endsWith("/facets") && isOwnSelectionCount(request.body || {}))
      );
    },
  );
  return calls.length > 0 ? calls[calls.length - 1]!.body || {} : null;
}

// The newest request that counted one chosen facet without its selection.
async function lastOwnCountOf(
  page: Page,
  path: string,
  facetKey: string,
): Promise<Record<string, unknown> | null> {
  const calls: Array<RecordedRequest> = (await requests(page)).filter(
    (request: RecordedRequest): boolean => {
      const body: Record<string, unknown> = request.body || {};
      return (
        request.kind === "api" &&
        Boolean(request.url?.endsWith(path)) &&
        isOwnSelectionCount(body) &&
        (body["facetKeys"] as Array<string>)[0] === facetKey
      );
    },
  );
  return calls.length > 0 ? calls[calls.length - 1]!.body || {} : null;
}

// The query of the newest list read of a table.
async function lastQueryOf(
  page: Page,
  kind: string,
  modelName: string,
): Promise<Record<string, unknown> | null> {
  const reads: Array<RecordedRequest> = (await requests(page)).filter(
    (request: RecordedRequest): boolean => {
      return request.kind === kind && request.modelName === modelName;
    },
  );
  return reads.length > 0 ? reads[reads.length - 1]!.query || {} : null;
}

/*
 * A facet section of the sidebar, by its title: the section around the
 * header button that folds it (the only buttons that control a section), so
 * a column header of the same name in the list is never taken for it.
 */
function facetSection(page: Page, title: string): Locator {
  return page
    .locator("button[aria-expanded][aria-controls]")
    .filter({ hasText: title })
    .first()
    .locator("xpath=../..");
}

// A value's row: a checkbox named for the value.
function valueRow(section: Locator, name: string): Locator {
  return section.getByRole("checkbox", { name: name, exact: true });
}

// The fixture's id for one of the explorers' services, by name.
async function serviceId(page: Page, name: string): Promise<string> {
  const services: Array<{ id: string; name: string }> = await page.evaluate(
    (): Array<{ id: string; name: string }> => {
      return JSON.parse(
        JSON.stringify(
          (window as unknown as SpecWindow).__chartTimeZoomFixture.dataset
            .services,
        ),
      ) as Array<{ id: string; name: string }>;
    },
  );
  const found: { id: string; name: string } | undefined = services.find(
    (service: { id: string; name: string }): boolean => {
      return service.name === name;
    },
  );
  expect(found, `the fixture's ${name}`).toBeDefined();
  return found!.id;
}

async function expectNoExcludeButtons(page: Page): Promise<void> {
  await expect(page.getByRole("button", { name: /^Exclude / })).toHaveCount(0);
}

// One facet value row as it lays out on the page.
interface RowGeometry {
  value: string;
  rowWidth: number;
  checkboxWidth: number;
  barLeft: number;
  countRight: number;
  // What the count column shows: "17K", or a count under a thousand.
  shownCount: string;
  // The full count on hover, for a shortened one.
  fullCount: string | null;
}

// Every value row of the sidebar that has a count, measured in the browser.
async function rowGeometry(page: Page): Promise<Array<RowGeometry>> {
  return page
    .getByTestId("facet-value-row")
    .evaluateAll((rows: Array<Element>): Array<RowGeometry> => {
      const measured: Array<RowGeometry> = [];

      for (const row of rows) {
        const checkbox: Element | null = row.querySelector("[role=checkbox]");
        const count: Element | null = row.querySelector(
          "[data-testid='facet-value-count']",
        );
        const bar: Element | null = count ? count.previousElementSibling : null;

        if (!checkbox || !count || !bar) {
          continue;
        }

        const shown: Element = count.querySelector("[aria-hidden]") || count;

        measured.push({
          value: row.getAttribute("data-value") || "",
          rowWidth: Math.round(row.getBoundingClientRect().width),
          checkboxWidth: Math.round(checkbox.getBoundingClientRect().width),
          barLeft: Math.round(bar.getBoundingClientRect().left),
          countRight: Math.round(count.getBoundingClientRect().right),
          shownCount: (shown.textContent || "").trim(),
          fullCount: count.getAttribute("title"),
        });
      }

      return measured;
    });
}

function distinct(values: Array<number>): Array<number> {
  return Array.from(new Set<number>(values));
}

// "17,231": a count grouped the way en-US writes it.
const GROUPED_COUNT: RegExp = /^[0-9]{1,3}(,[0-9]{3})+$/;

// A shortened count: "17K", "8.6K", "2.4M".
const SHORTENED_COUNT: RegExp = /^[0-9]+(\.[0-9])?[KMBT]$/;

const DIGIT_GROUP_SEPARATOR: string = ",";

// A count under a thousand, written out.
const SMALL_COUNT: RegExp = /^[0-9]{1,3}$/;

test.describe("Traces explorer: a facet value clicks on and off", () => {
  test("Status: Error checks, then unchecks, and the chart and counts follow", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, TRACES_PATH);

    const error: Locator = valueRow(facetSection(page, "Status"), "Error");
    await expect(error).toHaveAttribute("aria-checked", "false", {
      timeout: 30000,
    });

    await error.click();

    await expect(error).toHaveAttribute("aria-checked", "true");
    await expect(page.getByTitle("Remove Status: Error")).toBeVisible();
    await expect
      .poll(async () => {
        return (await lastBodyTo(page, "/telemetry/traces/facets"))?.[
          "statusCodes"
        ];
      })
      .toEqual([2]);

    // REGRESSION: the second click used to leave it checked.
    await error.click();

    await expect(error).toHaveAttribute("aria-checked", "false");
    await expect(page.getByTitle("Remove Status: Error")).toHaveCount(0);
    await expect
      .poll(async () => {
        return (await lastBodyTo(page, "/telemetry/traces/facets"))?.[
          "statusCodes"
        ];
      })
      .toBeUndefined();
  });

  test("Span Type: 'Root spans' turns root-only on, and a second click turns it off", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, TRACES_PATH);

    const rootSpans: Locator = valueRow(
      facetSection(page, "Span Type"),
      "Root spans",
    );
    await expect(rootSpans).toHaveAttribute("aria-checked", "false", {
      timeout: 30000,
    });

    await rootSpans.click();

    await expect(rootSpans).toHaveAttribute("aria-checked", "true");
    await expect
      .poll(async () => {
        return (await lastBodyTo(page, "/telemetry/traces/facets"))?.[
          "rootOnly"
        ];
      })
      .toBe(true);

    // REGRESSION: it could only ever be turned on from its row.
    await rootSpans.click();

    await expect(rootSpans).toHaveAttribute("aria-checked", "false");
    await expect
      .poll(async () => {
        return (await lastBodyTo(page, "/telemetry/traces/facets"))?.[
          "rootOnly"
        ];
      })
      .toBe(false);
  });

  /*
   * A facet with a value checked is counted without its own selection, so
   * the values beside the checked one stay listed with their counts and a
   * second can be checked. It used to be counted with its own selection
   * applied: once Error was checked, Ok and Unset had nothing left to count
   * and dropped out of the Status facet.
   */
  test("Status: a checked Error keeps Ok and Unset listed, and a second status can be checked", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, TRACES_PATH);

    const status: Locator = facetSection(page, "Status");
    const error: Locator = valueRow(status, "Error");
    const unset: Locator = valueRow(status, "Unset (no error)");
    await expect(error).toHaveAttribute("aria-checked", "false", {
      timeout: 30000,
    });

    await error.click();
    await expect(error).toHaveAttribute("aria-checked", "true");

    // Still there, unchecked, counted without the Error chip.
    await expect(unset).toBeVisible();
    await expect(unset).toHaveAttribute("aria-checked", "false");
    await expect
      .poll(async () => {
        return (
          await lastOwnCountOf(page, "/telemetry/traces/facets", "statusCode")
        )?.["statusCodes"];
      })
      .toBeUndefined();
    expect(
      await lastOwnCountOf(page, "/telemetry/traces/facets", "statusCode"),
    ).not.toBeNull();

    await unset.click();
    await expect(error).toHaveAttribute("aria-checked", "true");
    await expect(unset).toHaveAttribute("aria-checked", "true");
    await expect
      .poll(async () => {
        const codes: unknown = (
          await lastBodyTo(page, "/telemetry/traces/facets")
        )?.["statusCodes"];
        return Array.isArray(codes) ? [...codes].sort() : codes;
      })
      .toEqual([0, 2]);
  });

  /*
   * The Service facet lists every service of the project, counted or not,
   * and is counted without its own selection like every facet, so two can
   * be checked at once.
   */
  test("two Services: unchecking one leaves the other checked", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, TRACES_PATH);

    const services: Locator = facetSection(page, "Service");
    const checkout: Locator = valueRow(services, "checkout-api");
    const payments: Locator = valueRow(services, "payments-worker");
    await expect(checkout).toBeVisible({ timeout: 30000 });
    const paymentsId: string = await serviceId(page, "payments-worker");

    await checkout.click();
    await expect(checkout).toHaveAttribute("aria-checked", "true");
    await payments.click();
    await expect(payments).toHaveAttribute("aria-checked", "true");

    await checkout.click();

    await expect(checkout).toHaveAttribute("aria-checked", "false");
    await expect(payments).toHaveAttribute("aria-checked", "true");
    await expect
      .poll(async () => {
        return (await lastBodyTo(page, "/telemetry/traces/facets"))?.[
          "serviceIds"
        ];
      })
      .toEqual([paymentsId]);

    await payments.click();

    await expect(payments).toHaveAttribute("aria-checked", "false");
    await expect
      .poll(async () => {
        return (await lastBodyTo(page, "/telemetry/traces/facets"))?.[
          "serviceIds"
        ];
      })
      .toBeUndefined();
  });

  test("no value offers an exclude button: the chart and counts cannot leave one out", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, TRACES_PATH);
    await expect(valueRow(facetSection(page, "Status"), "Error")).toBeVisible({
      timeout: 30000,
    });

    await valueRow(facetSection(page, "Status"), "Error").hover();

    await expectNoExcludeButtons(page);
  });
});

test.describe("Logs explorer: a facet value clicks on and off", () => {
  test("Severity: Error checks, then unchecks, and the list and the link follow", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, LOGS_PATH);

    const error: Locator = valueRow(facetSection(page, "Severity"), "Error");
    await expect(error).toHaveAttribute("aria-checked", "false", {
      timeout: 30000,
    });

    await error.click();

    await expect(error).toHaveAttribute("aria-checked", "true");
    await expect
      .poll(async () => {
        return (await lastQueryOf(page, "analytics.getList", LOG_TABLE))?.[
          "severityText"
        ];
      })
      .toBe("Error");
    await expect
      .poll(() => {
        return new URL(page.url()).searchParams.get("filters");
      })
      .toBe(JSON.stringify([["severityText", ["Error"]]]));

    await error.click();

    await expect(error).toHaveAttribute("aria-checked", "false");
    await expect
      .poll(async () => {
        return (await lastQueryOf(page, "analytics.getList", LOG_TABLE))?.[
          "severityText"
        ];
      })
      .toBeUndefined();
    await expect
      .poll(() => {
        return new URL(page.url()).searchParams.get("filters");
      })
      .toBeNull();
  });

  test("no value offers an exclude button: the old one was an empty placeholder", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, LOGS_PATH);
    const error: Locator = valueRow(facetSection(page, "Severity"), "Error");
    await expect(error).toBeVisible({ timeout: 30000 });

    await error.hover();

    await expectNoExcludeButtons(page);
  });
});

test.describe("Exceptions explorer: a facet value clicks on and off", () => {
  test("Exception Type checks, then unchecks, and the counts follow", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, EXCEPTIONS_PATH);

    const type: Locator = valueRow(
      facetSection(page, "Exception Type"),
      "DeadlineExceededError",
    );
    await expect(type).toHaveAttribute("aria-checked", "false", {
      timeout: 30000,
    });

    await type.click();

    await expect(type).toHaveAttribute("aria-checked", "true");
    await expect
      .poll(async () => {
        return (await lastBodyTo(page, "/telemetry/exceptions/facets"))?.[
          "exceptionTypes"
        ];
      })
      .toEqual(["DeadlineExceededError"]);

    // REGRESSION: the second click used to leave it checked.
    await type.click();

    await expect(type).toHaveAttribute("aria-checked", "false");
    await expect
      .poll(async () => {
        return (await lastBodyTo(page, "/telemetry/exceptions/facets"))?.[
          "exceptionTypes"
        ];
      })
      .toBeUndefined();

    await expectNoExcludeButtons(page);
  });
});

/*
 * The report's screenshot showed a checked service cut to "one..." in the
 * 224px sidebar: its count was written out in full ("2,417,585") and the
 * exclude button kept a column of its own. A count is now shortened the way
 * the chart labels its axis, in one column of one width, so every bar and
 * count of the sidebar lines up and the name keeps the rest of the row.
 */
test.describe("Facet rows: the name keeps the row's width", () => {
  test("REGRESSION: counts are shortened in one column, so the bars and counts line up and no count takes the name's room", async ({
    page,
  }: {
    page: Page;
  }) => {
    // A day of spans: every service counts in the thousands.
    await open(
      page,
      `${TRACES_PATH}?range=${encodeURIComponent("Past 1 Day")}`,
    );

    const services: Locator = facetSection(page, "Service");
    await expect(valueRow(services, "checkout-api")).toBeVisible({
      timeout: 30000,
    });
    // The day's counts are in: some row counts more than nothing.
    await expect
      .poll(async () => {
        return (await rowGeometry(page)).some((row: RowGeometry): boolean => {
          return row.shownCount !== "" && row.shownCount !== "0";
        });
      })
      .toBe(true);

    const rows: Array<RowGeometry> = await rowGeometry(page);
    expect(rows.length).toBeGreaterThan(8);

    // One column: every count ends, and every bar starts, at the same x.
    expect(
      distinct(
        rows.map((row: RowGeometry): number => {
          return row.countRight;
        }),
      ),
    ).toHaveLength(1);
    expect(
      distinct(
        rows.map((row: RowGeometry): number => {
          return row.barLeft;
        }),
      ),
    ).toHaveLength(1);

    // So every name gets the same width, whatever its count holds...
    expect(
      distinct(
        rows.map((row: RowGeometry): number => {
          return row.checkboxWidth;
        }),
      ),
    ).toHaveLength(1);
    /*
     * ...and most of the row: 132 of a row's 214px in the 224px sidebar.
     * A count written out in full, or a column kept for an exclude button,
     * left the name 104px or less.
     */
    for (const row of rows) {
      expect(row.checkboxWidth / row.rowWidth).toBeGreaterThan(0.6);
    }

    // A day of spans counts in the thousands, so some counts are shortened.
    expect(
      rows.some((row: RowGeometry): boolean => {
        return SHORTENED_COUNT.test(row.shownCount);
      }),
    ).toBe(true);

    for (const row of rows) {
      expect(row.shownCount.length).toBeLessThanOrEqual(4);

      if (row.fullCount === null) {
        // Under a thousand: written out, nothing more on hover.
        expect(row.shownCount).toMatch(SMALL_COUNT);
        continue;
      }

      // Shortened, with the full count on hover, and the two agree.
      expect(row.shownCount).toMatch(SHORTENED_COUNT);
      expect(row.fullCount).toMatch(GROUPED_COUNT);
      expect(
        formatFacetCount(
          Number(row.fullCount.split(DIGIT_GROUP_SEPARATOR).join("")),
        ),
      ).toBe(row.shownCount);
    }
  });

  test("a checked value keeps the row's width, and its count stays in the column", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(
      page,
      `${TRACES_PATH}?range=${encodeURIComponent("Past 1 Day")}`,
    );

    const checkout: Locator = valueRow(
      facetSection(page, "Service"),
      "checkout-api",
    );
    await expect(checkout).toHaveAttribute("aria-checked", "false", {
      timeout: 30000,
    });
    const before: Array<RowGeometry> = await rowGeometry(page);

    await checkout.click();
    await expect(checkout).toHaveAttribute("aria-checked", "true");

    const after: Array<RowGeometry> = await rowGeometry(page);
    const checkedId: string = await serviceId(page, "checkout-api");
    const checkedRow: RowGeometry | undefined = after.find(
      (row: RowGeometry): boolean => {
        return row.value === checkedId;
      },
    );

    expect(checkedRow).toBeDefined();
    expect(checkedRow!.checkboxWidth).toBe(before[0]!.checkboxWidth);
    expect(checkedRow!.countRight).toBe(before[0]!.countRight);
    expect(checkedRow!.barLeft).toBe(before[0]!.barLeft);
  });
});

test.describe("Metrics explorer: a facet value clicks on and off", () => {
  test("Service checks, then unchecks, and the metric list follows", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, METRICS_PATH);

    const service: Locator = valueRow(
      facetSection(page, "Service"),
      "checkout-api",
    );
    await expect(service).toHaveAttribute("aria-checked", "false", {
      timeout: 30000,
    });

    await service.click();

    await expect(service).toHaveAttribute("aria-checked", "true");
    await expect
      .poll(async () => {
        return Boolean(
          (await lastQueryOf(page, "getList", METRIC_TYPE_TABLE))?.["services"],
        );
      })
      .toBe(true);

    // REGRESSION: the second click used to leave it checked.
    await service.click();

    await expect(service).toHaveAttribute("aria-checked", "false");
    await expect
      .poll(async () => {
        return Boolean(
          (await lastQueryOf(page, "getList", METRIC_TYPE_TABLE))?.["services"],
        );
      })
      .toBe(false);

    await expectNoExcludeButtons(page);
  });
});
