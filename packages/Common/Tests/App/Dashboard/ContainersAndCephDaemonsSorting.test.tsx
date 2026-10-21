import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { settle } from "./HostTooltipHarness";
import {
  clickCardRefresh,
  columnTexts,
  nextPage,
  numberedNames,
  pagingSummary,
} from "./TablePagingHarness";

/*
 * The Docker and Podman Containers lists and the Ceph Daemons list, rendered
 * for real with their data layer mocked. Each reads its whole list in one
 * fetch, so it sorts its own rows: the shared table header only reports
 * which column was clicked.
 *
 * All three used to drop that report. Every titled column still rendered as
 * a sort button announcing itself as sortable (aria-sort="none"), and a
 * click on CPU, Memory, Status or Host did nothing at all. Each column now
 * sorts by the value behind its cell - a reading, not the text it is
 * formatted as - with a missing value last whichever way it is sorted, and
 * the header says which column the rows are in order of.
 */

const MODEL_ID: string = "0193c0de-4444-4aaa-8bbb-000000000004";

const getItemMock: MockFunction = getJestMockFunction();
const modelGetListMock: MockFunction = getJestMockFunction();
const analyticsGetListMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>) => {
        return getItemMock(...args);
      },
      getList: (...args: Array<unknown>) => {
        return modelGetListMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>) => {
        return analyticsGetListMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      getFriendlyMessage: (error: unknown) => {
        return String((error as Error)?.message || error);
      },
    },
  };
});

jest.mock("../../../UI/Utils/Navigation", () => {
  return {
    __esModule: true,
    default: {
      getLastParamAsObjectID: () => {
        const { default: ObjectIDType } = jest.requireActual(
          "../../../Types/ObjectID",
        ) as { default: new (id: string) => unknown };
        return new ObjectIDType("0193c0de-4444-4aaa-8bbb-000000000004");
      },
      navigate: () => {},
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: () => {
        const { default: ObjectIDType } = jest.requireActual(
          "../../../Types/ObjectID",
        ) as { default: new (id: string) => unknown };
        return new ObjectIDType("10000000-0000-4000-8000-000000000001");
      },
    },
  };
});

import DockerHostContainers from "../../../../App/FeatureSet/Dashboard/src/Pages/Docker/View/Containers";
import PodmanHostContainers from "../../../../App/FeatureSet/Dashboard/src/Pages/Podman/View/Containers";
import CephClusterDaemons from "../../../../App/FeatureSet/Dashboard/src/Pages/Ceph/View/Daemons";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";

// The pages read their ids from the route, not from these props.
const PAGE_PROPS: PageComponentProps = {} as PageComponentProps;

const ABOUT: string = "About ";

function secondsAgo(seconds: number): Date {
  return new Date(Date.now() - seconds * 1000);
}

