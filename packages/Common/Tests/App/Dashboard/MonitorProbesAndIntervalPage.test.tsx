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
import React, { ReactElement } from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { getJestSpyOn } from "../../Spy";

/*
 * A monitor's Probes & Interval page, and how it is reached.
 *
 * Create Monitor asks for a monitor's probes and its interval on one step,
 * "Probes & Interval". The monitor's own menu split them into an Interval
 * page and a Probes page, and how many of those probes must agree before
 * the status changes sat on Settings. Now the page (Pages/Monitor/View/
 * Probes.tsx) holds, in order, the Monitoring Interval card, the probes
 * table and the Probe Agreement card; the menu has one entry for it, only
 * for a monitor that probes check; and its breadcrumb is its name.
 *
 * The real page and cards run against a fake monitor. The probes table
 * (ModelTable, covered by its own suites) is a recorder here, as are the
 * monitoring-off banner and the network.
 */

const getItemMock: MockFunction = getJestMockFunction();
const updateByIdMock: MockFunction = getJestMockFunction();
const getAllProbesMock: MockFunction = getJestMockFunction();

// The props the probes table was drawn with, newest last.
const tableProps: Array<Record<string, unknown>> = [];

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, options?: { defaultValue?: string }): string => {
          return options?.defaultValue ?? key;
        },
      };
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>): unknown => {
        return getItemMock(...args);
      },
      updateById: (...args: Array<unknown>): unknown => {
        return updateByIdMock(...args);
      },
      count: (): Promise<number> => {
        return Promise.resolve(0);
      },
      getList: (): Promise<unknown> => {
        return Promise.resolve({ data: [], count: 0, skip: 0, limit: 0 });
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelListCache", () => {
  return {
    __esModule: true,
    default: {
      getList: () => {
        return Promise.resolve({ data: [], count: 0, skip: 0, limit: 0 });
      },
    },
  };
});

jest.mock("../../../../App/FeatureSet/Dashboard/src/Utils/Probe", () => {
  return {
    __esModule: true,
    default: {
      getAllProbes: (...args: Array<unknown>): unknown => {
        return getAllProbesMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: Record<string, unknown>): ReactElement => {
      tableProps.push(props);
      const cardProps: { title?: string } =
        (props["cardProps"] as { title?: string }) || {};

      return (
        <div data-testid="probes-table" data-name={props["name"] as string}>
          <h2>{cardProps.title}</h2>
        </div>
      );
    },
  };
});

// Reads the monitor on its own; it has its own suites.
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/DisabledWarning",
  () => {
    return {
      __esModule: true,
      default: (): ReactElement => {
        return <div data-testid="monitoring-off-banner" />;
      },
    };
  },
);

import MonitorProbesPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Monitor/View/Probes";
import MonitorSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/Monitor/View/SideMenu";
import {
  MONITORING_INTERVAL_TEST_ID,
  NOT_CHECKED_BY_PROBES_TEST_ID,
  PROBE_AGREEMENT_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/ProbesAndIntervalCopy";
import { getMonitorBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/MonitorBreadcrumbs";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap, {
  RouteUtil,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import Route from "../../../Types/API/Route";
import Link from "../../../Types/Link";
import MonitorType, {
  MonitorTypeHelper,
} from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import PermissionGate, {
  PermissionGateResult,
} from "../../../UI/Utils/PermissionGate";
import {
  activeLinkTitles,
  isExpanded,
  linksIn,
  MenuLink,
  PROJECT_ID,
  goTo,
  renderMenu,
  sectionTitlesInOrder,
  titlesInMenu,
} from "./SideMenuHarness";

const MONITOR_ID: string = "8d8d8d8d-0000-4000-8000-0000000000e1";

// A menu entry about the monitor's probes or its interval.
const PROBES_OR_INTERVAL: RegExp = /probe|interval/i;
const PROBES_PATH: string = `/dashboard/${PROJECT_ID}/monitors/${MONITOR_ID}/probes`;

const PAGE_PROPS: PageComponentProps = {
  pageRoute: RouteMap[PageMap.MONITOR_VIEW_PROBES] as Route,
  currentProject: null,
  hasPaymentMethod: true,
} as unknown as PageComponentProps;

// The fake monitor, as the server holds it.
let stored: Partial<Monitor> | null = null;

beforeEach(() => {
  stored = {
    monitorType: MonitorType.API,
    monitoringInterval: "*/10 * * * *",
    minimumProbeAgreement: 2,
  };
  tableProps.length = 0;

  getItemMock.mockReset();
  getItemMock.mockImplementation(async (): Promise<unknown> => {
    if (!stored) {
      return null;
    }

    const monitor: Monitor = new Monitor();
    monitor._id = MONITOR_ID;
    Object.assign(monitor, stored);
    return monitor;
  });

  updateByIdMock.mockReset();
  updateByIdMock.mockImplementation(
    async (options: unknown): Promise<unknown> => {
      Object.assign(
        stored || {},
        (options as { data: Record<string, unknown> }).data,
      );
      return {};
    },
  );

  getAllProbesMock.mockReset();
  getAllProbesMock.mockImplementation(async (): Promise<unknown> => {
    return [];
  });

  getJestSpyOn(PermissionGate, "checkColumnUpdate").mockImplementation(
    (): PermissionGateResult => {
      return { isAllowed: true };
    },
  );

  goTo(PROBES_PATH);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

async function flush(): Promise<void> {
  await act(async () => {
    for (let i: number = 0; i < 20; i++) {
      await Promise.resolve();
    }
  });
}

async function renderPage(): Promise<void> {
  render(<MonitorProbesPage {...PAGE_PROPS} />);
  await flush();
}

function headingsInOrder(): Array<string> {
  return Array.from(document.querySelectorAll("h2")).map(
    (heading: HTMLElement): string => {
      return heading.textContent?.trim() || "";
    },
  );
}

describe("the Probes & Interval page", () => {
  test("is the interval, then the probes, then how many of them must agree", async () => {
    await renderPage();

    expect(headingsInOrder()).toEqual([
      "Monitoring Interval",
      "Probes",
      "Probe Agreement",
    ]);
    expect(
      screen.getByTestId(`${MONITORING_INTERVAL_TEST_ID}-card`),
    ).toHaveTextContent("Every 10 Minutes");
    expect(
      (screen.getByTestId(PROBE_AGREEMENT_TEST_ID) as HTMLInputElement).value,
    ).toBe("2");
    expect(screen.getByTestId("monitoring-off-banner")).toBeInTheDocument();
  });

  test("reads the monitor once, for its type and what the two cards start from", async () => {
    await renderPage();

    expect(getItemMock).toHaveBeenCalledTimes(1);

    const read: { id: ObjectID; select: Record<string, unknown> } = getItemMock
      .mock.calls[0]![0] as { id: ObjectID; select: Record<string, unknown> };

    expect(read.id.toString()).toBe(MONITOR_ID);
    expect(read.select).toEqual({
      monitorType: true,
      monitoringInterval: true,
      minimumProbeAgreement: true,
    });
  });

  test("the probes table is the one it always was, for this monitor", async () => {
    await renderPage();

    const props: Record<string, unknown> = tableProps[tableProps.length - 1]!;

    expect(props["name"]).toBe("Monitor > Monitor Probes");
    expect(props["id"]).toBe("probes-table");
    expect(props["isCreateable"]).toBe(true);
    expect(props["isEditable"]).toBe(true);
    expect(props["isDeleteable"]).toBe(true);
    expect((props["query"] as Record<string, unknown>)["monitorId"]).toBe(
      MONITOR_ID,
    );
  });

  test("an interval picked on the page is saved for this monitor", async () => {
    await renderPage();

    const combobox: HTMLElement = screen.getByRole("combobox", {
      name: "Monitoring Interval",
    });
    fireEvent.keyDown(combobox, { key: "ArrowDown", code: "ArrowDown" });
    const option: HTMLElement = screen.getByRole("option", {
      name: "Every Hour",
    });
    fireEvent.mouseDown(option);
    fireEvent.click(option);
    await flush();

    expect(updateByIdMock).toHaveBeenCalledTimes(1);

    const call: { id: ObjectID; data: Record<string, unknown> } = updateByIdMock
      .mock.calls[0]![0] as {
      id: ObjectID;
      data: Record<string, unknown>;
    };

    expect(call.id.toString()).toBe(MONITOR_ID);
    expect(call.data).toEqual({ monitoringInterval: "0 * * * *" });
  });

  test("a probe agreement typed on the page is saved for this monitor", async () => {
    await renderPage();

    const box: HTMLElement = screen.getByTestId(PROBE_AGREEMENT_TEST_ID);
    fireEvent.change(box, { target: { value: "" } });
    fireEvent.blur(box);
    await flush();

    const call: { id: ObjectID; data: Record<string, unknown> } = updateByIdMock
      .mock.calls[0]![0] as {
      id: ObjectID;
      data: Record<string, unknown>;
    };

    expect(call.id.toString()).toBe(MONITOR_ID);
    expect(call.data).toEqual({ minimumProbeAgreement: null });
  });

  test("a Synthetic monitor is offered only what Create offers it", async () => {
    stored!.monitorType = MonitorType.SyntheticMonitor;
    stored!.monitoringInterval = "*/5 * * * *";

    await renderPage();

    fireEvent.keyDown(
      screen.getByRole("combobox", { name: "Monitoring Interval" }),
      { key: "ArrowDown", code: "ArrowDown" },
    );

    const offered: Array<string> = screen
      .getAllByRole("option")
      .map((option: HTMLElement): string => {
        return option.textContent || "";
      });

    expect(offered).not.toContain("Every Minute");
    expect(offered).not.toContain("Every 2 Minutes");
    expect(offered[0]).toBe("Every 5 Minutes");
  });

  test("a manual monitor is told it has neither probes nor an interval", async () => {
    stored!.monitorType = MonitorType.Manual;

    await renderPage();

    expect(
      screen.getByText("Manual monitors are not checked"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Nothing checks a manual monitor, so it has no probes or interval. You set its status yourself.",
      ),
    ).toBeInTheDocument();
    expect(
      document.getElementById(NOT_CHECKED_BY_PROBES_TEST_ID),
    ).not.toBeNull();
    expect(screen.queryByTestId("probes-table")).toBeNull();
    expect(screen.queryByTestId(PROBE_AGREEMENT_TEST_ID)).toBeNull();
    expect(
      screen.queryByTestId(`${MONITORING_INTERVAL_TEST_ID}-card`),
    ).toBeNull();
  });

  const NOT_PROBE_CHECKED: Array<MonitorType> = Object.values(
    MonitorType,
  ).filter((type: MonitorType): boolean => {
    return (
      !MonitorTypeHelper.isProbableMonitor(type) && type !== MonitorType.Manual
    );
  });

  test.each(NOT_PROBE_CHECKED)(
    "%s monitors, which probes do not check, are told why instead of shown a probes table",
    async (monitorType: MonitorType) => {
      stored!.monitorType = monitorType;

      await renderPage();

      expect(
        screen.getByText("This monitor is not checked by probes"),
      ).toBeInTheDocument();
      expect(
        screen.getByText(
          "OneUptime evaluates this monitor from the data it receives, so it has no probes or interval to set.",
        ),
      ).toBeInTheDocument();
      expect(screen.queryByTestId("probes-table")).toBeNull();
      expect(screen.queryByTestId(PROBE_AGREEMENT_TEST_ID)).toBeNull();
    },
  );

  test("a monitor that cannot be read says why, instead of loading for good", async () => {
    getItemMock.mockImplementation(async (): Promise<unknown> => {
      throw new Error("Network error while reading the monitor");
    });

    await renderPage();

    expect(
      screen.getByText("Network error while reading the monitor"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("probes-table")).toBeNull();
  });

  test("a monitor that is not there says so", async () => {
    stored = null;

    await renderPage();

    expect(screen.getByText(/monitor not found/i)).toBeInTheDocument();
    expect(screen.queryByTestId("probes-table")).toBeNull();
  });
});

describe("the monitor's menu", () => {
  const PROBE_CHECKED: Array<MonitorType> = Object.values(MonitorType).filter(
    (type: MonitorType): boolean => {
      return MonitorTypeHelper.isProbableMonitor(type);
    },
  );

  const NOT_PROBE_CHECKED: Array<MonitorType> = Object.values(
    MonitorType,
  ).filter((type: MonitorType): boolean => {
    return !MonitorTypeHelper.isProbableMonitor(type);
  });

  function probesRoute(): string {
    return RouteUtil.populateRouteParams(
      RouteMap[PageMap.MONITOR_VIEW_PROBES] as Route,
      { modelId: new ObjectID(MONITOR_ID) },
    ).toString();
  }

  async function renderMonitorMenu(monitorType: MonitorType): Promise<void> {
    await renderMenu(
      <MonitorSideMenu
        modelId={new ObjectID(MONITOR_ID)}
        monitorType={monitorType}
      />,
    );
  }

  test.each(PROBE_CHECKED)(
    "%s monitors have one entry for their probes and interval",
    async (monitorType: MonitorType) => {
      await renderMonitorMenu(monitorType);

      const entries: Array<MenuLink> = linksIn("Configuration").filter(
        (link: MenuLink): boolean => {
          return PROBES_OR_INTERVAL.test(link.title);
        },
      );

      expect(entries).toEqual([
        { title: "Probes & Interval", href: probesRoute() },
      ]);
      expect(titlesInMenu()).not.toContain("Interval");
      expect(titlesInMenu()).not.toContain("Probes");
    },
  );

  test.each(NOT_PROBE_CHECKED)(
    "%s monitors, which probes do not check, have no such entry",
    async (monitorType: MonitorType) => {
      await renderMonitorMenu(monitorType);

      expect(titlesInMenu()).not.toContain("Probes & Interval");
      expect(titlesInMenu()).not.toContain("Interval");
      expect(titlesInMenu()).not.toContain("Probes");
    },
  );

  test("an API monitor's Configuration is Criteria, Dependencies, then Probes & Interval", async () => {
    await renderMonitorMenu(MonitorType.API);

    expect(
      linksIn("Configuration").map((link: MenuLink): string => {
        return link.title;
      }),
    ).toEqual(["Criteria", "Dependencies", "Probes & Interval"]);
  });

  test("on the page, Configuration opens by itself with the entry marked as the page you are on", async () => {
    goTo(PROBES_PATH);

    await renderMonitorMenu(MonitorType.API);

    expect(sectionTitlesInOrder()).toContain("Configuration");
    expect(isExpanded("Configuration")).toBe(true);
    expect(activeLinkTitles()).toEqual(["Probes & Interval"]);
  });
});

describe("the page's breadcrumb", () => {
  test("is its name", () => {
    const links: Array<Link> | undefined = getMonitorBreadcrumbs(
      RouteUtil.getRouteString(PageMap.MONITOR_VIEW_PROBES),
    );

    expect(
      links?.map((link: Link): string => {
        return link.title;
      }),
    ).toEqual(["Project", "Monitors", "View Monitor", "Probes & Interval"]);
  });

  test("the old Interval page has none: its URL only forwards", () => {
    expect(
      getMonitorBreadcrumbs("/dashboard/:projectId/monitors/:id/interval"),
    ).toBeUndefined();
  });
});
