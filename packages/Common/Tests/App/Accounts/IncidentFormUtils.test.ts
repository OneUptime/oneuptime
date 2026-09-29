// Must stay the first import: the client's URLs are built from HOST on load.
import { DASHBOARD_ORIGIN } from "../../UI/Utils/API/DashboardHost";
import { describe, expect, test } from "@jest/globals";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import CustomFieldType from "../../../Types/CustomField/CustomFieldType";
import APIException from "../../../Types/Exception/ApiException";
import {
  IncidentFormAskedDefinition,
  IncidentFormFieldSetting,
  IncidentFormSubmissionRules,
  IncidentFormSubmissionValidationResult,
  PublicIncidentForm,
  validateIncidentFormSubmission,
} from "../../../Types/Incident/IncidentFormPublic";
import { JSONObject } from "../../../Types/JSON";
import { getCustomFieldFormKey } from "../../../UI/Components/CustomFields/CustomFieldModelFormFields";
import { INCIDENT_FORM_PUBLIC_API_URL } from "../../../../App/FeatureSet/Accounts/src/Utils/ApiPaths";
import {
  buildIncidentFormSubmissionRequest,
  formatIncidentFormRetryAfter,
  getIncidentFormFailure,
  getIncidentFormFailureMessage,
  getIncidentFormSubmitUrl,
  getIncidentFormUrl,
  INCIDENT_FORM_MULTI_LINE_CUSTOM_FIELD_TYPES,
  IncidentFormFailure,
  IncidentFormFailureKind,
  IncidentFormStage,
  isBlankIncidentFormAnswer,
  normalizeIncidentFormShareKey,
  readIncidentFormSubmissionResult,
  readPublicIncidentForm,
  toCustomFieldFormDefinitions,
} from "../../../../App/FeatureSet/Accounts/src/Utils/IncidentForm";
import IncidentFormMessage, {
  isKnownIncidentFormMessage,
} from "../../../../App/FeatureSet/Accounts/src/Utils/IncidentFormMessage";

/*
 * Everything the public incident form page decides without drawing
 * anything: which link it was opened with, what it believes about the form
 * the server described, what it sends, and what it says when something goes
 * wrong. IncidentFormPage.test.tsx drives the same code through the page;
 * this file pins each rule on its own, boundaries included.
 */

const SHARE_KEY: string = "8a4f2c1e-3b5d-4c6e-9f70-1a2b3c4d5e6f";
const CRITICAL_ID: string = "c1c1c1c1-0000-4000-8000-000000000001";
const MINOR_ID: string = "c1c1c1c1-0000-4000-8000-000000000002";

const FORM: PublicIncidentForm = {
  name: "Report a Problem",
  descriptionSetting: IncidentFormFieldSetting.Optional,
  isReporterDetailsRequired: true,
  severities: [
    { _id: CRITICAL_ID, name: "Critical" },
    { _id: MINOR_ID, name: "Minor" },
  ],
  defaultIncidentSeverityId: MINOR_ID,
  customFields: [
    { name: "Impact", customFieldType: CustomFieldType.Text, isRequired: true },
    {
      name: "Users Affected",
      customFieldType: CustomFieldType.Number,
      isRequired: false,
    },
    {
      name: "Acknowledged",
      customFieldType: CustomFieldType.Boolean,
      isRequired: false,
    },
    {
      name: "Region",
      customFieldType: CustomFieldType.Dropdown,
      dropdownOptions: "EU\nUS",
      isRequired: false,
    },
    {
      name: "Services",
      customFieldType: CustomFieldType.MultiSelectDropdown,
      dropdownOptions: "API\nWeb",
      isRequired: false,
    },
    { name: "title", customFieldType: CustomFieldType.Text, isRequired: false },
  ],
  isCaptchaRequired: false,
};

type ErrorFunction = (
  statusCode: number,
  body: unknown,
  headers?: Record<string, string>,
) => HTTPErrorResponse;

const httpError: ErrorFunction = (
  statusCode: number,
  body: unknown,
  headers: Record<string, string> = {},
): HTTPErrorResponse => {
  return new HTTPErrorResponse(statusCode, body as JSONObject, headers);
};

