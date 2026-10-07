// Must stay the first import: the client's URLs are built from HOST on load.
import { DASHBOARD_ORIGIN } from "../../UI/Utils/API/DashboardHost";
import { describe, expect, test } from "@jest/globals";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import APIException from "../../../Types/Exception/ApiException";
import {
  PublicForm,
  PublicFormFieldType,
} from "../../../Types/Form/FormPublic";
import { JSONObject } from "../../../Types/JSON";
import { FORM_PUBLIC_API_URL } from "../../../../App/FeatureSet/Accounts/src/Utils/ApiPaths";
import {
  buildFormSubmissionRequest,
  formatFormRetryAfter,
  FormFailure,
  FormFailureKind,
  FormStage,
  getFormFailure,
  getFormFailureMessage,
  getFormSubmitUrl,
  getFormUrl,
  normalizeFormShareKey,
  readFormSubmissionResult,
  readPublicForm,
} from "../../../../App/FeatureSet/Accounts/src/Utils/Form";
import FormMessage, {
  isKnownFormMessage,
} from "../../../../App/FeatureSet/Accounts/src/Utils/FormMessage";

/*
 * Everything the public form page decides without drawing anything: which
 * link it was opened with, what it believes about the form the server
 * described, what it sends, and what it says when something goes wrong.
 * FormPage.test.tsx drives the same code through the page; this file pins
 * each rule on its own, boundaries included.
 */

const SHARE_KEY: string = "8a4f2c1e-3b5d-4c6e-9f70-1a2b3c4d5e6f";
const CRITICAL_ID: string = "c1c1c1c1-0000-4000-8000-000000000001";

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

describe("normalizeFormShareKey", () => {
  test.each([
    [SHARE_KEY, SHARE_KEY],
    [SHARE_KEY.toUpperCase(), SHARE_KEY],
    [`  ${SHARE_KEY}\n`, SHARE_KEY],
  ])("%j is the key %j", (value: string, key: string) => {
    expect(normalizeFormShareKey(value)).toBe(key);
  });

  test.each([
    ["an empty string", ""],
    ["a word", "form"],
    ["a UUID with a character too many", `${SHARE_KEY}0`],
    ["a UUID and the submit route", `${SHARE_KEY}/submit`],
    ["a path climbing out of the route", "../../user/get-list"],
    ["an encoded path", "..%2F..%2Fuser"],
    ["a UUID with a query", `${SHARE_KEY}?x=1`],
    ["a UUID without its dashes", SHARE_KEY.replace(/-/g, "")],
    ["not a string", 42],
    ["nothing", undefined],
    ["an array holding a key", [SHARE_KEY]],
  ])("%s is not a key", (_case: string, value: unknown) => {
    expect(normalizeFormShareKey(value)).toBeNull();
  });
});

describe("the two URLs the page calls", () => {
  test("hang off the API's public form route", () => {
    expect(FORM_PUBLIC_API_URL.toString()).toBe(
      `${DASHBOARD_ORIGIN}/api/form/public`,
    );
    expect(getFormUrl(SHARE_KEY).toString()).toBe(
      `${DASHBOARD_ORIGIN}/api/form/public/${SHARE_KEY}`,
    );
    expect(getFormSubmitUrl(SHARE_KEY).toString()).toBe(
      `${DASHBOARD_ORIGIN}/api/form/public/${SHARE_KEY}/submit`,
    );
  });

  test("building one never changes the base URL for the next", () => {
    getFormUrl(SHARE_KEY);
    getFormSubmitUrl(SHARE_KEY);

    expect(FORM_PUBLIC_API_URL.toString()).toBe(
      `${DASHBOARD_ORIGIN}/api/form/public`,
    );
  });
});

