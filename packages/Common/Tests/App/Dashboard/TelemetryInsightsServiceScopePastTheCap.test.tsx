/** @timezone UTC */

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
  configure,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import CappedListServer, {
  CappedListCall,
  namesSortingFirst,
} from "./CappedListServer";
import MetricsDashboard from "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/MetricsDashboard";
import TracesDashboard from "../../../../App/FeatureSet/Dashboard/src/Components/Traces/TracesDashboard";
import Metric from "../../../Models/AnalyticsModels/Metric";
import Span, { SpanStatus } from "../../../Models/AnalyticsModels/Span";
import RumApplication from "../../../Models/DatabaseModels/RumApplication";
import Service from "../../../Models/DatabaseModels/Service";
import Includes from "../../../Types/BaseDatabase/Includes";
import Search from "../../../Types/BaseDatabase/Search";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import ObjectID from "../../../Types/ObjectID";
import AnalyticsModelAPI from "../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import ProjectUtil from "../../../UI/Utils/Project";
import TelemetryEntityNameResolver from "../../../UI/Utils/Telemetry/TelemetryEntityNames";
import { getJestSpyOn } from "../../Spy";

/*
 * THE METRICS AND TRACES INSIGHTS TABS' SERVICE SCOPE, PAST THE PROJECT'S
 * FIRST 10,000 SERVICES (#10764).
 *
 * Both tabs read the project's first 10,000 services by name, to offer them
 * in their scope picker, to name the services a scope holds and to name
 * the services the page's telemetry came from. A service past them could
 * not be found or picked, its metrics had no card and its traces no row of
 * the health table, and the quiet services were counted against the first
 * 10,000. Now the picker searches the server, what a scope holds is read
 * by its ids (a service, another telemetry entity, the telemetry that
 * named no service, or one gone), the page's services are read by the ids
 * its telemetry names, and the project's services are counted on the
 * server. ModelAPI answers from a project faked whole (CappedListServer).
 */

configure({ asyncUtilTimeout: 10000 });
jest.setTimeout(60000);

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";
const EARLY_ID: string = "a1000000-0000-4000-8000-000000000001";
const LATE_ID: string = "a1000000-0000-4000-8000-0000000000aa";
const OTHER_LATE_ID: string = "a1000000-0000-4000-8000-0000000000ab";
const ARCHIVED_ID: string = "a1000000-0000-4000-8000-0000000000ac";
const DELETED_ID: string = "a1000000-0000-4000-8000-0000000000dd";
const RUM_ID: string = "a2000000-0000-4000-8000-0000000000aa";

const SERVICES_BEFORE_WB: number = LIMIT_PER_PROJECT + 50;
// The early ones, the early reporter and the three named "WB kiosk ...".
const PROJECT_SERVICES: number = SERVICES_BEFORE_WB + 1 + 3;

let server: CappedListServer;
// What the analytics reads answer: the page's points or spans.
let analyticsRows: Array<Metric | Span> = [];
let analyticsQueries: Array<Record<string, unknown>> = [];

const metricPoint: (entityId: string, name: string) => Metric = (
  entityId: string,
  name: string,
): Metric => {
  const point: Metric = new Metric();
  point.name = name;
  point.primaryEntityId = new ObjectID(entityId);
  point.time = new Date("2026-11-24T11:30:00.000Z");
  return point;
};

const spansOf: (
  entityId: string,
  prefix: string,
  count: number,
) => Array<Span> = (
  entityId: string,
  prefix: string,
  count: number,
): Array<Span> => {
  return Array.from({ length: count }, (_: unknown, index: number): Span => {
    const span: Span = new Span();
    span.traceId = `${prefix}-trace-${index}`;
    span.spanId = `${prefix}-span-${index}`;
    span.parentSpanId = "";
    span.name = `GET /${prefix}`;
    span.primaryEntityId = new ObjectID(entityId);
    span.startTime = new Date(Date.now() - (index + 1) * 60000);
    span.statusCode = index === 0 ? SpanStatus.Error : SpanStatus.Ok;
    span.durationUnixNano = 1_500_000 + index * 1_000;
    return span;
  });
};

