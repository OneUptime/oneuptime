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
import NotEqual from "../../../Types/BaseDatabase/NotEqual";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { EMPTY_TABLE_CLEAR_FILTERS_TEST_ID } from "../../../UI/Components/Table/TableEmptyStateBuilders";

/*
 * The Host Processes list (OneUptime issue #4477), rendered for real with its
 * data layer mocked: the search box, the sortable columns, the pagination
 * footer, and the two queries the page sends.
 */

const MODEL_ID: string = "84858d6c-1111-4aaa-8bbb-000000000001";
const MIB: number = 1024 * 1024;
const GIB: number = 1024 * MIB;

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

import HostProcesses from "../../../../App/FeatureSet/Dashboard/src/Pages/Host/View/Processes";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";

// The Host pages read their ids from the route, not from these props.
const PAGE_PROPS: PageComponentProps = {} as PageComponentProps;

interface ListCall {
  query: {
    name: string;
    attributes: Record<string, unknown>;
    time: { startValue: Date; endValue: Date };
  };
  limit: number;
  sort: Record<string, SortOrder>;
}

interface FakeProcess {
  pid: number;
  exe: string;
  owner: string;
  command: string;
  // Fractions of all cores, as the scraper reports them. Null: no reading.
  cpu: { user: number; system: number; wait: number } | null;
  memoryBytes: number;
}

/*
 * A Linux host. Default order, CPU high to low: postgres 36%, java (784)
 * 12%, nginx 6%, java (8404) 0.2%, sshd 0%, then cron, which has no CPU
 * reading at all.
 */
const PROCESSES: Array<FakeProcess> = [
  {
    pid: 4321,
    exe: "postgres",
    owner: "postgres",
    command: "/usr/lib/postgresql/16/bin/postgres",
    cpu: { user: 0.3, system: 0.06, wait: 0.2 },
    memoryBytes: 2 * GIB,
  },
  {
    pid: 99,
    exe: "nginx",
    owner: "root",
    command: "nginx: master process /usr/sbin/nginx",
    cpu: { user: 0.05, system: 0.01, wait: 0 },
    memoryBytes: 100 * MIB,
  },
  {
    pid: 784,
    exe: "java",
    owner: "app",
    command: "/usr/lib/jvm/java-17/bin/java",
    cpu: { user: 0.1, system: 0.02, wait: 0 },
    memoryBytes: 4 * GIB,
  },
  {
    pid: 8404,
    exe: "java",
    owner: "elastic",
    command: "/usr/share/elasticsearch/jdk/bin/java",
    cpu: { user: 0.001, system: 0.001, wait: 0 },
    memoryBytes: 1.6 * GIB,
  },
  {
    pid: 10040,
    exe: "sshd",
    owner: "root",
    command: "/usr/sbin/sshd",
    cpu: { user: 0, system: 0, wait: 0 },
    memoryBytes: 8 * MIB,
  },
  {
    pid: 600,
    exe: "cron",
    owner: "root",
    command: "/usr/sbin/cron",
    cpu: null,
    memoryBytes: 3 * MIB,
  },
];

const ALL_PIDS_BY_CPU: Array<string> = [
  "4321",
  "784",
  "99",
  "8404",
  "10040",
  "600",
];

function secondsAgo(seconds: number): Date {
  return new Date(Date.now() - seconds * 1000);
}

function identity(process: FakeProcess): Record<string, unknown> {
  return {
    "resource.process.pid": String(process.pid),
    "resource.process.executable.name": process.exe,
    "resource.process.command": process.command,
    "resource.process.owner": process.owner,
    "resource.host.name": "web-01",
  };
}

/*
 * What ClickHouse would hand back: newest first, every reading of one
 * process's scrape at one timestamp. The wait readings are included on
 * purpose - the mock ignores the query's filter, so the page must not add
 * them up either.
 */
function readings(
  call: ListCall,
  processes: Array<FakeProcess>,
): Array<Record<string, unknown>> {
  const rows: Array<Record<string, unknown>> = [];

  processes.forEach((process: FakeProcess, index: number) => {
    const at: Date = secondsAgo(10 + index / 1000);

    if (call.query.name === "process.cpu.utilization") {
      if (!process.cpu) {
        return;
      }
      for (const [state, value] of Object.entries(process.cpu)) {
        rows.push({
          time: at,
          value: value,
          attributes: { ...identity(process), state: state },
        });
      }
      return;
    }

    rows.push({
      time: at,
      value: process.memoryBytes,
      attributes: identity(process),
    });
  });

  return rows;
}

