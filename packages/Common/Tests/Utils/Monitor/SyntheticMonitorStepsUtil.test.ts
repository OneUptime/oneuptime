import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import MonitorStep, {
  SYNTHETIC_MONITOR_DEFAULT_BROWSER_TYPES,
  SYNTHETIC_MONITOR_DEFAULT_SCREEN_SIZE_TYPES,
} from "../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../Types/Monitor/MonitorType";
import BrowserType from "../../../Types/Monitor/SyntheticMonitors/BrowserType";
import ScreenSizeType from "../../../Types/Monitor/SyntheticMonitors/ScreenSizeType";
import ObjectID from "../../../Types/ObjectID";
import SyntheticMonitorStepsUtil, {
  SYNTHETIC_STEP_NO_BROWSER_MESSAGE,
  SYNTHETIC_STEP_NO_SCREEN_SIZE_MESSAGE,
  SyntheticListsFillResult,
} from "../../../Utils/Monitor/SyntheticMonitorStepsUtil";
import { describe, expect, test } from "@jest/globals";

/*
 * A Synthetic step runs its script once per browser and screen size it
 * lists, so a step with either list empty runs nothing and never fails.
 * The server refuses such steps on every write (getRunsNothingError /
 * assertRunsSomewhere), and the steps stored that way before are given
 * the defaults a new step starts on (fillEmptyListsInJSON).
 */

const OPERATIONAL_STATUS_ID: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

// One step's value, as the column stores it.
function storedStepValue(lists: {
  browserTypes?: unknown;
  screenSizeTypes?: unknown;
  id?: string;
}): JSONObject {
  const value: JSONObject = {
    id: lists.id || "0b9b1f47-1e8e-4a8b-9f43-3d2b8f4c1a11",
    customCode: "await page.goto('https://shop.example.com');",
    requestType: "GET",
    retryCountOnError: 1,
    monitorCriteria: {
      _type: "MonitorCriteria",
      value: {
        monitorCriteriaInstanceArray: [
          {
            _type: "MonitorCriteriaInstance",
            value: {
              id: "6c8cf9ad-16cf-4ae5-8443-8afc4d462277",
              name: "Check if the shop is offline",
              filterCondition: "Any",
              filters: [{ checkOn: "Error", filterType: "Is Not Empty" }],
              incidents: [],
              alerts: [],
            },
          },
        ],
      },
    },
  };

  if ("browserTypes" in lists) {
    value["browserTypes"] = lists.browserTypes as JSONObject;
  }

  if ("screenSizeTypes" in lists) {
    value["screenSizeTypes"] = lists.screenSizeTypes as JSONObject;
  }

  return value;
}

function storedSteps(stepValues: Array<JSONObject>): JSONObject {
  return {
    _type: "MonitorSteps",
    value: {
      monitorStepsInstanceArray: stepValues.map(
        (value: JSONObject): JSONObject => {
          return { _type: "MonitorStep", value: value };
        },
      ),
      defaultMonitorStatusId: OPERATIONAL_STATUS_ID,
    },
  };
}

function stepValuesOf(monitorSteps: JSONObject): Array<JSONObject> {
  return (
    (monitorSteps["value"] as JSONObject)[
      "monitorStepsInstanceArray"
    ] as Array<JSONObject>
  ).map((envelope: JSONObject): JSONObject => {
    return envelope["value"] as JSONObject;
  });
}

const RUNS_SOMEWHERE: JSONObject = storedStepValue({
  browserTypes: [BrowserType.Firefox],
  screenSizeTypes: [ScreenSizeType.Mobile, ScreenSizeType.Tablet],
});

