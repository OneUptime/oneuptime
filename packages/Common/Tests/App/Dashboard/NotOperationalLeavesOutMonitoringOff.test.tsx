import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import "@testing-library/jest-dom";
import { cleanup, render } from "@testing-library/react";
import * as fs from "fs";
import * as path from "path";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * NOT OPERATIONAL LEAVES OUT MONITORS WHOSE MONITORING IS TURNED OFF
 * (issue #6400).
 *
 * A monitor whose monitoring is off is not checked, so the status it holds -
 * "Offline", say - is only what its last check saw. It was listed under Not
 * Operational, and counted in its badges, beside the monitors that really
 * are down, and its "Disabled" bubble said why only once the list was open.
 * It is listed under Disabled instead now: every list and count that says
 * "not operational" reads NotOperationalMonitorQuery - the Monitors menu's
 * badge, the Not Operational page and Home's number and attention strip,
 * which open that page (Home keeps no copy of the list: #6857).
 *
 * The real menu, page and Home read are run; ModelAPI and the table are
 * stubbed to record what they are asked for.
 */

const mockCount: MockFunction = getJestMockFunction();
const mockGetList: MockFunction = getJestMockFunction();
const mockTable: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      count: (...args: Array<unknown>): unknown => {
        return mockCount(...args);
      },
      getList: (...args: Array<unknown>): unknown => {
        return mockGetList(...args);
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

jest.mock("../../../UI/Utils/Analytics", () => {
  return { __esModule: true, default: { capture: jest.fn() } };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/MonitorTable",
  () => {
    return {
      __esModule: true,
      default: (props: unknown): null => {
        mockTable(props);
        return null;
      },
    };
  },
);

import { fetchNotOperationalMonitors } from "../../../../App/FeatureSet/Dashboard/src/Components/Home/HomeOverviewData";
import MonitorNotOperationalMonitors from "../../../../App/FeatureSet/Dashboard/src/Pages/Monitor/NotOperationalMonitors";
import MonitorsSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/Monitor/SideMenu";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import Project from "../../../Models/DatabaseModels/Project";
import ObjectID from "../../../Types/ObjectID";
import ProjectUtil from "../../../UI/Utils/Project";
import NotOperationalMonitorQuery from "../../../Utils/Monitor/NotOperationalMonitorQuery";
import {
  DESKTOP_WIDTH,
  PROJECT_ID,
  goTo,
  renderMenu,
  setViewportWidth,
} from "./SideMenuHarness";

// What "not operational" is, wherever a monitor list or count says it.
const NOT_OPERATIONAL: Record<string, unknown> = {
  isArchived: false,
  disableActiveMonitoring: false,
  currentMonitorStatus: {
    isOperationalState: false,
  },
};

/*
 * The same, asked in the monitors' project: the status is asked of that
 * project too (issue #8096), which lets Postgres read only the monitors
 * holding one of its statuses that are not operational.
 */
function notOperationalIn(projectId: string): Record<string, unknown> {
  return {
    isArchived: false,
    disableActiveMonitoring: false,
    currentMonitorStatus: {
      isOperationalState: false,
      projectId: new ObjectID(projectId),
    },
  };
}

function project(): Project {
  const value: Project = new Project();
  value._id = PROJECT_ID;
  return value;
}

interface CountCall {
  modelType: unknown;
  query: Record<string, unknown>;
}

function countCalls(): Array<CountCall> {
  return mockCount.mock.calls.map((call: Array<unknown>): CountCall => {
    return call[0] as CountCall;
  });
}

// The badge that counts monitors whose current status is not operational.
function notOperationalBadgeQueries(): Array<Record<string, unknown>> {
  return countCalls()
    .filter((call: CountCall): boolean => {
      return call.modelType === Monitor && "currentMonitorStatus" in call.query;
    })
    .map((call: CountCall): Record<string, unknown> => {
      return call.query;
    });
}

beforeEach(() => {
  mockCount.mockReset();
  mockGetList.mockReset();
  mockTable.mockReset();
  mockCount.mockResolvedValue(0 as never);
  mockGetList.mockResolvedValue({
    data: [],
    count: 0,
    skip: 0,
    limit: 0,
  } as never);
  setViewportWidth(DESKTOP_WIDTH);
  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID(PROJECT_ID));
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("NotOperationalMonitorQuery", () => {
  test("a monitor that is checked - not archived, monitoring on - whose status is not operational", () => {
    expect(NotOperationalMonitorQuery.getQuery()).toEqual(NOT_OPERATIONAL);
  });

  test("given its project, asks the status of that project too, as an id or as text", () => {
    expect(
      NotOperationalMonitorQuery.getQuery(new ObjectID(PROJECT_ID)),
    ).toEqual(notOperationalIn(PROJECT_ID));
    expect(NotOperationalMonitorQuery.getQuery(PROJECT_ID)).toEqual(
      notOperationalIn(PROJECT_ID),
    );
  });

  test("with no project it asks the status alone, as before", () => {
    expect(NotOperationalMonitorQuery.getQuery(undefined)).toEqual(
      NOT_OPERATIONAL,
    );
    expect(NotOperationalMonitorQuery.getQuery(null)).toEqual(NOT_OPERATIONAL);
  });

  test("hands out a fresh query each time: a caller that adds to it changes no one else's", () => {
    const first: Record<string, unknown> =
      NotOperationalMonitorQuery.getQuery() as Record<string, unknown>;
    first["name"] = "Checkout";
    (first["currentMonitorStatus"] as Record<string, unknown>)["name"] =
      "Offline";

    expect(NotOperationalMonitorQuery.getQuery()).toEqual(NOT_OPERATIONAL);
  });
});

describe("the menus' Not Operational badges count what the list shows", () => {
  test("the Monitors menu's badge leaves out monitors with monitoring off", async () => {
    goTo(`/dashboard/${PROJECT_ID}/monitors`);
    await renderMenu(<MonitorsSideMenu project={project()} />);

    expect(notOperationalBadgeQueries()).toEqual([
      { projectId: PROJECT_ID, ...notOperationalIn(PROJECT_ID) },
    ]);
  });

  test("the Monitors menu's Disabled badge still counts them: that is where they are listed", async () => {
    goTo(`/dashboard/${PROJECT_ID}/monitors`);
    await renderMenu(<MonitorsSideMenu project={project()} />);

    expect(
      countCalls()
        .map((call: CountCall): Record<string, unknown> => {
          return call.query;
        })
        .filter((query: Record<string, unknown>): boolean => {
          return query["disableActiveMonitoring"] === true;
        }),
    ).toEqual([
      {
        projectId: PROJECT_ID,
        isArchived: false,
        disableActiveMonitoring: true,
      },
    ]);
  });
});

describe("the Not Operational page lists them nowhere", () => {
  const pageProps: PageComponentProps = {} as PageComponentProps;

  test.each([["Monitors > Not Operational", MonitorNotOperationalMonitors]])(
    "%s asks the table for monitors with monitoring on only, and says so",
    (_name: string, Page: React.FunctionComponent<PageComponentProps>) => {
      render(<Page {...pageProps} />);

      expect(mockTable).toHaveBeenCalled();
      const props: {
        query: Record<string, unknown>;
        description: string;
        title: string;
      } = mockTable.mock.calls[0]![0] as {
        query: Record<string, unknown>;
        description: string;
        title: string;
      };

      expect({
        ...props.query,
        projectId: props.query["projectId"]?.toString(),
      }).toEqual({ projectId: PROJECT_ID, ...notOperationalIn(PROJECT_ID) });
      expect(props.title).toBe("Not Operational Monitors");
      expect(props.description).toBe(
        "Monitors whose current status is not operational, such as Degraded or Offline. Monitors with monitoring turned off are not listed. View a monitor to see what changed.",
      );
    },
  );
});

describe("Home's attention strip", () => {
  test("reads the monitors and their total with the same query", async () => {
    const projectId: ObjectID = new ObjectID(PROJECT_ID);

    await fetchNotOperationalMonitors(projectId);

    expect(mockGetList).toHaveBeenCalledTimes(1);
    const request: { modelType: unknown; query: Record<string, unknown> } =
      mockGetList.mock.calls[0]![0] as {
        modelType: unknown;
        query: Record<string, unknown>;
      };

    expect(request.modelType).toBe(Monitor);
    expect(request.query).toEqual({
      projectId: projectId,
      ...notOperationalIn(PROJECT_ID),
    });
  });
});

/*
 * Every place that lists or counts not operational monitors reads the one
 * rule, and builds no query of its own beside it: one written inline would
 * list monitors with monitoring off again.
 */
describe("one rule for every Not Operational list and count", () => {
  const PACKAGES: string = path.resolve(__dirname, "../../../..");

  test.each([
    "App/FeatureSet/Dashboard/src/Pages/Monitor/NotOperationalMonitors.tsx",
    "App/FeatureSet/Dashboard/src/Pages/Monitor/SideMenu.tsx",
    "App/FeatureSet/Dashboard/src/Components/Home/HomeOverviewData.ts",
    "Common/Server/Utils/AI/Toolbox/MonitorTools.ts",
    // The Monitor List widget's "non-operational", on a board and a public page (#6476).
    "Common/Utils/Dashboard/MonitorListWidgetFormat.ts",
  ])("%s reads NotOperationalMonitorQuery", (relativePath: string) => {
    const source: string = fs.readFileSync(
      path.join(PACKAGES, relativePath),
      "utf8",
    );

    expect(source).toMatch(/NotOperationalMonitorQuery\.getQuery\(/);
    expect(source).not.toMatch(/isOperationalState:\s*false/);
  });

  /*
   * Each one that knows the project it reads passes it, so its status is
   * asked in that project (issue #8096). The Monitor List widget's query is
   * built from a board's stored settings, the same on a board and on its
   * public page, with no project in sight: it asks the status alone.
   */
  test.each([
    [
      "App/FeatureSet/Dashboard/src/Pages/Monitor/NotOperationalMonitors.tsx",
      /NotOperationalMonitorQuery\.getQuery\(\s*ProjectUtil\.getCurrentProjectId\(\),?\s*\)/,
    ],
    [
      "App/FeatureSet/Dashboard/src/Pages/Monitor/SideMenu.tsx",
      /NotOperationalMonitorQuery\.getQuery\(props\.project\?\._id\)/,
    ],
    [
      "App/FeatureSet/Dashboard/src/Components/Home/HomeOverviewData.ts",
      /NotOperationalMonitorQuery\.getQuery\(projectId\)/,
    ],
    [
      "Common/Server/Utils/AI/Toolbox/MonitorTools.ts",
      /NotOperationalMonitorQuery\.getQuery\(ctx\.projectId\)/,
    ],
  ])("%s asks in its project", (relativePath: string, call: RegExp) => {
    const source: string = fs.readFileSync(
      path.join(PACKAGES, relativePath),
      "utf8",
    );

    expect(source).toMatch(call);
    expect(source).not.toContain("NotOperationalMonitorQuery.getQuery()");
  });
});
