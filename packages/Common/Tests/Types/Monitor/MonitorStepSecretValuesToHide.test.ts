import { describe, expect, test } from "@jest/globals";
import HTTPMethod from "../../../Types/API/HTTPMethod";
import { JSONArray, JSONObject, ObjectType } from "../../../Types/JSON";
import MonitorCriteria from "../../../Types/Monitor/MonitorCriteria";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import {
  MAX_SECRET_VALUES_TO_HIDE_PER_STEP,
  readSecretValuesToHide,
} from "../../../Utils/Monitor/MonitorSecretValuesToHide";
import {
  TotpAlgorithm,
  TotpParameters,
} from "../../../Utils/Totp/TotpParameters";
import { getMonitorStepSchema } from "../../../Utils/Schema/MonitorSchemas";

/*
 * MonitorStep.secretValuesToHide (issue #10875): the values of the Text
 * monitor secrets the server filled into a step, which it hands a probe that
 * hides them in every line it logs while it runs the step. They travel to
 * the probe as JSON and are read back there - texts only, each once, a
 * bounded number - and they are never written to the database, so no
 * monitor's own record ever holds a secret's value, whatever path saves a
 * step that was filled in for a probe. The API never takes them.
 */

const TOKEN: string = "tok-3f9a-SECRET-value";
const PASSWORD: string = 'p@ss "word" \\ with spaces';

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
      id: "33333333-3333-4333-8333-333333333333",
      monitorDestination: {
        _type: ObjectType.URL,
        value: `https://api.example.com/health?key=${TOKEN}`,
      },
      monitorCriteria: new MonitorCriteria().toJSON(),
      requestType: HTTPMethod.POST,
      requestBody: JSON.stringify({ password: PASSWORD }),
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

describe("a step's secret values on their way to the probe", () => {
  test("are written with the step and read back the same", () => {
    const step: MonitorStep = MonitorStep.fromJSON(
      stepJSON({ secretValuesToHide: [TOKEN, PASSWORD] }),
    );

    expect(step.data!.secretValuesToHide).toEqual([TOKEN, PASSWORD]);

    // As the probe reads what the server sent: JSON over the wire.
    const sent: JSONObject = JSON.parse(JSON.stringify(step.toJSON()));

    expect(valueOf(sent)["secretValuesToHide"]).toEqual([TOKEN, PASSWORD]);
    expect(MonitorStep.fromJSON(sent).data!.secretValuesToHide).toEqual([
      TOKEN,
      PASSWORD,
    ]);
  });

  test("keep texts only, each once, in the order written", () => {
    const step: MonitorStep = MonitorStep.fromJSON(
      stepJSON({
        secretValuesToHide: [
          TOKEN,
          "",
          42,
          null,
          { value: TOKEN },
          TOKEN,
          PASSWORD,
        ] as unknown as JSONArray,
      }),
    );

    expect(step.data!.secretValuesToHide).toEqual([TOKEN, PASSWORD]);
  });

  test("are not written at all when the step has none", () => {
    for (const secretValuesToHide of [
      undefined,
      [],
      [""],
      "a single text",
      { TOKEN },
    ]) {
      const step: MonitorStep = MonitorStep.fromJSON(
        stepJSON(
          secretValuesToHide === undefined
            ? {}
            : {
                secretValuesToHide: secretValuesToHide as unknown as JSONArray,
              },
        ),
      );

      expect(step.data!.secretValuesToHide).toBeUndefined();
      expect(valueOf(step.toJSON())).not.toHaveProperty("secretValuesToHide");
    }
  });

  test("are bounded, so a malformed step cannot make a probe read without end", () => {
    const many: Array<string> = Array.from(
      { length: MAX_SECRET_VALUES_TO_HIDE_PER_STEP + 50 },
      (_value: unknown, index: number): string => {
        return `value-${index}`;
      },
    );

    expect(readSecretValuesToHide(many)).toEqual(
      many.slice(0, MAX_SECRET_VALUES_TO_HIDE_PER_STEP),
    );
    expect(readSecretValuesToHide(undefined)).toEqual([]);
    expect(readSecretValuesToHide("not a list")).toEqual([]);
  });
});

