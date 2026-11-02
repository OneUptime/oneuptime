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
} from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";
import {
  explanationOnFocus,
  explanationOnHover,
  expectNotNestedInControl,
  infoButtonsFor,
  infoLabels,
} from "./HostTooltipHarness";

/*
 * The Hosts list (Pages/Host/Hosts.tsx) is a ModelTable. It is rendered with
 * the table replaced by a recorder, so the columns the page builds - header
 * tooltip and cell renderer - can be read and run; the recorded columns are
 * then drawn by the shared Table, the way BaseModelTable spreads them, to
 * check the (i) a customer actually hovers.
 *
 * Its metric columns are Status, CPU, Memory and Disk: the host's health
 * by HostHealth's rules with the reason under it, and what the host last
 * reported (kept on its record about once a minute) as bars, with its
 * cores, RAM and fullest mount under them. The accuracy of those words
 * against the ingest code is pinned in HostMetricTooltips.test.ts; the
 * fleet's Needs attention card above the list has a suite of its own.
 */

const GIB: number = 1024 * 1024 * 1024;

const modelTableMock: MockFunction = getJestMockFunction();
const countMock: MockFunction = getJestMockFunction();
// What the page hands useResourceOwners: its facets among them.
const resourceOwnersMock: MockFunction = getJestMockFunction();

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, opts?: { defaultValue?: string }): string => {
          return opts?.defaultValue ?? key;
        },
      };
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      count: (...args: Array<unknown>): unknown => {
        return countMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/Navigation", () => {
  return {
    __esModule: true,
    default: {
      getFirstParam: (): undefined => {
        return undefined;
      },
      navigate: (): void => {},
      isOnThisPage: (): boolean => {
        return false;
      },
    },
  };
});

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: unknown) => {
      modelTableMock(props);
      return <div data-testid="model-table" />;
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/ResourceOwners/useResourceOwners",
  () => {
    const actual: Record<string, unknown> = jest.requireActual(
      "../../../../App/FeatureSet/Dashboard/src/Components/ResourceOwners/useResourceOwners",
    ) as Record<string, unknown>;
    return {
      ...actual,
      __esModule: true,
      default: (options: unknown) => {
        resourceOwnersMock(options);
        return {
          getOwnersForResource: () => {
            return [];
          },
          isLoadingOwners: false,
          onResourcesFetched: () => {},
          filterBar: null,
          mergeFiltersIntoQuery: (query: unknown) => {
            return query;
          },
          facetSaveState: undefined,
          restoreFacetState: () => {},
        };
      },
    };
  },
);

// The fleet's Needs attention card reads a route of its own (its own suite).
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Host/HostFleetAttentionCard",
  () => {
    return {
      __esModule: true,
      default: () => {
        return <div data-testid="host-fleet-attention" />;
      },
    };
  },
);

jest.mock("../../../UI/Components/BulkUpdate/BulkLabelActions", () => {
  return {
    __esModule: true,
    default: () => {
      return { bulkActions: [], modals: null };
    },
  };
});

jest.mock("../../../UI/Components/BulkUpdate/BulkOwnerActions", () => {
  return {
    __esModule: true,
    default: () => {
      return { rowActions: [], bulkActions: [], modals: null };
    },
  };
});

jest.mock("../../../UI/Components/BulkUpdate/BulkArchiveActions", () => {
  return {
    __esModule: true,
    default: () => {
      return {
        archiveRowActions: [],
        unarchiveRowActions: [],
        archiveBulkActions: [],
      };
    },
  };
});

import Hosts from "../../../../App/FeatureSet/Dashboard/src/Pages/Host/Hosts";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import { HOST_METRIC_DESCRIPTIONS } from "../../../../App/FeatureSet/Dashboard/src/Components/MetricDescriptions/HostMetricDescriptions";
import Table from "../../../UI/Components/Table/Table";
import Column from "../../../UI/Components/Table/Types/Column";
import FieldType from "../../../UI/Components/Types/FieldType";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import GenericObject from "../../../Types/GenericObject";

const PAGE_PROPS: PageComponentProps = {} as PageComponentProps;

type CapturedColumn = {
  field: Record<string, unknown>;
  title: string;
  type: FieldType;
  headerTooltip?: string | undefined;
  hideOnMobile?: boolean | undefined;
  getElement?: ((item: unknown) => React.ReactElement) | undefined;
};

