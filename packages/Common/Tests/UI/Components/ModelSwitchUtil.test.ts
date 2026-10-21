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
  getPlanNeededToFlipSwitch,
  getPlanNeededToWriteColumn,
  getStoredValueForSwitch,
  getSwitchPlanLeftover,
  isModelSwitchOn,
  ModelSwitchColumn,
  SWITCH_PLAN_LEFTOVER_COPY,
  SWITCH_PLAN_LOCKED_COPY,
} from "../../../UI/Components/ModelSwitch/ModelSwitchUtil";
import Dashboard from "../../../Models/DatabaseModels/Dashboard";
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

describe("getPlanNeededToWriteColumn: a paid feature can always be switched off", () => {
  test("below the plan, the column's default needs no plan, and anything else names the plan", () => {
    plan = PlanType.Free;

    const page: StatusPage = new StatusPage();

    // Email reports: off is the default, on is Growth.
    expect(getPlanNeededToWriteColumn(page, "isReportEnabled", false)).toBe(
      null,
    );
    expect(getPlanNeededToWriteColumn(page, "isReportEnabled", true)).toBe(
      PlanType.Growth,
    );

    // A private status page: public is the default, private is Growth.
    expect(getPlanNeededToWriteColumn(page, "isPublicStatusPage", true)).toBe(
      null,
    );
    expect(getPlanNeededToWriteColumn(page, "isPublicStatusPage", false)).toBe(
      PlanType.Growth,
    );

    // A public dashboard: private is the default.
    expect(
      getPlanNeededToWriteColumn(new Dashboard(), "isPublicDashboard", false),
    ).toBe(null);
    expect(
      getPlanNeededToWriteColumn(new Dashboard(), "isPublicDashboard", true),
    ).toBe(PlanType.Growth);

    // An IP allowlist (Scale): emptied needs nothing, set needs Scale.
    for (const empty of [null, ""]) {
      expect(getPlanNeededToWriteColumn(page, "ipWhitelist", empty)).toBe(null);
    }
    expect(getPlanNeededToWriteColumn(page, "ipWhitelist", "10.0.0.0/8")).toBe(
      PlanType.Scale,
    );
  });

  test("on a plan that has the feature, or with billing off, nothing needs a plan either way", () => {
    for (const current of [PlanType.Growth, PlanType.Scale, null]) {
      plan = current;

      expect(
        getPlanNeededToWriteColumn(new StatusPage(), "isReportEnabled", true),
      ).toBe(null);
      expect(
        getPlanNeededToWriteColumn(new StatusPage(), "isReportEnabled", false),
      ).toBe(null);
    }
  });

  test("a column the model does not have is asked about as before", () => {
    plan = PlanType.Free;

    expect(
      getPlanNeededToWriteColumn(new StatusPage(), "notAColumn", false),
    ).toBe(null);
  });
});