describe("normalizeIncidentFormShareKey", () => {
  test.each([
    [SHARE_KEY, SHARE_KEY],
    [SHARE_KEY.toUpperCase(), SHARE_KEY],
    [`  ${SHARE_KEY}\n`, SHARE_KEY],
  ])("%j is the key %j", (value: string, key: string) => {
    expect(normalizeIncidentFormShareKey(value)).toBe(key);
  });

  test.each([
    ["an empty string", ""],
    ["a word", "form"],
    ["a UUID with a character too many", `${SHARE_KEY}0`],
    ["a UUID with a character too few", SHARE_KEY.slice(1)],
    ["a UUID and the submit route", `${SHARE_KEY}/submit`],
    ["a path climbing out of the route", "../../user/get-list"],
    ["an encoded path", "..%2F..%2Fuser"],
    ["a UUID with a query", `${SHARE_KEY}?x=1`],
    ["a UUID without its dashes", SHARE_KEY.replace(/-/g, "")],
    ["not a string", 42],
    ["nothing", undefined],
    ["null", null],
    ["an array holding a key", [SHARE_KEY]],
  ])("%s is not a key", (_case: string, value: unknown) => {
    expect(normalizeIncidentFormShareKey(value)).toBeNull();
  });
});

describe("the two URLs the page calls", () => {
  test("hang off the API's public incident form route", () => {
    expect(INCIDENT_FORM_PUBLIC_API_URL.toString()).toBe(
      `${DASHBOARD_ORIGIN}/api/incident-form/public`,
    );
    expect(getIncidentFormUrl(SHARE_KEY).toString()).toBe(
      `${DASHBOARD_ORIGIN}/api/incident-form/public/${SHARE_KEY}`,
    );
    expect(getIncidentFormSubmitUrl(SHARE_KEY).toString()).toBe(
      `${DASHBOARD_ORIGIN}/api/incident-form/public/${SHARE_KEY}/submit`,
    );
  });

  test("building one never changes the base URL for the next", () => {
    getIncidentFormUrl(SHARE_KEY);
    getIncidentFormSubmitUrl(SHARE_KEY);

    expect(INCIDENT_FORM_PUBLIC_API_URL.toString()).toBe(
      `${DASHBOARD_ORIGIN}/api/incident-form/public`,
    );
    expect(getIncidentFormUrl(SHARE_KEY).toString()).toBe(
      `${DASHBOARD_ORIGIN}/api/incident-form/public/${SHARE_KEY}`,
    );
  });
});