beforeEach(() => {
  server = new CappedListServer();
  analyticsQueries = [];
  analyticsRows = [];
  TelemetryEntityNameResolver.clearCache();

  server.add(
    Service,
    namesSortingFirst(SERVICES_BEFORE_WB).map(
      (name: string): Record<string, unknown> => {
        return { _id: ObjectID.generate().toString(), name: name };
      },
    ),
  );
  server.add(Service, [
    { _id: EARLY_ID, name: "AA early reporter" },
    { _id: LATE_ID, name: "WB kiosk api" },
    { _id: OTHER_LATE_ID, name: "WB kiosk web" },
    { _id: ARCHIVED_ID, name: "WB kiosk legacy", isArchived: true },
  ]);
  server.add(RumApplication, [{ _id: RUM_ID, name: "checkout-web" }]);
  server.install();

  getJestSpyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(
    new ObjectID(PROJECT_ID),
  );
  getJestSpyOn(AnalyticsModelAPI, "getList").mockImplementation(
    (async (options: { query: Record<string, unknown> }): Promise<unknown> => {
      analyticsQueries.push(options.query);

      const scope: unknown = options.query["primaryEntityId"];
      const rows: Array<Metric | Span> =
        scope instanceof Includes
          ? analyticsRows.filter((row: Metric | Span): boolean => {
              return scope.values
                .map((value: unknown): string => {
                  return String(value).toLowerCase();
                })
                .includes(String(row.primaryEntityId).toLowerCase());
            })
          : analyticsRows;

      return { data: rows, count: rows.length, skip: 0, limit: 5000 };
    }) as never,
  );

  window.history.replaceState({}, "", "/");
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  window.history.replaceState({}, "", "/");
});

// A link that scopes the tab to these entities, as the Viewer writes it.
const scopedUrl: (ids: Array<string>) => string = (
  ids: Array<string>,
): string => {
  return `/?filters=${encodeURIComponent(
    JSON.stringify(
      ids.map((id: string): [string, string] => {
        return ["primaryEntityId", id];
      }),
    ),
  )}`;
};

type Page = "Metrics" | "Traces";

const PAGES: Array<Page> = ["Metrics", "Traces"];

const scopeTestId: (page: Page) => string = (page: Page): string => {
  return page === "Metrics"
    ? "metrics-insights-service-scope"
    : "traces-insights-service-scope";
};

async function renderPage(page: Page, url: string = "/"): Promise<void> {
  window.history.replaceState({}, "", url);

  await act(async () => {
    render(
      <MemoryRouter>
        {page === "Metrics" ? <MetricsDashboard /> : <TracesDashboard />}
      </MemoryRouter>,
    );
  });
}

// The telemetry each page reads: some of it from the late service.
function seedTelemetry(page: Page): void {
  analyticsRows =
    page === "Metrics"
      ? [
          metricPoint(LATE_ID, "http.server.request.duration"),
          metricPoint(LATE_ID, "kiosk.orders.placed"),
          metricPoint(EARLY_ID, "process.cpu.time"),
          // Sent with no service.name: tagged with the project's id.
          metricPoint(PROJECT_ID, "otelcol_exporter_sent_metric_points"),
        ]
      : [
          ...spansOf(LATE_ID, "kiosk", 3),
          ...spansOf(EARLY_ID, "early", 2),
          ...spansOf(PROJECT_ID, "nameless", 1),
        ];
}

// The page's telemetry read and drawn: its cards, or its health table.
async function waitForLoaded(page: Page): Promise<void> {
  if (page === "Metrics") {
    await screen.findByTestId("metrics-service-cards");
    return;
  }

  await screen.findByText("Service Health");
}

function scopePicker(page: Page): HTMLElement {
  return screen.getByTestId(scopeTestId(page));
}

// The scope's chips, as drawn.
function scopeChips(): Array<string> {
  return screen
    .queryAllByTestId("entity-dropdown-chip-label")
    .map((chip: HTMLElement): string => {
      return chip.textContent || "";
    });
}

async function searchScope(page: Page, text: string): Promise<void> {
  const input: HTMLElement = await waitFor(() => {
    return scopePicker(page);
  });

  await act(async () => {
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: text } });
  });
}

function serviceReads(): Array<CappedListCall> {
  return server.callsFor(Service);
}

function lastScopeQuery(): unknown {
  return analyticsQueries[analyticsQueries.length - 1]?.["primaryEntityId"];
}

function scopeIdsOf(value: unknown): Array<string> {
  return value instanceof Includes
    ? value.values.map((entry: unknown): string => {
        return String(entry).toLowerCase();
      })
    : [];
}

// The ids the URL scopes the tab to.
function urlScopeIds(): Array<string> {
  const filters: string | null = new URLSearchParams(
    window.location.search,
  ).get("filters");

  if (!filters) {
    return [];
  }

  return (JSON.parse(filters) as Array<[string, string | Array<string>]>)
    .filter((tuple: [string, string | Array<string>]): boolean => {
      return tuple[0] === "primaryEntityId";
    })
    .flatMap((tuple: [string, string | Array<string>]): Array<string> => {
      return Array.isArray(tuple[1]) ? tuple[1] : [tuple[1]];
    })
    .map((id: string): string => {
      return id.toLowerCase();
    });
}

