import { describe, expect, test } from "@jest/globals";
import HTTPMethod from "../../../Types/API/HTTPMethod";
import URL from "../../../Types/API/URL";
import { JSONObject } from "../../../Types/JSON";
import MonitorRequestBodyFormat, {
  MonitorRequestBodyFormatUtil,
  TEXT_REQUEST_BODY_CONTENT_TYPE,
} from "../../../Types/Monitor/MonitorRequestBodyFormat";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorTemplateSyncFieldUtil from "../../../Types/Monitor/MonitorTemplateSyncField";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import MonitorRequestBody, {
  REQUEST_BODY_NOT_JSON_MESSAGE,
} from "../../../Utils/Monitor/MonitorRequestBody";
import MonitorStepsValuesUtil from "../../../Utils/Monitor/MonitorStepsValuesUtil";
import MonitorTemplateSyncUtil from "../../../Utils/Monitor/MonitorTemplateSyncUtil";
import { getMonitorStepSchema } from "../../../Utils/Schema/MonitorSchemas";

/*
 * AN API MONITOR CAN SEND A BODY THAT IS NOT JSON, AS WRITTEN (#10736).
 *
 * A body was always read as JSON: XML for a SOAP endpoint, plain text, or
 * form fields written as a=1&b=2 were refused by the form and the API, and
 * no probe sent one. A step says how its body is read now
 * (requestBodyFormat): JSON, the default - every step stored before the
 * format existed has none, and keeps sending JSON - or text, sent byte for
 * byte, never judged as JSON, its placeholders filled in as they are.
 */

const XML_BODY: string = '<?xml version="1.0"?><ping><id>1</id></ping>';
const FORM_BODY: string = "a=1&b=2";

// An API step as stored, written as an API client or the form writes it.
function storedStep(value: JSONObject): MonitorStep {
  return MonitorStep.fromJSON({
    _type: "MonitorStep",
    value: {
      id: ObjectID.generate().toString(),
      monitorDestination: { _type: "URL", value: "https://example.com/soap" },
      requestType: HTTPMethod.POST,
      monitorCriteria: {
        _type: "MonitorCriteria",
        value: { monitorCriteriaInstanceArray: [] },
      },
      ...value,
    },
  });
}

function apiStep(
  requestBody: string,
  requestBodyFormat?: MonitorRequestBodyFormat | undefined,
): MonitorStep {
  const step: MonitorStep = MonitorStep.getDefaultMonitorStep({
    monitorName: "SOAP endpoint",
    monitorType: MonitorType.API,
    onlineMonitorStatusId: ObjectID.generate(),
    offlineMonitorStatusId: ObjectID.generate(),
    defaultIncidentSeverityId: ObjectID.generate(),
    defaultAlertSeverityId: ObjectID.generate(),
  });

  step.data!.monitorDestination = URL.fromString("https://example.com/soap");
  step.setRequestType(HTTPMethod.POST);
  step.setRequestBody(requestBody);
  step.setRequestBodyFormat(requestBodyFormat);

  return step;
}

describe("the format's words", () => {
  test("are the wire strings every client writes", () => {
    expect(MonitorRequestBodyFormat.JSON).toBe("json");
    expect(MonitorRequestBodyFormat.Text).toBe("text");
    expect(MonitorRequestBodyFormatUtil.ALL_FORMATS).toEqual(["json", "text"]);
    expect(TEXT_REQUEST_BODY_CONTENT_TYPE).toBe("text/plain;charset=UTF-8");
  });

  test("anything but text reads as JSON, as a step without one always was", () => {
    for (const value of [
      undefined,
      null,
      "",
      "json",
      "JSON",
      "Text",
      "xml",
      1,
    ]) {
      expect([value, MonitorRequestBodyFormatUtil.read(value)]).toEqual([
        value,
        MonitorRequestBodyFormat.JSON,
      ]);
      expect(MonitorRequestBodyFormatUtil.isText(value)).toBe(false);
    }

    expect(MonitorRequestBodyFormatUtil.read("text")).toBe(
      MonitorRequestBodyFormat.Text,
    );
    expect(MonitorRequestBodyFormatUtil.isText("text")).toBe(true);
  });

  test("a stored format is kept as written when it names one, and nothing else is", () => {
    expect(MonitorRequestBodyFormatUtil.readWritten("text")).toBe("text");
    expect(MonitorRequestBodyFormatUtil.readWritten("json")).toBe("json");

    for (const value of [undefined, null, "", "xml", "Text", {}, 0]) {
      expect(MonitorRequestBodyFormatUtil.readWritten(value)).toBeUndefined();
    }
  });
});