describe("getSwitchPlanLeftover", () => {
  test("a Growth switch a trial left on, on Free: it can be turned off, and turning it on again takes Growth", () => {
    plan = PlanType.Free;

    expect(
      getSwitchPlanLeftover({
        model: new StatusPage(),
        column: "isReportEnabled",
        isOn: true,
      }),
    ).toEqual({ canTurn: "off", planNeeded: PlanType.Growth });
  });

  test("the same switch off - at its default - is no leftover: flipping it would switch the feature on", () => {
    plan = PlanType.Free;

    expect(
      getSwitchPlanLeftover({
        model: new StatusPage(),
        column: "isReportEnabled",
        isOn: false,
      }),
    ).toBe(null);
  });

  test("a column on by default, switched off by a trial: it can be turned on", () => {
    plan = PlanType.Free;

    expect(
      getSwitchPlanLeftover({
        model: new StatusPage(),
        column: "showIncidentsOnStatusPage",
        isOn: false,
      }),
    ).toEqual({ canTurn: "on", planNeeded: PlanType.Growth });

    expect(
      getSwitchPlanLeftover({
        model: new StatusPage(),
        column: "showIncidentsOnStatusPage",
        isOn: true,
      }),
    ).toBe(null);
  });

  test("an inverted switch reads the column the right way round", () => {
    plan = PlanType.Growth;

    // "Show Powered By" off: the column (hide the branding) is true, a Scale feature.
    expect(
      getSwitchPlanLeftover({
        model: new StatusPage(),
        column: "hidePoweredByOneUptimeBranding",
        isOn: false,
        isInverted: true,
      }),
    ).toEqual({ canTurn: "on", planNeeded: PlanType.Scale });

    expect(
      getSwitchPlanLeftover({
        model: new StatusPage(),
        column: "hidePoweredByOneUptimeBranding",
        isOn: true,
        isInverted: true,
      }),
    ).toBe(null);
  });

  test("no leftover on a plan that has the column, with billing off, or on a column no plan gates", () => {
    for (const current of [PlanType.Growth, PlanType.Enterprise, null]) {
      plan = current;

      expect(
        getSwitchPlanLeftover({
          model: new StatusPage(),
          column: "isReportEnabled",
          isOn: true,
        }),
      ).toBe(null);
    }

    plan = PlanType.Free;

    expect(
      getSwitchPlanLeftover({
        model: new StatusPage(),
        column: "enableMcpServer",
        isOn: false,
      }),
    ).toBe(null);
    expect(
      getSwitchPlanLeftover({
        model: new Monitor(),
        column: "disableActiveMonitoring",
        isOn: true,
        isInverted: true,
      }),
    ).toBe(null);
  });

  test("its sentences name the way the switch can go and the plan it takes to come back", () => {
    expect(SWITCH_PLAN_LEFTOVER_COPY.off).toBe(
      "Your plan does not include this setting. You can turn it off, but turning it on again needs the {{planName}} plan.",
    );
    expect(SWITCH_PLAN_LEFTOVER_COPY.on).toBe(
      "Your plan does not include this setting. You can turn it on, but turning it off again needs the {{planName}} plan.",
    );
  });
});

describe("getPlanNeededToFlipSwitch: the plan the next flip needs", () => {
  test("below the plan, flipping back to the default needs none, flipping on names the plan", () => {
    plan = PlanType.Growth;

    // Requiring SSO is a Scale feature, off by default.
    expect(
      getPlanNeededToFlipSwitch({
        model: new Project(),
        column: "requireSsoForLogin",
        isOn: true,
      }),
    ).toBe(null);
    expect(
      getPlanNeededToFlipSwitch({
        model: new Project(),
        column: "requireSsoForLogin",
        isOn: false,
      }),
    ).toBe(PlanType.Scale);
  });

  test("an inverted switch is read the right way round", () => {
    plan = PlanType.Growth;

    // "Show Powered By": on stores false (the default); off stores true (Scale).
    expect(
      getPlanNeededToFlipSwitch({
        model: new StatusPage(),
        column: "hidePoweredByOneUptimeBranding",
        isOn: true,
        isInverted: true,
      }),
    ).toBe(PlanType.Scale);
    expect(
      getPlanNeededToFlipSwitch({
        model: new StatusPage(),
        column: "hidePoweredByOneUptimeBranding",
        isOn: false,
        isInverted: true,
      }),
    ).toBe(null);
  });

  test("on a plan that has it, or with billing off, no flip needs a plan", () => {
    for (const current of [PlanType.Scale, null]) {
      plan = current;

      for (const isOn of [true, false]) {
        expect(
          getPlanNeededToFlipSwitch({
            model: new Project(),
            column: "requireSsoForLogin",
            isOn: isOn,
          }),
        ).toBe(null);
      }
    }
  });

  test("its lock names the plan", () => {
    expect(SWITCH_PLAN_LOCKED_COPY).toBe(
      "Changing this setting needs the {{planName}} plan.",
    );
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
