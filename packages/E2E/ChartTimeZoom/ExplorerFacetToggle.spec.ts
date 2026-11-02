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
 * the exclude button beside every value did nothing on any of the four. It
 * now leaves the value out for real on all four ("Status is not Error"): the
 * list, the chart and the counts drop its rows, and a click on its row takes
 * it off again.
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
const SPAN_TABLE: string = "SpanItemV3";
const EXCEPTION_TABLE: string = "TelemetryException";
const METRIC_TYPE_TABLE: string = "MetricType";

// The chip a value left out makes: "Status is not: Error", in red.
const EXCLUDED_CHIP_TEST_ID: string = "excluded-filter-chip";

// The bar before a value's count.
const BAR_TEST_ID: string = "facet-value-bar";

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

// A value of a choice of one (the traces Span Type): a radio named for it.
function choice(section: Locator, name: string): Locator {
  return section.getByRole("radio", { name: name, exact: true });
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

// A value's whole row, by the value it filters on: what says its state.
function rowOf(section: Locator, value: string): Locator {
  return section.locator(
    `[data-testid="facet-value-row"][data-value="${value}"]`,
  );
}

/*
 * Leave a value out with the minus beside it. The minus shows while its row
 * is hovered, over the count, as a reader finds it.
 */
async function excludeValue(
  section: Locator,
  value: string,
  name: string,
): Promise<void> {
  await rowOf(section, value).hover();
  await section
    .getByRole("button", { name: `Exclude ${name}`, exact: true })
    .click();
  await expect(rowOf(section, value)).toHaveAttribute("data-state", "excluded");
}

// The button that folds a facet section, by its title.
function sectionHeader(page: Page, title: string): Locator {
  return page
    .locator("button[aria-expanded][aria-controls]")
    .filter({ hasText: title })
    .first();
}

// A value's minus, by the value's name.
function minusOf(row: Locator, name: string): Locator {
  return row.getByRole("button", { name: `Exclude ${name}`, exact: true });
}

// A value's count, at the end of its row.
function countOf(row: Locator): Locator {
  return row.getByTestId("facet-value-count");
}

// How see-through an element is drawn: "1", or "0" for not at all.
async function opacityOf(locator: Locator): Promise<string> {
  return locator.evaluate((element: Element): string => {
    return window.getComputedStyle(element).opacity;
  });
}

// The `filters` the explorer wrote to its address, parsed.
function addressFilters(page: Page): Array<[string, unknown]> {
  const raw: string | null = new URL(page.url()).searchParams.get("filters");
  return raw ? (JSON.parse(raw) as Array<[string, unknown]>) : [];
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

  test("Span Type: Entry spans to start, Root spans when clicked, and Entry spans again from its own row", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, TRACES_PATH);

    // A choice of one: radio buttons, Entry spans chosen by default.
    const section: Locator = facetSection(page, "Span Type");
    const entrySpans: Locator = choice(section, "Entry spans");
    const rootSpans: Locator = choice(section, "Root spans");
    await expect(entrySpans).toHaveAttribute("aria-checked", "true", {
      timeout: 30000,
    });
    await expect(rootSpans).toHaveAttribute("aria-checked", "false");

    await rootSpans.click();

    await expect(rootSpans).toHaveAttribute("aria-checked", "true");
    await expect(entrySpans).toHaveAttribute("aria-checked", "false");
    await expect
      .poll(async () => {
        return (await lastBodyTo(page, "/telemetry/traces/facets"))?.[
          "rootOnly"
        ];
      })
      .toBe(true);

    // The chosen one again changes nothing: there is no "none" to go to.
    await rootSpans.click();
    await expect(rootSpans).toHaveAttribute("aria-checked", "true");

    // The default is chosen back from its own row.
    await entrySpans.click();

    await expect(entrySpans).toHaveAttribute("aria-checked", "true");
    await expect(rootSpans).toHaveAttribute("aria-checked", "false");
    await expect
      .poll(async () => {
        return (await lastBodyTo(page, "/telemetry/traces/facets"))?.[
          "entryOnly"
        ];
      })
      .toBe(true);
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

  test("Status: the minus leaves Error out of the list, the chart and the counts, and its row takes it off again", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, TRACES_PATH);

    const status: Locator = facetSection(page, "Status");
    await expect(valueRow(status, "Error")).toHaveAttribute(
      "aria-checked",
      "false",
      { timeout: 30000 },
    );

    await excludeValue(status, "2", "Error");

    // A red minus, read as the third state, and a chip that says it in words.
    await expect(rowOf(status, "2").getByRole("checkbox")).toHaveAttribute(
      "aria-checked",
      "mixed",
    );
    await expect(page.getByTestId(EXCLUDED_CHIP_TEST_ID)).toContainText(
      "Status is not",
    );
    await expect(page.getByTestId(EXCLUDED_CHIP_TEST_ID)).toContainText(
      "Error",
    );

    // The list, the chart and every other facet leave the error spans out.
    await expect
      .poll(async () => {
        return (await lastQueryOf(page, "analytics.getList", SPAN_TABLE))?.[
          "statusCode"
        ];
      })
      .toEqual({ _type: "NotEqual", value: 2 });
    await expect
      .poll(async () => {
        return (await lastBodyTo(page, "/telemetry/traces/histogram"))?.[
          "excludedStatusCodes"
        ];
      })
      .toEqual([2]);
    await expect
      .poll(async () => {
        return (await lastBodyTo(page, "/telemetry/traces/facets"))?.[
          "excludedStatusCodes"
        ];
      })
      .toEqual([2]);

    // The Status facet itself is counted without it: Ok and Unset stay listed.
    await expect
      .poll(async () => {
        const own: Record<string, unknown> | null = await lastOwnCountOf(
          page,
          "/telemetry/traces/facets",
          "statusCode",
        );
        return own ? own["excludedStatusCodes"] ?? "none" : null;
      })
      .toBe("none");
    await expect(valueRow(status, "Unset (no error)")).toBeVisible();

    // The address carries it, so a refresh or a shared link keeps it.
    await expect
      .poll(() => {
        return addressFilters(page);
      })
      .toContainEqual(["!statusCode", "2"]);

    // A click on the row takes it off, from the list and the chart alike.
    await rowOf(status, "2").getByRole("checkbox").click();

    await expect(valueRow(status, "Error")).toHaveAttribute(
      "aria-checked",
      "false",
    );
    await expect(page.getByTestId(EXCLUDED_CHIP_TEST_ID)).toHaveCount(0);
    await expect
      .poll(async () => {
        return (await lastQueryOf(page, "analytics.getList", SPAN_TABLE))?.[
          "statusCode"
        ];
      })
      .toBeUndefined();
    await expect
      .poll(async () => {
        return (await lastBodyTo(page, "/telemetry/traces/histogram"))?.[
          "excludedStatusCodes"
        ];
      })
      .toBeUndefined();
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

  test("Severity: the minus leaves Error out of the list, the chart and the counts, and the link keeps it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, LOGS_PATH);

    const severity: Locator = facetSection(page, "Severity");
    await expect(valueRow(severity, "Error")).toHaveAttribute(
      "aria-checked",
      "false",
      { timeout: 30000 },
    );

    await excludeValue(severity, "Error", "Error");

    await expect(page.getByTestId(EXCLUDED_CHIP_TEST_ID)).toContainText(
      "Severity is not",
    );
    await expect
      .poll(async () => {
        return (await lastQueryOf(page, "analytics.getList", LOG_TABLE))?.[
          "severityText"
        ];
      })
      .toEqual({ _type: "NotEqual", value: "Error" });
    await expect
      .poll(async () => {
        return (await lastBodyTo(page, "/telemetry/logs/histogram"))?.[
          "excludedSeverityTexts"
        ];
      })
      .toEqual(["Error"]);
    await expect
      .poll(async () => {
        return (await lastBodyTo(page, "/telemetry/logs/facets"))?.[
          "excludedSeverityTexts"
        ];
      })
      .toEqual(["Error"]);
    await expect
      .poll(() => {
        return new URL(page.url()).searchParams.get("filters");
      })
      .toBe(JSON.stringify([["!severityText", ["Error"]]]));

    await rowOf(severity, "Error").getByRole("checkbox").click();

    await expect(valueRow(severity, "Error")).toHaveAttribute(
      "aria-checked",
      "false",
    );
    await expect(page.getByTestId(EXCLUDED_CHIP_TEST_ID)).toHaveCount(0);
    await expect
      .poll(async () => {
        return (await lastQueryOf(page, "analytics.getList", LOG_TABLE))?.[
          "severityText"
        ];
      })
      .toBeUndefined();
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
  });

  test("Exception Type: the minus leaves a type out of the list and the counts", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, EXCEPTIONS_PATH);

    const types: Locator = facetSection(page, "Exception Type");
    await expect(valueRow(types, "DeadlineExceededError")).toHaveAttribute(
      "aria-checked",
      "false",
      { timeout: 30000 },
    );

    await excludeValue(types, "DeadlineExceededError", "DeadlineExceededError");

    await expect(page.getByTestId(EXCLUDED_CHIP_TEST_ID)).toContainText(
      "Exception Type is not",
    );
    await expect
      .poll(async () => {
        return (await lastQueryOf(page, "getList", EXCEPTION_TABLE))?.[
          "exceptionType"
        ];
      })
      .toEqual({ _type: "NotEqual", value: "DeadlineExceededError" });
    await expect
      .poll(async () => {
        return (await lastBodyTo(page, "/telemetry/exceptions/facets"))?.[
          "excludedExceptionTypes"
        ];
      })
      .toEqual(["DeadlineExceededError"]);
    await expect
      .poll(async () => {
        return (await lastBodyTo(page, "/telemetry/exceptions/histogram"))?.[
          "excludedExceptionTypes"
        ];
      })
      .toEqual(["DeadlineExceededError"]);
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
  });

  test("Service: the minus hides the metrics the service reports, and its row takes it off", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, METRICS_PATH);

    const services: Locator = facetSection(page, "Service");
    await expect(valueRow(services, "checkout-api")).toHaveAttribute(
      "aria-checked",
      "false",
      { timeout: 30000 },
    );
    const checkoutId: string = await serviceId(page, "checkout-api");

    await excludeValue(services, checkoutId, "checkout-api");

    await expect(page.getByTestId(EXCLUDED_CHIP_TEST_ID)).toContainText(
      "Service is not",
    );
    await expect
      .poll(async () => {
        const services: unknown = (
          await lastQueryOf(page, "getList", METRIC_TYPE_TABLE)
        )?.["services"];
        return (services as { _type?: string } | undefined)?._type;
      })
      .toBe("IncludesNone");

    await rowOf(services, checkoutId).getByRole("checkbox").click();

    await expect(page.getByTestId(EXCLUDED_CHIP_TEST_ID)).toHaveCount(0);
    await expect
      .poll(async () => {
        return Boolean(
          (await lastQueryOf(page, "getList", METRIC_TYPE_TABLE))?.["services"],
        );
      })
      .toBe(false);
  });
});

