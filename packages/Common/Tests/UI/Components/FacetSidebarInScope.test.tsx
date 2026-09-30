import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import React, { ReactElement } from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Declared before jest.mock but dereferenced inside the factories: ts-jest
 * hoists the jest.mock calls above these initializers. The logs viewer looks
 * its services up on mount; nothing here needs an answer.
 */
const getListMock: MockFunction = getJestMockFunction();
const postMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<any>) => {
        return getListMock(...args);
      },
      getCommonHeaders: () => {
        return {};
      },
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<any>) => {
        return postMock(...args);
      },
      getFriendlyErrorMessage: (error: Error) => {
        return error.message;
      },
      getFriendlyMessage: (error: Error) => {
        return error.message;
      },
    },
  };
});

getListMock.mockImplementation(() => {
  return Promise.resolve({ data: [], count: 0, skip: 0, limit: 0 });
});

postMock.mockImplementation(() => {
  return Promise.resolve({ data: {} });
});

// Imported after the mocks so the components pick them up.
import TelemetryFacetSidebar from "../../../UI/Components/TelemetryViewer/components/TelemetryFacetSidebar";
import TelemetryViewer from "../../../UI/Components/TelemetryViewer/TelemetryViewer";
import { buildResourceFacetConfigs } from "../../../UI/Components/TelemetryViewer/ResourceFacetConfigs";
import {
  ActiveFilter,
  FacetConfig,
  FacetData,
} from "../../../UI/Components/TelemetryViewer/types";
import LogsFacetSidebar from "../../../UI/Components/LogsViewer/components/LogsFacetSidebar";
import LogsViewer from "../../../UI/Components/LogsViewer/LogsViewer";
import { LOGS_VIEWER_TOOLBAR_TEST_ID } from "../../../UI/Components/LogsViewer/components/LogsViewerToolbar";
import TimeRange from "../../../Types/Time/TimeRange";

/*
 * The sidebars of a viewer pinned to one scope list only what is IN that
 * scope. On a PostgreSQL database's Logs tab the sidebar listed thirty
 * services and fifty databases at count 0 — the project's catalog, which
 * the facets endpoint merges into every resource facet — as if the page
 * covered them, and picking one could only empty the list.
 *
 * Rendered for real: the shared sidebar (Traces / Metrics / Exceptions),
 * the logs sidebar, and both viewers, which turn the flag on whenever a
 * locked chip is showing.
 */

// What the facets endpoint answers on a database's Logs tab.
const DATABASE_TAB_FACETS: FacetData = {
  severityText: [{ value: "Information", count: 24 }],
  primaryEntityId: [
    { value: "svc-agent", count: 24, displayName: "kubernetes-agent" },
    { value: "svc-collector", count: 0, displayName: "collector" },
    { value: "svc-fluentbit", count: 0, displayName: "fluentbit-gke" },
  ],
  kubernetesClusterId: [
    { value: "cluster-1", count: 0, displayName: "oneuptime-test" },
  ],
  databaseServerId: [
    { value: "db-this", count: 24, displayName: "PostgreSQL cnpg" },
    { value: "db-clickhouse", count: 0, displayName: "ClickHouse default" },
    { value: "db-redis", count: 0, displayName: "Redis default" },
  ],
};

const DATABASE_CHIP: ActiveFilter = {
  facetKey: "entityKeys",
  value: "database:db-this",
  displayKey: "Database",
  displayValue: "PostgreSQL cnpg",
  readOnly: true,
};

const SERVICE_CONFIG: FacetConfig = {
  key: "primaryEntityId",
  title: "Service",
  priority: 1,
  serverSearchable: true,
};

const SEVERITY_CONFIG: FacetConfig = {
  key: "severityText",
  title: "Severity",
  priority: 0,
};

function configs(): Array<FacetConfig> {
  return [
    SEVERITY_CONFIG,
    SERVICE_CONFIG,
    ...buildResourceFacetConfigs({ basePriority: 2 }),
  ];
}

function footer(): HTMLElement | null {
  return screen.queryByTestId("facet-sidebar-hidden-footer");
}

function sectionFor(title: string): HTMLElement {
  // A section with a selection carries its count in the header's name.
  const header: HTMLElement = screen.getByRole("button", {
    name: new RegExp(`^${title}(\\s*\\d+)?$`),
  });
  return header.parentElement!.parentElement as HTMLElement;
}

