import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import { JSONObject, ObjectType } from "../../../Types/JSON";
import BadDataException from "../../../Types/Exception/BadDataException";

/*
 * MonitorSteps is the top-level DatabaseProperty stored on a Monitor: an array
 * of MonitorStep plus the default monitor status. These tests lock in the
 * factory shape, toJSON/fromJSON round-trip (including the deliberately lenient
 * fromJSON(undefined) -> empty instance), and the validation contract.
 */

const buildDefaultSteps: () => MonitorSteps = (): MonitorSteps => {
  return MonitorSteps.getDefaultMonitorSteps({
    defaultMonitorStatusId: new ObjectID("100000000000000000000001"),
    monitorType: MonitorType.Manual,
    monitorName: "My Monitor",
    onlineMonitorStatusId: new ObjectID("100000000000000000000002"),
    offlineMonitorStatusId: new ObjectID("100000000000000000000003"),
    defaultIncidentSeverityId: new ObjectID("100000000000000000000004"),
    defaultAlertSeverityId: new ObjectID("100000000000000000000005"),
  });
};

describe("MonitorSteps", () => {
  describe("getNewMonitorStepsAsJSON", () => {
    test("wraps a single default step under the MonitorSteps type", () => {
      const json: JSONObject = MonitorSteps.getNewMonitorStepsAsJSON();
      expect(json["_type"]).toBe(ObjectType.MonitorSteps);
      const value: JSONObject = json["value"] as JSONObject;
      expect(Array.isArray(value["monitorStepsInstanceArray"])).toBe(true);
      expect(
        (value["monitorStepsInstanceArray"] as Array<unknown>).length,
      ).toBe(1);
      expect(value["defaultMonitorStatusId"]).toBeUndefined();
    });
  });

  describe("getDefaultMonitorSteps", () => {
    test("creates one step and carries the default monitor status id", () => {
      const steps: MonitorSteps = buildDefaultSteps();
      expect(steps.data?.monitorStepsInstanceArray).toHaveLength(1);
      expect(steps.data?.monitorStepsInstanceArray[0]).toBeInstanceOf(
        MonitorStep,
      );
      expect(steps.data?.defaultMonitorStatusId?.toString()).toBe(
        "100000000000000000000001",
      );
    });
  });

  describe("toJSON / fromJSON round-trip", () => {
    test("serializes with the MonitorSteps type wrapper", () => {
      const steps: MonitorSteps = buildDefaultSteps();
      const json: JSONObject = steps.toJSON();
      expect(json["_type"]).toBe(ObjectType.MonitorSteps);
      expect((json["value"] as JSONObject)["defaultMonitorStatusId"]).toBe(
        "100000000000000000000001",
      );
    });

    test("round-trips the default status id and step count", () => {
      const steps: MonitorSteps = buildDefaultSteps();
      const restored: MonitorSteps = MonitorSteps.fromJSON(steps.toJSON());
      expect(restored.data?.defaultMonitorStatusId?.toString()).toBe(
        "100000000000000000000001",
      );
      expect(restored.data?.monitorStepsInstanceArray).toHaveLength(1);
      expect(restored.data?.monitorStepsInstanceArray[0]).toBeInstanceOf(
        MonitorStep,
      );
    });

    test("toString returns a JSON string of the serialized value", () => {
      const steps: MonitorSteps = buildDefaultSteps();
      const asString: string = steps.toString();
      const parsed: JSONObject = JSON.parse(asString) as JSONObject;
      expect(parsed["_type"]).toBe(ObjectType.MonitorSteps);
    });
  });

  describe("fromJSON leniency and validation", () => {
    test("returns an empty instance for undefined input", () => {
      const steps: MonitorSteps = MonitorSteps.fromJSON(undefined);
      expect(steps).toBeInstanceOf(MonitorSteps);
    });

    test("returns the same instance when given a MonitorSteps", () => {
      const steps: MonitorSteps = buildDefaultSteps();
      expect(MonitorSteps.fromJSON(steps)).toBe(steps);
    });

    test("throws on a wrong _type", () => {
      expect(() => {
        return MonitorSteps.fromJSON({ _type: "Nope", value: {} });
      }).toThrow(BadDataException);
    });

    test("throws when value is missing", () => {
      expect(() => {
        return MonitorSteps.fromJSON({ _type: "MonitorSteps" });
      }).toThrow(BadDataException);
    });

    test("throws when monitorStepsInstanceArray is missing", () => {
      expect(() => {
        return MonitorSteps.fromJSON({
          _type: "MonitorSteps",
          value: { defaultMonitorStatusId: undefined },
        });
      }).toThrow(BadDataException);
    });
  });

  describe("getValidationError", () => {
    test("errors when data is missing", () => {
      const steps: MonitorSteps = new MonitorSteps();
      steps.data = undefined;
      expect(MonitorSteps.getValidationError(steps, MonitorType.Manual)).toBe(
        "Monitor Steps is required",
      );
    });

    test("errors when the step array is empty", () => {
      const steps: MonitorSteps = new MonitorSteps();
      steps.data = {
        monitorStepsInstanceArray: [],
        defaultMonitorStatusId: new ObjectID("100000000000000000000001"),
      };
      expect(MonitorSteps.getValidationError(steps, MonitorType.Manual)).toBe(
        "Monitor Steps is required",
      );
    });

    test("errors when the default monitor status id is missing", () => {
      const steps: MonitorSteps = buildDefaultSteps();
      steps.data!.defaultMonitorStatusId = undefined;
      expect(MonitorSteps.getValidationError(steps, MonitorType.Manual)).toBe(
        "Default Monitor Status is required",
      );
    });
  });

  describe("clone and setters", () => {
    test("clone produces an independent copy", () => {
      const steps: MonitorSteps = buildDefaultSteps();
      const cloned: MonitorSteps = MonitorSteps.clone(steps);
      expect(cloned).not.toBe(steps);
      expect(cloned.data?.defaultMonitorStatusId?.toString()).toBe(
        steps.data?.defaultMonitorStatusId?.toString(),
      );

      cloned.setDefaultMonitorStatusId(
        new ObjectID("200000000000000000000009"),
      );
      // Original must be unaffected by the clone's mutation.
      expect(steps.data?.defaultMonitorStatusId?.toString()).toBe(
        "100000000000000000000001",
      );
    });

    test("setDefaultMonitorStatusId mutates and returns this", () => {
      const steps: MonitorSteps = new MonitorSteps();
      const returned: MonitorSteps = steps.setDefaultMonitorStatusId(
        new ObjectID("300000000000000000000000"),
      );
      expect(returned).toBe(steps);
      expect(steps.data?.defaultMonitorStatusId?.toString()).toBe(
        "300000000000000000000000",
      );
    });

    test("setMonitorStepsInstanceArray replaces the step list", () => {
      const steps: MonitorSteps = buildDefaultSteps();
      const newStep: MonitorStep = new MonitorStep();
      steps.setMonitorStepsInstanceArray([newStep]);
      expect(steps.data?.monitorStepsInstanceArray).toHaveLength(1);
      expect(steps.data?.monitorStepsInstanceArray[0]).toBe(newStep);
    });
  });
});
