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
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { settle } from "./HostTooltipHarness";

/*
 * The Docker and Podman Containers lists and the Ceph Daemons list, rendered
 * for real with their data layer mocked. Each reads its whole list in one
 * fetch and pages it client-side, so the page size is theirs to hold: the
 * footer's rows-per-page picker only reports what the reader chose.
 *
 * All three used to put every row on one page and drop whatever the footer
 * reported. With 30 containers the picker read "30", and choosing 10 snapped
 * straight back to it.
 */

const MODEL_ID: string = "0193c0de-3333-4aaa-8bbb-000000000003";

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
        return new ObjectIDType("0193c0de-3333-4aaa-8bbb-000000000003");
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

function secondsAgo(seconds: number): Date {
  return new Date(Date.now() - seconds * 1000);
}

/*
 * One reading per container, the same for each of the five metrics the page
 * asks for: only the name column is under test here.
 */
function serveContainers(names: Array<string>): void {
  getItemMock.mockResolvedValue({ _id: MODEL_ID, hostIdentifier: "web-01" });
  analyticsGetListMock.mockResolvedValue({
    data: names.map((name: string): Record<string, unknown> => {
      return {
        time: secondsAgo(15),
        value: 12.5,
        attributes: {
          "resource.container.name": name,
          "resource.container.image.name": "nginx:1.27",
          "resource.host.name": "web-01",
        },
      };
    }),
  });
}

// "mon.a" is a monitor: each daemon's kind is the prefix of its name.
const KIND_BY_PREFIX: Record<string, string> = {
  mgr: "Mgr",
  mds: "Mds",
  mon: "Mon",
  rgw: "Rgw",
};

// The inventory rows for these daemons, served one kind at a time.
function serveDaemons(names: Array<string>): void {
  modelGetListMock.mockImplementation((...args: Array<unknown>) => {
    const kind: string = (args[0] as { query: { kind: string } }).query.kind;

    return Promise.resolve({
      data: names
        .filter((name: string): boolean => {
          return KIND_BY_PREFIX[name.split(".")[0] || ""] === kind;
        })
        .map((name: string): Record<string, unknown> => {
          return {
            kind: kind,
            externalId: name,
            hostname: "ceph-node-1",
            daemonVersion: "18.2.4",
            inQuorum: true,
            lastSeenAt: secondsAgo(60),
          };
        }),
    });
  });
}

/*
 * `count` names that sort in the order they are listed: "container-00",
 * "container-01" and so on.
 */
function numberedNames(prefix: string, count: number): Array<string> {
  return Array.from({ length: count }, (_value: unknown, index: number) => {
    return `${prefix}-${String(index).padStart(2, "0")}`;
  });
}

/*
 * A cluster with a large gateway fleet, in the order the table lists it:
 * managers, metadata servers, monitors, then 23 RADOS gateways.
 */
const THIRTY_DAEMONS: Array<string> = [
  "mgr.x",
  "mgr.y",
  "mds.a",
  "mds.b",
  "mon.a",
  "mon.b",
  "mon.c",
  ...Array.from({ length: 23 }, (_value: unknown, index: number) => {
    return `rgw.${String(index).padStart(2, "0")}`;
  }),
];

interface PagedList {
  title: string;
  Page: React.FunctionComponent<PageComponentProps>;
  tableId: string;
  // The rows' noun, as the pagination summary prints it.
  noun: string;
  // Thirty rows' names, in the order the list shows them.
  names: Array<string>;
  // Has the data layer hand back these rows.
  serve: (names: Array<string>) => void;
}

const LISTS: Array<PagedList> = [
  {
    title: "Docker Containers",
    Page: DockerHostContainers,
    tableId: "docker-containers-table",
    noun: "containers",
    names: numberedNames("container", 30),
    serve: serveContainers,
  },
  {
    title: "Podman Containers",
    Page: PodmanHostContainers,
    tableId: "podman-containers-table",
    noun: "containers",
    names: numberedNames("container", 30),
    serve: serveContainers,
  },
  {
    title: "Ceph Daemons",
    Page: CephClusterDaemons,
    tableId: "ceph-daemons-table",
    noun: "daemons",
    names: THIRTY_DAEMONS,
    serve: serveDaemons,
  },
];

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

