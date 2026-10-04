import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * What the Dashboards page sends when a template card is picked is what
 * the server builds the new dashboard from.
 *
 * The page names the template in the create request's misc data
 * (Dashboard Components/Dashboard/DashboardCreateForm
 * addDashboardTemplateToMiscData, under DASHBOARD_TEMPLATE_MISC_DATA_KEY),
 * and DashboardService.onBeforeCreate turns it into the template's widgets.
 * Blank Dashboard, or no template, starts the dashboard empty. Billing is
 * pinned per test - CI's config.env turns it on - and both ways are run.
 */
jest.mock("../../../Server/EnvironmentConfig", () => {
  const billingFlag: typeof import("../Enterprise/TestBillingFlag") =
    jest.requireActual(
      "../Enterprise/TestBillingFlag",
    ) as typeof import("../Enterprise/TestBillingFlag");

  return billingFlag.withLiveBillingFlag(
    jest.requireActual("../../../Server/EnvironmentConfig") as Record<
      string,
      unknown
    >,
  );
});

import Dashboard from "../../../Models/DatabaseModels/Dashboard";
import DashboardService from "../../../Server/Services/DashboardService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import DashboardBaseComponent from "../../../Types/Dashboard/DashboardComponents/DashboardBaseComponent";
import {
  DASHBOARD_TEMPLATE_MISC_DATA_KEY,
  DashboardTemplate,
  DashboardTemplates,
  DashboardTemplateType,
  getTemplateConfig,
} from "../../../Types/Dashboard/DashboardTemplates";
import DashboardViewConfig from "../../../Types/Dashboard/DashboardViewConfig";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import { addDashboardTemplateToMiscData } from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/DashboardCreateForm";
import { setTestBillingEnabled } from "../Enterprise/TestBillingFlag";
import { getJestSpyOn } from "../../Spy";

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);

const TEMPLATES_WITH_WIDGETS: Array<DashboardTemplate> =
  DashboardTemplates.filter((template: DashboardTemplate): boolean => {
    return template.type !== DashboardTemplateType.Blank;
  });

// What the page sends for a picked card.
function createRequestFor(
  templateType: DashboardTemplateType | null,
  plan: PlanType,
): CreateBy<Dashboard> {
  const dashboard: Dashboard = new Dashboard();
  dashboard.name = "Kubernetes Dashboard 2";
  dashboard.projectId = PROJECT_ID;

  const miscDataProps: JSONObject = addDashboardTemplateToMiscData({
    miscDataProps: {},
    templateType: templateType,
  });

  return {
    data: dashboard,
    miscDataProps: miscDataProps,
    props: {
      tenantId: PROJECT_ID,
      currentPlan: plan,
    },
  } as unknown as CreateBy<Dashboard>;
}

async function runOnBeforeCreate(
  createBy: CreateBy<Dashboard>,
): Promise<DashboardViewConfig> {
  await (
    DashboardService as unknown as {
      onBeforeCreate: (c: CreateBy<Dashboard>) => Promise<unknown>;
    }
  ).onBeforeCreate(createBy);

  return createBy.data.dashboardViewConfig as DashboardViewConfig;
}

// Widget ids are new on every build of a template: compare what is built.
function widgetTypes(config: DashboardViewConfig): Array<string> {
  return config.components.map((component: DashboardBaseComponent): string => {
    return String(component.componentType);
  });
}

describe.each([
  ["billing off (self-hosted)", false],
  ["billing on (OneUptime Cloud)", true],
])(
  "a dashboard created from the picker, %s",
  (_name: string, billing: boolean) => {
    beforeEach(() => {
      setTestBillingEnabled(billing);
      // A project with no dashboard yet: the Free plan's one is still free.
      getJestSpyOn(DashboardService, "countBy").mockResolvedValue(
        new PositiveNumber(0),
      );
    });

    afterEach(() => {
      setTestBillingEnabled(false);
      jest.restoreAllMocks();
    });

    test.each(TEMPLATES_WITH_WIDGETS)(
      "$name is built with the template's widgets",
      async (template: DashboardTemplate) => {
        const config: DashboardViewConfig = await runOnBeforeCreate(
          createRequestFor(template.type, PlanType.Growth),
        );

        const expected: DashboardViewConfig | null = getTemplateConfig(
          template.type,
        );

        expect(expected).not.toBeNull();
        expect(config.components.length).toBeGreaterThan(0);
        expect(widgetTypes(config)).toEqual(widgetTypes(expected!));
      },
    );

    test("Blank Dashboard starts empty", async () => {
      const config: DashboardViewConfig = await runOnBeforeCreate(
        createRequestFor(DashboardTemplateType.Blank, PlanType.Growth),
      );

      expect(config.components).toEqual([]);
    });

    test("a create with no template (the API, Terraform) starts empty, as before", async () => {
      const config: DashboardViewConfig = await runOnBeforeCreate(
        createRequestFor(null, PlanType.Growth),
      );

      expect(config.components).toEqual([]);
    });

    test("a template value the server does not know starts empty", async () => {
      const createBy: CreateBy<Dashboard> = createRequestFor(
        null,
        PlanType.Growth,
      );
      (createBy.miscDataProps as JSONObject)[DASHBOARD_TEMPLATE_MISC_DATA_KEY] =
        "NotATemplate";

      const config: DashboardViewConfig = await runOnBeforeCreate(createBy);

      expect(config.components).toEqual([]);
    });

    test("the Free plan's first dashboard is built from its template too", async () => {
      const config: DashboardViewConfig = await runOnBeforeCreate(
        createRequestFor(DashboardTemplateType.Incident, PlanType.Free),
      );

      expect(widgetTypes(config)).toEqual(
        widgetTypes(getTemplateConfig(DashboardTemplateType.Incident)!),
      );
    });
  },
);

describe("the misc data key", () => {
  test("is read by the server from the one constant the page writes with", () => {
    const service: string = fs.readFileSync(
      path.join(__dirname, "../../../Server/Services/DashboardService.ts"),
      "utf8",
    );

    // Squashed, so prettier re-wrapping the line cannot fail this.
    expect(service.replace(/\s+/g, " ")).toContain(
      "createBy.miscDataProps?.[ DASHBOARD_TEMPLATE_MISC_DATA_KEY ]",
    );
    expect(service).not.toContain('"dashboardTemplateType"');
    expect(DASHBOARD_TEMPLATE_MISC_DATA_KEY).toBe("dashboardTemplateType");
  });
});
