import { JSONObject } from "../../../Types/JSON";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../Types/Monitor/MonitorType";

describe("MonitorStep template sync field policy persistence", () => {
  test("policy survives step and step-list serialization, cloning, and schema validation", (): void => {
    const step: MonitorStep = new MonitorStep();
    step.data!.doNotSyncFields = [
      "monitorDestination",
      "requestHeaders",
      "tlsClientAuthentication",
    ];
    const json: JSONObject = step.toJSON();

    expect((json["value"] as JSONObject)["doNotSyncFields"]).toEqual(
      step.data!.doNotSyncFields,
    );
    expect(MonitorStep.fromJSON(json).data!.doNotSyncFields).toEqual(
      step.data!.doNotSyncFields,
    );
    expect(MonitorStep.clone(step).data!.doNotSyncFields).toEqual(
      step.data!.doNotSyncFields,
    );
    expect(MonitorStep.getSchema().safeParse(json).success).toBe(true);
    const steps: MonitorSteps = new MonitorSteps();
    steps.setMonitorStepsInstanceArray([step]);
    expect(
      MonitorSteps.clone(steps).data!.monitorStepsInstanceArray[0]!.data!
        .doNotSyncFields,
    ).toEqual(step.data!.doNotSyncFields);
  });

  test("legacy steps do not acquire a policy when serialized", (): void => {
    const step: MonitorStep = new MonitorStep();
    expect(step.data!.doNotSyncFields).toBeUndefined();
    expect(step.toJSON()["value"]).not.toHaveProperty("doNotSyncFields");
    expect(
      MonitorStep.fromJSON(step.toJSON()).data!.doNotSyncFields,
    ).toBeUndefined();
  });

  test.each([
    null,
    "requestHeaders",
    {},
    [1],
    ["requestHeaders", false],
    ["id"],
    ["monitorCriteria"],
    ["requestHeaders.Authorization"],
    ["unknownField"],
  ])("rejects invalid persisted and API policy %j", (value: unknown): void => {
    const json: JSONObject = new MonitorStep().toJSON();
    (json["value"] as JSONObject)["doNotSyncFields"] = value as never;
    expect((): void => {
      MonitorStep.fromJSON(json);
    }).toThrow();
    expect(MonitorStep.getSchema().safeParse(json).success).toBe(false);
  });

  test("validates policy against the step's monitor type", (): void => {
    const step: MonitorStep = new MonitorStep();
    step.data!.doNotSyncFields = ["requestHeaders"];
    expect(MonitorStep.getValidationError(step, MonitorType.DNS)).toContain(
      "Unsupported do not sync field: requestHeaders",
    );
  });

  test("does not mutate or share the policy array during a step clone", (): void => {
    const step: MonitorStep = new MonitorStep();
    step.data!.doNotSyncFields = ["requestHeaders"];
    const cloned: MonitorStep = MonitorStep.clone(step);
    cloned.data!.doNotSyncFields!.push("requestBody");
    expect(step.data!.doNotSyncFields).toEqual(["requestHeaders"]);
  });

  test.each([
    ["doNotFollowRedirects", false],
    ["allowSelfSignedCertificates", false],
    ["requestBody", ""],
    ["customCode", ""],
    ["tlsClientCertificate", ""],
    ["tlsClientKey", ""],
    ["tlsClientKeyPassphrase", ""],
    ["retryCount", 0],
    ["retryCountOnError", 0],
  ])(
    "preserves explicit falsy %s through persistence",
    (
      key: string | number | boolean,
      value: string | number | boolean,
    ): void => {
      const step: MonitorStep = new MonitorStep();
      (step.data as unknown as Record<string, unknown>)[String(key)] = value;
      expect((step.toJSON()["value"] as JSONObject)[String(key)]).toBe(value);
      expect(
        (
          MonitorStep.fromJSON(step.toJSON()).data as unknown as Record<
            string,
            unknown
          >
        )[String(key)],
      ).toBe(value);
    },
  );
});