describe("a step written to the database", () => {
  test("never holds its secret values", () => {
    const step: MonitorStep = MonitorStep.fromJSON(
      stepJSON({ secretValuesToHide: [TOKEN, PASSWORD] }),
    );

    const stored: JSONObject = MonitorStep.getDatabaseTransformer().to(step);

    expect(valueOf(stored)).not.toHaveProperty("secretValuesToHide");
    expect(JSON.stringify(stored)).not.toContain(JSON.stringify([TOKEN]));
    // The rest of the step is written as before.
    expect(valueOf(stored)["requestBody"]).toBe(
      JSON.stringify({ password: PASSWORD }),
    );
  });

  test("never holds them, nor TOTP secrets, beside each other", () => {
    const step: MonitorStep = MonitorStep.fromJSON(
      stepJSON({
        secretValuesToHide: [TOKEN],
        totpSecrets: { LoginCode: { ...LOGIN } },
      }),
    );

    expect(step.data!.totpSecrets).toEqual({ LoginCode: LOGIN });

    const stored: JSONObject = MonitorStep.toDatabaseJSON(step.toJSON());

    expect(valueOf(stored)).not.toHaveProperty("secretValuesToHide");
    expect(valueOf(stored)).not.toHaveProperty("totpSecrets");
    expect(JSON.stringify(stored)).not.toContain(LOGIN.secret);
  });

  test("never holds them in a monitor's steps either, and reads none back", () => {
    const steps: MonitorSteps = MonitorSteps.fromJSON(
      stepsJSON(stepJSON({ secretValuesToHide: [TOKEN, PASSWORD] })),
    );

    // Filled in for a probe, the steps carry the values...
    expect(
      valueOf(
        (
          valueOf(steps.toJSON())["monitorStepsInstanceArray"] as JSONArray
        )[0] as JSONObject,
      )["secretValuesToHide"],
    ).toEqual([TOKEN, PASSWORD]);

    // ...and saving them anyway writes none.
    const stored: JSONObject = MonitorSteps.getDatabaseTransformer().to(steps);
    const storedStep: JSONObject = (
      valueOf(stored)["monitorStepsInstanceArray"] as JSONArray
    )[0] as JSONObject;

    expect(valueOf(storedStep)).not.toHaveProperty("secretValuesToHide");

    const readBack: MonitorSteps = MonitorSteps.getDatabaseTransformer().from(
      JSON.parse(JSON.stringify(stored)),
    ) as MonitorSteps;

    expect(
      readBack.data!.monitorStepsInstanceArray[0]!.data!.secretValuesToHide,
    ).toBeUndefined();
  });

  test("leaves a step without secret values exactly as toJSON writes it", () => {
    const step: MonitorStep = MonitorStep.fromJSON(stepJSON());

    expect(MonitorStep.toDatabaseJSON(step.toJSON())).toEqual(step.toJSON());
  });
});

describe("a step written through the API", () => {
  test("cannot carry secret values: the schema does not take them", () => {
    const parsed: { success: boolean; data?: unknown } =
      getMonitorStepSchema().safeParse(
        JSON.parse(
          JSON.stringify(
            MonitorStep.fromJSON(
              stepJSON({ secretValuesToHide: [TOKEN] }),
            ).toJSON(),
          ),
        ),
      ) as { success: boolean; data?: unknown };

    // The step is taken, without the values.
    expect(parsed.success).toBe(true);
    expect(valueOf(parsed.data as JSONObject)).not.toHaveProperty(
      "secretValuesToHide",
    );
    expect(JSON.stringify(parsed.data)).not.toContain(JSON.stringify([TOKEN]));
  });
});
