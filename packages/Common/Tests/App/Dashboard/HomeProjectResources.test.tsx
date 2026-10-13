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
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Home's "Your project" card (Components/Home/ProjectResources.tsx): how many
 * monitors, status pages, on-call policies, SLOs, services, dashboards and
 * workflows the project has, each opening its list, and "Set up" where there
 * are none. Monitors and SLOs come from Home's batch; the other five are
 * counted here, archived records left out as their lists leave them out.
 */

const LOCALES_DIR: string = path.join(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

type LocaleData = Record<string, unknown>;

const EN: LocaleData = JSON.parse(
  fs.readFileSync(path.join(LOCALES_DIR, "en.json"), "utf8"),
) as LocaleData;
const DE: LocaleData = JSON.parse(
  fs.readFileSync(path.join(LOCALES_DIR, "de.json"), "utf8"),
) as LocaleData;

let activeLocale: LocaleData = EN;

const countMock: MockFunction = getJestMockFunction();
const analyticsMock: MockFunction = getJestMockFunction();

// The count, Set up and placeholder inside a row carry its test id plus one of these.
const INNER_PART_TEST_ID: RegExp = /-(count|set-up|loading)$/;

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, options?: unknown): string => {
          const flat: unknown = activeLocale[key];
          if (typeof flat === "string") {
            return flat;
          }
          return (
            (options as { defaultValue?: string } | undefined)?.defaultValue ??
            key
          );
        },
        i18n: { language: activeLocale === DE ? "de" : "en" },
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