/*
 * The UI review of #5574: the minus showed only under a pointer that hovers.
 * It was display:none otherwise, so the keyboard could not Tab to it, and a
 * touch screen, which has no hover, never showed it - a tap on the row
 * checked the value instead. It now shows to the keyboard (Tab onto a value
 * and it stands where the count was, one more Tab away) and, on a touch
 * screen, beside every count. A value a mouse click checked keeps its count
 * in view.
 */
test.describe("The minus by keyboard", () => {
  test("Tab onto a value shows the minus over its count, one more Tab reaches it, and Enter leaves the value out", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, LOGS_PATH);

    const severity: Locator = facetSection(page, "Severity");
    const information: Locator = valueRow(severity, "Information");
    await expect(information).toHaveAttribute("aria-checked", "false", {
      timeout: 30000,
    });
    const row: Locator = rowOf(severity, "Information");
    const minus: Locator = minusOf(row, "Information");

    // Nothing hovered or focused: the count, and no minus to Tab past.
    await page.mouse.move(0, 0);
    await expect(minus).toBeHidden();
    await expect(countOf(row)).toBeVisible();

    // From the section's title, as the keyboard comes to it.
    await sectionHeader(page, "Severity").focus();
    await page.keyboard.press("Tab");

    await expect(information).toBeFocused();
    await expect(minus).toBeVisible();
    expect(await opacityOf(minus)).toBe("1");
    // It stands where the count was.
    await expect(countOf(row)).toBeHidden();

    await page.keyboard.press("Tab");
    await expect(minus).toBeFocused();

    await page.keyboard.press("Enter");

    await expect(row).toHaveAttribute("data-state", "excluded");
    await expect(page.getByTestId(EXCLUDED_CHIP_TEST_ID)).toContainText(
      "Severity is not",
    );
    await expect
      .poll(async () => {
        return (await lastQueryOf(page, "analytics.getList", LOG_TABLE))?.[
          "severityText"
        ];
      })
      .toEqual({ _type: "NotEqual", value: "Information" });

    // Pressed, it keeps the focus, and Enter again takes the exclusion off.
    await expect(minus).toBeFocused();
    await expect(minus).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("Enter");

    await expect(row).toHaveAttribute("data-state", "none");
    await expect(page.getByTestId(EXCLUDED_CHIP_TEST_ID)).toHaveCount(0);
  });

  test("Tab past a value hides its minus again, and the next value shows its own", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, LOGS_PATH);

    const severity: Locator = facetSection(page, "Severity");
    await expect(valueRow(severity, "Information")).toHaveAttribute(
      "aria-checked",
      "false",
      { timeout: 30000 },
    );
    await page.mouse.move(0, 0);

    await sectionHeader(page, "Severity").focus();
    // The first value, its minus, then the second value.
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");

    const first: Locator = rowOf(severity, "Information");
    const second: Locator = rowOf(
      severity,
      (await severity
        .getByTestId("facet-value-row")
        .nth(1)
        .getAttribute("data-value")) || "",
    );

    await expect(second.getByRole("checkbox")).toBeFocused();
    await expect(minusOf(first, "Information")).toBeHidden();
    await expect(countOf(first)).toBeVisible();
    await expect(second.locator("button[aria-pressed]")).toBeVisible();
    await expect(countOf(second)).toBeHidden();
  });

  test("a value a click checked keeps its count in view, and the keyboard still reaches its minus", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, LOGS_PATH);

    const severity: Locator = facetSection(page, "Severity");
    const warning: Locator = valueRow(severity, "Warning");
    await expect(warning).toHaveAttribute("aria-checked", "false", {
      timeout: 30000,
    });
    const row: Locator = rowOf(severity, "Warning");
    const minus: Locator = minusOf(row, "Warning");

    await warning.click();
    await expect(warning).toHaveAttribute("aria-checked", "true");
    await page.mouse.move(0, 0);

    /*
     * The click left the value focused - not the keyboard's focus, so the
     * count stays and the minus, in the tab order behind it, is not drawn.
     */
    await expect(warning).toBeFocused();
    await expect(countOf(row)).toBeVisible();
    expect(await opacityOf(minus)).toBe("0");

    // From there the keyboard reaches the minus, which shows.
    await page.keyboard.press("Tab");

    await expect(minus).toBeFocused();
    expect(await opacityOf(minus)).toBe("1");
    await expect(countOf(row)).toBeHidden();
  });
});