function listedIn(title: string): Array<string> {
  const section: HTMLElement = sectionFor(title);
  const names: Array<string> = [];
  for (const name of [
    "kubernetes-agent",
    "collector",
    "fluentbit-gke",
    "oneuptime-test",
    "PostgreSQL cnpg",
    "ClickHouse default",
    "Redis default",
    "Information",
  ]) {
    if (within(section).queryByText(name)) {
      names.push(name);
    }
  }
  return names;
}

afterEach(() => {
  cleanup();
});

describe("the shared sidebar, scoped", () => {
  function sidebar(
    onlyShowValuesInScope: boolean | undefined,
    activeFilters: Array<ActiveFilter> = [],
    facetData: FacetData = DATABASE_TAB_FACETS,
  ): ReactElement {
    return (
      <TelemetryFacetSidebar
        facetData={facetData}
        facetConfigs={configs()}
        isLoading={false}
        activeFilters={activeFilters}
        onIncludeFilter={jest.fn()}
        onExcludeFilter={jest.fn()}
        onlyShowValuesInScope={onlyShowValuesInScope}
      />
    );
  }

  test("lists only values with rows in the scope", () => {
    render(sidebar(true));

    expect(listedIn("Service")).toEqual(["kubernetes-agent"]);
    expect(listedIn("Database")).toEqual(["PostgreSQL cnpg"]);
  });

  test("a resource facet with nothing in scope folds into the footer", () => {
    render(sidebar(true));

    expect(
      screen.queryByRole("button", { name: "Kubernetes Cluster" }),
    ).toBeNull();
    expect(footer()).toHaveTextContent("1 empty filter hidden");
  });

  test("revealed, it says there are none in this time range — not in this project", () => {
    render(sidebar(true));

    fireEvent.click(
      screen.getByRole("button", { name: "Show 1 empty filter" }),
    );

    expect(
      within(sectionFor("Kubernetes Cluster")).getByText(
        "No Kubernetes Clusters in this time range",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("No Kubernetes Clusters in this project"),
    ).toBeNull();
  });

  test("a non-resource facet emptied by the scope stays, with the time-range wording", () => {
    render(
      sidebar(true, [], {
        primaryEntityId: [
          { value: "svc-collector", count: 0, displayName: "collector" },
        ],
      }),
    );

    expect(
      within(sectionFor("Service")).getByText("No values in this time range"),
    ).toBeInTheDocument();
  });

  test("a selected value outside the scope stays, so it can be cleared", () => {
    render(
      sidebar(true, [
        DATABASE_CHIP,
        {
          facetKey: "databaseServerId",
          value: "db-redis",
          displayKey: "Database",
          displayValue: "Redis default",
        },
      ]),
    );

    expect(listedIn("Database")).toEqual(["PostgreSQL cnpg", "Redis default"]);
  });

  test("unscoped, the sidebar lists the whole catalog exactly as before", () => {
    render(sidebar(false));

    expect(listedIn("Service")).toEqual([
      "kubernetes-agent",
      "collector",
      "fluentbit-gke",
    ]);
    expect(listedIn("Database")).toEqual([
      "PostgreSQL cnpg",
      "ClickHouse default",
      "Redis default",
    ]);
    expect(listedIn("Kubernetes Cluster")).toEqual(["oneuptime-test"]);
  });

  test("the flag left out means unscoped", () => {
    render(sidebar(undefined));

    expect(listedIn("Service")).toHaveLength(3);
  });
});

describe("the logs sidebar, scoped", () => {
  function logsSidebar(
    onlyShowValuesInScope: boolean,
    activeFilters: Array<ActiveFilter> = [],
  ): ReactElement {
    return (
      <LogsFacetSidebar
        facetData={DATABASE_TAB_FACETS}
        isLoading={false}
        serviceMap={{}}
        onIncludeFilter={jest.fn()}
        onExcludeFilter={jest.fn()}
        activeFilters={activeFilters}
        onlyShowValuesInScope={onlyShowValuesInScope}
      />
    );
  }

  test("lists only values with rows in the scope", () => {
    render(logsSidebar(true));

    expect(listedIn("Service")).toEqual(["kubernetes-agent"]);
    expect(listedIn("Database")).toEqual(["PostgreSQL cnpg"]);
    expect(listedIn("Severity")).toEqual(["Information"]);
  });

  test("folds the empty resource facet away, with the scoped wording when shown", () => {
    render(logsSidebar(true));

    expect(
      screen.queryByRole("button", { name: "Kubernetes Cluster" }),
    ).toBeNull();
    expect(footer()).toHaveTextContent("1 empty filter hidden");

    fireEvent.click(
      screen.getByRole("button", { name: "Show 1 empty filter" }),
    );

    expect(
      within(sectionFor("Kubernetes Cluster")).getByText(
        "No Kubernetes Clusters in this time range",
      ),
    ).toBeInTheDocument();
  });

  test("keeps a selected value outside the scope", () => {
    render(
      logsSidebar(true, [
        {
          facetKey: "primaryEntityId",
          value: "svc-collector",
          displayKey: "Service",
          displayValue: "collector",
        },
      ]),
    );

    expect(listedIn("Service")).toEqual(["kubernetes-agent", "collector"]);
  });

  test("unscoped, lists the whole catalog exactly as before", () => {
    render(logsSidebar(false));

    expect(listedIn("Service")).toEqual([
      "kubernetes-agent",
      "collector",
      "fluentbit-gke",
    ]);
    expect(listedIn("Kubernetes Cluster")).toEqual(["oneuptime-test"]);
    expect(footer()).toBeNull();
  });
});

describe("the viewers turn it on whenever a locked chip is showing", () => {
  interface Item {
    id: string;
  }

  function telemetryViewer(
    activeFilters: Array<ActiveFilter>,
    onlyShowFacetValuesInScope?: boolean,
  ): ReactElement {
    return (
      <TelemetryViewer<Item>
        items={[]}
        isLoading={false}
        renderRow={(item: Item): ReactElement => {
          return <span>{item.id}</span>;
        }}
        getRowKey={(item: Item): string => {
          return item.id;
        }}
        searchValue=""
        onSearchChange={(): void => {}}
        onSearchSubmit={(): void => {}}
        timeRange={{ range: TimeRange.PAST_ONE_HOUR }}
        onTimeRangeChange={(): void => {}}
        page={1}
        pageSize={50}
        totalCount={0}
        onPageChange={(): void => {}}
        onPageSizeChange={(): void => {}}
        facetData={DATABASE_TAB_FACETS}
        facetConfigs={configs()}
        activeFilters={activeFilters}
        onlyShowFacetValuesInScope={onlyShowFacetValuesInScope}
      />
    );
  }

  test("the telemetry viewer, with a locked chip", () => {
    render(telemetryViewer([DATABASE_CHIP]));

    expect(listedIn("Service")).toEqual(["kubernetes-agent"]);
    expect(listedIn("Database")).toEqual(["PostgreSQL cnpg"]);
  });

  test("the telemetry viewer, with only removable chips, is the main explorer", () => {
    render(
      telemetryViewer([
        {
          facetKey: "severityText",
          value: "Information",
          displayKey: "Severity",
          displayValue: "Information",
        },
      ]),
    );

    expect(listedIn("Service")).toHaveLength(3);
    expect(listedIn("Database")).toHaveLength(3);
  });

  test("a host can still ask for the whole catalog under a scope", () => {
    render(telemetryViewer([DATABASE_CHIP], false));

    expect(listedIn("Service")).toHaveLength(3);
  });

  test("a host can ask for scoped values without a locked chip", () => {
    render(telemetryViewer([], true));

    expect(listedIn("Service")).toEqual(["kubernetes-agent"]);
  });

  async function renderLogsViewer(
    baseActiveFilters: Array<ActiveFilter> | undefined,
  ): Promise<void> {
    render(
      <LogsViewer
        logs={[]}
        isLoading={false}
        filterData={{}}
        onFilterChanged={jest.fn()}
        showFilters={true}
        facetData={DATABASE_TAB_FACETS}
        showFacetSidebar={true}
        viewMode="list"
        onViewModeChange={jest.fn()}
        selectedColumns={["time", "severity", "body"]}
        onSelectedColumnsChange={jest.fn()}
        baseActiveFilters={baseActiveFilters}
      />,
    );

    // The container renders a loader until its service lookup resolves.
    await screen.findByTestId(LOGS_VIEWER_TOOLBAR_TEST_ID);
  }

  test("the logs viewer, on a database's Logs tab", async () => {
    await renderLogsViewer([DATABASE_CHIP]);

    expect(listedIn("Service")).toEqual(["kubernetes-agent"]);
    expect(listedIn("Database")).toEqual(["PostgreSQL cnpg"]);
    // The one chip is on screen, above the list.
    expect(screen.getAllByTestId("locked-filter-chip")).toHaveLength(1);
  });

  test("the logs viewer, on the main Logs page", async () => {
    await renderLogsViewer(undefined);

    expect(listedIn("Service")).toHaveLength(3);
    expect(listedIn("Database")).toHaveLength(3);
    expect(screen.queryByTestId("locked-filter-chip")).toBeNull();
  });
});
