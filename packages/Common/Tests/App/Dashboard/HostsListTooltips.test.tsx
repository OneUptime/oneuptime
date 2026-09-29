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
 * The one metric column is Resources: CPU cores and RAM on one line, the
 * process count below, all three read from the host record (Host.cpuCores,
 * Host.totalMemoryBytes, Host.processCount), which ingest refreshes at most
 * about once a minute. The accuracy of those words against the ingest code
 * is pinned in HostMetricTooltips.test.ts.
 */

const GIB: number = 1024 * 1024 * 1024;

const modelTableMock: MockFunction = getJestMockFunction();
const countMock: MockFunction = getJestMockFunction();

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
      default: () => {
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
      return { bulkActions: [], modals: null };
    },
  };
});

jest.mock("../../../UI/Components/BulkUpdate/BulkArchiveActions", () => {
  return {
    __esModule: true,
    default: () => {
      return { archiveBulkActions: [] };
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
  // A project that already has hosts, so the list (not the guide) shows.
  countMock.mockResolvedValue(3);
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

describe("Hosts list columns", () => {
  test("Resources carries its header tooltip; names, network, status and ownership carry none", async () => {
    const columns: Array<CapturedColumn> = await capturedColumns();
    const tooltips: Record<string, string | undefined> = {};

    for (const c of columns) {
      tooltips[c.title] = c.headerTooltip;
    }

    expect(tooltips).toEqual({
      Name: undefined,
      OS: undefined,
      "IP Address": undefined,
      Resources: HOST_METRIC_DESCRIPTIONS.hostListResources,
      Status: undefined,
      "Last Seen": undefined,
      Labels: undefined,
      Owners: undefined,
    });
  });

  test("Resources shows cores and RAM on one line and the process count below, as the text says", async () => {
    const resources: CapturedColumn = column(
      await capturedColumns(),
      "Resources",
    );

    const full: ReturnType<typeof render> = render(
      resources.getElement!({
        cpuCores: 8,
        totalMemoryBytes: 16 * GIB,
        processCount: 312,
      }),
    );
    expect(full.getByText("8 cores · 16 GiB")).toBeInTheDocument();
    expect(full.getByText("312 processes")).toBeInTheDocument();
    full.unmount();

    // Without a process count (no processes scraper) the line is absent.
    const noProcesses: ReturnType<typeof render> = render(
      resources.getElement!({ cpuCores: 1, totalMemoryBytes: 2 * GIB }),
    );
    expect(noProcesses.getByText("1 core · 2.0 GiB")).toBeInTheDocument();
    expect(noProcesses.queryByText(/processes/)).not.toBeInTheDocument();
    noProcesses.unmount();

    const nothing: ReturnType<typeof render> = render(
      resources.getElement!({}),
    );
    expect(nothing.getByText("—")).toBeInTheDocument();
    nothing.unmount();
  });

  test("the column is only the host record's cached fields, which the page asks for", async () => {
    await capturedColumns();

    const props: { selectMoreFields: Record<string, boolean> } = modelTableMock
      .mock.calls[modelTableMock.mock.calls.length - 1]![0] as {
      selectMoreFields: Record<string, boolean>;
    };

    expect(props.selectMoreFields).toEqual(
      expect.objectContaining({
        cpuCores: true,
        totalMemoryBytes: true,
        processCount: true,
      }),
    );
  });
});

describe("the Resources (i) as a customer meets it", () => {
  async function renderList(
    onSortChanged: () => void = () => {},
  ): Promise<void> {
    const columns: Array<CapturedColumn> = (await capturedColumns()).filter(
      (c: CapturedColumn): boolean => {
        // Name and Owners need the router and the owners API; not metrics.
        return c.title === "Resources" || c.title === "Status";
      },
    );

    renderAsTable(
      columns,
      [
        {
          _id: "h1",
          cpuCores: 4,
          totalMemoryBytes: 8 * GIB,
          processCount: 140,
          otelCollectorStatus: "connected",
        },
      ],
      onSortChanged,
    );
  }

  test("the header has exactly one (i), named after the column", async () => {
    await renderList();

    expect(infoLabels()).toEqual(["Resources"]);

    const info: HTMLElement = infoButtonsFor("Resources")[0]!;

    expect(info.closest("thead")).not.toBeNull();
    expectNotNestedInControl(info);
  });

  test("hovering or focusing the (i) explains the three numbers", async () => {
    await renderList();

    const info: HTMLElement = infoButtonsFor("Resources")[0]!;

    expect(await explanationOnHover(info)).toBe(
      HOST_METRIC_DESCRIPTIONS.hostListResources,
    );
    expect(await explanationOnFocus(info)).toBe(
      HOST_METRIC_DESCRIPTIONS.hostListResources,
    );
  });

  test("asking what the column means does not sort the table", async () => {
    const onSortChanged: MockFunction = getJestMockFunction();

    await renderList(() => {
      onSortChanged();
    });

    const info: HTMLElement = infoButtonsFor("Resources")[0]!;

    fireEvent.click(info);
    fireEvent.keyDown(info, { key: "Enter" });

    expect(onSortChanged).not.toHaveBeenCalled();
    expect(screen.getByText("4 cores · 8.0 GiB")).toBeInTheDocument();
    expect(screen.getByText("140 processes")).toBeInTheDocument();
  });
});