describe("readPublicIncidentForm", () => {
  test("reads the whole form the server describes", () => {
    const body: JSONObject = {
      name: "Report a Problem",
      description: "Tell us **what** broke.",
      descriptionSetting: "Required",
      isReporterDetailsRequired: false,
      severities: [
        { _id: CRITICAL_ID, name: "Critical", color: "#ff0000" },
        { _id: MINOR_ID, name: "Minor" },
      ],
      defaultIncidentSeverityId: MINOR_ID,
      customFields: [
        {
          name: "Region",
          description: "Where?",
          customFieldType: "Dropdown",
          dropdownOptions: "EU\nUS",
          isRequired: true,
        },
      ],
      isCaptchaRequired: true,
    };

    expect(readPublicIncidentForm(body)).toEqual({
      name: "Report a Problem",
      description: "Tell us **what** broke.",
      descriptionSetting: IncidentFormFieldSetting.Required,
      isReporterDetailsRequired: false,
      severities: [
        { _id: CRITICAL_ID, name: "Critical", color: "#ff0000" },
        { _id: MINOR_ID, name: "Minor" },
      ],
      defaultIncidentSeverityId: MINOR_ID,
      customFields: [
        {
          name: "Region",
          description: "Where?",
          customFieldType: CustomFieldType.Dropdown,
          dropdownOptions: "EU\nUS",
          isRequired: true,
        },
      ],
      isCaptchaRequired: true,
    });
  });

  test("falls back to what the server's own reader falls back to", () => {
    expect(readPublicIncidentForm({ name: "Bare", customFields: [] })).toEqual({
      name: "Bare",
      descriptionSetting: IncidentFormFieldSetting.Optional,
      isReporterDetailsRequired: true,
      customFields: [],
      isCaptchaRequired: false,
    });
  });

  test.each([
    ["a setting nobody spells", "Sometimes"],
    ["a lower-case setting", "hidden"],
    ["no setting", undefined],
  ])(
    "the description is Optional for %s",
    (_case: string, descriptionSetting: unknown) => {
      expect(
        readPublicIncidentForm({
          name: "x",
          customFields: [],
          descriptionSetting: descriptionSetting as string,
        }).descriptionSetting,
      ).toBe(IncidentFormFieldSetting.Optional);
    },
  );

  test.each([
    ["true", true, true],
    ["false", false, false],
    ["a string", "false", true],
    ["missing", undefined, true],
  ])(
    "reporter details required when the server sends %s",
    (_case: string, value: unknown, expected: boolean) => {
      expect(
        readPublicIncidentForm({
          name: "x",
          customFields: [],
          isReporterDetailsRequired: value as boolean,
        }).isReporterDetailsRequired,
      ).toBe(expected);
    },
  );

  test("only a real true asks for a captcha", () => {
    for (const value of ["true", 1, null, undefined, false]) {
      expect(
        readPublicIncidentForm({
          name: "x",
          customFields: [],
          isCaptchaRequired: value as boolean,
        }).isCaptchaRequired,
      ).toBe(false);
    }
  });

  test("a blank description is no description", () => {
    expect(
      readPublicIncidentForm({
        name: "x",
        customFields: [],
        description: "  ",
      }),
    ).not.toHaveProperty("description");
  });

  test("severities need an id to be offered, and keep only what the page draws", () => {
    const form: PublicIncidentForm = readPublicIncidentForm({
      name: "x",
      customFields: [],
      severities: [
        { _id: CRITICAL_ID, name: "Critical", color: "#ff0000", order: 1 },
        { name: "No id" },
        { _id: "", name: "Empty id" },
        "Critical",
        null,
        { _id: MINOR_ID },
        { _id: "d1d1d1d1-0000-4000-8000-000000000003", name: 7, color: "" },
      ],
    });

    expect(form.severities).toEqual([
      { _id: CRITICAL_ID, name: "Critical", color: "#ff0000" },
      { _id: MINOR_ID, name: "" },
      { _id: "d1d1d1d1-0000-4000-8000-000000000003", name: "" },
    ]);
  });

  test("an empty or missing list of severities offers no choice", () => {
    for (const severities of [[], undefined, "Critical", {}]) {
      const form: PublicIncidentForm = readPublicIncidentForm({
        name: "x",
        customFields: [],
        severities: severities as Array<JSONObject>,
        defaultIncidentSeverityId: CRITICAL_ID,
      });

      expect(form).not.toHaveProperty("severities");
      expect(form).not.toHaveProperty("defaultIncidentSeverityId");
    }
  });

  test("the default severity must be one of those offered", () => {
    expect(
      readPublicIncidentForm({
        name: "x",
        customFields: [],
        severities: [{ _id: CRITICAL_ID, name: "Critical" }],
        defaultIncidentSeverityId: MINOR_ID,
      }),
    ).not.toHaveProperty("defaultIncidentSeverityId");
  });

  test("custom fields are read with the server's own rules", () => {
    const form: PublicIncidentForm = readPublicIncidentForm({
      name: "x",
      customFields: [
        { name: "Impact", customFieldType: "Text", isRequired: true },
        // A second field of the same name could not be told apart.
        { name: "Impact", customFieldType: "Number", isRequired: false },
        // Nameless: no answer could be stored under it.
        { customFieldType: "Text" },
        { name: "", customFieldType: "Text" },
        // A type this page does not know is asked as text.
        { name: "Future", customFieldType: "Hologram", isRequired: "yes" },
        // Options only for a dropdown.
        { name: "Count", customFieldType: "Number", dropdownOptions: "1\n2" },
        "not a field",
      ],
    });

    expect(form.customFields).toEqual([
      {
        name: "Impact",
        customFieldType: CustomFieldType.Text,
        isRequired: true,
      },
      {
        name: "Future",
        customFieldType: CustomFieldType.Text,
        isRequired: false,
      },
      {
        name: "Count",
        customFieldType: CustomFieldType.Number,
        isRequired: false,
      },
    ]);
  });

  test.each([
    ["nothing", undefined],
    ["null", null],
    ["a string (a proxy's HTML page)", "<html>Welcome</html>"],
    ["an array", [{ name: "x", customFields: [] }]],
    ["a form with no name", { customFields: [] }],
    ["a form whose name is not text", { name: 7, customFields: [] }],
    ["a form with no custom field list", { name: "x" }],
    ["a form whose fields are not a list", { name: "x", customFields: {} }],
    ["an HTTPResponse's wrapped string", { data: "<html></html>" }],
  ])("refuses %s", (_case: string, body: unknown) => {
    expect(() => {
      return readPublicIncidentForm(body);
    }).toThrow("The incident form could not be read.");
  });
});