test.describe("The minus on a touch screen", () => {
  // A phone: no pointer that hovers (hover: none), the sidebar under Filters.
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });

  async function openSeverity(page: Page): Promise<Locator> {
    await open(page, LOGS_PATH);
    await page.getByTestId("logs-viewer-filters-toggle").click();

    const severity: Locator = facetSection(page, "Severity");
    await expect(valueRow(severity, "Debug")).toHaveAttribute(
      "aria-checked",
      "false",
      { timeout: 30000 },
    );
    await severity.evaluate((element: Element): void => {
      element.scrollIntoView({ block: "center" });
    });

    return severity;
  }

  test("every value shows its minus after its count, with no hover to wait for", async ({
    page,
  }: {
    page: Page;
  }) => {
    const severity: Locator = await openSeverity(page);

    expect(
      await page.evaluate((): boolean => {
        return window.matchMedia("(hover: none)").matches;
      }),
    ).toBe(true);

    for (const value of ["Information", "Debug", "Warning", "Error"]) {
      const row: Locator = rowOf(severity, value);
      await expect(minusOf(row, value)).toBeVisible();
      expect(await opacityOf(minusOf(row, value))).toBe("1");
      await expect(countOf(row)).toBeVisible();
    }

    // A column of its own: after the count, inside the row, on one line.
    const boxes: {
      countRight: number;
      minusLeft: number;
      minusRight: number;
      rowRight: number;
      countTop: number;
      minusTop: number;
    } = await rowOf(severity, "Debug").evaluate(
      (
        element: Element,
      ): {
        countRight: number;
        minusLeft: number;
        minusRight: number;
        rowRight: number;
        countTop: number;
        minusTop: number;
      } => {
        const count: DOMRect = element
          .querySelector("[data-testid='facet-value-count']")!
          .getBoundingClientRect();
        const minus: DOMRect = element
          .querySelector("button[aria-pressed]")!
          .getBoundingClientRect();
        const row: DOMRect = element.getBoundingClientRect();
        return {
          countRight: count.right,
          minusLeft: minus.left,
          minusRight: minus.right,
          rowRight: row.right,
          countTop: count.top + count.height / 2,
          minusTop: minus.top + minus.height / 2,
        };
      },
    );

    expect(boxes.minusLeft).toBeGreaterThanOrEqual(boxes.countRight);
    expect(boxes.minusRight).toBeLessThanOrEqual(boxes.rowRight + 0.5);
    expect(Math.abs(boxes.minusTop - boxes.countTop)).toBeLessThan(2);

    // A phone's sidebar is the screen's width: its bars stay.
    await expect(
      rowOf(severity, "Debug").getByTestId(BAR_TEST_ID),
    ).toBeVisible();
  });

  test("a tap on the minus leaves the value out, and its count stays beside it", async ({
    page,
  }: {
    page: Page;
  }) => {
    const severity: Locator = await openSeverity(page);
    const row: Locator = rowOf(severity, "Debug");

    await minusOf(row, "Debug").tap();

    await expect(row).toHaveAttribute("data-state", "excluded");
    await expect(page.getByTestId(EXCLUDED_CHIP_TEST_ID)).toContainText(
      "Severity is not",
    );
    await expect
      .poll(async () => {
        return (await lastQueryOf(page, "analytics.getList", LOG_TABLE))?.[
          "severityText"
        ];
      })
      .toEqual({ _type: "NotEqual", value: "Debug" });
    await expect(minusOf(row, "Debug")).toHaveAttribute("aria-pressed", "true");
    await expect(countOf(row)).toBeVisible();

    // A tap on the pressed minus takes it off again.
    await minusOf(row, "Debug").tap();
    await expect(row).toHaveAttribute("data-state", "none");
  });

  test("a tap on a value checks it at once", async ({
    page,
  }: {
    page: Page;
  }) => {
    const severity: Locator = await openSeverity(page);

    await valueRow(severity, "Warning").tap();

    await expect(valueRow(severity, "Warning")).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });
});