describe("readPublicForm: what the page believes about the form", () => {
  test("reads the whole form the server describes", () => {
    expect(
      readPublicForm({
        name: "Report a Problem",
        description: "Tell us **what** is broken.",
        fields: [
          {
            id: "title",
            label: "What is wrong?",
            helpText: "One line.",
            type: "Text",
            isRequired: true,
            maxLength: 500,
          },
          {
            id: "severity",
            label: "How bad?",
            type: "Dropdown",
            isRequired: false,
            options: [{ value: CRITICAL_ID, label: "Critical", color: "#f00" }],
            defaultValue: CRITICAL_ID,
          },
        ],
        isCaptchaRequired: true,
      }),
    ).toEqual({
      name: "Report a Problem",
      description: "Tell us **what** is broken.",
      fields: [
        {
          id: "title",
          label: "What is wrong?",
          helpText: "One line.",
          type: PublicFormFieldType.Text,
          isRequired: true,
          maxLength: 500,
        },
        {
          id: "severity",
          label: "How bad?",
          type: PublicFormFieldType.Dropdown,
          isRequired: false,
          options: [{ value: CRITICAL_ID, label: "Critical", color: "#f00" }],
          defaultValue: CRITICAL_ID,
        },
      ],
      isCaptchaRequired: true,
    });
  });

  test.each([
    ["not an object", "form"],
    ["no name", { fields: [] }],
    ["no list of questions", { name: "F" }],
    ["questions that are not a list", { name: "F", fields: {} }],
  ])("refuses a body with %s", (_case: string, body: unknown) => {
    expect(() => {
      readPublicForm(body);
    }).toThrow("The form could not be read.");
  });

  test("keeps only questions it can draw: an id, once; a choice with options", () => {
    const form: PublicForm = readPublicForm({
      name: "F",
      fields: [
        { id: "q", label: "Q", type: "Text", isRequired: true },
        { id: "q", label: "Again", type: "Text", isRequired: false },
        { id: "has space", label: "Bad id", type: "Text" },
        { label: "No id", type: "Text" },
        { id: "empty", label: "Empty", type: "Dropdown", options: [] },
        {
          id: "junk",
          label: "Junk",
          type: "MultiSelectDropdown",
          options: [{ label: "No value" }, "x", null],
        },
        null,
      ],
    });

    expect(
      form.fields.map((field: { id: string; label: string }) => {
        return `${field.id}:${field.label}`;
      }),
    ).toEqual(["q:Q"]);
  });

  test("an unknown type is asked as text; only a real true is required or asks for a captcha", () => {
    const form: PublicForm = readPublicForm({
      name: "F",
      fields: [{ id: "q", label: "Q", type: "Banana", isRequired: "true" }],
      isCaptchaRequired: "yes",
    });

    expect(form.fields[0]).toEqual({
      id: "q",
      label: "Q",
      type: PublicFormFieldType.Text,
      isRequired: false,
    });
    expect(form.isCaptchaRequired).toBe(false);
  });

  test("a default must be one of the options; an option with no label shows its value", () => {
    const form: PublicForm = readPublicForm({
      name: "F",
      fields: [
        {
          id: "office",
          label: "Office",
          type: "Dropdown",
          options: [{ value: "Berlin" }],
          defaultValue: "Paris",
        },
      ],
    });

    expect(form.fields[0]!.options).toEqual([
      { value: "Berlin", label: "Berlin" },
    ]);
    expect(form.fields[0]!.defaultValue).toBeUndefined();
  });

  test("a blank description is no description; a bad length is no length", () => {
    const form: PublicForm = readPublicForm({
      name: "F",
      description: "   ",
      fields: [{ id: "q", label: "Q", type: "Text", maxLength: -3 }],
    });

    expect("description" in form).toBe(false);
    expect(form.fields[0]!.maxLength).toBeUndefined();
  });
});

