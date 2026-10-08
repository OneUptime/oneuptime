import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import * as fs from "fs";
import * as path from "path";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The overview tiles on Home, as a brand-new project sees them.
 *
 * They used to read "Inoperational monitors 0 - All operational" and "SLOs at
 * risk 0 - Budgets healthy" before anything existed, as though monitors and
 * SLOs were watching and had found nothing wrong. The two tiles now also count
 * what exists, and with nothing to count they say "No monitors yet" / "No SLOs
 * yet" and open the list where one is created (Monitors, SLOs).
 *
 * The real component is mounted. ModelAPI.count is answered by a small
 * in-memory evaluator of the very query objects the component builds, so a
 * test about "archived SLOs are not set up" checks the query's meaning, not
 * just its shape. The unresolved incident and alert states come through the
 * real IncidentStateUtil / AlertStateUtil, and the in-progress scheduled
 * maintenance states through the real ScheduledMaintenanceStateUtil, over a
 * stubbed ModelListCache. react-i18next is answered from the REAL locale
 * files.
 */

const LOCALES_DIR: string = path.join(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

type LocaleData = Record<string, unknown>;

function readLocale(code: string): LocaleData {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${code}.json`), "utf8"),
  ) as LocaleData;
}

const EN: LocaleData = readLocale("en");
const DE: LocaleData = readLocale("de");

let activeLocale: LocaleData = EN;

function lookupNested(data: LocaleData, key: string): string | undefined {
  let cursor: unknown = data;
  for (const part of key.split(".")) {
    if (!cursor || typeof cursor !== "object") {
      return undefined;
    }
    cursor = (cursor as Record<string, unknown>)[part];
  }
  return typeof cursor === "string" ? cursor : undefined;
}

const navigateMock: MockFunction = getJestMockFunction();
const countMock: MockFunction = getJestMockFunction();
const listMock: MockFunction = getJestMockFunction();

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, options?: unknown): string => {
          if (
            options &&
            typeof options === "object" &&
            (options as { keySeparator?: unknown }).keySeparator === false
          ) {
            const flat: unknown = activeLocale[key];
            return typeof flat === "string"
              ? flat
              : (options as { defaultValue?: string }).defaultValue ?? key;
          }
          return (
            lookupNested(activeLocale, key) ??
            (typeof options === "string" ? options : key)
          );
        },
        i18n: { language: "en" },
      };
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      count: (...args: Array<unknown>) => {
        return countMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelListCache", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>) => {
        return listMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/Navigation", () => {
  return {
    __esModule: true,
    default: {
      navigate: (...args: Array<unknown>) => {
        return navigateMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: () => {
        // Read lazily: the constant below is not initialised when this runs.
        return currentProjectId;
      },
    },
  };
});

import OverviewStats, {
  NO_MONITORS_YET_LABEL,
  NO_SLOS_YET_LABEL,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Home/OverviewStats";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import Alert from "../../../Models/DatabaseModels/Alert";
import AlertState from "../../../Models/DatabaseModels/AlertState";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentState from "../../../Models/DatabaseModels/IncidentState";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import ScheduledMaintenance from "../../../Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceState from "../../../Models/DatabaseModels/ScheduledMaintenanceState";
import ServiceLevelObjective from "../../../Models/DatabaseModels/ServiceLevelObjective";
import Includes from "../../../Types/BaseDatabase/Includes";
import ObjectID from "../../../Types/ObjectID";
import SloStatus from "../../../Types/ServiceLevelObjective/SloStatus";

const PROJECT_ID: string = "65f00000000000000000cccc";
let currentProjectId: ObjectID | null = null;

// Incident and alert states in their workflow order: two open, then resolved.
const OPEN_STATE_ID: string = "65f000000000000000000001";
const ACKNOWLEDGED_STATE_ID: string = "65f000000000000000000002";
const RESOLVED_STATE_ID: string = "65f000000000000000000003";

interface StateRow {
  id: ObjectID;
  _id: string;
  isResolvedState: boolean;
}

function stateRows(): Array<StateRow> {
  return [
    {
      id: new ObjectID(OPEN_STATE_ID),
      _id: OPEN_STATE_ID,
      isResolvedState: false,
    },
    {
      id: new ObjectID(ACKNOWLEDGED_STATE_ID),
      _id: ACKNOWLEDGED_STATE_ID,
      isResolvedState: false,
    },
    {
      id: new ObjectID(RESOLVED_STATE_ID),
      _id: RESOLVED_STATE_ID,
      isResolvedState: true,
    },
  ];
}

/*
 * The project's scheduled maintenance states in their order: the four
 * built-in ones, with a state of the project's own between Ongoing and Ended
 * ("Verifying": still in progress) and one after Ended ("Reviewing": over).
 */
const SM_SCHEDULED_STATE_ID: string = "65f000000000000000000011";
const SM_ONGOING_STATE_ID: string = "65f000000000000000000012";
const SM_VERIFYING_STATE_ID: string = "65f000000000000000000013";
const SM_ENDED_STATE_ID: string = "65f000000000000000000014";
const SM_REVIEWING_STATE_ID: string = "65f000000000000000000015";
const SM_COMPLETED_STATE_ID: string = "65f000000000000000000016";

interface ScheduledMaintenanceStateRow {
  id: ObjectID;
  _id: string;
  order: number;
  isScheduledState: boolean;
  isOngoingState: boolean;
  isEndedState: boolean;
  isResolvedState: boolean;
}

function scheduledMaintenanceStateRow(
  id: string,
  order: number,
  flag:
    | "isScheduledState"
    | "isOngoingState"
    | "isEndedState"
    | "isResolvedState"
    | null,
): ScheduledMaintenanceStateRow {
  return {
    id: new ObjectID(id),
    _id: id,
    order,
    isScheduledState: flag === "isScheduledState",
    isOngoingState: flag === "isOngoingState",
    isEndedState: flag === "isEndedState",
    isResolvedState: flag === "isResolvedState",
  };
}

function scheduledMaintenanceStateRows(): Array<ScheduledMaintenanceStateRow> {
  return [
    scheduledMaintenanceStateRow(SM_SCHEDULED_STATE_ID, 1, "isScheduledState"),
    scheduledMaintenanceStateRow(SM_ONGOING_STATE_ID, 2, "isOngoingState"),
    scheduledMaintenanceStateRow(SM_VERIFYING_STATE_ID, 3, null),
    scheduledMaintenanceStateRow(SM_ENDED_STATE_ID, 4, "isEndedState"),
    scheduledMaintenanceStateRow(SM_REVIEWING_STATE_ID, 5, null),
    scheduledMaintenanceStateRow(SM_COMPLETED_STATE_ID, 6, "isResolvedState"),
  ];
}

let smStateRows: Array<ScheduledMaintenanceStateRow> =
  scheduledMaintenanceStateRows();

// What the project holds. Every count is evaluated against this.
interface Dataset {
  incidentStateIds: Array<string>;
  alertStateIds: Array<string>;
  monitors: Array<{ isOperational: boolean }>;
  // Each event's current state.
  maintenanceStateIds: Array<string>;
  slos: Array<{ isEnabled: boolean; isArchived: boolean; status: SloStatus }>;
}

function emptyProject(): Dataset {
  return {
    incidentStateIds: [],
    alertStateIds: [],
    monitors: [],
    maintenanceStateIds: [],
    slos: [],
  };
}

let dataset: Dataset = emptyProject();

type CountKind =
  | "activeIncidents"
  | "activeAlerts"
  | "notOperationalMonitors"
  | "totalMonitors"
  | "ongoingMaintenance"
  | "slosAtRisk"
  | "totalSlos";

interface CountRequest {
  modelType: unknown;
  query: Record<string, unknown>;
}

function kindOf(request: CountRequest): CountKind {
  const query: Record<string, unknown> = request.query;

  if (request.modelType === Incident) {
    return "activeIncidents";
  }
  if (request.modelType === Alert) {
    return "activeAlerts";
  }
  if (request.modelType === Monitor) {
    return "currentMonitorStatus" in query
      ? "notOperationalMonitors"
      : "totalMonitors";
  }
  if (request.modelType === ScheduledMaintenance) {
    return "ongoingMaintenance";
  }
  if (request.modelType === ServiceLevelObjective) {
    return "sloStatus" in query ? "slosAtRisk" : "totalSlos";
  }
  throw new Error(
    `Unexpected count on ${String((request.modelType as { name?: string })?.name)}`,
  );
}

function idsIn(value: unknown): Array<string> {
  return ((value as Includes).values as Array<unknown>).map(
    (id: unknown): string => {
      return String(id);
    },
  );
}

// Answers a count the way the database would, from `dataset`.
function evaluate(request: CountRequest): number {
  const query: Record<string, unknown> = request.query;

  expect(String(query["projectId"])).toBe(PROJECT_ID);

  switch (kindOf(request)) {
    case "activeIncidents": {
      const open: Array<string> = idsIn(query["currentIncidentStateId"]);
      return dataset.incidentStateIds.filter((id: string): boolean => {
        return open.includes(id);
      }).length;
    }
    case "activeAlerts": {
      const open: Array<string> = idsIn(query["currentAlertStateId"]);
      return dataset.alertStateIds.filter((id: string): boolean => {
        return open.includes(id);
      }).length;
    }
    case "notOperationalMonitors": {
      const wanted: boolean = (
        query["currentMonitorStatus"] as { isOperationalState: boolean }
      ).isOperationalState;
      return dataset.monitors.filter((monitor: { isOperational: boolean }) => {
        return monitor.isOperational === wanted;
      }).length;
    }
    case "totalMonitors":
      return dataset.monitors.length;
    case "ongoingMaintenance": {
      const inProgress: Array<string> = idsIn(
        query["currentScheduledMaintenanceStateId"],
      );
      return dataset.maintenanceStateIds.filter((id: string): boolean => {
        return inProgress.includes(id);
      }).length;
    }
    case "slosAtRisk":
    case "totalSlos":
      return dataset.slos.filter(
        (slo: {
          isEnabled: boolean;
          isArchived: boolean;
          status: SloStatus;
        }): boolean => {
          if ("isEnabled" in query && slo.isEnabled !== query["isEnabled"]) {
            return false;
          }
          if ("isArchived" in query && slo.isArchived !== query["isArchived"]) {
            return false;
          }
          if (
            "sloStatus" in query &&
            !idsIn(query["sloStatus"]).includes(slo.status)
          ) {
            return false;
          }
          return true;
        },
      ).length;
  }
}

let countRequests: Array<CountRequest> = [];

function answerFromDataset(): void {
  countMock.mockImplementation((...args: Array<unknown>) => {
    const request: CountRequest = args[0] as CountRequest;
    countRequests.push(request);
    return Promise.resolve(evaluate(request));
  });
}

function requestsOf(kind: CountKind): Array<CountRequest> {
  return countRequests.filter((request: CountRequest): boolean => {
    return kindOf(request) === kind;
  });
}

async function renderStats(): Promise<void> {
  await act(async () => {
    render(<OverviewStats projectId={new ObjectID(PROJECT_ID)} />);
  });
  await waitFor(() => {
    expect(
      screen.getByTestId("home-stat-not-operational-monitors-status"),
    ).toBeInTheDocument();
  });
}

const TILE_KEYS: Array<string> = [
  "active-incidents",
  "active-alerts",
  "not-operational-monitors",
  "ongoing-maintenance",
  "slos-needing-attention",
];

function statusOf(key: string): HTMLElement {
  return screen.getByTestId(`home-stat-${key}-status`);
}

function tileOf(key: string): HTMLElement {
  return screen
    .getByTestId(`home-stat-${key}`)
    .closest('[role="button"]') as HTMLElement;
}

function clickTile(key: string): string {
  fireEvent.click(tileOf(key));
  expect(navigateMock).toHaveBeenCalledTimes(1);
  return String(navigateMock.mock.calls[0]![0]);
}

function routeOf(pageMap: PageMap): string {
  return RouteMap[pageMap]!.toString().replace(":projectId", PROJECT_ID);
}

function sloRow(
  status: SloStatus,
  overrides: { isEnabled?: boolean; isArchived?: boolean } = {},
): { isEnabled: boolean; isArchived: boolean; status: SloStatus } {
  return {
    isEnabled: overrides.isEnabled ?? true,
    isArchived: overrides.isArchived ?? false,
    status,
  };
}

beforeEach(() => {
  activeLocale = EN;
  currentProjectId = new ObjectID(PROJECT_ID);
  dataset = emptyProject();
  smStateRows = scheduledMaintenanceStateRows();
  countRequests = [];
  answerFromDataset();
  listMock.mockImplementation((...args: Array<unknown>) => {
    const request: { modelType: unknown } = args[0] as { modelType: unknown };
    if (request.modelType === ScheduledMaintenanceState) {
      return Promise.resolve({
        data: smStateRows,
        count: smStateRows.length,
        skip: 0,
        limit: smStateRows.length,
      });
    }
    if (
      request.modelType !== IncidentState &&
      request.modelType !== AlertState
    ) {
      throw new Error("Unexpected list request");
    }
    const rows: Array<StateRow> = stateRows();
    return Promise.resolve({
      data: rows,
      count: rows.length,
      skip: 0,
      limit: rows.length,
    });
  });
});

afterEach(() => {
  cleanup();
  navigateMock.mockReset();
  countMock.mockReset();
  listMock.mockReset();
});

describe("a brand-new project", () => {
  test("says there are no monitors and no SLOs yet, instead of all clear", async () => {
    await renderStats();

    expect(statusOf("not-operational-monitors")).toHaveTextContent(
      "No monitors yet",
    );
    expect(statusOf("slos-needing-attention")).toHaveTextContent("No SLOs yet");
    expect(statusOf("not-operational-monitors")).not.toHaveTextContent(
      "All operational",
    );
    expect(statusOf("slos-needing-attention")).not.toHaveTextContent(
      "Budgets healthy",
    );
  });

  test("the not-set-up lines are the exported copy", async () => {
    await renderStats();

    expect(NO_MONITORS_YET_LABEL).toBe("No monitors yet");
    expect(NO_SLOS_YET_LABEL).toBe("No SLOs yet");
    expect(statusOf("not-operational-monitors").textContent?.trim()).toBe(
      NO_MONITORS_YET_LABEL,
    );
    expect(statusOf("slos-needing-attention").textContent?.trim()).toBe(
      NO_SLOS_YET_LABEL,
    );
  });

  test("the not-set-up lines are grey, not the green of all clear", async () => {
    await renderStats();

    for (const key of ["not-operational-monitors", "slos-needing-attention"]) {
      expect(statusOf(key)).toHaveClass("text-gray-500");
      expect(statusOf(key)).not.toHaveClass("text-emerald-600");
    }
  });

  test("the tiles that are true with nothing set up keep their reading", async () => {
    await renderStats();

    expect(statusOf("active-incidents")).toHaveTextContent("All clear");
    expect(statusOf("active-alerts")).toHaveTextContent("All clear");
    expect(statusOf("ongoing-maintenance")).toHaveTextContent("None ongoing");
    for (const key of [
      "active-incidents",
      "active-alerts",
      "ongoing-maintenance",
    ]) {
      expect(statusOf(key)).toHaveClass("text-emerald-600");
    }
  });

  test("every tile still shows its count, zero here", async () => {
    await renderStats();

    for (const key of TILE_KEYS) {
      expect(screen.getByTestId(`home-stat-${key}`)).toHaveTextContent("0");
    }
  });

  test("the monitors tile opens the Monitors list, where Create Monitor is", async () => {
    await renderStats();

    const route: string = clickTile("not-operational-monitors");

    expect(route).toBe(routeOf(PageMap.MONITORS));
    /*
     * The list's own empty state carries the permission-gated button; the
     * form would open even for someone who cannot submit it.
     */
    expect(route).not.toBe(routeOf(PageMap.MONITOR_CREATE));
    expect(route).not.toBe(routeOf(PageMap.HOME_NOT_OPERATIONAL_MONITORS));
  });

  test("the SLO tile opens the SLOs page, where one is created", async () => {
    await renderStats();

    expect(clickTile("slos-needing-attention")).toBe(routeOf(PageMap.SLOS));
  });

  test("the other tiles open their usual pages", async () => {
    await renderStats();

    expect(clickTile("active-incidents")).toBe(routeOf(PageMap.HOME));
    navigateMock.mockReset();
    expect(clickTile("active-alerts")).toBe(
      routeOf(PageMap.HOME_ACTIVE_ALERTS),
    );
    navigateMock.mockReset();
    expect(clickTile("ongoing-maintenance")).toBe(
      routeOf(PageMap.HOME_ONGOING_SCHEDULED_MAINTENANCE_EVENTS),
    );
  });
});

describe("a project with monitors", () => {
  test("none failing: all operational, and the tile opens the not operational list", async () => {
    dataset.monitors = [
      { isOperational: true },
      { isOperational: true },
      { isOperational: true },
    ];
    await renderStats();

    expect(statusOf("not-operational-monitors")).toHaveTextContent(
      "All operational",
    );
    expect(statusOf("not-operational-monitors")).toHaveClass(
      "text-emerald-600",
    );
    expect(clickTile("not-operational-monitors")).toBe(
      routeOf(PageMap.HOME_NOT_OPERATIONAL_MONITORS),
    );
  });

  test("some failing: the count and Needs attention, in red", async () => {
    dataset.monitors = [
      { isOperational: false },
      { isOperational: true },
      { isOperational: false },
    ];
    await renderStats();

    expect(
      screen.getByTestId("home-stat-not-operational-monitors"),
    ).toHaveTextContent("2");
    expect(statusOf("not-operational-monitors")).toHaveTextContent(
      "Needs attention",
    );
    expect(statusOf("not-operational-monitors")).toHaveClass("text-red-600");
    expect(clickTile("not-operational-monitors")).toBe(
      routeOf(PageMap.HOME_NOT_OPERATIONAL_MONITORS),
    );
  });

  test("the SLO tile is judged on its own: monitors but no SLOs", async () => {
    dataset.monitors = [{ isOperational: true }];
    await renderStats();

    expect(statusOf("not-operational-monitors")).toHaveTextContent(
      "All operational",
    );
    expect(statusOf("slos-needing-attention")).toHaveTextContent("No SLOs yet");
  });
});

describe("a project with SLOs", () => {
  test("none at risk: budgets healthy, and the tile opens SLOs", async () => {
    dataset.slos = [sloRow(SloStatus.Healthy), sloRow(SloStatus.Healthy)];
    await renderStats();

    expect(statusOf("slos-needing-attention")).toHaveTextContent(
      "Budgets healthy",
    );
    expect(clickTile("slos-needing-attention")).toBe(routeOf(PageMap.SLOS));
  });

  test("at risk or exhausted: budget burning, with the count", async () => {
    dataset.slos = [
      sloRow(SloStatus.AtRisk),
      sloRow(SloStatus.BudgetExhausted),
      sloRow(SloStatus.Healthy),
    ];
    await renderStats();

    expect(
      screen.getByTestId("home-stat-slos-needing-attention"),
    ).toHaveTextContent("2");
    expect(statusOf("slos-needing-attention")).toHaveTextContent(
      "Budget burning",
    );
    expect(statusOf("slos-needing-attention")).toHaveClass("text-amber-600");
  });

  test("only disabled SLOs still count as set up", async () => {
    dataset.slos = [sloRow(SloStatus.AtRisk, { isEnabled: false })];
    await renderStats();

    expect(statusOf("slos-needing-attention")).toHaveTextContent(
      "Budgets healthy",
    );
    expect(statusOf("slos-needing-attention")).not.toHaveTextContent(
      "No SLOs yet",
    );
  });

  test("only archived SLOs are not set up", async () => {
    dataset.slos = [
      sloRow(SloStatus.AtRisk, { isArchived: true }),
      sloRow(SloStatus.Healthy, { isArchived: true }),
    ];
    await renderStats();

    expect(statusOf("slos-needing-attention")).toHaveTextContent("No SLOs yet");
    expect(clickTile("slos-needing-attention")).toBe(routeOf(PageMap.SLOS));
  });
});

describe("incidents, alerts and maintenance", () => {
  test("open incidents and alerts need attention; resolved ones do not count", async () => {
    dataset.incidentStateIds = [
      OPEN_STATE_ID,
      ACKNOWLEDGED_STATE_ID,
      RESOLVED_STATE_ID,
    ];
    dataset.alertStateIds = [RESOLVED_STATE_ID, OPEN_STATE_ID];
    dataset.monitors = [{ isOperational: true }];
    await renderStats();

    expect(screen.getByTestId("home-stat-active-incidents")).toHaveTextContent(
      "2",
    );
    expect(statusOf("active-incidents")).toHaveTextContent("Needs attention");
    expect(screen.getByTestId("home-stat-active-alerts")).toHaveTextContent(
      "1",
    );
    expect(statusOf("active-alerts")).toHaveTextContent("Needs attention");
  });

  test("ongoing maintenance is in progress", async () => {
    dataset.maintenanceStateIds = [SM_ONGOING_STATE_ID, SM_SCHEDULED_STATE_ID];
    await renderStats();

    expect(
      screen.getByTestId("home-stat-ongoing-maintenance"),
    ).toHaveTextContent("1");
    expect(statusOf("ongoing-maintenance")).toHaveTextContent("In progress");
  });

  test("an event in a state of the project's own between Ongoing and Ended is in progress", async () => {
    // "Verifying": the event's work is done, not its window.
    dataset.maintenanceStateIds = [SM_VERIFYING_STATE_ID];
    await renderStats();

    expect(
      screen.getByTestId("home-stat-ongoing-maintenance"),
    ).toHaveTextContent("1");
    expect(statusOf("ongoing-maintenance")).toHaveTextContent("In progress");
  });

  test("an event in a state of its own after Ended is over, as is one in Ended or Completed", async () => {
    dataset.maintenanceStateIds = [
      SM_REVIEWING_STATE_ID,
      SM_ENDED_STATE_ID,
      SM_COMPLETED_STATE_ID,
      SM_SCHEDULED_STATE_ID,
    ];
    await renderStats();

    expect(
      screen.getByTestId("home-stat-ongoing-maintenance"),
    ).toHaveTextContent("0");
    expect(statusOf("ongoing-maintenance")).toHaveTextContent("None ongoing");
  });

  test("Ongoing, Verifying and the rest together: the in-progress ones count", async () => {
    dataset.maintenanceStateIds = [
      SM_ONGOING_STATE_ID,
      SM_VERIFYING_STATE_ID,
      SM_VERIFYING_STATE_ID,
      SM_REVIEWING_STATE_ID,
      SM_SCHEDULED_STATE_ID,
    ];
    await renderStats();

    expect(
      screen.getByTestId("home-stat-ongoing-maintenance"),
    ).toHaveTextContent("3");
  });

  test("the states' place decides, not their position in the answer", async () => {
    // The same states answered out of order: their own `order` places them.
    smStateRows = [...scheduledMaintenanceStateRows()].reverse();
    dataset.maintenanceStateIds = [
      SM_VERIFYING_STATE_ID,
      SM_REVIEWING_STATE_ID,
    ];
    await renderStats();

    expect(
      screen.getByTestId("home-stat-ongoing-maintenance"),
    ).toHaveTextContent("1");
  });
});

describe("the ongoing maintenance count", () => {
  test("asks for events by the in-progress state ids, not by the ongoing flag", async () => {
    await renderStats();

    const [request]: Array<CountRequest> = requestsOf("ongoingMaintenance");
    expect(requestsOf("ongoingMaintenance")).toHaveLength(1);
    expect(Object.keys(request!.query).sort()).toEqual([
      "currentScheduledMaintenanceStateId",
      "projectId",
    ]);
    expect(request!.query["currentScheduledMaintenanceStateId"]).toBeInstanceOf(
      Includes,
    );
    expect(
      idsIn(request!.query["currentScheduledMaintenanceStateId"]).sort(),
    ).toEqual([SM_ONGOING_STATE_ID, SM_VERIFYING_STATE_ID].sort());
  });

  test("the project's states are read once, through the list cache, for this project", async () => {
    await renderStats();

    const smListRequests: Array<Array<unknown>> = listMock.mock.calls.filter(
      (call: Array<unknown>): boolean => {
        return (
          (call[0] as { modelType: unknown }).modelType ===
          ScheduledMaintenanceState
        );
      },
    );
    expect(smListRequests).toHaveLength(1);
    const request: {
      query: Record<string, unknown>;
      select: Record<string, unknown>;
    } = smListRequests[0]![0] as {
      query: Record<string, unknown>;
      select: Record<string, unknown>;
    };
    expect(String(request.query["projectId"])).toBe(PROJECT_ID);
    // The place and every built-in flag: what the rule reads.
    for (const column of [
      "_id",
      "order",
      "isScheduledState",
      "isOngoingState",
      "isEndedState",
      "isResolvedState",
    ]) {
      expect([column, request.select[column]]).toEqual([column, true]);
    }
  });

  test("a project without an ongoing state counts none, and asks nothing for it", async () => {
    smStateRows = scheduledMaintenanceStateRows().filter(
      (state: ScheduledMaintenanceStateRow): boolean => {
        return !state.isOngoingState;
      },
    );
    dataset.maintenanceStateIds = [SM_VERIFYING_STATE_ID];
    await renderStats();

    expect(requestsOf("ongoingMaintenance")).toHaveLength(0);
    expect(countRequests).toHaveLength(6);
    expect(
      screen.getByTestId("home-stat-ongoing-maintenance"),
    ).toHaveTextContent("0");
    expect(statusOf("ongoing-maintenance")).toHaveTextContent("None ongoing");
  });

  test("a failed read of the states hides the whole row, like a failed count", async () => {
    listMock.mockImplementation((...args: Array<unknown>) => {
      const request: { modelType: unknown } = args[0] as {
        modelType: unknown;
      };
      if (request.modelType === ScheduledMaintenanceState) {
        return Promise.reject(new Error("states failed"));
      }
      const rows: Array<StateRow> = stateRows();
      return Promise.resolve({
        data: rows,
        count: rows.length,
        skip: 0,
        limit: rows.length,
      });
    });

    await act(async () => {
      render(<OverviewStats projectId={new ObjectID(PROJECT_ID)} />);
    });

    await waitFor(() => {
      expect(countRequests.length).toBeGreaterThanOrEqual(6);
    });
    await waitFor(() => {
      expect(screen.queryByTestId("home-overview-stats")).toBeNull();
    });
  });
});

describe("the requests behind the tiles", () => {
  test("exactly seven counts per load", async () => {
    await renderStats();

    expect(countRequests).toHaveLength(7);
    expect(
      countRequests.map(kindOf).sort((a: string, b: string) => {
        return a.localeCompare(b);
      }),
    ).toEqual(
      [
        "activeAlerts",
        "activeIncidents",
        "notOperationalMonitors",
        "ongoingMaintenance",
        "slosAtRisk",
        "totalMonitors",
        "totalSlos",
      ].sort((a: string, b: string) => {
        return a.localeCompare(b);
      }),
    );
  });

  test("the monitor total counts every monitor that is not archived, whatever its state", async () => {
    await renderStats();

    /*
     * Archived monitors are gone from the Monitors list the tile opens, so a
     * project whose monitors are all archived reads as "no monitors yet",
     * the same as the SLO tile does for archived SLOs.
     */
    const [request]: Array<CountRequest> = requestsOf("totalMonitors");
    expect(requestsOf("totalMonitors")).toHaveLength(1);
    expect(Object.keys(request!.query).sort()).toEqual([
      "isArchived",
      "projectId",
    ]);
    expect(request!.query["isArchived"]).toBe(false);
    expect(String(request!.query["projectId"])).toBe(PROJECT_ID);
  });

  test("the not-operational count leaves archived monitors out: their status is frozen", async () => {
    await renderStats();

    const [request]: Array<CountRequest> = requestsOf("notOperationalMonitors");
    expect(requestsOf("notOperationalMonitors")).toHaveLength(1);
    expect(request!.query["isArchived"]).toBe(false);
  });

  test("the SLO total is every SLO that is not archived, enabled or not", async () => {
    await renderStats();

    const [request]: Array<CountRequest> = requestsOf("totalSlos");
    expect(requestsOf("totalSlos")).toHaveLength(1);
    expect(Object.keys(request!.query).sort()).toEqual([
      "isArchived",
      "projectId",
    ]);
    expect(request!.query["isArchived"]).toBe(false);
    expect("isEnabled" in request!.query).toBe(false);
  });

  test("the at-risk count is unchanged: enabled, not archived, at risk or exhausted", async () => {
    await renderStats();

    const [request]: Array<CountRequest> = requestsOf("slosAtRisk");
    expect(request!.query["isEnabled"]).toBe(true);
    expect(request!.query["isArchived"]).toBe(false);
    expect(idsIn(request!.query["sloStatus"]).sort()).toEqual(
      [SloStatus.AtRisk, SloStatus.BudgetExhausted].sort(),
    );
  });

  test("all seven go out together: none waits for another to answer", async () => {
    const pending: Array<{ request: CountRequest; resolve: () => void }> = [];
    countMock.mockImplementation((...args: Array<unknown>) => {
      const request: CountRequest = args[0] as CountRequest;
      countRequests.push(request);
      return new Promise<number>((resolve: (value: number) => void) => {
        pending.push({
          request,
          resolve: (): void => {
            resolve(evaluate(request));
          },
        });
      });
    });
    dataset.monitors = [{ isOperational: false }];

    await act(async () => {
      render(<OverviewStats projectId={new ObjectID(PROJECT_ID)} />);
    });

    // Every count is in flight before a single one has been answered.
    await waitFor(() => {
      expect(pending).toHaveLength(7);
    });
    expect(
      screen.queryByTestId("home-stat-not-operational-monitors-status"),
    ).toBeNull();

    // Answered in the reverse of the order they were asked.
    await act(async () => {
      for (const entry of [...pending].reverse()) {
        entry.resolve();
      }
    });

    await waitFor(() => {
      expect(statusOf("not-operational-monitors")).toHaveTextContent(
        "Needs attention",
      );
    });
    expect(statusOf("slos-needing-attention")).toHaveTextContent("No SLOs yet");
    expect(countRequests).toHaveLength(7);
  });

  test.each([
    "activeIncidents",
    "activeAlerts",
    "notOperationalMonitors",
    "totalMonitors",
    "ongoingMaintenance",
    "slosAtRisk",
    "totalSlos",
  ] as Array<CountKind>)(
    "a failed %s count hides the whole row",
    async (failing: CountKind) => {
      countMock.mockImplementation((...args: Array<unknown>) => {
        const request: CountRequest = args[0] as CountRequest;
        countRequests.push(request);
        if (kindOf(request) === failing) {
          return Promise.reject(new Error("count failed"));
        }
        return Promise.resolve(evaluate(request));
      });

      await act(async () => {
        render(<OverviewStats projectId={new ObjectID(PROJECT_ID)} />);
      });

      await waitFor(() => {
        expect(countRequests.length).toBeGreaterThanOrEqual(7);
      });
      await waitFor(() => {
        expect(screen.queryByTestId("home-overview-stats")).toBeNull();
      });
    },
  );
});

describe("the wording", () => {
  test("the monitors tile is titled Not operational monitors", async () => {
    await renderStats();

    expect(tileOf("not-operational-monitors")).toHaveTextContent(
      "Not operational monitors",
    );
  });

  test("nothing on the row says Inoperational", async () => {
    dataset.monitors = [{ isOperational: false }];
    const { container } = render(
      <OverviewStats projectId={new ObjectID(PROJECT_ID)} />,
    );
    await waitFor(() => {
      expect(statusOf("not-operational-monitors")).toBeInTheDocument();
    });

    expect(container.textContent || "").not.toMatch(/inoperational/i);
  });

  test("the tiles are in the same order as before", async () => {
    await renderStats();

    const keys: Array<string> = screen
      .getAllByTestId(/^home-stat-[a-z-]+$/)
      .map((element: HTMLElement): string => {
        return element.getAttribute("data-testid") || "";
      })
      .filter((testId: string): boolean => {
        return !testId.endsWith("-status");
      })
      .map((testId: string): string => {
        return testId.replace("home-stat-", "");
      });

    expect(keys).toEqual(TILE_KEYS);
  });
});

describe("in German", () => {
  const TITLES: Array<[string, string]> = [
    ["active-incidents", "Active incidents"],
    ["active-alerts", "Active alerts"],
    ["not-operational-monitors", "Not operational monitors"],
    ["ongoing-maintenance", "Ongoing maintenance"],
    ["slos-needing-attention", "SLOs at risk"],
  ];

  function german(english: string): string {
    const value: unknown = DE[english];
    expect([english, typeof value]).toEqual([english, "string"]);
    expect(value).not.toBe(english);
    return value as string;
  }

  test("every tile title is the de.json translation", async () => {
    activeLocale = DE;
    await renderStats();

    for (const [key, english] of TITLES) {
      expect(tileOf(key)).toHaveTextContent(german(english));
      expect(tileOf(key)).not.toHaveTextContent(english);
    }
  });

  test("the not-set-up and all-clear lines are translated", async () => {
    activeLocale = DE;
    await renderStats();

    expect(statusOf("active-incidents")).toHaveTextContent(german("All clear"));
    expect(statusOf("active-alerts")).toHaveTextContent(german("All clear"));
    expect(statusOf("not-operational-monitors")).toHaveTextContent(
      german("No monitors yet"),
    );
    expect(statusOf("ongoing-maintenance")).toHaveTextContent(
      german("None ongoing"),
    );
    expect(statusOf("slos-needing-attention")).toHaveTextContent(
      german("No SLOs yet"),
    );
  });

  test("the attention lines are translated", async () => {
    activeLocale = DE;
    dataset.incidentStateIds = [OPEN_STATE_ID];
    dataset.monitors = [{ isOperational: false }];
    dataset.maintenanceStateIds = [SM_ONGOING_STATE_ID];
    dataset.slos = [sloRow(SloStatus.AtRisk)];
    await renderStats();

    expect(statusOf("active-incidents")).toHaveTextContent(
      german("Needs attention"),
    );
    expect(statusOf("not-operational-monitors")).toHaveTextContent(
      german("Needs attention"),
    );
    expect(statusOf("ongoing-maintenance")).toHaveTextContent(
      german("In progress"),
    );
    expect(statusOf("slos-needing-attention")).toHaveTextContent(
      german("Budget burning"),
    );
  });

  test("the healthy lines are translated", async () => {
    activeLocale = DE;
    dataset.monitors = [{ isOperational: true }];
    dataset.slos = [sloRow(SloStatus.Healthy)];
    await renderStats();

    expect(statusOf("not-operational-monitors")).toHaveTextContent(
      german("All operational"),
    );
    expect(statusOf("slos-needing-attention")).toHaveTextContent(
      german("Budgets healthy"),
    );
  });

  test("no line is left in English", async () => {
    activeLocale = DE;
    await renderStats();

    for (const english of [
      "All clear",
      "No monitors yet",
      "None ongoing",
      "No SLOs yet",
    ]) {
      expect(screen.getByTestId("home-overview-stats")).not.toHaveTextContent(
        english,
      );
    }
  });
});