// One facet row on a touch screen, measured in one read.
interface TouchRowGeometry {
  value: string;
  rowWidth: number;
  checkboxWidth: number;
  barDisplay: string;
  minusShown: boolean;
  minusLeft: number;
  countRight: number;
}

async function touchRowGeometry(
  section: Locator,
): Promise<Array<TouchRowGeometry>> {
  return section
    .getByTestId("facet-value-row")
    .evaluateAll((rows: Array<Element>): Array<TouchRowGeometry> => {
      return rows.map((row: Element): TouchRowGeometry => {
        const checkbox: Element = row.querySelector("[role=checkbox]")!;
        const bar: Element = row.querySelector(
          "[data-testid='facet-value-bar']",
        )!;
        const minus: Element = row.querySelector("button[aria-pressed]")!;
        const count: Element = row.querySelector(
          "[data-testid='facet-value-count']",
        )!;
        const minusStyle: CSSStyleDeclaration = window.getComputedStyle(minus);

        return {
          value: row.getAttribute("data-value") || "",
          rowWidth: row.getBoundingClientRect().width,
          checkboxWidth: checkbox.getBoundingClientRect().width,
          barDisplay: window.getComputedStyle(bar).display,
          minusShown:
            minusStyle.display !== "none" && minusStyle.opacity === "1",
          minusLeft: minus.getBoundingClientRect().left,
          countRight: count.getBoundingClientRect().right,
        };
      });
    });
}