describe("readIncidentFormSubmissionResult", () => {
  test("keeps the incident's number and the form's message", () => {
    expect(
      readIncidentFormSubmissionResult({
        incidentNumber: " INC-42 ",
        successMessage: "We are **on it**.\n",
        incidentId: "should never matter",
      }),
    ).toEqual({
      incidentNumber: "INC-42",
      successMessage: "We are **on it**.\n",
    });
  });

  test.each([
    ["nothing", undefined],
    ["an empty body", {}],
    ["a string", "OK"],
    ["blank values", { incidentNumber: " ", successMessage: "" }],
    ["values that are not text", { incidentNumber: 42, successMessage: {} }],
  ])(
    "a report that worked still thanks the reporter after %s",
    (_case: string, body: unknown) => {
      expect(readIncidentFormSubmissionResult(body)).toEqual({});
    },
  );
});

describe("toCustomFieldFormDefinitions", () => {
  test("every asked field is shown; the form decides which are required", () => {
    expect(
      toCustomFieldFormDefinitions([
        {
          name: "Region",
          description: "Where?",
          customFieldType: CustomFieldType.Dropdown,
          dropdownOptions: "EU\nUS",
          isRequired: true,
        },
        {
          name: "Notes",
          customFieldType: CustomFieldType.Markdown,
          isRequired: false,
        },
      ]),
    ).toEqual([
      {
        name: "Region",
        description: "Where?",
        customFieldType: CustomFieldType.Dropdown,
        dropdownOptions: "EU\nUS",
        showOnCreate: true,
        isRequiredOnCreate: true,
      },
      {
        name: "Notes",
        description: undefined,
        customFieldType: CustomFieldType.Markdown,
        dropdownOptions: undefined,
        showOnCreate: true,
        isRequiredOnCreate: false,
      },
    ]);
  });
});

describe("buildIncidentFormSubmissionRequest", () => {
  test("the answers, each custom field under its name - and nothing else", () => {
    const values: JSONObject = {
      title: "  Checkout is down  ",
      description: "  Payments fail\n",
      incidentSeverityId: CRITICAL_ID,
      reporterName: " Ada Lovelace ",
      reporterEmail: " ada@example.com ",
      captchaToken: "should only travel as captchaToken",
      [getCustomFieldFormKey("Impact")]: "Every customer",
      [getCustomFieldFormKey("Users Affected")]: "0",
      [getCustomFieldFormKey("Acknowledged")]: false,
      [getCustomFieldFormKey("Region")]: { label: "EU", value: "EU" },
      [getCustomFieldFormKey("Services")]: ["API", "Web"],
      [getCustomFieldFormKey("title")]: "Not the title",
      // Bare names and anything else the form never asked are not read.
      Impact: "bare name",
      projectId: "11111111-1111-4111-8111-111111111111",
      isPrivate: true,
    };

    expect(
      buildIncidentFormSubmissionRequest({
        form: FORM,
        values: values,
        captchaToken: " token-1 ",
      }),
    ).toEqual({
      data: {
        title: "Checkout is down",
        description: "  Payments fail\n",
        incidentSeverityId: CRITICAL_ID,
        reporterName: "Ada Lovelace",
        reporterEmail: "ada@example.com",
        customFields: {
          Impact: "Every customer",
          "Users Affected": "0",
          Acknowledged: false,
          Region: "EU",
          Services: ["API", "Web"],
          title: "Not the title",
        },
      },
      captchaToken: "token-1",
    });
  });

  test("the bare minimum: a title, and nothing left empty is sent", () => {
    expect(
      buildIncidentFormSubmissionRequest({
        form: FORM,
        values: {
          title: "Down",
          description: "   \n  ",
          incidentSeverityId: "",
          reporterName: "  ",
          reporterEmail: "",
          [getCustomFieldFormKey("Impact")]: "",
          [getCustomFieldFormKey("Services")]: [],
          [getCustomFieldFormKey("Region")]: null,
        },
      }),
    ).toEqual({ data: { title: "Down" } });
  });

  test("a title that is not text is an empty title, for the server to refuse", () => {
    expect(
      buildIncidentFormSubmissionRequest({
        form: FORM,
        values: { title: 42 },
      }),
    ).toEqual({ data: { title: "" } });

    expect(
      buildIncidentFormSubmissionRequest({
        form: FORM,
        values: {},
      }),
    ).toEqual({ data: { title: "" } });
  });

  test("a Hidden description is never sent", () => {
    expect(
      buildIncidentFormSubmissionRequest({
        form: { ...FORM, descriptionSetting: IncidentFormFieldSetting.Hidden },
        values: { title: "Down", description: "Written anyway" },
      }).data,
    ).not.toHaveProperty("description");
  });

  test("a Required description is sent like an Optional one", () => {
    expect(
      buildIncidentFormSubmissionRequest({
        form: {
          ...FORM,
          descriptionSetting: IncidentFormFieldSetting.Required,
        },
        values: { title: "Down", description: "Written" },
      }).data.description,
    ).toBe("Written");
  });

  test("a severity is only sent when the form offers a choice", () => {
    const form: PublicIncidentForm = { ...FORM };
    delete form.severities;
    delete form.defaultIncidentSeverityId;

    expect(
      buildIncidentFormSubmissionRequest({
        form: form,
        values: { title: "Down", incidentSeverityId: CRITICAL_ID },
      }).data,
    ).not.toHaveProperty("incidentSeverityId");

    expect(
      buildIncidentFormSubmissionRequest({
        form: { ...FORM, severities: [] },
        values: { title: "Down", incidentSeverityId: CRITICAL_ID },
      }).data,
    ).not.toHaveProperty("incidentSeverityId");
  });

  test("a severity picked as an option is sent as its id", () => {
    expect(
      buildIncidentFormSubmissionRequest({
        form: FORM,
        values: {
          title: "Down",
          incidentSeverityId: { label: "Critical", value: CRITICAL_ID },
        },
      }).data.incidentSeverityId,
    ).toBe(CRITICAL_ID);
  });

  test("a severity that is not text is not sent", () => {
    expect(
      buildIncidentFormSubmissionRequest({
        form: FORM,
        values: { title: "Down", incidentSeverityId: 7 },
      }).data,
    ).not.toHaveProperty("incidentSeverityId");
  });

  test("a blank captcha token is no token", () => {
    expect(
      buildIncidentFormSubmissionRequest({
        form: FORM,
        values: { title: "Down" },
        captchaToken: "  ",
      }),
    ).toEqual({ data: { title: "Down" } });
  });

  test("custom field answers are only read for the fields the form asks", () => {
    expect(
      buildIncidentFormSubmissionRequest({
        form: { ...FORM, customFields: [] },
        values: {
          title: "Down",
          [getCustomFieldFormKey("Impact")]: "Every customer",
        },
      }).data,
    ).not.toHaveProperty("customFields");
  });
});

