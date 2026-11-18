import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import MonitorStepLimit, {
  MAX_MONITOR_STEPS,
} from "../../../Types/Monitor/MonitorStepLimit";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import { describe, expect, test } from "@jest/globals";

/*
 * THE MOST STEPS A MONITOR - OR A "TEST MONITOR" RUN - MAY HAVE.
 *
 * A probe runs and reports every step. Through the API, with no limit, one
 * free project ran 1,238 tests of up to 5,000 steps each in an hour, and the
 * 6.2 million step reports held up every project's probe results for hours.
 * The busiest monitor on OneUptime Cloud has 8 steps.
 */

const DEFAULT_STATUS_ID: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

// The JSON of a monitor's steps as the API receives it: `count` Ping steps.
function stepsJSON(count: number): JSONObject {
  const steps: Array<JSONObject> = [];

  for (let index: number = 0; index < count; index++) {
    steps.push({
      _type: "MonitorStep",
      value: {
        id: ObjectID.generate().toString(),
        monitorDestination: {
          _type: "Hostname",
          value: `host-${index}.example.com`,
        },
        monitorCriteria: {
          _type: "MonitorCriteria",
          value: { monitorCriteriaInstanceArray: [] },
        },
      },
    });
  }

  return {
    _type: "MonitorSteps",
    value: {
      monitorStepsInstanceArray: steps,
      defaultMonitorStatusId: DEFAULT_STATUS_ID,
    },
  };
}

describe("MonitorStepLimit", () => {
  test("a hundred steps, far past what anyone uses: the busiest monitor on OneUptime Cloud has 8", () => {
    expect(MAX_MONITOR_STEPS).toBe(100);
  });

  describe("counts the steps", () => {
    test("of a MonitorSteps", () => {
      expect(
        MonitorStepLimit.countSteps(MonitorSteps.fromJSON(stepsJSON(3))),
      ).toBe(3);
    });

    test("of the JSON the API and the database hold", () => {
      expect(MonitorStepLimit.countSteps(stepsJSON(7))).toBe(7);
    });

    test("of the bare value, without its _type wrapper", () => {
      expect(
        MonitorStepLimit.countSteps(stepsJSON(4)["value"] as JSONObject),
      ).toBe(4);
    });

    test("of nothing, or of anything that is not steps, as none", () => {
      expect(MonitorStepLimit.countSteps(undefined)).toBe(0);
      expect(MonitorStepLimit.countSteps(null)).toBe(0);
      expect(MonitorStepLimit.countSteps({})).toBe(0);
      expect(
        MonitorStepLimit.countSteps({
          _type: "MonitorSteps",
          value: { monitorStepsInstanceArray: "5000" },
        }),
      ).toBe(0);
    });
  });

  describe("refuses steps past the limit", () => {
    test("allows up to the limit", () => {
      expect(MonitorStepLimit.getLimitError(stepsJSON(1))).toBeNull();
      expect(
        MonitorStepLimit.getLimitError(stepsJSON(MAX_MONITOR_STEPS)),
      ).toBeNull();
      expect(() => {
        MonitorStepLimit.assertWithinLimit(stepsJSON(MAX_MONITOR_STEPS));
      }).not.toThrow();
    });

    test("refuses one past it, saying the limit, the count and what to do", () => {
      expect(
        MonitorStepLimit.getLimitError(stepsJSON(MAX_MONITOR_STEPS + 1)),
      ).toBe(
        "A monitor can have at most 100 steps, and this one has 101. Split the checks across more monitors.",
      );
    });

    test("refuses the 5,000 steps of the tests that held up every probe result, as a bad request", () => {
      expect(() => {
        MonitorStepLimit.assertWithinLimit(stepsJSON(5000));
      }).toThrow(BadDataException);
      expect(() => {
        MonitorStepLimit.assertWithinLimit(
          MonitorSteps.fromJSON(stepsJSON(5000)),
        );
      }).toThrow("this one has 5000");
    });

    test("nothing to check is nothing to refuse: whether steps are required is asked elsewhere", () => {
      expect(() => {
        MonitorStepLimit.assertWithinLimit(undefined);
      }).not.toThrow();
    });
  });

  describe("the dashboard's own check says the same", () => {
    test("MonitorSteps.getValidationError refuses steps past the limit", () => {
      expect(
        MonitorSteps.getValidationError(
          MonitorSteps.fromJSON(stepsJSON(MAX_MONITOR_STEPS + 1)),
          MonitorType.Ping,
        ),
      ).toBe(MonitorStepLimit.getLimitError(stepsJSON(MAX_MONITOR_STEPS + 1)));
    });

    test("and is not changed for steps within it", () => {
      expect(
        MonitorSteps.getValidationError(
          MonitorSteps.fromJSON(stepsJSON(2)),
          MonitorType.Ping,
        ),
      ).not.toContain("at most");
    });
  });
});