test.describe("The minus on a touch tablet", () => {
  /*
   * A tablet: no hover, and from md up the sidebar beside the list, as
   * narrow as a desktop's (a row of 214px).
   */
  test.use({ hasTouch: true, viewport: { width: 1024, height: 1000 } });

  test("the minus takes the bar's place, so every name keeps most of its row", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, LOGS_PATH);

    const severity: Locator = facetSection(page, "Severity");
    await expect(valueRow(severity, "Information")).toHaveAttribute(
      "aria-checked",
      "false",
      { timeout: 30000 },
    );
    await expect(
      rowOf(severity, "Information").getByTestId(BAR_TEST_ID),
    ).toBeHidden();

    const rows: Array<TouchRowGeometry> = await touchRowGeometry(severity);
    expect(rows.length).toBeGreaterThan(3);

    for (const row of rows) {
      expect({ value: row.value, bar: row.barDisplay }).toEqual({
        value: row.value,
        bar: "none",
      });
      expect(row.minusShown).toBe(true);
      expect(row.minusLeft).toBeGreaterThanOrEqual(row.countRight);
      /*
       * As much of the row as under a mouse (see "the name keeps the row's
       * width" above): with the bar kept beside the button's column the
       * name had less than half of it.
       */
      expect(row.checkboxWidth / row.rowWidth).toBeGreaterThan(0.6);
    }

    // And a tap on the minus leaves the value out.
    await minusOf(rowOf(severity, "Error"), "Error").tap();
    await expect(rowOf(severity, "Error")).toHaveAttribute(
      "data-state",
      "excluded",
    );
  });
});