describe("getIncidentFormFailure", () => {
  test.each([
    ["a thrown Error", new Error("boom")],
    ["an APIException (no answer at all)", new APIException("Network Error")],
    ["a string", "boom"],
    ["nothing", undefined],
  ])("%s is the server being unavailable", (_case: string, error: unknown) => {
    expect(getIncidentFormFailure(error)).toEqual({
      kind: IncidentFormFailureKind.Unavailable,
      retryAfterSeconds: 0,
    });
  });

  test("404 is not available, whatever came with it", () => {
    expect(
      getIncidentFormFailure(httpError(404, { error: "Something else" })),
    ).toEqual({
      kind: IncidentFormFailureKind.NotAvailable,
      serverMessage: "Something else",
      retryAfterSeconds: 0,
    });
  });

  test("403 is a network that is not allowed", () => {
    expect(
      getIncidentFormFailure(
        httpError(403, { error: IncidentFormMessage.NetworkNotAllowed }),
      ).kind,
    ).toBe(IncidentFormFailureKind.NetworkNotAllowed);
  });

  test("429 carries the limiter's words and its Retry-After", () => {
    expect(
      getIncidentFormFailure(
        httpError(
          429,
          { message: IncidentFormMessage.TooManySubmissions },
          { "retry-after": "900" },
        ),
      ),
    ).toEqual({
      kind: IncidentFormFailureKind.RateLimited,
      serverMessage: IncidentFormMessage.TooManySubmissions,
      retryAfterSeconds: 900,
    });
  });

  test.each([
    ["missing", {}, 0],
    ["in any case", { "Retry-After": "60" }, 60],
    ["an HTTP date, which is not trusted", { "retry-after": "Wed, 21 Oct" }, 0],
    ["negative", { "retry-after": "-5" }, 0],
    ["absurdly long", { "retry-after": "999999999" }, 24 * 60 * 60],
  ])(
    "a Retry-After that is %s",
    (_case: string, headers: Record<string, string>, seconds: number) => {
      expect(
        getIncidentFormFailure(httpError(429, {}, headers)).retryAfterSeconds,
      ).toBe(seconds);
    },
  );

  test("only a 429 has a wait", () => {
    expect(
      getIncidentFormFailure(httpError(503, {}, { "retry-after": "60" }))
        .retryAfterSeconds,
    ).toBe(0);
  });

  test("400 with a reason is a refusal that says why", () => {
    expect(
      getIncidentFormFailure(httpError(400, { error: "Impact is required." })),
    ).toEqual({
      kind: IncidentFormFailureKind.Refused,
      serverMessage: "Impact is required.",
      retryAfterSeconds: 0,
    });
  });

  test("400 without a reason tells the reporter no more than a 500", () => {
    expect(getIncidentFormFailure(httpError(400, {})).kind).toBe(
      IncidentFormFailureKind.Unavailable,
    );
  });

  test.each([500, 502, 503, 504, 401, 405, 418])(
    "%s is the server being unavailable",
    (statusCode: number) => {
      expect(getIncidentFormFailure(httpError(statusCode, {})).kind).toBe(
        IncidentFormFailureKind.Unavailable,
      );
    },
  );

  test("the words come from a JSON body's message or error, trimmed", () => {
    expect(
      getIncidentFormFailure(httpError(400, { message: "  From a limiter " }))
        .serverMessage,
    ).toBe("From a limiter");
    expect(
      getIncidentFormFailure(httpError(400, { error: "From a handler" }))
        .serverMessage,
    ).toBe("From a handler");
    expect(
      getIncidentFormFailure(
        httpError(400, { message: "   ", error: "The error then" }),
      ).serverMessage,
    ).toBe("The error then");
  });

  test("never from a body that was not JSON - a proxy's HTML is not a sentence", () => {
    const failure: IncidentFormFailure = getIncidentFormFailure(
      httpError(400, "<html><body>Bad Request</body></html>"),
    );

    expect(failure.serverMessage).toBeUndefined();
    expect(failure.kind).toBe(IncidentFormFailureKind.Unavailable);
  });

  test("never from a message that is not text", () => {
    expect(
      getIncidentFormFailure(httpError(400, { error: { message: "nested" } }))
        .serverMessage,
    ).toBeUndefined();
  });
});

