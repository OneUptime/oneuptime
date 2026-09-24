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
  RenderResult,
  screen,
} from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The Docker Swarm Clusters list (Pages/DockerSwarm/Clusters.tsx) is a
 * ModelTable. It is rendered with the table replaced by a recorder, so the
 * columns the page builds - header tooltip and cell renderer - can be read
 * and run; the recorded count columns are then drawn by the shared Table,
 * the way BaseModelTable spreads them, to check the (i) a customer hovers.
 *
 * Nodes, Services and Tasks read the counts cached on the cluster row
 * (nodeCount / readyNodeCount, serviceCount, taskCount / runningTaskCount),
 * which ingest rewrites from each inventory snapshot. The accuracy of the
 * words against the ingest code is pinned in DockerSwarmMetricTooltips.test.ts.
 */

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

import DockerSwarmClusters from "../../../../App/FeatureSet/Dashboard/src/Pages/DockerSwarm/Clusters";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import { DOCKER_SWARM_METRIC_DESCRIPTIONS } from "../../../../App/FeatureSet/Dashboard/src/Components/MetricDescriptions/DockerSwarmMetricDescriptions";
import Table from "../../../UI/Components/Table/Table";
import Column from "../../../UI/Components/Table/Types/Column";
import FieldType from "../../../UI/Components/Types/FieldType";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import GenericObject from "../../../Types/GenericObject";

const T: typeof DOCKER_SWARM_METRIC_DESCRIPTIONS =
  DOCKER_SWARM_METRIC_DESCRIPTIONS;

const PAGE_PROPS: PageComponentProps = {} as PageComponentProps;

const COUNT_COLUMNS: Array<[string, string]> = [
  ["Nodes", T.clusterListNodes],
  ["Services", T.clusterListServices],
  ["Tasks", T.clusterListTasks],
];

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
  render(<DockerSwarmClusters {...PAGE_PROPS} />);
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

function cellText(
  columnDef: CapturedColumn,
  item: Record<string, unknown>,
): { text: string; className: string } {
  const result: RenderResult = render(columnDef.getElement!(item));
  const root: HTMLElement = result.container.firstElementChild as HTMLElement;
  const out: { text: string; className: string } = {
    text: (root.textContent || "").trim(),
    className: root.className,
  };

  result.unmount();

  return out;
}

async function hover(trigger: HTMLElement): Promise<void> {
  fireEvent.mouseEnter(trigger);
  await act(async () => {
    jest.advanceTimersByTime(200);
  });
}

