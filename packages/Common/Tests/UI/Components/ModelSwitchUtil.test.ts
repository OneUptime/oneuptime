import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { getJestSpyOn } from "../../Spy";
import {
  getColumnBooleanDefault,
  getPlanNeededToChangeColumn,
  getStoredValueForSwitch,
  isModelSwitchOn,
  ModelSwitchColumn,
} from "../../../UI/Components/ModelSwitch/ModelSwitchUtil";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import Project from "../../../Models/DatabaseModels/Project";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import SubscriptionPlan, {
  PlanType,
} from "../../../Types/Billing/SubscriptionPlan";
import ProjectUtil from "../../../UI/Utils/Project";

/*
 * What a one-switch setting needs to know about its column, without React:
 * which plan would let this project change it, what it holds when nothing
 * was ever written, and how a switch - straight or inverted - reads it and
 * writes it.
 */

let plan: PlanType | null = null;

const PLAN_ORDER: Array<PlanType> = [
  PlanType.Free,
  PlanType.Growth,
  PlanType.Scale,
  PlanType.Enterprise,
];

beforeEach(() => {
  plan = null;

  getJestSpyOn(ProjectUtil, "getCurrentPlan").mockImplementation(
    (): PlanType | null => {
      return plan;
    },
  );

  getJestSpyOn(
    SubscriptionPlan,
    "isFeatureAccessibleOnCurrentPlan",
  ).mockImplementation((needed: unknown, current: unknown): boolean => {
    return (
      PLAN_ORDER.indexOf(current as PlanType) >=
      PLAN_ORDER.indexOf(needed as PlanType)
    );
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("getPlanNeededToChangeColumn", () => {
  test("names the column's update plan when the project's plan is below it", () => {
    plan = PlanType.Free;

    // The embedded status badge is a Growth feature to switch on.
    expect(
      getPlanNeededToChangeColumn(
        new StatusPage(),
        "enableEmbeddedOverallStatus",
      ),
    ).toBe(PlanType.Growth);
  });

  test("says nothing on a plan that includes it", () => {
    plan = PlanType.Growth;

    expect(
      getPlanNeededToChangeColumn(
        new StatusPage(),
        "enableEmbeddedOverallStatus",
      ),
    ).toBeNull();

    plan = PlanType.Enterprise;

    expect(
      getPlanNeededToChangeColumn(
        new StatusPage(),
        "enableEmbeddedOverallStatus",
      ),
    ).toBeNull();
  });

  test("says nothing for a column with no plan rule", () => {
    plan = PlanType.Free;

    expect(
      getPlanNeededToChangeColumn(new StatusPage(), "enableMcpServer"),
    ).toBeNull();
    expect(
      getPlanNeededToChangeColumn(new Monitor(), "disableActiveMonitoring"),
    ).toBeNull();
    expect(
      getPlanNeededToChangeColumn(
        new Project(),
        "doNotAddGlobalProbesByDefaultOnNewMonitors",
      ),
    ).toBeNull();
  });

  test("with billing off (no plan) it says nothing, and does not ask", () => {
    plan = null;

    expect(
      getPlanNeededToChangeColumn(
        new StatusPage(),
        "enableEmbeddedOverallStatus",
      ),
    ).toBeNull();
    expect(
      SubscriptionPlan.isFeatureAccessibleOnCurrentPlan,
    ).not.toHaveBeenCalled();
  });

  test("a plan it cannot read is no reason to say anything", () => {
    plan = PlanType.Free;
    getJestSpyOn(
      SubscriptionPlan,
      "isFeatureAccessibleOnCurrentPlan",
    ).mockImplementation((): boolean => {
      throw new Error("Invalid Plan");
    });

    expect(
      getPlanNeededToChangeColumn(
        new StatusPage(),
        "enableEmbeddedOverallStatus",
      ),
    ).toBeNull();
  });
});

describe("getColumnBooleanDefault", () => {
  test("is the default the model declares", () => {
    expect(getColumnBooleanDefault(new StatusPage(), "enableMcpServer")).toBe(
      true,
    );
    expect(
      getColumnBooleanDefault(new StatusPage(), "enableEmbeddedOverallStatus"),
    ).toBe(false);
    expect(
      getColumnBooleanDefault(new Monitor(), "disableActiveMonitoring"),
    ).toBe(false);
    expect(
      getColumnBooleanDefault(
        new Project(),
        "doNotAddGlobalProbesByDefaultOnNewMonitors",
      ),
    ).toBe(false);
  });

  test("is off for a column the model does not know", () => {
    expect(getColumnBooleanDefault(new StatusPage(), "noSuchColumn")).toBe(
      false,
    );
  });
});

describe("isModelSwitchOn and getStoredValueForSwitch", () => {
  test("a straight switch is on while the column is true", () => {
    expect(isModelSwitchOn({ stored: true, defaultValue: false })).toBe(true);
    expect(isModelSwitchOn({ stored: false, defaultValue: true })).toBe(false);
    expect(getStoredValueForSwitch({ isOn: true })).toBe(true);
    expect(getStoredValueForSwitch({ isOn: false })).toBe(false);
  });

  test("an inverted switch is on while the column is false", () => {
    expect(
      isModelSwitchOn({ stored: false, defaultValue: false, isInverted: true }),
    ).toBe(true);
    expect(
      isModelSwitchOn({ stored: true, defaultValue: false, isInverted: true }),
    ).toBe(false);
    expect(getStoredValueForSwitch({ isOn: true, isInverted: true })).toBe(
      false,
    );
    expect(getStoredValueForSwitch({ isOn: false, isInverted: true })).toBe(
      true,
    );
  });

  test("nothing stored reads as the default, the right way round", () => {
    for (const stored of [undefined, null, "true", 1]) {
      expect(isModelSwitchOn({ stored, defaultValue: true })).toBe(true);
      expect(isModelSwitchOn({ stored, defaultValue: false })).toBe(false);
      expect(
        isModelSwitchOn({ stored, defaultValue: false, isInverted: true }),
      ).toBe(true);
    }
  });

  test("reading what a switch stores gives the switch back", () => {
    for (const isInverted of [false, true]) {
      for (const isOn of [false, true]) {
        expect(
          isModelSwitchOn({
            stored: getStoredValueForSwitch({ isOn, isInverted }),
            defaultValue: !isOn,
            isInverted,
          }),
        ).toBe(isOn);
      }
    }
  });
});

describe("ModelSwitchColumn", () => {
  test("names boolean columns (checked by the compiler)", () => {
    const columns: Array<ModelSwitchColumn<StatusPage>> = [
      "enableMcpServer",
      "enableEmbeddedOverallStatus",
      "enableSearchEngineIndexing",
    ];
    const monitorColumns: Array<ModelSwitchColumn<Monitor>> = [
      "disableActiveMonitoring",
    ];

    expect(columns).toHaveLength(3);
    expect(monitorColumns).toHaveLength(1);

    // @ts-expect-error a text column is not a switch.
    const notASwitch: ModelSwitchColumn<StatusPage> = "name";
    expect(notASwitch).toBe("name");
  });
});