describe.each(LISTS)("paging through the $title list", (list: PagedList) => {
  beforeEach(() => {
    list.serve(list.names);
  });

  async function renderList(): Promise<void> {
    render(<list.Page {...PAGE_PROPS} />);
    await settle();
  }

  // The name column of every row on screen, top to bottom.
  function visibleNames(): Array<string> {
    const body: HTMLElement | null = document.getElementById(
      `${list.tableId}-body`,
    );
    if (!body) {
      return [];
    }
    return Array.from(body.querySelectorAll("tr")).map(
      (row: HTMLTableRowElement): string => {
        return (row.querySelectorAll("td")[0]?.textContent || "").trim();
      },
    );
  }

  function pageSizeSelect(): HTMLSelectElement {
    return screen.getByTestId(
      "pagination-items-on-page-select",
    ) as HTMLSelectElement;
  }

  function nextButton(): HTMLElement {
    return screen.getByTestId("pagination-next-button");
  }

  // "Showing 26-30 of 30 containers".
  function pagingSummary(): string {
    return screen.getByTestId("pagination-summary").textContent || "";
  }

  async function choosePageSize(size: number): Promise<void> {
    fireEvent.change(pageSizeSelect(), { target: { value: String(size) } });
    await settle();
  }

  async function nextPage(): Promise<void> {
    fireEvent.click(nextButton());
    await settle();
  }

  // The card's only header button, an icon with no name of its own.
  async function clickRefresh(): Promise<void> {
    fireEvent.click(
      within(screen.getByTestId("card-header-actions")).getByRole("button"),
    );
    await settle();
  }

  test("shows 25 rows a page, and the last page's footer counts on from 25", async () => {
    await renderList();

    expect(pageSizeSelect()).toHaveValue("25");
    expect(visibleNames()).toEqual(list.names.slice(0, 25));
    expect(pagingSummary()).toBe(`Showing 1-25 of 30 ${list.noun}`);

    await nextPage();

    expect(visibleNames()).toEqual(list.names.slice(25));
    expect(pagingSummary()).toBe(`Showing 26-30 of 30 ${list.noun}`);
    expect(nextButton()).toBeDisabled();
  });

  test("a list shorter than a page is one page, under the usual page size", async () => {
    list.serve(list.names.slice(0, 3));
    await renderList();

    // Not "3": the picker offers page sizes, not the number of rows.
    expect(pageSizeSelect()).toHaveValue("25");
    expect(visibleNames()).toEqual(list.names.slice(0, 3));
    expect(pagingSummary()).toBe(`Showing 1-3 of 3 ${list.noun}`);
    expect(nextButton()).toBeDisabled();
  });

  test("the rows-per-page picker really changes the page size", async () => {
    await renderList();
    await choosePageSize(10);

    // It used to snap straight back to the number of rows.
    expect(pageSizeSelect()).toHaveValue("10");
    expect(visibleNames()).toEqual(list.names.slice(0, 10));
    expect(pagingSummary()).toBe(`Showing 1-10 of 30 ${list.noun}`);

    await choosePageSize(50);

    expect(pageSizeSelect()).toHaveValue("50");
    expect(visibleNames()).toEqual(list.names);
    expect(pagingSummary()).toBe(`Showing 1-30 of 30 ${list.noun}`);
    expect(nextButton()).toBeDisabled();
  });

  test("a smaller page size pages in smaller steps, from the first page", async () => {
    await renderList();
    await nextPage();

    expect(visibleNames()).toEqual(list.names.slice(25));

    // Row 26 of a 25-row page is not row 26 of a 10-row one: back to the top.
    await choosePageSize(10);

    expect(visibleNames()).toEqual(list.names.slice(0, 10));

    await nextPage();

    expect(visibleNames()).toEqual(list.names.slice(10, 20));

    await nextPage();

    expect(visibleNames()).toEqual(list.names.slice(20));
    expect(pagingSummary()).toBe(`Showing 21-30 of 30 ${list.noun}`);
    expect(nextButton()).toBeDisabled();
  });

  test("a Refresh that comes back shorter does not strand the reader past its end", async () => {
    await renderList();
    await nextPage();

    expect(visibleNames()).toEqual(list.names.slice(25));

    // Twenty rows went away: the ten left are one page.
    list.serve(list.names.slice(0, 10));
    await clickRefresh();

    expect(visibleNames()).toEqual(list.names.slice(0, 10));
    expect(pagingSummary()).toBe(`Showing 1-10 of 10 ${list.noun}`);
  });

  test("the page size the reader picked outlives a Refresh", async () => {
    await renderList();
    await choosePageSize(10);
    await nextPage();
    await nextPage();

    expect(visibleNames()).toEqual(list.names.slice(20));

    // Fifteen rows are two pages of ten: the reader lands on the last one.
    list.serve(list.names.slice(0, 15));
    await clickRefresh();

    expect(pageSizeSelect()).toHaveValue("10");
    expect(visibleNames()).toEqual(list.names.slice(10, 15));
    expect(pagingSummary()).toBe(`Showing 11-15 of 15 ${list.noun}`);
    expect(nextButton()).toBeDisabled();
  });
});