describe("readPublicForm: the form's branding", () => {
  const PNG: string = Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString("base64");

  const told: (branding: JSONObject) => PublicForm = (
    branding: JSONObject,
  ): PublicForm => {
    return readPublicForm({
      name: "Report a Problem",
      fields: [],
      isCaptchaRequired: false,
      ...branding,
    });
  };

  test("reads the logo, its alt text and the favicon the server described", () => {
    expect(
      told({
        logo: { type: "image/png", data: PNG },
        logoAltText: "  Acme Inc. ",
        favicon: { type: "image/svg+xml", data: "PHN2Zz4=" },
      }),
    ).toEqual({
      name: "Report a Problem",
      fields: [],
      isCaptchaRequired: false,
      logo: { type: "image/png", data: PNG },
      logoAltText: "Acme Inc.",
      favicon: { type: "image/svg+xml", data: "PHN2Zz4=" },
    });
  });

  test("a form without branding is just the form", () => {
    expect(Object.keys(told({})).sort()).toEqual(
      ["fields", "isCaptchaRequired", "name"].sort(),
    );
  });

  test("never an image it cannot draw safely: then the OneUptime one stays", () => {
    for (const logo of [
      { type: "text/html", data: PNG },
      { type: "image/png", data: "<svg onload=alert(1)>" },
      { type: "image/png", data: `${PNG}"` },
      { type: "image/png" },
      "data:image/png;base64,AAAA",
      [PNG],
      null,
    ]) {
      const form: PublicForm = told({
        logo: logo as unknown as JSONObject,
        logoAltText: "Acme Inc.",
        favicon: logo as unknown as JSONObject,
      });

      expect(form.logo).toBeUndefined();
      // What a logo says goes only with a logo.
      expect(form.logoAltText).toBeUndefined();
      expect(form.favicon).toBeUndefined();
    }
  });

  test("an ICO is drawn as the favicon, never as the logo", () => {
    const ico: JSONObject = { type: "image/x-icon", data: "AAABAAEA" };
    const form: PublicForm = told({
      logo: ico,
      logoAltText: "Acme Inc.",
      favicon: ico,
    });

    expect(form.logo).toBeUndefined();
    expect(form.logoAltText).toBeUndefined();
    expect(form.favicon).toEqual(ico);
  });

  test("never more than each image may weigh: a logo's worth is too much for a favicon", () => {
    // The longest base64 of a 128 KB and of a 512 KB image.
    const faviconSized: string = "A".repeat(Math.ceil((128 * 1024) / 3) * 4);
    const logoSized: string = "A".repeat(Math.ceil((512 * 1024) / 3) * 4);

    expect(
      told({ favicon: { type: "image/png", data: faviconSized } }).favicon,
    ).toBeDefined();
    expect(
      told({ favicon: { type: "image/png", data: `${faviconSized}AAAA` } })
        .favicon,
    ).toBeUndefined();
    expect(
      told({ logo: { type: "image/png", data: logoSized } }).logo,
    ).toBeDefined();
    expect(
      told({ logo: { type: "image/png", data: `${logoSized}AAAA` } }).logo,
    ).toBeUndefined();
    expect(
      told({ favicon: { type: "image/png", data: logoSized } }).favicon,
    ).toBeUndefined();
  });

  test("an alt text that is not text, or only spaces, is none", () => {
    for (const logoAltText of [42, "   ", { text: "Acme" }]) {
      expect(
        told({
          logo: { type: "image/png", data: PNG },
          logoAltText: logoAltText as unknown as string,
        }).logoAltText,
      ).toBeUndefined();
    }
  });
});

describe("readFormSubmissionResult", () => {
  test("keeps the record's number and the form's message", () => {
    expect(
      readFormSubmissionResult({
        reference: " INC-42 ",
        successMessage: "**Thanks**",
        incidentId: "never shown",
      }),
    ).toEqual({ reference: "INC-42", successMessage: "**Thanks**" });
  });

  test.each([[null], ["x"], [[]], [{ reference: 42, successMessage: "  " }]])(
    "reads nothing from %p",
    (data: unknown) => {
      expect(readFormSubmissionResult(data)).toEqual({});
    },
  );
});

describe("buildFormSubmissionRequest", () => {
  const FORM: PublicForm = {
    name: "F",
    fields: [
      {
        id: "title",
        label: "Title",
        type: PublicFormFieldType.Text,
        isRequired: true,
      },
      {
        id: "severity",
        label: "Severity",
        type: PublicFormFieldType.Dropdown,
        isRequired: false,
        options: [{ value: CRITICAL_ID, label: "Critical" }],
      },
    ],
    isCaptchaRequired: true,
  };

  test("sends the answers keyed by question, and the captcha token", () => {
    expect(
      buildFormSubmissionRequest({
        form: FORM,
        values: {
          answer_title: "Down",
          answer_severity: { value: CRITICAL_ID, label: "Critical" } as never,
          projectId: "never sent",
        },
        captchaToken: " token ",
      }),
    ).toEqual({
      data: { answers: { title: "Down", severity: CRITICAL_ID } },
      captchaToken: "token",
    });
  });

  test("a blank captcha token is no token; no values are no answers", () => {
    expect(
      buildFormSubmissionRequest({
        form: FORM,
        values: undefined as unknown as JSONObject,
        captchaToken: "  ",
      }),
    ).toEqual({ data: { answers: {} } });
  });
});

