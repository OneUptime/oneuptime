import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * Issue #4571, on the way in. A dashboard created through the API,
 * Terraform or a script with its config in the shape the API reference
 * documented - `{"_type": "DashboardViewConfig", "value": {"components":
 * [...]}}` - or as JSON text, has its widgets one level down.
 * DashboardService.onBeforeCreate checked only a top-level `components`, so
 * it replaced such a config, widgets and all, with an empty board.
 *
 * Now the check reads the config the way the dashboard does
 * (StoredDashboardViewConfig): a config with widgets is stored exactly as it
 * was sent - Terraform reads a write back and compares it with what it sent -
 * and only one with none gets the empty default. Billing is pinned per test
 * (CI's config.env turns it on) and both ways are run.
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
import DashboardViewConfig from "../../../Types/Dashboard/DashboardViewConfig";
import DefaultDashboardSize from "../../../Types/Dashboard/DashboardSize";
import { JSONObject, ObjectType } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import StoredDashboardViewConfig from "../../../Utils/Dashboard/StoredDashboardViewConfig";
import { setTestBillingEnabled } from "../Enterprise/TestBillingFlag";
import { getJestSpyOn } from "../../Spy";

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);

const TEXT_WIDGET: JSONObject = {
  componentId: "550e8400-e29b-41d4-a716-446655440000",
  componentType: "Text",
  widthInDashboardUnits: 6,
  heightInDashboardUnits: 2,
  topInDashboardUnits: 0,
  leftInDashboardUnits: 0,
  arguments: { text: "Checkout service" },
};

// A create through the CRUD API: no template, the config as the caller sent it.
function createRequest(
  dashboardViewConfig: unknown,
  plan: PlanType,
): CreateBy<Dashboard> {
  const dashboard: Dashboard = new Dashboard();
  dashboard.name = "Written through the API";
  dashboard.projectId = PROJECT_ID;

  if (dashboardViewConfig !== undefined) {
    dashboard.dashboardViewConfig = dashboardViewConfig as DashboardViewConfig;
  }

  return {
    data: dashboard,
    miscDataProps: {},
    props: {
      tenantId: PROJECT_ID,
      currentPlan: plan,
    },
  } as unknown as CreateBy<Dashboard>;
}

async function storedOnCreate(
  dashboardViewConfig: unknown,
  plan: PlanType = PlanType.Growth,
): Promise<unknown> {
  const createBy: CreateBy<Dashboard> = createRequest(
    dashboardViewConfig,
    plan,
  );

  await (
    DashboardService as unknown as {
      onBeforeCreate: (c: CreateBy<Dashboard>) => Promise<unknown>;
    }
  ).onBeforeCreate(createBy);

  return createBy.data.dashboardViewConfig;
}

function expectTheEmptyDefault(stored: unknown): void {
  expect(stored).toEqual({
    _type: ObjectType.DashboardViewConfig,
    components: [],
    heightInDashboardUnits: DefaultDashboardSize.heightInDashboardUnits,
  });
}

describe.each([
  ["billing off (self-hosted)", false],
  ["billing on (OneUptime Cloud)", true],
])(
  "a dashboard created with its config, %s",
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

    test("the API reference's envelope keeps its widgets: stored exactly as sent", async () => {
      const sent: JSONObject = {
        _type: "DashboardViewConfig",
        value: { components: [TEXT_WIDGET] },
      };

      const stored: unknown = await storedOnCreate(sent);

      expect(stored).toBe(sent);
      // And the dashboard draws its widget.
      expect(
        StoredDashboardViewConfig.read(stored).components.map(
          (component: { componentType: string }) => {
            return component.componentType;
          },
        ),
      ).toEqual(["Text"]);
    });

    test("a config sent as JSON text keeps its widgets: stored exactly as sent", async () => {
      const sent: string = JSON.stringify({ components: [TEXT_WIDGET] });

      expect(await storedOnCreate(sent)).toBe(sent);
    });

    test("the editor's own shape is stored exactly as sent", async () => {
      const sent: JSONObject = {
        _type: "DashboardViewConfig",
        components: [TEXT_WIDGET],
        heightInDashboardUnits: 12,
      };

      expect(await storedOnCreate(sent)).toBe(sent);
    });

    test("a widget of a type this version does not draw is still a widget: kept", async () => {
      const sent: JSONObject = {
        components: [{ ...TEXT_WIDGET, componentType: "FromANewerVersion" }],
      };

      expect(await storedOnCreate(sent)).toBe(sent);
    });

    test.each([
      ["no config", undefined],
      ["an empty object", {}],
      ["an empty widget list", { components: [] }],
      ["a widget list of junk", { components: [null, 42, "x"] }],
      ["a widget list that is not a list", { components: "x" }],
      ["an empty envelope", { _type: "DashboardViewConfig", value: {} }],
      ["text that is not JSON", "not json"],
      ["a number", 42],
    ])(
      "a config with no widget (%s) gets the empty board",
      async (_name: string, sent: unknown) => {
        expectTheEmptyDefault(await storedOnCreate(sent));
      },
    );

    test("the Free plan's first dashboard keeps its envelope's widgets too", async () => {
      const sent: JSONObject = {
        _type: "DashboardViewConfig",
        value: { components: [TEXT_WIDGET] },
      };

      expect(await storedOnCreate(sent, PlanType.Free)).toBe(sent);
    });
  },
);
