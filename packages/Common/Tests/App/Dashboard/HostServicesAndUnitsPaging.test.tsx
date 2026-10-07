import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { settle } from "./HostTooltipHarness";

/*
 * The Host Windows Services and Systemd Units lists, rendered for real with
 * their data layer mocked. Both page one snapshot client-side, so the page
 * size is theirs to hold: the footer's rows-per-page picker only reports what
 * the reader chose, and a list that drops it keeps showing 25 rows a page
 * under a select that says 50.
 */

const MODEL_ID: string = "84858d6c-1111-4aaa-8bbb-000000000001";

const getItemMock: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>) => {
        return getItemMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>) => {
        return getListMock(...args);
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
        return new ObjectIDType("84858d6c-1111-4aaa-8bbb-000000000001");
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

import HostServices from "../../../../App/FeatureSet/Dashboard/src/Pages/Host/View/Services";
import HostSystemdUnits from "../../../../App/FeatureSet/Dashboard/src/Pages/Host/View/SystemdUnits";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";

// The Host pages read their ids from the route, not from these props.
const PAGE_PROPS: PageComponentProps = {} as PageComponentProps;

function secondsAgo(seconds: number): Date {
  return new Date(Date.now() - seconds * 1000);
}

/*
 * agent-00 to agent-14, then worker-00 to worker-14: thirty rows, already in
 * the A to Z order both lists open on.
 */
function thirtyNames(suffix: string): Array<string> {
  const names: Array<string> = [];
  for (const family of ["agent", "worker"]) {
    for (let index: number = 0; index < 15; index++) {
      names.push(`${family}-${String(index).padStart(2, "0")}${suffix}`);
    }
  }
  return names;
}

interface PagedList {
  title: string;
  Page: React.FunctionComponent<PageComponentProps>;
  tableId: string;
  searchPlaceholder: string;
  // The rows' noun, as the pagination summary prints it.
  noun: string;
  // Every row's name, in the order the list opens on.
  names: Array<string>;
  // What the metrics API hands back for those rows.
  readings: (names: Array<string>) => Array<Record<string, unknown>>;
}

const LISTS: Array<PagedList> = [
  {
    title: "Windows Services",
    Page: HostServices,
    tableId: "host-services-table",
    searchPlaceholder: "Search services...",
    noun: "services",
    names: thirtyNames(""),
    readings: (names: Array<string>): Array<Record<string, unknown>> => {
      return names.map((name: string): Record<string, unknown> => {
        return {
          time: secondsAgo(15),
          // SERVICE_RUNNING
          value: 4,
          attributes: {
            name: name,
            startup_mode: "auto_start",
            "resource.host.name": "web-01",
          },
        };
      });
    },
  },
  {
    title: "Systemd Units",
    Page: HostSystemdUnits,
    tableId: "host-systemd-units-table",
    searchPlaceholder: "Search units...",
    noun: "units",
    names: thirtyNames(".service"),
    readings: (names: Array<string>): Array<Record<string, unknown>> => {
      return names.map((name: string): Record<string, unknown> => {
        return {
          time: secondsAgo(15),
          // The state each unit is in; the zero-valued rest are not fetched.
          value: 1,
          attributes: {
            "resource.systemd.unit.name": name,
            "systemd.unit.active_state": "active",
            "resource.host.name": "web-01",
          },
        };
      });
    },
  },
];

beforeEach(() => {
  jest.useFakeTimers();
  getItemMock.mockReset();
  getListMock.mockReset();
  getItemMock.mockResolvedValue({
    _id: MODEL_ID,
    name: "web-01",
    hostIdentifier: "web-01",
    osType: "linux",
  });
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

describe.each(LISTS)("paging through the $title list", (list: PagedList) => {
  beforeEach(() => {
    getListMock.mockResolvedValue({ data: list.readings(list.names) });
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

  async function choosePageSize(size: number): Promise<void> {
    fireEvent.change(pageSizeSelect(), { target: { value: String(size) } });
    await settle();
  }

  async function nextPage(): Promise<void> {
    fireEvent.click(nextButton());
    await settle();
  }

  test("shows 25 rows a page", async () => {
    await renderList();

    expect(pageSizeSelect()).toHaveValue("25");
    expect(visibleNames()).toEqual(list.names.slice(0, 25));

    await nextPage();

    expect(visibleNames()).toEqual(list.names.slice(25));
  });

  test("the rows-per-page picker really changes the page size", async () => {
    await renderList();
    await choosePageSize(50);

    expect(pageSizeSelect()).toHaveValue("50");
    // All thirty on one page, not the 25 the list opened with.
    expect(visibleNames()).toEqual(list.names);
    expect(screen.getByTestId("pagination-summary")).toHaveTextContent(
      `Showing 1-30 of 30 ${list.noun}`,
    );
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
    expect(nextButton()).toBeDisabled();
  });

  test("a search keeps the page size the reader picked", async () => {
    await renderList();
    await choosePageSize(10);

    fireEvent.change(screen.getByPlaceholderText(list.searchPlaceholder), {
      target: { value: "worker" },
    });
    await settle();

    // Fifteen workers match: ten on the first page, five on the next.
    expect(pageSizeSelect()).toHaveValue("10");
    expect(visibleNames()).toEqual(list.names.slice(15, 25));

    await nextPage();

    expect(visibleNames()).toEqual(list.names.slice(25));
  });
});