describe("getFormFailure", () => {
  test.each([
    ["a thrown Error", new Error("boom")],
    ["an APIException (no answer at all)", new APIException("Network Error")],
    ["a string", "boom"],
    ["nothing", undefined],
  ])("%s is the server being unavailable", (_case: string, error: unknown) => {
    expect(getFormFailure(error)).toEqual({
      kind: FormFailureKind.Unavailable,
      retryAfterSeconds: 0,
    });
  });

  test("404 is not available, whatever came with it", () => {
    expect(getFormFailure(httpError(404, { error: "Something else" }))).toEqual(
      {
        kind: FormFailureKind.NotAvailable,
        serverMessage: "Something else",
        retryAfterSeconds: 0,
      },
    );
  });

  test("403 is a network that is not allowed", () => {
    expect(
      getFormFailure(httpError(403, { error: FormMessage.NetworkNotAllowed }))
        .kind,
    ).toBe(FormFailureKind.NetworkNotAllowed);
  });

  test("429 carries the limiter's words and its Retry-After", () => {
    expect(
      getFormFailure(
        httpError(
          429,
          { message: FormMessage.TooManySubmissions },
          { "retry-after": "900" },
        ),
      ),
    ).toEqual({
      kind: FormFailureKind.RateLimited,
      serverMessage: FormMessage.TooManySubmissions,
      retryAfterSeconds: 900,
    });
  });

  test("only a 429 has a wait", () => {
    expect(
      getFormFailure(httpError(503, {}, { "retry-after": "60" }))
        .retryAfterSeconds,
    ).toBe(0);
  });

  test("400 with a reason is a refusal that says why; without one, no more than a 500", () => {
    expect(
      getFormFailure(httpError(400, { error: "Region is required." })),
    ).toEqual({
      kind: FormFailureKind.Refused,
      serverMessage: "Region is required.",
      retryAfterSeconds: 0,
    });
    expect(getFormFailure(httpError(400, {})).kind).toBe(
      FormFailureKind.Unavailable,
    );
  });

  test.each([500, 502, 503, 504, 401, 405, 418])(
    "%s is the server being unavailable",
    (statusCode: number) => {
      expect(getFormFailure(httpError(statusCode, {})).kind).toBe(
        FormFailureKind.Unavailable,
      );
    },
  );

  test("the words come from a JSON body's message or error, trimmed - never from HTML or a non-string", () => {
    expect(
      getFormFailure(httpError(400, { message: "  From a limiter " }))
        .serverMessage,
    ).toBe("From a limiter");
    expect(
      getFormFailure(
        httpError(400, { message: "   ", error: "The error then" }),
      ).serverMessage,
    ).toBe("The error then");

    const html: FormFailure = getFormFailure(
      httpError(400, "<html><body>Bad Request</body></html>"),
    );

    expect(html.serverMessage).toBeUndefined();
    expect(html.kind).toBe(FormFailureKind.Unavailable);
    expect(
      getFormFailure(httpError(400, { error: { message: "nested" } }))
        .serverMessage,
    ).toBeUndefined();
  });
});