describe("what a Synthetic step that runs nothing is told", () => {
  test("the words name the fields and every value they take", () => {
    expect(SYNTHETIC_STEP_NO_BROWSER_MESSAGE).toBe(
      "A Synthetic monitor step needs at least one browser in browserTypes (Chromium or Firefox). With none, its script never runs.",
    );
    expect(SYNTHETIC_STEP_NO_SCREEN_SIZE_MESSAGE).toBe(
      "A Synthetic monitor step needs at least one screen size in screenSizeTypes (Mobile, Tablet, Desktop). With none, its script never runs.",
    );

    for (const browser of Object.values(BrowserType)) {
      expect(SYNTHETIC_STEP_NO_BROWSER_MESSAGE).toContain(browser);
    }

    for (const screenSize of Object.values(ScreenSizeType)) {
      expect(SYNTHETIC_STEP_NO_SCREEN_SIZE_MESSAGE).toContain(screenSize);
    }
  });
});

describe("SyntheticMonitorStepsUtil.getRunsNothingError", () => {
  test("steps that list a browser and a screen size run", () => {
    expect(
      SyntheticMonitorStepsUtil.getRunsNothingError(
        storedSteps([RUNS_SOMEWHERE]),
      ),
    ).toBeNull();
  });

  test.each([
    ["no browser list at all", {}],
    ["an empty browser list", { browserTypes: [] }],
    ["a null browser list", { browserTypes: null }],
  ])("a step with %s runs nowhere", (_label: string, lists: JSONObject) => {
    expect(
      SyntheticMonitorStepsUtil.getRunsNothingError(
        storedSteps([
          storedStepValue({
            ...lists,
            screenSizeTypes: [ScreenSizeType.Desktop],
          }),
        ]),
      ),
    ).toBe(SYNTHETIC_STEP_NO_BROWSER_MESSAGE);
  });

  test.each([
    ["no screen size list at all", {}],
    ["an empty screen size list", { screenSizeTypes: [] }],
    ["a null screen size list", { screenSizeTypes: null }],
  ])("a step with %s runs nowhere", (_label: string, lists: JSONObject) => {
    expect(
      SyntheticMonitorStepsUtil.getRunsNothingError(
        storedSteps([
          storedStepValue({ ...lists, browserTypes: [BrowserType.Chromium] }),
        ]),
      ),
    ).toBe(SYNTHETIC_STEP_NO_SCREEN_SIZE_MESSAGE);
  });

  test("a step without either is told about the browser first", () => {
    expect(
      SyntheticMonitorStepsUtil.getRunsNothingError(
        storedSteps([storedStepValue({})]),
      ),
    ).toBe(SYNTHETIC_STEP_NO_BROWSER_MESSAGE);
  });

  test("one step that runs nowhere is enough, wherever it is", () => {
    expect(
      SyntheticMonitorStepsUtil.getRunsNothingError(
        storedSteps([
          RUNS_SOMEWHERE,
          storedStepValue({
            id: "7d1f5e0a-2b3c-4d5e-8f90-a1b2c3d4e5f6",
            browserTypes: [BrowserType.Chromium],
            screenSizeTypes: [],
          }),
        ]),
      ),
    ).toBe(SYNTHETIC_STEP_NO_SCREEN_SIZE_MESSAGE);
  });

  test("reads steps the way the API hands them over, parsed or not", () => {
    const parsed: MonitorSteps = MonitorSteps.fromJSON(
      storedSteps([storedStepValue({ screenSizeTypes: [] })]),
    );

    expect(SyntheticMonitorStepsUtil.getRunsNothingError(parsed)).toBe(
      SYNTHETIC_STEP_NO_BROWSER_MESSAGE,
    );
  });

  test("a new Synthetic step, as the form makes it, runs", () => {
    const steps: MonitorSteps = new MonitorSteps();
    steps.data = {
      monitorStepsInstanceArray: [
        MonitorStep.getDefaultMonitorStep({
          monitorName: "Checkout journey",
          monitorType: MonitorType.SyntheticMonitor,
          onlineMonitorStatusId: new ObjectID(OPERATIONAL_STATUS_ID),
          offlineMonitorStatusId: ObjectID.generate(),
          defaultIncidentSeverityId: ObjectID.generate(),
          defaultAlertSeverityId: ObjectID.generate(),
        }),
      ],
      defaultMonitorStatusId: new ObjectID(OPERATIONAL_STATUS_ID),
    };

    expect(SyntheticMonitorStepsUtil.getRunsNothingError(steps)).toBeNull();
  });

  test("no steps, and steps it cannot read, are not its to judge", () => {
    expect(SyntheticMonitorStepsUtil.getRunsNothingError(undefined)).toBeNull();
    expect(SyntheticMonitorStepsUtil.getRunsNothingError(null)).toBeNull();
    expect(
      SyntheticMonitorStepsUtil.getRunsNothingError({ not: "steps" }),
    ).toBeNull();
    expect(
      SyntheticMonitorStepsUtil.getRunsNothingError(storedSteps([])),
    ).toBeNull();
  });
});

