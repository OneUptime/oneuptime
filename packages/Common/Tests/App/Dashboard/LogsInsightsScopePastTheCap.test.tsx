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
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * LOGS > INSIGHTS: "ALL SERVICES AND HOSTS", PAST THE PROJECT'S FIRST
 * RECORDS (#10921).
 *
 * The scope picker offered the window's first 200 services and the first
 * 200 of each kind of resource the logs facets listed, and named them from
 * the project's first 10,000 services by name; the page's source cards and
 * top errors named their services from the same 10,000, and the quiet
 * services were counted against them. A service or a host past them could
 * not be found or picked, one a link scoped the page to read as its bare
 * id, and a service's card lost its name, its colour and its link.
 *
 * The picker is the shared EntityDropdown now, searching the services and
 * the hosts (and every other kind the window's logs list) on the server as
 * it is typed in, each kind named beside each record, archived ones marked;
 * what the scope holds is named by its ids, one gone as "No longer
 * available"; the page's services are read by the ids its logs name, and
 * the project's services are counted with one row. ModelAPI answers from a
 * project faked whole (CappedListServer); the logs API is stood in for.
 */

const histogramMock: MockFunction = getJestMockFunction();
const patternsMock: MockFunction = getJestMockFunction();
const breakdownMock: MockFunction = getJestMockFunction();
const facetsMock: MockFunction = getJestMockFunction();
const correlationMock: MockFunction = getJestMockFunction();

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Logs/LogsInsightsApi",
  () => {
    return {
      __esModule: true,
      fetchInsightsHistogram: (...args: Array<any>) => {
        return histogramMock(...args);
      },
      fetchTopErrorPatterns: (...args: Array<any>) => {
        return patternsMock(...args);
      },
      fetchResourceBreakdown: (...args: Array<any>) => {
        return breakdownMock(...args);
      },
      fetchScopeFacets: (...args: Array<any>) => {
        return facetsMock(...args);
      },
      fetchErrorPatternCorrelation: (...args: Array<any>) => {
        return correlationMock(...args);
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/Utils/UseEventTimeReferenceLines",
  () => {
    return {
      __esModule: true,
      default: () => {
        return { lines: [], markerCount: 0 };
      },
    };
  },
);

import CappedListServer, {
  CappedListCall,
  namesSortingFirst,
} from "./CappedListServer";
import LogsDashboard from "../../../../App/FeatureSet/Dashboard/src/Components/Logs/LogsDashboard";
import {
  LogsInsightsScope,
  ResourceLogBreakdown,
  TopErrorPatternRow,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/LogsInsights";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Host from "../../../Models/DatabaseModels/Host";
import RumApplication from "../../../Models/DatabaseModels/RumApplication";
import Service from "../../../Models/DatabaseModels/Service";
import Includes from "../../../Types/BaseDatabase/Includes";
import MultiSearch from "../../../Types/BaseDatabase/MultiSearch";
import Search from "../../../Types/BaseDatabase/Search";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import ObjectID from "../../../Types/ObjectID";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import ProjectUtil from "../../../UI/Utils/Project";
import TelemetryEntityNameResolver from "../../../UI/Utils/Telemetry/TelemetryEntityNames";
import { getJestSpyOn } from "../../Spy";

configure({ asyncUtilTimeout: 10000 });
jest.setTimeout(60000);

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";
const EARLY_ID: string = "a1000000-0000-4000-8000-000000000001";
const LATE_ID: string = "a1000000-0000-4000-8000-0000000000aa";
const OTHER_LATE_ID: string = "a1000000-0000-4000-8000-0000000000ab";
const ARCHIVED_ID: string = "a1000000-0000-4000-8000-0000000000ac";
const DELETED_ID: string = "a1000000-0000-4000-8000-0000000000dd";
const RUM_ID: string = "a2000000-0000-4000-8000-0000000000aa";
const EARLY_HOST_ID: string = "b1000000-0000-4000-8000-000000000001";
const LATE_HOST_ID: string = "b1000000-0000-4000-8000-0000000000aa";
const ARCHIVED_HOST_ID: string = "b1000000-0000-4000-8000-0000000000ac";
const NAMELESS_HOST_ID: string = "b1000000-0000-4000-8000-0000000000ad";
const DELETED_HOST_ID: string = "b1000000-0000-4000-8000-0000000000dd";

const SERVICES_BEFORE_WB: number = LIMIT_PER_PROJECT + 50;
const HOSTS_BEFORE_WB: number = LIMIT_PER_PROJECT + 50;
// The early ones, the early reporter and the three named "WB kiosk ...".
const PROJECT_SERVICES: number = SERVICES_BEFORE_WB + 1 + 3;

let server: CappedListServer;
// The models whose reads the server refuses: a kind the reader may not read.
let refusedModels: Set<unknown> = new Set<unknown>();

// A row as the server answers a read: its id and the columns selected.
function onlySelected(
  row: BaseModel,
  select: Record<string, unknown>,
): BaseModel {
  const answered: BaseModel = new (row.constructor as { new (): BaseModel })();
  const source: Record<string, unknown> = row as unknown as Record<
    string,
    unknown
  >;
  const target: Record<string, unknown> = answered as unknown as Record<
    string,
    unknown
  >;

  target["_id"] = source["_id"];

  for (const column of Object.keys(select)) {
    if (source[column] !== undefined) {
      target[column] = source[column];
    }
  }

  return answered;
}

beforeEach(() => {
  server = new CappedListServer();
  refusedModels = new Set<unknown>();
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
    { _id: LATE_ID, name: "WB kiosk api", serviceColor: "#22c55e" },
    { _id: OTHER_LATE_ID, name: "WB kiosk web" },
    { _id: ARCHIVED_ID, name: "WB kiosk legacy", isArchived: true },
  ]);
  server.add(
    Host,
    namesSortingFirst(HOSTS_BEFORE_WB, "AH").map(
      (name: string): Record<string, unknown> => {
        return {
          _id: ObjectID.generate().toString(),
          name: name,
          hostIdentifier: `${name.toLowerCase()}.internal`,
        };
      },
    ),
  );
  server.add(Host, [
    { _id: EARLY_HOST_ID, name: "AA edge host", hostIdentifier: "aa-edge" },
    {
      _id: LATE_HOST_ID,
      name: "WB kiosk host",
      hostIdentifier: "kiosk-01.internal",
    },
    {
      _id: ARCHIVED_HOST_ID,
      name: "WB kiosk old host",
      hostIdentifier: "kiosk-00.internal",
      isArchived: true,
    },
    // A host its agent never named: found and named by its identifier.
    { _id: NAMELESS_HOST_ID, name: "", hostIdentifier: "wb-kiosk-edge-7" },
  ]);
  server.add(RumApplication, [{ _id: RUM_ID, name: "checkout-web" }]);
  server.install();

  /*
   * As the list routes answer: only the columns a read selected - an
   * archive switch comes back only when it was asked for - and a refusal
   * for a kind the reader may not read.
   */
  const list: typeof server.list = server.list.bind(server);

  jest.spyOn(server, "list").mockImplementation(((
    options: Parameters<typeof server.list>[0],
  ) => {
    if (refusedModels.has(options.modelType)) {
      throw new Error("You do not have permission to read this.");
    }

    const page: ReturnType<typeof server.list> = list(options);

    return {
      ...page,
      data: page.data.map((row: BaseModel): BaseModel => {
        return onlySelected(
          row,
          (options.select || {}) as Record<string, unknown>,
        );
      }),
    };
  }) as never);

  getJestSpyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(
    new ObjectID(PROJECT_ID),
  );
  /*
   * A member who reads the project's services and hosts reads their archive
   * switch too (its read permissions are the tables'); one test takes it
   * away.
   */
  getJestSpyOn(PermissionGate, "canReadColumn").mockReturnValue(true);

  for (const mock of [
    histogramMock,
    patternsMock,
    breakdownMock,
    facetsMock,
    correlationMock,
  ]) {
    mock.mockReset();
  }

  histogramMock.mockImplementation(async () => {
    return [
      { time: "2026-11-24 11:10:00", severity: "Error", count: 8 },
      { time: "2026-11-24 11:10:00", severity: "Information", count: 40 },
    ];
  });
  patternsMock.mockImplementation(
    async (): Promise<Array<TopErrorPatternRow>> => {
      return [
        {
          pattern: "kiosk payment declined <num>",
          sampleBody: "kiosk payment declined 402",
          count: 8,
          firstSeenAt: new Date("2026-11-24T11:10:05.000Z"),
          lastSeenAt: new Date("2026-11-24T11:11:30.000Z"),
          resourceCount: 1,
          resourceIds: [LATE_ID],
          severities: ["Error"],
          traceCount: 0,
          sampleTraceIds: [],
        },
      ];
    },
  );
  breakdownMock.mockImplementation(
    async (): Promise<Array<ResourceLogBreakdown>> => {
      return [
        { resourceId: LATE_ID, total: 30, errorCount: 8, warnCount: 0 },
        { resourceId: EARLY_ID, total: 10, errorCount: 0, warnCount: 1 },
        { resourceId: LATE_HOST_ID, total: 6, errorCount: 0, warnCount: 0 },
        // Logs that named no service: tagged with the project's id.
        { resourceId: PROJECT_ID, total: 2, errorCount: 0, warnCount: 0 },
      ];
    },
  );
  // The window's facets: services, and hosts - so hosts are searched too.
  facetsMock.mockImplementation(async () => {
    return {
      primaryEntityId: [
        {
          facetKey: "primaryEntityId",
          value: EARLY_ID,
          displayName: "AA early reporter",
          count: 10,
        },
      ],
      hostId: [
        {
          facetKey: "hostId",
          value: EARLY_HOST_ID,
          displayName: "AA edge host",
          count: 6,
        },
      ],
    };
  });
  correlationMock.mockImplementation(async () => {
    return null;
  });

  window.history.replaceState({}, "", "/");
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  window.history.replaceState({}, "", "/");
});

const SCOPE_TEST_ID: string = "logs-insights-scope";

// A link that scopes the tab, as the Logs Viewer writes it.
function scopedUrl(tuples: Array<[string, string]>): string {
  return `/?filters=${encodeURIComponent(JSON.stringify(tuples))}`;
}

async function renderPage(url: string = "/"): Promise<void> {
  window.history.replaceState({}, "", url);

  await act(async () => {
    render(
      <MemoryRouter>
        <LogsDashboard />
      </MemoryRouter>,
    );
  });
}

// The page's sources drawn: its cards.
async function waitForLoaded(): Promise<void> {
  await screen.findByText("Sources reporting logs");
}

function scopePicker(): HTMLElement {
  return screen.getByTestId(SCOPE_TEST_ID);
}

function scopeChips(): Array<string> {
  return screen
    .queryAllByTestId("entity-dropdown-chip-label")
    .map((chip: HTMLElement): string => {
      return chip.textContent || "";
    });
}

async function searchScope(text: string): Promise<void> {
  const input: HTMLElement = await waitFor(() => {
    return scopePicker();
  });

  await act(async () => {
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: text } });
  });
}

