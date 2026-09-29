import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentCustomField from "../../../Models/DatabaseModels/IncidentCustomField";
import { getIncidentFormAskedDefinitions } from "../../../Types/CustomField/CustomFieldCreateSettings";
import CustomFieldType from "../../../Types/CustomField/CustomFieldType";
import {
  DEFAULT_INCIDENT_FORM_DESCRIPTION_SETTING,
  INCIDENT_FORM_CUSTOM_FIELD_TEXT_MAX_LENGTH,
  INCIDENT_FORM_DESCRIPTION_MAX_LENGTH,
  INCIDENT_FORM_FIELD_SETTINGS,
  INCIDENT_FORM_QUESTION_LABELS,
  INCIDENT_FORM_REPORTER_EMAIL_MAX_LENGTH,
  INCIDENT_FORM_REPORTER_NAME_MAX_LENGTH,
  INCIDENT_FORM_TITLE_MAX_LENGTH,
  IncidentFormAskedDefinition,
  IncidentFormFieldSetting,
  IncidentFormSubmissionRules,
  IncidentFormSubmissionValidationResult,
  PublicIncidentForm,
  PublicIncidentFormField,
  PublicIncidentFormSeverity,
  PublicIncidentFormSource,
  ValidatedIncidentFormSubmission,
  formatIncidentFormSubmissionErrors,
  getPublicIncidentForm,
  getPublicIncidentFormFields,
  isIncidentFormFieldSetting,
  validateIncidentFormSubmission,
} from "../../../Types/Incident/IncidentFormPublic";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { CUSTOM_FIELD_MUST_BE_CHECKED_MESSAGE } from "../../../UI/Components/CustomFields/CustomFieldFormFields";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { getMetadataArgsStorage } from "typeorm";
import type { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";

/*
 * The public half of incident forms: what a stranger's browser is told about
 * a form, and the rules a stranger's submission is held to before an
 * incident is declared from it.
 *
 * Everything here is a boundary the server relies on. The incident is built
 * only from validateIncidentFormSubmission's value, so what matters most is
 * what can NOT get through it: answers to fields the form does not ask,
 * anything that is not an answer (a projectId, a state, isPrivate), text
 * longer than its column, and a severity the form does not offer.
 */

const SEVERITY_HIGH: string = "0a0a0a0a-0000-4000-8000-000000000001";
const SEVERITY_LOW: string = "0a0a0a0a-0000-4000-8000-000000000002";

const SEVERITIES: Array<PublicIncidentFormSeverity> = [
  { _id: SEVERITY_HIGH, name: "High", color: "#ff0000" },
  { _id: SEVERITY_LOW, name: "Low" },
];

// The rules of a form that asks for nothing optional beyond the defaults.
const DEFAULT_RULES: IncidentFormSubmissionRules = {
  descriptionSetting: IncidentFormFieldSetting.Optional,
  isReporterDetailsRequired: true,
  allowReporterToChooseSeverity: false,
};

// The fields a form might ask for, as getIncidentFormAskedDefinitions hands them.
const ASKED: Array<IncidentFormAskedDefinition> = [
  {
    name: "Impact",
    customFieldType: CustomFieldType.Text,
    isRequiredOnCreate: true,
  },
  {
    name: "Steps to Reproduce",
    customFieldType: CustomFieldType.LongText,
    isRequiredOnCreate: false,
  },
  {
    name: "Notes",
    customFieldType: CustomFieldType.Markdown,
    isRequiredOnCreate: false,
  },
  {
    name: "Users Affected",
    customFieldType: CustomFieldType.Number,
    isRequiredOnCreate: false,
  },
  {
    name: "I Have Checked The Status Page",
    customFieldType: CustomFieldType.Boolean,
    isRequiredOnCreate: true,
  },
  {
    name: "Customer Facing",
    customFieldType: CustomFieldType.Boolean,
    isRequiredOnCreate: false,
  },
  {
    name: "Region",
    customFieldType: CustomFieldType.Dropdown,
    dropdownOptions: "EU\nUS",
    isRequiredOnCreate: false,
  },
  {
    name: "Systems",
    customFieldType: CustomFieldType.MultiSelectDropdown,
    dropdownOptions: '[{"value":"API","color":"#112233"},{"value":"Web"}]',
    isRequiredOnCreate: false,
  },
  {
    name: "Noticed On",
    customFieldType: CustomFieldType.Date,
    isRequiredOnCreate: false,
  },
  {
    name: "Noticed At",
    customFieldType: CustomFieldType.DateTime,
    isRequiredOnCreate: false,
  },
  {
    name: "Untyped",
    customFieldType: undefined,
    isRequiredOnCreate: false,
  },
];

// The answers every required question needs.
const REQUIRED_ANSWERS: JSONObject = {
  Impact: "Checkout is down",
  "I Have Checked The Status Page": true,
};

type SubmissionFunction = (overrides?: JSONObject) => JSONObject;

const submission: SubmissionFunction = (
  overrides: JSONObject = {},
): JSONObject => {
  return {
    title: "Checkout fails",
    reporterName: "Jane Doe",
    reporterEmail: "jane@example.com",
    customFields: { ...REQUIRED_ANSWERS },
    ...overrides,
  };
};

type ValidateFunction = (
  data: unknown,
  options?: {
    form?: IncidentFormSubmissionRules;
    askedDefinitions?: Array<IncidentFormAskedDefinition>;
    severities?: Array<{ _id: string }>;
  },
) => IncidentFormSubmissionValidationResult;

const validate: ValidateFunction = (
  data: unknown,
  options: {
    form?: IncidentFormSubmissionRules;
    askedDefinitions?: Array<IncidentFormAskedDefinition>;
    severities?: Array<{ _id: string }>;
  } = {},
): IncidentFormSubmissionValidationResult => {
  return validateIncidentFormSubmission({
    form: options.form || DEFAULT_RULES,
    askedDefinitions: options.askedDefinitions || ASKED,
    severities: options.severities || SEVERITIES,
    data: data,
  });
};

type ErrorsOfFunction = (
  result: IncidentFormSubmissionValidationResult,
) => Array<string>;

const errorsOf: ErrorsOfFunction = (
  result: IncidentFormSubmissionValidationResult,
): Array<string> => {
  if (result.isValid) {
    throw new Error(
      `Expected the submission to be refused, but it passed: ${JSON.stringify(
        result.value,
      )}`,
    );
  }

  return result.errors;
};

type ValueOfFunction = (
  result: IncidentFormSubmissionValidationResult,
) => ValidatedIncidentFormSubmission;

const valueOf: ValueOfFunction = (
  result: IncidentFormSubmissionValidationResult,
): ValidatedIncidentFormSubmission => {
  if (!result.isValid) {
    throw new Error(
      `Expected the submission to pass, but it was refused: ${result.errors.join(
        " | ",
      )}`,
    );
  }

  return result.value;
};

type ColumnLengthFunction = (
  target: unknown,
  propertyName: string,
) => number | undefined;

// The length TypeORM creates a varchar column with.
const columnLength: ColumnLengthFunction = (
  target: unknown,
  propertyName: string,
): number | undefined => {
  const column: ColumnMetadataArgs | undefined =
    getMetadataArgsStorage().columns.find(
      (candidate: ColumnMetadataArgs): boolean => {
        return (
          candidate.target === target && candidate.propertyName === propertyName
        );
      },
    );

  const length: string | number | undefined = column?.options.length;

  return length === undefined ? undefined : Number(length);
};

type DeepFreezeFunction = <T>(value: T) => T;

const deepFreeze: DeepFreezeFunction = <T>(value: T): T => {
  if (value && typeof value === "object") {
    for (const child of Object.values(
      value as unknown as Record<string, unknown>,
    )) {
      deepFreeze(child);
    }

    Object.freeze(value);
  }

  return value;
};

describe("IncidentFormFieldSetting", () => {
  test("stores the three settings under these exact strings", () => {
    expect(IncidentFormFieldSetting.Required).toBe("Required");
    expect(IncidentFormFieldSetting.Optional).toBe("Optional");
    expect(IncidentFormFieldSetting.Hidden).toBe("Hidden");
    expect(INCIDENT_FORM_FIELD_SETTINGS).toEqual([
      IncidentFormFieldSetting.Required,
      IncidentFormFieldSetting.Optional,
      IncidentFormFieldSetting.Hidden,
    ]);
  });

  /*
   * IncidentFormModel.test.ts pins that the IncidentForm column defaults to
   * the same value.
   */
  test("a form asks for an optional description unless told otherwise", () => {
    expect(DEFAULT_INCIDENT_FORM_DESCRIPTION_SETTING).toBe(
      IncidentFormFieldSetting.Optional,
    );
  });

  test.each(["Required", "Optional", "Hidden"])(
    "%s is a setting",
    (value: string) => {
      expect(isIncidentFormFieldSetting(value)).toBe(true);
    },
  );

  test.each([
    ["Default"],
    ["required"],
    ["OPTIONAL"],
    [" Hidden"],
    [""],
    [null],
    [undefined],
    [1],
    [{}],
  ])("%j is not a setting", (value: unknown) => {
    expect(isIncidentFormFieldSetting(value)).toBe(false);
  });
});

describe("the size caps fit the columns the answers land in", () => {
  test("a title is at most as long as Incident.title", () => {
    expect(INCIDENT_FORM_TITLE_MAX_LENGTH).toBe(500);
    expect(columnLength(Incident, "title")).toBe(
      INCIDENT_FORM_TITLE_MAX_LENGTH,
    );
  });

  /*
   * IncidentFormModel.test.ts pins the IncidentFormSubmission columns to the
   * same lengths.
   */
  test("the reporter's name and email are capped at 100", () => {
    expect(INCIDENT_FORM_REPORTER_NAME_MAX_LENGTH).toBe(100);
    expect(INCIDENT_FORM_REPORTER_EMAIL_MAX_LENGTH).toBe(100);
  });

  test("the description and custom field text caps", () => {
    expect(INCIDENT_FORM_DESCRIPTION_MAX_LENGTH).toBe(20000);
    expect(INCIDENT_FORM_CUSTOM_FIELD_TEXT_MAX_LENGTH).toBe(10000);
  });
});

describe("the question labels", () => {
  test("are the public page's field titles", () => {
    expect(INCIDENT_FORM_QUESTION_LABELS).toEqual({
      title: "Title",
      description: "Description",
      severity: "Severity",
      reporterName: "Your Name",
      reporterEmail: "Your Email",
    });
  });

  test("errors are worded as the browser's own checks word them", () => {
    const validationSource: string = fs.readFileSync(
      path.join(__dirname, "../../../UI/Components/Forms/Validation.ts"),
      "utf8",
    );

    // The templates the server fills in, straight from the form's checks.
    expect(validationSource).toContain('"{{field}} is required."');
    expect(validationSource).toContain(
      '"{{field}} cannot be more than {{maxLength}} characters."',
    );

    expect(errorsOf(validate(submission({ title: "" })))).toEqual([
      "Title is required.",
    ]);
    expect(
      errorsOf(
        validate(
          submission({ title: "x".repeat(INCIDENT_FORM_TITLE_MAX_LENGTH + 1) }),
        ),
      ),
    ).toEqual(["Title cannot be more than 500 characters."]);
  });

  test("a required yes/no answered no reads as the dashboard's must-be-checked message", () => {
    const name: string = "I Have Checked The Status Page";

    expect(
      errorsOf(
        validate(
          submission({
            customFields: { ...REQUIRED_ANSWERS, [name]: false },
          }),
        ),
      ),
    ).toEqual([
      CUSTOM_FIELD_MUST_BE_CHECKED_MESSAGE.replace("{{field}}", name),
    ]);
  });
});

describe("getPublicIncidentFormFields: what the page is told about each question", () => {
  test("names, types, help text and whether it is required - nothing else", () => {
    expect(
      getPublicIncidentFormFields([
        {
          name: "Impact",
          description: "How bad is it?",
          customFieldType: CustomFieldType.Text,
          isRequiredOnCreate: true,
        },
        {
          name: "Region",
          customFieldType: CustomFieldType.Dropdown,
          dropdownOptions: "EU\nUS",
          isRequiredOnCreate: false,
        },
      ]),
    ).toEqual([
      {
        name: "Impact",
        description: "How bad is it?",
        customFieldType: CustomFieldType.Text,
        isRequired: true,
      },
      {
        name: "Region",
        customFieldType: CustomFieldType.Dropdown,
        dropdownOptions: "EU\nUS",
        isRequired: false,
      },
    ]);
  });

  test("an IncidentCustomField row can be passed as it is, and none of its other columns leak", () => {
    const row: IncidentCustomField = new IncidentCustomField();
    row._id = "0b0b0b0b-0000-4000-8000-000000000001";
    row.projectId = ObjectID.generate();
    row.name = "Region";
    row.description = "Where it happened";
    row.customFieldType = CustomFieldType.MultiSelectDropdown;
    row.dropdownOptions = "EU\nUS";
    row.variableKey = "region";
    row.sortOrder = 2;
    row.showOnCreate = false;
    row.isRequiredOnCreate = true;
    row.includeInSubscriberNotifications = true;

    const [field] = getPublicIncidentFormFields(
      getIncidentFormAskedDefinitions([row], { region: "Required" }),
    );

    expect(field).toEqual({
      name: "Region",
      description: "Where it happened",
      customFieldType: CustomFieldType.MultiSelectDropdown,
      dropdownOptions: "EU\nUS",
      isRequired: true,
    });
    expect(Object.keys(field!).sort()).toEqual(
      [
        "customFieldType",
        "description",
        "dropdownOptions",
        "isRequired",
        "name",
      ].sort(),
    );
  });

  test("a dropdown's options are only sent for a dropdown", () => {
    const [text] = getPublicIncidentFormFields([
      {
        name: "Once A Dropdown",
        customFieldType: CustomFieldType.Text,
        dropdownOptions: "Secret option\nAnother",
      },
    ]);

    expect(text).not.toHaveProperty("dropdownOptions");
  });

  test.each([[undefined], [null], ["Colour"], [""]])(
    "a field whose type is %j is asked as Text",
    (customFieldType: string | null | undefined) => {
      expect(
        getPublicIncidentFormFields([{ name: "Odd", customFieldType }])[0]!
          .customFieldType,
      ).toBe(CustomFieldType.Text);
    },
  );

  test("blank help text and blank options are left out", () => {
    const [field] = getPublicIncidentFormFields([
      {
        name: "Region",
        description: "   ",
        customFieldType: CustomFieldType.Dropdown,
        dropdownOptions: " \n ",
      },
    ]);

    expect(field).toEqual({
      name: "Region",
      customFieldType: CustomFieldType.Dropdown,
      isRequired: false,
    });
  });

  test("a field without a name is left out, and so is a second field with the same name", () => {
    expect(
      getPublicIncidentFormFields([
        { name: "", customFieldType: CustomFieldType.Text },
        { name: null, customFieldType: CustomFieldType.Text },
        { customFieldType: CustomFieldType.Text },
        {
          name: "Impact",
          customFieldType: CustomFieldType.Text,
          isRequiredOnCreate: true,
        },
        {
          name: "Impact",
          customFieldType: CustomFieldType.Number,
          isRequiredOnCreate: false,
        },
      ]),
    ).toEqual([
      {
        name: "Impact",
        customFieldType: CustomFieldType.Text,
        isRequired: true,
      },
    ]);
  });

  test("keeps the order it is given", () => {
    expect(
      getPublicIncidentFormFields([
        { name: "B" },
        { name: "A" },
        { name: "C" },
      ]).map((field: PublicIncidentFormField): string => {
        return field.name;
      }),
    ).toEqual(["B", "A", "C"]);
  });

  test("nothing asked, nothing shown", () => {
    expect(getPublicIncidentFormFields([])).toEqual([]);
  });
});

describe("getPublicIncidentForm: what the page is told about the form", () => {
  type StoredForm = PublicIncidentFormSource & Record<string, unknown>;

  type StoredFormFunction = () => StoredForm;

  const SHARE_KEY: string = "0d0d0d0d-0000-4000-8000-000000000001";

  /*
   * A form with every column set, as the submit route would load it.
   * IncidentFormModel.test.ts passes a real IncidentForm row the same way.
   */
  const storedForm: StoredFormFunction = (): StoredForm => {
    return {
      _id: "0c0c0c0c-0000-4000-8000-000000000001",
      projectId: ObjectID.generate(),
      name: "Report a Security Concern",
      description: "Tell us what you saw.",
      isEnabled: true,
      shareKey: new ObjectID(SHARE_KEY),
      incidentSeverityId: new ObjectID(SEVERITY_LOW.toUpperCase()),
      allowReporterToChooseSeverity: true,
      incidentTemplateId: ObjectID.generate(),
      descriptionSetting: IncidentFormFieldSetting.Required,
      customFieldSettings: { impact: "Required" },
      isReporterDetailsRequired: false,
      successMessage: "Thanks!",
      ipWhitelist: "10.0.0.0/8",
      createdByUserId: ObjectID.generate(),
    };
  };

  test("a stored form can be passed as it is, and only the public subset comes out", () => {
    const publicForm: PublicIncidentForm = getPublicIncidentForm({
      form: storedForm(),
      askedDefinitions: [
        {
          name: "Impact",
          customFieldType: CustomFieldType.Text,
          isRequiredOnCreate: true,
        },
      ],
      severities: SEVERITIES,
      isCaptchaRequired: true,
    });

    expect(publicForm).toEqual({
      name: "Report a Security Concern",
      description: "Tell us what you saw.",
      descriptionSetting: IncidentFormFieldSetting.Required,
      isReporterDetailsRequired: false,
      severities: [
        { _id: SEVERITY_HIGH, name: "High", color: "#ff0000" },
        { _id: SEVERITY_LOW, name: "Low" },
      ],
      defaultIncidentSeverityId: SEVERITY_LOW,
      customFields: [
        {
          name: "Impact",
          customFieldType: CustomFieldType.Text,
          isRequired: true,
        },
      ],
      isCaptchaRequired: true,
    });

    // The link key, the project, the template and the allowlist stay home.
    const serialized: string = JSON.stringify(publicForm);

    for (const secret of [
      SHARE_KEY,
      "10.0.0.0/8",
      "Thanks!",
      "projectId",
      "shareKey",
      "incidentTemplateId",
      "ipWhitelist",
      "customFieldSettings",
    ]) {
      expect(serialized).not.toContain(secret);
    }
  });

  test("the severities are only listed when the reporter may choose one", () => {
    const form: StoredForm = storedForm();
    form.allowReporterToChooseSeverity = false;

    const publicForm: PublicIncidentForm = getPublicIncidentForm({
      form: form,
      askedDefinitions: [],
      severities: SEVERITIES,
      isCaptchaRequired: false,
    });

    expect(publicForm).not.toHaveProperty("severities");
    expect(publicForm).not.toHaveProperty("defaultIncidentSeverityId");
  });

  test("the form's own severity is only preselected when it is one of those listed", () => {
    const form: StoredForm = storedForm();
    form.incidentSeverityId = ObjectID.generate();

    const publicForm: PublicIncidentForm = getPublicIncidentForm({
      form: form,
      askedDefinitions: [],
      severities: SEVERITIES,
      isCaptchaRequired: false,
    });

    expect(publicForm.severities).toHaveLength(2);
    expect(publicForm).not.toHaveProperty("defaultIncidentSeverityId");

    delete form.incidentSeverityId;

    expect(
      getPublicIncidentForm({
        form: form,
        askedDefinitions: [],
        severities: SEVERITIES,
        isCaptchaRequired: false,
      }),
    ).not.toHaveProperty("defaultIncidentSeverityId");
  });

  test("only the three properties of each severity are listed, and a severity with no id is not", () => {
    const publicForm: PublicIncidentForm = getPublicIncidentForm({
      form: { allowReporterToChooseSeverity: true },
      askedDefinitions: [],
      severities: [
        {
          _id: SEVERITY_HIGH,
          name: "High",
          projectId: "somewhere",
          order: 1,
        } as unknown as PublicIncidentFormSeverity,
        { _id: "", name: "No Id" },
      ],
      isCaptchaRequired: false,
    });

    expect(publicForm.severities).toEqual([
      { _id: SEVERITY_HIGH, name: "High" },
    ]);
  });

  test("defaults for a form read without its settings", () => {
    expect(
      getPublicIncidentForm({
        form: {},
        askedDefinitions: [],
        severities: SEVERITIES,
        isCaptchaRequired: false,
      }),
    ).toEqual({
      name: "",
      descriptionSetting: IncidentFormFieldSetting.Optional,
      isReporterDetailsRequired: true,
      customFields: [],
      isCaptchaRequired: false,
    });
  });

  test("a description of only whitespace is not sent, and an unknown description setting reads as Optional", () => {
    expect(
      getPublicIncidentForm({
        form: { description: "  \n ", descriptionSetting: "Mandatory" },
        askedDefinitions: [],
        severities: [],
        isCaptchaRequired: false,
      }),
    ).toEqual({
      name: "",
      descriptionSetting: IncidentFormFieldSetting.Optional,
      isReporterDetailsRequired: true,
      customFields: [],
      isCaptchaRequired: false,
    });
  });
});

describe("validateIncidentFormSubmission: the shape of the request", () => {
  test.each([
    ["null", null],
    ["undefined", undefined],
    ["a string", "title=Down"],
    ["an array", [{ title: "Down" }]],
    ["a number", 5],
  ])("refuses %s", (_label: string, data: unknown) => {
    expect(errorsOf(validate(data))).toEqual([
      "The submission must be an object holding the form's answers.",
    ]);
  });

  test("a complete submission passes, cleaned", () => {
    expect(valueOf(validate(submission()))).toEqual({
      title: "Checkout fails",
      reporterName: "Jane Doe",
      reporterEmail: "jane@example.com",
      customFields: {
        Impact: "Checkout is down",
        "I Have Checked The Status Page": true,
      },
    });
  });

  test("nothing but the answers gets through: a projectId, a state or a privacy flag is dropped", () => {
    const value: ValidatedIncidentFormSubmission = valueOf(
      validate(
        submission({
          projectId: ObjectID.generate().toString(),
          currentIncidentStateId: ObjectID.generate().toString(),
          createdIncidentTemplateId: ObjectID.generate().toString(),
          isPrivate: true,
          isVisibleOnStatusPage: true,
          createdByUserId: ObjectID.generate().toString(),
          _id: ObjectID.generate().toString(),
          monitors: [ObjectID.generate().toString()],
        }),
      ),
    );

    expect(Object.keys(value).sort()).toEqual(
      ["customFields", "reporterEmail", "reporterName", "title"].sort(),
    );
  });

  test("every problem is reported at once, in the order of the form", () => {
    expect(
      errorsOf(
        validate({
          title: "",
          reporterName: "",
          reporterEmail: "not an email",
          customFields: {},
        }),
      ),
    ).toEqual([
      "Title is required.",
      "Your Name is required.",
      "Your Email is not a valid email address.",
      "Impact is required.",
      "I Have Checked The Status Page must be checked.",
    ]);
  });

  test("never changes the request it is given", () => {
    const data: JSONObject = deepFreeze(
      submission({
        title: "  Checkout fails  ",
        customFields: {
          ...REQUIRED_ANSWERS,
          Systems: ["API", "API", " Web "],
        },
      }),
    );

    expect(valueOf(validate(data)).customFields["Systems"]).toEqual([
      "API",
      "Web",
    ]);
    expect(data["title"]).toBe("  Checkout fails  ");
  });

  test("missing settings and lists are read as their defaults", () => {
    const result: IncidentFormSubmissionValidationResult =
      validateIncidentFormSubmission({
        form: undefined as unknown as IncidentFormSubmissionRules,
        askedDefinitions:
          undefined as unknown as Array<IncidentFormAskedDefinition>,
        severities: undefined as unknown as Array<{ _id: string }>,
        data: { title: "Down", incidentSeverityId: SEVERITY_HIGH },
      });

    // Reporter details are required by default; nothing else is asked.
    expect(errorsOf(result)).toEqual([
      "Your Name is required.",
      "Your Email is required.",
    ]);
  });
});

describe("validateIncidentFormSubmission: the title", () => {
  test.each([
    ["missing", undefined],
    ["null", null],
    ["empty", ""],
    ["only spaces", "    "],
    ["only line breaks and tabs", "\n\t\r\n"],
  ])("is required: %s is refused", (_label: string, title: unknown) => {
    const data: JSONObject = submission();

    if (title === undefined) {
      delete data["title"];
    } else {
      data["title"] = title as JSONObject[string];
    }

    expect(errorsOf(validate(data))).toEqual(["Title is required."]);
  });

  test.each([[5], [true], [{ text: "Down" }], [["Down"]]])(
    "must be text: %j is refused once, not also as missing",
    (title: unknown) => {
      expect(
        errorsOf(validate(submission({ title: title as JSONObject[string] }))),
      ).toEqual(["Title must be text."]);
    },
  );

  test("is trimmed, and its line breaks, tabs and control characters become single spaces", () => {
    expect(
      valueOf(
        validate(
          submission({ title: "  Checkout\n\n down\tin\u0000EU\u007f " }),
        ),
      ).title,
    ).toBe("Checkout down in EU");
    expect(
      valueOf(validate(submission({ title: "Checkout    down" }))).title,
    ).toBe("Checkout down");
  });

  test("keeps characters that are not control characters, non-breaking spaces and emoji included", () => {
    expect(
      valueOf(validate(submission({ title: "Café down 🔥 (EU)" }))).title,
    ).toBe("Café down 🔥 (EU)");
  });

  test("may be exactly 500 characters, measured after trimming", () => {
    const longest: string = "x".repeat(INCIDENT_FORM_TITLE_MAX_LENGTH);

    expect(
      valueOf(validate(submission({ title: `  ${longest}  ` }))).title,
    ).toBe(longest);
  });

  test("may not be 501", () => {
    expect(
      errorsOf(
        validate(
          submission({ title: "x".repeat(INCIDENT_FORM_TITLE_MAX_LENGTH + 1) }),
        ),
      ),
    ).toEqual(["Title cannot be more than 500 characters."]);
  });
});

describe("validateIncidentFormSubmission: the description", () => {
  type RulesFunction = (
    setting: IncidentFormFieldSetting | string | undefined,
  ) => IncidentFormSubmissionRules;

  const rules: RulesFunction = (
    setting: IncidentFormFieldSetting | string | undefined,
  ): IncidentFormSubmissionRules => {
    return { ...DEFAULT_RULES, descriptionSetting: setting };
  };

  test("an optional description may be left out, or left empty", () => {
    for (const description of [undefined, null, "", "   ", "\n\n  \n"]) {
      const data: JSONObject = submission();

      if (description !== undefined) {
        data["description"] = description;
      }

      expect(
        valueOf(
          validate(data, { form: rules(IncidentFormFieldSetting.Optional) }),
        ),
      ).not.toHaveProperty("description");
    }
  });

  test("a required description may not", () => {
    for (const description of [undefined, "", "  \n  "]) {
      const data: JSONObject = submission();

      if (description !== undefined) {
        data["description"] = description;
      }

      expect(
        errorsOf(
          validate(data, { form: rules(IncidentFormFieldSetting.Required) }),
        ),
      ).toEqual(["Description is required."]);
    }
  });

  test("a hidden description is not even read: whatever is sent is dropped", () => {
    for (const description of [
      "Sneaked in",
      5,
      { nested: true },
      "x".repeat(INCIDENT_FORM_DESCRIPTION_MAX_LENGTH + 100),
    ]) {
      expect(
        valueOf(
          validate(
            submission({ description: description as JSONObject[string] }),
            { form: rules(IncidentFormFieldSetting.Hidden) },
          ),
        ),
      ).not.toHaveProperty("description");
    }
  });

  test("keeps the reporter's Markdown: line breaks inside, and the first line's indentation", () => {
    expect(
      valueOf(
        validate(
          submission({
            description:
              "\n\n    npm run build\n    exit 1\n\n**Since 10:00**  \n\n",
          }),
        ),
      ).description,
    ).toBe("    npm run build\n    exit 1\n\n**Since 10:00**");
  });

  test("drops NUL characters, which Postgres cannot store", () => {
    expect(
      valueOf(validate(submission({ description: "a\u0000b" }))).description,
    ).toBe("ab");
  });

  test("must be text when it is asked", () => {
    expect(errorsOf(validate(submission({ description: 42 })))).toEqual([
      "Description must be text.",
    ]);
  });

  test("may be 20000 characters, not 20001", () => {
    expect(
      valueOf(
        validate(
          submission({
            description: "x".repeat(INCIDENT_FORM_DESCRIPTION_MAX_LENGTH),
          }),
        ),
      ).description,
    ).toHaveLength(INCIDENT_FORM_DESCRIPTION_MAX_LENGTH);

    expect(
      errorsOf(
        validate(
          submission({
            description: "x".repeat(INCIDENT_FORM_DESCRIPTION_MAX_LENGTH + 1),
          }),
        ),
      ),
    ).toEqual(["Description cannot be more than 20000 characters."]);
  });

  test.each([[undefined], ["Mandatory"], ["required"], [null]])(
    "a description setting of %j is read as Optional",
    (setting: unknown) => {
      const form: IncidentFormSubmissionRules = {
        ...DEFAULT_RULES,
        descriptionSetting: setting as string,
      };

      expect(valueOf(validate(submission(), { form })).title).toBe(
        "Checkout fails",
      );
      expect(
        valueOf(validate(submission({ description: "Kept" }), { form }))
          .description,
      ).toBe("Kept");
    },
  );
});

describe("validateIncidentFormSubmission: the severity", () => {
  const CHOOSING: IncidentFormSubmissionRules = {
    ...DEFAULT_RULES,
    allowReporterToChooseSeverity: true,
  };

  test("is not read when the form does not let the reporter choose", () => {
    for (const incidentSeverityId of [
      SEVERITY_HIGH,
      "not an id",
      5,
      ObjectID.generate().toString(),
    ]) {
      const value: ValidatedIncidentFormSubmission = valueOf(
        validate(
          submission({
            incidentSeverityId: incidentSeverityId as JSONObject[string],
          }),
        ),
      );

      expect(value).not.toHaveProperty("incidentSeverityId");
    }
  });

  test("may be left out, which means the form's own severity", () => {
    for (const incidentSeverityId of [undefined, null, "", "   "]) {
      const data: JSONObject = submission();

      if (incidentSeverityId !== undefined) {
        data["incidentSeverityId"] = incidentSeverityId;
      }

      expect(valueOf(validate(data, { form: CHOOSING }))).not.toHaveProperty(
        "incidentSeverityId",
      );
    }
  });

  test("one of the listed severities is taken, as listed", () => {
    expect(
      valueOf(
        validate(submission({ incidentSeverityId: SEVERITY_LOW }), {
          form: CHOOSING,
        }),
      ).incidentSeverityId,
    ).toBe(SEVERITY_LOW);

    expect(
      valueOf(
        validate(
          submission({
            incidentSeverityId: `  ${SEVERITY_HIGH.toUpperCase()} `,
          }),
          { form: CHOOSING },
        ),
      ).incidentSeverityId,
    ).toBe(SEVERITY_HIGH);
  });

  test.each([
    ["another project's severity", ObjectID.generate().toString()],
    ["something that is not an id", "critical"],
    ["a number", 1],
    ["an object", { _id: SEVERITY_HIGH }],
    ["a list", [SEVERITY_HIGH]],
  ])("%s is refused", (_label: string, incidentSeverityId: unknown) => {
    expect(
      errorsOf(
        validate(
          submission({
            incidentSeverityId: incidentSeverityId as JSONObject[string],
          }),
          { form: CHOOSING },
        ),
      ),
    ).toEqual(["Severity must be one of the severities this form lists."]);
  });

  test("with no severities to list, any choice is refused", () => {
    expect(
      errorsOf(
        validate(submission({ incidentSeverityId: SEVERITY_HIGH }), {
          form: CHOOSING,
          severities: [],
        }),
      ),
    ).toEqual(["Severity must be one of the severities this form lists."]);
  });
});

describe("validateIncidentFormSubmission: the reporter", () => {
  const ANONYMOUS: IncidentFormSubmissionRules = {
    ...DEFAULT_RULES,
    isReporterDetailsRequired: false,
  };

  test("the name and email are required unless the form says otherwise", () => {
    const data: JSONObject = submission();
    delete data["reporterName"];
    delete data["reporterEmail"];

    expect(errorsOf(validate(data))).toEqual([
      "Your Name is required.",
      "Your Email is required.",
    ]);

    // Undefined is the column's default: details required.
    expect(
      errorsOf(
        validate(data, {
          form: { ...DEFAULT_RULES, isReporterDetailsRequired: undefined },
        }),
      ),
    ).toEqual(["Your Name is required.", "Your Email is required."]);
  });

  test("an anonymous report leaves both out", () => {
    const data: JSONObject = submission({
      reporterName: "  ",
      reporterEmail: "",
    });

    const value: ValidatedIncidentFormSubmission = valueOf(
      validate(data, { form: ANONYMOUS }),
    );

    expect(value).not.toHaveProperty("reporterName");
    expect(value).not.toHaveProperty("reporterEmail");
  });

  test("details given on an anonymous form are still kept, and still checked", () => {
    expect(valueOf(validate(submission(), { form: ANONYMOUS }))).toMatchObject({
      reporterName: "Jane Doe",
      reporterEmail: "jane@example.com",
    });

    expect(
      errorsOf(
        validate(submission({ reporterEmail: "jane" }), { form: ANONYMOUS }),
      ),
    ).toEqual(["Your Email is not a valid email address."]);
  });

  test("the name is cleaned to one line", () => {
    expect(
      valueOf(validate(submission({ reporterName: "  Jane\n\tDoe " })))
        .reporterName,
    ).toBe("Jane Doe");
  });

  test("the name may be 100 characters, not 101", () => {
    expect(
      valueOf(
        validate(
          submission({
            reporterName: "n".repeat(INCIDENT_FORM_REPORTER_NAME_MAX_LENGTH),
          }),
        ),
      ).reporterName,
    ).toHaveLength(INCIDENT_FORM_REPORTER_NAME_MAX_LENGTH);

    expect(
      errorsOf(
        validate(
          submission({
            reporterName: "n".repeat(
              INCIDENT_FORM_REPORTER_NAME_MAX_LENGTH + 1,
            ),
          }),
        ),
      ),
    ).toEqual(["Your Name cannot be more than 100 characters."]);
  });

  test("the email is trimmed and lowercased, as Email stores it", () => {
    expect(
      valueOf(
        validate(submission({ reporterEmail: "  Jane.Doe@Example.COM\n" })),
      ).reporterEmail,
    ).toBe("jane.doe@example.com");
  });

  test.each([
    ["no at sign", "jane.example.com"],
    ["no domain", "jane@"],
    ["no mailbox", "@example.com"],
    ["no dot in the domain", "jane@localhost"],
    ["a space", "jane doe@example.com"],
    ["two at signs", "jane@@example.com"],
    ["a display name", "Jane <jane@example.com>"],
    ["trailing words", "jane@example.com please reply"],
    ["leading words", "mail jane@example.com"],
    ["a line break inside", "jane@exam\nple.com"],
    ["a trailing dot", "jane@example.com."],
    ["a leading dot", ".jane@example.com"],
  ])(
    "an email with %s is refused, even though Email finds an address in it",
    (_label: string, email: string) => {
      expect(errorsOf(validate(submission({ reporterEmail: email })))).toEqual([
        "Your Email is not a valid email address.",
      ]);
    },
  );

  test.each([
    ["jane+incidents@example.com"],
    ["j.o'hara@sub.example.co.uk"],
    ["ops_team-1@example-mail.io"],
  ])("an ordinary address like %s passes", (email: string) => {
    expect(
      valueOf(validate(submission({ reporterEmail: email }))).reporterEmail,
    ).toBe(email);
  });

  test("the email may be 100 characters, not 101 - and a long one is only told it is too long", () => {
    const domain: string = "@example.com";
    const longest: string = `${"a".repeat(
      INCIDENT_FORM_REPORTER_EMAIL_MAX_LENGTH - domain.length,
    )}${domain}`;

    expect(
      valueOf(validate(submission({ reporterEmail: longest }))).reporterEmail,
    ).toBe(longest);

    expect(
      errorsOf(validate(submission({ reporterEmail: `a${longest}` }))),
    ).toEqual(["Your Email cannot be more than 100 characters."]);
  });

  test.each([
    [5],
    [true],
    [{ email: "jane@example.com" }],
    [["jane@example.com"]],
  ])(
    "the name and email must be text: %j is refused once each",
    (value: unknown) => {
      expect(
        errorsOf(
          validate(
            submission({
              reporterName: value as JSONObject[string],
              reporterEmail: value as JSONObject[string],
            }),
          ),
        ),
      ).toEqual(["Your Name must be text.", "Your Email must be text."]);
    },
  );
});

describe("validateIncidentFormSubmission: custom field answers", () => {
  type AnswerFunction = (
    answers: JSONObject,
  ) => IncidentFormSubmissionValidationResult;

  const answer: AnswerFunction = (
    answers: JSONObject,
  ): IncidentFormSubmissionValidationResult => {
    return validate(
      submission({ customFields: { ...REQUIRED_ANSWERS, ...answers } }),
    );
  };

  test("answers are an object keyed by field name", () => {
    for (const customFields of ["Impact=down", ["Checkout is down"], 5, true]) {
      expect(
        errorsOf(
          validate(
            submission({ customFields: customFields as JSONObject[string] }),
          ),
        ),
      ).toEqual([
        "The custom field answers must be an object keyed by field name.",
        "Impact is required.",
        "I Have Checked The Status Page must be checked.",
      ]);
    }
  });

  test("no answers at all only fails the required questions", () => {
    const data: JSONObject = submission();
    delete data["customFields"];

    expect(errorsOf(validate(data))).toEqual([
      "Impact is required.",
      "I Have Checked The Status Page must be checked.",
    ]);
  });

  test("an answer to a field the form does not ask is dropped unread", () => {
    const value: ValidatedIncidentFormSubmission = valueOf(
      answer({
        "Internal Cost Centre": "4411",
        "Secret Escalation Note": { not: "even valid" },
        impact: "lowercase name, not the field",
      }),
    );

    expect(Object.keys(value.customFields).sort()).toEqual(
      ["I Have Checked The Status Page", "Impact"].sort(),
    );
  });

  test("a form that asks nothing stores nothing, whatever is sent", () => {
    expect(
      valueOf(
        validate(submission({ customFields: { Impact: "Down", Other: 1 } }), {
          askedDefinitions: [],
        }),
      ).customFields,
    ).toEqual({});
  });

  test("an optional question left empty is left out, so a template's value still applies", () => {
    const value: ValidatedIncidentFormSubmission = valueOf(
      answer({
        "Steps to Reproduce": "   ",
        Notes: "",
        "Users Affected": null,
        Region: "",
        Systems: [],
        "Noticed On": "  ",
      }),
    );

    expect(value.customFields).toEqual(REQUIRED_ANSWERS);
  });

  test("a required text question answered with whitespace is still unanswered", () => {
    expect(errorsOf(answer({ Impact: " \n\t " }))).toEqual([
      "Impact is required.",
    ]);
  });

  test("text is cleaned as its field shows it", () => {
    const value: ValidatedIncidentFormSubmission = valueOf(
      answer({
        Impact: "  Checkout\ndown  ",
        "Steps to Reproduce": "\n1. Open checkout\n2. Pay\n\n",
        Notes: "\n\n    stack trace\n",
      }),
    );

    expect(value.customFields["Impact"]).toBe("Checkout down");
    expect(value.customFields["Steps to Reproduce"]).toBe(
      "1. Open checkout\n2. Pay",
    );
    expect(value.customFields["Notes"]).toBe("    stack trace");
  });

  test("NUL characters are dropped from every text answer", () => {
    const value: ValidatedIncidentFormSubmission = valueOf(
      answer({
        Impact: "Check\u0000out",
        Notes: "a\u0000b",
        Region: "E\u0000U",
        Systems: ["A\u0000PI"],
      }),
    );

    expect(value.customFields).toMatchObject({
      Impact: "Check out",
      Notes: "ab",
      Region: "EU",
      Systems: ["API"],
    });
  });

  test("each answer is checked as an API write would check it", () => {
    expect(
      errorsOf(
        answer({
          "Users Affected": "lots",
          Region: "APAC",
          Systems: ["API", "Mobile"],
          "Noticed On": "yesterday-ish",
          "Noticed At": "soon",
          Untyped: { nested: true },
        }),
      ),
    ).toEqual([
      '"Users Affected" holds a number, but was sent "lots".',
      '"APAC" is not one of the options for "Region". Choose one of: "EU", "US".',
      '"Mobile" is not one of the options for "Systems". Choose from: "API", "Web".',
      '"Noticed On" holds a date, but was sent "yesterday-ish".',
      '"Noticed At" holds a date and time, but was sent "soon".',
      '"Untyped" holds text, but was sent "{"nested":true}".',
    ]);
  });

  test("good answers of every type are kept", () => {
    const value: ValidatedIncidentFormSubmission = valueOf(
      answer({
        "Users Affected": "1200",
        Region: " EU ",
        Systems: ["Web", "API"],
        "Noticed On": "2026-09-29",
        "Noticed At": "2026-09-29T08:15:00.000Z",
        Untyped: "free text",
        "Customer Facing": false,
      }),
    );

    expect(value.customFields).toEqual({
      ...REQUIRED_ANSWERS,
      "Users Affected": "1200",
      Region: "EU",
      Systems: ["Web", "API"],
      "Noticed On": "2026-09-29",
      "Noticed At": "2026-09-29T08:15:00.000Z",
      Untyped: "free text",
      "Customer Facing": false,
    });
  });

  test("a number may be sent as a number", () => {
    expect(
      valueOf(answer({ "Users Affected": 0 })).customFields["Users Affected"],
    ).toBe(0);
  });

  test("a required yes/no must be ticked: no, missing, or anything else is refused", () => {
    const name: string = "I Have Checked The Status Page";

    for (const unticked of [false, "false", null, ""]) {
      expect(
        errorsOf(
          validate(
            submission({
              customFields: {
                Impact: "Down",
                [name]: unticked as JSONObject[string],
              },
            }),
          ),
        ),
      ).toEqual([`${name} must be checked.`]);
    }

    expect(
      errorsOf(validate(submission({ customFields: { Impact: "Down" } }))),
    ).toEqual([`${name} must be checked.`]);

    expect(
      errorsOf(
        validate(
          submission({ customFields: { Impact: "Down", [name]: "yes" } }),
        ),
      ),
    ).toEqual([`"${name}" holds true or false, but was sent "yes".`]);
  });

  test('a yes/no answered "true" or "false" is stored as the boolean the dashboard stores', () => {
    const value: ValidatedIncidentFormSubmission = valueOf(
      validate(
        submission({
          customFields: {
            Impact: "Down",
            "I Have Checked The Status Page": " true ",
            "Customer Facing": "false",
          },
        }),
      ),
    );

    expect(value.customFields["I Have Checked The Status Page"]).toBe(true);
    expect(value.customFields["Customer Facing"]).toBe(false);
  });

  test("a multi-select holds each option once, trimmed, and one bare option becomes a list", () => {
    expect(
      valueOf(answer({ Systems: ["API", " API ", "", "Web", "API"] }))
        .customFields["Systems"],
    ).toEqual(["API", "Web"]);

    expect(
      valueOf(answer({ Systems: " Web " })).customFields["Systems"],
    ).toEqual(["Web"]);
  });

  test("a required multi-select with nothing chosen is unanswered", () => {
    expect(
      errorsOf(
        validate(
          submission({
            customFields: { ...REQUIRED_ANSWERS, Systems: ["", " "] },
          }),
          {
            askedDefinitions: [
              ...ASKED.filter((field: IncidentFormAskedDefinition): boolean => {
                return field.name !== "Systems";
              }),
              {
                name: "Systems",
                customFieldType: CustomFieldType.MultiSelectDropdown,
                dropdownOptions: "API\nWeb",
                isRequiredOnCreate: true,
              },
            ],
          },
        ),
      ),
    ).toEqual(["Systems is required."]);
  });

  test("text answers may be 10000 characters, not 10001 - a list entry included", () => {
    const longest: string = "x".repeat(
      INCIDENT_FORM_CUSTOM_FIELD_TEXT_MAX_LENGTH,
    );

    expect(valueOf(answer({ Notes: longest })).customFields["Notes"]).toBe(
      longest,
    );

    expect(errorsOf(answer({ Notes: `${longest}x` }))).toEqual([
      "Notes cannot be more than 10000 characters.",
    ]);
    expect(
      errorsOf(answer({ "Users Affected": `1${"0".repeat(10000)}` })),
    ).toEqual(["Users Affected cannot be more than 10000 characters."]);
    expect(errorsOf(answer({ Systems: ["API", `${longest}x`] }))).toEqual([
      "Systems cannot be more than 10000 characters.",
    ]);
  });

  test("a field name with $ patterns is quoted back as typed", () => {
    expect(
      errorsOf(
        validate(submission({ customFields: {} }), {
          askedDefinitions: [
            {
              name: "Cost $& ($1) $$",
              customFieldType: CustomFieldType.Text,
              isRequiredOnCreate: true,
            },
          ],
        }),
      ),
    ).toEqual(["Cost $& ($1) $$ is required."]);
  });

  test("regression: a field named __proto__ is stored as an answer, not as the object's prototype", () => {
    const asked: Array<IncidentFormAskedDefinition> = [
      {
        name: "__proto__",
        customFieldType: CustomFieldType.MultiSelectDropdown,
        dropdownOptions: "API\nWeb",
        isRequiredOnCreate: true,
      },
    ];

    const value: ValidatedIncidentFormSubmission = valueOf(
      validate(
        submission({
          customFields: JSON.parse('{"__proto__": ["API"]}') as JSONObject,
        }),
        { askedDefinitions: asked },
      ),
    );

    expect(Object.getPrototypeOf(value.customFields)).toBe(Object.prototype);
    expect(Object.keys(value.customFields)).toEqual(["__proto__"]);
    expect(JSON.stringify(value.customFields)).toBe('{"__proto__":["API"]}');
  });

  test("an inherited answer is not an answer", () => {
    const answers: JSONObject = Object.create({
      Impact: "Inherited",
    }) as JSONObject;

    expect(errorsOf(validate(submission({ customFields: answers })))).toEqual([
      "Impact is required.",
      "I Have Checked The Status Page must be checked.",
    ]);
  });
});

describe("formatIncidentFormSubmissionErrors", () => {
  test("joins every problem into one message", () => {
    expect(
      formatIncidentFormSubmissionErrors([
        "Title is required.",
        "Your Email is not a valid email address.",
      ]),
    ).toBe("Title is required. Your Email is not a valid email address.");
    expect(formatIncidentFormSubmissionErrors([])).toBe("");
  });
});

// A relative import: another pure module of Common.
const RELATIVE_IMPORT: RegExp = /^\.\.?\//;

describe("the module stays pure", () => {
  test("imports nothing from React, the database, the server or the UI", () => {
    const source: string = fs.readFileSync(
      path.join(__dirname, "../../../Types/Incident/IncidentFormPublic.ts"),
      "utf8",
    );

    const imports: Array<string> = Array.from(
      source.matchAll(/from\s+"([^"]+)"/g),
    ).map((match: RegExpMatchArray): string => {
      return match[1]!;
    });

    expect(imports.length).toBeGreaterThan(0);

    for (const imported of imports) {
      expect({ imported, relative: RELATIVE_IMPORT.test(imported) }).toEqual({
        imported,
        relative: true,
      });
      expect(imported).not.toMatch(/react|typeorm|Server|UI|Models/i);
    }
  });
});