beforeEach(() => {
  jest.useFakeTimers();
  modelTableMock.mockReset();
  countMock.mockReset();
  // A project that already has a cluster, so the list (not the guide) shows.
  countMock.mockResolvedValue(1);
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

describe("Docker Swarm Clusters list columns", () => {
  test("Nodes, Services and Tasks carry their header tooltips; the rest carry none", async () => {
    const tooltips: Record<string, string | undefined> = {};

    for (const c of await capturedColumns()) {
      tooltips[c.title] = c.headerTooltip;
    }

    expect(tooltips).toEqual({
      Name: undefined,
      Status: undefined,
      Nodes: T.clusterListNodes,
      Services: T.clusterListServices,
      Tasks: T.clusterListTasks,
      "Docker Version": undefined,
      "Last Seen": undefined,
      Labels: undefined,
      Owners: undefined,
    });
  });

  test.each(COUNT_COLUMNS)(
    "%s reads the counts cached on the cluster row",
    async (title: string) => {
      const fields: Record<string, Array<string>> = {
        Nodes: ["nodeCount", "readyNodeCount"],
        Services: ["serviceCount"],
        Tasks: ["taskCount", "runningTaskCount"],
      };

      expect(
        Object.keys(column(await capturedColumns(), title).field).sort(),
      ).toEqual([...fields[title]!].sort());
    },
  );

  test("Nodes is ready out of total, and red unless every node is ready, as its text says", async () => {
    const nodes: CapturedColumn = column(await capturedColumns(), "Nodes");

    const allReady: { text: string; className: string } = cellText(nodes, {
      nodeCount: 3,
      readyNodeCount: 3,
    });
    expect(allReady.text).toBe("3/3 ready");
    expect(allReady.className).not.toContain("text-red-700");

    const oneDown: { text: string; className: string } = cellText(nodes, {
      nodeCount: 3,
      readyNodeCount: 2,
    });
    expect(oneDown.text).toBe("2/3 ready");
    expect(oneDown.className).toContain("text-red-700");

    expect(cellText(nodes, {}).text).toBe("—");
    expect(T.clusterListNodes).toContain("shown as ready out of total");
    expect(T.clusterListNodes).toContain(
      "turns red when any node is not ready",
    );
  });

  test("Services is the plain count, whatever the services' state", async () => {
    const services: CapturedColumn = column(
      await capturedColumns(),
      "Services",
    );

    expect(cellText(services, { serviceCount: 7 }).text).toBe("7");
    expect(cellText(services, {}).text).toBe("0");
  });

  test("Tasks is running out of the tasks Swarm wants running", async () => {
    const tasks: CapturedColumn = column(await capturedColumns(), "Tasks");

    expect(cellText(tasks, { taskCount: 12, runningTaskCount: 10 }).text).toBe(
      "10/12 running",
    );
    expect(cellText(tasks, {}).text).toBe("—");
    expect(T.clusterListTasks).toContain(
      "shown as how many are actually running out of that total",
    );
  });
});

describe("the count (i)s as a customer meets them", () => {
  async function renderCounts(onSortChanged: () => void): Promise<void> {
    const columns: Array<CapturedColumn> = (await capturedColumns()).filter(
      (c: CapturedColumn): boolean => {
        return COUNT_COLUMNS.some((entry: [string, string]): boolean => {
          return entry[0] === c.title;
        });
      },
    );
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
    const rows: Array<GenericObject> = [
      {
        _id: "c1",
        nodeCount: 3,
        readyNodeCount: 2,
        serviceCount: 7,
        taskCount: 12,
        runningTaskCount: 10,
      },
    ];

    render(
      <Table<GenericObject>
        id="docker-swarm-clusters-table"
        data={rows}
        columns={tableColumns}
        currentPageNumber={1}
        totalItemsCount={rows.length}
        itemsOnPage={10}
        error=""
        isLoading={false}
        singularLabel="Cluster"
        pluralLabel="Clusters"
        sortOrder={SortOrder.Ascending}
        sortBy={null}
        onSortChanged={onSortChanged}
        onNavigateToPage={() => {}}
      />,
    );
  }

  test.each(COUNT_COLUMNS)(
    "hovering the %s (i) explains the count",
    async (title: string, text: string) => {
      await renderCounts(() => {});

      const info: HTMLElement = screen.getByRole("button", {
        name: `About ${title}`,
      });

      expect(info.closest("thead")).not.toBeNull();
      expect(info.parentElement!.closest("button, a")).toBeNull();

      await hover(info);
      expect(screen.getByRole("tooltip")).toHaveTextContent(text);
    },
  );

  test("asking what a count means does not sort the list", async () => {
    const onSortChanged: MockFunction = getJestMockFunction();

    await renderCounts(() => {
      onSortChanged();
    });

    for (const [title] of COUNT_COLUMNS) {
      const info: HTMLElement = screen.getByRole("button", {
        name: `About ${title}`,
      });

      fireEvent.click(info);
      fireEvent.keyDown(info, { key: "Enter" });
    }

    expect(onSortChanged).not.toHaveBeenCalled();
    expect(screen.getByText("2/3 ready")).toBeInTheDocument();
    expect(screen.getByText("10/12 running")).toBeInTheDocument();
  });
});