describe("getIncidentFormFailureMessage", () => {
  type MessageFunction = (
    failure: Partial<IncidentFormFailure> & { kind: IncidentFormFailureKind },
    stage: IncidentFormStage,
  ) => string;

  const message: MessageFunction = (
    failure: Partial<IncidentFormFailure> & { kind: IncidentFormFailureKind },
    stage: IncidentFormStage,
  ): string => {
    return getIncidentFormFailureMessage({
      failure: { retryAfterSeconds: 0, ...failure },
      stage: stage,
    });
  };

  test.each([IncidentFormStage.Load, IncidentFormStage.Submit])(
    "%s: not available and network not allowed are always the page's own words",
    (stage: IncidentFormStage) => {
      expect(
        message(
          {
            kind: IncidentFormFailureKind.NotAvailable,
            serverMessage: "Route not found",
          },
          stage,
        ),
      ).toBe(IncidentFormMessage.NotAvailable);
      expect(
        message(
          {
            kind: IncidentFormFailureKind.NetworkNotAllowed,
            serverMessage: "Forbidden",
          },
          stage,
        ),
      ).toBe(IncidentFormMessage.NetworkNotAllowed);
    },
  );

  test.each([
    IncidentFormMessage.TooManySubmissions,
    IncidentFormMessage.FormBusy,
    IncidentFormMessage.TooManyRequests,
  ])("a limit repeats the limiter's words: %s", (serverMessage: string) => {
    expect(
      message(
        { kind: IncidentFormFailureKind.RateLimited, serverMessage },
        IncidentFormStage.Submit,
      ),
    ).toBe(serverMessage);
  });

  test("a limit without words the page knows gets the page's, by stage", () => {
    expect(
      message(
        {
          kind: IncidentFormFailureKind.RateLimited,
          serverMessage: "Slow down",
        },
        IncidentFormStage.Submit,
      ),
    ).toBe(IncidentFormMessage.TooManySubmissions);
    expect(
      message(
        { kind: IncidentFormFailureKind.RateLimited },
        IncidentFormStage.Load,
      ),
    ).toBe(IncidentFormMessage.TooManyRequests);
  });

  test("a refusal is the server's own words, as they came", () => {
    expect(
      message(
        {
          kind: IncidentFormFailureKind.Refused,
          serverMessage: "Impact is required. Title is required.",
        },
        IncidentFormStage.Submit,
      ),
    ).toBe("Impact is required. Title is required.");
  });

  test("a refusal with no words falls back to the stage's sentence", () => {
    expect(
      message(
        { kind: IncidentFormFailureKind.Refused },
        IncidentFormStage.Submit,
      ),
    ).toBe(IncidentFormMessage.SubmitFailed);
    expect(
      message(
        { kind: IncidentFormFailureKind.Refused },
        IncidentFormStage.Load,
      ),
    ).toBe(IncidentFormMessage.LoadFailed);
  });

  test("an outage repeats a sentence the page knows", () => {
    expect(
      message(
        {
          kind: IncidentFormFailureKind.Unavailable,
          serverMessage: IncidentFormMessage.ReportsUnavailable,
        },
        IncidentFormStage.Submit,
      ),
    ).toBe(IncidentFormMessage.ReportsUnavailable);
  });

  test("and otherwise says the stage's own sentence, never 'Server Error'", () => {
    expect(
      message(
        {
          kind: IncidentFormFailureKind.Unavailable,
          serverMessage: "Server Error",
        },
        IncidentFormStage.Submit,
      ),
    ).toBe(IncidentFormMessage.SubmitFailed);
    expect(
      message(
        {
          kind: IncidentFormFailureKind.Unavailable,
          serverMessage: "Server Error",
        },
        IncidentFormStage.Load,
      ),
    ).toBe(IncidentFormMessage.LoadFailed);
    expect(
      message(
        { kind: IncidentFormFailureKind.Unavailable },
        IncidentFormStage.Load,
      ),
    ).toBe(IncidentFormMessage.LoadFailed);
  });
});

