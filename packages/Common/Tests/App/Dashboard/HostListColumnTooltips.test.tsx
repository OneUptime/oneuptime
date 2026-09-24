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
import {
  explanationOnFocus,
  explanationOnHover,
  expectNotNestedInControl,
  infoButtonsFor,
  infoLabels,
  settle,
} from "./HostTooltipHarness";

/*
 * The Host Processes, Services and Systemd Units lists, rendered for real
 * with their data layer mocked. The metric columns carry an (i) in their
 * header through the shared Table's headerTooltip; on a sortable column the
 * (i) sits beside the sort button, never inside it, and asking what a
 * column means does not re-sort the table.
 */

const MODEL_ID: string = "84858d6c-1111-4aaa-8bbb-000000000001";
const GIB: number = 1024 * 1024 * 1024;
const SORTED_PATTERN: RegExp = /^(ascending|descending)$/;

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
import HostServices from "../../../../App/FeatureSet/Dashboard/src/Pages/Host/View/Services";
import HostSystemdUnits from "../../../../App/FeatureSet/Dashboard/src/Pages/Host/View/SystemdUnits";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import {
  HOST_METRIC_DESCRIPTIONS,
  HostMetric,
} from "../../../../App/FeatureSet/Dashboard/src/Components/MetricDescriptions/HostMetricDescriptions";

const D: Record<HostMetric, string> = HOST_METRIC_DESCRIPTIONS;

// The Host pages read their ids from the route, not from these props.
const PAGE_PROPS: PageComponentProps = {} as PageComponentProps;

interface ListCall {
  query: { name: string };
}

function secondsAgo(seconds: number): Date {
  return new Date(Date.now() - seconds * 1000);
}

