import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * Creating a dashboard from a template: the create form's fields, the name
 * it starts with, what it tells the server, and where it goes once created
 * (Dashboard Components/Dashboard/DashboardCreateForm.ts).
 *
 *   - Picking "Kubernetes Dashboard" fills the Name in with "Kubernetes
 *     Dashboard", or "Kubernetes Dashboard 2" when the project has one: a
 *     dashboard's name is unique in its project, and the server refuses a
 *     copy. Blank Dashboard leaves the Name to its creator.
 *   - The Description waits under the folded More fields section.
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
import { ModelField } from "../../../UI/Components/Forms/ModelForm";
import FormFieldSchemaType from "../../../UI/Components/Forms/Types/FormFieldSchemaType";
import {
  ADVANCED_FORM_SECTION_ID,
  MORE_FIELDS_SECTION_TITLE,
} from "../../../UI/Components/Forms/Utils/AdvancedFormSection";
import {
  addDashboardTemplateToMiscData,
  fetchDashboardNames,
  getDashboardCreateFormFields,
  getDashboardCreateInitialValues,
  getDashboardNameForTemplate,
  getDashboardViewRoute,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/DashboardCreateForm";

const PROJECT_ID: string = "00000000-0000-4000-8000-000000000001";

const TEMPLATES_WITH_WIDGETS: Array<DashboardTemplate> =
  DashboardTemplates.filter((template: DashboardTemplate): boolean => {
    return template.type !== DashboardTemplateType.Blank;
  });

function fieldKey(field: ModelField<Dashboard>): string {
  return Object.keys(field.field || {})[0] || "";
}

beforeEach(() => {
  getListMock.mockReset();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the create form", () => {
  test("is a Name, then the Description folded under More fields", () => {
    const fields: Array<ModelField<Dashboard>> = getDashboardCreateFormFields();

    expect(fields.map(fieldKey)).toEqual(["name", "description"]);

    const name: ModelField<Dashboard> = fields[0]!;
    expect(name.title).toBe("Name");
    expect(name.fieldType).toBe(FormFieldSchemaType.Text);
    expect(name.required).toBe(true);
    // The server's rule for a name: at least two characters.
    expect(name.validation?.minLength).toBe(2);
    expect(name.collapsibleSection).toBeUndefined();
    // An example of a good name, not the field's title again.
    expect(name.placeholder).toBe("Production API Health");

    const description: ModelField<Dashboard> = fields[1]!;
    expect(description.title).toBe("Description");
    expect(description.required).toBe(false);
    expect(description.collapsibleSection?.id).toBe(ADVANCED_FORM_SECTION_ID);
    expect(description.collapsibleSection?.title).toBe(
      MORE_FIELDS_SECTION_TITLE,
    );
    // Lists what it holds while folded, and never opens by itself.
    expect(description.collapsibleSection?.listFieldsWhileFolded).toBe(true);
    expect(description.collapsibleSection?.openWhenConfigured).toBe(false);
  });

  test("walks no steps", () => {
    for (const field of getDashboardCreateFormFields()) {
      expect(field.stepId).toBeUndefined();
    }
  });

  test("every field is a column the create request may carry", () => {
    const dashboard: Dashboard = new Dashboard();

    for (const field of getDashboardCreateFormFields()) {
      expect(dashboard.getTableColumnMetadata(fieldKey(field))).toBeDefined();
    }
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

describe("what the create form starts with", () => {
  test("a template's name, made unique", () => {
    expect(
      getDashboardCreateInitialValues({
        templateType: DashboardTemplateType.Incident,
        existingNames: ["Incident Dashboard"],
      }),
    ).toEqual({ name: "Incident Dashboard 2" });
  });

  test("nothing for Blank Dashboard, so the Name shows its placeholder", () => {
    expect(
      getDashboardCreateInitialValues({
        templateType: DashboardTemplateType.Blank,
        existingNames: ["Incident Dashboard"],
      }),
    ).toEqual({});
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
  test("every template type has its card", () => {
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

  test("every template's name is a name the form accepts as it is", () => {
    for (const template of TEMPLATES_WITH_WIDGETS) {
      const name: string = getDashboardTemplateStartingName(template.type);

      expect(name).toBe(template.name);
      expect(name.trim()).toBe(name);
      // The Name field's minLength, with room for " 99" in a busy project.
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