describe("isKnownIncidentFormMessage", () => {
  test("knows every sentence the page can show", () => {
    for (const sentence of Object.values(IncidentFormMessage)) {
      expect(isKnownIncidentFormMessage(sentence)).toBe(true);
    }
  });

  test("and nothing else, not even a sentence that nearly is one", () => {
    expect(isKnownIncidentFormMessage("Impact is required.")).toBe(false);
    expect(
      isKnownIncidentFormMessage(`${IncidentFormMessage.NotAvailable} `),
    ).toBe(false);
    expect(isKnownIncidentFormMessage("")).toBe(false);
  });
});

describe("formatIncidentFormRetryAfter", () => {
  test.each([
    [1, "in 1 second"],
    [45, "in 45 seconds"],
    [59.2, "in 60 seconds"],
    [60, "in 1 minute"],
    [61, "in 2 minutes"],
    [120, "in 2 minutes"],
    [900, "in 15 minutes"],
    [3599, "in 60 minutes"],
    [3600, "in 1 hour"],
    [5400, "in 2 hours"],
  ])(
    "%s seconds is %j - rounded up, never early",
    (seconds: number, text: string) => {
      expect(formatIncidentFormRetryAfter(seconds, "en")).toBe(text);
    },
  );

  test.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    "%s is no wait at all",
    (seconds: number) => {
      expect(formatIncidentFormRetryAfter(seconds, "en")).toBeNull();
    },
  );

  test("in the reporter's language, digits included", () => {
    expect(formatIncidentFormRetryAfter(900, "de")).toBe("in 15 Minuten");
    expect(formatIncidentFormRetryAfter(900, "fa")).toBe("۱۵ دقیقه بعد");
    expect(formatIncidentFormRetryAfter(3600, "ja")).toBe("1 時間後");
  });

  test("a language tag the browser cannot use leaves the wait unsaid", () => {
    expect(formatIncidentFormRetryAfter(900, "not a language tag!")).toBeNull();
  });
});

/*
 * The page refuses a required text answer the server would find nothing in,
 * so the refusal comes from the browser, in the reporter's language, before
 * a captcha answer is spent on it. Pinned against the server's own
 * validateIncidentFormSubmission, which cleans a one-line answer (the title,
 * the reporter's name, a Text field) differently from a multi-line one (the
 * description, a Long text or Markdown field), so the two cannot drift.
 */