describe.each(PAGES)("%s Insights: its service scope", (page: Page) => {
  test("never reads the project's services whole: a page of a search, ids, or one row and the count", async () => {
    seedTelemetry(page);
    await renderPage(page);

    await searchScope(page, "WB kiosk");
    await screen.findByRole("option", { name: /WB kiosk web/ });

    expect(serviceReads().length).toBeGreaterThan(0);

    for (const call of serviceReads()) {
      expect(call.limit).toBeLessThanOrEqual(50);
      expect(call.limit).toBeLessThan(LIMIT_PER_PROJECT);
    }
  });

  test("finds a service past the 10,000th by a search on the server, archived ones marked, and scopes the page to the one picked", async () => {
    seedTelemetry(page);
    await renderPage(page);

    await searchScope(page, "WB kiosk");

    const options: Array<HTMLElement> = await screen.findAllByRole("option", {
      name: /WB kiosk/,
    });

    expect(
      options.map((option: HTMLElement): string => {
        return option.textContent || "";
      }),
    ).toEqual(["WB kiosk api", "WB kiosk legacyArchived", "WB kiosk web"]);
    expect(
      within(options[1]!).getByTestId("entity-dropdown-option-archived-tag"),
    ).toBeInTheDocument();

    const searched: CappedListCall | undefined = serviceReads().find(
      (call: CappedListCall): boolean => {
        return call.query["name"] instanceof Search;
      },
    );

    expect((searched!.query["name"] as Search<string>).toString()).toBe(
      "WB kiosk",
    );
    expect(searched!.limit).toBe(50);
    // Archived services keep collecting telemetry: offered, never left out.
    expect(searched!.query["isArchived"]).toBeUndefined();

    await act(async () => {
      fireEvent.click(options[2]!);
    });

    await waitFor(() => {
      expect(scopeIdsOf(lastScopeQuery())).toEqual([OTHER_LATE_ID]);
    });
    expect(scopeChips()).toEqual(["WB kiosk web"]);
    await waitFor(() => {
      expect(urlScopeIds()).toEqual([OTHER_LATE_ID]);
    });
  });

  test("a scope a link holds past the 10,000th keeps its name, narrows the page, and stays when another service is added", async () => {
    seedTelemetry(page);
    await renderPage(page, scopedUrl([LATE_ID]));

    await waitFor(() => {
      expect(scopeChips()).toEqual(["WB kiosk api"]);
    });

    // Named by its id: one read of the one held, never by its name.
    const heldRead: CappedListCall | undefined = serviceReads().find(
      (call: CappedListCall): boolean => {
        return (
          call.query["_id"] instanceof Includes &&
          scopeIdsOf(call.query["_id"]).includes(LATE_ID) &&
          call.select["isArchived"] === true
        );
      },
    );

    expect(heldRead).toBeDefined();
    expect(scopeIdsOf(analyticsQueries[0]?.["primaryEntityId"])).toEqual([
      LATE_ID,
    ]);

    await searchScope(page, "WB kiosk web");

    const option: HTMLElement = await screen.findByRole("option", {
      name: /WB kiosk web/,
    });

    await act(async () => {
      fireEvent.click(option);
    });

    await waitFor(() => {
      expect(scopeIdsOf(lastScopeQuery())).toEqual([LATE_ID, OTHER_LATE_ID]);
    });
    expect(scopeChips()).toEqual(["WB kiosk api", "WB kiosk web"]);
    await waitFor(() => {
      expect(urlScopeIds()).toEqual([LATE_ID, OTHER_LATE_ID]);
    });
  });

  test("a scope naming a service deleted since reads No longer available, still narrows the page, and is taken out by hand", async () => {
    seedTelemetry(page);
    await renderPage(page, scopedUrl([LATE_ID, DELETED_ID]));

    await waitFor(() => {
      expect(scopeChips()).toEqual(["WB kiosk api", "No longer available"]);
    });

    const chips: Array<HTMLElement> = screen.getAllByTestId(
      "entity-dropdown-chip-label",
    );

    expect(chips[1]!).toHaveAttribute("data-not-found", "true");
    // As the scope was saved: the one gone is not dropped by itself.
    expect(scopeIdsOf(lastScopeQuery())).toEqual([LATE_ID, DELETED_ID]);
    expect(urlScopeIds()).toEqual([LATE_ID, DELETED_ID]);

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Remove No longer available" }),
      );
    });

    await waitFor(() => {
      expect(scopeIdsOf(lastScopeQuery())).toEqual([LATE_ID]);
    });
    await waitFor(() => {
      expect(urlScopeIds()).toEqual([LATE_ID]);
    });
  });

  test("an archived service the scope holds is named and marked Archived", async () => {
    seedTelemetry(page);
    await renderPage(page, scopedUrl([ARCHIVED_ID]));

    await waitFor(() => {
      expect(scopeChips()).toEqual(["WB kiosk legacy"]);
    });
    expect(
      screen.getByTestId("entity-dropdown-archived-tag"),
    ).toBeInTheDocument();
  });

  test("a RUM application handed over from its own tab is named from its own table, never read as gone", async () => {
    seedTelemetry(page);
    await renderPage(page, scopedUrl([RUM_ID]));

    await waitFor(() => {
      expect(scopeChips()).toEqual(["checkout-web"]);
    });
    expect(scopeIdsOf(lastScopeQuery())).toEqual([RUM_ID]);
  });

  test("Unknown Service is offered while the telemetry names it, and named when the scope holds it", async () => {
    seedTelemetry(page);
    await renderPage(page);
    await waitForLoaded(page);

    await searchScope(page, "");

    const first: HTMLElement = (await screen.findAllByRole("option"))[0]!;

    expect(first).toHaveTextContent("Unknown Service");

    await act(async () => {
      fireEvent.click(first);
    });

    await waitFor(() => {
      expect(scopeIdsOf(lastScopeQuery())).toEqual([PROJECT_ID]);
    });
    expect(scopeChips()).toEqual(["Unknown Service"]);

    cleanup();

    await renderPage(page, scopedUrl([PROJECT_ID]));

    await waitFor(() => {
      expect(scopeChips()).toEqual(["Unknown Service"]);
    });
  });

  test("the scope is named before its picker is drawn: never its bare id", async () => {
    seedTelemetry(page);
    await renderPage(page, scopedUrl([LATE_ID]));

    await waitFor(() => {
      expect(scopeChips()).toEqual(["WB kiosk api"]);
    });

    // No chip ever read as the raw id while the held read was in flight.
    expect(screen.queryByText(LATE_ID)).toBeNull();
  });
});