function serve(processes: Array<FakeProcess>): void {
  getListMock.mockImplementation((call: unknown) => {
    return Promise.resolve({
      data: readings(call as ListCall, processes),
    });
  });
}

async function renderPage(): Promise<void> {
  render(<HostProcesses {...PAGE_PROPS} />);
  await settle();
}

// The PID column of every row on screen, top to bottom.
function visiblePids(): Array<string> {
  const body: HTMLElement | null = document.getElementById(
    "host-processes-table-body",
  );
  if (!body) {
    return [];
  }
  return Array.from(body.querySelectorAll("tr")).map(
    (row: HTMLTableRowElement): string => {
      return (row.querySelectorAll("td")[1]?.textContent || "").trim();
    },
  );
}

function searchBox(): HTMLInputElement {
  return screen.getByRole("textbox", {
    name: "Search processes",
  }) as HTMLInputElement;
}

async function search(text: string): Promise<void> {
  fireEvent.change(searchBox(), { target: { value: text } });
  await settle();
}

function header(name: string): HTMLElement {
  return screen.getByRole("columnheader", { name: name });
}

async function clickHeader(name: string): Promise<void> {
  fireEvent.click(within(header(name)).getByRole("button", { name: name }));
  await settle();
}

function callFor(metricName: string): ListCall {
  const call: Array<unknown> | undefined = getListMock.mock.calls.find(
    (args: Array<unknown>): boolean => {
      return (args[0] as ListCall).query.name === metricName;
    },
  );
  expect(call).toBeDefined();
  return call![0] as ListCall;
}

