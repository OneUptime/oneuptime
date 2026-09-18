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
  render,
  RenderResult,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The SLO overview's monitors card, RENDERED against a ModelAPI stub.
 *
 * Its jobs: fetch the SLO's monitors in one request (and only when the ids or
 * the poll token change), show what needs attention first, call a paused
 * monitor paused, and — when there are no monitors — tell apart "nothing
 * attached yet" from "rules that match nothing", each with the right links.
 */

const getListMock: MockFunction = getJestMockFunction();

// Lazy wrapper: jest.mock is hoisted above the mock's own declaration.
jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>): unknown => {
        return getListMock(...args);
      },
    },
  };
});

import SloMonitorsSummaryCard, {
  ComponentProps,
  SLO_OVERVIEW_MAX_MONITOR_ROWS,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Slo/SloMonitorsSummaryCard";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap, {
  RouteUtil,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import Route from "../../../Types/API/Route";
import Includes from "../../../Types/BaseDatabase/Includes";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { Green, Red, Yellow } from "../../../Types/BrandColors";
import Color from "../../../Types/Color";
import ObjectID from "../../../Types/ObjectID";

// A real UUID: ProjectUtil ignores a URL project id that is not one.
const PROJECT_ID: ObjectID = new ObjectID(
  "7d3f1a2b-4c5d-4e6f-8a9b-0c1d2e3f4a5b",
);
const SLO_ID: ObjectID = new ObjectID("5f8b7c1e2d3a4b5c6d7e8f90");

interface StatusSpec {
  name: string;
  color: Color;
  isOperationalState: boolean;
  isOfflineState: boolean;
  priority: number;
}

const OPERATIONAL: StatusSpec = {
  name: "Operational",
  color: Green,
  isOperationalState: true,
  isOfflineState: false,
  priority: 1,
};

const DEGRADED: StatusSpec = {
  name: "Degraded",
  color: Yellow,
  isOperationalState: false,
  isOfflineState: false,
  priority: 2,
};

const OFFLINE: StatusSpec = {
  name: "Offline",
  color: Red,
  isOperationalState: false,
  isOfflineState: true,
  priority: 3,
};

let idCounter: number = 0;

type BuildMonitorFunction = (data: {
  name: string;
  status: StatusSpec;
  isPaused?: boolean | undefined;
}) => Monitor;

const buildMonitor: BuildMonitorFunction = (data: {
  name: string;
  status: StatusSpec;
  isPaused?: boolean | undefined;
}): Monitor => {
  idCounter += 1;

  const status: MonitorStatus = new MonitorStatus();
  status.name = data.status.name;
  status.color = data.status.color;
  status.isOperationalState = data.status.isOperationalState;
  status.isOfflineState = data.status.isOfflineState;
  status.priority = data.status.priority;

  const monitor: Monitor = new Monitor();
  monitor._id = `5f8b7c1e2d3a4b5c6d7e${(1000 + idCounter).toString()}`;
  monitor.name = data.name;
  monitor.currentMonitorStatus = status;
  monitor.disableActiveMonitoring = false;
  monitor.disableActiveMonitoringBecauseOfManualIncident = false;
  monitor.disableActiveMonitoringBecauseOfScheduledMaintenanceEvent = Boolean(
    data.isPaused,
  );

  return monitor;
};

type IdsOfFunction = (monitors: Array<Monitor>) => Array<ObjectID>;

const idsOf: IdsOfFunction = (monitors: Array<Monitor>): Array<ObjectID> => {
  return monitors.map((monitor: Monitor) => {
    return new ObjectID(monitor._id!.toString());
  });
};

type ResolveMonitorsFunction = (monitors: Array<Monitor>) => void;

const resolveMonitors: ResolveMonitorsFunction = (
  monitors: Array<Monitor>,
): void => {
  getListMock.mockResolvedValue({
    data: monitors,
    count: monitors.length,
    skip: 0,
    limit: monitors.length,
  });
};

type HrefFunction = (pageKey: PageMap, modelId: ObjectID) => string;

const hrefFor: HrefFunction = (pageKey: PageMap, modelId: ObjectID): string => {
  return RouteUtil.populateRouteParams(RouteMap[pageKey] as Route, {
    modelId: modelId,
  }).toString();
};

type CardElementFunction = (
  overrides: Partial<ComponentProps>,
) => React.ReactElement;

const cardElement: CardElementFunction = (
  overrides: Partial<ComponentProps>,
): React.ReactElement => {
  return (
    <MemoryRouter>
      <SloMonitorsSummaryCard
        sloId={SLO_ID}
        monitorIds={[]}
        monitorRuleCount={0}
        enabledMonitorRuleCount={0}
        refreshToken={1}
        {...overrides}
      />
    </MemoryRouter>
  );
};

beforeEach(() => {
  // ProjectUtil and RouteUtil read the project from the URL, as in the app.
  window.history.pushState(
    {},
    "",
    `/dashboard/${PROJECT_ID.toString()}/slos/${SLO_ID.toString()}`,
  );
  getListMock.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("SloMonitorsSummaryCard without monitors", () => {
  test("a new SLO is told both ways to attach monitors, and nothing is fetched", () => {
    render(cardElement({}));

    const empty: HTMLElement = screen.getByTestId("slo-monitors-empty");

    expect(empty).toHaveTextContent("This SLO is not measuring any monitors");
    expect(
      within(empty).getByRole("link", { name: "Add monitors" }),
    ).toHaveAttribute("href", hrefFor(PageMap.SLO_VIEW_MONITORS, SLO_ID));
    expect(
      within(empty).getByRole("link", { name: "Create a monitor rule" }),
    ).toHaveAttribute("href", hrefFor(PageMap.SLO_VIEW_MONITOR_RULES, SLO_ID));
    expect(getListMock).not.toHaveBeenCalled();
  });

  test("rules that match nothing point at the rules, not at adding monitors", () => {
    render(cardElement({ monitorRuleCount: 2, enabledMonitorRuleCount: 2 }));

    const empty: HTMLElement = screen.getByTestId(
      "slo-monitors-empty-rules-match-nothing",
    );

    expect(empty).toHaveTextContent("Your monitor rules match no monitors yet");
    expect(empty).toHaveTextContent("no monitor in this project matches them");
    expect(
      within(empty).getByRole("link", { name: "Review monitor rules" }),
    ).toHaveAttribute("href", hrefFor(PageMap.SLO_VIEW_MONITOR_RULES, SLO_ID));
    expect(screen.queryByTestId("slo-monitors-empty")).toBeNull();
  });

  test("rules that are all disabled say so", () => {
    render(cardElement({ monitorRuleCount: 1, enabledMonitorRuleCount: 0 }));

    expect(
      screen.getByTestId("slo-monitors-empty-rules-match-nothing"),
    ).toHaveTextContent("Every monitor rule on this SLO is disabled");
  });
});

describe("SloMonitorsSummaryCard with monitors", () => {
  test("fetches exactly the SLO's monitors, with their status and paused flags, in one request", async () => {
    const monitors: Array<Monitor> = [
      buildMonitor({ name: "api", status: OPERATIONAL }),
      buildMonitor({ name: "checkout", status: OFFLINE }),
    ];
    resolveMonitors(monitors);

    render(cardElement({ monitorIds: idsOf(monitors) }));

    await waitFor(() => {
      expect(screen.getAllByTestId("slo-monitor-row")).toHaveLength(2);
    });

    expect(getListMock).toHaveBeenCalledTimes(1);

    const request: {
      modelType: unknown;
      query: { projectId: ObjectID; _id: Includes };
      select: Record<string, unknown>;
      sort: Record<string, unknown>;
    } = getListMock.mock.calls[0]![0];

    expect(request.modelType).toBe(Monitor);
    expect(request.query.projectId.toString()).toBe(PROJECT_ID.toString());
    expect(request.query._id).toBeInstanceOf(Includes);
    expect(
      (request.query._id.values as Array<ObjectID>).map((id: ObjectID) => {
        return id.toString();
      }),
    ).toEqual(
      idsOf(monitors).map((id: ObjectID) => {
        return id.toString();
      }),
    );
    expect(request.select).toEqual(
      expect.objectContaining({
        name: true,
        currentMonitorStatus: {
          name: true,
          color: true,
          isOperationalState: true,
          isOfflineState: true,
          priority: true,
        },
        disableActiveMonitoring: true,
        disableActiveMonitoringBecauseOfManualIncident: true,
        disableActiveMonitoringBecauseOfScheduledMaintenanceEvent: true,
      }),
    );
    expect(request.sort).toEqual({ name: SortOrder.Ascending });
  });

  test("puts what needs attention first, calls a paused monitor paused, and links each monitor", async () => {
    const monitors: Array<Monitor> = [
      buildMonitor({ name: "api", status: OPERATIONAL }),
      buildMonitor({ name: "batch", status: OFFLINE, isPaused: true }),
      buildMonitor({ name: "checkout", status: OFFLINE }),
    ];
    resolveMonitors(monitors);

    const { container }: RenderResult = render(
      cardElement({ monitorIds: idsOf(monitors), enabledMonitorRuleCount: 2 }),
    );

    await waitFor(() => {
      expect(screen.getAllByTestId("slo-monitor-row")).toHaveLength(3);
    });

    const summary: HTMLElement = screen.getByTestId(
      "slo-monitors-summary-text",
    );
    expect(summary).toHaveTextContent("1 of 3 monitors needs attention");
    expect(summary).toHaveClass("text-red-700");

    const rows: Array<HTMLElement> = screen.getAllByTestId("slo-monitor-row");

    expect(
      rows.map((row: HTMLElement) => {
        return within(row).getByRole("link").textContent;
      }),
    ).toEqual(["checkout", "batch", "api"]);

    expect(
      within(rows[0]!).getByLabelText("Status: Offline"),
    ).toBeInTheDocument();
    // Its last status was Offline, but nobody is measuring it.
    expect(within(rows[1]!).getByText("Paused")).toBeInTheDocument();
    expect(within(rows[1]!).queryByLabelText("Status: Offline")).toBeNull();

    expect(within(rows[0]!).getByRole("link")).toHaveAttribute(
      "href",
      hrefFor(PageMap.MONITOR_VIEW, idsOf(monitors)[2]!),
    );

    expect(
      container.querySelector('[title="Offline: 1 monitor"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[title="Paused: 1 monitor"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[title="Operational: 1 monitor"]'),
    ).not.toBeNull();

    expect(
      screen.getByRole("link", { name: "Kept in sync by 2 monitor rules" }),
    ).toHaveAttribute("href", hrefFor(PageMap.SLO_VIEW_MONITOR_RULES, SLO_ID));
    expect(
      screen.getByRole("link", { name: "Manage monitors" }),
    ).toHaveAttribute("href", hrefFor(PageMap.SLO_VIEW_MONITORS, SLO_ID));
  });

  test.each([
    [
      "all operational",
      [
        { name: "a", status: OPERATIONAL },
        { name: "b", status: OPERATIONAL },
      ],
      "All 2 monitors operational",
    ],
    [
      "one operational monitor",
      [{ name: "a", status: OPERATIONAL }],
      "The monitor is operational",
    ],
    [
      "every monitor paused",
      [
        { name: "a", status: OPERATIONAL, isPaused: true },
        { name: "b", status: OFFLINE, isPaused: true },
      ],
      "Every monitor is paused",
    ],
    [
      "some paused, none in trouble",
      [
        { name: "a", status: OPERATIONAL },
        { name: "b", status: DEGRADED, isPaused: true },
      ],
      "1 operational, 1 paused",
    ],
    [
      "two in trouble",
      [
        { name: "a", status: DEGRADED },
        { name: "b", status: OFFLINE },
        { name: "c", status: OPERATIONAL },
      ],
      "2 of 3 monitors need attention",
    ],
  ])(
    "summarises %s",
    async (
      _label: string,
      specs: Array<{ name: string; status: StatusSpec; isPaused?: boolean }>,
      expected: string,
    ) => {
      const monitors: Array<Monitor> = specs.map(
        (spec: { name: string; status: StatusSpec; isPaused?: boolean }) => {
          return buildMonitor(spec);
        },
      );
      resolveMonitors(monitors);

      render(cardElement({ monitorIds: idsOf(monitors) }));

      expect(
        await screen.findByTestId("slo-monitors-summary-text"),
      ).toHaveTextContent(expected);
    },
  );

  test("shows the most urgent few and links to the rest", async () => {
    const monitors: Array<Monitor> = [];

    for (let index: number = 0; index < 8; index++) {
      monitors.push(
        buildMonitor({ name: `monitor-${index}`, status: OPERATIONAL }),
      );
    }

    resolveMonitors(monitors);

    render(cardElement({ monitorIds: idsOf(monitors) }));

    await waitFor(() => {
      expect(screen.getAllByTestId("slo-monitor-row")).toHaveLength(
        SLO_OVERVIEW_MAX_MONITOR_ROWS,
      );
    });

    expect(
      screen.getByRole("link", { name: "View all 8 monitors" }),
    ).toHaveAttribute("href", hrefFor(PageMap.SLO_VIEW_MONITORS, SLO_ID));
  });

  test("refetches when the poll token or the ids change, not when the page rebuilds the same ids", async () => {
    const monitors: Array<Monitor> = [
      buildMonitor({ name: "api", status: OPERATIONAL }),
    ];
    resolveMonitors(monitors);

    const { rerender }: RenderResult = render(
      cardElement({ monitorIds: idsOf(monitors), refreshToken: 1 }),
    );

    await screen.findByTestId("slo-monitor-row");
    expect(getListMock).toHaveBeenCalledTimes(1);

    // A new array holding the same ids, as every page poll produces.
    rerender(cardElement({ monitorIds: idsOf(monitors), refreshToken: 1 }));
    expect(getListMock).toHaveBeenCalledTimes(1);

    rerender(cardElement({ monitorIds: idsOf(monitors), refreshToken: 2 }));
    await waitFor(() => {
      expect(getListMock).toHaveBeenCalledTimes(2);
    });

    const more: Array<Monitor> = [
      ...monitors,
      buildMonitor({ name: "web", status: OPERATIONAL }),
    ];
    resolveMonitors(more);

    rerender(cardElement({ monitorIds: idsOf(more), refreshToken: 2 }));
    await waitFor(() => {
      expect(getListMock).toHaveBeenCalledTimes(3);
    });
    await waitFor(() => {
      expect(screen.getAllByTestId("slo-monitor-row")).toHaveLength(2);
    });
  });

  test("a failed fetch says why instead of pretending there are no monitors", async () => {
    getListMock.mockRejectedValue(new Error("Monitors are unavailable."));

    render(
      cardElement({
        monitorIds: [new ObjectID("5f8b7c1e2d3a4b5c6d7e8f55")],
      }),
    );

    expect(
      await screen.findByText("Monitors are unavailable."),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("slo-monitors-empty")).toBeNull();
    expect(screen.queryByTestId("slo-monitor-row")).toBeNull();
  });
});