function optionTexts(): Array<string> {
  return screen.queryAllByRole("option").map((option: HTMLElement): string => {
    return option.textContent || "";
  });
}

function lastScope(): LogsInsightsScope {
  const calls: Array<Array<unknown>> = breakdownMock.mock.calls;

  return calls[calls.length - 1]![0] as LogsInsightsScope;
}

function lower(values: Array<string> | undefined): Array<string> {
  return (values || []).map((value: string): string => {
    return value.toLowerCase();
  });
}

// The scope the URL holds, as the Viewer reads it back.
function urlTuples(): Array<[string, string]> {
  const filters: string | null = new URLSearchParams(
    window.location.search,
  ).get("filters");

  if (!filters) {
    return [];
  }

  return (JSON.parse(filters) as Array<[string, string | Array<string>]>)
    .flatMap((tuple: [string, string | Array<string>]) => {
      const values: Array<string> = Array.isArray(tuple[1])
        ? tuple[1]
        : [tuple[1]];

      return values.map((value: string): [string, string] => {
        return [tuple[0], value.toLowerCase()];
      });
    })
    .sort();
}

describe("Logs Insights: its scope picker", () => {
  test("never reads the project's services or hosts whole: a page of a search, ids, or one row and the count", async () => {
    await renderPage();
    await waitForLoaded();

    await searchScope("WB kiosk");
    await screen.findByRole("option", { name: /WB kiosk web/ });

    expect(server.callsFor(Service).length).toBeGreaterThan(0);
    expect(server.callsFor(Host).length).toBeGreaterThan(0);

    for (const call of [
      ...server.callsFor(Service),
      ...server.callsFor(Host),
    ]) {
      expect(call.limit).toBeLessThanOrEqual(500);
      expect(call.limit).toBeLessThan(LIMIT_PER_PROJECT);
    }
  });

  test("finds services and hosts past the 10,000th by one search on the server, each kind beside its name, archived ones marked", async () => {
    await renderPage();
    await waitForLoaded();

    await searchScope("kiosk");

    await waitFor(() => {
      expect(optionTexts()).toEqual([
        "WB kiosk apiService",
        "WB kiosk legacyArchivedService",
        "WB kiosk webService",
        // Found by its identifier, and named by it: it has no name.
        "wb-kiosk-edge-7Host",
        "WB kiosk hostHost",
        "WB kiosk old hostArchivedHost",
      ]);
    });

    expect(
      within(
        screen.getByRole("option", { name: /WB kiosk legacy/ }),
      ).getByTestId("entity-dropdown-option-archived-tag"),
    ).toBeInTheDocument();
    expect(
      within(
        screen.getByRole("option", { name: /WB kiosk old host/ }),
      ).getByTestId("entity-dropdown-option-archived-tag"),
    ).toBeInTheDocument();

    // Each kind searched on the server, a page of each, archived kept.
    const serviceSearch: CappedListCall | undefined = server
      .callsFor(Service)
      .find((call: CappedListCall): boolean => {
        return call.query["name"] instanceof Search;
      });

    expect((serviceSearch!.query["name"] as Search<string>).toString()).toBe(
      "kiosk",
    );
    expect(serviceSearch!.limit).toBe(50);
    expect(serviceSearch!.query["isArchived"]).toBeUndefined();
    expect(serviceSearch!.select["isArchived"]).toBe(true);

    const hostSearch: CappedListCall | undefined = server
      .callsFor(Host)
      .find((call: CappedListCall): boolean => {
        return Object.values(call.query).some((value: unknown): boolean => {
          return value instanceof MultiSearch;
        });
      });
    const multiSearch: MultiSearch = Object.values(hostSearch!.query).find(
      (value: unknown): boolean => {
        return value instanceof MultiSearch;
      },
    ) as MultiSearch;

    // A host is found by its name or by its identifier, as the sidebars find it.
    expect(multiSearch.fields).toEqual(["name", "hostIdentifier"]);
    expect(multiSearch.value).toBe("kiosk");
    expect(hostSearch!.limit).toBe(50);
    expect(hostSearch!.select["isArchived"]).toBe(true);
    expect(hostSearch!.query["isArchived"]).toBeUndefined();
  });

  test("a host is found by its identifier alone", async () => {
    await renderPage();
    await waitForLoaded();

    await searchScope("kiosk-01");

    await waitFor(() => {
      expect(optionTexts()).toEqual(["WB kiosk hostHost"]);
    });
  });

  test("picking a service past the 10,000th scopes the page to it, and the URL holds it for the Viewer", async () => {
    await renderPage();
    await waitForLoaded();

    await searchScope("WB kiosk web");

    const option: HTMLElement = await screen.findByRole("option", {
      name: /WB kiosk web/,
    });

    await act(async () => {
      fireEvent.click(option);
    });

    await waitFor(() => {
      expect(lower(lastScope().serviceIds)).toEqual([OTHER_LATE_ID]);
    });
    expect(lastScope().resourceFilters).toBeUndefined();
    expect(scopeChips()).toEqual(["WB kiosk web"]);
    await waitFor(() => {
      expect(urlTuples()).toEqual([["primaryEntityId", OTHER_LATE_ID]]);
    });
  });

  test("picking a host past the 10,000th scopes the page by the host, never as a service", async () => {
    await renderPage();
    await waitForLoaded();

    await searchScope("WB kiosk host");

    const option: HTMLElement = await screen.findByRole("option", {
      name: /^WB kiosk host/,
    });

    await act(async () => {
      fireEvent.click(option);
    });

    await waitFor(() => {
      expect(
        lower(
          (lastScope().resourceFilters as Record<string, Array<string>>)?.[
            "hostId"
          ],
        ),
      ).toEqual([LATE_HOST_ID]);
    });
    expect(lastScope().serviceIds).toBeUndefined();
    expect(scopeChips()).toEqual(["WB kiosk host"]);
    await waitFor(() => {
      expect(urlTuples()).toEqual([["hostId", LATE_HOST_ID]]);
    });
  });

  test("a scope a link holds past the 10,000th - a service and a host - keeps their names, narrows the page, and stays when another is added", async () => {
    await renderPage(
      scopedUrl([
        ["primaryEntityId", LATE_ID],
        ["hostId", LATE_HOST_ID],
      ]),
    );

    await waitFor(() => {
      expect(scopeChips()).toEqual(["WB kiosk api", "WB kiosk host"]);
    });

    // Each named by its id: one read of each, never by name.
    const heldService: CappedListCall | undefined = server
      .callsFor(Service)
      .find((call: CappedListCall): boolean => {
        return (
          call.query["_id"] instanceof Includes &&
          lower((call.query["_id"] as Includes).values.map(String)).includes(
            LATE_ID,
          )
        );
      });
    const heldHost: CappedListCall | undefined = server
      .callsFor(Host)
      .find((call: CappedListCall): boolean => {
        return (
          call.query["_id"] instanceof Includes &&
          lower((call.query["_id"] as Includes).values.map(String)).includes(
            LATE_HOST_ID,
          )
        );
      });

    expect(heldService).toBeDefined();
    expect(heldHost).toBeDefined();
    expect(heldHost!.select["isArchived"]).toBe(true);

    expect(lower(breakdownMock.mock.calls[0]![0]!.serviceIds)).toEqual([
      LATE_ID,
    ]);

    await searchScope("WB kiosk web");

    const option: HTMLElement = await screen.findByRole("option", {
      name: /WB kiosk web/,
    });

    await act(async () => {
      fireEvent.click(option);
    });

    await waitFor(() => {
      expect(lower(lastScope().serviceIds)).toEqual([LATE_ID, OTHER_LATE_ID]);
    });
    expect(
      lower(
        (lastScope().resourceFilters as Record<string, Array<string>>)[
          "hostId"
        ],
      ),
    ).toEqual([LATE_HOST_ID]);
    expect(scopeChips()).toEqual([
      "WB kiosk api",
      "WB kiosk host",
      "WB kiosk web",
    ]);
    await waitFor(() => {
      expect(urlTuples()).toEqual(
        [
          ["hostId", LATE_HOST_ID],
          ["primaryEntityId", LATE_ID],
          ["primaryEntityId", OTHER_LATE_ID],
        ].sort() as Array<[string, string]>,
      );
    });
  });

  test("a scope naming a service and a host deleted since reads No longer available for each, still narrows the page, and is taken out by hand", async () => {
    await renderPage(
      scopedUrl([
        ["primaryEntityId", LATE_ID],
        ["primaryEntityId", DELETED_ID],
        ["hostId", DELETED_HOST_ID],
      ]),
    );

    await waitFor(() => {
      expect(scopeChips()).toEqual([
        "WB kiosk api",
        "No longer available",
        "No longer available",
      ]);
    });

    for (const chip of screen
      .getAllByTestId("entity-dropdown-chip-label")
      .slice(1)) {
      expect(chip).toHaveAttribute("data-not-found", "true");
    }

    // As the scope was saved: the ones gone are not dropped by themselves.
    expect(lower(lastScope().serviceIds)).toEqual([LATE_ID, DELETED_ID]);
    expect(
      lower(
        (lastScope().resourceFilters as Record<string, Array<string>>)[
          "hostId"
        ],
      ),
    ).toEqual([DELETED_HOST_ID]);

    await act(async () => {
      fireEvent.click(
        screen.getAllByRole("button", {
          name: "Remove No longer available",
        })[0]!,
      );
    });

    await waitFor(() => {
      expect(lower(lastScope().serviceIds)).toEqual([LATE_ID]);
    });

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Remove No longer available" }),
      );
    });

    await waitFor(() => {
      expect(lastScope().resourceFilters).toBeUndefined();
    });
    await waitFor(() => {
      expect(urlTuples()).toEqual([["primaryEntityId", LATE_ID]]);
    });
  });

  test("an archived service and an archived host the scope holds are named and marked Archived", async () => {
    await renderPage(
      scopedUrl([
        ["primaryEntityId", ARCHIVED_ID],
        ["hostId", ARCHIVED_HOST_ID],
      ]),
    );

    await waitFor(() => {
      expect(scopeChips()).toEqual(["WB kiosk legacy", "WB kiosk old host"]);
    });
    expect(screen.getAllByTestId("entity-dropdown-archived-tag")).toHaveLength(
      2,
    );
  });

  test("a RUM application the logs name as their own is named from its own table, never read as gone", async () => {
    await renderPage(scopedUrl([["primaryEntityId", RUM_ID]]));

    await waitFor(() => {
      expect(scopeChips()).toEqual(["checkout-web"]);
    });
    expect(lower(lastScope().serviceIds)).toEqual([RUM_ID]);
  });

  test("Unknown Service is offered while the window's logs name it, and named when the scope holds it", async () => {
    await renderPage();
    await waitForLoaded();

    await searchScope("");

    const first: HTMLElement = (await screen.findAllByRole("option"))[0]!;

    expect(first).toHaveTextContent("Unknown Service");

    await act(async () => {
      fireEvent.click(first);
    });

    await waitFor(() => {
      expect(lower(lastScope().serviceIds)).toEqual([PROJECT_ID]);
    });
    expect(scopeChips()).toEqual(["Unknown Service"]);

    cleanup();

    await renderPage(scopedUrl([["primaryEntityId", PROJECT_ID]]));

    await waitFor(() => {
      expect(scopeChips()).toEqual(["Unknown Service"]);
    });
  });

  test("with nothing typed, both kinds have their share of the list, however many services the project has", async () => {
    await renderPage();
    await waitForLoaded();

    await searchScope("");

    await waitFor(() => {
      const texts: Array<string> = optionTexts();

      expect(
        texts.some((text: string): boolean => {
          return text.endsWith("Host");
        }),
      ).toBe(true);
      expect(
        texts.some((text: string): boolean => {
          return text.endsWith("Service") && text !== "Unknown Service";
        }),
      ).toBe(true);
    });

    const services: number = optionTexts().filter((text: string): boolean => {
      return text.endsWith("Service") && !text.startsWith("Unknown");
    }).length;
    const hosts: number = optionTexts().filter((text: string): boolean => {
      return text.endsWith("Host");
    }).length;

    // A page of 50: half each, services listed before hosts.
    expect(services).toBe(25);
    expect(hosts).toBe(25);
  });

  test("hosts are searched only while the window's logs list them: a project with none searches its services alone", async () => {
    facetsMock.mockImplementation(async () => {
      return { primaryEntityId: [], hostId: [] };
    });

    await renderPage();
    await waitForLoaded();

    await searchScope("WB kiosk");

    await waitFor(() => {
      expect(optionTexts()).toEqual([
        "WB kiosk apiService",
        "WB kiosk legacyArchivedService",
        "WB kiosk webService",
      ]);
    });
    /*
     * No host is searched: the only reads of hosts are by id - the
     * resolver naming the host card the page draws.
     */
    for (const call of server.callsFor(Host)) {
      expect(call.query["_id"]).toBeInstanceOf(Includes);
    }
  });

  test("a reader who may not read a kind's archive switch is never asked for it: its records are still found and named, unmarked", async () => {
    jest.mocked(PermissionGate.canReadColumn).mockImplementation(((
      model: unknown,
      column: string,
    ): boolean => {
      return !(model instanceof Host && column === "isArchived");
    }) as never);

    await renderPage(scopedUrl([["hostId", LATE_HOST_ID]]));

    await waitFor(() => {
      expect(scopeChips()).toEqual(["WB kiosk host"]);
    });

    await searchScope("kiosk");

    // The host the scope holds is picked already: the others, unmarked.
    await waitFor(() => {
      expect(
        optionTexts().filter((text: string): boolean => {
          return text.endsWith("Host");
        }),
      ).toEqual(["wb-kiosk-edge-7Host", "WB kiosk old hostHost"]);
    });

    // The server refuses a whole read that selects a column it may not read.
    for (const call of server.callsFor(Host)) {
      expect(call.select["isArchived"]).toBeUndefined();
    }
  });

  test("a kind the reader may not read finds nothing, and the services are still offered", async () => {
    refusedModels.add(Host);

    await renderPage();
    await waitForLoaded();

    await searchScope("WB kiosk");

    await waitFor(() => {
      expect(optionTexts()).toEqual([
        "WB kiosk apiService",
        "WB kiosk legacyArchivedService",
        "WB kiosk webService",
      ]);
    });
  });

  test("the scope is named before its picker is drawn: never its bare ids", async () => {
    await renderPage(
      scopedUrl([
        ["primaryEntityId", LATE_ID],
        ["hostId", LATE_HOST_ID],
      ]),
    );

    await waitFor(() => {
      expect(scopeChips()).toEqual(["WB kiosk api", "WB kiosk host"]);
    });

    expect(screen.queryByText(LATE_ID)).toBeNull();
    expect(screen.queryByText(`hostId:${LATE_HOST_ID}`)).toBeNull();
  });
});

