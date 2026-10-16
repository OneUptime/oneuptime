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
  RenderResult,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import * as fs from "fs";
import * as path from "path";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The whole Home page (Pages/Home/Home.tsx), every card it mounts, against an
 * in-memory project: the command bar, the health card with its strip,
 * Getting Started, Needs attention, Your project, Upcoming maintenance and
 * Explore OneUptime.
 *
 * What only the page as a whole can show: the cards are in the order the
 * page promises, the headline, strip and attention list agree because they
 * read one batch, the batch is asked once per load and once per Refresh,
 * Refresh counts the other cards again too, a re-render asks nothing, a
 * project switch asks again for the new project, an empty account is sent
 * to Welcome, and what may be created follows the role.
 */

const LOCALES_DIR: string = path.join(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

type LocaleData = Record<string, unknown>;

const EN: LocaleData = JSON.parse(
  fs.readFileSync(path.join(LOCALES_DIR, "en.json"), "utf8"),
) as LocaleData;

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

const getListMock: MockFunction = getJestMockFunction();
const countMock: MockFunction = getJestMockFunction();
const cacheListMock: MockFunction = getJestMockFunction();
const navigateMock: MockFunction = getJestMockFunction();
const analyticsMock: MockFunction = getJestMockFunction();

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
            const flat: unknown = EN[key];
            return typeof flat === "string"
              ? flat
              : (options as { defaultValue?: string }).defaultValue ?? key;
          }
          return (
            lookupNested(EN, key) ??
            (typeof EN[key] === "string" ? (EN[key] as string) : undefined) ??
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
      getList: (...args: Array<unknown>) => {
        return getListMock(...args);
      },
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
        return cacheListMock(...args);
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
      isOnThisPage: () => {
        return false;
      },
      isStartWith: () => {
        return false;
      },
      getCurrentPath: () => {
        return {
          toString: () => {
            return "/";
          },
        };
      },
    },
  };
});

jest.mock("../../../UI/Utils/Analytics", () => {
  return {
    __esModule: true,
    default: {
      capture: (...args: Array<unknown>) => {
        return analyticsMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: () => {
        return currentProjectId;
      },
    },
  };
});

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<string> => {
        return grantedPermissions;
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): { globalPermissions: Array<string> } => {
        return { globalPermissions: grantedPermissions };
      },
    },
  };
});

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return false;
      },
      getUserId: (): null => {
        return null;
      },
    },
  };
});