describe("SyntheticMonitorStepsUtil.assertRunsSomewhere", () => {
  test("refuses a Synthetic monitor's step that runs nowhere", () => {
    expect(() => {
      SyntheticMonitorStepsUtil.assertRunsSomewhere({
        monitorType: MonitorType.SyntheticMonitor,
        monitorSteps: storedSteps([storedStepValue({ browserTypes: [] })]),
      });
    }).toThrow(new BadDataException(SYNTHETIC_STEP_NO_BROWSER_MESSAGE));
  });

  test("lets a Synthetic step that runs somewhere through", () => {
    expect(() => {
      SyntheticMonitorStepsUtil.assertRunsSomewhere({
        monitorType: MonitorType.SyntheticMonitor,
        monitorSteps: storedSteps([RUNS_SOMEWHERE]),
      });
    }).not.toThrow();
  });

  test("asks nothing of a type that has no browsers to pick", () => {
    for (const monitorType of Object.values(MonitorType)) {
      if (monitorType === MonitorType.SyntheticMonitor) {
        continue;
      }

      expect(() => {
        SyntheticMonitorStepsUtil.assertRunsSomewhere({
          monitorType: monitorType,
          monitorSteps: storedSteps([storedStepValue({})]),
        });
      }).not.toThrow();
    }

    expect(() => {
      SyntheticMonitorStepsUtil.assertRunsSomewhere({
        monitorType: undefined,
        monitorSteps: storedSteps([storedStepValue({})]),
      });
    }).not.toThrow();
  });
});