describe("getFormFailureMessage", () => {
  type MessageFunction = (
    failure: Partial<FormFailure> & { kind: FormFailureKind },
    stage: FormStage,
  ) => string;

  const message: MessageFunction = (
    failure: Partial<FormFailure> & { kind: FormFailureKind },
    stage: FormStage,
  ): string => {
    return getFormFailureMessage({
      failure: { retryAfterSeconds: 0, ...failure },
      stage: stage,
    });
  };

  test.each([FormStage.Load, FormStage.Submit])(
    "%s: not available and network not allowed are always the page's own words",
    (stage: FormStage) => {
      expect(
        message(
          {
            kind: FormFailureKind.NotAvailable,
            serverMessage: "Route not found",
          },
          stage,
        ),
      ).toBe(FormMessage.NotAvailable);
      expect(
        message(
          {
            kind: FormFailureKind.NetworkNotAllowed,
            serverMessage: "Forbidden",
          },
          stage,
        ),
      ).toBe(FormMessage.NetworkNotAllowed);
    },
  );

  test.each([
    FormMessage.TooManySubmissions,
    FormMessage.FormBusy,
    FormMessage.TooManyRequests,
  ])("a limit repeats the limiter's words: %s", (serverMessage: string) => {
    expect(
      message(
        { kind: FormFailureKind.RateLimited, serverMessage },
        FormStage.Submit,
      ),
    ).toBe(serverMessage);
  });

  test("a limit without words the page knows gets the page's, by stage", () => {
    expect(
      message(
        { kind: FormFailureKind.RateLimited, serverMessage: "Slow down" },
        FormStage.Submit,
      ),
    ).toBe(FormMessage.TooManySubmissions);
    expect(message({ kind: FormFailureKind.RateLimited }, FormStage.Load)).toBe(
      FormMessage.TooManyRequests,
    );
  });

  test("a refusal is the server's own words, or the stage's sentence", () => {
    expect(
      message(
        {
          kind: FormFailureKind.Refused,
          serverMessage: "Region is required. Title is required.",
        },
        FormStage.Submit,
      ),
    ).toBe("Region is required. Title is required.");
    expect(message({ kind: FormFailureKind.Refused }, FormStage.Submit)).toBe(
      FormMessage.SubmitFailed,
    );
    expect(message({ kind: FormFailureKind.Refused }, FormStage.Load)).toBe(
      FormMessage.LoadFailed,
    );
  });

  test("an outage repeats a sentence the page knows, and otherwise says the stage's own, never 'Server Error'", () => {
    expect(
      message(
        {
          kind: FormFailureKind.Unavailable,
          serverMessage: FormMessage.SubmissionsUnavailable,
        },
        FormStage.Submit,
      ),
    ).toBe(FormMessage.SubmissionsUnavailable);
    expect(
      message(
        { kind: FormFailureKind.Unavailable, serverMessage: "Server Error" },
        FormStage.Submit,
      ),
    ).toBe(FormMessage.SubmitFailed);
    expect(message({ kind: FormFailureKind.Unavailable }, FormStage.Load)).toBe(
      FormMessage.LoadFailed,
    );
  });
});

describe("isKnownFormMessage", () => {
  test("knows every sentence the page can show, and nothing else", () => {
    for (const sentence of Object.values(FormMessage)) {
      expect(isKnownFormMessage(sentence)).toBe(true);
    }

    expect(isKnownFormMessage("Region is required.")).toBe(false);
    expect(isKnownFormMessage(`${FormMessage.NotAvailable} `)).toBe(false);
    expect(isKnownFormMessage("")).toBe(false);
  });
});

describe("formatFormRetryAfter", () => {
  test.each([
    [1, "in 1 second"],
    [45, "in 45 seconds"],
    [59.2, "in 60 seconds"],
    [60, "in 1 minute"],
    [61, "in 2 minutes"],
    [900, "in 15 minutes"],
    [3599, "in 60 minutes"],
    [3600, "in 1 hour"],
    [5400, "in 2 hours"],
  ])(
    "%s seconds is %j - rounded up, never early",
    (seconds: number, text: string) => {
      expect(formatFormRetryAfter(seconds, "en")).toBe(text);
    },
  );

  test.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    "%s is no wait at all",
    (seconds: number) => {
      expect(formatFormRetryAfter(seconds, "en")).toBeNull();
    },
  );

  test("in the submitter's language", () => {
    expect(formatFormRetryAfter(900, "de")).toBe("in 15 Minuten");
    expect(formatFormRetryAfter(3600, "ja")).toBe("1 時間後");
  });

  test("a language tag the browser cannot use leaves the wait unsaid", () => {
    expect(formatFormRetryAfter(900, "not a language tag!")).toBeNull();
  });
});

