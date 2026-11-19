import { describe, expect, test } from "@jest/globals";
import HTTPMethod from "../../../Types/API/HTTPMethod";
import { JSONArray, JSONObject, ObjectType } from "../../../Types/JSON";
import MonitorCriteria from "../../../Types/Monitor/MonitorCriteria";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import {
  TotpAlgorithm,
  TotpParameters,
} from "../../../Utils/Totp/TotpParameters";

/*
 * MonitorStep.totpSecrets (issue #9703): the parameters of the one-time
 * code monitor secrets a step references, which the server hands the probe
 * with the step. They travel to the probe as JSON and are read back there,
 * keeping only what can make a code - and they are never written to the
 * database, so a monitor's own record never holds a seed, whatever path
 * saves a step that was filled in for a probe.
 */

const LOGIN: TotpParameters = {
  secret: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ",
  algorithm: TotpAlgorithm.SHA1,
  digits: 6,
  periodInSeconds: 30,
};

function stepJSON(extra: JSONObject = {}): JSONObject {
  return {
    _type: ObjectType.MonitorStep,
    value: {
      id: "22222222-2222-4222-8222-222222222222",
      monitorDestination: {
        _type: ObjectType.URL,
        value: "https://api.example.com/verify",
      },
      monitorCriteria: new MonitorCriteria().toJSON(),
      requestType: HTTPMethod.POST,
      requestBody: '{"otp":"{{monitorSecrets.LoginCode}}"}',
      ...extra,
    },
  };
}

function stepsJSON(step: JSONObject): JSONObject {
  return {
    _type: ObjectType.MonitorSteps,
    value: {
      defaultMonitorStatusId: "11111111-1111-4111-8111-111111111111",
      monitorStepsInstanceArray: [step],
    },
  };
}

function valueOf(json: JSONObject): JSONObject {
  return json["value"] as JSONObject;
}

describe("a step's TOTP secrets on their way to the probe", () => {
  test("are written with the step and read back the same", () => {
    const step: MonitorStep = MonitorStep.fromJSON(
      stepJSON({ totpSecrets: { LoginCode: { ...LOGIN } } }),
    );

    expect(step.data!.totpSecrets).toEqual({ LoginCode: LOGIN });

    const sent: JSONObject = JSON.parse(JSON.stringify(step.toJSON()));

    expect(valueOf(sent)["totpSecrets"]).toEqual({ LoginCode: LOGIN });
    expect(MonitorStep.fromJSON(sent).data!.totpSecrets).toEqual({
      LoginCode: LOGIN,
    });
  });

  test("keep only names and parameters that can make a code", () => {
    const step: MonitorStep = MonitorStep.fromJSON(
      stepJSON({
        totpSecrets: {
          LoginCode: { ...LOGIN, issuer: "kept out" },
          Broken: { ...LOGIN, digits: 9 },
          Text: "a plain value",
        },
      }),
    );

    expect(step.data!.totpSecrets).toEqual({ LoginCode: LOGIN });
  });

  test("are not written at all when the step has none", () => {
    for (const totpSecrets of [undefined, {}, { Broken: "x" }]) {
      const step: MonitorStep = MonitorStep.fromJSON(
        stepJSON(totpSecrets === undefined ? {} : { totpSecrets }),
      );

      expect(step.data!.totpSecrets).toBeUndefined();
      expect(valueOf(step.toJSON())).not.toHaveProperty("totpSecrets");
    }
  });
});

describe("a step written to the database", () => {
  test("never holds its TOTP secrets", () => {
    const step: MonitorStep = MonitorStep.fromJSON(
      stepJSON({ totpSecrets: { LoginCode: LOGIN } }),
    );

    const stored: JSONObject = MonitorStep.getDatabaseTransformer().to(step);

    expect(valueOf(stored)).not.toHaveProperty("totpSecrets");
    expect(JSON.stringify(stored)).not.toContain(LOGIN.secret);
    // The rest of the step is written as before.
    expect(valueOf(stored)["requestBody"]).toBe(
      '{"otp":"{{monitorSecrets.LoginCode}}"}',
    );
  });

  test("never holds them in a monitor's steps either", () => {
    const steps: MonitorSteps = MonitorSteps.fromJSON(
      stepsJSON(stepJSON({ totpSecrets: { LoginCode: LOGIN } })),
    );

    // Filled in for a probe, the steps carry the parameters...
    expect(JSON.stringify(steps.toJSON())).toContain(LOGIN.secret);

    // ...and saving them anyway writes none.
    const stored: JSONObject = MonitorSteps.getDatabaseTransformer().to(steps);
    const storedStep: JSONObject = (
      valueOf(stored)["monitorStepsInstanceArray"] as JSONArray
    )[0] as JSONObject;

    expect(JSON.stringify(stored)).not.toContain(LOGIN.secret);
    expect(valueOf(storedStep)).not.toHaveProperty("totpSecrets");

    const readBack: MonitorSteps = MonitorSteps.getDatabaseTransformer().from(
      JSON.parse(JSON.stringify(stored)),
    ) as MonitorSteps;

    expect(
      readBack.data!.monitorStepsInstanceArray[0]!.data!.totpSecrets,
    ).toBeUndefined();
    expect(readBack.data!.monitorStepsInstanceArray[0]!.data!.requestBody).toBe(
      '{"otp":"{{monitorSecrets.LoginCode}}"}',
    );
  });

  test("leaves a step without TOTP secrets exactly as toJSON writes it", () => {
    const step: MonitorStep = MonitorStep.fromJSON(stepJSON());

    expect(MonitorStep.toDatabaseJSON(step.toJSON())).toEqual(step.toJSON());
  });
});
