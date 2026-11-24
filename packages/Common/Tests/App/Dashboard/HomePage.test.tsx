// UX rule: Docs/ux/README.md#a-products-first-page
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
import {
  MemoryRouter,
  Outlet,
  Route as RouterRoute,
  Routes,
  useOutletContext,
} from "react-router-dom";
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
 *
 * And, since #8897, that a new project's quickstart is the whole of Home
 * while it shows - with only what cannot wait above it - and that hiding it
 * brings the rest of Home back.
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

/*
 * The Welcome checklist is one server answer (issue #6803), for the project
 * Home is on: the busy project finished it, the new one has every step to
 * do. It counts no records of its own.
 */
const welcomeFetchMock: MockFunction = getJestMockFunction();
const welcomePostMock: MockFunction = getJestMockFunction();

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Home/WelcomeChecklist/WelcomeChecklistApi",
  () => {
    return {
      __esModule: true,
      fetchWelcomeChecklist: (...args: Array<unknown>) => {
        return welcomeFetchMock(...args);
      },
      postWelcomeChecklist: (...args: Array<unknown>) => {
        return welcomePostMock(...args);
      },
      sendLegacyBrowserState: () => {
        return Promise.resolve(null);
      },
    };
  },
);

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
  HomeMode,
  getHomeMode,
  isCreateFirstMonitorShown,
  needsSomeoneDuringQuickstart,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Home/Home";