describe("a step's format, stored and read back", () => {
  test("a step stored before the format existed is JSON, and its body is checked as JSON", () => {
    const step: MonitorStep = storedStep({ requestBody: '{"a": 1}' });

    expect(step.data!.requestBodyFormat).toBeUndefined();
    expect(
      MonitorRequestBodyFormatUtil.read(step.data!.requestBodyFormat),
    ).toBe(MonitorRequestBodyFormat.JSON);
    // Written back without one: nothing a stored monitor holds changes.
    expect(
      (step.toJSON()["value"] as JSONObject)["requestBodyFormat"],
    ).toBeUndefined();
    // A full step stored so, with no format, is refused a body that is no JSON.
    const stored: MonitorStep = MonitorStep.fromJSON(
      apiStep(XML_BODY).toJSON(),
    );

    expect(stored.data!.requestBodyFormat).toBeUndefined();
    expect(MonitorStep.getValidationError(stored, MonitorType.API)).toBe(
      REQUEST_BODY_NOT_JSON_MESSAGE,
    );
  });

  test.each(["text", "json"])(
    "%s is written back as it was written, its body byte for byte",
    (format: string) => {
      const step: MonitorStep = storedStep({
        requestBody: FORM_BODY,
        requestBodyFormat: format,
      });
      const json: JSONObject = MonitorStep.clone(step).toJSON()[
        "value"
      ] as JSONObject;

      expect(json["requestBodyFormat"]).toBe(format);
      expect(json["requestBody"]).toBe(FORM_BODY);
    },
  );

  test("a format that names none is left out, and the step is JSON", () => {
    const step: MonitorStep = storedStep({
      requestBody: '{"a": 1}',
      requestBodyFormat: "xml",
    });

    expect(step.data!.requestBodyFormat).toBeUndefined();
  });

  test("a new step has none: JSON", () => {
    expect(new MonitorStep().data!.requestBodyFormat).toBeUndefined();
    expect(
      (MonitorStep.getNewMonitorStepAsJSON()["value"] as JSONObject)[
        "requestBodyFormat"
      ],
    ).toBeUndefined();
  });
});

describe("what the form, the API and the server refuse", () => {
  test.each([
    { name: "XML", body: XML_BODY },
    { name: "plain text", body: "ping" },
    { name: "form fields", body: FORM_BODY },
    { name: "an unclosed array", body: "[1, 2" },
  ])(
    "$name is a body when it is sent as text, and refused as JSON",
    ({ body }: { name: string; body: string }) => {
      expect(
        MonitorStep.getValidationError(
          apiStep(body, MonitorRequestBodyFormat.Text),
          MonitorType.API,
        ),
      ).toBeNull();
      expect(
        MonitorStep.getValidationError(
          apiStep(body, MonitorRequestBodyFormat.JSON),
          MonitorType.API,
        ),
      ).toBe(REQUEST_BODY_NOT_JSON_MESSAGE);
      expect(
        MonitorStep.getValidationError(apiStep(body), MonitorType.API),
      ).toBe(REQUEST_BODY_NOT_JSON_MESSAGE);
      expect(
        MonitorRequestBody.getUnreadableError({
          monitorType: MonitorType.API,
          requestBody: body,
          requestBodyFormat: MonitorRequestBodyFormat.Text,
        }),
      ).toBeNull();
    },
  );

  test("the server's check of a write reads the format too", () => {
    const steps: MonitorSteps = new MonitorSteps();
    steps.setMonitorStepsInstanceArray([
      apiStep(XML_BODY, MonitorRequestBodyFormat.Text),
    ]);

    expect(
      MonitorStepsValuesUtil.getUnreadableValueError({
        monitorType: MonitorType.API,
        monitorSteps: steps.toJSON(),
      }),
    ).toBeNull();

    const jsonSteps: MonitorSteps = new MonitorSteps();
    jsonSteps.setMonitorStepsInstanceArray([apiStep(XML_BODY)]);

    expect(
      MonitorStepsValuesUtil.getUnreadableValueError({
        monitorType: MonitorType.API,
        monitorSteps: jsonSteps.toJSON(),
      }),
    ).toBe(REQUEST_BODY_NOT_JSON_MESSAGE);
  });

  test("the API takes json or text, and nothing else", () => {
    const step: JSONObject = apiStep(FORM_BODY).toJSON();
    const withFormat: (format: unknown) => JSONObject = (
      format: unknown,
    ): JSONObject => {
      return {
        ...step,
        value: {
          ...(step["value"] as JSONObject),
          requestBodyFormat: format as string,
        },
      };
    };

    for (const format of ["json", "text"]) {
      expect(getMonitorStepSchema().safeParse(withFormat(format)).success).toBe(
        true,
      );
    }

    for (const format of ["xml", "TEXT", 1]) {
      expect(getMonitorStepSchema().safeParse(withFormat(format)).success).toBe(
        false,
      );
    }

    expect(getMonitorStepSchema().safeParse(step).success).toBe(true);
  });
});