beforeEach(() => {
  jest.useFakeTimers();
  getItemMock.mockReset();
  modelGetListMock.mockReset();
  analyticsGetListMock.mockReset();
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

async function renderPage(
  Page: React.FunctionComponent<PageComponentProps>,
): Promise<void> {
  render(<Page {...PAGE_PROPS} />);
  await settle();
}

// Every header cell of the table, left to right.
function headerCells(tableId: string): Array<HTMLElement> {
  const header: HTMLElement | null = document.getElementById(
    `${tableId}-header`,
  );

  if (!header) {
    throw new Error(`The ${tableId} table has no header`);
  }

  return Array.from(header.querySelectorAll<HTMLElement>("th"));
}

/*
 * A column's title. A header with an (i) is named by its title alone
 * (aria-label); the others by their text.
 */
function titleOf(cell: HTMLElement): string {
  return (cell.getAttribute("aria-label") || cell.textContent || "").trim();
}

function headerCell(tableId: string, title: string): HTMLElement {
  const cell: HTMLElement | undefined = headerCells(tableId).find(
    (candidate: HTMLElement): boolean => {
      return titleOf(candidate) === title;
    },
  );

  if (!cell) {
    throw new Error(`The ${tableId} table has no "${title}" column`);
  }

  return cell;
}

// The header's sort button: the (i) beside a metric's title is a button too.
function sortButtonOf(cell: HTMLElement): HTMLElement | null {
  return (
    within(cell)
      .queryAllByRole("button")
      .find((button: HTMLElement): boolean => {
        return !(button.getAttribute("aria-label") || "").startsWith(ABOUT);
      }) || null
  );
}

async function clickHeader(tableId: string, title: string): Promise<void> {
  const button: HTMLElement | null = sortButtonOf(headerCell(tableId, title));

  if (!button) {
    throw new Error(`The "${title}" column is not offered as a sort`);
  }

  fireEvent.click(button);
  await settle();
}

function ariaSortOf(tableId: string, title: string): string | null {
  return headerCell(tableId, title).getAttribute("aria-sort");
}

// What each sortable header announces, by title.
function announcedSorts(tableId: string): Record<string, string | null> {
  const sorts: Record<string, string | null> = {};

  for (const cell of headerCells(tableId)) {
    if (sortButtonOf(cell)) {
      sorts[titleOf(cell)] = cell.getAttribute("aria-sort");
    }
  }

  return sorts;
}

/*
 * Clicks every column its header offers as a sort, and records what the
 * header then announces for it.
 */
async function clickEverySortableHeader(
  tableId: string,
): Promise<Record<string, string | null>> {
  const titles: Array<string> = Object.keys(announcedSorts(tableId));
  const after: Record<string, string | null> = {};

  for (const title of titles) {
    await clickHeader(tableId, title);
    after[title] = ariaSortOf(tableId, title);
  }

  return after;
}

/*
 * ---------------------------------------------------------------------------
 * Docker and Podman Containers
 * ---------------------------------------------------------------------------
 */

const CPU_METRIC: string = "container.cpu.utilization";
const MEMORY_METRIC: string = "container.memory.usage.total";
const MEMORY_PERCENT_METRIC: string = "container.memory.percent";
const NETWORK_RX_METRIC: string = "container.network.io.usage.rx_bytes";
const NETWORK_TX_METRIC: string = "container.network.io.usage.tx_bytes";

const MB: number = 1024 * 1024;
const GB: number = 1024 * MB;

/*
 * One container's latest readings. A metric left out was not reported for
 * it in the window - its cell shows "—" - and a container sent without an
 * image shows "unknown".
 */
interface ContainerFixture {
  name: string;
  image?: string;
  readings: Record<string, number>;
}

/*
 * Five containers whose numbers sort differently from their text. As text
 * "1.5 GB" sorts below "50.0 MB" and "1000 B" above "5.0 GB"; "0 B" is a
 * reading of nothing, which is not the same as no reading at all.
 */
const FIVE_CONTAINERS: Array<ContainerFixture> = [
  {
    name: "web",
    image: "nginx:1.27",
    readings: {
      [CPU_METRIC]: 0.5,
      [MEMORY_PERCENT_METRIC]: 12,
      [NETWORK_RX_METRIC]: 0,
      [NETWORK_TX_METRIC]: MB,
    },
  },
  {
    name: "cache",
    readings: {
      [MEMORY_METRIC]: 300 * MB,
      [NETWORK_TX_METRIC]: 100 * MB,
    },
  },
  {
    name: "batch-10",
    image: "batch:1.0",
    readings: {
      [CPU_METRIC]: 250,
      [MEMORY_METRIC]: 50 * MB,
      [MEMORY_PERCENT_METRIC]: 2.25,
      [NETWORK_RX_METRIC]: 5 * GB,
      [NETWORK_TX_METRIC]: 512,
    },
  },
  {
    name: "api",
    image: "api:2.4",
    readings: {
      [CPU_METRIC]: 9,
      [MEMORY_METRIC]: 1.5 * GB,
      [MEMORY_PERCENT_METRIC]: 37.5,
      [NETWORK_RX_METRIC]: 1000,
      [NETWORK_TX_METRIC]: 3072,
    },
  },
  {
    name: "batch-9",
    image: "batch:1.0",
    readings: {
      [CPU_METRIC]: 12.345,
      [MEMORY_METRIC]: 900 * MB,
      [MEMORY_PERCENT_METRIC]: 80,
      [NETWORK_RX_METRIC]: 2048,
    },
  },
];

// Hands the page these containers' readings, one metric per request.
function serveContainers(containers: Array<ContainerFixture>): void {
  getItemMock.mockResolvedValue({ _id: MODEL_ID, hostIdentifier: "web-01" });
  analyticsGetListMock.mockImplementation((...args: Array<unknown>) => {
    const metricName: string = (args[0] as { query: { name: string } }).query
      .name;

    return Promise.resolve({
      data: containers
        .filter((container: ContainerFixture): boolean => {
          return container.readings[metricName] !== undefined;
        })
        .map((container: ContainerFixture): Record<string, unknown> => {
          return {
            time: secondsAgo(15),
            value: container.readings[metricName],
            attributes: {
              "resource.container.name": container.name,
              ...(container.image
                ? { "resource.container.image.name": container.image }
                : {}),
              "resource.host.name": "web-01",
            },
          };
        }),
    });
  });
}

// `count` containers, each busier than the one before it.
function containersBusierInTurn(count: number): Array<ContainerFixture> {
  return numberedNames("container", count).map(
    (name: string, index: number): ContainerFixture => {
      return {
        name: name,
        image: "nginx:1.27",
        readings: { [CPU_METRIC]: index + 0.5 },
      };
    },
  );
}

interface ContainerList {
  title: string;
  Page: React.FunctionComponent<PageComponentProps>;
  tableId: string;
}

const CONTAINER_LISTS: Array<ContainerList> = [
  {
    title: "Docker Containers",
    Page: DockerHostContainers,
    tableId: "docker-containers-table",
  },
  {
    title: "Podman Containers",
    Page: PodmanHostContainers,
    tableId: "podman-containers-table",
  },
];

// Name, image, CPU, memory, memory %, RX, TX, then the actions.
const CONTAINER_COLUMN_INDEX: Record<string, number> = {
  "Container Name": 0,
  Image: 1,
  CPU: 2,
  Memory: 3,
  "Memory %": 4,
  "Network RX (total)": 5,
  "Network TX (total)": 6,
};

interface ExpectedOrder {
  names: Array<string>;
  cells: Array<string>;
}

interface MetricColumnCase {
  title: string;
  busiestFirst: ExpectedOrder;
  quietestFirst: ExpectedOrder;
}

const METRIC_COLUMN_CASES: Array<MetricColumnCase> = [
  {
    title: "CPU",
    busiestFirst: {
      names: ["batch-10", "batch-9", "api", "web", "cache"],
      cells: ["250.00%", "12.35%", "9.00%", "0.50%", "—"],
    },
    quietestFirst: {
      names: ["web", "api", "batch-9", "batch-10", "cache"],
      cells: ["0.50%", "9.00%", "12.35%", "250.00%", "—"],
    },
  },
  {
    title: "Memory",
    busiestFirst: {
      names: ["api", "batch-9", "cache", "batch-10", "web"],
      cells: ["1.5 GB", "900 MB", "300 MB", "50.0 MB", "—"],
    },
    quietestFirst: {
      names: ["batch-10", "cache", "batch-9", "api", "web"],
      cells: ["50.0 MB", "300 MB", "900 MB", "1.5 GB", "—"],
    },
  },
  {
    title: "Memory %",
    busiestFirst: {
      names: ["batch-9", "api", "web", "batch-10", "cache"],
      cells: ["80.00%", "37.50%", "12.00%", "2.25%", "—"],
    },
    quietestFirst: {
      names: ["batch-10", "web", "api", "batch-9", "cache"],
      cells: ["2.25%", "12.00%", "37.50%", "80.00%", "—"],
    },
  },
  {
    title: "Network RX (total)",
    busiestFirst: {
      names: ["batch-10", "batch-9", "api", "web", "cache"],
      cells: ["5.0 GB", "2.0 KB", "1000 B", "0 B", "—"],
    },
    quietestFirst: {
      names: ["web", "api", "batch-9", "batch-10", "cache"],
      cells: ["0 B", "1000 B", "2.0 KB", "5.0 GB", "—"],
    },
  },
  {
    title: "Network TX (total)",
    busiestFirst: {
      names: ["cache", "web", "api", "batch-10", "batch-9"],
      cells: ["100 MB", "1.0 MB", "3.0 KB", "512 B", "—"],
    },
    quietestFirst: {
      names: ["batch-10", "api", "web", "cache", "batch-9"],
      cells: ["512 B", "3.0 KB", "1.0 MB", "100 MB", "—"],
    },
  },
];

describe.each(CONTAINER_LISTS)(
  "sorting the $title list",
  (list: ContainerList) => {
    function visibleNames(): Array<string> {
      return columnTexts(list.tableId);
    }

    function visibleCells(title: string): Array<string> {
      return columnTexts(list.tableId, CONTAINER_COLUMN_INDEX[title]);
    }

    test("opens A to Z by name, counting numbers as numbers, and its header says so", async () => {
      serveContainers(FIVE_CONTAINERS);
      await renderPage(list.Page);

      // Plain text order would put batch-10 before batch-9.
      expect(visibleNames()).toEqual([
        "api",
        "batch-9",
        "batch-10",
        "cache",
        "web",
      ]);
      expect(announcedSorts(list.tableId)).toEqual({
        "Container Name": "ascending",
        Image: "none",
        CPU: "none",
        Memory: "none",
        "Memory %": "none",
        "Network RX (total)": "none",
        "Network TX (total)": "none",
      });
    });

    test("every column its header offers as a sort really sorts", async () => {
      serveContainers(FIVE_CONTAINERS);
      await renderPage(list.Page);

      const after: Record<string, string | null> =
        await clickEverySortableHeader(list.tableId);

      expect(Object.keys(after)).toHaveLength(7);

      for (const [title, ariaSort] of Object.entries(after)) {
        expect({ title, ariaSort }).toEqual({
          title,
          ariaSort: expect.stringMatching(/^(ascending|descending)$/),
        });
      }
    });

    test.each(METRIC_COLUMN_CASES)(
      "$title sorts by the reading, busiest first, with a missing reading last either way",
      async (column: MetricColumnCase) => {
        serveContainers(FIVE_CONTAINERS);
        await renderPage(list.Page);

        await clickHeader(list.tableId, column.title);

        expect(ariaSortOf(list.tableId, column.title)).toBe("descending");
        expect(ariaSortOf(list.tableId, "Container Name")).toBe("none");
        expect(visibleNames()).toEqual(column.busiestFirst.names);
        expect(visibleCells(column.title)).toEqual(column.busiestFirst.cells);

        await clickHeader(list.tableId, column.title);

        expect(ariaSortOf(list.tableId, column.title)).toBe("ascending");
        expect(visibleNames()).toEqual(column.quietestFirst.names);
        expect(visibleCells(column.title)).toEqual(column.quietestFirst.cells);
      },
    );

    test("a newly picked metric opens busiest first, whichever way the last column ran", async () => {
      serveContainers(FIVE_CONTAINERS);
      await renderPage(list.Page);

      // CPU, then flipped to the quietest first...
      await clickHeader(list.tableId, "CPU");
      await clickHeader(list.tableId, "CPU");

      expect(ariaSortOf(list.tableId, "CPU")).toBe("ascending");

      // ...and Memory % still opens on the heaviest user, not the lightest.
      await clickHeader(list.tableId, "Memory %");

      expect(ariaSortOf(list.tableId, "Memory %")).toBe("descending");
      expect(ariaSortOf(list.tableId, "CPU")).toBe("none");
      expect(visibleNames()).toEqual([
        "batch-9",
        "api",
        "web",
        "batch-10",
        "cache",
      ]);
    });

    test("Image sorts A to Z with an unknown image last, then flips", async () => {
      serveContainers(FIVE_CONTAINERS);
      await renderPage(list.Page);

      await clickHeader(list.tableId, "Image");

      expect(ariaSortOf(list.tableId, "Image")).toBe("ascending");
      // Two containers share batch:1.0: they stay in name order.
      expect(visibleNames()).toEqual([
        "api",
        "batch-9",
        "batch-10",
        "web",
        "cache",
      ]);
      expect(visibleCells("Image")).toEqual([
        "api:2.4",
        "batch:1.0",
        "batch:1.0",
        "nginx:1.27",
        "unknown",
      ]);

      await clickHeader(list.tableId, "Image");

      expect(ariaSortOf(list.tableId, "Image")).toBe("descending");
      expect(visibleNames()).toEqual([
        "web",
        "batch-9",
        "batch-10",
        "api",
        "cache",
      ]);
    });

    test("Container Name flips to Z to A", async () => {
      serveContainers(FIVE_CONTAINERS);
      await renderPage(list.Page);

      await clickHeader(list.tableId, "Container Name");

      expect(ariaSortOf(list.tableId, "Container Name")).toBe("descending");
      expect(visibleNames()).toEqual([
        "web",
        "cache",
        "batch-10",
        "batch-9",
        "api",
      ]);
    });

    test("a sort spans every page, and starts the reader again from page one", async () => {
      serveContainers(containersBusierInTurn(30));
      await renderPage(list.Page);
      await nextPage();

      expect(visibleNames()).toEqual(numberedNames("container", 30).slice(25));

      // The busiest containers were all on page two.
      await clickHeader(list.tableId, "CPU");

      expect(pagingSummary()).toBe("Showing 1-25 of 30 containers");
      expect(visibleNames()).toEqual(
        numberedNames("container", 30).reverse().slice(0, 25),
      );
    });

    test("a Refresh keeps the reader's sort", async () => {
      serveContainers(FIVE_CONTAINERS);
      await renderPage(list.Page);
      await clickHeader(list.tableId, "Memory");

      expect(visibleNames()[0]).toBe("api");

      // api restarted and is light again; cache took the memory.
      serveContainers(
        FIVE_CONTAINERS.map((container: ContainerFixture): ContainerFixture => {
          if (container.name === "api") {
            return {
              ...container,
              readings: { ...container.readings, [MEMORY_METRIC]: 10 * MB },
            };
          }
          if (container.name === "cache") {
            return {
              ...container,
              readings: { ...container.readings, [MEMORY_METRIC]: 2 * GB },
            };
          }
          return container;
        }),
      );
      await clickCardRefresh();

      expect(ariaSortOf(list.tableId, "Memory")).toBe("descending");
      expect(visibleNames()).toEqual([
        "cache",
        "batch-9",
        "batch-10",
        "api",
        "web",
      ]);
      expect(visibleCells("Memory")).toEqual([
        "2.0 GB",
        "900 MB",
        "50.0 MB",
        "10.0 MB",
        "—",
      ]);
    });
  },
);

/*
 * ---------------------------------------------------------------------------
 * Ceph Daemons
 * ---------------------------------------------------------------------------
 */

const DAEMONS_TABLE_ID: string = "ceph-daemons-table";

// "mon.a" is a monitor: each daemon's kind is the prefix of its name.
const KIND_BY_PREFIX: Record<string, string> = {
  mgr: "Mgr",
  mds: "Mds",
  mon: "Mon",
  rgw: "Rgw",
};

/*
 * One daemon's inventory row. A host or version left out was never
 * reported - its cell shows "—".
 */
interface DaemonFixture {
  name: string;
  hostname?: string;
  version?: string;
  inQuorum?: boolean;
  // How long ago it last reported; past 15 minutes it is Stale.
  lastSeenSecondsAgo?: number;
}

const STALE: number = 30 * 60;

/*
 * Out of quorum (red), stale (yellow) and healthy (green) daemons, on hosts
 * and versions whose numbers do not sort as text: as text ceph-node-10 comes
 * before ceph-node-3, and 18.2.10 before 18.2.4.
 */
const EIGHT_DAEMONS: Array<DaemonFixture> = [
  {
    name: "mon.a",
    hostname: "ceph-node-2",
    version: "18.2.4",
    inQuorum: true,
  },
  {
    name: "mon.b",
    hostname: "ceph-node-1",
    version: "18.2.10",
    inQuorum: false,
  },
  {
    name: "mon.c",
    hostname: "ceph-node-3",
    version: "18.2.4",
    inQuorum: true,
    lastSeenSecondsAgo: STALE,
  },
  { name: "mgr.x", hostname: "ceph-node-1", version: "18.2.10" },
  { name: "mgr.y" },
  {
    name: "mds.a",
    hostname: "ceph-node-2",
    version: "17.2.7",
    lastSeenSecondsAgo: STALE,
  },
  { name: "rgw.10", hostname: "ceph-node-10", version: "18.2.4" },
  { name: "rgw.2", hostname: "ceph-node-3", version: "18.2.4" },
];

// The inventory rows for these daemons, served one kind at a time.
function serveDaemons(daemons: Array<DaemonFixture>): void {
  modelGetListMock.mockImplementation((...args: Array<unknown>) => {
    const kind: string = (args[0] as { query: { kind: string } }).query.kind;

    return Promise.resolve({
      data: daemons
        .filter((daemon: DaemonFixture): boolean => {
          return KIND_BY_PREFIX[daemon.name.split(".")[0] || ""] === kind;
        })
        .map((daemon: DaemonFixture): Record<string, unknown> => {
          return {
            kind: kind,
            externalId: daemon.name,
            hostname: daemon.hostname,
            daemonVersion: daemon.version,
            inQuorum: daemon.inQuorum ?? false,
            lastSeenAt: secondsAgo(daemon.lastSeenSecondsAgo ?? 60),
          };
        }),
    });
  });
}

// Daemon, kind, status, host, version.
const DAEMON_COLUMN_INDEX: Record<string, number> = {
  Daemon: 0,
  Kind: 1,
  Status: 2,
  Host: 3,
  Version: 4,
};

function visibleDaemons(): Array<string> {
  return columnTexts(DAEMONS_TABLE_ID);
}

function visibleDaemonCells(title: string): Array<string> {
  return columnTexts(DAEMONS_TABLE_ID, DAEMON_COLUMN_INDEX[title]);
}

describe("sorting the Ceph Daemons list", () => {
  test("opens grouped by kind, each kind A to Z, and its header says so", async () => {
    serveDaemons(EIGHT_DAEMONS);
    await renderPage(CephClusterDaemons);

    expect(visibleDaemons()).toEqual([
      "mgr.x",
      "mgr.y",
      "mds.a",
      "mon.a",
      "mon.b",
      "mon.c",
      "rgw.2",
      "rgw.10",
    ]);
    expect(announcedSorts(DAEMONS_TABLE_ID)).toEqual({
      Daemon: "none",
      Kind: "ascending",
      Status: "none",
      Host: "none",
      Version: "none",
    });
  });

  test("every column its header offers as a sort really sorts", async () => {
    serveDaemons(EIGHT_DAEMONS);
    await renderPage(CephClusterDaemons);

    const after: Record<string, string | null> =
      await clickEverySortableHeader(DAEMONS_TABLE_ID);

    expect(Object.keys(after)).toHaveLength(5);

    for (const [title, ariaSort] of Object.entries(after)) {
      expect({ title, ariaSort }).toEqual({
        title,
        ariaSort: expect.stringMatching(/^(ascending|descending)$/),
      });
    }
  });

  test("Daemon sorts by name, counting numbers as numbers, then flips", async () => {
    serveDaemons(EIGHT_DAEMONS);
    await renderPage(CephClusterDaemons);

    await clickHeader(DAEMONS_TABLE_ID, "Daemon");

    expect(ariaSortOf(DAEMONS_TABLE_ID, "Daemon")).toBe("ascending");
    expect(ariaSortOf(DAEMONS_TABLE_ID, "Kind")).toBe("none");
    expect(visibleDaemons()).toEqual([
      "mds.a",
      "mgr.x",
      "mgr.y",
      "mon.a",
      "mon.b",
      "mon.c",
      "rgw.2",
      "rgw.10",
    ]);

    await clickHeader(DAEMONS_TABLE_ID, "Daemon");

    expect(ariaSortOf(DAEMONS_TABLE_ID, "Daemon")).toBe("descending");
    expect(visibleDaemons()).toEqual([
      "rgw.10",
      "rgw.2",
      "mon.c",
      "mon.b",
      "mon.a",
      "mgr.y",
      "mgr.x",
      "mds.a",
    ]);
  });

  test("Kind flips to Z to A, keeping each kind's daemons A to Z", async () => {
    serveDaemons(EIGHT_DAEMONS);
    await renderPage(CephClusterDaemons);

    await clickHeader(DAEMONS_TABLE_ID, "Kind");

    expect(ariaSortOf(DAEMONS_TABLE_ID, "Kind")).toBe("descending");
    expect(visibleDaemons()).toEqual([
      "rgw.2",
      "rgw.10",
      "mon.a",
      "mon.b",
      "mon.c",
      "mds.a",
      "mgr.x",
      "mgr.y",
    ]);
  });

  test("Status puts the worst first - out of quorum, then stale, then healthy - not A to Z", async () => {
    serveDaemons(EIGHT_DAEMONS);
    await renderPage(CephClusterDaemons);

    await clickHeader(DAEMONS_TABLE_ID, "Status");

    expect(ariaSortOf(DAEMONS_TABLE_ID, "Status")).toBe("descending");
    // Within a status, the order the list opens on: by kind, then name.
    expect(visibleDaemons()).toEqual([
      "mon.b",
      "mds.a",
      "mon.c",
      "mgr.x",
      "mgr.y",
      "mon.a",
      "rgw.2",
      "rgw.10",
    ]);
    expect(visibleDaemonCells("Status")).toEqual([
      "Out of Quorum",
      "Stale",
      "Stale",
      "Reporting",
      "Reporting",
      "In Quorum",
      "Reporting",
      "Reporting",
    ]);

    await clickHeader(DAEMONS_TABLE_ID, "Status");

    expect(ariaSortOf(DAEMONS_TABLE_ID, "Status")).toBe("ascending");
    expect(visibleDaemons()).toEqual([
      "mgr.x",
      "mgr.y",
      "mon.a",
      "rgw.2",
      "rgw.10",
      "mds.a",
      "mon.c",
      "mon.b",
    ]);
  });

  test("Host sorts A to Z, counting numbers as numbers, with a missing host last either way", async () => {
    serveDaemons(EIGHT_DAEMONS);
    await renderPage(CephClusterDaemons);

    await clickHeader(DAEMONS_TABLE_ID, "Host");

    expect(ariaSortOf(DAEMONS_TABLE_ID, "Host")).toBe("ascending");
    expect(visibleDaemons()).toEqual([
      "mgr.x",
      "mon.b",
      "mds.a",
      "mon.a",
      "mon.c",
      "rgw.2",
      "rgw.10",
      "mgr.y",
    ]);
    expect(visibleDaemonCells("Host")).toEqual([
      "ceph-node-1",
      "ceph-node-1",
      "ceph-node-2",
      "ceph-node-2",
      "ceph-node-3",
      "ceph-node-3",
      "ceph-node-10",
      "—",
    ]);

    await clickHeader(DAEMONS_TABLE_ID, "Host");

    expect(ariaSortOf(DAEMONS_TABLE_ID, "Host")).toBe("descending");
    expect(visibleDaemonCells("Host")).toEqual([
      "ceph-node-10",
      "ceph-node-3",
      "ceph-node-3",
      "ceph-node-2",
      "ceph-node-2",
      "ceph-node-1",
      "ceph-node-1",
      "—",
    ]);
    expect(visibleDaemons()).toEqual([
      "rgw.10",
      "mon.c",
      "rgw.2",
      "mds.a",
      "mon.a",
      "mgr.x",
      "mon.b",
      "mgr.y",
    ]);
  });

  test("Version sorts oldest first, counting numbers as numbers, with a missing version last either way", async () => {
    serveDaemons(EIGHT_DAEMONS);
    await renderPage(CephClusterDaemons);

    await clickHeader(DAEMONS_TABLE_ID, "Version");

    expect(ariaSortOf(DAEMONS_TABLE_ID, "Version")).toBe("ascending");
    expect(visibleDaemonCells("Version")).toEqual([
      "17.2.7",
      "18.2.4",
      "18.2.4",
      "18.2.4",
      "18.2.4",
      "18.2.10",
      "18.2.10",
      "—",
    ]);
    expect(visibleDaemons()).toEqual([
      "mds.a",
      "mon.a",
      "mon.c",
      "rgw.2",
      "rgw.10",
      "mgr.x",
      "mon.b",
      "mgr.y",
    ]);

    await clickHeader(DAEMONS_TABLE_ID, "Version");

    expect(ariaSortOf(DAEMONS_TABLE_ID, "Version")).toBe("descending");
    expect(visibleDaemonCells("Version")).toEqual([
      "18.2.10",
      "18.2.10",
      "18.2.4",
      "18.2.4",
      "18.2.4",
      "18.2.4",
      "17.2.7",
      "—",
    ]);
  });

  test("a sort spans every page, and starts the reader again from page one", async () => {
    /*
     * Thirty daemons, opening on managers, metadata servers, monitors and
     * then 23 gateways - one of the gateways on page two has gone stale.
     */
    const thirty: Array<DaemonFixture> = [
      { name: "mgr.x" },
      { name: "mgr.y" },
      { name: "mds.a" },
      { name: "mds.b" },
      { name: "mon.a", inQuorum: true },
      { name: "mon.b", inQuorum: true },
      { name: "mon.c", inQuorum: true },
      ...numberedNames("rgw", 23).map((name: string): DaemonFixture => {
        const daemon: string = name.replace("-", ".");
        return daemon === "rgw.20"
          ? { name: daemon, lastSeenSecondsAgo: STALE }
          : { name: daemon };
      }),
    ];
    serveDaemons(thirty);
    await renderPage(CephClusterDaemons);
    await nextPage();

    expect(visibleDaemons()).toEqual([
      "rgw.18",
      "rgw.19",
      "rgw.20",
      "rgw.21",
      "rgw.22",
    ]);

    await clickHeader(DAEMONS_TABLE_ID, "Status");

    expect(pagingSummary()).toBe("Showing 1-25 of 30 daemons");
    expect(visibleDaemons().slice(0, 3)).toEqual(["rgw.20", "mgr.x", "mgr.y"]);
    expect(visibleDaemonCells("Status")[0]).toBe("Stale");
  });
});