describe("readPublicForm: the form's templates", () => {
  const FIELDS: Array<JSONObject> = [
    { id: "title", label: "Title", type: "Text", isRequired: true },
    {
      id: "office",
      label: "Office",
      type: "Dropdown",
      isRequired: false,
      options: [{ value: "Berlin" }, { value: "London" }],
    },
  ];

  function read(templates: unknown): PublicForm {
    return readPublicForm({
      name: "Department A",
      fields: FIELDS,
      isCaptchaRequired: false,
      templates: templates,
    });
  }

  test("reads the templates the server listed, in order", () => {
    expect(
      read([
        {
          id: "outage",
          name: "Application Outage",
          answers: { title: "Down", office: "Berlin" },
        },
        {
          id: "restored",
          name: "Service Restored",
          isDefault: true,
          answers: { title: "Restored" },
        },
      ]).templates,
    ).toEqual([
      {
        id: "outage",
        name: "Application Outage",
        answers: { title: "Down", office: "Berlin" },
      },
      {
        id: "restored",
        name: "Service Restored",
        isDefault: true,
        answers: { title: "Restored" },
      },
    ]);
  });

  test.each([undefined, null, "outage", {}, []])(
    "a form with no templates (%j) has none",
    (templates: unknown) => {
      expect(read(templates)).not.toHaveProperty("templates");
    },
  );

  test("drops a template it cannot use: no id, an id that is not one, no name, a repeat", () => {
    expect(
      read([
        null,
        "outage",
        { name: "No id" },
        { id: "../../admin", name: "Bad id" },
        { id: "noname" },
        { id: "blank", name: "  " },
        { id: "outage", name: "Outage" },
        { id: "outage", name: "Outage again" },
      ]).templates,
    ).toEqual([{ id: "outage", name: "Outage", answers: {} }]);
  });

  test("keeps only the answers to the questions the page asks", () => {
    expect(
      read([
        {
          id: "outage",
          name: "Outage",
          answers: { title: "Down", hidden: "Never asked", __proto__: "x" },
        },
      ]).templates![0]!.answers,
    ).toEqual({ title: "Down" });
  });

  test("answers that are not an object are none", () => {
    expect(
      read([{ id: "outage", name: "Outage", answers: ["Down"] }]).templates![0]!
        .answers,
    ).toEqual({});
  });

  test("only the first default is a default, and only true is one", () => {
    const templates: Array<{ isDefault?: boolean | undefined }> = read([
      { id: "a", name: "A", isDefault: "true" },
      { id: "b", name: "B", isDefault: true },
      { id: "c", name: "C", isDefault: true },
    ]).templates!;

    expect(
      templates.map((template: { isDefault?: boolean | undefined }) => {
        return template.isDefault;
      }),
    ).toEqual([undefined, true, undefined]);
  });

  test("trims a name, and cuts one too long for a template", () => {
    const templates: Array<{ name: string }> = read([
      { id: "a", name: "  Outage  " },
      { id: "b", name: "x".repeat(150) },
    ]).templates!;

    expect(templates[0]!.name).toBe("Outage");
    expect(templates[1]!.name).toHaveLength(100);
  });
});

describe("buildFormSubmissionRequest: the template it started from", () => {
  const FORM: PublicForm = {
    name: "F",
    fields: [
      {
        id: "title",
        label: "Title",
        type: PublicFormFieldType.Text,
        isRequired: true,
      },
    ],
    isCaptchaRequired: false,
    templates: [{ id: "outage", name: "Outage", answers: { title: "Down" } }],
  };

  test("names the template the submitter started from", () => {
    expect(
      buildFormSubmissionRequest({
        form: FORM,
        values: { answer_title: "Down" },
        templateId: "outage",
      }),
    ).toEqual({ data: { answers: { title: "Down" }, templateId: "outage" } });
  });

  test.each([null, undefined, "", "deleted"])(
    "names none for %j, which is not one of the form's templates",
    (templateId: string | null | undefined) => {
      expect(
        buildFormSubmissionRequest({
          form: FORM,
          values: { answer_title: "Down" },
          templateId,
        }).data,
      ).not.toHaveProperty("templateId");
    },
  );

  test("a form with no templates sends none, whatever the page held", () => {
    expect(
      buildFormSubmissionRequest({
        form: { ...FORM, templates: undefined },
        values: { answer_title: "Down" },
        templateId: "outage",
      }).data,
    ).not.toHaveProperty("templateId");
  });
});