import Home, {
  HOME_ROW_CLASS_NAME,
  HOME_ROW_MAIN_COLUMN_CLASS_NAME,
  HOME_ROW_SIDE_COLUMN_CLASS_NAME,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Home/Home";
import {
  describeHeightFill,
  describeHeightFillChain,
  resolveFlexGrow,
} from "../../ResponsiveHeightFill";
import {
  LAPTOP_WIDTH_IN_PX,
  WIDE_DESKTOP_WIDTH_IN_PX,
} from "../../ResponsiveVisibility";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import Alert from "../../../Models/DatabaseModels/Alert";
import Dashboard from "../../../Models/DatabaseModels/Dashboard";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentState from "../../../Models/DatabaseModels/IncidentState";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import OnCallDutyPolicy from "../../../Models/DatabaseModels/OnCallDutyPolicy";
import Project from "../../../Models/DatabaseModels/Project";
import ScheduledMaintenance from "../../../Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceState from "../../../Models/DatabaseModels/ScheduledMaintenanceState";
import Service from "../../../Models/DatabaseModels/Service";
import ServiceLevelObjective from "../../../Models/DatabaseModels/ServiceLevelObjective";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import Workflow from "../../../Models/DatabaseModels/Workflow";
import Route from "../../../Types/API/Route";
import Includes from "../../../Types/BaseDatabase/Includes";
import Color from "../../../Types/Color";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";

const PROJECT_ID: string = "65f00000000000000000cccc";
const OTHER_PROJECT_ID: string = "65f00000000000000000dddd";
let currentProjectId: ObjectID | null = new ObjectID(PROJECT_ID);

const OWNER: Array<string> = [
  Permission.ProjectOwner,
  Permission.User,
  Permission.Public,
];
const VIEWER: Array<string> = [
  Permission.Viewer,
  Permission.User,
  Permission.Public,
];
let grantedPermissions: Array<string> = OWNER;

const OPEN_STATE: string = "65f000000000000000000001";
const RESOLVED_STATE: string = "65f000000000000000000002";
const SM_SCHEDULED: string = "65f000000000000000000011";
const SM_ONGOING: string = "65f000000000000000000012";
const SM_ENDED: string = "65f000000000000000000013";

const UNRESOLVED_LIST: Array<{
  id: ObjectID;
  _id: string;
  isResolvedState: boolean;
  order: number;
}> = [
  {
    id: new ObjectID(OPEN_STATE),
    _id: OPEN_STATE,
    isResolvedState: false,
    order: 1,
  },
  {
    id: new ObjectID(RESOLVED_STATE),
    _id: RESOLVED_STATE,
    isResolvedState: true,
    order: 2,
  },
];

const SM_STATES: Array<Record<string, unknown>> = [
  {
    id: new ObjectID(SM_SCHEDULED),
    _id: SM_SCHEDULED,
    order: 1,
    isScheduledState: true,
    isOngoingState: false,
    isEndedState: false,
    isResolvedState: false,
  },
  {
    id: new ObjectID(SM_ONGOING),
    _id: SM_ONGOING,
    order: 2,
    isScheduledState: false,
    isOngoingState: true,
    isEndedState: false,
    isResolvedState: false,
  },
  {
    id: new ObjectID(SM_ENDED),
    _id: SM_ENDED,
    order: 3,
    isScheduledState: false,
    isOngoingState: false,
    isEndedState: true,
    isResolvedState: false,
  },
];

interface ProjectData {
  incidents: Array<Incident>;
  alerts: Array<Alert>;
  notOperationalMonitors: Array<Monitor>;
  totalMonitors: number;
  ongoing: Array<ScheduledMaintenance>;
  upcoming: Array<ScheduledMaintenance>;
  slosAtRisk: Array<ServiceLevelObjective>;
  totalSlos: number;
  counts: Map<unknown, number>;
}

function named<TModel extends BaseModel>(
  modelType: { new (): TModel },
  number: number,
  data: Record<string, unknown>,
): TModel {
  return Object.assign(new modelType(), {
    _id: `65f0000000000000000e${String(number).padStart(4, "0")}`,
    ...data,
  });
}

function busyProject(): ProjectData {
  return {
    incidents: [
      named(Incident, 1, {
        title: "Checkout API returning 503 errors",
        incidentNumber: 1042,
        incidentNumberWithPrefix: "INC-1042",
        currentIncidentState: Object.assign(new IncidentState(), {
          name: "Investigating",
          color: new Color("#ef4444"),
        }),
      }),
    ],
    alerts: [
      named(Alert, 2, {
        title: "CPU above 90% on orders-db-1",
        alertNumberWithPrefix: "ALT-311",
      }),
    ],
    notOperationalMonitors: [],
    totalMonitors: 6,
    ongoing: [],
    upcoming: [
      named(ScheduledMaintenance, 3, {
        title: "Kubernetes 1.31 upgrade",
        startsAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
      }),
    ],
    slosAtRisk: [],
    totalSlos: 2,
    counts: new Map<unknown, number>([
      [StatusPage, 2],
      [OnCallDutyPolicy, 3],
      [Service, 8],
      [Dashboard, 4],
      [Workflow, 1],
      [TeamMember, 5],
    ]),
  };
}

function newProject(): ProjectData {
  return {
    incidents: [],
    alerts: [],
    notOperationalMonitors: [],
    totalMonitors: 0,
    ongoing: [],
    upcoming: [],
    slosAtRisk: [],
    totalSlos: 0,
    counts: new Map<unknown, number>([[TeamMember, 1]]),
  };
}

let projects: Map<string, ProjectData> = new Map();

interface Recorded {
  type: "list" | "count" | "cache";
  modelType: unknown;
  projectId: string;
}

let recorded: Array<Recorded> = [];

function projectOf(query: Record<string, unknown>): ProjectData {
  const id: string = String(query["projectId"]);
  const found: ProjectData | undefined = projects.get(id);
  if (!found) {
    throw new Error(`No project ${id}`);
  }
  return found;
}

function answer(): void {
  cacheListMock.mockImplementation((...args: Array<unknown>) => {
    const request: { modelType: unknown; query: Record<string, unknown> } =
      args[0] as { modelType: unknown; query: Record<string, unknown> };
    recorded.push({
      type: "cache",
      modelType: request.modelType,
      projectId: String(request.query["projectId"]),
    });
    const rows: Array<unknown> =
      request.modelType === ScheduledMaintenanceState
        ? SM_STATES
        : UNRESOLVED_LIST;
    return Promise.resolve({
      data: rows,
      count: rows.length,
      skip: 0,
      limit: rows.length,
    });
  });

  getListMock.mockImplementation((...args: Array<unknown>) => {
    const request: {
      modelType: unknown;
      query: Record<string, unknown>;
      select: Record<string, unknown>;
      limit: number;
    } = args[0] as {
      modelType: unknown;
      query: Record<string, unknown>;
      select: Record<string, unknown>;
      limit: number;
    };
    recorded.push({
      type: "list",
      modelType: request.modelType,
      projectId: String(request.query["projectId"]),
    });
    const project: ProjectData = projectOf(request.query);
    let rows: Array<unknown> = [];

    if (request.modelType === Incident) {
      rows = project.incidents;
    } else if (request.modelType === Alert) {
      rows = project.alerts;
    } else if (request.modelType === Monitor) {
      rows = project.notOperationalMonitors;
    } else if (request.modelType === ServiceLevelObjective) {
      rows = project.slosAtRisk;
    } else if (request.modelType === ScheduledMaintenance) {
      const ids: Array<string> = (
        request.query["currentScheduledMaintenanceStateId"] as Includes
      ).values.map((value: unknown): string => {
        return String(value);
      });
      rows = ids.includes(SM_ONGOING) ? project.ongoing : project.upcoming;
    } else {
      throw new Error("Unexpected list");
    }

    return Promise.resolve({
      data: rows.slice(0, request.limit),
      count: rows.length,
      skip: 0,
      limit: request.limit,
    });
  });

  countMock.mockImplementation((...args: Array<unknown>) => {
    const request: { modelType: unknown; query: Record<string, unknown> } =
      args[0] as { modelType: unknown; query: Record<string, unknown> };
    recorded.push({
      type: "count",
      modelType: request.modelType,
      projectId: String(request.query["projectId"]),
    });
    const project: ProjectData = projectOf(request.query);

    if (request.modelType === Monitor) {
      return Promise.resolve(project.totalMonitors);
    }
    if (request.modelType === ServiceLevelObjective) {
      return Promise.resolve(project.totalSlos);
    }
    return Promise.resolve(project.counts.get(request.modelType) ?? 0);
  });
}

function recordedOf(type: Recorded["type"], modelType: unknown): number {
  return recorded.filter((entry: Recorded): boolean => {
    return entry.type === type && entry.modelType === modelType;
  }).length;
}

const PROJECT: Project = Object.assign(new Project(), {
  _id: PROJECT_ID,
  name: "Acme Commerce",
});

function Page(props: {
  projects?: Array<Project> | undefined;
  isLoadingProjects?: boolean | undefined;
}): React.ReactElement {
  return (
    <MemoryRouter>
      <Home
        pageRoute={RouteMap[PageMap.HOME] as Route}
        currentProject={PROJECT}
        hasPaymentMethod={true}
        projects={props.projects || [PROJECT]}
        isLoadingProjects={Boolean(props.isLoadingProjects)}
      />
    </MemoryRouter>
  );
}

async function renderHome(): Promise<RenderResult> {
  let result: RenderResult | null = null;
  await act(async () => {
    result = render(<Page />);
  });
  await waitFor(() => {
    expect(screen.getByTestId("home-health-headline")).toBeInTheDocument();
  });
  await waitFor(() => {
    expect(
      screen.queryAllByTestId(/^home-resource-[a-z-]+-loading$/),
    ).toHaveLength(0);
  });
  return result!;
}

beforeEach(() => {
  window.localStorage.clear();
  currentProjectId = new ObjectID(PROJECT_ID);
  grantedPermissions = OWNER;
  projects = new Map<string, ProjectData>([
    [PROJECT_ID, busyProject()],
    [OTHER_PROJECT_ID, newProject()],
  ]);
  recorded = [];
  answer();
});

afterEach(() => {
  cleanup();
  getListMock.mockReset();
  countMock.mockReset();
  cacheListMock.mockReset();
  navigateMock.mockReset();
  analyticsMock.mockReset();
});

describe("the page", () => {
  test("the cards in the order Home promises", async () => {
    await renderHome();

    await waitFor(() => {
      expect(
        screen.getByTestId("home-upcoming-maintenance"),
      ).toBeInTheDocument();
    });

    const order: Array<string> = [
      "home-command-bar",
      "home-project-health",
      "home-needs-attention",
      "home-project-resources",
      "home-upcoming-maintenance",
      "home-explore-products",
    ];
    const elements: Array<HTMLElement> = order.map(
      (testId: string): HTMLElement => {
        return screen.getByTestId(testId);
      },
    );

    for (let index: number = 1; index < elements.length; index++) {
      expect(
        elements[index - 1]!.compareDocumentPosition(elements[index]!) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }
  });

  test("the headline, the strip and the list agree: they read one batch", async () => {
    await renderHome();

    expect(screen.getByTestId("home-health-headline")).toHaveTextContent(
      "1 active incident",
    );
    expect(screen.getByTestId("home-stat-active-incidents")).toHaveTextContent(
      "1",
    );
    expect(screen.getAllByTestId("home-attention-row-incidents")).toHaveLength(
      1,
    );
    expect(screen.getByTestId("home-stat-active-alerts")).toHaveTextContent(
      "1",
    );
    expect(screen.getAllByTestId("home-attention-row-alerts")).toHaveLength(1);

    // One list of each kind, however many cards show it.
    expect(recordedOf("list", Incident)).toBe(1);
    expect(recordedOf("list", Alert)).toBe(1);
    expect(recordedOf("list", Monitor)).toBe(1);
    expect(recordedOf("list", ServiceLevelObjective)).toBe(1);
    // In progress (the batch) and upcoming (its card): one each.
    expect(recordedOf("list", ScheduledMaintenance)).toBe(2);
    expect(recordedOf("count", Monitor)).toBe(0 + 2);
  });

  test("the resources card and Getting Started count what they need, nothing twice", async () => {
    await renderHome();

    // Your project: five counts, the batch has monitors and SLOs.
    for (const modelType of [Service, Dashboard, Workflow]) {
      expect(recordedOf("count", modelType)).toBe(1);
    }
    /*
     * Getting Started counts monitors, status pages, team members and
     * on-call policies once to know whether it is finished.
     */
    expect(recordedOf("count", TeamMember)).toBe(1);
    expect(recordedOf("count", StatusPage)).toBe(2);
    expect(recordedOf("count", OnCallDutyPolicy)).toBe(2);
  });

  test("every request is for this project", async () => {
    await renderHome();

    expect(recorded.length).toBeGreaterThan(10);
    for (const entry of recorded) {
      expect(entry.projectId).toBe(PROJECT_ID);
    }
  });

  test("a finished project shows no Getting Started; Explore is there", async () => {
    await renderHome();

    expect(screen.queryByTestId("getting-started")).toBeNull();
    expect(screen.getByTestId("home-explore-products")).toBeInTheDocument();
  });

  test("the visit is recorded", async () => {
    await renderHome();

    expect(analyticsMock).toHaveBeenCalledWith(
      "dashboard/home",
      expect.objectContaining({}),
    );
  });
});

/*
 * "We have quite a bit of empty space between cards." From xl up, Needs
 * attention shares a row with Your project and Upcoming maintenance, and the
 * shorter side ended early, leaving bare page under it. The row now ends on
 * one line: the grid stretches both columns, and the LAST card in each
 * column runs to the bottom of the row. Which card is last depends on the
 * data - Upcoming maintenance is left out when nothing is scheduled - so
 * both states are held here.
 *
 * jsdom lays nothing out, so the boxes are read the way the browser lays
 * them out (Tests/ResponsiveHeightFill). E2E/HomeOverview measures the real
 * boxes in every scenario.
 */
describe("the row under the health card", () => {
  const ROW_WIDTHS: Array<number> = [
    LAPTOP_WIDTH_IN_PX,
    WIDE_DESKTOP_WIDTH_IN_PX,
  ];

  function row(): HTMLElement {
    return screen.getByTestId("home-overview-row");
  }

  // What the reader sees as the card: its frame, with border and shadow.
  function frameOf(testId: string): HTMLElement {
    return within(screen.getByTestId(testId)).getByTestId("card")
      .firstElementChild as HTMLElement;
  }

  function childTestIds(element: HTMLElement): Array<string | null> {
    return Array.from(element.children).map(
      (child: Element): string | null => {
        return child.getAttribute("data-testid");
      },
    );
  }

  async function renderWithUpcoming(): Promise<void> {
    await renderHome();
    await waitFor(() => {
      expect(screen.getByTestId("home-upcoming-row")).toBeInTheDocument();
    });
  }

  // A healthy, finished project with nothing scheduled.
  async function renderQuiet(): Promise<void> {
    projects.set(PROJECT_ID, {
      ...busyProject(),
      incidents: [],
      alerts: [],
      upcoming: [],
    });
    await renderHome();
    await waitFor(() => {
      expect(screen.queryByTestId("home-upcoming-loading")).toBeNull();
    });
    expect(screen.queryByTestId("home-upcoming-maintenance")).toBeNull();
  }

  test("two thirds for the open work and one third beside it from xl up, one column below", async () => {
    await renderHome();

    expect(row().getAttribute("class")).toBe(HOME_ROW_CLASS_NAME);
    expect(HOME_ROW_CLASS_NAME.split(" ")).toEqual(
      expect.arrayContaining(["grid", "grid-cols-1", "xl:grid-cols-3"]),
    );
    expect(childTestIds(row())).toEqual([
      "home-overview-row-main",
      "home-overview-row-side",
    ]);
    expect(
      screen.getByTestId("home-overview-row-main").getAttribute("class"),
    ).toBe(HOME_ROW_MAIN_COLUMN_CLASS_NAME);
    expect(HOME_ROW_MAIN_COLUMN_CLASS_NAME).toContain("xl:col-span-2");
    expect(
      screen.getByTestId("home-overview-row-side").getAttribute("class"),
    ).toBe(HOME_ROW_SIDE_COLUMN_CLASS_NAME);
  });

  test("each column holds only its cards, so the column's last-child rule always lands on a card", async () => {
    await renderWithUpcoming();

    expect(childTestIds(screen.getByTestId("home-overview-row-main"))).toEqual(
      ["home-needs-attention"],
    );
    expect(childTestIds(screen.getByTestId("home-overview-row-side"))).toEqual(
      ["home-project-resources", "home-upcoming-maintenance"],
    );
  });

  test.each(ROW_WIDTHS)(
    "at %ipx the grid stretches both columns to the row's height",
    async (width: number) => {
      await renderWithUpcoming();

      expect(
        describeHeightFill(screen.getByTestId("home-overview-row-main"), width),
      ).toBeNull();
      expect(
        describeHeightFill(screen.getByTestId("home-overview-row-side"), width),
      ).toBeNull();
    },
  );

  test.each(ROW_WIDTHS)(
    "at %ipx with maintenance coming up, Needs attention and Upcoming maintenance run to the bottom of the row; Your project keeps its height above",
    async (width: number) => {
      await renderWithUpcoming();

      expect(
        describeHeightFillChain(
          frameOf("home-needs-attention"),
          row(),
          width,
        ),
      ).toEqual([]);
      expect(
        describeHeightFillChain(
          frameOf("home-upcoming-maintenance"),
          row(),
          width,
        ),
      ).toEqual([]);
      // Not the last card: as tall as its seven rows, as before.
      expect(
        describeHeightFillChain(
          frameOf("home-project-resources"),
          row(),
          width,
        ),
      ).toEqual([
        '[data-testid="home-project-resources"] does not grow in its flex column (flex-1, or [&>*:last-child]:flex-1 on the column), so it ends where its content ends',
      ]);
    },
  );

  test.each(ROW_WIDTHS)(
    "at %ipx with nothing scheduled, Your project is the last card and runs to the bottom of the row",
    async (width: number) => {
      await renderQuiet();

      expect(screen.getByTestId("home-attention-empty")).toHaveAttribute(
        "data-state",
        "all-clear",
      );
      expect(
        describeHeightFillChain(
          frameOf("home-project-resources"),
          row(),
          width,
        ),
      ).toEqual([]);
      expect(
        describeHeightFillChain(
          frameOf("home-needs-attention"),
          row(),
          width,
        ),
      ).toEqual([]);
    },
  );

  test("a brand-new project: where problems will show, beside every resource to set up, both to the bottom of the row", async () => {
    currentProjectId = new ObjectID(OTHER_PROJECT_ID);
    await renderHome();

    expect(screen.getByTestId("home-attention-empty")).toHaveAttribute(
      "data-state",
      "nothing-monitored",
    );
    expect(screen.queryByTestId("home-upcoming-maintenance")).toBeNull();

    for (const testId of ["home-needs-attention", "home-project-resources"]) {
      expect({
        testId,
        reasons: describeHeightFillChain(
          frameOf(testId),
          row(),
          LAPTOP_WIDTH_IN_PX,
        ),
      }).toEqual({ testId, reasons: [] });
    }
  });

  test("in the all-clear card, the state grows all the way from the row to the middle of the card", async () => {
    await renderQuiet();

    const empty: HTMLElement = screen.getByTestId("home-attention-empty");

    expect(describeHeightFillChain(empty, row(), LAPTOP_WIDTH_IN_PX)).toEqual(
      [],
    );
    expect(resolveFlexGrow(empty, LAPTOP_WIDTH_IN_PX)).toBe(1);
  });

  test("every card in the row asks to fill its box, so whichever is last runs to the bottom", async () => {
    await renderWithUpcoming();

    for (const testId of [
      "home-needs-attention",
      "home-project-resources",
      "home-upcoming-maintenance",
    ]) {
      expect({
        testId,
        fill: within(screen.getByTestId(testId))
          .getByTestId("card")
          .getAttribute("data-fill-height"),
      }).toEqual({ testId, fill: "true" });
    }
  });

  test("the cards outside the row keep their own height", async () => {
    await renderHome();

    expect(
      within(screen.getByTestId("home-explore-products"))
        .getByTestId("card")
        .getAttribute("data-fill-height"),
    ).toBeNull();
    expect(row().contains(screen.getByTestId("home-explore-products"))).toBe(
      false,
    );
    expect(row().contains(screen.getByTestId("home-project-health"))).toBe(
      false,
    );
  });
});

describe("Refresh", () => {
  test("reads the batch again, and counts the other cards again", async () => {
    await renderHome();
    await waitFor(() => {
      expect(screen.getByTestId("home-upcoming-maintenance")).toBeVisible();
    });

    const before: number = recorded.length;
    expect(recordedOf("list", Incident)).toBe(1);

    await act(async () => {
      fireEvent.click(screen.getByTestId("home-health-refresh"));
    });

    await waitFor(() => {
      expect(recordedOf("list", Incident)).toBe(2);
    });
    await waitFor(() => {
      expect(recordedOf("count", Workflow)).toBe(2);
    });
    await waitFor(() => {
      expect(recordedOf("list", ScheduledMaintenance)).toBe(4);
    });
    expect(recorded.length).toBeGreaterThan(before);
    // Getting Started is finished, and is not asked again.
    expect(recordedOf("count", TeamMember)).toBe(1);
  });

  test("keeps what is on screen while it reads", async () => {
    await renderHome();

    getListMock.mockImplementation(() => {
      return new Promise(() => {
        // never answered
      });
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("home-health-refresh"));
    });

    expect(screen.getByTestId("home-health-headline")).toHaveTextContent(
      "1 active incident",
    );
    expect(screen.queryByTestId("home-health-loading")).toBeNull();
    expect(screen.getByTestId("home-health-refresh")).toBeDisabled();
  });
});

describe("re-renders and project switches", () => {
  test("a re-render asks nothing again", async () => {
    const result: RenderResult = await renderHome();
    const before: number = recorded.length;

    await act(async () => {
      result.rerender(<Page projects={[PROJECT]} />);
    });

    expect(recorded.length).toBe(before);
  });

  test("another project: its own reads, and nothing of the last one on screen", async () => {
    const result: RenderResult = await renderHome();

    currentProjectId = new ObjectID(OTHER_PROJECT_ID);

    await act(async () => {
      result.rerender(<Page projects={[PROJECT]} />);
    });

    await waitFor(() => {
      expect(screen.getByTestId("home-health-headline")).toHaveTextContent(
        "Nothing is being monitored yet",
      );
    });
    expect(screen.queryByTestId("home-attention-row-incidents")).toBeNull();
    expect(
      recorded.some((entry: Recorded): boolean => {
        return entry.projectId === OTHER_PROJECT_ID;
      }),
    ).toBe(true);
  });
});

describe("a brand-new project", () => {
  test("Getting Started under the headline, and every resource to set up", async () => {
    currentProjectId = new ObjectID(OTHER_PROJECT_ID);
    await renderHome();

    expect(screen.getByTestId("home-health-headline")).toHaveTextContent(
      "Nothing is being monitored yet",
    );
    await waitFor(() => {
      expect(screen.getByTestId("getting-started")).toBeInTheDocument();
    });
    expect(
      screen
        .getByTestId("home-project-health")
        .compareDocumentPosition(screen.getByTestId("getting-started")) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.getByTestId("home-attention-empty")).toHaveAttribute(
      "data-state",
      "nothing-monitored",
    );
    expect(screen.getByTestId("home-resource-monitors-set-up")).toBeVisible();
    // Nothing is scheduled, so there is no maintenance card at all.
    expect(screen.queryByTestId("home-upcoming-maintenance")).toBeNull();
  });
});

describe("no project at all", () => {
  test("is sent to Welcome", async () => {
    await act(async () => {
      render(<Page projects={[]} isLoadingProjects={false} />);
    });

    expect(navigateMock).toHaveBeenCalledWith(RouteMap[PageMap.WELCOME]);
  });

  test("is not sent anywhere while the projects are still loading", async () => {
    await act(async () => {
      render(<Page projects={[]} isLoadingProjects={true} />);
    });

    expect(navigateMock).not.toHaveBeenCalled();
  });
});

describe("what may be created", () => {
  test("an owner gets Declare Incident and the Create menu", async () => {
    await renderHome();

    expect(
      screen.getByTestId("home-quick-action-declare-incident"),
    ).toBeVisible();
    expect(screen.getByLabelText("Create")).toBeVisible();
  });

  test("a viewer gets search, and no create actions", async () => {
    grantedPermissions = VIEWER;
    await renderHome();

    expect(screen.getByTestId("home-search")).toBeVisible();
    expect(screen.queryByTestId("home-quick-actions")).toBeNull();
  });
});