import {
  QUICKSTART_MAX_WIDTH_CLASS_NAME,
  WelcomeCardView,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Home/GettingStarted";
import HomeLayout, {
  HOME_QUICKSTART_PAGE_CLASS_NAME,
  HomeFrame,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Home/Layout";
import { GUIDED_SETUP_PAGE_CLASS_NAME } from "../../../../App/FeatureSet/Dashboard/src/Components/GuidedSetup/GuidedSetupFrame";
import { HomeCounts } from "../../../../App/FeatureSet/Dashboard/src/Components/Home/HomeOverviewData";
import { HOME_ROW_CARD_BODY_CLASS_NAME } from "../../../../App/FeatureSet/Dashboard/src/Components/Home/HomeRowCard";
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

/*
 * What the new project's Welcome answer adds, per test: hidden by the
 * person, the question still to ask, an invited member...
 */
let newProjectWelcome: Record<string, unknown> = {};

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

// Home inside a frame that hears what it says (HomeFrame, #10276).
function FramedPage(props: {
  frame: { setIsQuickstart: MockFunction };
}): React.ReactElement {
  return (
    <MemoryRouter>
      <Routes>
        <RouterRoute element={<Outlet context={props.frame} />}>
          <RouterRoute
            path="*"
            element={
              <Home
                pageRoute={RouteMap[PageMap.HOME] as Route}
                currentProject={PROJECT}
                hasPaymentMethod={true}
                projects={[PROJECT]}
                isLoadingProjects={false}
              />
            }
          />
        </RouterRoute>
      </Routes>
    </MemoryRouter>
  );
}

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

// Home, once it has decided to draw a new project's quickstart.
async function renderQuickstart(): Promise<RenderResult> {
  let result: RenderResult | null = null;
  await act(async () => {
    result = render(<Page />);
  });
  await waitFor(() => {
    expect(screen.getByTestId("home-overview")).toHaveAttribute(
      "data-home-mode",
      HomeMode.Quickstart,
    );
  });
  return result!;
}

function homeMode(): string | null {
  return screen.getByTestId("home-overview").getAttribute("data-home-mode");
}

// What a new project's quickstart answers: its four steps, none done.
function newProjectAnswer(): Record<string, unknown> {
  return {
    audience: "set_up",
    goals: [],
    shouldAskForGoals: false,
    canChooseGoals: true,
    isHiddenForMe: false,
    isFinished: false,
    canSendEmail: true,
    steps: ["monitor", "on_call", "status_page", "team"].map(
      (step: string, index: number) => {
        return {
          step: step,
          isDone: false,
          needsPlan: null,
          isNext: index === 0,
        };
      },
    ),
    doneCount: 0,
    totalCount: 4,
    ...newProjectWelcome,
  };
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
  newProjectWelcome = {};
  answer();
  welcomeFetchMock.mockImplementation(() => {
    const isNew: boolean = currentProjectId?.toString() === OTHER_PROJECT_ID;

    if (isNew) {
      return Promise.resolve(newProjectAnswer());
    }

    return Promise.resolve({
      audience: "set_up",
      goals: [],
      shouldAskForGoals: false,
      canChooseGoals: true,
      isHiddenForMe: false,
      isFinished: true,
      canSendEmail: true,
      steps: [],
      doneCount: 0,
      totalCount: 0,
    });
  });
  welcomePostMock.mockResolvedValue(null);
});

afterEach(() => {
  cleanup();
  getListMock.mockReset();
  countMock.mockReset();
  cacheListMock.mockReset();
  navigateMock.mockReset();
  analyticsMock.mockReset();
  welcomeFetchMock.mockReset();
  welcomePostMock.mockReset();
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
    // The batch's total; the Welcome checklist counts nothing (#6803).
    expect(recordedOf("count", Monitor)).toBe(1);
  });

  test("the resources card counts what it needs, once; the Welcome checklist counts nothing", async () => {
    await renderHome();

    // Your project: five counts, the batch has monitors and SLOs.
    for (const modelType of [
      Service,
      Dashboard,
      Workflow,
      StatusPage,
      OnCallDutyPolicy,
    ]) {
      expect(recordedOf("count", modelType)).toBe(1);
    }
    /*
     * The Welcome checklist is one server answer that ticks on outcomes
     * (#6803): it counts no team members, status pages or policies.
     */
    expect(recordedOf("count", TeamMember)).toBe(0);
    expect(welcomeFetchMock).toHaveBeenCalledTimes(1);
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
    return Array.from(element.children).map((child: Element): string | null => {
      return child.getAttribute("data-testid");
    });
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

    expect(childTestIds(screen.getByTestId("home-overview-row-main"))).toEqual([
      "home-needs-attention",
    ]);
    expect(childTestIds(screen.getByTestId("home-overview-row-side"))).toEqual([
      "home-project-resources",
      "home-upcoming-maintenance",
    ]);
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
        describeHeightFillChain(frameOf("home-needs-attention"), row(), width),
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
        describeHeightFillChain(frameOf("home-needs-attention"), row(), width),
      ).toEqual([]);
    },
  );

  test("a brand-new project whose quickstart is hidden: where problems will show, beside every resource to set up, both to the bottom of the row", async () => {
    currentProjectId = new ObjectID(OTHER_PROJECT_ID);
    newProjectWelcome = { isHiddenForMe: true };
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

  /*
   * Side by side with their tops level, the cards' headers end on one line
   * when they are as tall as each other - and so must the dividers under
   * them, which run across the row as one line. Needs attention started its
   * list 4px further down than the cards beside it (mt-4 against mt-3).
   */
  test("every card in the row starts its list the same distance under its header, under a divider", async () => {
    await renderWithUpcoming();

    const MARGIN_TOP_TOKEN: RegExp = /^-?mt-/;
    const marginTops: Array<string> = [];

    for (const testId of [
      "home-needs-attention",
      "home-project-resources",
      "home-upcoming-maintenance",
    ]) {
      const body: HTMLElement = frameOf(testId).firstElementChild!
        .lastElementChild as HTMLElement;

      expect({ testId, body: body.getAttribute("class") }).toEqual({
        testId,
        body: expect.stringContaining(HOME_ROW_CARD_BODY_CLASS_NAME),
      });
      expect({
        testId,
        divider: body.firstElementChild?.classList.contains("border-t"),
      }).toEqual({ testId, divider: true });
      marginTops.push(
        (body.getAttribute("class") || "")
          .split(" ")
          .filter((token: string): boolean => {
            return MARGIN_TOP_TOKEN.test(token);
          })[0] || "",
      );
    }

    expect(new Set(marginTops).size).toBe(1);
    expect(marginTops[0]).not.toBe("");
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
    // The Welcome checklist counts nothing, and is not read again.
    expect(recordedOf("count", TeamMember)).toBe(0);
    expect(welcomeFetchMock).toHaveBeenCalledTimes(1);
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
    // Hidden by this person, so the other project's overview is drawn.
    newProjectWelcome = { isHiddenForMe: true };

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

/*
 * "If quickstart is shown on the home page we dont need to show anything
 * else" (#8897). A new project's Home was a banner to create a monitor, five
 * zeros, the Welcome card, an empty list of what needs attention and a list
 * of things to set up, all asking for the same first click. While the
 * quickstart shows, it is all of Home.
 */
describe("a brand-new project's quickstart", () => {
  const OVERVIEW_CARDS: Array<string> = [
    "home-command-bar",
    "home-project-health",
    "home-needs-attention",
    "home-project-resources",
    "home-upcoming-maintenance",
    "home-explore-products",
  ];

  test("is the whole of Home: no search bar, no headline or zeros, no lists", async () => {
    currentProjectId = new ObjectID(OTHER_PROJECT_ID);
    await renderQuickstart();

    expect(screen.getByTestId("getting-started")).toBeVisible();
    for (const testId of OVERVIEW_CARDS) {
      expect({ testId, drawn: screen.queryByTestId(testId) !== null }).toEqual({
        testId,
        drawn: false,
      });
    }
    expect(screen.queryByTestId("home-overview-stats")).toBeNull();
    expect(screen.queryByTestId("home-health-create-monitor")).toBeNull();
    expect(screen.queryByTestId("home-deciding")).toBeNull();
    // A width the eye can take in, under the page's title.
    expect(screen.getByTestId("getting-started").className).toContain(
      QUICKSTART_MAX_WIDTH_CLASS_NAME,
    );
  });

  test("the question is the whole of Home too", async () => {
    currentProjectId = new ObjectID(OTHER_PROJECT_ID);
    newProjectWelcome = { goals: null, shouldAskForGoals: true };
    await renderQuickstart();

    expect(screen.getByTestId("welcome-question")).toBeVisible();
    for (const testId of OVERVIEW_CARDS) {
      expect({ testId, drawn: screen.queryByTestId(testId) !== null }).toEqual({
        testId,
        drawn: false,
      });
    }
  });

  test("still reads what is open, once, so an incident can be said above it", async () => {
    currentProjectId = new ObjectID(OTHER_PROJECT_ID);
    await renderQuickstart();

    await waitFor(() => {
      expect(recordedOf("list", Incident)).toBe(1);
    });
    /*
     * The cards the quickstart leaves out read at most once, out of sight,
     * while Home decided - so a project that turns out to need them never
     * waits on the quickstart's answer - and never again once it has.
     */
    expect(recordedOf("count", Workflow)).toBeLessThanOrEqual(1);
    expect(recordedOf("count", Dashboard)).toBeLessThanOrEqual(1);
    expect(screen.queryByTestId("home-project-resources")).toBeNull();
  });

  test("an incident that opens while the project is set up is said above it, by the health card", async () => {
    currentProjectId = new ObjectID(OTHER_PROJECT_ID);
    projects.set(OTHER_PROJECT_ID, {
      ...newProject(),
      incidents: busyProject().incidents,
      totalMonitors: 1,
    });
    await renderQuickstart();

    await waitFor(() => {
      expect(screen.getByTestId("home-health-headline")).toHaveTextContent(
        "1 active incident",
      );
    });
    expect(
      screen
        .getByTestId("home-project-health")
        .compareDocumentPosition(screen.getByTestId("getting-started")) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // Only the health card: the rest of Home stays out.
    expect(screen.queryByTestId("home-command-bar")).toBeNull();
    expect(screen.queryByTestId("home-needs-attention")).toBeNull();
  });

  test("an alert that needs someone is said above it too", async () => {
    currentProjectId = new ObjectID(OTHER_PROJECT_ID);
    projects.set(OTHER_PROJECT_ID, {
      ...newProject(),
      alerts: busyProject().alerts,
      totalMonitors: 1,
    });
    await renderQuickstart();

    await waitFor(() => {
      expect(screen.getByTestId("home-project-health")).toHaveAttribute(
        "data-health",
        "needs-attention",
      );
    });
  });

  test("nothing open: no health card above it", async () => {
    currentProjectId = new ObjectID(OTHER_PROJECT_ID);
    await renderQuickstart();

    await waitFor(() => {
      expect(recordedOf("list", Incident)).toBe(1);
    });
    expect(screen.queryByTestId("home-project-health")).toBeNull();
  });

  test("Hide brings the rest of Home back, with the line that shows the quickstart again", async () => {
    currentProjectId = new ObjectID(OTHER_PROJECT_ID);
    await renderQuickstart();

    welcomePostMock.mockResolvedValue({
      ...newProjectAnswer(),
      isHiddenForMe: true,
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("getting-started-dismiss"));
    });

    await waitFor(() => {
      expect(homeMode()).toBe(HomeMode.Overview);
    });
    expect(screen.getByTestId("welcome-checklist-hidden")).toBeVisible();
    await waitFor(() => {
      expect(screen.getByTestId("home-health-headline")).toHaveTextContent(
        "Nothing is being monitored yet",
      );
    });
    expect(screen.getByTestId("home-command-bar")).toBeVisible();
    expect(screen.getByTestId("home-needs-attention")).toBeVisible();
    expect(screen.getByTestId("home-explore-products")).toBeVisible();
  });

  /*
   * A wide screen drew the quickstart in the left half of the page and
   * nothing beside it (#10276): while it is all of Home, Home tells its
   * frame, which centres the page as a guided setup's is.
   */
  test("tells its frame it is the quickstart, so the page is centred; Hide gives the page its width back", async () => {
    currentProjectId = new ObjectID(OTHER_PROJECT_ID);
    const frame: { setIsQuickstart: MockFunction } = {
      setIsQuickstart: getJestMockFunction(),
    };

    await act(async () => {
      render(<FramedPage frame={frame} />);
    });
    await waitFor(() => {
      expect(homeMode()).toBe(HomeMode.Quickstart);
    });
    expect(frame.setIsQuickstart).toHaveBeenLastCalledWith(true);

    welcomePostMock.mockResolvedValue({
      ...newProjectAnswer(),
      isHiddenForMe: true,
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("getting-started-dismiss"));
    });
    await waitFor(() => {
      expect(homeMode()).toBe(HomeMode.Overview);
    });
    expect(frame.setIsQuickstart).toHaveBeenLastCalledWith(false);
  });

  test("a project in use never centres the page, and leaving Home gives the frame its width back", async () => {
    const frame: { setIsQuickstart: MockFunction } = {
      setIsQuickstart: getJestMockFunction(),
    };
    let result: RenderResult | null = null;

    await act(async () => {
      result = render(<FramedPage frame={frame} />);
    });
    await waitFor(() => {
      expect(homeMode()).toBe(HomeMode.Overview);
    });
    expect(frame.setIsQuickstart).not.toHaveBeenCalledWith(true);

    frame.setIsQuickstart.mockClear();
    act(() => {
      result!.unmount();
    });
    expect(frame.setIsQuickstart).toHaveBeenCalledWith(false);
  });

  test("Home's frame centres the page, title and trail over the quickstart, only while Home says so", async () => {
    let setFromHome: ((isQuickstart: boolean) => void) | null = null;

    const Inside: () => React.ReactElement = (): React.ReactElement => {
      const frame: HomeFrame = useOutletContext<HomeFrame>();
      setFromHome = frame.setIsQuickstart;
      return <div data-testid="inside-home" />;
    };

    let result: RenderResult | null = null;
    await act(async () => {
      result = render(
        <MemoryRouter>
          <Routes>
            <RouterRoute
              element={
                <HomeLayout
                  pageRoute={RouteMap[PageMap.HOME] as Route}
                  currentProject={PROJECT}
                  hasPaymentMethod={true}
                />
              }
            >
              <RouterRoute path="*" element={<Inside />} />
            </RouterRoute>
          </Routes>
        </MemoryRouter>,
      );
    });

    const page: () => Element = (): Element => {
      return result!.container.firstElementChild!;
    };

    // The page's whole width, as any page's.
    expect(page().className).not.toContain("mx-auto");
    expect(
      within(page() as HTMLElement).getByTestId("inside-home"),
    ).toBeVisible();

    act(() => {
      setFromHome!(true);
    });
    expect(page().className).toBe(HOME_QUICKSTART_PAGE_CLASS_NAME);
    expect(HOME_QUICKSTART_PAGE_CLASS_NAME).toBe(GUIDED_SETUP_PAGE_CLASS_NAME);
    expect(page().className).toContain("mx-auto");
    expect(page().className).toContain("max-w-7xl");

    act(() => {
      setFromHome!(false);
    });
    expect(page().className).not.toContain("mx-auto");
  });

  test("Show it, on that line, makes Home the quickstart again", async () => {
    currentProjectId = new ObjectID(OTHER_PROJECT_ID);
    newProjectWelcome = { isHiddenForMe: true };
    await renderHome();

    expect(homeMode()).toBe(HomeMode.Overview);

    welcomePostMock.mockResolvedValue({
      ...newProjectAnswer(),
      isHiddenForMe: false,
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("welcome-checklist-show"));
    });

    await waitFor(() => {
      expect(homeMode()).toBe(HomeMode.Quickstart);
    });
    expect(screen.getByTestId("getting-started")).toBeVisible();
    expect(screen.queryByTestId("home-command-bar")).toBeNull();
  });

  test("an invited member's own first steps sit in the overview, beside what is open", async () => {
    currentProjectId = new ObjectID(OTHER_PROJECT_ID);
    newProjectWelcome = {
      audience: "invited_member",
      canChooseGoals: false,
      steps: [],
      totalCount: 0,
    };
    await renderHome();

    expect(homeMode()).toBe(HomeMode.Overview);
    expect(screen.getByTestId("home-needs-attention")).toBeVisible();
  });

  /*
   * The question is only ever asked of a project that is new and not in
   * use yet. A project in use before it would have been asked - monitors
   * reporting, but no status page or second member, so its checklist never
   * finished - keeps its overview, with the checklist as a card in it: its
   * people come to Home for what is open.
   */
  test("an older project that never answered the question keeps its overview, with its unfinished checklist in it", async () => {
    currentProjectId = new ObjectID(OTHER_PROJECT_ID);
    newProjectWelcome = {
      goals: null,
      shouldAskForGoals: false,
      steps: ["monitor", "on_call", "status_page", "team"].map(
        (step: string, index: number) => {
          return {
            step: step,
            isDone: index < 2,
            needsPlan: null,
            isNext: index === 2,
          };
        },
      ),
      doneCount: 2,
    };
    await renderHome();

    expect(homeMode()).toBe(HomeMode.Overview);
    expect(screen.getByTestId("home-command-bar")).toBeVisible();
    expect(screen.getByTestId("home-needs-attention")).toBeVisible();
    await waitFor(() => {
      expect(screen.getByTestId("getting-started")).toBeVisible();
    });
    // A card among the others: as wide as they are.
    expect(screen.getByTestId("getting-started").className).not.toContain(
      QUICKSTART_MAX_WIDTH_CLASS_NAME,
    );
    // Where the Welcome card always was: under the headline.
    expect(
      screen
        .getByTestId("home-project-health")
        .compareDocumentPosition(screen.getByTestId("getting-started")) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  test("a project that skipped choosing goals is a new project's quickstart too", async () => {
    currentProjectId = new ObjectID(OTHER_PROJECT_ID);
    newProjectWelcome = { goals: [] };
    await renderQuickstart();

    expect(screen.getByTestId("getting-started")).toBeVisible();
    expect(screen.queryByTestId("home-command-bar")).toBeNull();
  });

  test("a quickstart that cannot be read leaves the overview", async () => {
    currentProjectId = new ObjectID(OTHER_PROJECT_ID);
    welcomeFetchMock.mockResolvedValue(null);
    await renderHome();

    expect(homeMode()).toBe(HomeMode.Overview);
    expect(screen.queryByTestId("getting-started")).toBeNull();
  });
});

/*
 * Until the quickstart's answer is read, Home does not know which page it
 * is: it draws neither, rather than one then the other, and the overview's
 * cards are drawn out of sight, already reading - never behind the answer.
 */
describe("while Home decides", () => {
  test("a quiet placeholder shows, the overview reads out of sight, and nothing flashes", async () => {
    welcomeFetchMock.mockImplementation(() => {
      return new Promise(() => {
        // not answered yet
      });
    });

    await act(async () => {
      render(<Page />);
    });

    expect(homeMode()).toBe(HomeMode.Deciding);
    expect(screen.getByTestId("home-deciding")).toBeInTheDocument();
    // Drawn, so their reads start now - but not seen.
    expect(screen.getByTestId("home-command-bar")).not.toBeVisible();
    expect(screen.getByTestId("home-project-resources")).not.toBeVisible();
    await waitFor(() => {
      expect(recordedOf("list", Incident)).toBe(1);
    });
    await waitFor(() => {
      expect(recordedOf("count", Workflow)).toBe(1);
    });
    expect(screen.queryByTestId("getting-started")).toBeNull();
  });

  test("a finished project's overview is the same overview once decided: nothing is read twice", async () => {
    await renderHome();

    expect(homeMode()).toBe(HomeMode.Overview);
    expect(screen.queryByTestId("home-deciding")).toBeNull();
    expect(screen.getByTestId("home-command-bar")).toBeVisible();
    expect(recordedOf("list", Incident)).toBe(1);
    expect(recordedOf("count", Workflow)).toBe(1);
  });
});

describe("which page Home is", () => {
  test.each([
    [null, false, HomeMode.Deciding],
    [WelcomeCardView.Question, true, HomeMode.Quickstart],
    [WelcomeCardView.Checklist, true, HomeMode.Quickstart],
    // An older project's checklist is a card in the overview.
    [WelcomeCardView.Checklist, false, HomeMode.Overview],
    [WelcomeCardView.Hidden, false, HomeMode.Overview],
    [WelcomeCardView.InvitedMember, false, HomeMode.Overview],
    // What else to set up is a card in the overview too (#7986).
    [WelcomeCardView.More, false, HomeMode.Overview],
    [WelcomeCardView.None, false, HomeMode.Overview],
  ])(
    "%s, taking Home %s: %s",
    (view: WelcomeCardView | null, isTakingHome: boolean, mode: HomeMode) => {
      expect(
        getHomeMode({
          view: view,
          isTakingHome: isTakingHome,
          offersFirstMonitor: false,
        }),
      ).toBe(mode);
    },
  );

  /*
   * One start for one job (#7759): the headline offers to create the first
   * monitor to whoever may, unless the Welcome card offers that step.
   */
  test.each([
    [true, false, true],
    [true, true, false],
    [false, false, false],
    [false, true, false],
  ])(
    "may create a monitor %s, the card offers it %s: the headline's button %s",
    (canCreateMonitor: boolean, cardOffers: boolean, expected: boolean) => {
      expect(
        isCreateFirstMonitorShown({
          canCreateMonitor: canCreateMonitor,
          welcome: {
            view: WelcomeCardView.Checklist,
            isTakingHome: false,
            offersFirstMonitor: cardOffers,
          },
        }),
      ).toBe(expected);
    },
  );

  const counts: (extra: Partial<HomeCounts>) => HomeCounts = (
    extra: Partial<HomeCounts>,
  ): HomeCounts => {
    return {
      activeIncidents: 0,
      activeAlerts: 0,
      notOperationalMonitors: 0,
      ongoingMaintenance: 0,
      slosNeedingAttention: 0,
      totalMonitors: 0,
      totalSlos: 0,
      ...extra,
    };
  };

  test.each([
    ["nothing read yet", null, false],
    ["nothing monitored yet", counts({}), false],
    ["all operational", counts({ totalMonitors: 2 }), false],
    ["maintenance in progress", counts({ ongoingMaintenance: 1 }), false],
    ["an open incident", counts({ activeIncidents: 1 }), true],
    ["an open alert", counts({ activeAlerts: 2 }), true],
    [
      "a monitor that is not operational",
      counts({ totalMonitors: 1, notOperationalMonitors: 1 }),
      true,
    ],
    ["an SLO at risk", counts({ slosNeedingAttention: 1 }), true],
  ])(
    "the quickstart makes room for the health card: %s",
    (_name: string, value: HomeCounts | null, expected: boolean) => {
      expect(needsSomeoneDuringQuickstart(value)).toBe(expected);
    },
  );
});

describe("a brand-new project whose quickstart is hidden", () => {
  beforeEach(() => {
    newProjectWelcome = { isHiddenForMe: true };
  });

  test("the line that shows it again under the headline, and every resource to set up", async () => {
    currentProjectId = new ObjectID(OTHER_PROJECT_ID);
    await renderHome();

    expect(screen.getByTestId("home-health-headline")).toHaveTextContent(
      "Nothing is being monitored yet",
    );
    await waitFor(() => {
      expect(screen.getByTestId("welcome-checklist-hidden")).toBeVisible();
    });
    expect(
      screen
        .getByTestId("home-project-health")
        .compareDocumentPosition(
          screen.getByTestId("welcome-checklist-hidden"),
        ) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.getByTestId("home-attention-empty")).toHaveAttribute(
      "data-state",
      "nothing-monitored",
    );
    expect(screen.getByTestId("home-resource-monitors-set-up")).toBeVisible();
    // Nothing is scheduled, so there is no maintenance card at all.
    expect(screen.queryByTestId("home-upcoming-maintenance")).toBeNull();
  });

  /*
   * The headline says "Create a monitor and OneUptime will check your
   * website, API or server around the clock", and used to stop there: the
   * way to do it was the first item of the Create menu, or a step of the
   * checklist - gone for good once dismissed. It now ends on the button.
   */
  test("the headline ends on Create your first monitor, which opens the guided setup", async () => {
    currentProjectId = new ObjectID(OTHER_PROJECT_ID);
    await renderHome();

    const health: HTMLElement = screen.getByTestId("home-project-health");
    const button: HTMLElement = within(health).getByRole("link", {
      name: "Create your first monitor",
    });

    expect(button).toBeVisible();
    expect(button).toHaveAttribute(
      "href",
      `/dashboard/${OTHER_PROJECT_ID}/monitors/setup`,
    );
  });

  test("someone who may not create monitors reads the headline without the button", async () => {
    currentProjectId = new ObjectID(OTHER_PROJECT_ID);
    grantedPermissions = VIEWER;
    await renderHome();

    expect(screen.getByTestId("home-health-headline")).toHaveTextContent(
      "Nothing is being monitored yet",
    );
    expect(screen.queryByTestId("home-health-create-monitor")).toBeNull();
  });
});

/*
 * ONE START FOR THE FIRST JOB (#7759). The headline's "Create your first
 * monitor" and the Welcome card's step of the same name opened the same
 * guided setup, one above the other, and a newcomer stopped to choose. A
 * new project's quickstart is the whole of Home, so the headline is not
 * drawn there (#8897); wherever else the card offers that step - an older
 * project's checklist in its overview, or what else to set up - the
 * headline leaves its button out.
 */
describe("one start for the first job", () => {
  const OLDER_PROJECT_MONITOR_LEFT: Record<string, unknown> = {
    goals: null,
    shouldAskForGoals: false,
    steps: ["monitor", "on_call", "status_page", "team"].map(
      (step: string, index: number) => {
        return {
          step: step,
          isDone: step === "team",
          needsPlan: null,
          isNext: index === 0,
        };
      },
    ),
    doneCount: 1,
  };

  test("an older project's checklist offers the first monitor: the headline does not too", async () => {
    currentProjectId = new ObjectID(OTHER_PROJECT_ID);
    newProjectWelcome = OLDER_PROJECT_MONITOR_LEFT;
    await renderHome();

    expect(homeMode()).toBe(HomeMode.Overview);
    expect(screen.getByTestId("home-health-headline")).toHaveTextContent(
      "Nothing is being monitored yet",
    );
    await waitFor(() => {
      expect(screen.getByTestId("getting-started-task-monitor")).toBeVisible();
    });
    expect(screen.queryByTestId("home-health-create-monitor")).toBeNull();
    expect(
      screen.getAllByText("Create your first monitor", { exact: true }),
    ).toHaveLength(1);
  });

  test("once its monitor step is done, the checklist offers it no more, and neither does the headline need to", async () => {
    currentProjectId = new ObjectID(OTHER_PROJECT_ID);
    newProjectWelcome = {
      ...OLDER_PROJECT_MONITOR_LEFT,
      steps: [
        { step: "monitor", isDone: true, needsPlan: null, isNext: false },
        { step: "on_call", isDone: false, needsPlan: null, isNext: true },
      ],
    };
    await renderHome();

    await waitFor(() => {
      expect(screen.getByTestId("getting-started")).toBeVisible();
    });
    // The project has no monitor now: the headline's button is the one start.
    expect(screen.getByTestId("home-health-create-monitor")).toBeVisible();
  });

  test("hidden, the checklist offers nothing: the headline's button is the one start", async () => {
    currentProjectId = new ObjectID(OTHER_PROJECT_ID);
    newProjectWelcome = { ...OLDER_PROJECT_MONITOR_LEFT, isHiddenForMe: true };
    await renderHome();

    await waitFor(() => {
      expect(screen.getByTestId("welcome-checklist-hidden")).toBeVisible();
    });
    expect(screen.getByTestId("home-health-create-monitor")).toBeVisible();
  });

  test("what else to set up offering the first monitor: the headline leaves its own out", async () => {
    currentProjectId = new ObjectID(OTHER_PROJECT_ID);
    newProjectWelcome = {
      goals: ["telemetry"],
      isFinished: true,
      steps: [],
      doneCount: 0,
      totalCount: 0,
      moreSteps: [
        { step: "monitor", isDone: false, needsPlan: null, isNext: false },
        { step: "team", isDone: false, needsPlan: null, isNext: false },
      ],
    };
    await renderHome();

    await waitFor(() => {
      expect(screen.getByTestId("welcome-more")).toBeVisible();
    });
    expect(screen.queryByTestId("home-health-create-monitor")).toBeNull();
  });
});

/*
 * WHAT ELSE TO SET UP (#7986): once a project's first steps are done, Home
 * is its overview again, with the card that offers what is left in the
 * Welcome card's place - never the whole of Home.
 */
describe("a project whose first steps are done", () => {
  test("sees its overview, with what else to set up under the headline", async () => {
    currentProjectId = new ObjectID(OTHER_PROJECT_ID);
    projects.set(OTHER_PROJECT_ID, { ...newProject(), totalMonitors: 1 });
    newProjectWelcome = {
      goals: ["uptime"],
      isFinished: true,
      steps: [],
      doneCount: 0,
      totalCount: 0,
      moreSteps: [
        { step: "status_page", isDone: false, needsPlan: null, isNext: false },
        { step: "team", isDone: false, needsPlan: null, isNext: false },
      ],
    };
    await renderHome();

    expect(homeMode()).toBe(HomeMode.Overview);
    await waitFor(() => {
      expect(screen.getByTestId("welcome-more")).toBeVisible();
    });
    expect(screen.getByTestId("home-command-bar")).toBeVisible();
    expect(screen.getByTestId("home-needs-attention")).toBeVisible();
    expect(screen.getByTestId("home-explore-products")).toBeVisible();
    expect(
      screen
        .getByTestId("home-project-health")
        .compareDocumentPosition(screen.getByTestId("welcome-more")) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // As wide as the cards around it.
    expect(screen.getByTestId("welcome-more").className).not.toContain(
      QUICKSTART_MAX_WIDTH_CLASS_NAME,
    );
    expect(screen.getByTestId("welcome-more")).toHaveTextContent(
      "Publish a status page",
    );
    expect(screen.getByTestId("welcome-more")).toHaveTextContent(
      "Invite your team",
    );
  });

  test("with nothing left, the overview has no Welcome card at all", async () => {
    await renderHome();

    expect(screen.queryByTestId("welcome-more")).toBeNull();
    expect(screen.queryByTestId("getting-started")).toBeNull();
    expect(screen.queryByTestId("welcome-checklist-hidden")).toBeNull();
  });
});

describe("a project with monitors", () => {
  test("has no Create your first monitor button", async () => {
    await renderHome();

    expect(screen.getByTestId("home-health-headline")).not.toHaveTextContent(
      "Nothing is being monitored yet",
    );
    expect(screen.queryByTestId("home-health-create-monitor")).toBeNull();
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
