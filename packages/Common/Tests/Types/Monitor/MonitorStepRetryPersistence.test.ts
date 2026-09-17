import HTTPMethod from "../../../Types/API/HTTPMethod";
import { JSONArray, JSONObject, ObjectType } from "../../../Types/JSON";
import JSONFunctions from "../../../Types/JSONFunctions";
import MonitorCriteria from "../../../Types/Monitor/MonitorCriteria";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";

function apiPayload(retryCounts: Array<number | null | undefined>): JSONObject {
  return {
    _type: ObjectType.MonitorSteps,
    value: {
      defaultMonitorStatusId: "11111111-1111-4111-8111-111111111111",
      monitorStepsInstanceArray: retryCounts.map(
        (retryCount: number | null | undefined): JSONObject => {
          return {
            _type: ObjectType.MonitorStep,
            value: {
              id: "22222222-2222-4222-8222-222222222222",
              monitorDestination: {
                _type: ObjectType.URL,
                value: "https://example.com/health",
              },
              monitorCriteria: new MonitorCriteria().toJSON(),
              requestType: HTTPMethod.GET,
              allowSelfSignedCertificates: true,
              ...(retryCount === undefined ? {} : { retryCount }),
            },
          };
        },
      ),
    },
  };
}

function stepValues(payload: JSONObject): Array<JSONObject> {
  return (
    (payload["value"] as JSONObject)["monitorStepsInstanceArray"] as JSONArray
  ).map((step: JSONObject): JSONObject => {
    return step["value"] as JSONObject;
  });
}

function databaseRoundTrip(steps: MonitorSteps): MonitorSteps {
  // Exercise the same transformer used for the Monitor's JSON database column.
  const persisted: JSONObject = MonitorSteps.getDatabaseTransformer().to(steps);
  return MonitorSteps.getDatabaseTransformer().from(
    JSON.parse(JSON.stringify(persisted)),
  ) as MonitorSteps;
}

describe("API monitor retry settings across persistence", () => {
  test.each([undefined, null, 0, 1, 2, 3])(
    "preserves retryCount %s through API decoding, database storage, and GET serialization",
    (retryCount: number | null | undefined): void => {
      const payload: JSONObject = apiPayload([retryCount]);
      const originalPayload: string = JSON.stringify(payload);
      const expected: number | undefined = retryCount ?? undefined;
      const decoded: MonitorSteps = JSONFunctions.deserialize({
        monitorSteps: payload,
      })["monitorSteps"] as MonitorSteps;

      expect(decoded).toBeInstanceOf(MonitorSteps);
      expect(decoded.data!.monitorStepsInstanceArray[0]!.data!.retryCount).toBe(
        expected,
      );

      const stored: MonitorSteps = databaseRoundTrip(decoded);
      const cloned: MonitorSteps = MonitorSteps.clone(stored);
      const response: JSONObject = JSON.parse(JSON.stringify(cloned.toJSON()));
      const value: JSONObject = stepValues(response)[0]!;

      expect(value["retryCount"]).toBe(expected);
      if (expected === undefined) {
        // Missing is inherited from the probe, not an explicit choice of 3.
        expect(value).not.toHaveProperty("retryCount");
      } else {
        expect(value).toHaveProperty("retryCount", expected);
      }
      expect(value["requestType"]).toBe(HTTPMethod.GET);
      expect(value["allowSelfSignedCertificates"]).toBe(true);
      expect(JSON.stringify(payload)).toBe(originalPayload);
    },
  );

  test("an unrelated criteria edit does not turn an inherited retry count into an override", (): void => {
    const steps: MonitorSteps = MonitorSteps.fromJSON(apiPayload([undefined]));
    const edited: MonitorSteps = MonitorSteps.clone(databaseRoundTrip(steps));
    edited.data!.monitorStepsInstanceArray[0]!.setRequestType(HTTPMethod.POST);

    const saved: MonitorSteps = databaseRoundTrip(edited);
    expect(stepValues(saved.toJSON())[0]).not.toHaveProperty("retryCount");
    expect(saved.data!.monitorStepsInstanceArray[0]!.data!.requestType).toBe(
      HTTPMethod.POST,
    );
  });

  test.each([0, 1, 2, 3])(
    "an explicit edit to %s is stored and clearing it restores inheritance",
    (retryCount: number): void => {
      const steps: MonitorSteps = MonitorSteps.fromJSON(
        apiPayload([undefined]),
      );
      steps.data!.monitorStepsInstanceArray[0]!.setRetryCount(retryCount);
      const saved: MonitorSteps = databaseRoundTrip(steps);
      expect(stepValues(saved.toJSON())[0]!["retryCount"]).toBe(retryCount);

      saved.data!.monitorStepsInstanceArray[0]!.setRetryCount(undefined);
      const cleared: MonitorSteps = databaseRoundTrip(saved);
      expect(stepValues(cleared.toJSON())[0]).not.toHaveProperty("retryCount");
    },
  );

  test("multiple steps keep their independent inherited and explicit retry settings", (): void => {
    const steps: MonitorSteps = databaseRoundTrip(
      MonitorSteps.fromJSON(apiPayload([undefined, 0, 2, null, 3])),
    );
    expect(
      steps.data!.monitorStepsInstanceArray.map(
        (step: MonitorStep): number | undefined => {
          return step.data!.retryCount;
        },
      ),
    ).toEqual([undefined, 0, 2, undefined, 3]);
  });
});