describe("secrets in a text body", () => {
  test("are filled in as they are, even where the text is JSON", () => {
    const values: Map<string, string> = new Map([["P", 'a"b\\c']]);

    expect(
      MonitorRequestBody.fillSecrets(
        "<pass>{{monitorSecrets.P}}</pass>",
        values,
        MonitorRequestBodyFormat.Text,
      ),
    ).toBe('<pass>a"b\\c</pass>');
    expect(
      MonitorRequestBody.fillSecrets(
        '{"p": "{{monitorSecrets.P}}"}',
        values,
        MonitorRequestBodyFormat.Text,
      ),
    ).toBe('{"p": "a"b\\c"}');
    // The same body as JSON keeps its string whole.
    expect(
      MonitorRequestBody.fillSecrets(
        '{"p": "{{monitorSecrets.P}}"}',
        values,
        MonitorRequestBodyFormat.JSON,
      ),
    ).toBe('{"p": "a\\"b\\\\c"}');
  });
});

describe("which steps only a newer probe sends (#10737)", () => {
  test("every text body", () => {
    for (const body of [XML_BODY, FORM_BODY, '{"an": "object"}', "plain"]) {
      expect(
        MonitorRequestBody.needsProbeThatSendsAnyBody(
          body,
          MonitorRequestBodyFormat.Text,
        ),
      ).toBe(true);
    }
  });

  test("but no body is none, whatever its format", () => {
    for (const body of [undefined, "", "  \n"]) {
      expect(
        MonitorRequestBody.needsProbeThatSendsAnyBody(
          body,
          MonitorRequestBodyFormat.Text,
        ),
      ).toBe(false);
    }
  });

  test("and a JSON object needs none, as before", () => {
    expect(
      MonitorRequestBody.needsProbeThatSendsAnyBody(
        '{"a": 1}',
        MonitorRequestBodyFormat.JSON,
      ),
    ).toBe(false);
    expect(MonitorRequestBody.needsProbeThatSendsAnyBody('{"a": 1}')).toBe(
      false,
    );
  });
});

describe("template sync keeps a body and its format together", () => {
  test("Request body keeps both", () => {
    expect(MonitorTemplateSyncFieldUtil.getPaths("requestBody")).toEqual([
      "requestBody",
      "requestBodyFormat",
    ]);
  });

  test("a monitor that keeps its own body keeps its format, and one that syncs takes the template's", () => {
    const template: MonitorStep = apiStep(
      FORM_BODY,
      MonitorRequestBodyFormat.Text,
    );
    template.data!.id = "step";
    template.data!.doNotSyncFields = ["requestBody"];

    const current: MonitorStep = apiStep('{"own": true}');
    current.data!.id = "step";

    const templateSteps: MonitorSteps = new MonitorSteps();
    templateSteps.setMonitorStepsInstanceArray([template]);
    templateSteps.setDefaultMonitorStatusId(ObjectID.generate());

    const currentSteps: MonitorSteps = new MonitorSteps();
    currentSteps.setMonitorStepsInstanceArray([current]);
    currentSteps.setDefaultMonitorStatusId(ObjectID.generate());

    const kept: MonitorStep = MonitorTemplateSyncUtil.buildSyncedMonitorSteps({
      templateMonitorSteps: templateSteps,
      currentMonitorSteps: currentSteps,
      monitorType: MonitorType.API,
    }).data!.monitorStepsInstanceArray[0]!;

    // Its own JSON body, still JSON: never sent as text.
    expect(kept.data!.requestBody).toBe('{"own": true}');
    expect(kept.data!.requestBodyFormat).toBeUndefined();

    template.data!.doNotSyncFields = [];

    const synced: MonitorStep = MonitorTemplateSyncUtil.buildSyncedMonitorSteps(
      {
        templateMonitorSteps: templateSteps,
        currentMonitorSteps: currentSteps,
        monitorType: MonitorType.API,
      },
    ).data!.monitorStepsInstanceArray[0]!;

    expect(synced.data!.requestBody).toBe(FORM_BODY);
    expect(synced.data!.requestBodyFormat).toBe(MonitorRequestBodyFormat.Text);
  });
});
