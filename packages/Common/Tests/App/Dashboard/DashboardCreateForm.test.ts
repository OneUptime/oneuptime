import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * Creating a dashboard from a template: the name it starts with, what the
 * create request tells the server, the names it is compared with, and
 * where it goes once created (Dashboard Components/Dashboard/
 * DashboardCreateForm.ts). Create a dashboard (CreateDashboardModal) reads
 * these; its own tests are CreateDashboardModal.test.tsx.
 *
 *   - Picking "Kubernetes Dashboard" fills the Name in with "Kubernetes
 *     Dashboard", or "Kubernetes Dashboard 2" when the project has one: a
 *     dashboard's name is unique in its project, and the server refuses a
 *     copy. Start from scratch leaves the Name to its creator.
 *   - The create request names the template in the misc data the server
 *     reads, and the new dashboard opens.
 */

const getListMock: jest.Mock<any> = jest.fn() as jest.Mock<any>;

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

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (): { toString: () => string } => {
        return {
          toString: (): string => {
            return "00000000-0000-4000-8000-000000000001";
          },
        };
      },
    },
  };
});

import Dashboard from "../../../Models/DatabaseModels/Dashboard";
import {
  DASHBOARD_TEMPLATE_MISC_DATA_KEY,
  DashboardTemplate,
  DashboardTemplates,
  DashboardTemplateType,
  getDashboardTemplate,
  getDashboardTemplateStartingName,
  getTemplateConfig,
} from "../../../Types/Dashboard/DashboardTemplates";
import ColumnLength from "../../../Types/Database/ColumnLength";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import * as DashboardCreateForm from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/DashboardCreateForm";
import {
  addDashboardTemplateToMiscData,
  fetchDashboardNames,
  getDashboardNameForTemplate,
  getDashboardViewRoute,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/DashboardCreateForm";

const PROJECT_ID: string = "00000000-0000-4000-8000-000000000001";

const TEMPLATES_WITH_WIDGETS: Array<DashboardTemplate> =
  DashboardTemplates.filter((template: DashboardTemplate): boolean => {
    return template.type !== DashboardTemplateType.Blank;
  });

beforeEach(() => {
  getListMock.mockReset();
});

afterEach(() => {
  jest.restoreAllMocks();
});

/*
 * The table's own create form - a Name, and the Description under More
 * fields - and the values it opened with are gone with it: Create a
 * dashboard asks for the name on its own Name step.
 */
describe("the module", () => {
  test("no longer builds the table's create form", () => {
    expect(Object.keys(DashboardCreateForm).sort()).toEqual([
      "addDashboardTemplateToMiscData",
      "fetchDashboardNames",
      "getDashboardNameForTemplate",
      "getDashboardViewRoute",
    ]);
  });
});

describe("the name a template starts the dashboard with", () => {
  test.each(TEMPLATES_WITH_WIDGETS)(
    "$name fills in its own name in an empty project",
    (template: DashboardTemplate) => {
      expect(
        getDashboardNameForTemplate({
          templateType: template.type,
          existingNames: [],
        }),
      ).toBe(template.name);
    },
  );

  test.each(TEMPLATES_WITH_WIDGETS)(
    "$name is numbered past the dashboards that have its name",
    (template: DashboardTemplate) => {
      expect(
        getDashboardNameForTemplate({
          templateType: template.type,
          existingNames: [template.name],
        }),
      ).toBe(`${template.name} 2`);

      expect(
        getDashboardNameForTemplate({
          templateType: template.type,
          existingNames: [
            template.name.toUpperCase(),
            `${template.name} 2`,
            "Something else",
          ],
        }),
      ).toBe(`${template.name} 3`);
    },
  );

  test("Blank Dashboard leaves the name to its creator", () => {
    expect(
      getDashboardNameForTemplate({
        templateType: DashboardTemplateType.Blank,
        existingNames: [],
      }),
    ).toBe("");

    expect(
      getDashboardNameForTemplate({
        templateType: DashboardTemplateType.Blank,
        existingNames: ["Blank Dashboard"],
      }),
    ).toBe("");
  });

  test("another template's dashboards do not take the name", () => {
    expect(
      getDashboardNameForTemplate({
        templateType: DashboardTemplateType.Kubernetes,
        existingNames: ["Kubernetes Cost Dashboard", "Hosts Dashboard"],
      }),
    ).toBe("Kubernetes Dashboard");
  });
});

describe("what the create request tells the server", () => {
  test.each(TEMPLATES_WITH_WIDGETS)(
    "$name: the template the server builds the dashboard from",
    (template: DashboardTemplate) => {
      const miscDataProps: JSONObject = {};

      addDashboardTemplateToMiscData({
        miscDataProps,
        templateType: template.type,
      });

      expect(miscDataProps).toEqual({
        [DASHBOARD_TEMPLATE_MISC_DATA_KEY]: template.type,
      });
      // A value the server turns into widgets (DashboardService).
      expect(
        getTemplateConfig(
          miscDataProps[
            DASHBOARD_TEMPLATE_MISC_DATA_KEY
          ] as DashboardTemplateType,
        ),
      ).not.toBeNull();
    },
  );

  test.each([DashboardTemplateType.Blank, null, undefined])(
    "nothing for %j: the dashboard starts empty",
    (templateType: DashboardTemplateType | null | undefined) => {
      const miscDataProps: JSONObject = { somethingElse: true };

      addDashboardTemplateToMiscData({ miscDataProps, templateType });

      expect(miscDataProps).toEqual({ somethingElse: true });
    },
  );

  test("the misc data key is the one DashboardService has always read", () => {
    expect(DASHBOARD_TEMPLATE_MISC_DATA_KEY).toBe("dashboardTemplateType");
  });
});

describe("the names a new dashboard's name is compared with", () => {
  test("are every dashboard's of the project, archived ones too, in one request", async () => {
    getListMock.mockImplementation(() => {
      return Promise.resolve({
        data: [
          { name: "Kubernetes Dashboard" },
          { name: "Archived Hosts Dashboard" },
        ],
        count: 2,
        skip: 0,
        limit: LIMIT_PER_PROJECT,
      });
    });

    await expect(fetchDashboardNames()).resolves.toEqual([
      "Kubernetes Dashboard",
      "Archived Hosts Dashboard",
    ]);

    expect(getListMock).toHaveBeenCalledTimes(1);

    const request: {
      modelType: unknown;
      query: JSONObject;
      select: JSONObject;
      limit: number;
      skip: number;
    } = getListMock.mock.calls[0]![0] as {
      modelType: unknown;
      query: JSONObject;
      select: JSONObject;
      limit: number;
      skip: number;
    };

    expect(request.modelType).toBe(Dashboard);
    // No isArchived filter: the server's unique check counts archived ones.
    expect(request.query).toEqual({});
    expect(request.select).toEqual({ name: true });
    expect(request.limit).toBe(LIMIT_PER_PROJECT);
    expect(request.skip).toBe(0);
  });

  test("leave out rows without a name", async () => {
    getListMock.mockImplementation(() => {
      return Promise.resolve({
        data: [{ name: "Alert Dashboard" }, { name: "" }, {}, { name: "  " }],
        count: 4,
        skip: 0,
        limit: LIMIT_PER_PROJECT,
      });
    });

    await expect(fetchDashboardNames()).resolves.toEqual(["Alert Dashboard"]);
  });

  test("are none when the lookup fails: the server's check still decides", async () => {
    getListMock.mockImplementation(() => {
      return Promise.reject(new Error("Network error"));
    });

    await expect(fetchDashboardNames()).resolves.toEqual([]);
  });
});

describe("where a new dashboard opens", () => {
  test("on its own page: the canvas", () => {
    const id: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");

    expect(getDashboardViewRoute(id).toString()).toBe(
      `/dashboard/${PROJECT_ID}/dashboards/${id.toString()}`,
    );
  });
});

describe("the template catalog, as names", () => {
  test("every template type has its catalog entry", () => {
    for (const type of Object.values(DashboardTemplateType)) {
      expect(getDashboardTemplate(type)?.type).toBe(type);
    }
  });

  test("no two templates have one name, so their dashboards can be told apart", () => {
    const names: Array<string> = DashboardTemplates.map(
      (template: DashboardTemplate): string => {
        return template.name.trim().toLowerCase();
      },
    );

    expect(new Set(names).size).toBe(names.length);
  });

  test("every template's name is a name the Name step accepts as it is", () => {
    for (const template of TEMPLATES_WITH_WIDGETS) {
      const name: string = getDashboardTemplateStartingName(template.type);

      expect(name).toBe(template.name);
      expect(name.trim()).toBe(name);
      // The Name step's two letters, with room for " 99" in a busy project.
      expect(name.length).toBeGreaterThanOrEqual(2);
      expect(name.length + 3).toBeLessThanOrEqual(ColumnLength.ShortText);
    }
  });

  test("Blank Dashboard starts with no name", () => {
    expect(getDashboardTemplateStartingName(DashboardTemplateType.Blank)).toBe(
      "",
    );
  });
});