import ProjectResources, {
  PROJECT_RESOURCES,
  ProjectResourceDefinition,
  ProjectResourceKey,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Home/ProjectResources";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import Dashboard from "../../../Models/DatabaseModels/Dashboard";
import OnCallDutyPolicy from "../../../Models/DatabaseModels/OnCallDutyPolicy";
import Service from "../../../Models/DatabaseModels/Service";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import Workflow from "../../../Models/DatabaseModels/Workflow";
import ObjectID from "../../../Types/ObjectID";

const PROJECT_ID: string = "65f00000000000000000cccc";
let currentProjectId: ObjectID | null = new ObjectID(PROJECT_ID);

interface CountRequest {
  modelType: unknown;
  query: Record<string, unknown>;
}

// Rows each counted model holds, unarchived; any archived row is left out.
let counts: Map<unknown, number> = new Map();
let failing: Set<unknown> = new Set();
let countRequests: Array<CountRequest> = [];

function answerCounts(): void {
  countMock.mockImplementation((...args: Array<unknown>) => {
    const request: CountRequest = args[0] as CountRequest;
    countRequests.push(request);
    if (failing.has(request.modelType)) {
      return Promise.reject(new Error("You may not read this."));
    }
    return Promise.resolve(counts.get(request.modelType) ?? 0);
  });
}

function routeOf(pageMap: PageMap): string {
  return RouteMap[pageMap]!.toString().replace(":projectId", PROJECT_ID);
}

const PROJECT: ObjectID = new ObjectID(PROJECT_ID);

function Card(props: {
  totalMonitors?: number | null | undefined;
  totalSlos?: number | null | undefined;
  refreshKey?: number | undefined;
}): React.ReactElement {
  return (
    <MemoryRouter>
      <ProjectResources
        projectId={PROJECT}
        totalMonitors={props.totalMonitors}
        totalSlos={props.totalSlos}
        refreshKey={props.refreshKey}
      />
    </MemoryRouter>
  );
}

async function renderCard(
  props: {
    totalMonitors?: number | null | undefined;
    totalSlos?: number | null | undefined;
  } = { totalMonitors: 11, totalSlos: 4 },
): Promise<void> {
  await act(async () => {
    render(<Card {...props} />);
  });
  await waitFor(() => {
    expect(
      screen.queryAllByTestId(/^home-resource-[a-z-]+-loading$/),
    ).toHaveLength(0);
  });
}

function row(key: ProjectResourceKey): HTMLElement {
  return screen.getByTestId(`home-resource-${key}`);
}

function hrefOf(key: ProjectResourceKey): string {
  return row(key).closest("a")?.getAttribute("href") || "";
}

beforeEach(() => {
  activeLocale = EN;
  currentProjectId = new ObjectID(PROJECT_ID);
  counts = new Map<unknown, number>([
    [StatusPage, 2],
    [OnCallDutyPolicy, 3],
    [Service, 8],
    [Dashboard, 4],
    [Workflow, 0],
  ]);
  failing = new Set();
  countRequests = [];
  answerCounts();
});

afterEach(() => {
  cleanup();
  countMock.mockReset();
  analyticsMock.mockReset();
});

describe("what the card lists", () => {
  test("the seven resources, in their order, each with its count", async () => {
    await renderCard();

    // The rows, not the count, Set up and placeholder inside each.
    const keys: Array<string> = screen
      .getAllByTestId(/^home-resource-[a-z-]+$/)
      .map((element: HTMLElement): string => {
        return (element.getAttribute("data-testid") || "").replace(
          "home-resource-",
          "",
        );
      })
      .filter((key: string): boolean => {
        return !INNER_PART_TEST_ID.test(key);
      });

    expect(keys).toEqual([
      "monitors",
      "status-pages",
      "on-call-policies",
      "slos",
      "services",
      "dashboards",
      "workflows",
    ]);
    expect(row(ProjectResourceKey.Monitors)).toHaveTextContent("Monitors11");
    expect(row(ProjectResourceKey.StatusPages)).toHaveTextContent(
      "Status Pages2",
    );
    expect(row(ProjectResourceKey.OnCallPolicies)).toHaveTextContent(
      "On-Call Policies3",
    );
    expect(row(ProjectResourceKey.Slos)).toHaveTextContent("SLOs4");
    expect(row(ProjectResourceKey.Services)).toHaveTextContent("Services8");
    expect(row(ProjectResourceKey.Dashboards)).toHaveTextContent("Dashboards4");
  });

  test("none of something: Set up, instead of a zero", async () => {
    await renderCard();

    expect(
      screen.getByTestId("home-resource-workflows-set-up"),
    ).toHaveTextContent("Set up");
    expect(screen.queryByTestId("home-resource-workflows-count")).toBeNull();
  });

  test("a new project: every resource says Set up", async () => {
    counts = new Map();
    await renderCard({ totalMonitors: 0, totalSlos: 0 });

    for (const resource of PROJECT_RESOURCES) {
      expect(
        screen.getByTestId(`home-resource-${resource.key}-set-up`),
      ).toBeInTheDocument();
    }
  });

  test("every row opens its list", async () => {
    await renderCard();

    expect(hrefOf(ProjectResourceKey.Monitors)).toBe(routeOf(PageMap.MONITORS));
    expect(hrefOf(ProjectResourceKey.StatusPages)).toBe(
      routeOf(PageMap.STATUS_PAGES),
    );
    expect(hrefOf(ProjectResourceKey.OnCallPolicies)).toBe(
      routeOf(PageMap.ON_CALL_DUTY_POLICIES),
    );
    expect(hrefOf(ProjectResourceKey.Slos)).toBe(routeOf(PageMap.SLOS));
    expect(hrefOf(ProjectResourceKey.Services)).toBe(routeOf(PageMap.SERVICES));
    expect(hrefOf(ProjectResourceKey.Dashboards)).toBe(
      routeOf(PageMap.DASHBOARDS),
    );
    expect(hrefOf(ProjectResourceKey.Workflows)).toBe(
      routeOf(PageMap.WORKFLOWS),
    );
  });

  test("opening a row is recorded, with whether it was empty", async () => {
    await renderCard();

    fireEvent.click(row(ProjectResourceKey.Workflows));

    expect(analyticsMock).toHaveBeenCalledWith(
      "dashboard/home/resource-opened",
      {
        projectId: PROJECT_ID,
        resource: "workflows",
        isEmpty: true,
      },
    );
  });
});

describe("the counts", () => {
  test("five counts, one per resource Home's batch does not count, archived left out", async () => {
    await renderCard();

    const counted: Array<unknown> = countRequests.map(
      (request: CountRequest): unknown => {
        return request.modelType;
      },
    );

    expect(counted).toHaveLength(5);
    expect(new Set(counted)).toEqual(
      new Set([StatusPage, OnCallDutyPolicy, Service, Dashboard, Workflow]),
    );
    for (const request of countRequests) {
      expect(Object.keys(request.query).sort()).toEqual([
        "isArchived",
        "projectId",
      ]);
      expect(request.query["isArchived"]).toBe(false);
      expect(String(request.query["projectId"])).toBe(PROJECT_ID);
    }
  });

  test("monitors and SLOs are never counted twice: they come from Home's batch", async () => {
    await renderCard({ totalMonitors: 3, totalSlos: 1 });

    const definitions: Array<ProjectResourceDefinition> =
      PROJECT_RESOURCES.filter(
        (resource: ProjectResourceDefinition): boolean => {
          return !resource.count;
        },
      );

    expect(
      definitions.map((resource: ProjectResourceDefinition): string => {
        return resource.key;
      }),
    ).toEqual(["monitors", "slos"]);
    expect(row(ProjectResourceKey.Monitors)).toHaveTextContent("3");
    expect(row(ProjectResourceKey.Slos)).toHaveTextContent("1");
  });

  test("a count that is still loading shows a placeholder", async () => {
    countMock.mockImplementation(() => {
      return new Promise(() => {
        // never answered
      });
    });

    await act(async () => {
      render(<Card totalMonitors={null} totalSlos={null} />);
    });

    for (const resource of PROJECT_RESOURCES) {
      expect(
        screen.getByTestId(`home-resource-${resource.key}-loading`),
      ).toBeInTheDocument();
    }
  });

  test("a count the role may not read loses its row, not the card", async () => {
    failing = new Set([Workflow, StatusPage]);
    await renderCard();

    expect(screen.queryByTestId("home-resource-workflows")).toBeNull();
    expect(screen.queryByTestId("home-resource-status-pages")).toBeNull();
    expect(row(ProjectResourceKey.Services)).toHaveTextContent("8");
    expect(row(ProjectResourceKey.Monitors)).toHaveTextContent("11");
  });

  test("Home's batch failing loses the monitor and SLO rows only", async () => {
    await renderCard({ totalMonitors: undefined, totalSlos: undefined });

    expect(screen.queryByTestId("home-resource-monitors")).toBeNull();
    expect(screen.queryByTestId("home-resource-slos")).toBeNull();
    expect(row(ProjectResourceKey.Dashboards)).toHaveTextContent("4");
  });

  test("Refresh counts again", async () => {
    const { rerender } = render(
      <Card totalMonitors={11} totalSlos={4} refreshKey={0} />,
    );
    await waitFor(() => {
      expect(countRequests).toHaveLength(5);
    });

    counts.set(Workflow, 2);

    await act(async () => {
      rerender(<Card totalMonitors={11} totalSlos={4} refreshKey={1} />);
    });

    await waitFor(() => {
      expect(
        screen.getByTestId("home-resource-workflows-count"),
      ).toHaveTextContent("2");
    });
    expect(countRequests).toHaveLength(10);
  });
});

describe("in German", () => {
  test("the titles and Set up are the de.json translations", async () => {
    activeLocale = DE;
    await renderCard();

    for (const english of ["Status Pages", "Workflows", "Services"]) {
      const german: unknown = DE[english];
      expect(typeof german).toBe("string");
      expect(german).not.toBe(english);
      expect(screen.getByTestId("home-project-resources")).toHaveTextContent(
        german as string,
      );
    }
    expect(
      screen.getByTestId("home-resource-workflows-set-up"),
    ).toHaveTextContent(DE["Set up"] as string);
  });
});