describe("Logs Insights: the sources reporting logs", () => {
  test("a service past the 10,000th has its card - named, linked - read by its id, and quiet services are counted against every service", async () => {
    await renderPage();
    await waitForLoaded();

    const card: HTMLElement = (await screen.findAllByText("WB kiosk api"))
      .map((element: HTMLElement): HTMLElement | null => {
        return element.closest("a");
      })
      .find((link: HTMLElement | null): boolean => {
        return Boolean(link);
      })!;

    // A service's card links to its logs.
    expect(card.getAttribute("href")).toContain(LATE_ID);

    /*
     * Two services report (the late one and the early one) of every
     * service the project has, counted with one row: the host and the
     * logs that named no service are not services.
     */
    expect(screen.getByText("Quiet services")).toBeInTheDocument();
    expect(
      screen.getByText((PROJECT_SERVICES - 2).toLocaleString("en-US"), {
        selector: "p",
      }),
    ).toBeInTheDocument();

    // The page's services read by the ids its logs name, nothing more.
    const byId: Array<CappedListCall> = server
      .callsFor(Service)
      .filter((call: CappedListCall): boolean => {
        return call.query["_id"] instanceof Includes;
      });

    expect(
      lower((byId[0]!.query["_id"] as Includes).values.map(String)).sort(),
    ).toEqual([EARLY_ID, LATE_HOST_ID, LATE_ID].sort());

    // The project's services, counted: one row and the count.
    const counted: CappedListCall | undefined = server
      .callsFor(Service)
      .find((call: CappedListCall): boolean => {
        return call.limit === 1;
      });

    expect(counted).toBeDefined();
    expect(Object.keys(counted!.select)).toEqual(["_id"]);
  });

  test("a top error of a service past the 10,000th names it", async () => {
    await renderPage();
    await waitForLoaded();

    await screen.findByText("kiosk payment declined 402", {
      selector: "p, span, div",
    });

    await waitFor(() => {
      expect(screen.getAllByText(/WB kiosk api/).length).toBeGreaterThan(1);
    });
  });

  test("a host's card is named by its own table, its kind beside it", async () => {
    await renderPage();
    await waitForLoaded();

    await waitFor(() => {
      expect(screen.getByText("WB kiosk host")).toBeInTheDocument();
    });
  });
});