async function flush(): Promise<void> {
  for (let i: number = 0; i < 8; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function capturedColumns(): Promise<Array<CapturedColumn>> {
  render(<Hosts {...PAGE_PROPS} />);
  await flush();

  expect(modelTableMock).toHaveBeenCalled();

  const props: { columns: Array<CapturedColumn> } = modelTableMock.mock.calls[
    modelTableMock.mock.calls.length - 1
  ]![0] as { columns: Array<CapturedColumn> };

  cleanup();

  return props.columns;
}

function column(columns: Array<CapturedColumn>, title: string): CapturedColumn {
  const found: Array<CapturedColumn> = columns.filter(
    (c: CapturedColumn): boolean => {
      return c.title === title;
    },
  );

  expect(found).toHaveLength(1);

  return found[0]!;
}

// The recorded columns drawn by the shared Table, keyed as BaseModelTable does.
function renderAsTable(
  columns: Array<CapturedColumn>,
  rows: Array<GenericObject>,
  onSortChanged: () => void = () => {},
): void {
  const tableColumns: Array<Column<GenericObject>> = columns.map(
    (c: CapturedColumn): Column<GenericObject> => {
      return {
        title: c.title,
        type: c.type,
        key: Object.keys(c.field)[0] as keyof GenericObject,
        headerTooltip: c.headerTooltip,
        hideOnMobile: c.hideOnMobile,
        getElement: c.getElement as
          | ((item: GenericObject) => React.ReactElement)
          | undefined,
      };
    },
  );

  render(
    <Table<GenericObject>
      id="hosts-table"
      data={rows}
      columns={tableColumns}
      currentPageNumber={1}
      totalItemsCount={rows.length}
      itemsOnPage={10}
      error=""
      isLoading={false}
      singularLabel="Host"
      pluralLabel="Hosts"
      sortOrder={SortOrder.Ascending}
      sortBy={null}
      onSortChanged={onSortChanged}
      onNavigateToPage={() => {}}
    />,
  );
}

beforeEach(() => {
  jest.useFakeTimers();
  modelTableMock.mockReset();
  countMock.mockReset();
  resourceOwnersMock.mockReset();
  // A project that already has hosts, so the list (not the guide) shows.
  countMock.mockResolvedValue(3);
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

// A host that reported a minute ago: busy, short of memory, its /var full.
function reportingHost(): GenericObject {
  const now: Date = new Date();
  return {
    _id: "h1",
    name: "db-01",
    cpuCores: 4,
    totalMemoryBytes: 8 * GIB,
    otelCollectorStatus: "connected",
    lastSeenAt: new Date(now.getTime() - 60_000),
    readingsUpdatedAt: new Date(now.getTime() - 60_000),
    latestCpuPercent: 42.4,
    latestMemoryPercent: 93,
    latestDiskPercent: 97.2,
    latestDiskMountpoint: "/var",
  };
}

type CapturedFacet = {
  key: string;
  label: string;
  options: Array<{ value: string; label: string }>;
};

async function capturedFacets(): Promise<Array<CapturedFacet>> {
  render(<Hosts {...PAGE_PROPS} />);
  await flush();

  expect(resourceOwnersMock).toHaveBeenCalled();

  const options: { extraFacets: Array<CapturedFacet> } = resourceOwnersMock.mock
    .calls[resourceOwnersMock.mock.calls.length - 1]![0] as {
    extraFacets: Array<CapturedFacet>;
  };

  cleanup();

  return options.extraFacets;
}

describe("the list's filters", () => {
  /*
   * The host's UI review: the Status column says a host's health -
   * Healthy, Degraded, Not reporting - and a filter called Status offered
   * Connected and Disconnected, an answer to another question. It is the
   * Connection filter now, in the words the host's hero uses.
   */
  test("whether OneUptime hears from a host is the Connection filter, not a second Status", async () => {
    const facets: Array<CapturedFacet> = await capturedFacets();
    const connection: CapturedFacet | undefined = facets.find(
      (facet: CapturedFacet): boolean => {
        return facet.key === "otelCollectorStatus";
      },
    );

    expect(connection).toBeDefined();
    expect(connection!.label).toBe("Connection");
    expect(
      connection!.options.map((option: { label: string }): string => {
        return option.label;
      }),
    ).toEqual(["Connected", "Disconnected"]);
    expect(
      facets.filter((facet: CapturedFacet): boolean => {
        return facet.label === "Status";
      }),
    ).toEqual([]);
  });
});

describe("a host's name", () => {
  /*
   * Cut to one line, "Payments database" read "Payments datab..." in
   * German at 1280, where the longer headings leave the name its least
   * width. It wraps onto a second line now, between its words and after
   * its dots and hyphens first, and is whole under the pointer.
   */
  test("wraps onto two lines rather than ending in ...", async () => {
    const columns: Array<CapturedColumn> = await capturedColumns();
    const name: CapturedColumn = column(columns, "Name");

    render(
      <MemoryRouter>
        {name.getElement!({
          _id: "10000000-0000-4000-8000-0000000000a1",
          name: "Payments database",
          hostIdentifier: "db-01.prod.internal",
          osType: "linux",
        })}
      </MemoryRouter>,
    );

    const link: HTMLElement = screen.getByRole("link");
    expect(link).toHaveTextContent("Payments database");
    const line: HTMLElement = link.parentElement as HTMLElement;
    expect(line).toHaveClass("line-clamp-2");
    expect(line).toHaveClass("whitespace-normal");
    expect(line).not.toHaveClass("truncate");
    expect(line).toHaveAttribute("title", "Payments database");
    // The host name under it still ends in "..." where the column does.
    expect(screen.getByTestId("host-identifier")).toHaveClass("truncate");
  });
});

describe("Hosts list columns", () => {
  test("Status, CPU, Memory and Disk carry their header tooltips; names, network, collector and ownership carry none", async () => {
    const columns: Array<CapturedColumn> = await capturedColumns();
    const tooltips: Record<string, string | undefined> = {};

    for (const c of columns) {
      tooltips[c.title] = c.headerTooltip;
    }

    expect(tooltips).toEqual({
      Name: undefined,
      Status: HOST_METRIC_DESCRIPTIONS.hostListStatus,
      CPU: HOST_METRIC_DESCRIPTIONS.hostListCpu,
      Memory: HOST_METRIC_DESCRIPTIONS.hostListMemory,
      Disk: HOST_METRIC_DESCRIPTIONS.hostListDisk,
      "IP Address": undefined,
      Collector: undefined,
      "Last Seen": undefined,
      Labels: undefined,
      Owners: undefined,
    });
  });

  test("Status says the host's health in one word, and why under it", async () => {
    const status: CapturedColumn = column(await capturedColumns(), "Status");

    const unhealthy: ReturnType<typeof render> = render(
      status.getElement!(reportingHost()),
    );
    expect(unhealthy.getByTestId("host-status")).toHaveTextContent("Unhealthy");
    expect(unhealthy.getByTestId("host-status")).toHaveAttribute(
      "data-tone",
      "danger",
    );
    // The most urgent reason first, and how many more there are.
    expect(unhealthy.getByTestId("host-status-reason")).toHaveTextContent(
      "/var 97% full +1 more",
    );
    unhealthy.unmount();

    // Stopped reporting: no stale reason, but when it last reported.
    const silent: ReturnType<typeof render> = render(
      status.getElement!({
        ...reportingHost(),
        otelCollectorStatus: "disconnected",
        lastSeenAt: new Date(Date.now() - 3 * 3600_000),
      }),
    );
    expect(silent.getByTestId("host-status")).toHaveTextContent(
      "Not reporting",
    );
    expect(silent.queryByTestId("host-status-reason")).toBeNull();
    expect(silent.getByTestId("host-status-last-report")).toHaveTextContent(
      "Last reported 3 hours ago",
    );
    silent.unmount();
  });

  test("CPU, Memory and Disk show what the host last reported, coloured where Needs attention draws its lines", async () => {
    const columns: Array<CapturedColumn> = await capturedColumns();
    const host: GenericObject = reportingHost();

    const cpu: ReturnType<typeof render> = render(
      column(columns, "CPU").getElement!(host),
    );
    expect(cpu.getByTestId("host-usage-cpu")).toHaveTextContent("42%4 cores");
    expect(cpu.getByTestId("host-usage-cpu")).toHaveAttribute(
      "data-tone",
      "positive",
    );
    cpu.unmount();

    const memory: ReturnType<typeof render> = render(
      column(columns, "Memory").getElement!(host),
    );
    expect(memory.getByTestId("host-usage-memory")).toHaveTextContent(
      "93%of 8.0 GiB",
    );
    expect(memory.getByTestId("host-usage-memory")).toHaveAttribute(
      "data-tone",
      "warning",
    );
    memory.unmount();

    const disk: ReturnType<typeof render> = render(
      column(columns, "Disk").getElement!(host),
    );
    expect(disk.getByTestId("host-usage-disk")).toHaveAttribute(
      "data-tone",
      "danger",
    );
    expect(disk.getByTestId("host-usage-mount")).toHaveTextContent("/var");
    expect(disk.getByTestId("host-usage-mount")).toHaveAttribute(
      "title",
      "/var",
    );
    disk.unmount();
  });

  test("a host whose readings are old, or that stopped reporting, shows no numbers", async () => {
    const cpu: CapturedColumn = column(await capturedColumns(), "CPU");

    const stale: ReturnType<typeof render> = render(
      cpu.getElement!({
        ...reportingHost(),
        readingsUpdatedAt: new Date(Date.now() - 60 * 60_000),
      }),
    );
    expect(stale.queryByTestId("host-usage-cpu")).toBeNull();
    expect(stale.getByText("—")).toBeInTheDocument();
    stale.unmount();

    const silent: ReturnType<typeof render> = render(
      cpu.getElement!({
        ...reportingHost(),
        otelCollectorStatus: "disconnected",
      }),
    );
    expect(silent.queryByTestId("host-usage-cpu")).toBeNull();
    silent.unmount();
  });

  test("the page asks for the readings the columns show", async () => {
    await capturedColumns();

    const props: { selectMoreFields: Record<string, boolean> } = modelTableMock
      .mock.calls[modelTableMock.mock.calls.length - 1]![0] as {
      selectMoreFields: Record<string, boolean>;
    };

    expect(props.selectMoreFields).toEqual(
      expect.objectContaining({
        cpuCores: true,
        totalMemoryBytes: true,
        latestCpuPercent: true,
        latestMemoryPercent: true,
        latestDiskPercent: true,
        latestDiskMountpoint: true,
        readingsUpdatedAt: true,
        lastSeenAt: true,
      }),
    );
  });
});

describe("the list's (i)s as a customer meets them", () => {
  const METRIC_COLUMNS: Array<string> = ["Status", "CPU", "Memory", "Disk"];

  async function renderList(
    onSortChanged: () => void = () => {},
  ): Promise<void> {
    const columns: Array<CapturedColumn> = (await capturedColumns()).filter(
      (c: CapturedColumn): boolean => {
        // Name and Owners need the router and the owners API; not metrics.
        return METRIC_COLUMNS.includes(c.title);
      },
    );

    renderAsTable(columns, [reportingHost()], onSortChanged);
  }

  test("the header has one (i) for each metric column, named after it", async () => {
    await renderList();

    expect(infoLabels()).toEqual(METRIC_COLUMNS);

    for (const title of METRIC_COLUMNS) {
      const info: HTMLElement = infoButtonsFor(title)[0]!;
      expect(info.closest("thead")).not.toBeNull();
      expectNotNestedInControl(info);
    }
  });

  test.each([
    ["Status", HOST_METRIC_DESCRIPTIONS.hostListStatus],
    ["CPU", HOST_METRIC_DESCRIPTIONS.hostListCpu],
    ["Memory", HOST_METRIC_DESCRIPTIONS.hostListMemory],
    ["Disk", HOST_METRIC_DESCRIPTIONS.hostListDisk],
  ])(
    "hovering or focusing %s's (i) explains it",
    async (title: string, text: string) => {
      await renderList();

      const info: HTMLElement = infoButtonsFor(title)[0]!;

      expect(await explanationOnHover(info)).toBe(text);
      expect(await explanationOnFocus(info)).toBe(text);
    },
  );

  test("asking what a column means does not sort the table", async () => {
    const onSortChanged: MockFunction = getJestMockFunction();

    await renderList(() => {
      onSortChanged();
    });

    const info: HTMLElement = infoButtonsFor("Disk")[0]!;

    fireEvent.click(info);
    fireEvent.keyDown(info, { key: "Enter" });

    expect(onSortChanged).not.toHaveBeenCalled();
    expect(screen.getByTestId("host-usage-disk")).toBeInTheDocument();
  });
});