describe("Metrics Insights: the services reporting metrics", () => {
  test("a service past the 10,000th has its card, named by its id, and quiet services are counted against every service", async () => {
    seedTelemetry("Metrics");
    await renderPage("Metrics");

    const cards: HTMLElement = await screen.findByTestId(
      "metrics-service-cards",
    );

    expect(
      within(cards)
        .getAllByTestId("metrics-service-card-name")
        .map((name: HTMLElement): string => {
          return name.textContent || "";
        })
        .sort(),
    ).toEqual(["AA early reporter", "Unknown Service", "WB kiosk api"]);

    // Every service of the project, and the telemetry that named none.
    expect(
      screen.getByText(
        `3 of ${(PROJECT_SERVICES + 1).toLocaleString("en-US")} services`,
      ),
    ).toBeInTheDocument();

    // The cards' services read by the ids the points name, nothing more.
    const byId: CappedListCall | undefined = serviceReads().find(
      (call: CappedListCall): boolean => {
        return call.query["_id"] instanceof Includes;
      },
    );

    expect(scopeIdsOf(byId!.query["_id"]).sort()).toEqual(
      [EARLY_ID, LATE_ID].sort(),
    );
  });

  test("scoped to a service past the 10,000th, its card is there and the scope is the population", async () => {
    seedTelemetry("Metrics");
    await renderPage("Metrics", scopedUrl([LATE_ID, OTHER_LATE_ID]));

    const cards: HTMLElement = await screen.findByTestId(
      "metrics-service-cards",
    );

    expect(
      within(cards)
        .getAllByTestId("metrics-service-card-name")
        .map((name: HTMLElement): string => {
          return name.textContent || "";
        }),
    ).toEqual(["WB kiosk api"]);
    expect(screen.getByText("1 of 2 services")).toBeInTheDocument();
  });
});

describe("Traces Insights: the service health table", () => {
  test("a service past the 10,000th has its row, named by its id", async () => {
    seedTelemetry("Traces");
    await renderPage("Traces");

    const table: HTMLElement = (
      await screen.findByText("Service Health")
    ).closest("div.mb-6") as HTMLElement;

    await waitFor(() => {
      expect(within(table).getByText("WB kiosk api")).toBeInTheDocument();
    });
    expect(within(table).getByText("AA early reporter")).toBeInTheDocument();
    expect(within(table).getByText("Unknown Service")).toBeInTheDocument();

    const byId: CappedListCall | undefined = serviceReads().find(
      (call: CappedListCall): boolean => {
        return call.query["_id"] instanceof Includes;
      },
    );

    expect(scopeIdsOf(byId!.query["_id"]).sort()).toEqual(
      [EARLY_ID, LATE_ID].sort(),
    );
  });

  test("a recent trace of the late service names it", async () => {
    seedTelemetry("Traces");
    await renderPage("Traces");

    const recentErrors: HTMLElement = (
      await screen.findByText("Recent Errors")
    ).closest("div") as HTMLElement;

    expect(recentErrors).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getAllByText("WB kiosk api").length).toBeGreaterThan(1);
    });
  });
});