describe("isBlankIncidentFormAnswer", () => {
  const ANSWERS: Array<string> = [
    "",
    " ",
    "   ",
    "\t",
    "\n",
    "\r\n",
    " \n\t ",
    "\u00a0",
    "\u2028",
    "\ufeff",
    "\u0000",
    "\u0000 \u0000",
    "\u0001",
    "\u0007\u001f",
    "\u007f",
    "x",
    "  x  ",
    "\u0000x",
    "\u0001x",
    "\n\n    indented",
  ];

  type RefusedAsMissingFunction = (data: {
    question: string;
    askedDefinitions?: Array<IncidentFormAskedDefinition>;
    form?: IncidentFormSubmissionRules;
    answers: JSONObject;
  }) => boolean;

  // Whether the server refuses the answers with "<question> is required.".
  const refusedAsMissing: RefusedAsMissingFunction = (data: {
    question: string;
    askedDefinitions?: Array<IncidentFormAskedDefinition>;
    form?: IncidentFormSubmissionRules;
    answers: JSONObject;
  }): boolean => {
    const result: IncidentFormSubmissionValidationResult =
      validateIncidentFormSubmission({
        form: data.form || {
          isReporterDetailsRequired: false,
          descriptionSetting: IncidentFormFieldSetting.Hidden,
        },
        askedDefinitions: data.askedDefinitions || [],
        severities: [],
        data: data.answers,
      });

    return (
      !result.isValid && result.errors.includes(`${data.question} is required.`)
    );
  };

  test.each(ANSWERS)("as the title: %j", (answer: string) => {
    expect(isBlankIncidentFormAnswer(answer, false)).toBe(
      refusedAsMissing({ question: "Title", answers: { title: answer } }),
    );
  });

  test.each(ANSWERS)("as the reporter's name: %j", (answer: string) => {
    expect(isBlankIncidentFormAnswer(answer, false)).toBe(
      refusedAsMissing({
        question: "Your Name",
        form: {
          isReporterDetailsRequired: true,
          descriptionSetting: IncidentFormFieldSetting.Hidden,
        },
        answers: {
          title: "Checkout is down",
          reporterName: answer,
          reporterEmail: "ada@example.com",
        },
      }),
    );
  });

  test.each(ANSWERS)("as a required description: %j", (answer: string) => {
    expect(isBlankIncidentFormAnswer(answer, true)).toBe(
      refusedAsMissing({
        question: "Description",
        form: {
          isReporterDetailsRequired: false,
          descriptionSetting: IncidentFormFieldSetting.Required,
        },
        answers: { title: "Checkout is down", description: answer },
      }),
    );
  });

  test.each(ANSWERS)("as a required Text field: %j", (answer: string) => {
    expect(isBlankIncidentFormAnswer(answer, false)).toBe(
      refusedAsMissing({
        question: "Impact",
        askedDefinitions: [
          {
            name: "Impact",
            customFieldType: CustomFieldType.Text,
            isRequiredOnCreate: true,
          },
        ],
        answers: {
          title: "Checkout is down",
          customFields: { Impact: answer },
        },
      }),
    );
  });

  test.each(
    ANSWERS.flatMap((answer: string): Array<[CustomFieldType, string]> => {
      return [
        [CustomFieldType.LongText, answer],
        [CustomFieldType.Markdown, answer],
      ];
    }),
  )(
    "as a required %s field: %j",
    (customFieldType: CustomFieldType, answer: string) => {
      expect(
        isBlankIncidentFormAnswer(
          answer,
          INCIDENT_FORM_MULTI_LINE_CUSTOM_FIELD_TYPES.includes(customFieldType),
        ),
      ).toBe(
        refusedAsMissing({
          question: "Details",
          askedDefinitions: [
            {
              name: "Details",
              customFieldType: customFieldType,
              isRequiredOnCreate: true,
            },
          ],
          answers: {
            title: "Checkout is down",
            customFields: { Details: answer },
          },
        }),
      );
    },
  );

  test("the parity is not empty: spaces are blank, a word is not, and a lone control character depends on the line", () => {
    expect(isBlankIncidentFormAnswer("  \n\t ", false)).toBe(true);
    expect(isBlankIncidentFormAnswer("  \n\t ", true)).toBe(true);
    expect(isBlankIncidentFormAnswer("  x ", false)).toBe(false);
    // A one-line answer reads a control character as a space...
    expect(isBlankIncidentFormAnswer("\u0001", false)).toBe(true);
    // ...a multi-line one keeps it, and only drops NUL characters.
    expect(isBlankIncidentFormAnswer("\u0001", true)).toBe(false);
    expect(isBlankIncidentFormAnswer("\u0000", true)).toBe(true);
  });

  test("Long text and Markdown are the multi-line custom field types; Text is not", () => {
    expect(INCIDENT_FORM_MULTI_LINE_CUSTOM_FIELD_TYPES).toEqual([
      CustomFieldType.LongText,
      CustomFieldType.Markdown,
    ]);
  });
});
