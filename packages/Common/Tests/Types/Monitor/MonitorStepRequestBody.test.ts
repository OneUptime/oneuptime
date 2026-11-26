import { describe, expect, test } from "@jest/globals";
import HTTPMethod from "../../../Types/API/HTTPMethod";
import URL from "../../../Types/API/URL";
import { JSONObject } from "../../../Types/JSON";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import { REQUEST_BODY_NOT_JSON_MESSAGE } from "../../../Utils/Monitor/MonitorRequestBody";

/*
 * THE MONITOR FORM SAVES ANY JSON VALUE AS AN API MONITOR'S BODY, AND
 * REFUSES TEXT NO CHECK COULD SEND (#9737).
 *
 * MonitorSteps.getValidationError is the Create Monitor form's check of its
 * steps (and of the Criteria page and monitor templates): it said nothing of
 * a body, so text that was not JSON was saved and failed every check, while
 * the probe refused every body that was not an object. A step is read with
 * MonitorStep.fromJSON wherever it comes from: the form, the API, the
 * database, the probe.
 */

const DEFAULT_ARG: {
  monitorName: string;
  monitorType: MonitorType;
  onlineMonitorStatusId: ObjectID;
  offlineMonitorStatusId: ObjectID;
  defaultIncidentSeverityId: ObjectID;
  defaultAlertSeverityId: ObjectID;
} = {
  monitorName: "Orders API",
  monitorType: MonitorType.API,
  onlineMonitorStatusId: new ObjectID("100000000000000000000021"),
  offlineMonitorStatusId: new ObjectID("100000000000000000000022"),
  defaultIncidentSeverityId: new ObjectID("100000000000000000000023"),
  defaultAlertSeverityId: new ObjectID("100000000000000000000024"),
};

// The issue's body: an array.
const ARRAY: string = '[{"id": 1}, {"id": 2}]';

// A step the form would save for an API monitor, with this body.
function apiStep(body: string | undefined): MonitorStep {
  const step: MonitorStep = MonitorStep.getDefaultMonitorStep(DEFAULT_ARG);

  step.data!.monitorDestination = URL.fromString(
    "https://api.example.com/batch",
  );
  step.setRequestType(HTTPMethod.POST);

  if (body !== undefined) {
    step.setRequestBody(body);
  }

  return step;
}

function stepsOf(...steps: Array<MonitorStep>): MonitorSteps {
  const monitorSteps: MonitorSteps = new MonitorSteps();

  monitorSteps.setMonitorStepsInstanceArray(steps);
  monitorSteps.setDefaultMonitorStatusId(DEFAULT_ARG.onlineMonitorStatusId);

  return monitorSteps;
}

// A step's JSON, as the API is sent it, with its body as given.
function stepJsonWithBody(requestBody: unknown): JSONObject {
  const json: JSONObject = apiStep(undefined).toJSON();

  (json["value"] as JSONObject)["requestBody"] = requestBody as JSONObject;

  return json;
}

describe("the form saves an API monitor with any JSON value as its body", () => {
  test.each([
    { name: "an array (the issue's body)", body: ARRAY },
    { name: "an object", body: '{"check": "deep"}' },
    { name: "a string", body: '"ping"' },
    { name: "a number", body: "42" },
    { name: "true", body: "true" },
    { name: "null", body: "null" },
    { name: "JSON5, as the probe reads it", body: "[{id: 1,},]" },
    {
      name: "a secret standing for a number",
      body: '{"count": {{monitorSecrets.Count}}}',
    },
    {
      name: "a one-time code in an array",
      body: '[{"otp": "{{monitorSecrets.LoginCode}}"}]',
    },
  ])("$name", ({ body }: { name: string; body: string }) => {
    expect(MonitorStep.getValidationError(apiStep(body), MonitorType.API)).toBe(
      null,
    );
  });

  test("and with no body at all", () => {
    for (const body of [undefined, "", "   \n"]) {
      expect(
        MonitorStep.getValidationError(apiStep(body), MonitorType.API),
      ).toBeNull();
    }
  });
});

describe("the form refuses a body no check could send, with one sentence", () => {
  test.each([
    { name: "plain text", body: "ping" },
    { name: "XML", body: "<ping><id>1</id></ping>" },
    { name: "form fields as text", body: "a=1&b=2" },
    { name: "an unclosed array", body: '[{"id": 1}' },
    { name: "a missing value", body: '{"id": }' },
  ])("$name", ({ body }: { name: string; body: string }) => {
    expect(MonitorStep.getValidationError(apiStep(body), MonitorType.API)).toBe(
      REQUEST_BODY_NOT_JSON_MESSAGE,
    );
  });

  test("in any step: the form's check of its steps says it", () => {
    expect(
      MonitorSteps.getValidationError(
        stepsOf(apiStep(ARRAY), apiStep("<ping/>")),
        MonitorType.API,
      ),
    ).toBe(REQUEST_BODY_NOT_JSON_MESSAGE);
    expect(
      MonitorSteps.getValidationError(
        stepsOf(apiStep(ARRAY), apiStep('"text"')),
        MonitorType.API,
      ),
    ).toBeNull();
  });

  test("never for a monitor type that sends no body", () => {
    const step: MonitorStep = apiStep("<ping/>");

    expect(MonitorStep.getValidationError(step, MonitorType.Website)).toBe(
      null,
    );
  });
});

describe("a step's body is read as text, wherever the step comes from", () => {
  test("text is kept byte for byte, through toJSON and fromJSON", () => {
    for (const body of [
      ARRAY,
      "  [1,\n 2]\n",
      "{a: 1,}",
      "{{monitorSecrets.Body}}",
      "<ping/>",
    ]) {
      const read: MonitorStep = MonitorStep.fromJSON(stepJsonWithBody(body));

      expect(read.data!.requestBody).toBe(body);
      expect(MonitorStep.fromJSON(read.toJSON()).data!.requestBody).toBe(body);
    }
  });

  test("a body an API client sent as a JSON value is kept as its JSON", () => {
    const read: MonitorStep = MonitorStep.fromJSON(
      stepJsonWithBody([{ id: 1 }, { id: 2 }]),
    );

    expect(read.data!.requestBody).toBe(
      JSON.stringify([{ id: 1 }, { id: 2 }], null, 2),
    );
    expect(JSON.parse(read.data!.requestBody!)).toEqual([{ id: 1 }, { id: 2 }]);
    expect(MonitorStep.getValidationError(read, MonitorType.API)).toBeNull();

    expect(
      MonitorStep.fromJSON(stepJsonWithBody({ check: "deep" })).data!
        .requestBody,
    ).toBe('{\n  "check": "deep"\n}');
    expect(MonitorStep.fromJSON(stepJsonWithBody(7)).data!.requestBody).toBe(
      "7",
    );
  });

  test("none is none", () => {
    expect(
      MonitorStep.fromJSON(stepJsonWithBody(null)).data!.requestBody,
    ).toBeUndefined();
    expect(
      MonitorStep.fromJSON(stepJsonWithBody(undefined)).data!.requestBody,
    ).toBeUndefined();
  });
});