beforeEach(() => {
  jest.useFakeTimers();
  getItemMock.mockReset();
  getListMock.mockReset();
  getItemMock.mockResolvedValue({
    _id: MODEL_ID,
    name: "web-01",
    hostIdentifier: "web-01",
    totalMemoryBytes: 16 * GIB,
    osType: "linux",
  });
  serve(PROCESSES);
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

describe("searching the Processes list", () => {
  test("the search box says what it searches", async () => {
    await renderPage();

    expect(searchBox()).toHaveAttribute(
      "placeholder",
      "Search by name, PID, user or path...",
    );
    expect(searchBox()).toHaveValue("");
    expect(screen.getByText("6 processes")).toBeInTheDocument();
  });

  test("a name narrows the list to the processes that match", async () => {
    await renderPage();
    await search("java");

    expect(visiblePids()).toEqual(["784", "8404"]);
    expect(screen.getByText("2 of 6 processes")).toBeInTheDocument();
  });

  test.each([
    ["a pid", "4321", ["4321"]],
    ["a user", "elastic", ["8404"]],
    ["a path", "/usr/sbin/nginx", ["99"]],
    ["a user many processes share", "root", ["99", "10040", "600"]],
    ["any case", "POSTGRES", ["4321"]],
  ])(
    "finds processes by %s",
    async (_what: string, text: string, expected: Array<string>) => {
      await renderPage();
      await search(text);

      expect(visiblePids()).toEqual(expected);
    },
  );

  test("every word has to match", async () => {
    await renderPage();
    await search("java app");

    expect(visiblePids()).toEqual(["784"]);
  });

  test("a search that matches nothing says so and offers the way back", async () => {
    await renderPage();
    await search("no-such-process");

    expect(visiblePids()).toEqual([]);
    expect(
      screen.getByText("No processes match your search"),
    ).toBeInTheDocument();
    expect(screen.getByText("0 of 6 processes")).toBeInTheDocument();
    // The collector guidance is for an empty host, not for a search.
    expect(
      screen.queryByText(/No process metrics in the last 15 minutes/),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId(EMPTY_TABLE_CLEAR_FILTERS_TEST_ID));
    await settle();

    expect(searchBox()).toHaveValue("");
    expect(visiblePids()).toEqual(ALL_PIDS_BY_CPU);
  });

  test("Clear search in the bar empties the box", async () => {
    await renderPage();
    await search("java");

    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    await settle();

    expect(searchBox()).toHaveValue("");
    expect(visiblePids()).toEqual(ALL_PIDS_BY_CPU);
    expect(
      screen.queryByRole("button", { name: "Clear search" }),
    ).not.toBeInTheDocument();
  });

  test("a search keeps the column order the reader picked", async () => {
    await renderPage();
    await clickHeader("PID");
    await search("root");

    expect(visiblePids()).toEqual(["99", "600", "10040"]);
  });

  test("an empty host shows the collector guidance and no search box", async () => {
    serve([]);
    await renderPage();

    expect(
      screen.getByText(/No process metrics in the last 15 minutes/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("textbox", { name: "Search processes" }),
    ).not.toBeInTheDocument();
  });
});

describe("sorting the Processes list", () => {
  test("opens on the busiest processes, a process with no CPU reading last", async () => {
    await renderPage();

    expect(visiblePids()).toEqual(ALL_PIDS_BY_CPU);
    expect(header("CPU")).toHaveAttribute("aria-sort", "descending");
    for (const name of ["Process", "PID", "User", "Memory"]) {
      expect(header(name)).toHaveAttribute("aria-sort", "none");
    }
  });

  test("CPU is user plus system time - wait is never added", async () => {
    await renderPage();

    // "postgres" is also the process's owner: find the name by its link.
    const postgres: HTMLElement = screen
      .getByRole("link", { name: "postgres" })
      .closest("tr") as HTMLElement;

    // 30% user + 6% system. The 20% wait reading is not CPU.
    expect(within(postgres).getByText("36.0%")).toBeInTheDocument();
    expect(within(postgres).queryByText("56.0%")).not.toBeInTheDocument();
    expect(within(postgres).queryByText("30.0%")).not.toBeInTheDocument();
  });

  test("CPU flips to lowest first, still keeping the unread process last", async () => {
    await renderPage();
    await clickHeader("CPU");

    expect(header("CPU")).toHaveAttribute("aria-sort", "ascending");
    expect(visiblePids()).toEqual([
      "10040",
      "8404",
      "99",
      "784",
      "4321",
      "600",
    ]);
  });

  test("the first click on Memory shows the heaviest, not the lightest", async () => {
    await renderPage();
    await clickHeader("Memory");

    expect(header("Memory")).toHaveAttribute("aria-sort", "descending");
    expect(header("CPU")).toHaveAttribute("aria-sort", "none");
    expect(visiblePids()).toEqual([
      "784",
      "4321",
      "8404",
      "99",
      "10040",
      "600",
    ]);

    await clickHeader("Memory");

    expect(header("Memory")).toHaveAttribute("aria-sort", "ascending");
    expect(visiblePids()).toEqual([
      "600",
      "10040",
      "99",
      "8404",
      "4321",
      "784",
    ]);
  });

  test("Process sorts A to Z, then Z to A", async () => {
    await renderPage();
    await clickHeader("Process");

    expect(header("Process")).toHaveAttribute("aria-sort", "ascending");
    expect(visiblePids()).toEqual([
      "600",
      "784",
      "8404",
      "99",
      "4321",
      "10040",
    ]);

    await clickHeader("Process");

    expect(header("Process")).toHaveAttribute("aria-sort", "descending");
    // The two java processes stay in pid order either way.
    expect(visiblePids()).toEqual([
      "10040",
      "4321",
      "99",
      "784",
      "8404",
      "600",
    ]);
  });

  test("PID sorts as a number", async () => {
    await renderPage();
    await clickHeader("PID");

    expect(header("PID")).toHaveAttribute("aria-sort", "ascending");
    expect(visiblePids()).toEqual([
      "99",
      "600",
      "784",
      "4321",
      "8404",
      "10040",
    ]);
  });

  test("User sorts A to Z, processes of one user by name", async () => {
    await renderPage();
    await clickHeader("User");

    expect(header("User")).toHaveAttribute("aria-sort", "ascending");
    expect(visiblePids()).toEqual([
      "784",
      "8404",
      "4321",
      "600",
      "99",
      "10040",
    ]);
  });
});

describe("paging through the Processes list", () => {
  const MANY: Array<FakeProcess> = Array.from(
    { length: 30 },
    (_value: unknown, index: number): FakeProcess => {
      return {
        pid: 1000 + index,
        exe: `worker-${index}`,
        owner: "app",
        command: `/opt/app/worker --shard ${index}`,
        cpu: { user: (30 - index) / 1000, system: 0, wait: 0 },
        memoryBytes: (index + 1) * MIB,
      };
    },
  );

  test("shows 25 processes a page", async () => {
    serve(MANY);
    await renderPage();

    expect(visiblePids()).toHaveLength(25);
    expect(visiblePids()[0]).toBe("1000");

    fireEvent.click(screen.getByTestId("pagination-next-button"));
    await settle();

    expect(visiblePids()).toEqual(["1025", "1026", "1027", "1028", "1029"]);
  });

  test("the rows-per-page picker really changes the page size", async () => {
    serve(MANY);
    await renderPage();

    fireEvent.change(screen.getByTestId("pagination-items-on-page-select"), {
      target: { value: "50" },
    });
    await settle();

    expect(visiblePids()).toHaveLength(30);
  });

  test("a new search starts again from the first page", async () => {
    serve(MANY);
    await renderPage();

    fireEvent.click(screen.getByTestId("pagination-next-button"));
    await settle();
    expect(visiblePids()[0]).toBe("1025");

    // Still two pages of matches, so only a reset can bring back the first.
    await search("worker");

    expect(visiblePids()[0]).toBe("1000");
    expect(visiblePids()).toHaveLength(25);
  });

  test("a search narrower than the page lists every match", async () => {
    serve(MANY);
    await renderPage();
    await search("worker-1");

    // worker-1 and worker-10 through worker-19, busiest first.
    expect(visiblePids()).toEqual([
      "1001",
      "1010",
      "1011",
      "1012",
      "1013",
      "1014",
      "1015",
      "1016",
      "1017",
      "1018",
      "1019",
    ]);
  });

  test("a new sort starts again from the first page", async () => {
    serve(MANY);
    await renderPage();

    fireEvent.click(screen.getByTestId("pagination-next-button"));
    await settle();
    await clickHeader("Memory");

    expect(visiblePids()[0]).toBe("1029");
    expect(visiblePids()).toHaveLength(25);
  });
});

describe("what the Processes list asks for", () => {
  test("the CPU query leaves out wait readings, under both spellings", async () => {
    await renderPage();

    const attributes: Record<string, unknown> = callFor(
      "process.cpu.utilization",
    ).query.attributes;

    expect(attributes["resource.host.name"]).toBe("web-01");
    expect(attributes["state"]).toBeInstanceOf(NotEqual);
    expect((attributes["state"] as NotEqual<string>).value).toBe("wait");
    expect(attributes["cpu.mode"]).toBeInstanceOf(NotEqual);
    expect((attributes["cpu.mode"] as NotEqual<string>).value).toBe("iowait");
  });

  test("the memory query filters on the host alone", async () => {
    await renderPage();

    expect(callFor("process.memory.usage").query.attributes).toEqual({
      "resource.host.name": "web-01",
    });
  });

  test("both read newest first, 2000 at most, over the last 15 minutes", async () => {
    await renderPage();

    for (const metric of ["process.cpu.utilization", "process.memory.usage"]) {
      const call: ListCall = callFor(metric);
      expect(call.limit).toBe(2000);
      expect(call.sort).toEqual({ time: SortOrder.Descending });
      expect(
        call.query.time.endValue.getTime() -
          call.query.time.startValue.getTime(),
      ).toBe(15 * 60_000);
    }
    expect(getListMock).toHaveBeenCalledTimes(2);
  });
});

describe("a host with more processes than one fetch holds", () => {
  const TRUNCATION_NOTE: RegExp =
    /more processes than this page can load at once/;

  test("says the list is incomplete when the newest scrape did not fit", async () => {
    // 2000 CPU readings, every one a different process: one scrape, cut off.
    const crowded: Array<FakeProcess> = Array.from(
      { length: 2000 },
      (_value: unknown, index: number): FakeProcess => {
        return {
          pid: 20000 + index,
          exe: `task-${index}`,
          owner: "app",
          command: "/opt/app/task",
          cpu: null,
          memoryBytes: MIB,
        };
      },
    );
    getListMock.mockImplementation((call: unknown) => {
      const listCall: ListCall = call as ListCall;
      if (listCall.query.name !== "process.cpu.utilization") {
        return Promise.resolve({ data: readings(listCall, crowded) });
      }
      return Promise.resolve({
        data: crowded.map((process: FakeProcess, index: number) => {
          return {
            time: secondsAgo(10 + index / 1000),
            value: 0.001,
            attributes: { ...identity(process), state: "user" },
          };
        }),
      });
    });

    await renderPage();

    expect(screen.getByText(TRUNCATION_NOTE)).toBeInTheDocument();
  });

  test("says nothing of the kind for a host that fits", async () => {
    await renderPage();

    expect(screen.queryByText(TRUNCATION_NOTE)).not.toBeInTheDocument();
    expect(
      screen.getByText(/Latest snapshot of processes on this host/),
    ).toBeInTheDocument();
  });
});