describe("SyntheticMonitorStepsUtil.fillEmptyListsInJSON", () => {
  test("gives a step with neither list what a new step starts on", () => {
    const result: SyntheticListsFillResult =
      SyntheticMonitorStepsUtil.fillEmptyListsInJSON(
        storedSteps([storedStepValue({})]),
      );
    const step: JSONObject = stepValuesOf(result.monitorSteps)[0]!;

    expect(result.changed).toBe(true);
    expect(result.stepsFilled).toBe(1);
    expect(step["browserTypes"]).toEqual(SYNTHETIC_MONITOR_DEFAULT_BROWSER_TYPES);
    expect(step["screenSizeTypes"]).toEqual(
      SYNTHETIC_MONITOR_DEFAULT_SCREEN_SIZE_TYPES,
    );
    expect(step["browserTypes"]).toEqual([BrowserType.Chromium]);
    expect(step["screenSizeTypes"]).toEqual([ScreenSizeType.Desktop]);
  });

  test("fills only the list that is empty, and keeps the one that is not", () => {
    const result: SyntheticListsFillResult =
      SyntheticMonitorStepsUtil.fillEmptyListsInJSON(
        storedSteps([
          storedStepValue({
            browserTypes: [BrowserType.Firefox],
            screenSizeTypes: [],
          }),
          storedStepValue({
            id: "7d1f5e0a-2b3c-4d5e-8f90-a1b2c3d4e5f6",
            browserTypes: null,
            screenSizeTypes: [ScreenSizeType.Mobile, ScreenSizeType.Tablet],
          }),
        ]),
      );
    const steps: Array<JSONObject> = stepValuesOf(result.monitorSteps);

    expect(result.stepsFilled).toBe(2);
    expect(steps[0]!["browserTypes"]).toEqual([BrowserType.Firefox]);
    expect(steps[0]!["screenSizeTypes"]).toEqual([ScreenSizeType.Desktop]);
    expect(steps[1]!["browserTypes"]).toEqual([BrowserType.Chromium]);
    expect(steps[1]!["screenSizeTypes"]).toEqual([
      ScreenSizeType.Mobile,
      ScreenSizeType.Tablet,
    ]);
  });

  test("changes nothing else in the column", () => {
    const stored: JSONObject = storedSteps([
      storedStepValue({}),
      RUNS_SOMEWHERE,
    ]);
    const result: SyntheticListsFillResult =
      SyntheticMonitorStepsUtil.fillEmptyListsInJSON(stored);

    const withoutLists: (value: unknown) => unknown = (
      value: unknown,
    ): unknown => {
      return JSON.parse(
        JSON.stringify(value, (key: string, item: unknown) => {
          return key === "browserTypes" || key === "screenSizeTypes"
            ? undefined
            : item;
        }),
      );
    };

    expect(withoutLists(result.monitorSteps)).toEqual(withoutLists(stored));
    expect(stepValuesOf(result.monitorSteps)[1]).toEqual(RUNS_SOMEWHERE);
  });

  test("never edits what it was handed", () => {
    const stored: JSONObject = storedSteps([storedStepValue({})]);
    const before: string = JSON.stringify(stored);

    SyntheticMonitorStepsUtil.fillEmptyListsInJSON(stored);

    expect(JSON.stringify(stored)).toBe(before);
  });

  test("a second pass finds nothing left to do", () => {
    const first: SyntheticListsFillResult =
      SyntheticMonitorStepsUtil.fillEmptyListsInJSON(
        storedSteps([storedStepValue({ browserTypes: [] })]),
      );
    const second: SyntheticListsFillResult =
      SyntheticMonitorStepsUtil.fillEmptyListsInJSON(first.monitorSteps);

    expect(second.changed).toBe(false);
    expect(second.stepsFilled).toBe(0);
    expect(second.monitorSteps).toEqual(first.monitorSteps);
  });

  test("a step that runs somewhere is left alone", () => {
    const result: SyntheticListsFillResult =
      SyntheticMonitorStepsUtil.fillEmptyListsInJSON(
        storedSteps([RUNS_SOMEWHERE]),
      );

    expect(result.changed).toBe(false);
    expect(result.stepsFilled).toBe(0);
  });

  test("the filled steps pass the check the server makes on every write", () => {
    const result: SyntheticListsFillResult =
      SyntheticMonitorStepsUtil.fillEmptyListsInJSON(
        storedSteps([
          storedStepValue({}),
          storedStepValue({
            id: "7d1f5e0a-2b3c-4d5e-8f90-a1b2c3d4e5f6",
            browserTypes: [],
          }),
        ]),
      );

    expect(
      SyntheticMonitorStepsUtil.getRunsNothingError(result.monitorSteps),
    ).toBeNull();
    expect(
      MonitorSteps.getValidationError(
        MonitorSteps.fromJSON(result.monitorSteps),
        MonitorType.SyntheticMonitor,
      ),
    ).toBeNull();
  });

  test("steps of an unexpected shape are passed over, not broken", () => {
    for (const stored of [
      {},
      { value: null },
      { value: { monitorStepsInstanceArray: "not a list" } },
      { value: { monitorStepsInstanceArray: [null, 3, { value: "text" }] } },
    ] as Array<JSONObject>) {
      const result: SyntheticListsFillResult =
        SyntheticMonitorStepsUtil.fillEmptyListsInJSON(stored);

      expect(result.changed).toBe(false);
      expect(result.monitorSteps).toEqual(stored);
    }
  });
});