function headerCell(label: string): HTMLElement {
  return infoButtonsFor(label)[0]!.closest("th") as HTMLElement;
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
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

// -------------------------------------------------------------- processes

function processAttributes(pid: string, exe: string): Record<string, string> {
  return {
    "resource.process.pid": pid,
    "resource.process.executable.name": exe,
    "resource.host.name": "web-01",
  };
}

/*
 * Newest first, as the API sorts them. postgres's newest scrape holds its
 * three CPU readings at one timestamp: 30% user, 6% system, 0% wait.
 */
function processRows(call: ListCall): Array<Record<string, unknown>> {
  const at: Date = secondsAgo(10);

  if (call.query.name === "process.cpu.utilization") {
    return [
      {
        time: at,
        value: 0.3,
        attributes: { ...processAttributes("4321", "postgres"), state: "user" },
      },
      {
        time: at,
        value: 0.06,
        attributes: {
          ...processAttributes("4321", "postgres"),
          state: "system",
        },
      },
      {
        time: at,
        value: 0,
        attributes: { ...processAttributes("4321", "postgres"), state: "wait" },
      },
      {
        time: at,
        value: 0.05,
        attributes: { ...processAttributes("99", "nginx"), state: "user" },
      },
    ];
  }

  return [
    {
      time: at,
      value: 2 * GIB,
      attributes: processAttributes("4321", "postgres"),
    },
    {
      time: at,
      value: 100 * 1024 * 1024,
      attributes: processAttributes("99", "nginx"),
    },
  ];
}

describe("Host Processes list", () => {
  beforeEach(() => {
    getListMock.mockImplementation((call: unknown) => {
      return Promise.resolve({ data: processRows(call as ListCall) });
    });
  });

  test("the CPU and Memory headers carry an (i); Process and User do not", async () => {
    render(<HostProcesses {...PAGE_PROPS} />);
    await settle();

    expect(infoLabels()).toEqual(["CPU", "Memory"]);
    expect(
      screen.getByRole("columnheader", { name: "Process" }),
    ).toBeInTheDocument();
  });

  test.each([
    ["CPU", "processListCpu"],
    ["Memory", "processListMemory"],
  ])(
    "the %s header explains it with %s",
    async (label: string, key: string) => {
      render(<HostProcesses {...PAGE_PROPS} />);
      await settle();

      expect(await explanationOnHover(infoButtonsFor(label)[0]!)).toBe(
        D[key as HostMetric],
      );
      expectNotNestedInControl(infoButtonsFor(label)[0]!);
      expect(headerCell(label)).toHaveTextContent(label);
    },
  );

  test("the CPU column shows one of the three readings, not their sum, as its text warns", async () => {
    render(<HostProcesses {...PAGE_PROPS} />);
    await settle();

    const row: HTMLElement = screen
      .getByText("postgres")
      .closest("tr") as HTMLElement;

    expect(within(row).getByText("30.0%")).toBeInTheDocument();
    expect(within(row).queryByText("36.0%")).not.toBeInTheDocument();
    expect(D.processListCpu).toContain("only one of them");
  });

  test("the Memory column compares RSS with the host's total RAM", async () => {
    render(<HostProcesses {...PAGE_PROPS} />);
    await settle();

    const row: HTMLElement = screen
      .getByText("postgres")
      .closest("tr") as HTMLElement;

    expect(within(row).getByText("2.0 GiB")).toBeInTheDocument();
    expect(within(row).getByText("12.5%")).toBeInTheDocument();
  });

  test("the list reads the last 15 minutes, whatever the page shows elsewhere", async () => {
    render(<HostProcesses {...PAGE_PROPS} />);
    await settle();

    for (const call of getListMock.mock.calls) {
      const time: { startValue: Date; endValue: Date } = (
        call[0] as { query: { time: { startValue: Date; endValue: Date } } }
      ).query.time;

      expect(time.endValue.getTime() - time.startValue.getTime()).toBe(
        15 * 60_000,
      );
    }
    expect(D.processListCpu).toContain("last 15 minutes");
    expect(D.processListMemory).toContain("last 15 minutes");
  });
});

// --------------------------------------------------------------- services

function serviceRow(
  name: string,
  code: number,
  startupMode: string,
): Record<string, unknown> {
  return {
    time: secondsAgo(15),
    value: code,
    attributes: {
      name,
      startup_mode: startupMode,
      "resource.host.name": "web-01",
    },
  };
}

describe("Host Services list", () => {
  beforeEach(() => {
    getListMock.mockResolvedValue({
      data: [
        serviceRow("Spooler", 4, "auto_start"),
        serviceRow("wuauserv", 1, "demand_start"),
        serviceRow("BootDriver", 4, "boot_start"),
      ],
    });
  });

  test("the Startup and Status headers carry an (i); Service does not", async () => {
    render(<HostServices {...PAGE_PROPS} />);
    await settle();

    expect(infoLabels()).toEqual(["Startup", "Status"]);
  });

  test.each([
    ["Startup", "serviceListStartup"],
    ["Status", "serviceListStatus"],
  ])(
    "the %s header explains it with %s",
    async (label: string, key: string) => {
      render(<HostServices {...PAGE_PROPS} />);
      await settle();

      expect(await explanationOnHover(infoButtonsFor(label)[0]!)).toBe(
        D[key as HostMetric],
      );
    },
  );

  test("the header (i) opens from the keyboard too", async () => {
    render(<HostServices {...PAGE_PROPS} />);
    await settle();

    expect(await explanationOnFocus(infoButtonsFor("Status")[0]!)).toBe(
      D.serviceListStatus,
    );
  });

  test("on a sortable column the (i) sits beside the sort button, not in it", async () => {
    render(<HostServices {...PAGE_PROPS} />);
    await settle();

    for (const label of ["Startup", "Status"]) {
      const button: HTMLElement = infoButtonsFor(label)[0]!;
      const sortButton: HTMLElement = within(headerCell(label)).getByRole(
        "button",
        { name: label },
      );

      expectNotNestedInControl(button);
      expect(sortButton).not.toContainElement(button);
    }
  });

  test("asking what Status means does not sort; the sort button still does", async () => {
    render(<HostServices {...PAGE_PROPS} />);
    await settle();

    expect(headerCell("Status")).toHaveAttribute("aria-sort", "none");

    fireEvent.click(infoButtonsFor("Status")[0]!);
    await settle();

    expect(headerCell("Status")).toHaveAttribute("aria-sort", "none");

    fireEvent.click(
      within(headerCell("Status")).getByRole("button", { name: "Status" }),
    );
    await settle();

    // Sorted by Status now (the shared header flips the current direction).
    expect(headerCell("Status").getAttribute("aria-sort")).not.toBe("none");
    expect(headerCell("Status").getAttribute("aria-sort")).toMatch(
      SORTED_PATTERN,
    );
    // The (i) survives the re-render the sort causes.
    expect(infoLabels()).toEqual(["Startup", "Status"]);
  });

  test("the rows use the labels the texts list", async () => {
    render(<HostServices {...PAGE_PROPS} />);
    await settle();

    for (const label of ["Automatic", "Manual", "Boot", "Running", "Stopped"]) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
    expect(D.serviceListStartup).toContain("Automatic");
    expect(D.serviceListStartup).toContain("Manual");
    expect(D.serviceListStartup).toContain("Boot");
    expect(D.serviceListStatus).toContain("Running");
    expect(D.serviceListStatus).toContain("Stopped");
  });
});

// ---------------------------------------------------------- systemd units

function unitRow(name: string, state: string): Record<string, unknown> {
  return {
    time: secondsAgo(15),
    value: 1,
    attributes: {
      "resource.systemd.unit.name": name,
      "systemd.unit.active_state": state,
      "resource.host.name": "web-01",
    },
  };
}

describe("Host Systemd Units list", () => {
  beforeEach(() => {
    getListMock.mockResolvedValue({
      data: [
        unitRow("nginx.service", "active"),
        unitRow("backup.service", "failed"),
        unitRow("logrotate.timer", "active"),
      ],
    });
  });

  test("the Type and State headers carry an (i); Unit does not", async () => {
    render(<HostSystemdUnits {...PAGE_PROPS} />);
    await settle();

    expect(infoLabels()).toEqual(["Type", "State"]);
  });

  test.each([
    ["Type", "unitListType"],
    ["State", "unitListState"],
  ])(
    "the %s header explains it with %s",
    async (label: string, key: string) => {
      render(<HostSystemdUnits {...PAGE_PROPS} />);
      await settle();

      expect(await explanationOnHover(infoButtonsFor(label)[0]!)).toBe(
        D[key as HostMetric],
      );
      expectNotNestedInControl(infoButtonsFor(label)[0]!);
    },
  );

  test("asking what State means does not sort the table", async () => {
    render(<HostSystemdUnits {...PAGE_PROPS} />);
    await settle();

    const before: string | null = headerCell("State").getAttribute("aria-sort");

    fireEvent.click(infoButtonsFor("State")[0]!);
    await settle();

    expect(headerCell("State").getAttribute("aria-sort")).toBe(before);
  });

  test("the rows use the labels the texts quote", async () => {
    render(<HostSystemdUnits {...PAGE_PROPS} />);
    await settle();

    expect(screen.getAllByText("Active").length).toBeGreaterThan(0);
    expect(screen.getByText("Failed")).toBeInTheDocument();
    expect(screen.getByText("Timer")).toBeInTheDocument();
    expect(D.unitListState).toContain("Active");
    expect(D.unitListState).toContain("Failed");
    expect(D.unitListType).toContain("Timer");
  });
});
